"""FFmpeg renderer for Vast.ai: NVENC encode, CUDA/NVDEC decode when available, CPU fallback."""
import json
import math
import os
import re
import subprocess
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Callable


RESOLUTIONS = {
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "1440p": (2560, 1440),
    "4K": (3840, 2160),
}
FPS_VALUES = {"original": None, "24": 24, "30": 30, "50": 50, "60": 60}


@dataclass
class RenderParams:
    output_format: str = "16:9"
    resolution: str = "1080p"
    crop_to_fill: bool = True
    zoom: float = 100
    offset_x: float = 0
    offset_y: float = 0
    fps: str = "original"
    codec: str = "h264"
    encoder: str = "auto"
    quality: str = "balanced"

    @classmethod
    def from_json(cls, raw: str) -> "RenderParams":
        data = json.loads(raw or "{}")
        allowed = cls.__dataclass_fields__
        unknown = set(data) - set(allowed)
        if unknown:
            raise ValueError("Opções de renderização desconhecidas: " + ", ".join(sorted(unknown)))
        p = cls()
        for key, value in data.items():
            setattr(p, key, type(getattr(p, key))(value))
        if p.output_format not in {"16:9", "9:16"}:
            raise ValueError("Formato deve ser 16:9 ou 9:16.")
        if p.resolution not in RESOLUTIONS:
            raise ValueError("Resolução inválida.")
        if p.fps not in FPS_VALUES:
            raise ValueError("FPS inválido.")
        if p.codec not in {"h264", "h265"}:
            raise ValueError("Codec inválido.")
        if p.encoder not in {"auto", "nvenc", "cpu"}:
            raise ValueError("Motor de codificação inválido.")
        if p.quality not in {"speed", "balanced", "quality"}:
            raise ValueError("Perfil de qualidade inválido.")
        p.zoom = min(250, max(50, float(p.zoom)))
        p.offset_x = min(50, max(-50, float(p.offset_x)))
        p.offset_y = min(50, max(-50, float(p.offset_y)))
        return p


def even(value: float) -> int:
    return max(2, int(round(value / 2)) * 2)


def output_size(p: RenderParams) -> tuple[int, int]:
    width, height = RESOLUTIONS[p.resolution]
    return (height, width) if p.output_format == "9:16" else (width, height)


def probe(path: str) -> tuple[int, int, float, bool, str]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,width,height,avg_frame_rate:format=duration",
         "-of", "json", path],
        capture_output=True, text=True, check=True,
    )
    info = json.loads(result.stdout)
    video = next((stream for stream in info["streams"] if stream.get("codec_type") == "video"), None)
    if not video:
        raise RuntimeError("O arquivo não contém uma faixa de vídeo.")
    fps = video.get("avg_frame_rate", "30/1")
    return (
        int(video["width"]), int(video["height"]),
        float(info["format"].get("duration") or 0),
        any(stream.get("codec_type") == "audio" for stream in info["streams"]),
        fps,
    )


def build_filter(p: RenderParams, vw: int, vh: int) -> str:
    """Keep the preview framing math consistent with the browser UI."""
    width, height = output_size(p)
    safe_w, safe_h = width * 0.84, height * 0.84
    base = max(safe_w / vw, safe_h / vh) if p.crop_to_fill else min(safe_w / vw, safe_h / vh)
    scale = base * (p.zoom / 100)
    sw, sh = even(vw * scale), even(vh * scale)
    x = (width - sw) / 2 + (p.offset_x / 100) * safe_w * 0.5
    y = (height - sh) / 2 + (p.offset_y / 100) * safe_h * 0.5
    left, top = (width - safe_w) / 2, (height - safe_h) / 2
    cx0, cy0 = max(0.0, left - x), max(0.0, top - y)
    cx1, cy1 = min(sw, left + safe_w - x), min(sh, top + safe_h - y)
    cw, ch = even(max(2, cx1 - cx0)), even(max(2, cy1 - cy0))
    cx0, cy0 = min(int(cx0), sw - cw), min(int(cy0), sh - ch)

    parts = [
        f"[1:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p[bg]"
    ]
    source = "[0:v]"
    parts.append(f"{source}scale={sw}:{sh}:flags=bicubic,crop={cw}:{ch}:{cx0}:{cy0}[fg]")
    parts.append(f"[bg][fg]overlay={int(x + cx0)}:{int(y + cy0)}:shortest=1,format=yuv420p[out]")
    return ";".join(parts)


