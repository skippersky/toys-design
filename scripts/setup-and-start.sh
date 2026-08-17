#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_ROOT="$REPO_ROOT/.runtime"
DOWNLOADS_ROOT="$RUNTIME_ROOT/downloads"
ENV_FILE="$REPO_ROOT/.env.local"
ENV_EXAMPLE="$REPO_ROOT/.env.local.example"
PROFILE_PATH="$RUNTIME_ROOT/ai-profile.env"
NODE_VERSION="22.16.0"
PNPM_VERSION="10.12.1"
NODE_ARCHIVE="node-v$NODE_VERSION-linux-x64.tar.xz"
NODE_SHA256="F4CB75BB036F0D0EDDF6B79D9596DF1AAAB9DDCCD6A20BF489BE5ABE9467E84E"
NODE_ROOT="$RUNTIME_ROOT/node-v$NODE_VERSION-linux-x64"

MODE="auto"
SKIP_INSTALL=0
PRODUCTION=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --production) PRODUCTION=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
if [[ ! "$MODE" =~ ^(auto|cuda|cpu)$ ]]; then
  echo "Mode must be auto, cuda, or cpu." >&2
  exit 2
fi

download_with_fallback() {
  local primary="$1"
  local fallback="$2"
  local destination="$3"
  if ! curl --location --fail --retry 1 --retry-delay 3 --connect-timeout 10 \
    --max-time 120 --continue-at - --output "$destination" "$primary"; then
    echo "Primary download failed. Retrying with the verified mirror." >&2
    curl --location --fail --retry 2 --retry-delay 3 --connect-timeout 10 \
      --max-time 120 --continue-at - --output "$destination" "$fallback"
  fi
}

install_portable_node() {
  mkdir -p "$RUNTIME_ROOT" "$DOWNLOADS_ROOT"
  local archive_path="$DOWNLOADS_ROOT/$NODE_ARCHIVE"
  if [[ ! -x "$NODE_ROOT/bin/node" ]]; then
    if [[ ! -f "$archive_path" ]]; then
      download_with_fallback \
        "https://nodejs.org/dist/v$NODE_VERSION/$NODE_ARCHIVE" \
        "https://npmmirror.com/mirrors/node/v$NODE_VERSION/$NODE_ARCHIVE" \
        "$archive_path"
    fi
    local actual_hash
    actual_hash="$(sha256sum "$archive_path" | awk '{print toupper($1)}')"
    if [[ "$actual_hash" != "$NODE_SHA256" ]]; then
      echo "Node.js archive SHA256 mismatch. Delete $archive_path and retry." >&2
      exit 1
    fi
    tar -xJf "$archive_path" -C "$RUNTIME_ROOT"
  fi

  export COREPACK_HOME="$RUNTIME_ROOT/corepack"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  export PATH="$NODE_ROOT/bin:$PATH"
  corepack enable --install-directory "$NODE_ROOT/bin"
  corepack prepare "pnpm@$PNPM_VERSION" --activate
  PNPM_COMMAND="$NODE_ROOT/bin/pnpm"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local temporary
  temporary="$(mktemp "$RUNTIME_ROOT/env.XXXXXX")"
  awk -v key="$key" -v replacement="$key=\"$value\"" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 {
      if (!replaced) print replacement
      replaced = 1
      next
    }
    { print }
    END { if (!replaced) print replacement }
  ' "$ENV_FILE" > "$temporary"
  mv "$temporary" "$ENV_FILE"
}

mkdir -p "$RUNTIME_ROOT"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "Created .env.local. Add real Supabase public credentials before using the app." >&2
fi

if (( SKIP_INSTALL == 0 )); then
  bash "$SCRIPT_DIR/comfyui/stop.sh"
  bash "$SCRIPT_DIR/comfyui/install.sh" --mode "$MODE"
fi
source "$SCRIPT_DIR/comfyui/hardware-profile.sh"
if (( SKIP_INSTALL == 1 )) && [[ "$MODE" == "auto" && -f "$PROFILE_PATH" ]]; then
  source "$PROFILE_PATH"
else
  select_ai_profile "$MODE"
  write_ai_profile_env "$PROFILE_PATH"
fi

set_env_value COMFYUI_HTTP_URL "http://127.0.0.1:8188"
set_env_value COMFYUI_WS_URL "ws://127.0.0.1:8188"
set_env_value COMFYUI_CHECKPOINT_NAME "$AI_CHECKPOINT_NAME"
set_env_value COMFYUI_SAMPLER_NAME "$AI_SAMPLER"
set_env_value COMFYUI_SCHEDULER "$AI_SCHEDULER"
set_env_value AI_DEPLOYMENT_PROFILE "$AI_PROFILE_NAME"
set_env_value NEXT_PUBLIC_AI_DEPLOYMENT_PROFILE "$AI_PROFILE_NAME"
set_env_value NEXT_PUBLIC_AI_DEFAULT_STEPS "$AI_DEFAULT_STEPS"
set_env_value NEXT_PUBLIC_AI_DEFAULT_CFG "$AI_DEFAULT_CFG"
set_env_value NEXT_PUBLIC_AI_SQUARE_WIDTH "$AI_SQUARE_WIDTH"
set_env_value NEXT_PUBLIC_AI_SQUARE_HEIGHT "$AI_SQUARE_HEIGHT"
set_env_value NEXT_PUBLIC_AI_LANDSCAPE_WIDTH "$AI_LANDSCAPE_WIDTH"
set_env_value NEXT_PUBLIC_AI_LANDSCAPE_HEIGHT "$AI_LANDSCAPE_HEIGHT"
set_env_value NEXT_PUBLIC_AI_PORTRAIT_WIDTH "$AI_PORTRAIT_WIDTH"
set_env_value NEXT_PUBLIC_AI_PORTRAIT_HEIGHT "$AI_PORTRAIT_HEIGHT"

bash "$SCRIPT_DIR/comfyui/start.sh" --mode auto

PNPM_COMMAND=""
if command -v node >/dev/null 2>&1 && command -v pnpm >/dev/null 2>&1; then
  node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
  system_pnpm_version="$(pnpm --version 2>/dev/null || true)"
  if [[ "$node_major" =~ ^[0-9]+$ ]] && (( node_major >= 20 )) && \
    [[ "$system_pnpm_version" == "$PNPM_VERSION" ]]; then
    PNPM_COMMAND="$(command -v pnpm)"
  fi
fi
if [[ -z "$PNPM_COMMAND" ]]; then
  install_portable_node
fi

cd "$REPO_ROOT"
CI=true "$PNPM_COMMAND" install --frozen-lockfile
if (( PRODUCTION == 1 )); then
  "$PNPM_COMMAND" run build
  exec "$PNPM_COMMAND" start -- --hostname 0.0.0.0
else
  exec "$PNPM_COMMAND" dev -- --hostname 0.0.0.0
fi
