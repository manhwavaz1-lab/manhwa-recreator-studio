import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path
from threading import BoundedSemaphore, Lock
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

import yt_dlp
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from gpu_render import RenderParams, list_nvidia_gpus, nvdec_available, nvenc_available, render
from pydantic import BaseModel, HttpUrl
from starlette.background import BackgroundTask

app = FastAPI(title="Manhwa Studio GPU Renderer", version="3.1.0")
origins = [item.strip() for item in os.getenv("CORS_ORIGINS", "*").split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

MAX_FILE_BYTES = int(os.getenv("MAX_FILE_BYTES", str(7 * 1024 * 1024 * 1024)))
RATE_WINDOW_SECONDS = 60 * 60
RATE_LIMIT = int(os.getenv("RATE_LIMIT", "10"))
API_KEY = ""  # Single-origin private instance; no key is entered in the website UI.
JOB_TTL_SECONDS = int(os.getenv("JOB_TTL_SECONDS", "21600"))
jobs: dict[str, dict] = {}
requests_by_ip = defaultdict(deque)
rate_lock, jobs_lock = Lock(), Lock()
PARALLEL_SEGMENTS = max(1, min(3, int(os.getenv("PARALLEL_SEGMENTS", "3"))))
render_slots = BoundedSemaphore(max(1, int(os.getenv("RENDER_SLOTS", str(PARALLEL_SEGMENTS)))))
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com"}


class DownloadRequest(BaseModel):
    url: HttpUrl


def authorize(request: Request) -> None:
    if API_KEY:
        supplied = request.headers.get("authorization", "")
        if supplied != "Bearer " + API_KEY:
            raise HTTPException(status_code=401, detail="Chave de acesso inválida ou ausente.")


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
    if parsed.scheme != "https" or (parsed.hostname or "").lower() not in YOUTUBE_HOSTS:
        raise HTTPException(status_code=400, detail="Cole um link HTTPS válido do YouTube.")
    if parsed.path == "/playlist" or "list=" in parsed.query:
        raise HTTPException(status_code=400, detail="Links de playlists não são aceitos. Cole um único vídeo.")


def update_job(job_id: str, **values) -> None:
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(values)


def public_job(job: dict) -> dict:
    keys = ("status", "progress", "message", "engine", "elapsed_seconds", "eta_seconds", "speed", "error", "segments")
    return {key: job.get(key) for key in keys if key in job}


def cleanup_job(job_id: str) -> None:
    with jobs_lock:
        job = jobs.pop(job_id, None)
    if job and job.get("workdir"):
        shutil.rmtree(job["workdir"], ignore_errors=True)


def prune_jobs() -> None:
    now = time.time()
    with jobs_lock:
        expired = [key for key, job in jobs.items()
                   if job.get("status") in {"completed", "error"} and now - job.get("created_at", now) > JOB_TTL_SECONDS]
    for key in expired:
        cleanup_job(key)


def save_upload(upload: UploadFile, destination: Path) -> None:
    total = 0
    with destination.open("wb") as output:
        while chunk := upload.file.read(8 * 1024 * 1024):
            total += len(chunk)
            if total > MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail="Arquivo excede o limite configurado.")
            output.write(chunk)
    if total == 0:
        raise HTTPException(status_code=400, detail="Arquivo enviado vazio.")


def download_youtube(url: str, workdir: Path, job_id: str) -> str:
    validate_youtube_url(url)
    update_job(job_id, status="downloading", progress=0, message="Conectando ao YouTube...")
    def hook(data):
        if data.get("status") == "downloading":
            total = data.get("total_bytes") or data.get("total_bytes_estimate")
            received = data.get("downloaded_bytes", 0)
            pct = min(99, int(received * 100 / total)) if total else 0
            update_job(job_id, progress=pct, message=f"Baixando vídeo do YouTube: {pct}%")
        elif data.get("status") == "finished":
            update_job(job_id, progress=99, message="Download concluído; preparando arquivo...")
    options = {
        "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/best",
        "merge_output_format": "mp4",
        "outtmpl": str(workdir / "%(id)s.%(ext)s"),
        "noplaylist": True, "quiet": True, "no_warnings": True,
        "restrictfilenames": True, "overwrites": True, "continuedl": True,
        "retries": 3, "fragment_retries": 3, "socket_timeout": 45,
        "max_filesize": MAX_FILE_BYTES, "progress_hooks": [hook],
        "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=False)
        if not info or info.get("_type") == "playlist" or info.get("entries"):
            raise ValueError("Cole o link de um único vídeo, não de uma playlist.")
        if info.get("extractor_key", "").lower() not in {"youtube", "youtubeweb"}:
            raise ValueError("O link não foi reconhecido como vídeo do YouTube.")
        downloader.download([url])
    files = [item for item in workdir.iterdir() if item.is_file() and item.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}]
    if not files:
        raise ValueError("O YouTube não forneceu um arquivo de vídeo utilizável.")
    source = max(files, key=lambda item: item.stat().st_size)
    if source.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("O vídeo excede o limite configurado.")
    return str(source)



_core_samples: dict[str, tuple[int, int]] = {}
_core_lock = Lock()

