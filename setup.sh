#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
DEV_ENV_EXAMPLE="${SCRIPT_DIR}/.env.dev.example"

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$DEV_ENV_EXAMPLE" ]; then
    echo "Missing dev env template: $DEV_ENV_EXAMPLE" >&2
    exit 1
  fi
  cp "$DEV_ENV_EXAMPLE" "$ENV_FILE"
  echo "Created .env from $(basename "$DEV_ENV_EXAMPLE")"
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

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

resolve_path() {
  local raw_path="$1"
  python3 - "$raw_path" "$SCRIPT_DIR" <<'PY'
import os
import sys

raw = sys.argv[1]
base = sys.argv[2]
if os.path.isabs(raw):
    print(raw)
else:
    print(os.path.abspath(os.path.join(base, raw)))
PY
}

DIND_HOME_PATH="${DIND_HOME_PATH:-/.vibeboyrunner}"
DIND_WORKDIR_PATH="${DIND_WORKDIR_PATH:-/workdir}"
DIND_WORKSPACES_PATH="${DIND_WORKSPACES_PATH:-${DIND_WORKDIR_PATH}/workspaces}"
DIND_SERVICES_PATH="${DIND_SERVICES_PATH:-/vibeboyrunner/services}"
AGENT_PROVIDERS="${AGENT_PROVIDERS:-cursor}"
MANAGER_PORT="${MANAGER_PORT:-18080}"
APP_COMPOSE_SERVICE_NAME="${APP_COMPOSE_SERVICE_NAME:-app}"
MANAGER_AGENT_MODEL="${MANAGER_AGENT_MODEL:-GPT-5.3 Codex Low Fast}"
MANAGER_AGENT_FORCE="${MANAGER_AGENT_FORCE:-true}"
MANAGER_AGENT_SANDBOX="${MANAGER_AGENT_SANDBOX:-disabled}"
GIT_USER_NAME="${GIT_USER_NAME:-VibeBoyRunner Father}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-father@vibeboyrunner.local}"
ONBOARDING_APP_REPO="${ONBOARDING_APP_REPO:-vibeboyrunner/onboarding-app}"
HOST_PORT_RANGE_START="${HOST_PORT_RANGE_START:-20000}"
HOST_PORT_RANGE_END="${HOST_PORT_RANGE_END:-20499}"
DIND_PORT_RANGE_START="${DIND_PORT_RANGE_START:-20000}"
DIND_PORT_RANGE_END="${DIND_PORT_RANGE_END:-20499}"
DIND_CONTAINER_NAME="${DIND_CONTAINER_NAME:-vbr-dind}"
DIND_DOCKER_VOLUME_NAME="${DIND_DOCKER_VOLUME_NAME:-${DIND_CONTAINER_NAME}-docker-data}"

validate_port_range "$HOST_PORT_RANGE_START" "$HOST_PORT_RANGE_END" "host port range"
validate_port_range "$DIND_PORT_RANGE_START" "$DIND_PORT_RANGE_END" "dind port range"

host_span=$((HOST_PORT_RANGE_END - HOST_PORT_RANGE_START))
dind_span=$((DIND_PORT_RANGE_END - DIND_PORT_RANGE_START))
if [ "$host_span" -ne "$dind_span" ]; then
  echo "Host and dind port ranges must have equal size (got ${host_span} vs ${dind_span})" >&2
  exit 1
fi

HOST_HOME_ABS="$(resolve_path "${HOST_HOME_PATH}")"
HOST_WORKSPACES_ABS="$(resolve_path "${HOST_WORKSPACES_PATH}")"
DIND_IMAGE_NAME="${DIND_IMAGE_NAME:-vbr-dind:local}"

mkdir -p "$HOST_HOME_ABS" "$HOST_WORKSPACES_ABS"
docker build -t "$DIND_IMAGE_NAME" "$SCRIPT_DIR"
docker rm -f "$DIND_CONTAINER_NAME" >/dev/null 2>&1 || true
docker volume create "$DIND_DOCKER_VOLUME_NAME" >/dev/null

docker run -d \
  --name "$DIND_CONTAINER_NAME" \
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
  -v "${HOST_HOME_ABS}:${DIND_HOME_PATH}" \
  -v "${HOST_WORKSPACES_ABS}:${DIND_WORKSPACES_PATH}" \
  -v "${DIND_DOCKER_VOLUME_NAME}:/var/lib/docker" \
  "$DIND_IMAGE_NAME"

echo "Started ${DIND_CONTAINER_NAME} (dev mode)"
echo "Host home mounted: ${HOST_HOME_ABS} -> ${DIND_HOME_PATH}"
echo "Host workspaces mounted: ${HOST_WORKSPACES_ABS} -> ${DIND_WORKSPACES_PATH}"
echo "Docker volume mounted: ${DIND_DOCKER_VOLUME_NAME} -> /var/lib/docker"
echo "Published ports: ${HOST_PORT_RANGE_START}-${HOST_PORT_RANGE_END} -> ${DIND_PORT_RANGE_START}-${DIND_PORT_RANGE_END}"
echo "Logs: ${HOST_HOME_ABS}/runtime/logs.log"
