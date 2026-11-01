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
MAX_FILE_BYTES = 7 * 1024**3
render_slot = threading.BoundedSemaphore(1)

app = FastAPI(title="Manhwa Studio Colab CPU Renderer", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

def cleanup(folder: str):
    shutil.rmtree(folder, ignore_errors=True)
    render_slot.release()

@app.get("/health")
def health():
    return {
        "status": "ok",
        "renderer": "ffmpeg-cpu",
        "hardware_acceleration": False,
        "version": app.version,
    }

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

    folder = None
    handed_to_response = False
    try:
        if format not in ("16:9", "9:16"):
            raise HTTPException(400, "Formato inválido.")
        if resolution not in ("1080p", "4K"):
            raise HTTPException(400, "Resolução inválida.")

        folder = tempfile.mkdtemp(prefix="manhwa-render-")
        root = Path(folder)
        video_path = root / "input-video"
        bg_path = root / "background-image"
        output_path = root / "manhwa-studio-render.mp4"

        for upload, path, label in (
            (video, video_path, "vídeo"),
            (background, bg_path, "imagem de moldura"),
        ):
            total = 0
            with path.open("wb") as target:
                while True:
                    chunk = upload.file.read(4 * 1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_FILE_BYTES:
                        raise HTTPException(413, f"O arquivo de {label} excede 7 GB.")
                    target.write(chunk)
            if total == 0:
                raise HTTPException(400, f"O arquivo de {label} está vazio.")

        if format == "16:9":
            width, height = (3840, 2160) if resolution == "4K" else (1920, 1080)
        else:
            width, height = (2160, 3840) if resolution == "4K" else (1080, 1920)

        safe_w, safe_h = int(width * 0.84), int(height * 0.84)
        # FFmpeg crop/pad dimensions must be even for yuv420p.
        safe_w -= safe_w % 2
        safe_h -= safe_h % 2
        zoom_value = max(50.0, min(250.0, float(zoom))) / 100.0
        ox = max(-50.0, min(50.0, float(offset_x)))
        oy = max(-50.0, min(50.0, float(offset_y)))

        if crop_to_fill:
            fit_filter = (
                f"scale={safe_w}:{safe_h}:force_original_aspect_ratio=increase,"
                f"crop={safe_w}:{safe_h}"
            )
        else:
            fit_filter = (
                f"scale={safe_w}:{safe_h}:force_original_aspect_ratio=decrease,"
                f"pad={safe_w}:{safe_h}:(ow-iw)/2:(oh-ih)/2:black"
            )

        video_input = "[0:v]"
        watermark_filters = ""
        if hide_watermark:
            # The UI expresses the blur rectangle as percentages of the ORIGINAL
            # source video. Blur it before scaling/cropping so both render paths match.
            mx = max(0.0, min(99.0, float(mark_x)))
            my = max(0.0, min(99.0, float(mark_y)))
            mw = max(1.0, min(100.0 - mx, float(mark_w)))
            mh = max(1.0, min(100.0 - my, float(mark_h)))
            watermark_filters = (
                f"[0:v]split[video_original][video_to_blur];"
                f"[video_to_blur]crop="
                f"w='max(2,trunc(iw*{mw}/100/2)*2)':"
                f"h='max(2,trunc(ih*{mh}/100/2)*2)':"
                f"x='trunc(iw*{mx}/100/2)*2':"
                f"y='trunc(ih*{my}/100/2)*2',"
                f"boxblur=20:2[video_blurred];"
                f"[video_original][video_blurred]overlay="
                f"x='trunc(W*{mx}/100/2)*2':"
                f"y='trunc(H*{my}/100/2)*2'[source_video];"
            )
            video_input = "[source_video]"

        filters = (
            f"[1:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black[bg];"
            f"{watermark_filters}"
            f"{video_input}{fit_filter},"
            f"scale=trunc(iw*{zoom_value}/2)*2:trunc(ih*{zoom_value}/2)*2,"
            f"pad=max(iw,{safe_w}):max(ih,{safe_h}):(ow-iw)/2:(oh-ih)/2:black,"
            f"crop={safe_w}:{safe_h}:"
            f"x='(iw-ow)/2-{ox*safe_w/100}':"
            f"y='(ih-oh)/2-{oy*safe_h/100}'[fg];"
            f"[bg][fg]overlay=x='(W-w)/2':y='(H-h)/2':shortest=1[base]"
        )
        video_map = "[base]"

        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(video_path),
            "-loop", "1", "-i", str(bg_path),
            "-filter_complex", filters,
            "-map", video_map, "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
            "-pix_fmt", "yuv420p", "-threads", "0",
            "-c:a", "aac", "-b:a", "192k",
            "-map_metadata", "-1", "-map_chapters", "-1",
            "-movflags", "+faststart", "-shortest",
            str(output_path),
        ]
        proc = subprocess.run(
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True
        )
        if proc.returncode != 0 or not output_path.exists() or output_path.stat().st_size == 0:
            detail = proc.stderr[-3000:] if proc.stderr else "FFmpeg não gerou o arquivo."
            raise HTTPException(500, "Falha no FFmpeg: " + detail)

        response = FileResponse(
            output_path,
            media_type="video/mp4",
            filename="manhwa-studio-render.mp4",
            background=BackgroundTask(cleanup, folder),
        )
        handed_to_response = True
        return response
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Erro no renderizador: {exc}") from exc
    finally:
        if folder and not handed_to_response:
            shutil.rmtree(folder, ignore_errors=True)
        if not handed_to_response:
            render_slot.release()
