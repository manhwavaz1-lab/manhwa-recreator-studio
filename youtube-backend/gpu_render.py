"""Server-side composition with FFmpeg + NVIDIA NVENC (falls back to multi-thread CPU)."""
import json
import math
import os
import re
import subprocess
from dataclasses import dataclass
from functools import lru_cache


@dataclass
class RenderParams:
    output_format: str = "16:9"
    resolution: str = "1080p"
    crop_to_fill: bool = True
    zoom: float = 100
    offset_x: float = 0
    offset_y: float = 0
    hide_watermark: bool = False
    mark_x: float = 80
    mark_y: float = 85
    mark_w: float = 15
    mark_h: float = 8

    @classmethod
    def from_json(cls, raw: str) -> "RenderParams":
        data = json.loads(raw or "{}")
        p = cls()
        for key in p.__dataclass_fields__:
            if key in data:
                setattr(p, key, type(getattr(p, key))(data[key]))
        return p


def even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


def output_size(p: RenderParams) -> tuple[int, int]:
    big = p.resolution == "4K"
    if p.output_format == "9:16":
        return (2160, 3840) if big else (1080, 1920)
    return (3840, 2160) if big else (1920, 1080)


def probe(path: str) -> tuple[int, int, float, bool]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", path],
        capture_output=True, text=True, check=True,
    ).stdout
    info = json.loads(out)
    video = next(s for s in info["streams"] if s.get("codec_type") == "video")
    has_audio = any(s.get("codec_type") == "audio" for s in info["streams"])
    return int(video["width"]), int(video["height"]), float(info["format"].get("duration") or 0), has_audio


def build_filter(p: RenderParams, vw: int, vh: int) -> str:
    """Mirror of the browser canvas math so local preview and GPU export match."""
    W, H = output_size(p)
    safe_w, safe_h = W * 0.84, H * 0.84
    base = max(safe_w / vw, safe_h / vh) if p.crop_to_fill else min(safe_w / vw, safe_h / vh)
    scale = base * (p.zoom / 100)
    sw, sh = even(vw * scale), even(vh * scale)
    x = (W - sw) / 2 + (p.offset_x / 100) * safe_w * 0.5
    y = (H - sh) / 2 + (p.offset_y / 100) * safe_h * 0.5
    left, top = (W - safe_w) / 2, (H - safe_h) / 2
    cx0, cy0 = max(0.0, left - x), max(0.0, top - y)
    cx1, cy1 = min(sw, left + safe_w - x), min(sh, top + safe_h - y)
    cw, ch = even(max(2, cx1 - cx0)), even(max(2, cy1 - cy0))
    cx0, cy0 = min(int(cx0), sw - cw), min(int(cy0), sh - ch)

    parts = [f"[1:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p[bg]"]
    src = "[0:v]"
    if p.hide_watermark:
        mx = min(99, max(0, p.mark_x)); my = min(99, max(0, p.mark_y))
        mw = min(100 - mx, max(1, p.mark_w)); mh = min(100 - my, max(1, p.mark_h))
        bx, by = int(vw * mx / 100), int(vh * my / 100)
        bw, bh = even(vw * mw / 100), even(vh * mh / 100)
        bw, bh = min(bw, vw - bx), min(bh, vh - by)
        parts.append(f"[0:v]split[vmain][vmark];[vmark]crop={bw}:{bh}:{bx}:{by},gblur=sigma=14[blur];[vmain][blur]overlay={bx}:{by}[vclean]")
        src = "[vclean]"
    parts.append(f"{src}scale={sw}:{sh}:flags=bicubic,crop={cw}:{ch}:{cx0}:{cy0}[fg]")
    parts.append(f"[bg][fg]overlay={int(x + cx0)}:{int(y + cy0)}:shortest=1,format=yuv420p[out]")
    return ";".join(parts)


@lru_cache(maxsize=1)
def nvenc_available() -> bool:
    try:
        r = subprocess.run(
            ["ffmpeg", "-hide_banner", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.1", "-c:v", "h264_nvenc", "-f", "null", "-"],
            capture_output=True, timeout=30,
        )
        return r.returncode == 0
    except Exception:
        return False


def encoder_args(p: RenderParams, gpu: bool) -> list[str]:
    bitrate = "40M" if p.resolution == "4K" else "14M"
    if gpu:
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", "19",
                "-b:v", bitrate, "-maxrate", bitrate, "-bufsize", bitrate, "-profile:v", "high"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-threads", "0"]


def render(video: str, background: str, output: str, p: RenderParams, on_progress) -> str:
    vw, vh, duration, has_audio = probe(video)
    graph = build_filter(p, vw, vh)
    threads = str(os.cpu_count() or 8)

    def run(gpu: bool) -> int:
        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1",
               "-filter_threads", threads, "-filter_complex_threads", threads]
        if gpu:
            cmd += ["-hwaccel", "cuda"]
        cmd += ["-i", video, "-loop", "1", "-i", background, "-filter_complex", graph, "-map", "[out]"]
        if has_audio:
            cmd += ["-map", "0:a:0", "-c:a", "aac", "-b:a", "192k"]
        cmd += encoder_args(p, gpu) + ["-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", "-t", f"{duration:.3f}", output]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        assert proc.stdout
        for line in proc.stdout:
            m = re.match(r"out_time_us=(\d+)", line)
            if m and duration > 0:
                on_progress(min(99, math.floor(int(m.group(1)) / 1e6 / duration * 100)))
        return proc.wait()

    if nvenc_available() and run(True) == 0:
        return "GPU NVENC"
    if run(False) == 0:
        return "CPU"
    raise RuntimeError("O FFmpeg não conseguiu renderizar este vídeo.")
