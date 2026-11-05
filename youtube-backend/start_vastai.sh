#!/usr/bin/env bash
# Vast.ai instance startup. Run from the repository root:
#   bash youtube-backend/start_vastai.sh
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/youtube-backend"
PORT="${PORT:-8000}"
CPU_COUNT="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN || echo 4)"
export RENDER_THREADS="${RENDER_THREADS:-$CPU_COUNT}"
export RENDER_SLOTS="${RENDER_SLOTS:-1}"
export RATE_LIMIT="${RATE_LIMIT:-10}"
export API_KEY="${API_KEY:-$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')}"
export MAX_FILE_BYTES="${MAX_FILE_BYTES:-21474836480}"
export PYTHONUNBUFFERED=1

echo "== Manhwa Studio · Vast.ai =="
echo "CPU threads: $RENDER_THREADS | Render slots: $RENDER_SLOTS | Port: $PORT"
echo "API_KEY (copie para o campo no app; não compartilhe): $API_KEY"

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "AVISO: nvidia-smi não encontrado. Esta instância não expõe driver NVIDIA."
else
  nvidia-smi
fi

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1 || ! python3 -m venv --help >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-venv python3-pip curl
fi
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  echo "ERRO: FFmpeg/ffprobe não estão disponíveis no PATH."
  exit 1
fi

echo "-- Teste dos encoders NVIDIA --"
if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_COUNT="$(nvidia-smi --query-gpu=index --format=csv,noheader | wc -l)"
  echo "GPUs NVIDIA detectadas: $GPU_COUNT"
  while IFS=, read -r GPU_INDEX GPU_NAME; do
    GPU_INDEX="$(echo "$GPU_INDEX" | xargs)"
    GPU_NAME="$(echo "$GPU_NAME" | xargs)"
    echo "-- GPU $GPU_INDEX: $GPU_NAME --"
    if ffmpeg -hide_banner -f lavfi -i color=black:s=256x256:d=0.1 -frames:v 1 -c:v h264_nvenc -gpu "$GPU_INDEX" -f null - >/tmp/manhwa-nvenc-"$GPU_INDEX".log 2>&1; then
      echo "NVENC H.264 GPU $GPU_INDEX: operacional"
    else
      echo "NVENC H.264 GPU $GPU_INDEX: indisponível"
      tail -n 5 /tmp/manhwa-nvenc-"$GPU_INDEX".log || true
    fi
    if ffmpeg -hide_banner -f lavfi -i color=black:s=256x256:d=0.1 -frames:v 1 -c:v hevc_nvenc -gpu "$GPU_INDEX" -f null - >/tmp/manhwa-hevc-"$GPU_INDEX".log 2>&1; then
      echo "NVENC H.265 GPU $GPU_INDEX: operacional"
    else
      echo "NVENC H.265 GPU $GPU_INDEX: indisponível"
    fi
  done < <(nvidia-smi --query-gpu=index,name --format=csv,noheader)
else
  echo "Nenhuma GPU NVIDIA visível; renderização CPU estará disponível."
fi

cd "$BACKEND_DIR"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip wheel
python -m pip install -r requirements.txt

echo "-- Capacidades detectadas pelo serviço --"
python - <<'PY'
import os
from gpu_render import list_nvidia_gpus, nvdec_available, nvenc_available
print("CPUs:", os.cpu_count())
for gpu in list_nvidia_gpus():
    idx = gpu["index"]
    print(f'GPU {idx}: {gpu["name"]} | VRAM {gpu["memory_total_mb"]} MB')
    print("  NVENC H.264:", nvenc_available("h264", idx))
    print("  NVENC H.265:", nvenc_available("h265", idx))
print("NVDEC:", nvdec_available())
PY

echo "API local: http://127.0.0.1:$PORT"
echo "Iniciando API e túnel HTTPS temporário para uso com o site Lovable..."

if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH="$(dpkg --print-architecture)"
  case "$ARCH" in
    amd64) CF_ARCH="amd64" ;;
    arm64) CF_ARCH="arm64" ;;
    *) echo "Arquitetura $ARCH sem pacote cloudflared automático; use um proxy HTTPS externo."; exit 1 ;;
  esac
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CF_ARCH.deb" -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb
fi

uvicorn main:app --host 0.0.0.0 --port "$PORT" --workers 1 --timeout-keep-alive 300 &
API_PID=$!
cleanup() { kill "$API_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
sleep 3
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT"
