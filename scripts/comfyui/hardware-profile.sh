#!/usr/bin/env bash

set -euo pipefail

DREAMSHAPER_NAME="DreamShaper8_LCM.safetensors"
DREAMSHAPER_URL="https://huggingface.co/Lykon/dreamshaper-8-lcm/resolve/main/DreamShaper8_LCM.safetensors"
DREAMSHAPER_SHA256="A4F3E1526C5DC4FCBE342F5C410D83AE202C7A415FCEFCBB92E0F93FCD0A87C3"
DREAMSHAPER_SIZE="2133804992"
SDXL_NAME="sd_xl_base_1.0.safetensors"
SDXL_URL="https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
SDXL_SHA256="31E35C80FC4829D14F90153F4C74CD59C90B779F6AFE05A74CD6120B893F7E5B"
SDXL_SIZE="6938078334"

select_ai_profile() {
  local requested_mode="${1:-auto}"
  local best_name=""
  local best_vram=0
  local best_driver=""

  if command -v nvidia-smi >/dev/null 2>&1; then
    while IFS=',' read -r raw_name raw_vram raw_driver; do
      local name vram driver
      name="$(printf '%s' "$raw_name" | xargs)"
      vram="$(printf '%s' "$raw_vram" | xargs)"
      driver="$(printf '%s' "$raw_driver" | xargs)"
      if [[ "$vram" =~ ^[0-9]+$ ]] && (( vram > best_vram )); then
        best_name="$name"
        best_vram="$vram"
        best_driver="$driver"
      fi
    done < <(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>/dev/null || true)
  fi
  if [[ -n "${STATUEFORGE_GPU_NAME:-}" && "${STATUEFORGE_GPU_VRAM_MB:-}" =~ ^[0-9]+$ ]]; then
    best_name="$STATUEFORGE_GPU_NAME"
    best_vram="$STATUEFORGE_GPU_VRAM_MB"
    best_driver="${STATUEFORGE_NVIDIA_DRIVER:-}"
  fi

  if [[ "$requested_mode" == "auto" ]]; then
    if [[ -n "$best_name" ]]; then
      requested_mode="cuda"
    else
      requested_mode="cpu"
    fi
  fi
  if [[ "$requested_mode" == "directml" ]]; then
    echo "DirectML is only supported by the Windows deployment script." >&2
    return 1
  fi
  if [[ "$requested_mode" == "cuda" && -z "$best_name" ]]; then
    echo "CUDA mode requires a working NVIDIA driver and nvidia-smi." >&2
    return 1
  fi

  AI_RUNTIME_MODE="$requested_mode"
  AI_GPU_NAME="${best_name:-CPU only}"
  AI_VRAM_MB="$best_vram"
  AI_DRIVER_VERSION="$best_driver"

  if [[ "$requested_mode" == "cuda" && "$best_vram" -ge 20480 ]]; then
    AI_PROFILE_NAME="cuda-sdxl-high"
    AI_CHECKPOINT_NAME="$SDXL_NAME"; AI_MODEL_URL="$SDXL_URL"
    AI_MODEL_SHA256="$SDXL_SHA256"; AI_MODEL_SIZE="$SDXL_SIZE"
    AI_SAMPLER="dpmpp_2m"; AI_SCHEDULER="karras"
    AI_DEFAULT_STEPS="25"; AI_DEFAULT_CFG="7"
    AI_SQUARE_WIDTH="1024"; AI_SQUARE_HEIGHT="1024"
    AI_LANDSCAPE_WIDTH="1216"; AI_LANDSCAPE_HEIGHT="832"
    AI_PORTRAIT_WIDTH="832"; AI_PORTRAIT_HEIGHT="1216"
    AI_COMFY_ARGS="--highvram"
  elif [[ "$requested_mode" == "cuda" && "$best_vram" -ge 12288 ]]; then
    AI_PROFILE_NAME="cuda-sdxl-standard"
    AI_CHECKPOINT_NAME="$SDXL_NAME"; AI_MODEL_URL="$SDXL_URL"
    AI_MODEL_SHA256="$SDXL_SHA256"; AI_MODEL_SIZE="$SDXL_SIZE"
    AI_SAMPLER="dpmpp_2m"; AI_SCHEDULER="karras"
    AI_DEFAULT_STEPS="22"; AI_DEFAULT_CFG="6.5"
    AI_SQUARE_WIDTH="1024"; AI_SQUARE_HEIGHT="1024"
    AI_LANDSCAPE_WIDTH="1152"; AI_LANDSCAPE_HEIGHT="768"
    AI_PORTRAIT_WIDTH="768"; AI_PORTRAIT_HEIGHT="1152"
    AI_COMFY_ARGS="--normalvram"
  elif [[ "$requested_mode" == "cuda" && "$best_vram" -ge 8192 ]]; then
    AI_PROFILE_NAME="cuda-sdxl-low"
    AI_CHECKPOINT_NAME="$SDXL_NAME"; AI_MODEL_URL="$SDXL_URL"
    AI_MODEL_SHA256="$SDXL_SHA256"; AI_MODEL_SIZE="$SDXL_SIZE"
    AI_SAMPLER="dpmpp_2m"; AI_SCHEDULER="karras"
    AI_DEFAULT_STEPS="18"; AI_DEFAULT_CFG="6"
    AI_SQUARE_WIDTH="768"; AI_SQUARE_HEIGHT="768"
    AI_LANDSCAPE_WIDTH="896"; AI_LANDSCAPE_HEIGHT="640"
    AI_PORTRAIT_WIDTH="640"; AI_PORTRAIT_HEIGHT="896"
    AI_COMFY_ARGS="--lowvram"
  elif [[ "$requested_mode" == "cuda" ]]; then
    AI_PROFILE_NAME="cuda-lcm-lite"
    AI_CHECKPOINT_NAME="$DREAMSHAPER_NAME"; AI_MODEL_URL="$DREAMSHAPER_URL"
    AI_MODEL_SHA256="$DREAMSHAPER_SHA256"; AI_MODEL_SIZE="$DREAMSHAPER_SIZE"
    AI_SAMPLER="lcm"; AI_SCHEDULER="sgm_uniform"
    AI_DEFAULT_STEPS="6"; AI_DEFAULT_CFG="2"
    AI_SQUARE_WIDTH="512"; AI_SQUARE_HEIGHT="512"
    AI_LANDSCAPE_WIDTH="768"; AI_LANDSCAPE_HEIGHT="512"
    AI_PORTRAIT_WIDTH="512"; AI_PORTRAIT_HEIGHT="768"
    AI_COMFY_ARGS="--lowvram"
  else
    AI_PROFILE_NAME="cpu-lcm-lite"
    AI_CHECKPOINT_NAME="$DREAMSHAPER_NAME"; AI_MODEL_URL="$DREAMSHAPER_URL"
    AI_MODEL_SHA256="$DREAMSHAPER_SHA256"; AI_MODEL_SIZE="$DREAMSHAPER_SIZE"
    AI_SAMPLER="lcm"; AI_SCHEDULER="sgm_uniform"
    AI_DEFAULT_STEPS="4"; AI_DEFAULT_CFG="2"
    AI_SQUARE_WIDTH="384"; AI_SQUARE_HEIGHT="384"
    AI_LANDSCAPE_WIDTH="512"; AI_LANDSCAPE_HEIGHT="384"
    AI_PORTRAIT_WIDTH="384"; AI_PORTRAIT_HEIGHT="512"
    AI_COMFY_ARGS="--cpu"
  fi

  export AI_RUNTIME_MODE AI_PROFILE_NAME AI_GPU_NAME AI_VRAM_MB AI_DRIVER_VERSION
  export AI_CHECKPOINT_NAME AI_MODEL_URL AI_MODEL_SHA256 AI_MODEL_SIZE
  export AI_SAMPLER AI_SCHEDULER AI_DEFAULT_STEPS AI_DEFAULT_CFG AI_COMFY_ARGS
  export AI_SQUARE_WIDTH AI_SQUARE_HEIGHT AI_LANDSCAPE_WIDTH AI_LANDSCAPE_HEIGHT
  export AI_PORTRAIT_WIDTH AI_PORTRAIT_HEIGHT
}

