import os
import secrets
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

TOKEN = os.environ.get("MANHWA_RENDER_TOKEN", "")
MAX_BYTES = 7 * 1024**3
app = FastAPI(title="Manhwa Studio Colab CPU Renderer", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
render_slot = threading.BoundedSemaphore(1)

def cleanup(folder: str):
    shutil.rmtree(folder, ignore_errors=True)
    render_slot.release()

@app.get("/health")
def health():
    return {"status": "ok", "renderer": "ffmpeg-cpu", "hardware_acceleration": False}

@app.post("/render")
def render(
    video: UploadFile = File(...),
    background: UploadFile = File(...),
    format: str = Form("16:9"),
    resolution: str = Form("1080p"),
    zoom: float = Form(100),
    offset_x: float = Form(0),
    offset_y: float = Form(0),
    crop_to_fill: bool = Form(True),
    hide_watermark: bool = Form(False),
    mark_x: float = Form(80),
    mark_y: float = Form(85),
    mark_w: float = Form(15),
    mark_h: float = Form(8),
    x_render_token: str = Header(default="", alias="X-Render-Token"),
):
    if not TOKEN or not secrets.compare_digest(x_render_token, TOKEN):
        raise HTTPException(401, "Token de renderização inválido.")
    if not render_slot.acquire(blocking=False):
        raise HTTPException(429, "O Colab já está renderizando outro vídeo.")
    folder = tempfile.mkdtemp(prefix="manhwa-render-")
    try:
        root = Path(folder)
        video_path, bg_path, output_path = root / "input-video", root / "background-image", root / "render.mp4"
        for upload, path in ((video, video_path), (background, bg_path)):
            total = 0
            with path.open("wb") as target:
                while True:
                    chunk = upload.file.read(8 * 1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_BYTES:
                        raise HTTPException(413, "Arquivo excede o limite de 7 GB.")
                    target.write(chunk)
        if format not in ("16:9", "9:16") or resolution not in ("1080p", "4K"):
            raise HTTPException(400, "Formato ou resolução inválidos.")
        width, height = ((3840, 2160) if resolution == "4K" else (1920, 1080)) if format == "16:9" else ((2160, 3840) if resolution == "4K" else (1080, 1920))
        safe_w, safe_h = int(width * .84), int(height * .84)
        zoom = max(.5, min(2.5, zoom / 100))
        ox, oy = max(-50, min(50, offset_x)), max(-50, min(50, offset_y))
        fit_filter = (
            f"scale={safe_w}:{safe_h}:force_original_aspect_ratio=increase,crop={safe_w}:{safe_h}"
            if crop_to_fill else
            f"scale={safe_w}:{safe_h}:force_original_aspect_ratio=decrease,pad={safe_w}:{safe_h}:(ow-iw)/2:(oh-ih)/2:black"
        )
        # Zoom and offsets are clipped to the frame's inner viewport. The outer
        # artwork remains visible and is never cropped.
        filters = (
            f"[1:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black[bg];"
            f"[0:v]{fit_filter},"
            f"scale=trunc(iw*{zoom}/2)*2:trunc(ih*{zoom}/2)*2,"
            f"pad=max(iw,{safe_w}):max(ih,{safe_h}):(ow-iw)/2:(oh-ih)/2:black,"
            f"crop={safe_w}:{safe_h}:x='(iw-ow)/2-{ox*safe_w/100}':y='(ih-oh)/2-{oy*safe_h/100}'[fg];"
            f"[bg][fg]overlay=x='(W-w)/2':y='(H-h)/2':shortest=1[base]"
        )
        vmap = "[base]"
        if hide_watermark:
            # Blur a user-selected percentage rectangle in the final output.
            mx, my = max(0, min(99, mark_x)), max(0, min(99, mark_y))
            mw, mh = max(1, min(100-mx, mark_w)), max(1, min(100-my, mark_h))
            # Coordinates are mapped to the centered video viewport; safe even if the
            # user rectangle partly falls outside it.
            x1, y1 = int(width*.08 + safe_w*mx/100), int(height*.08 + safe_h*my/100)
            x2, y2 = max(x1+2, int(x1 + safe_w*mw/100)), max(y1+2, int(y1 + safe_h*mh/100))
            filters += f";[base]split[orig][tmp];[tmp]boxblur=18:2[blur];[orig][blur]blend=all_expr='if(between(X,{x1},{x2})*between(Y,{y1},{y2}),B,A)'[vout]"
            vmap = "[vout]"
        command = [
            "ffmpeg", "-hide_banner", "-y", "-i", str(video_path), "-loop", "1", "-i", str(bg_path),
            "-filter_complex", filters, "-map", vmap, "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-map_metadata", "-1", "-map_chapters", "-1",
            "-movflags", "+faststart", "-shortest", str(output_path),
        ]
        proc = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if proc.returncode:
            raise HTTPException(500, "FFmpeg falhou: " + proc.stderr[-2500:])
        return FileResponse(
            output_path, media_type="video/mp4", filename="manhwa-studio-render.mp4",
            background=BackgroundTask(cleanup, folder),
        )
    except Exception:
        cleanup(folder)
        raise
