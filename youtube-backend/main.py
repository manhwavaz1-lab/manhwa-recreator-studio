import os
import re
import shutil
import tempfile
import time
from collections import defaultdict, deque
from pathlib import Path
from threading import BoundedSemaphore, Lock

import yt_dlp
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from starlette.background import BackgroundTask

app = FastAPI(title="Manhwa Studio YouTube Downloader", version="1.0.0")

origins = [item.strip() for item in os.getenv("CORS_ORIGINS", "*").split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
MAX_DURATION_SECONDS = 4 * 60 * 60
RATE_WINDOW_SECONDS = 60 * 60
RATE_LIMIT = 4
requests_by_ip = defaultdict(deque)
rate_lock = Lock()
download_slots = BoundedSemaphore(2)
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com"}


class DownloadRequest(BaseModel):
    url: HttpUrl


def check_rate_limit(ip: str) -> None:
    now = time.time()
    with rate_lock:
        bucket = requests_by_ip[ip]
        while bucket and now - bucket[0] > RATE_WINDOW_SECONDS:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT:
            raise HTTPException(status_code=429, detail="Limite temporário atingido. Aguarde antes de tentar novamente.")
        bucket.append(now)


def validate_youtube_url(value: str) -> None:
    from urllib.parse import urlparse
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in YOUTUBE_HOSTS:
        raise HTTPException(status_code=400, detail="Cole um link HTTPS válido do YouTube.")
    if parsed.path == "/playlist" or "list=" in parsed.query:
        raise HTTPException(status_code=400, detail="Links de playlists não são aceitos. Cole o link de um único vídeo.")


@app.get("/health")
def health():
    return {"status": "ok", "service": "manhwa-studio-youtube-downloader"}


@app.post("/api/youtube/download")
def download_youtube_video(payload: DownloadRequest, request: Request):
    url = str(payload.url)
    validate_youtube_url(url)
    check_rate_limit(request.client.host if request.client else "unknown")
    if not download_slots.acquire(blocking=False):
        raise HTTPException(status_code=503, detail="O serviço está ocupado com outros downloads. Tente novamente em instantes.")

    workdir = tempfile.mkdtemp(prefix="manhwa-youtube-")
    try:
        options = {
            "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/best",
            "merge_output_format": "mp4",
            "outtmpl": str(Path(workdir) / "%(id)s.%(ext)s"),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "restrictfilenames": True,
            "windowsfilenames": True,
            "overwrites": True,
            "continuedl": False,
            "retries": 2,
            "fragment_retries": 2,
            "socket_timeout": 30,
            "max_filesize": MAX_FILE_BYTES,
            "match_filter": yt_dlp.utils.match_filter_func("duration <= 14400"),
            "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
        }
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=False)
            if not info or info.get("_type") == "playlist" or info.get("entries"):
                raise HTTPException(status_code=400, detail="Cole o link de um único vídeo, não de uma playlist.")
            if info.get("extractor_key", "").lower() not in {"youtube", "youtubeweb"}:
                raise HTTPException(status_code=400, detail="O link não foi reconhecido como um vídeo do YouTube.")
            if info.get("is_live"):
                raise HTTPException(status_code=400, detail="Transmissões ao vivo não são aceitas.")
            duration = info.get("duration")
            if duration and duration > MAX_DURATION_SECONDS:
                raise HTTPException(status_code=413, detail="O vídeo ultrapassa o limite de 4 horas.")
            downloader.download([url])

        candidates = [p for p in Path(workdir).iterdir() if p.is_file() and p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}]
        if not candidates:
            raise HTTPException(status_code=502, detail="O YouTube não forneceu um arquivo que o FFmpeg consiga preparar.")
        output = max(candidates, key=lambda p: p.stat().st_size)
        if output.stat().st_size > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail="O arquivo excede o limite de 2 GB.")
        if output.suffix.lower() != ".mp4":
            raise HTTPException(status_code=502, detail="Não foi possível converter o download para MP4.")
        return FileResponse(
            output,
            media_type="video/mp4",
            filename="youtube-video.mp4",
            headers={"Cache-Control": "no-store"},
            background=BackgroundTask(shutil.rmtree, workdir, ignore_errors=True),
        )
    except HTTPException:
        shutil.rmtree(workdir, ignore_errors=True)
        raise
    except yt_dlp.utils.DownloadError as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        message = str(exc).lower()
        if any(term in message for term in ("private video", "video unavailable", "members-only", "sign in")):
            detail = "Este vídeo não está disponível publicamente. Vídeos privados ou que exigem login não são aceitos."
        else:
            detail = "Não foi possível baixar este vídeo. Confirme se o link é público ou não listado e tente novamente."
        raise HTTPException(status_code=422, detail=detail) from exc
    except Exception as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Falha inesperada no serviço de download.") from exc
    finally:
        download_slots.release()
