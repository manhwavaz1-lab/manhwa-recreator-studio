#!/usr/bin/env bash
# Convenience launcher for Vast.ai. Run from the repository root.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$ROOT_DIR/youtube-backend/start_vastai.sh" "$@"
