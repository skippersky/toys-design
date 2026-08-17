#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PID_FILE="$REPO_ROOT/.runtime/comfyui.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "[ComfyUI] No managed process is running."
  exit 0
fi

pid="$(cat "$PID_FILE")"
if kill -0 "$pid" 2>/dev/null; then
  kill "$pid"
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid"
  fi
fi
rm -f -- "$PID_FILE"
echo "[ComfyUI] Stopped."
