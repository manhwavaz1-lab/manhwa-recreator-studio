import json, os, shutil, subprocess, threading, time, uuid
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, BackgroundTasks, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

app=FastAPI(title="Manhwa Studio Colab T4",version="1.0.0")
app.add_middleware(CORSMiddleware,allow_origins=["*"],allow_credentials=False,allow_methods=["*"],allow_headers=["*"])
TOKEN=os.getenv("MANHWA_RENDER_TOKEN","")
ROOT=Path("/content/manhwa-render-jobs"); ROOT.mkdir(parents=True,exist_ok=True)
JOBS={}; LOCK=threading.Lock()
def auth(value):
    if TOKEN and value!=TOKEN: raise HTTPException(401,"Token inválido.")
def update(j,**kw):
    with LOCK:
        if j in JOBS: JOBS[j].update(kw)
def even(v): return max(2,int(round(float(v)/2)*2))
def render(j,video,frame,cfg,folder):
    out=str(Path(folder)/"result.mp4")
    try:
        update(j,status="processing",progress=3,message="Verificando vídeo e GPU")
        W,H=(1920,1080) if cfg["format"]=="16:9" else (1080,1920)
        if cfg["resolution"]=="4K": W,H=W*2,H*2
        z=max(.5,min(2.5,float(cfg.get("zoom",100))/100))
        ox=float(cfg.get("offsetX",0))/100*W*.42; oy=float(cfg.get("offsetY",0))/100*H*.42
        fill=bool(cfg.get("cropToFill",True))
        if fill:
            transform=f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}"
        else:
            transform=f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2"
        base=f"[0:v]{transform},scale=trunc(iw*{z}/2)*2:trunc(ih*{z}/2)*2,crop={W}:{H}:x='(iw-{W})/2-{ox}':y='(ih-{H})/2-{oy}',setsar=1[base]"
        if cfg.get("hideWatermark"):
            x=min(even(W*max(0,min(99,float(cfg.get("markX",80))))/100),W-2)
            y=min(even(H*max(0,min(99,float(cfg.get("markY",85))))/100),H-2)
            bw=min(max(2,even(W*float(cfg.get("markW",15))/100)),W-x)
            bh=min(max(2,even(H*float(cfg.get("markH",8))/100)),H-y)
            base=f"[0:v]{transform},scale=trunc(iw*{z}/2)*2:trunc(ih*{z}/2)*2,crop={W}:{H}:x='(iw-{W})/2-{ox}':y='(ih-{H})/2-{oy}',split[clean][src];[src]crop={bw}:{bh}:{x}:{y},boxblur=18:2[blur];[clean][blur]overlay={x}:{y},setsar=1[base]"
        graph=base+f";[1:v]scale={W}:{H}:force_original_aspect_ratio=decrease[frame];[base][frame]overlay=(W-w)/2:(H-h)/2[out]"
        cmd=["ffmpeg","-y","-i",video,"-i",frame,"-filter_complex",graph,"-map","[out]","-map","0:a?"]
        enc=subprocess.run(["ffmpeg","-hide_banner","-encoders"],capture_output=True,text=True).stdout
        if "h264_nvenc" in enc:
            cmd+=["-c:v","h264_nvenc","-preset","p5","-rc","vbr","-cq","20","-b:v","0"]
            gpu="NVIDIA T4 / NVENC"
        else:
            cmd+=["-c:v","libx264","-preset","veryfast","-crf","20"]; gpu="CPU fallback (NVENC indisponível)"
        cmd+=["-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-map_metadata","-1","-map_chapters","-1","-metadata","title=","-metadata","comment=","-metadata","creation_time=","-movflags","+faststart",out]
        update(j,progress=8,gpu=gpu,message="Renderizando com "+gpu)
        proc=subprocess.Popen(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True)
        while proc.poll() is None:
            with LOCK: p=JOBS.get(j,{}).get("progress",8)
            update(j,progress=min(94,p+1),message="FFmpeg processando na sessão Colab")
            time.sleep(3)
        err=proc.stderr.read() if proc.stderr else ""
        if proc.returncode: raise RuntimeError(err[-1800:] or "Erro no FFmpeg.")
        update(j,status="completed",progress=100,message="Renderização concluída",gpu=gpu,file_path=out)
    except Exception as e: update(j,status="error",message=str(e)[:2000],progress=0)
    finally:
        for p in (video,frame):
            try: Path(p).unlink(missing_ok=True)
            except Exception: pass
@app.get("/health")
def health(x_render_token:Optional[str]=Header(default=None)):
    auth(x_render_token)
    name=subprocess.run(["bash","-lc","nvidia-smi --query-gpu=name --format=csv,noheader | head -1"],capture_output=True,text=True).stdout.strip()
    return {"status":"ok","gpu":name or "GPU não detectada"}
@app.post("/api/render/jobs",status_code=202)
async def create(background_tasks:BackgroundTasks,video:UploadFile=File(...),frame:UploadFile=File(...),config:str=Form(...),x_render_token:Optional[str]=Header(default=None)):
    auth(x_render_token)
    try: cfg=json.loads(config)
    except Exception: raise HTTPException(400,"Configuração inválida.")
    if cfg.get("format") not in ("16:9","9:16") or cfg.get("resolution") not in ("1080p","4K"): raise HTTPException(400,"Formato/resolução inválidos.")
    j=uuid.uuid4().hex; folder=ROOT/j; folder.mkdir(parents=True)
    vp=folder/("input"+(Path(video.filename or "video.mp4").suffix or ".mp4")); fp=folder/("frame"+(Path(frame.filename or "frame.png").suffix or ".png"))
    total=0
    with vp.open("wb") as f:
        while chunk:=await video.read(8*1024*1024):
            total+=len(chunk)
            if total>8*1024**3: shutil.rmtree(folder,ignore_errors=True); raise HTTPException(413,"Vídeo excede 8 GB.")
            f.write(chunk)
    with fp.open("wb") as f:
        while chunk:=await frame.read(4*1024*1024): f.write(chunk)
    with LOCK: JOBS[j]={"status":"queued","progress":1,"message":"Arquivos recebidos"}
    background_tasks.add_task(render,j,str(vp),str(fp),cfg,str(folder))
    return {"job_id":j}
@app.get("/api/render/jobs/{j}")
def status(j:str,x_render_token:Optional[str]=Header(default=None)):
    auth(x_render_token)
    with LOCK: data=JOBS.get(j)
    if not data: raise HTTPException(404,"Job não encontrado. A sessão pode ter sido reiniciada.")
    return {k:v for k,v in data.items() if k!="file_path"}
@app.get("/api/render/jobs/{j}/file")
def result(j:str,x_render_token:Optional[str]=Header(default=None)):
    auth(x_render_token)
    with LOCK: data=JOBS.get(j)
    if not data or data.get("status")!="completed": raise HTTPException(409,"Arquivo ainda não está pronto.")
    path=data["file_path"]
    return FileResponse(path,media_type="video/mp4",filename="manhwa-studio-t4.mp4",background=BackgroundTask(lambda:shutil.rmtree(Path(path).parent,ignore_errors=True)))
