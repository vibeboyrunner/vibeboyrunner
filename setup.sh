#!/usr/bin/env bash
set -euo pipefail

# ── Dev Preamble ──────────────────────────────────────────────────────────────
VBR_MODE="dev"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ENV_FILE="${SCRIPT_DIR}/.env"
ENV_EXAMPLE="${SCRIPT_DIR}/.env.example"

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$ENV_EXAMPLE" ]; then
    echo "Missing env template: $ENV_EXAMPLE" >&2
    exit 1
  fi
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "Created .env from $(basename "$ENV_EXAMPLE")"
fi

set -a
# shellcheck source=/dev/null
# Source only SHARED + DEV sections; PROD overrides are excluded.
source <(sed '/^# __PROD__$/,$d' "$ENV_FILE")
set +a

resolve_path() {
  local raw_path="$1"
  python3 - "$raw_path" "$SCRIPT_DIR" <<'PY'
import os, sys
raw, base = sys.argv[1], sys.argv[2]
print(raw if os.path.isabs(raw) else os.path.abspath(os.path.join(base, raw)))
PY
}

HOST_HOME_ABS="$(resolve_path "${HOST_HOME_PATH}")"
HOST_WORKSPACES_ABS="$(resolve_path "${HOST_WORKSPACES_PATH}")"

# __SHARED_BODY_START__

# ── Shared defaults ───────────────────────────────────────────────────────────
DIND_HOME_PATH="${DIND_HOME_PATH:-/.vibeboyrunner}"
DIND_WORKDIR_PATH="${DIND_WORKDIR_PATH:-/workdir}"
DIND_WORKSPACES_PATH="${DIND_WORKSPACES_PATH:-${DIND_WORKDIR_PATH}/workspaces}"
DIND_SERVICES_PATH="${DIND_SERVICES_PATH:-/vibeboyrunner/services}"
DIND_CONTAINER_NAME="${DIND_CONTAINER_NAME:-vbr-dind}"
DIND_DOCKER_VOLUME_NAME="${DIND_DOCKER_VOLUME_NAME:-${DIND_CONTAINER_NAME}-docker-data}"
AGENT_PROVIDERS="${AGENT_PROVIDERS:-cursor}"
MANAGER_PORT="${MANAGER_PORT:-18080}"
APP_COMPOSE_SERVICE_NAME="${APP_COMPOSE_SERVICE_NAME:-app}"
MANAGER_AGENT_MODEL="${MANAGER_AGENT_MODEL:-GPT-5.3 Codex Low Fast}"
MANAGER_AGENT_FORCE="${MANAGER_AGENT_FORCE:-true}"
MANAGER_AGENT_SANDBOX="${MANAGER_AGENT_SANDBOX:-disabled}"
GIT_USER_NAME="${GIT_USER_NAME:-VibeBoyRunner Father}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-father@vibeboyrunner.local}"
ONBOARDING_APP_REPO="${ONBOARDING_APP_REPO:-vibeboyrunner/onboarding}"
HOST_PORT_RANGE_START="${HOST_PORT_RANGE_START:-20000}"
HOST_PORT_RANGE_END="${HOST_PORT_RANGE_END:-20499}"
DIND_PORT_RANGE_START="${DIND_PORT_RANGE_START:-20000}"
DIND_PORT_RANGE_END="${DIND_PORT_RANGE_END:-20499}"

if [ "$VBR_MODE" = "prod" ]; then
  DIND_HOME_VOLUME_NAME="${DIND_HOME_VOLUME_NAME:-${DIND_CONTAINER_NAME}-home}"
  DIND_WORKSPACES_VOLUME_NAME="${DIND_WORKSPACES_VOLUME_NAME:-${DIND_CONTAINER_NAME}-workspaces}"
fi

# ── Command parsing ───────────────────────────────────────────────────────────
COMMAND="up"
if [ "$#" -gt 0 ]; then
  case "$1" in
    --help|-h)
      COMMAND="help"
      shift
      ;;
    -*)
      ;;
    *)
      COMMAND="$1"
      shift
      ;;
  esac
fi

if [ "$COMMAND" = "help" ]; then
  echo "Usage: $(basename "$0") [command] [--image image-ref]"
  echo ""
  echo "Commands:"
  if [ "$VBR_MODE" = "prod" ]; then
    echo "  install   Install/update vibeboyrunner CLI"
  fi
  echo "  up        Start/update container (default)"
  echo "  down      Stop/remove container"
  echo "  status    Show container status"
  echo "  logs      Tail container logs"
  exit 0
