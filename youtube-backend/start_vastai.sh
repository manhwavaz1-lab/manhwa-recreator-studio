#!/usr/bin/env bash
# Rode no terminal da instância Vast.ai: bash start_vastai.sh
set -e
PORT="${PORT:-8000}"
apt-get update -y && apt-get install -y ffmpeg python3-pip python3-venv
cd "$(dirname "$0")"
python3 -m venv .venv && . .venv/bin/activate
pip install -U -r requirements.txt
ffmpeg -hide_banner -encoders | grep -q h264_nvenc && echo "NVENC disponível ✅" || echo "NVENC indisponível: usará CPU"
export RATE_LIMIT=1000 DOWNLOAD_SLOTS=8 RENDER_SLOTS=3
exec uvicorn main:app --host 0.0.0.0 --port "$PORT" --workers 1
