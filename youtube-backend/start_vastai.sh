#!/usr/bin/env bash
# Start the complete Manhwa Studio site and GPU API on one public Vast.ai HTTP port.
# The browser uploads files to this site; Vite proxies /api to the local FastAPI GPU worker.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/youtube-backend"
SITE_PORT="${PORT:-8000}"
API_PORT=8001
CPU_COUNT="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN || echo 4)"
export RENDER_THREADS="${RENDER_THREADS:-32}"
export RENDER_SLOTS="${RENDER_SLOTS:-2}"
export RATE_LIMIT="${RATE_LIMIT:-10}"
export MAX_FILE_BYTES="${MAX_FILE_BYTES:-21474836480}"
export PYTHONUNBUFFERED=1

echo "== MANHWA STUDIO | RTX 5060 Ti / 16 GB =="
echo "Site: HTTP $SITE_PORT | GPU API interna: 127.0.0.1:$API_PORT"
echo "Upload local do navegador -> servidor Vast.ai -> FFmpeg/GPU -> download no mesmo site"
echo "-- Perfil de alto desempenho para RTX 5060 Ti de 16 GB --"
echo "Renderizações simultâneas: $RENDER_SLOTS | Threads por render: $RENDER_THREADS | até $((RENDER_THREADS * RENDER_SLOTS)) threads de render em uso | CPU detectada: $CPU_COUNT"
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
npm run build

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

echo "-- Abrindo o site completo em uma única porta --"
echo "No painel Vast.ai, publique SOMENTE a porta HTTP $SITE_PORT."
echo "Abra a URL HTTPS gerada pela Vast.ai. Não há URL de API nem chave para digitar."
exec npm run dev -- --host 0.0.0.0 --port "$SITE_PORT" --strictPort