def cuda_filters_available() -> bool:
    try:
        result = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True, timeout=10)
        return result.returncode == 0 and "scale_cuda" in result.stdout and "overlay_cuda" in result.stdout
    except Exception:
        return False


def build_cuda_filter(p: RenderParams, vw: int, vh: int) -> str:
    """GPU composition: CUDA scale + CUDA overlay. No blur or CPU video filters."""
    width, height = output_size(p)
    safe_w, safe_h = width * 0.84, height * 0.84
    base = max(safe_w / vw, safe_h / vh) if p.crop_to_fill else min(safe_w / vw, safe_h / vh)
    scale = base * (p.zoom / 100)
    sw, sh = even(vw * scale), even(vh * scale)
    x = int((width - sw) / 2 + (p.offset_x / 100) * safe_w * 0.5)
    y = int((height - sh) / 2 + (p.offset_y / 100) * safe_h * 0.5)
    return (
        f"[1:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,format=nv12,hwupload_cuda[bg];"
        f"[0:v]scale_cuda={sw}:{sh}:format=nv12[fg];"
        f"[bg][fg]overlay_cuda={x}:{y}[out]"
    )


@lru_cache(maxsize=16)
def nvenc_available(codec: str = "h264", gpu_index: int = 0) -> bool:
    encoder = "hevc_nvenc" if codec == "h265" else "h264_nvenc"
    try:
        test = subprocess.run(
            ["ffmpeg", "-hide_banner", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.1",
             "-frames:v", "1", "-c:v", encoder, "-gpu", str(gpu_index), "-f", "null", "-"],
            capture_output=True, timeout=30,
        )
        return test.returncode == 0
    except Exception:
        return False


