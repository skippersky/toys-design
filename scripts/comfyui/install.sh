#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNTIME_ROOT="$REPO_ROOT/.runtime"
COMFY_ROOT="$RUNTIME_ROOT/comfyui"
VENV_ROOT="$RUNTIME_ROOT/venv"
PYTHON="$VENV_ROOT/bin/python"
MODEL_ROOT="$COMFY_ROOT/models/checkpoints"
PROFILE_PATH="$RUNTIME_ROOT/ai-profile.env"
PID_FILE="$RUNTIME_ROOT/comfyui.pid"
COMFY_REPOSITORY="https://github.com/Comfy-Org/ComfyUI.git"
COMFY_COMMIT="72212fef660bcd7d9702fa52011d089c027a64d8"
TORCH_VERSION="2.4.1"
TORCHVISION_VERSION="0.19.1"
TORCHAUDIO_VERSION="2.4.1"

MODE="auto"
SKIP_MODEL=0
FORCE_DEPENDENCIES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --skip-model) SKIP_MODEL=1; shift ;;
    --force-dependencies) FORCE_DEPENDENCIES=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
if [[ ! "$MODE" =~ ^(auto|cuda|cpu)$ ]]; then
  echo "Mode must be auto, cuda, or cpu." >&2
  exit 2
fi

source "$SCRIPT_DIR/hardware-profile.sh"
select_ai_profile "$MODE"
mkdir -p "$RUNTIME_ROOT"
write_ai_profile_env "$PROFILE_PATH"

install_prerequisites() {
  local missing=0
  for command_name in git curl python3; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      missing=1
    fi
  done
  if (( missing == 0 )); then
    return
  fi

  local sudo_command=()
  if (( EUID != 0 )); then
    if ! command -v sudo >/dev/null 2>&1; then
      echo "Missing prerequisites and sudo is unavailable." >&2
      exit 1
    fi
    sudo_command=(sudo)
  fi
  if command -v apt-get >/dev/null 2>&1; then
    "${sudo_command[@]}" apt-get update
    "${sudo_command[@]}" apt-get install -y python3 python3-venv git curl ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    "${sudo_command[@]}" dnf install -y python3 git curl ca-certificates
  else
    echo "Install python3, python3-venv, git, curl, and ca-certificates, then retry." >&2
    exit 1
  fi
}

install_prerequisites
if [[ ! -x "$PYTHON" ]]; then
  if ! python3 -m venv "$VENV_ROOT"; then
    sudo_command=()
    if (( EUID != 0 )); then
      if ! command -v sudo >/dev/null 2>&1; then
        echo "python3-venv is required and sudo is unavailable." >&2
        exit 1
      fi
      sudo_command=(sudo)
    fi
    if command -v apt-get >/dev/null 2>&1; then
      "${sudo_command[@]}" apt-get install -y python3-venv
    elif command -v dnf >/dev/null 2>&1; then
      "${sudo_command[@]}" dnf install -y python3
    else
      echo "Install the Python venv module, then retry." >&2
      exit 1
    fi
    python3 -m venv --clear "$VENV_ROOT"
  fi
fi

if [[ ! -d "$COMFY_ROOT/.git" ]]; then
  git clone --filter=blob:none --no-checkout "$COMFY_REPOSITORY" "$COMFY_ROOT"
fi
git -c "safe.directory=$COMFY_ROOT" -C "$COMFY_ROOT" fetch --depth 1 origin "$COMFY_COMMIT"
git -c "safe.directory=$COMFY_ROOT" -C "$COMFY_ROOT" checkout --detach "$COMFY_COMMIT"

DEPENDENCY_MARKER="$RUNTIME_ROOT/comfyui-dependencies-v4-$AI_RUNTIME_MODE.txt"
dependencies_required=0
if (( FORCE_DEPENDENCIES == 1 )) || [[ ! -f "$DEPENDENCY_MARKER" ]]; then
  dependencies_required=1
fi
if (( dependencies_required == 1 )) && [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Stop ComfyUI before changing PyTorch dependencies (PID $(cat "$PID_FILE"))." >&2
  exit 1
fi

if (( dependencies_required == 1 )); then
  echo "[ComfyUI] Installing dependencies for profile $AI_PROFILE_NAME..."
  "$PYTHON" -m pip install --upgrade pip setuptools wheel
  if [[ "$AI_RUNTIME_MODE" == "cuda" ]]; then
    "$PYTHON" -m pip install --upgrade \
      "torch==$TORCH_VERSION" "torchvision==$TORCHVISION_VERSION" "torchaudio==$TORCHAUDIO_VERSION" \
      --index-url https://download.pytorch.org/whl/cu124
  else
    "$PYTHON" -m pip install --upgrade \
      "torch==$TORCH_VERSION" "torchvision==$TORCHVISION_VERSION" "torchaudio==$TORCHAUDIO_VERSION" \
      --index-url https://download.pytorch.org/whl/cpu
  fi
  "$PYTHON" -m pip install --upgrade \
    numpy==1.26.4 transformers==4.49.0 tokenizers==0.21.4
  "$PYTHON" -m pip install -r "$COMFY_ROOT/requirements.txt"
  "$PYTHON" -m pip check
  printf '%s\n%s\n%s\n' "$COMFY_COMMIT" "$AI_PROFILE_NAME" "$AI_RUNTIME_MODE" > "$DEPENDENCY_MARKER"
fi

if (( SKIP_MODEL == 0 )); then
  mkdir -p "$MODEL_ROOT"
  MODEL_PATH="$MODEL_ROOT/$AI_CHECKPOINT_NAME"
  model_valid=0
  if [[ -f "$MODEL_PATH" ]]; then
    actual_size="$(stat -c '%s' "$MODEL_PATH")"
    if [[ "$actual_size" == "$AI_MODEL_SIZE" ]]; then
      actual_hash="$(sha256sum "$MODEL_PATH" | awk '{print toupper($1)}')"
      if [[ "$actual_hash" == "$AI_MODEL_SHA256" ]]; then
        model_valid=1
      else
        rm -f -- "$MODEL_PATH"
      fi
    elif (( actual_size > AI_MODEL_SIZE )); then
      rm -f -- "$MODEL_PATH"
    fi
  fi
  if (( model_valid == 0 )); then
    echo "[ComfyUI] Downloading $AI_CHECKPOINT_NAME..."
    curl --location --fail --retry 5 --retry-delay 3 --connect-timeout 20 \
      --continue-at - --output "$MODEL_PATH" "$AI_MODEL_URL"
    actual_hash="$(sha256sum "$MODEL_PATH" | awk '{print toupper($1)}')"
    if [[ "$actual_hash" != "$AI_MODEL_SHA256" ]]; then
      echo "Checkpoint SHA256 mismatch. Expected $AI_MODEL_SHA256, got $actual_hash." >&2
      exit 1
    fi
  fi
fi

echo "[ComfyUI] Installation complete."
echo "[ComfyUI] Profile: $AI_PROFILE_NAME"
echo "[ComfyUI] GPU: $AI_GPU_NAME ($AI_VRAM_MB MB VRAM)"
echo "[ComfyUI] Checkpoint: $AI_CHECKPOINT_NAME"
