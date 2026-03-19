#!/usr/bin/env bash
set -euo pipefail

# Self-contained production bootstrap script.
# All values can be overridden at runtime, e.g.:
# DIND_IMAGE_REF=myorg/vbr-dind:1.2.3 DIND_CONTAINER_NAME=my-dind ./setup.sh
# Commands:
#   install  -> install/update vibeboyrunner CLI locally
#   up       -> start/update prod container (default)
#   down     -> stop/remove prod container
#   status   -> show prod container status
#   logs     -> tail prod container logs

: "${VBR_RELEASE_SETUP_URL:=https://vibeboyrunner.github.io/vibeboyrunner/latest/setup.sh}"

: "${DIND_IMAGE_REF:=vibeboyrunner/vibeboyrunner:0.0.9}"
: "${DIND_CONTAINER_NAME:=vibeboyrunner}"
: "${DIND_HOME_VOLUME_NAME:=${DIND_CONTAINER_NAME}-home}"
: "${DIND_WORKSPACES_VOLUME_NAME:=${DIND_CONTAINER_NAME}-workspaces}"
: "${DIND_DOCKER_VOLUME_NAME:=${DIND_CONTAINER_NAME}-docker-data}"

: "${DIND_HOME_PATH:=/.vibeboyrunner}"
: "${DIND_WORKDIR_PATH:=/workdir}"
: "${DIND_WORKSPACES_PATH:=${DIND_WORKDIR_PATH}/workspaces}"
: "${DIND_SERVICES_PATH:=/vibeboyrunner/services}"

: "${AGENT_PROVIDERS:=cursor}"
: "${MANAGER_PORT:=18080}"
: "${APP_COMPOSE_SERVICE_NAME:=app}"
: "${MANAGER_AGENT_MODEL:=GPT-5.3 Codex Low Fast}"
: "${MANAGER_AGENT_FORCE:=true}"
: "${MANAGER_AGENT_SANDBOX:=disabled}"
: "${GIT_USER_NAME:=VibeBoyRunner Father}"
: "${GIT_USER_EMAIL:=father@vibeboyrunner.local}"
: "${ONBOARDING_APP_REPO:=vibeboyrunner/onboarding}"

: "${HOST_PORT_RANGE_START:=20000}"
: "${HOST_PORT_RANGE_END:=20499}"
: "${DIND_PORT_RANGE_START:=20000}"
: "${DIND_PORT_RANGE_END:=20499}"

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

if [ "$COMMAND" = "help" ] || [ "$COMMAND" = "--help" ] || [ "$COMMAND" = "-h" ]; then
  cat <<'EOF'
Usage: setup.sh [command] [--image image-ref]

Commands:
  install   Install/update vibeboyrunner CLI at ~/.vibeboyrunner/bin/vibeboyrunner
  up        Start/update prod container (default)
  down      Stop/remove prod container
  status    Show prod container status
  logs      Tail prod container logs
EOF
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

if [ "$COMMAND" = "install" ]; then
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

DIND_IMAGE_REF="${IMAGE_ARG:-$DIND_IMAGE_REF}"

case "$COMMAND" in
  up)
    if ! docker image inspect "$DIND_IMAGE_REF" >/dev/null 2>&1; then
      docker pull "$DIND_IMAGE_REF"
    fi

    docker rm -f "$DIND_CONTAINER_NAME" >/dev/null 2>&1 || true
    docker volume create "$DIND_HOME_VOLUME_NAME" >/dev/null
    docker volume create "$DIND_WORKSPACES_VOLUME_NAME" >/dev/null
    docker volume create "$DIND_DOCKER_VOLUME_NAME" >/dev/null

    docker run -d \
      --name "$DIND_CONTAINER_NAME" \
      --restart unless-stopped \
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
      -v "${DIND_HOME_VOLUME_NAME}:${DIND_HOME_PATH}" \
      -v "${DIND_WORKSPACES_VOLUME_NAME}:${DIND_WORKSPACES_PATH}" \
      -v "${DIND_DOCKER_VOLUME_NAME}:/var/lib/docker" \
      "$DIND_IMAGE_REF"

    echo "Started ${DIND_CONTAINER_NAME} (prod mode)"
    echo "Image: ${DIND_IMAGE_REF}"
    echo "Home volume mounted: ${DIND_HOME_VOLUME_NAME} -> ${DIND_HOME_PATH}"
    echo "Workspaces volume mounted: ${DIND_WORKSPACES_VOLUME_NAME} -> ${DIND_WORKSPACES_PATH}"
    echo "Docker volume mounted: ${DIND_DOCKER_VOLUME_NAME} -> /var/lib/docker"
    echo "Published ports: ${HOST_PORT_RANGE_START}-${HOST_PORT_RANGE_END} -> ${DIND_PORT_RANGE_START}-${DIND_PORT_RANGE_END}"
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
