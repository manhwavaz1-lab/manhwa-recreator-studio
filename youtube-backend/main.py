import os
import shutil
import tempfile
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path
from threading import BoundedSemaphore, Lock
from urllib.parse import urlparse

import yt_dlp
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
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
JOB_TTL_SECONDS = 60 * 60
requests_by_ip = defaultdict(deque)
jobs = {}
rate_lock = Lock()
jobs_lock = Lock()
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
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in YOUTUBE_HOSTS:
        raise HTTPException(status_code=400, detail="Cole um link HTTPS válido do YouTube.")
    if parsed.path == "/playlist" or "list=" in parsed.query:
        raise HTTPException(status_code=400, detail="Links de playlists não são aceitos. Cole o link de um único vídeo.")


def update_job(job_id: str, **values) -> None:
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(values)


def cleanup_job(job_id: str) -> None:
    with jobs_lock:
        job = jobs.pop(job_id, None)
    if job and job.get("workdir"):
        shutil.rmtree(job["workdir"], ignore_errors=True)


def run_download_job(job_id: str, url: str) -> None:
    if not download_slots.acquire(blocking=False):
        update_job(job_id, status="error", message="O serviço está ocupado com outros downloads. Tente novamente em instantes.")
        return

    workdir = tempfile.mkdtemp(prefix="manhwa-youtube-")
    update_job(job_id, status="downloading", progress=0, message="Conectando ao YouTube...", workdir=workdir)
    try:
        def progress_hook(data):
            if data.get("status") == "downloading":
                total = data.get("total_bytes") or data.get("total_bytes_estimate")
                downloaded = data.get("downloaded_bytes", 0)
                percent = min(99, round(downloaded * 100 / total)) if total else 0
                update_job(job_id, progress=percent, message="Baixando vídeo do YouTube: " + str(percent) + "%")
            elif data.get("status") == "finished":
                update_job(job_id, progress=99, message="Download concluído. Preparando MP4 com FFmpeg...")

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
            "progress_hooks": [progress_hook],
            "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
        }
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=False)
            if not info or info.get("_type") == "playlist" or info.get("entries"):
                raise ValueError("Cole o link de um único vídeo, não de uma playlist.")
            if info.get("extractor_key", "").lower() not in {"youtube", "youtubeweb"}:
                raise ValueError("O link não foi reconhecido como um vídeo do YouTube.")
            if info.get("is_live"):
                raise ValueError("Transmissões ao vivo não são aceitas.")
            duration = info.get("duration")
            if duration and duration > MAX_DURATION_SECONDS:
                raise ValueError("O vídeo ultrapassa o limite de 4 horas.")
            downloader.download([url])

        candidates = [p for p in Path(workdir).iterdir() if p.is_file() and p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}]
        if not candidates:
            raise ValueError("O YouTube não forneceu um arquivo que o FFmpeg consiga preparar.")
        output = max(candidates, key=lambda p: p.stat().st_size)
        if output.stat().st_size > MAX_FILE_BYTES:
            raise ValueError("O arquivo excede o limite de 2 GB.")
        if output.suffix.lower() != ".mp4":
            raise ValueError("Não foi possível converter o download para MP4.")
        update_job(job_id, status="completed", progress=100, message="Download pronto para processamento.", file_path=str(output), filename="youtube-video.mp4")
    except yt_dlp.utils.DownloadError as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        message = str(exc).lower()
        if any(term in message for term in ("private video", "video unavailable", "members-only", "sign in")):
            detail = "Este vídeo não está disponível publicamente. Vídeos privados ou que exigem login não são aceitos."
        else:
            detail = "Não foi possível baixar este vídeo. Confirme se o link é público ou não listado e tente novamente."
        update_job(job_id, status="error", message=detail, workdir=None)
    except ValueError as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        update_job(job_id, status="error", message=str(exc), workdir=None)
    except Exception:
        shutil.rmtree(workdir, ignore_errors=True)
        update_job(job_id, status="error", message="Falha inesperada no serviço de download.", workdir=None)
    finally:
        download_slots.release()


@app.get("/health")
def health():
    return {"status": "ok", "service": "manhwa-studio-youtube-downloader"}


@app.post("/api/youtube/jobs", status_code=202)
def create_download_job(payload: DownloadRequest, request: Request, background_tasks: BackgroundTasks):
    url = str(payload.url)
    validate_youtube_url(url)
    check_rate_limit(request.client.host if request.client else "unknown")
    now = time.time()
    with jobs_lock:
        expired = [job_id for job_id, job in jobs.items() if job["status"] in {"completed", "error"} and now - job["created_at"] > JOB_TTL_SECONDS]
    for job_id in expired:
        cleanup_job(job_id)
    job_id = uuid.uuid4().hex
    with jobs_lock:
        jobs[job_id] = {"status": "queued", "progress": 0, "message": "Download na fila...", "created_at": now, "workdir": None, "file_path": None}
    background_tasks.add_task(run_download_job, job_id, url)
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/youtube/jobs/{job_id}")
def get_download_job(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Download não encontrado ou expirado.")
        return {"status": job["status"], "progress": job["progress"], "message": job["message"]}


@app.get("/api/youtube/jobs/{job_id}/file")
def get_downloaded_file(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job or job["status"] != "completed" or not job.get("file_path"):
            raise HTTPException(status_code=409, detail="O vídeo ainda não está pronto para baixar.")
        file_path = job["file_path"]
        workdir = job["workdir"]
    return FileResponse(
        file_path,
        media_type="video/mp4",
        filename="youtube-video.mp4",
        headers={"Cache-Control": "no-store"},
        background=BackgroundTask(cleanup_job, job_id),
    )
