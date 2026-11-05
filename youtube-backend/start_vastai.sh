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
export RATE_LIMIT="${RATE_LIMIT:-100}"
export MAX_FILE_BYTES="${MAX_FILE_BYTES:-7516192768}"
export PYTHONUNBUFFERED=1

echo "== Manhwa Studio · Vast.ai =="
echo "CPU threads: $RENDER_THREADS | Render slots: $RENDER_SLOTS | Port: $PORT"

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "AVISO: nvidia-smi não encontrado. Esta instância não expõe driver NVIDIA."
else
  nvidia-smi
fi

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-venv python3-pip
fi
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  echo "ERRO: FFmpeg/ffprobe não estão disponíveis no PATH."
  exit 1
fi

echo "-- Teste dos encoders NVIDIA --"
if ffmpeg -hide_banner -f lavfi -i color=black:s=256x256:d=0.1 -frames:v 1 -c:v h264_nvenc -f null - >/tmp/manhwa-nvenc-test.log 2>&1; then
  echo "NVENC H.264: operacional"
else
  echo "NVENC H.264: indisponível; o renderizador tentará CPU no modo automático."
  tail -n 8 /tmp/manhwa-nvenc-test.log || true
fi
if ffmpeg -hide_banner -f lavfi -i color=black:s=256x256:d=0.1 -frames:v 1 -c:v hevc_nvenc -f null - >/tmp/manhwa-hevc-test.log 2>&1; then
  echo "NVENC H.265: operacional"
else
  echo "NVENC H.265: indisponível nesta combinação FFmpeg/driver/GPU."
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
from gpu_render import nvdec_available, nvenc_available
print("CPUs:", os.cpu_count())
print("NVENC H.264:", nvenc_available("h264"))
print("NVENC H.265:", nvenc_available("h265"))
print("NVDEC:", nvdec_available())
PY

echo "API: http://0.0.0.0:$PORT"
echo "Configure VITE_RENDER_API_URL no Lovable com o endereço público HTTP(S) desta instância."
exec uvicorn main:app --host 0.0.0.0 --port "$PORT" --workers 1 --timeout-keep-alive 300
