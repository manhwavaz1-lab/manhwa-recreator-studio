from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

APP_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ManhwaStudio" / "video-parts"
APP_DIR.mkdir(parents=True, exist_ok=True)
MAX_BYTES = 8 * 1024 * 1024 * 1024
MAX_DURATION = 25 * 60 * 60
PART_SECONDS = 30 * 60
MAX_PARTS = 50

app = FastAPI(title="Manhwa Studio Local Video Splitter")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://manhwa-panel-remix-studio.lovable.app", "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_origin_regex=r"https://.*\\.lovable\\.app",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

def run(command: list[str]) -> str:
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return result.stdout.strip()
    except FileNotFoundError:
        raise HTTPException(500, "FFmpeg/FFprobe não encontrado. Instale o FFmpeg e reinicie o serviço local.")
    except subprocess.CalledProcessError as exc:
        raise HTTPException(400, (exc.stderr or "Falha no processamento FFmpeg")[-2500:])

@app.get("/health")
def health():
    return {"ok": True, "service": "manhwa-local-splitter"}

@app.post("/api/split")
async def split_video(file: UploadFile = File(...)):
    name = Path(file.filename or "video.mp4").name
    job_id = uuid.uuid4().hex[:12]
    job_dir = APP_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=False)
    source = job_dir / name
    total = 0
    try:
        with source.open("wb") as target:
            while chunk := await file.read(8 * 1024 * 1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(413, "O vídeo ultrapassa o limite de 8 GB.")
                target.write(chunk)
        if total == 0:
            raise HTTPException(400, "O arquivo está vazio.")

        probe = run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(source)
        ])
        try:
            duration = float(probe)
        except ValueError:
            raise HTTPException(400, "Não foi possível identificar a duração do vídeo.")
        if duration <= 0 or duration > MAX_DURATION:
            raise HTTPException(400, "O vídeo deve ter duração entre 1 segundo e 25 horas.")
        count = int((duration + PART_SECONDS - 1) // PART_SECONDS)
        if count > MAX_PARTS:
            raise HTTPException(400, "Este vídeo exigiria mais de 50 partes.")

        output_pattern = str(job_dir / "parte_%03d.mp4")
        run([
            "ffmpeg", "-hide_banner", "-y", "-i", str(source),
            "-map", "0", "-c", "copy", "-f", "segment",
            "-segment_time", str(PART_SECONDS), "-reset_timestamps", "1",
            "-segment_format", "mp4", output_pattern
        ])
        parts = sorted(job_dir.glob("parte_*.mp4"))
        if not parts:
            raise HTTPException(500, "O FFmpeg não gerou nenhuma parte.")
        return {
            "job_id": job_id,
            "duration_seconds": duration,
            "parts": [{"name": p.name, "size": p.stat().st_size} for p in parts],
            "note": "Divisão por cópia de streams; os cortes podem variar alguns segundos conforme os keyframes do vídeo."
        }
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    finally:
        await file.close()

@app.get("/api/parts/{job_id}/{filename}")
def get_part(job_id: str, filename: str):
    if not job_id.isalnum() or not filename.startswith("parte_") or Path(filename).name != filename:
        raise HTTPException(400, "Arquivo inválido.")
    path = APP_DIR / job_id / filename
    if not path.is_file():
        raise HTTPException(404, "Parte não encontrada.")
    return FileResponse(path, media_type="video/mp4", filename=filename)
