#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNTIME_ROOT="$REPO_ROOT/.runtime"
COMFY_ROOT="$RUNTIME_ROOT/comfyui"
PYTHON="$RUNTIME_ROOT/venv/bin/python"
PROFILE_PATH="$RUNTIME_ROOT/ai-profile.env"
PID_FILE="$RUNTIME_ROOT/comfyui.pid"
LOG_ROOT="$RUNTIME_ROOT/logs"
PORT=8188
MODE="auto"
HEALTH_TIMEOUT=240

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --health-timeout) HEALTH_TIMEOUT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

source "$SCRIPT_DIR/hardware-profile.sh"
if [[ "$MODE" == "auto" && -f "$PROFILE_PATH" ]]; then
  source "$PROFILE_PATH"
else
  select_ai_profile "$MODE"
  write_ai_profile_env "$PROFILE_PATH"
fi

if [[ ! -x "$PYTHON" || ! -f "$COMFY_ROOT/main.py" ]]; then
  echo "ComfyUI is not installed. Run scripts/comfyui/install.sh first." >&2
  exit 1
fi
if [[ ! -f "$COMFY_ROOT/models/checkpoints/$AI_CHECKPOINT_NAME" ]]; then
  echo "Checkpoint $AI_CHECKPOINT_NAME is missing. Run the installer first." >&2
  exit 1
fi
if [[ "$AI_RUNTIME_MODE" == "cuda" ]] && ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "The selected CUDA profile requires nvidia-smi." >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE")"
  if kill -0 "$existing_pid" 2>/dev/null; then
    echo "[ComfyUI] Already running with PID $existing_pid."
    exit 0
  fi
  rm -f -- "$PID_FILE"
fi

mkdir -p "$LOG_ROOT"
read -r -a profile_args <<< "$AI_COMFY_ARGS"
(
  cd "$COMFY_ROOT"
  nohup "$PYTHON" main.py \
    --listen 127.0.0.1 --port "$PORT" --preview-method none --disable-auto-launch \
    "${profile_args[@]}" \
    > "$LOG_ROOT/comfyui.out.log" 2> "$LOG_ROOT/comfyui.err.log" &
  echo $! > "$PID_FILE"
)

pid="$(cat "$PID_FILE")"
echo "[ComfyUI] Starting profile $AI_PROFILE_NAME with PID $pid..."
deadline=$((SECONDS + HEALTH_TIMEOUT))
while (( SECONDS < deadline )); do
  sleep 2
  if ! kill -0 "$pid" 2>/dev/null; then
    tail -n 40 "$LOG_ROOT/comfyui.err.log" >&2 || true
    echo "ComfyUI exited during startup." >&2
    exit 1
  fi
  if curl --silent --fail --max-time 3 "http://127.0.0.1:$PORT/system_stats" >/dev/null; then
    echo "[ComfyUI] Ready at http://127.0.0.1:$PORT"
    echo "[ComfyUI] Profile: $AI_PROFILE_NAME, checkpoint: $AI_CHECKPOINT_NAME"
    exit 0
  fi
done

echo "ComfyUI did not become healthy within $HEALTH_TIMEOUT seconds." >&2
exit 1