fi

IMAGE_ARG=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --image)
      IMAGE_ARG="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Use '--help' for usage." >&2
      exit 1
      ;;
  esac
done

# ── Install (prod only) ──────────────────────────────────────────────────────
if [ "$COMMAND" = "install" ]; then
  if [ "$VBR_MODE" != "prod" ]; then
    echo "Install is only available in the production setup script." >&2
    exit 1
  fi

  target_dir="${HOME}/.vibeboyrunner/bin"
  target_file="${target_dir}/vibeboyrunner"
  mkdir -p "$target_dir"

  curl -fsSL "$VBR_RELEASE_SETUP_URL" -o "$target_file"
  chmod +x "$target_file"

  shell_rc="${HOME}/.zshrc"
  case "${SHELL:-}" in
    */bash) shell_rc="${HOME}/.bashrc" ;;
  esac

  export_line='export PATH="$HOME/.vibeboyrunner/bin:$PATH"'
  if [ -f "$shell_rc" ]; then
    if ! grep -Fq "$export_line" "$shell_rc"; then
      printf '\n%s\n' "$export_line" >> "$shell_rc"
    fi
  else
    printf '%s\n' "$export_line" > "$shell_rc"
  fi

  echo "Installed vibeboyrunner CLI: $target_file"
  echo "Run 'vibeboyrunner up' after opening a new shell."
  echo "Or run now: export PATH=\"$HOME/.vibeboyrunner/bin:\$PATH\""
  exit 0
fi

# ── Validation ────────────────────────────────────────────────────────────────
validate_number() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+$ ]]
}

validate_port_range() {
  local start="$1"
  local end="$2"
  local name="$3"

  if ! validate_number "$start" || ! validate_number "$end"; then
    echo "Invalid ${name}: values must be numbers (got ${start}-${end})" >&2
    exit 1
  fi

  if [ "$start" -lt 1 ] || [ "$end" -gt 65535 ] || [ "$start" -gt "$end" ]; then
    echo "Invalid ${name}: expected 1<=start<=end<=65535 (got ${start}-${end})" >&2
    exit 1
  fi
}

validate_port_range "$HOST_PORT_RANGE_START" "$HOST_PORT_RANGE_END" "host port range"
validate_port_range "$DIND_PORT_RANGE_START" "$DIND_PORT_RANGE_END" "dind port range"

host_span=$((HOST_PORT_RANGE_END - HOST_PORT_RANGE_START))
dind_span=$((DIND_PORT_RANGE_END - DIND_PORT_RANGE_START))
if [ "$host_span" -ne "$dind_span" ]; then
  echo "Host and dind port ranges must have equal size (got ${host_span} vs ${dind_span})" >&2
  exit 1
fi