write_ai_profile_env() {
  local destination="$1"
  mkdir -p "$(dirname "$destination")"
  {
    printf 'AI_RUNTIME_MODE=%q\n' "$AI_RUNTIME_MODE"
    printf 'AI_PROFILE_NAME=%q\n' "$AI_PROFILE_NAME"
    printf 'AI_GPU_NAME=%q\n' "$AI_GPU_NAME"
    printf 'AI_VRAM_MB=%q\n' "$AI_VRAM_MB"
    printf 'AI_DRIVER_VERSION=%q\n' "$AI_DRIVER_VERSION"
    printf 'AI_CHECKPOINT_NAME=%q\n' "$AI_CHECKPOINT_NAME"
    printf 'AI_MODEL_URL=%q\n' "$AI_MODEL_URL"
    printf 'AI_MODEL_SHA256=%q\n' "$AI_MODEL_SHA256"
    printf 'AI_MODEL_SIZE=%q\n' "$AI_MODEL_SIZE"
    printf 'AI_SAMPLER=%q\n' "$AI_SAMPLER"
    printf 'AI_SCHEDULER=%q\n' "$AI_SCHEDULER"
    printf 'AI_DEFAULT_STEPS=%q\n' "$AI_DEFAULT_STEPS"
    printf 'AI_DEFAULT_CFG=%q\n' "$AI_DEFAULT_CFG"
    printf 'AI_SQUARE_WIDTH=%q\n' "$AI_SQUARE_WIDTH"
    printf 'AI_SQUARE_HEIGHT=%q\n' "$AI_SQUARE_HEIGHT"
    printf 'AI_LANDSCAPE_WIDTH=%q\n' "$AI_LANDSCAPE_WIDTH"
    printf 'AI_LANDSCAPE_HEIGHT=%q\n' "$AI_LANDSCAPE_HEIGHT"
    printf 'AI_PORTRAIT_WIDTH=%q\n' "$AI_PORTRAIT_WIDTH"
    printf 'AI_PORTRAIT_HEIGHT=%q\n' "$AI_PORTRAIT_HEIGHT"
    printf 'AI_COMFY_ARGS=%q\n' "$AI_COMFY_ARGS"
  } > "$destination"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  mode="${1:-auto}"
  select_ai_profile "$mode"
  printf 'profile=%s\nmode=%s\ngpu=%s\nvram_mb=%s\ncheckpoint=%s\n' \
    "$AI_PROFILE_NAME" "$AI_RUNTIME_MODE" "$AI_GPU_NAME" "$AI_VRAM_MB" "$AI_CHECKPOINT_NAME"
fi