def list_nvidia_gpus() -> list[dict]:
    """Return each visible NVIDIA GPU; VRAM is never treated as pooled memory."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=index,name,memory.total,memory.used,utilization.gpu,driver_version",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=True,
        )
        devices = []
        for line in result.stdout.splitlines():
            parts = [part.strip() for part in line.split(",")]
            if len(parts) < 6:
                continue
            devices.append({
                "index": int(parts[0]), "name": parts[1],
                "memory_total_mb": int(parts[2]), "memory_used_mb": int(parts[3]),
                "utilization_percent": int(parts[4]), "driver": parts[5],
            })
        return devices
    except Exception:
        return []


def select_nvenc_gpu(codec: str) -> int | None:
    """Prefer the least busy GPU with a working encoder for the requested codec."""
    devices = list_nvidia_gpus()
    candidates = [gpu for gpu in devices if nvenc_available(codec, gpu["index"])]
    if not candidates:
        return None
    candidates.sort(key=lambda gpu: (
        gpu["utilization_percent"],
        gpu["memory_used_mb"] / max(1, gpu["memory_total_mb"]),
    ))
    return candidates[0]["index"]


@lru_cache(maxsize=1)
def nvdec_available() -> bool:
    try:
        hw = subprocess.run(["ffmpeg", "-hide_banner", "-hwaccels"], capture_output=True, text=True, timeout=10)
        dec = subprocess.run(["ffmpeg", "-hide_banner", "-decoders"], capture_output=True, text=True, timeout=10)
        return hw.returncode == 0 and "cuda" in hw.stdout.lower() and (
            "h264_cuvid" in dec.stdout or "hevc_cuvid" in dec.stdout
        )
    except Exception:
        return False


def encoder_args(p: RenderParams, use_nvenc: bool, gpu_index: int = 0) -> list[str]:
    bitrate = {"720p": "5M", "1080p": "12M", "1440p": "20M", "4K": "40M"}[p.resolution]
    if use_nvenc:
        encoder = "hevc_nvenc" if p.codec == "h265" else "h264_nvenc"
        preset, cq = {
            "speed": ("p2", "25"),
            "balanced": ("p5", "20"),
            "quality": ("p7", "17"),
        }[p.quality]
        return ["-c:v", encoder, "-gpu", str(gpu_index), "-preset", preset, "-tune", "hq", "-rc", "vbr",
                "-cq", cq, "-b:v", bitrate, "-maxrate", bitrate, "-bufsize", bitrate]
    preset, crf = {
        "speed": ("veryfast", "23"),
        "balanced": ("medium", "20"),
        "quality": ("slow", "18"),
    }[p.quality]
    encoder = "libx265" if p.codec == "h265" else "libx264"
    return ["-c:v", encoder, "-preset", preset, "-crf", crf, "-threads", str(max(1, int(os.getenv("RENDER_THREADS", os.cpu_count() or 8))))]


def render(video: str, background: str, output: str, p: RenderParams,
           on_progress: Callable[[int, dict], None]) -> str:
    vw, vh, duration, has_audio, source_fps = probe(video)
    graph = build_filter(p, vw, vh)
    threads = str(max(1, int(os.getenv("RENDER_THREADS", os.cpu_count() or 8))))
    Path(output).parent.mkdir(parents=True, exist_ok=True)

    selected_gpu = select_nvenc_gpu(p.codec) if p.encoder in {"auto", "nvenc"} else None
    if p.encoder == "nvenc" and selected_gpu is None:
        raise RuntimeError("Nenhuma das GPUs NVIDIA disponibiliza NVENC para o codec selecionado.")
    use_nvenc_first = p.encoder in {"auto", "nvenc"} and selected_gpu is not None
    use_nvdec_first = nvdec_available() and cuda_filters_available()
    started = time.monotonic()

    def run(use_nvdec: bool, use_nvenc: bool) -> int:
        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-nostats",
               "-progress", "pipe:1", "-filter_threads", threads, "-filter_complex_threads", threads]
        if use_nvdec:
            cmd += ["-hwaccel", "cuda", "-hwaccel_device", str(selected_gpu or 0)]
        active_graph = build_cuda_filter(p, vw, vh) if use_nvdec else graph
        cmd += ["-i", video, "-loop", "1", "-i", background, "-filter_complex", active_graph,
                "-map", "[out]"]
        if has_audio:
            cmd += ["-map", "0:a:0", "-c:a", "aac", "-b:a", "192k"]
        cmd += encoder_args(p, use_nvenc, selected_gpu or 0)
        target_fps = FPS_VALUES[p.fps]
        if target_fps:
            cmd += ["-r", str(target_fps), "-fps_mode", "cfr"]
        cmd += ["-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1",
                "-movflags", "+faststart", "-t", f"{duration:.3f}", output]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        assert proc.stdout
        last_stats = {}
        for line in proc.stdout:
            match = re.match(r"out_time_us=(\d+)", line)
            if match and duration > 0:
                encoded = int(match.group(1)) / 1_000_000
                pct = min(99, math.floor(encoded / duration * 100))
                elapsed = time.monotonic() - started
                remaining = max(0, elapsed * (duration / max(encoded, 0.01) - 1)) if encoded > 0 else 0
                last_stats = {"elapsed_seconds": round(elapsed), "eta_seconds": round(remaining)}
                on_progress(pct, last_stats)
            elif line.startswith("speed="):
                last_stats["speed"] = line.split("=", 1)[1].strip()
        stderr = proc.stderr.read() if proc.stderr else ""
        code = proc.wait()
        if code != 0:
            raise RuntimeError(stderr[-1200:] or "FFmpeg terminou com erro.")
        return code

    if p.encoder == "cpu":
        run(False, False)
        return "CPU"

    if use_nvenc_first:
        try:
            run(use_nvdec_first, True)
            return f"NVENC GPU {selected_gpu}" + (" + NVDEC + CUDA scale/overlay" if use_nvdec_first else " (CPU filters + NVENC)")
        except Exception as exc:
            if p.encoder == "nvenc":
                raise
            if Path(output).exists():
                Path(output).unlink()
            gpu_error = str(exc)
    else:
        gpu_error = "NVENC indisponível; usando CPU."

    try:
        run(False, False)
        return "CPU fallback (" + gpu_error[:120] + ")"
    except Exception as exc:
        raise RuntimeError("Falha na renderização GPU e CPU: " + str(exc)) from exc