# ── Commands ──────────────────────────────────────────────────────────────────
case "$COMMAND" in
  up)
    if [ "$VBR_MODE" = "dev" ]; then
      DIND_IMAGE_NAME="${DIND_IMAGE_NAME:-vbr-dind:local}"
      mkdir -p "$HOST_HOME_ABS" "$HOST_WORKSPACES_ABS"
      docker build -t "$DIND_IMAGE_NAME" "$SCRIPT_DIR"
      _vol_home="${HOST_HOME_ABS}:${DIND_HOME_PATH}"
      _vol_ws="${HOST_WORKSPACES_ABS}:${DIND_WORKSPACES_PATH}"
      _image="$DIND_IMAGE_NAME"
      _restart=""
    else
      DIND_IMAGE_REF="${IMAGE_ARG:-$DIND_IMAGE_REF}"
      if ! docker image inspect "$DIND_IMAGE_REF" >/dev/null 2>&1; then
        docker pull "$DIND_IMAGE_REF"
      fi
      docker volume create "$DIND_HOME_VOLUME_NAME" >/dev/null
      docker volume create "$DIND_WORKSPACES_VOLUME_NAME" >/dev/null
      _vol_home="${DIND_HOME_VOLUME_NAME}:${DIND_HOME_PATH}"
      _vol_ws="${DIND_WORKSPACES_VOLUME_NAME}:${DIND_WORKSPACES_PATH}"
      _image="$DIND_IMAGE_REF"
      _restart="--restart unless-stopped"
    fi

    docker rm -f "$DIND_CONTAINER_NAME" >/dev/null 2>&1 || true
    docker volume create "$DIND_DOCKER_VOLUME_NAME" >/dev/null

    # shellcheck disable=SC2086
    docker run -d \
      --name "$DIND_CONTAINER_NAME" \
      ${_restart} \
      --privileged \
      -e DIND_HOME_PATH="$DIND_HOME_PATH" \
      -e DIND_WORKDIR_PATH="$DIND_WORKDIR_PATH" \
      -e DIND_WORKSPACES_PATH="$DIND_WORKSPACES_PATH" \
      -e DIND_SERVICES_PATH="$DIND_SERVICES_PATH" \
      -e AGENT_PROVIDERS="$AGENT_PROVIDERS" \
      -e MANAGER_PORT="$MANAGER_PORT" \
      -e MANAGER_WORKSPACES_ROOT="$DIND_WORKSPACES_PATH" \
      -e APP_COMPOSE_SERVICE_NAME="$APP_COMPOSE_SERVICE_NAME" \
      -e MANAGER_AGENT_MODEL="$MANAGER_AGENT_MODEL" \
      -e MANAGER_AGENT_FORCE="$MANAGER_AGENT_FORCE" \
      -e MANAGER_AGENT_SANDBOX="$MANAGER_AGENT_SANDBOX" \
      -e GIT_USER_NAME="$GIT_USER_NAME" \
      -e GIT_USER_EMAIL="$GIT_USER_EMAIL" \
      -e ONBOARDING_APP_REPO="$ONBOARDING_APP_REPO" \
      -e PORT_POOL_START="$DIND_PORT_RANGE_START" \
      -e PORT_POOL_END="$DIND_PORT_RANGE_END" \
      -p "${HOST_PORT_RANGE_START}-${HOST_PORT_RANGE_END}:${DIND_PORT_RANGE_START}-${DIND_PORT_RANGE_END}" \
      -v "$_vol_home" \
      -v "$_vol_ws" \
      -v "${DIND_DOCKER_VOLUME_NAME}:/var/lib/docker" \
      "$_image"

    if [ "$VBR_MODE" = "dev" ]; then
      echo "Started ${DIND_CONTAINER_NAME} (dev mode)"
      echo "Host home mounted: ${HOST_HOME_ABS} -> ${DIND_HOME_PATH}"
      echo "Host workspaces mounted: ${HOST_WORKSPACES_ABS} -> ${DIND_WORKSPACES_PATH}"
      echo "Docker volume: ${DIND_DOCKER_VOLUME_NAME} -> /var/lib/docker"
      echo "Published ports: ${HOST_PORT_RANGE_START}-${HOST_PORT_RANGE_END} -> ${DIND_PORT_RANGE_START}-${DIND_PORT_RANGE_END}"
      echo "Logs: ${HOST_HOME_ABS}/runtime/logs.log"
    else
      echo "Started ${DIND_CONTAINER_NAME} (prod mode)"
      echo "Image: ${DIND_IMAGE_REF}"
      echo "Home volume: ${DIND_HOME_VOLUME_NAME} -> ${DIND_HOME_PATH}"
      echo "Workspaces volume: ${DIND_WORKSPACES_VOLUME_NAME} -> ${DIND_WORKSPACES_PATH}"
      echo "Docker volume: ${DIND_DOCKER_VOLUME_NAME} -> /var/lib/docker"
      echo "Published ports: ${HOST_PORT_RANGE_START}-${HOST_PORT_RANGE_END} -> ${DIND_PORT_RANGE_START}-${DIND_PORT_RANGE_END}"
    fi
    ;;

  down)
    docker rm -f "$DIND_CONTAINER_NAME" >/dev/null 2>&1 || true
    echo "Stopped and removed ${DIND_CONTAINER_NAME}"
    ;;

  status)
    docker ps -a --filter "name=^${DIND_CONTAINER_NAME}$" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}"
    ;;

  logs)
    docker logs -f "$DIND_CONTAINER_NAME"
    ;;

  *)
    echo "Unknown command: $COMMAND" >&2
    echo "Use '--help' for usage." >&2
    exit 1
    ;;
esac

# __SHARED_BODY_END__