@app.get("/api/system/cores")
def system_cores():
    """Per-core CPU utilization sampled from Linux /proc/stat."""
    if not Path("/proc/stat").exists():
        return {"cores": [], "count": os.cpu_count() or 1}
    current = {}
    with open("/proc/stat", "r", encoding="utf-8") as stats:
        for line in stats:
            parts = line.split()
            if not parts or not re.fullmatch(r"cpu\d+", parts[0]):
                continue
            values = [int(value) for value in parts[1:]]
            idle = values[3] + (values[4] if len(values) > 4 else 0)
            total = sum(values)
            current[parts[0]] = (total, idle)
    readings = []
    with _core_lock:
        for name, (total, idle) in current.items():
            previous = _core_samples.get(name)
            usage = 0.0
            if previous:
                total_delta = total - previous[0]
                idle_delta = idle - previous[1]
                if total_delta > 0:
                    usage = max(0.0, min(100.0, (total_delta - idle_delta) * 100 / total_delta))
            readings.append({"core": int(name[3:]) + 1, "usage": round(usage, 1)})
        _core_samples.clear()
        _core_samples.update(current)
    return {"cores": readings, "count": len(readings)}

@app.get("/health")
def health():
    return {"status": "ok", "service": "manhwa-studio-gpu-renderer", "version": "3.1.0"}


@app.get("/api/capabilities")
def capabilities():
    gpus = list_nvidia_gpus()
    first = gpus[0] if gpus else {}
    return {
        "gpu": (f"{len(gpus)}x " + first.get("name", "NVIDIA")) if gpus else "",
        "gpu_memory": (f'{first.get("memory_total_mb", 0) / 1024:.1f} GB por GPU' if first else ""),
        "driver": first.get("driver", ""),
        "gpu_count": len(gpus),
        "gpus": [
            {
                **gpu,
                "nvenc_h264": nvenc_available("h264", gpu["index"]),
                "nvenc_h265": nvenc_available("h265", gpu["index"]),
            }
            for gpu in gpus
        ],
        "nvenc_h264": any(nvenc_available("h264", gpu["index"]) for gpu in gpus),
        "nvenc_h265": any(nvenc_available("h265", gpu["index"]) for gpu in gpus),
        "nvdec": nvdec_available(),
        "cpus": os.cpu_count() or 1,
        "render_threads": int(os.getenv("RENDER_THREADS", os.cpu_count() or 1)),
        "ram_total_gb": round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / (1024 ** 3), 1) if hasattr(os, "sysconf") else None,
        "disk_free_gb": round(shutil.disk_usage(tempfile.gettempdir()).free / (1024 ** 3), 1),
        "max_file_bytes": MAX_FILE_BYTES,
    }


