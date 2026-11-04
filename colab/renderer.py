#!/usr/bin/env python3
"""Manhwa Studio Colab renderer: local FFmpeg processing with Google Drive I/O."""
import argparse, json, shutil, subprocess, sys
from pathlib import Path

def run(cmd):
    print("+", " ".join(map(str, cmd)), flush=True)
    subprocess.run(cmd, check=True)

def has_encoder(name):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True)
    return name in p.stdout

def choose_encoder(requested="auto"):
    choices = {"nvenc": "h264_nvenc", "qsv": "h264_qsv", "amf": "h264_amf", "cpu": "libx264"}
    if requested != "auto":
        enc = choices[requested]
        if enc != "libx264" and not has_encoder(enc):
            print(f"Encoder {enc} indisponível; usando libx264.")
            return "libx264"
        return enc
    # Colab GPU commonly exposes NVENC; otherwise software encoding is reliable.
    for enc in ("h264_nvenc", "h264_qsv", "h264_amf"):
        if has_encoder(enc):
            return enc
    return "libx264"

def download_youtube(url, folder):
    run([sys.executable, "-m", "pip", "install", "-q", "yt-dlp"])
    out = str(folder / "youtube_source.%(ext)s")
    run([sys.executable, "-m", "yt_dlp", "-f", "bv*+ba/b", "--merge-output-format", "mp4", "-o", out, url])
    candidates = sorted(folder.glob("youtube_source.*"), key=lambda p:p.stat().st_mtime, reverse=True)
    if not candidates: raise RuntimeError("yt-dlp não gerou arquivo.")
    return candidates[0]

def render(args):
    video = Path(args.video).expanduser().resolve()
    frame = Path(args.frame).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    if not video.is_file() or not frame.is_file(): raise FileNotFoundError("Vídeo ou moldura não encontrado.")
    output.parent.mkdir(parents=True, exist_ok=True)
    base_w, base_h = (1920,1080) if args.format == "16:9" else (1080,1920)
    factor = 2 if args.resolution == "4K" else 1
    W, H = base_w * factor, base_h * factor
    fps = args.fps
    # Optional blur patch in source-video coordinates, expressed as percentages.
    vf = "[0:v]setpts=PTS-STARTPTS[v0];"
    if args.blur:
        x,y,w,h = [float(v) for v in args.blur.split(",")]
        vf += f"[v0]split[orig][patch];[patch]crop=w='max(2,iw*{w}/100)':h='max(2,ih*{h}/100)':x='iw*{x}/100':y='ih*{y}/100',boxblur=18:2[blur];[orig][blur]overlay=x='W*{x}/100':y='H*{y}/100'[clean];"
        source = "[clean]"
    else:
        source = "[v0]"
    safe_w, safe_h = (int(W*.84)//2)*2, (int(H*.84)//2)*2  # dimensoes pares exigidas por H.264/yuv420p
    zoom = max(.5, min(2.5, args.zoom/100))
    # Scale to fit/fill the inner window, then center with configurable offsets.
    mode = "increase" if args.crop else "decrease"
    vf += f"{source}scale={int(safe_w*zoom)}:{int(safe_h*zoom)}:force_original_aspect_ratio={mode},"
    if args.crop:
        vf += f"crop={safe_w}:{safe_h},"
    else:
        vf += f"pad={safe_w}:{safe_h}:(ow-iw)/2:(oh-ih)/2:color=black,"
    vf += f"setsar=1,fps={fps}[content];"
    vf += f"[1:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black[bg];"
    ox=int((args.offset_x/100)*safe_w*.5); oy=int((args.offset_y/100)*safe_h*.5)
    vf += f"[bg][content]overlay=x=(W-w)/2+{ox}:y=(H-h)/2+{oy}:shortest=1[outv]"
    enc = choose_encoder(args.encoder)
    cmd=["ffmpeg","-y","-hide_banner","-i",str(video),"-loop","1","-i",str(frame),
         "-filter_complex",vf,"-map","[outv]","-map","0:a?","-c:v",enc]
    if enc=="libx264": cmd += ["-preset","veryfast","-crf",str(args.crf)]
    elif enc=="h264_nvenc": cmd += ["-preset","p4","-cq",str(args.crf)]
    elif enc=="h264_qsv": cmd += ["-preset","veryfast","-global_quality",str(args.crf)]
    elif enc=="h264_amf": cmd += ["-quality","speed","-qp_i",str(args.crf),"-qp_p",str(args.crf)]
    cmd += ["-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-movflags","+faststart","-shortest",str(output)]
    print("Testando encoder:", enc, flush=True)
    print(f"Dimensoes finais: {W}x{H}; area do video: {safe_w}x{safe_h}", flush=True)
    try:
        run(cmd)
    except subprocess.CalledProcessError:
        if enc == "libx264":
            raise
        print(f"Encoder {enc} falhou neste runtime. Repetindo com CPU (libx264)...", flush=True)
        # Rebuild only the encoder-specific output options for a reliable CPU fallback.
        fallback = ["ffmpeg","-y","-hide_banner","-i",str(video),"-loop","1","-i",str(frame),
                    "-filter_complex",vf,"-map","[outv]","-map","0:a?","-c:v","libx264",
                    "-preset","veryfast","-crf",str(args.crf),"-pix_fmt","yuv420p",
                    "-c:a","aac","-b:a","192k","-movflags","+faststart","-shortest",str(output)]
        run(fallback)
    if not output.exists() or output.stat().st_size < 1024:
        raise RuntimeError("FFmpeg terminou sem produzir um MP4 valido.")
    probe = subprocess.run(["ffprobe","-v","error","-show_entries","format=duration,size","-of","default=noprint_wrappers=1",str(output)],capture_output=True,text=True)
    if probe.returncode != 0:
        raise RuntimeError("O arquivo gerado nao passou na verificacao ffprobe: " + probe.stderr)
    print("Verificacao do MP4:", probe.stdout.strip(), flush=True)
    print("ARQUIVO PRONTO:", output)
    return output

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--video", required=True); p.add_argument("--frame", required=True); p.add_argument("--output", required=True)
    p.add_argument("--format", choices=["16:9","9:16"], default="16:9"); p.add_argument("--resolution", choices=["1080p","4K"], default="1080p")
    p.add_argument("--fps", type=int, default=30); p.add_argument("--encoder", choices=["auto","nvenc","qsv","amf","cpu"], default="auto")
    p.add_argument("--crf", type=int, default=23); p.add_argument("--crop", action="store_true")
    p.add_argument("--zoom", type=float, default=100); p.add_argument("--offset-x", type=float, default=0); p.add_argument("--offset-y", type=float, default=0)
    p.add_argument("--blur", help="x,y,w,h em porcentagem do vídeo original; ex.: 80,85,15,8")
    args=p.parse_args(); render(args)

if __name__=="__main__": main()
