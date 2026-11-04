import os, re, io, subprocess, shutil, tempfile
from pathlib import Path
import gradio as gr
from PIL import Image

DRIVE = Path("/content/drive/MyDrive/ManhwaStudio")
INPUT = DRIVE / "entrada"
OUTPUT = DRIVE / "exportados"
INPUT.mkdir(parents=True, exist_ok=True)
OUTPUT.mkdir(parents=True, exist_ok=True)
ROOT = Path("/content/manhwa-recreator-studio")

def get_drive_file(url, target):
    from google.colab import auth
    auth.authenticate_user()
    import google.auth
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
    m = re.search(r"(?:/d/|[?&]id=)([A-Za-z0-9_-]{10,})", url.strip())
    if not m:
        raise gr.Error("Link inválido. Use o link de compartilhamento do Google Drive.")
    creds, _ = google.auth.default()
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    meta = service.files().get(fileId=m.group(1), fields="name,mimeType").execute()
    req = service.files().get_media(fileId=m.group(1))
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, req, chunksize=8*1024*1024)
    done = False
    while not done:
        status, done = dl.next_chunk()
    suffix = Path(meta["name"]).suffix.lower()
    allowed = {".mp4",".mov",".mkv",".webm",".m4v",".avi"} if meta["mimeType"].startswith("video/") else {".png",".jpg",".jpeg",".webp"}
    if suffix not in allowed:
        raise gr.Error("Formato não suportado: " + suffix)
    dest = target / ("video_origem" + suffix if meta["mimeType"].startswith("video/") else "moldura" + suffix)
    dest.write_bytes(buf.getvalue())
    return str(dest), meta["name"]

def link_video(url):
    p, name = get_drive_file(url, INPUT)
    return p, "Vídeo vinculado: " + name, p

def link_frame(url):
    p, name = get_drive_file(url, INPUT)
    return p, "Moldura vinculada: " + name, p

def render(video, frame, fmt, resolution, encoder, zoom, x, y, crop, blur, progress=gr.Progress()):
    if not video or not frame:
        raise gr.Error("Vincule o vídeo e a moldura antes de renderizar.")
    out = OUTPUT / (Path(video).stem + "_manhwa_studio.mp4")
    cmd = ["python", str(ROOT/"colab/renderer.py"), "--video", str(video), "--frame", str(frame),
           "--output", str(out), "--format", fmt, "--resolution", resolution, "--encoder", encoder,
           "--zoom", str(zoom), "--offset-x", str(x), "--offset-y", str(y), "--fps", "30"]
    if crop:
        cmd.append("--crop")
    if blur:
        cmd += ["--blur", "80,85,15,8"]
    progress(0.15, desc="Preparando FFmpeg")
    proc = subprocess.run(cmd, cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    progress(0.95, desc="Validando MP4")
    if proc.returncode != 0 or not out.exists() or out.stat().st_size < 1024:
        raise gr.Error("Falha no render. Log FFmpeg:\n" + proc.stdout[-7000:])
    probe = subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(out)],capture_output=True,text=True)
    if probe.returncode:
        raise gr.Error("MP4 inválido:\n" + probe.stderr)
    progress(1, desc="Concluído")
    return str(out), str(out), "Render concluído e salvo no Google Drive: " + str(out) + "\nDuração: " + probe.stdout.strip() + " s"

css = """
.gradio-container {background:#090b10!important;color:#f5f5f5!important}
#hero {background:linear-gradient(120deg,#11151d,#260d13);border:1px solid #3b2028;border-radius:18px;padding:24px}
#hero h1 {color:#fff;letter-spacing:3px}
button.primary {background:#e52e45!important;border-color:#e52e45!important}
"""

with gr.Blocks(title="Manhwa Studio", theme=gr.themes.Base(primary_hue="rose", neutral_hue="slate"), css=css) as demo:
    gr.HTML("<div id='hero'><h1>MANHWA STUDIO</h1><b style='color:#f05265'>VIDEO FRAME CREATOR · GOOGLE DRIVE + NVIDIA T4</b><p>Vincule seus arquivos, confira as prévias e exporte seu MP4.</p></div>")
    with gr.Row():
        with gr.Column(scale=1):
            gr.Markdown("### 01 · Arquivos do Google Drive")
            video_url = gr.Textbox(label="Link compartilhável do vídeo", placeholder="https://drive.google.com/file/d/...")
            btn_v = gr.Button("VINCULAR VÍDEO", variant="primary")
            video_status = gr.Markdown("Nenhum vídeo vinculado")
            video_path = gr.State()
            video_preview = gr.Video(label="Prévia do vídeo original")
            frame_url = gr.Textbox(label="Link compartilhável da moldura (PNG/JPG/WEBP)", placeholder="https://drive.google.com/file/d/...")
            btn_f = gr.Button("VINCULAR MOLDURA", variant="primary")
            frame_status = gr.Markdown("Nenhuma moldura vinculada")
            frame_path = gr.State()
            frame_preview = gr.Image(label="Prévia da moldura", type="filepath")
        with gr.Column(scale=1):
            gr.Markdown("### 02 · Configuração do vídeo")
            fmt = gr.Radio(["16:9","9:16"], value="16:9", label="Formato")
            resolution = gr.Radio(["1080p","4K"], value="1080p", label="Resolução")
            encoder = gr.Dropdown(["auto","nvenc","cpu"], value="auto", label="Encoder (T4: NVENC automático)")
            zoom = gr.Slider(50,250,value=100,step=1,label="Zoom (%)")
            x = gr.Slider(-50,50,value=0,step=1,label="Posição horizontal")
            y = gr.Slider(-50,50,value=0,step=1,label="Posição vertical")
            crop = gr.Checkbox(value=True,label="Recortar para preencher a área interna")
            blur = gr.Checkbox(value=False,label="Aplicar desfoque na área configurada (marca própria)")
            gr.Markdown("### 03 · Exportação")
            render_btn = gr.Button("RENDERIZAR VÍDEO", variant="primary", size="lg")
            result = gr.Video(label="Prévia do MP4 renderizado")
            download = gr.File(label="Baixar MP4")
            status = gr.Textbox(label="Log / status", lines=8)
    btn_v.click(link_video, inputs=video_url, outputs=[video_path,video_status,video_preview])
    btn_f.click(link_frame, inputs=frame_url, outputs=[frame_path,frame_status,frame_preview])
    render_btn.click(render, inputs=[video_path,frame_path,fmt,resolution,encoder,zoom,x,y,crop,blur], outputs=[result,download,status])

if __name__ == "__main__":
    demo.queue().launch(share=True, debug=True)