def run_render_job(job_id: str, workdir: str, youtube_url: str | None,
                   video_path: str | None, background_path: str, params: RenderParams) -> None:
    directory = Path(workdir)
    acquired = False
    try:
        if not render_slots.acquire(blocking=False):
            raise RuntimeError("A GPU já está ocupada com outra renderização. Tente novamente.")
        acquired = True
        if youtube_url:
            video_path = download_youtube(youtube_url, directory, job_id)
        if not video_path or not Path(video_path).is_file():
            raise RuntimeError("Arquivo de vídeo não encontrado.")

        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", video_path],
            capture_output=True, text=True, check=True,
        )
        total_duration = float(probe.stdout.strip())
        segment_count = min(PARALLEL_SEGMENTS, max(1, int(total_duration // 1) + 1))
        segment_duration = total_duration / segment_count
        segments = [
            {"part": index + 1, "status": "queued", "progress": 0,
             "start": round(index * segment_duration, 3),
             "duration": round((total_duration - index * segment_duration) if index == segment_count - 1 else segment_duration, 3)}
            for index in range(segment_count)
        ]
        update_job(job_id, status="rendering", progress=0,
                   message=f"Renderizando {segment_count} partes simultaneamente...",
                   segments=segments)
        progress_lock = Lock()
        completed_progress = [0.0] * segment_count
        engines = []

        def render_part(index: int):
            item = segments[index]
            output = str(directory / f"segment-{index + 1:02d}.mp4")
            update_job(job_id, segments=[
                {**segment, "status": "renderizando" if segment["part"] == index + 1 else segment["status"]}
                for segment in segments
            ])
            def progress(percent: int, stats: dict):
                with progress_lock:
                    completed_progress[index] = percent
                    aggregate = int(sum(completed_progress) / segment_count)
                    snapshot = [
                        {**segments[i], "progress": int(completed_progress[i]),
                         "status": "concluído" if completed_progress[i] >= 99 else
                                   ("renderizando" if i == index else segments[i]["status"])}
                        for i in range(segment_count)
                    ]
                    update_job(job_id, progress=aggregate,
                               message=f"Renderizando parte {index + 1}/{segment_count}: {percent}%",
                               elapsed_seconds=stats.get("elapsed_seconds"),
                               eta_seconds=stats.get("eta_seconds"), speed=stats.get("speed"),
                               segments=snapshot)
            engine = render(video_path, background_path, output, params, progress,
                            start_seconds=item["start"], duration_seconds=item["duration"])
            with progress_lock:
                completed_progress[index] = 100
                engines.append(engine)
                snapshot = [
                    {**segments[i], "progress": int(completed_progress[i]),
                     "status": "concluído" if completed_progress[i] >= 100 else segments[i]["status"]}
                    for i in range(segment_count)
                ]
                update_job(job_id, progress=int(sum(completed_progress) / segment_count),
                           message=f"Parte {index + 1}/{segment_count} concluída.",
                           segments=snapshot)
            return output

        outputs = [None] * segment_count
        with ThreadPoolExecutor(max_workers=segment_count, thread_name_prefix="gpu-segment") as pool:
            futures = {pool.submit(render_part, index): index for index in range(segment_count)}
            for future in as_completed(futures):
                outputs[futures[future]] = future.result()

        concat_file = directory / "segments.txt"
        with concat_file.open("w", encoding="utf-8") as handle:
            for segment_path in outputs:
                handle.write("file '" + str(segment_path) + "'\n")
        final_output = directory / "manhwa-studio-output.mp4"
        update_job(job_id, message="Unindo as três partes sem recodificar...")
        concat = subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat",
             "-safe", "0", "-i", str(concat_file), "-c", "copy",
             "-movflags", "+faststart", "-map_metadata", "-1", str(final_output)],
            capture_output=True, text=True,
        )
        if concat.returncode != 0:
            raise RuntimeError("Falha ao unir segmentos: " + (concat.stderr[-1200:] or "FFmpeg concat falhou."))
        update_job(job_id, status="completed", progress=100,
                   message=f"Renderização concluída: {segment_count} partes paralelas unidas.",
                   engine=" + ".join(sorted(set(engines))), file_path=str(final_output),
                   filename="manhwa-studio.mp4",
                   segments=[{**item, "status": "concluído", "progress": 100} for item in segments])
    except Exception as exc:
        update_job(job_id, status="error", progress=0, message=str(exc)[:500], error=str(exc)[:1000])
    finally:
        if acquired:
            render_slots.release()


@app.post("/api/render", status_code=202)
async def create_render_job(
    request: Request,
    background_tasks: BackgroundTasks,
    background: UploadFile = File(...),
    params: str = Form("{}"),
    youtube_url: str = Form(""),
    video: UploadFile | None = File(None),
):
    authorize(request)
    check_rate_limit(request.client.host if request.client else "unknown")
    if not video and not youtube_url.strip():
        raise HTTPException(status_code=400, detail="Envie um vídeo ou um link do YouTube.")
    if youtube_url and not video:
        validate_youtube_url(youtube_url)
    try:
        render_params = RenderParams.from_json(params)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    prune_jobs()
    workdir = Path(tempfile.mkdtemp(prefix="manhwa-render-"))
    try:
        bg_suffix = Path(background.filename or "background.png").suffix.lower()
        if bg_suffix not in {".png", ".jpg", ".jpeg"}:
            raise HTTPException(status_code=400, detail="A moldura deve ser PNG ou JPEG.")
        bg_path = workdir / ("background" + bg_suffix)
        save_upload(background, bg_path)
        video_path = None
        if video:
            suffix = Path(video.filename or "input.mp4").suffix.lower()
            if suffix not in {".mp4", ".mkv", ".mov", ".webm", ".m4v"}:
                raise HTTPException(status_code=400, detail="Formato de vídeo não suportado.")
            video_path = workdir / ("input" + suffix)
            save_upload(video, video_path)
        job_id = uuid.uuid4().hex
        with jobs_lock:
            jobs[job_id] = {
                "status": "queued", "progress": 0, "message": "Arquivos recebidos; aguardando renderização.",
                "created_at": time.time(), "workdir": str(workdir), "file_path": None,
            }
        background_tasks.add_task(run_render_job, job_id, str(workdir),
                                  None if video else youtube_url.strip(),
                                  str(video_path) if video_path else None, str(bg_path), render_params)
        return {"job_id": job_id, "status": "queued"}
    except Exception:
        shutil.rmtree(workdir, ignore_errors=True)
        raise


@app.get("/api/render/jobs/{job_id}")
@app.get("/api/youtube/jobs/{job_id}")
def get_render_job(job_id: str, request: Request):
    authorize(request)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Trabalho não encontrado ou expirado.")
        return public_job(job)


@app.get("/api/render/{job_id}/file")
def get_render_file(job_id: str, request: Request):
    authorize(request)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job or job.get("status") != "completed" or not job.get("file_path"):
            raise HTTPException(status_code=409, detail="O vídeo ainda não está pronto.")
        file_path = job["file_path"]
    return FileResponse(
        file_path, media_type="video/mp4", filename="manhwa-studio.mp4",
        headers={"Cache-Control": "no-store"},
        background=BackgroundTask(cleanup_job, job_id),
    )


@app.post("/api/youtube/jobs", status_code=410)
def legacy_youtube_download_disabled():
    raise HTTPException(status_code=410, detail="Use /api/render enviando o link do YouTube e a moldura no mesmo trabalho.")
