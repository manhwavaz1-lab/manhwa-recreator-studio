#!/usr/bin/env bash
# Run inside Vast.ai from the cloned repository root. No tunnel is created.
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
echo "== Manhwa Studio · Vast.ai GPU renderer =="
echo "CPU threads: $RENDER_THREADS | HTTP port: $PORT"
echo "API_KEY (cole no campo do app; não compartilhe): $API_KEY"
echo "-- GPU --"
nvidia-smi || { echo "ERRO: GPU/driver NVIDIA não visível neste container."; exit 1; }
echo "-- FFmpeg NVENC e filtros CUDA --"
ffmpeg -hide_banner -encoders | grep -E 'h264_nvenc|hevc_nvenc' || true
ffmpeg -hide_banner -filters | grep -E 'scale_cuda|overlay_cuda' || true
for enc in h264_nvenc hevc_nvenc; do
  if ffmpeg -hide_banner -f lavfi -i color=black:s=256x256:d=0.1 -frames:v 1 -c:v "$enc" -preset p1 -f null - >/dev/null 2>&1; then echo "$enc: operacional"; else echo "$enc: indisponível"; fi
done
if ! python3 -m venv --help >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends python3-venv python3-pip
fi
cd "$BACKEND_DIR"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip wheel
python -m pip install -r requirements.txt
echo "Health local: http://127.0.0.1:$PORT/health"
echo "Exponha a porta HTTP $PORT no painel Vast.ai e copie a URL HTTPS exibida em Connect."
echo "A API Key da Vast.ai não é usada para renderização. A chave acima é a senha do backend."
exec uvicorn main:app --host 0.0.0.0 --port "$PORT" --workers 1 --timeout-keep-alive 300
