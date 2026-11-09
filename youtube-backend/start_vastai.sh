#!/usr/bin/env bash
# Start the complete Manhwa Studio site and GPU API on one public Vast.ai HTTP port.
# The browser uploads files to this site; Vite proxies /api to the local FastAPI GPU worker.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/youtube-backend"
SITE_PORT="${PORT:-8000}"
API_PORT=8001
CPU_COUNT="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN || echo 4)"
# Use every CPU thread exposed by the Vast.ai instance unless explicitly overridden.
DEFAULT_RENDER_THREADS="192"
export RENDER_THREADS="${RENDER_THREADS:-$DEFAULT_RENDER_THREADS}"
export RENDER_SLOTS="${RENDER_SLOTS:-1}"
export PARALLEL_SEGMENTS="${PARALLEL_SEGMENTS:-9}"
# Keep library-level CPU pools bounded to the per-segment allocation.
RENDER_THREADS_PER_SEGMENT="$(((RENDER_THREADS + PARALLEL_SEGMENTS - 1) / PARALLEL_SEGMENTS))"
export RENDER_THREADS_PER_SEGMENT
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-$RENDER_THREADS_PER_SEGMENT}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-$RENDER_THREADS_PER_SEGMENT}"
# FFmpeg filter threads are capped per worker to avoid 3x oversubscription on large Vast CPU allocations.
export RENDER_FILTER_THREADS="${RENDER_FILTER_THREADS:-4}"
export RATE_LIMIT="${RATE_LIMIT:-10}"
export MAX_FILE_BYTES="${MAX_FILE_BYTES:-21474836480}"
export PYTHONUNBUFFERED=1

echo "== MANHWA STUDIO | SITE + GPU AUTOMÁTICA =="
echo "Site: HTTP $SITE_PORT | GPU API interna: 127.0.0.1:$API_PORT"
echo "Upload local do navegador -> servidor Vast.ai -> FFmpeg/GPU -> download no mesmo site"
echo "CPU threads disponíveis: $CPU_COUNT | RENDER_THREADS: $RENDER_THREADS"
echo "Render paralelo: $PARALLEL_SEGMENTS partes | slots GPU: $RENDER_SLOTS | até $RENDER_THREADS_PER_SEGMENT threads por segmento | threads por filtro: $RENDER_FILTER_THREADS"
echo "-- Verificando GPU NVIDIA --"
nvidia-smi || { echo "ERRO: GPU/driver NVIDIA não visível."; exit 1; }
echo "-- Verificando FFmpeg --"
command -v ffmpeg >/dev/null || { echo "ERRO: FFmpeg não instalado."; exit 1; }
ffmpeg -hide_banner -encoders | grep -E 'h264_nvenc|hevc_nvenc' || true
ffmpeg -hide_banner -filters | grep -E 'scale_cuda|overlay_cuda' || true
echo "-- Verificando Node.js --"
command -v node >/dev/null || { echo "ERRO: Node.js não instalado nesta imagem Vast."; exit 1; }
command -v npm >/dev/null || { echo "ERRO: npm não instalado nesta imagem Vast."; exit 1; }
node --version
npm --version

if ! python3 -m venv --help >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends python3-venv python3-pip
fi

echo "-- Preparando backend GPU --"
cd "$BACKEND_DIR"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip wheel
python -m pip install -r requirements.txt

echo "-- Preparando interface do site --"
cd "$ROOT_DIR"
npm install --no-audit --no-fund
# Use Vite development server: TanStack preview currently expects dist/server/server.js,
# which is absent in this deployment build. Dev mode serves the app without that artifact.

echo "-- Iniciando API GPU interna --"
(
  cd "$BACKEND_DIR"
  source .venv/bin/activate
  exec uvicorn main:app --host 127.0.0.1 --port "$API_PORT" --workers 1 --timeout-keep-alive 300
) > /tmp/manhwa-studio-gpu-api.log 2>&1 &
API_PID=$!
cleanup() {
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

python3 - <<PY
import time, urllib.request
url = "http://127.0.0.1:$API_PORT/health"
for attempt in range(60):
    try:
        print("GPU API:", urllib.request.urlopen(url, timeout=2).read().decode())
        break
    except Exception:
        time.sleep(1)
else:
    raise SystemExit("A API GPU não iniciou. Consulte /tmp/manhwa-studio-gpu-api.log")
PY

echo "-- Abrindo o site pelo Vite em modo servidor --"
echo "No painel Vast.ai, publique SOMENTE a porta HTTP $SITE_PORT."
echo "Abra a URL HTTPS gerada pela Vast.ai. Não há URL de API nem chave para digitar."
exec npm run dev -- --host 0.0.0.0 --port "$SITE_PORT" --strictPort
