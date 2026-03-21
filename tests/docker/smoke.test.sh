#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIND_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=../setup/helpers.sh
source "$DIND_ROOT/tests/setup/helpers.sh"

CONTAINER_NAME="vbr-dind-smoke-test"
IMAGE_TAG="vbr-dind:smoke-test"
MANAGER_HOST_PORT=18180
BOOTSTRAP_TIMEOUT=90
MANAGER_TIMEOUT=30

# Use host jq if available, otherwise pipe through the dind container's jq.
jqp() {
  if command -v jq >/dev/null 2>&1; then
    jq "$@"
  else
    docker exec -i "$CONTAINER_NAME" jq "$@"
  fi
}

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
suite "Docker image build"
# ---------------------------------------------------------------------------

docker build -t "$IMAGE_TAG" "$DIND_ROOT"

TESTS_TOTAL=$((TESTS_TOTAL + 1))
TESTS_PASSED=$((TESTS_PASSED + 1))
printf "  PASS: image built successfully\n"

# ---------------------------------------------------------------------------
suite "Container startup"
# ---------------------------------------------------------------------------

docker run -d \
  --name "$CONTAINER_NAME" \
  --privileged \
  -e PORT_POOL_START=21000 \
  -e PORT_POOL_END=21009 \
  -p "${MANAGER_HOST_PORT}:18080" \
  -p "21000-21009:21000-21009" \
  "$IMAGE_TAG"

elapsed=0
interval=5
startup_ok=false
while [ "$elapsed" -lt "$BOOTSTRAP_TIMEOUT" ]; do
  # The manager starts in the background during bootstrap; its log line in docker
  # logs is the most reliable signal that the entrypoint ran to completion.
  # The entrypoint's own log lines may not appear in `docker logs` due to
  # pipe buffering between the tee redirect and exec.
  if docker logs "$CONTAINER_NAME" 2>&1 | grep -q "Manager service started"; then
    startup_ok=true
    break
  fi

  status="$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")"
  if [ "$status" = "restarting" ]; then
    printf "  Container is restart-looping. Last logs:\n"
    docker logs --tail 20 "$CONTAINER_NAME" 2>&1 | sed 's/^/    /'
    break
  fi

  sleep "$interval"
  elapsed=$((elapsed + interval))
done

TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ "$startup_ok" = "true" ]; then
  printf "  PASS: container startup completed within %ds\n" "$elapsed"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  printf "  FAIL: container did not start within %ds\n" "$BOOTSTRAP_TIMEOUT"
  printf "  Container logs:\n"
  docker logs --tail 30 "$CONTAINER_NAME" 2>&1 | sed 's/^/    /'
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ---------------------------------------------------------------------------
suite "Container health"
# ---------------------------------------------------------------------------

status="$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")"
assert_eq "container status is running" "running" "$status"

restart_count="$(docker inspect -f '{{.RestartCount}}' "$CONTAINER_NAME" 2>/dev/null || echo "-1")"
assert_eq "container restart count is 0" "0" "$restart_count"

# ---------------------------------------------------------------------------
suite "Docker-in-Docker"
# ---------------------------------------------------------------------------

docker_info_ok=false
docker exec "$CONTAINER_NAME" docker info >/dev/null 2>&1 && docker_info_ok=true

TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ "$docker_info_ok" = "true" ]; then
  printf "  PASS: dockerd is running inside container\n"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  printf "  FAIL: dockerd is not accessible inside container\n"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ---------------------------------------------------------------------------
suite "Manager service"
# ---------------------------------------------------------------------------

manager_elapsed=0
manager_ok=false
while [ "$manager_elapsed" -lt "$MANAGER_TIMEOUT" ]; do
  if curl -sf "http://localhost:${MANAGER_HOST_PORT}/health" >/dev/null 2>&1; then
    manager_ok=true
    break
  fi
  sleep 3
  manager_elapsed=$((manager_elapsed + 3))
done

TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ "$manager_ok" = "true" ]; then
  printf "  PASS: manager /health responds on port %d\n" "$MANAGER_HOST_PORT"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  printf "  FAIL: manager did not respond within %ds\n" "$MANAGER_TIMEOUT"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

POOL_UP_TIMEOUT=180

# ---------------------------------------------------------------------------
suite "Dev pool — scaffold test app"
# ---------------------------------------------------------------------------

scaffold_ok=false
docker exec "$CONTAINER_NAME" sh -c '
  APP_DIR="/workdir/workspaces/onboarding/apps/smokeapp"
  mkdir -p "$APP_DIR/.vibeboyrunner"

  cat > "$APP_DIR/.vibeboyrunner/Dockerfile" <<DEOF
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends bash curl ca-certificates && rm -rf /var/lib/apt/lists/*
CMD ["tail", "-f", "/dev/null"]
DEOF

  cat > "$APP_DIR/.vibeboyrunner/docker-compose.yml" <<DEOF
services:
  app:
    build:
      context: ..
      dockerfile: .vibeboyrunner/Dockerfile
    working_dir: /app
    volumes:
      - ..:/app
DEOF

  cat > "$APP_DIR/.vibeboyrunner/config.json" <<DEOF
{ "bindings": { "ports": {}, "envs": {} } }
DEOF
' && scaffold_ok=true

TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ "$scaffold_ok" = "true" ]; then
  printf "  PASS: test app scaffolded inside container\n"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  printf "  FAIL: failed to scaffold test app\n"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

docker exec "$CONTAINER_NAME" test -f /workdir/workspaces/onboarding/apps/smokeapp/.vibeboyrunner/docker-compose.yml
assert_exit_code "docker-compose.yml exists" "0" "$?"

docker exec "$CONTAINER_NAME" test -f /workdir/workspaces/onboarding/apps/smokeapp/.vibeboyrunner/config.json
assert_exit_code "config.json exists" "0" "$?"

# ---------------------------------------------------------------------------
suite "Dev pool — up"
# ---------------------------------------------------------------------------

POOL_UP_RESPONSE=""
pool_up_ok=false

POOL_UP_RESPONSE=$(curl -s --max-time "$POOL_UP_TIMEOUT" -X POST \
  "http://localhost:${MANAGER_HOST_PORT}/api/workspaces/onboarding/dev-pool/up" 2>/dev/null) && pool_up_ok=true

TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ "$pool_up_ok" = "true" ]; then
  printf "  PASS: dev-pool/up responded within %ds\n" "$POOL_UP_TIMEOUT"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  printf "  FAIL: dev-pool/up failed or timed out\n"
  printf "    Response: %s\n" "$POOL_UP_RESPONSE"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

up_ok=$(echo "$POOL_UP_RESPONSE" | jqp -r '.ok // empty' 2>/dev/null || true)
assert_eq "pool-up response ok" "true" "$up_ok"

apps_count=$(echo "$POOL_UP_RESPONSE" | jqp -r '.appsCount // empty' 2>/dev/null || true)
assert_eq "pool-up appsCount is 1" "1" "$apps_count"

app_status=$(echo "$POOL_UP_RESPONSE" | jqp -r '.results[0].status // empty' 2>/dev/null || true)
assert_eq "pool-up app status is up" "up" "$app_status"

has_cursor=$(echo "$POOL_UP_RESPONSE" | jqp -r '.agents.cursor // empty' 2>/dev/null || true)
TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ -n "$has_cursor" ]; then
  printf "  PASS: agents map contains cursor provider\n"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  printf "  FAIL: agents map missing cursor provider\n"
  printf "    Raw response: %.200s\n" "$POOL_UP_RESPONSE"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

warnings=$(echo "$POOL_UP_RESPONSE" | jqp -r '.results[0].runtimeWarnings // [] | .[]' 2>/dev/null || true)
if [ -n "$warnings" ]; then
  printf "  INFO: runtimeWarnings:\n"
  echo "$warnings" | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
suite "Dev pool — runtime injection and pools/ps"
# ---------------------------------------------------------------------------

APP_CONTAINER_ID=$(docker exec "$CONTAINER_NAME" docker ps -q --filter "label=com.docker.compose.service=app" 2>/dev/null | head -1)

TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ -n "$APP_CONTAINER_ID" ]; then
  printf "  PASS: app container is running (%s)\n" "${APP_CONTAINER_ID:0:12}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  printf "  FAIL: no app container found inside dind\n"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

if [ -n "$APP_CONTAINER_ID" ]; then
  agent_found=false
  docker exec "$CONTAINER_NAME" docker exec "$APP_CONTAINER_ID" sh -c "command -v agent" >/dev/null 2>&1 && agent_found=true
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [ "$agent_found" = "true" ]; then
    printf "  PASS: cursor agent binary found in app container\n"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    printf "  FAIL: cursor agent binary not found in app container\n"
    printf "    Checking /usr/local/bin/agent:\n"
    docker exec "$CONTAINER_NAME" docker exec "$APP_CONTAINER_ID" ls -la /usr/local/bin/agent 2>&1 | sed 's/^/      /' || true
    printf "    Checking /root/.local/bin/agent:\n"
    docker exec "$CONTAINER_NAME" docker exec "$APP_CONTAINER_ID" ls -la /root/.local/bin/agent 2>&1 | sed 's/^/      /' || true
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi

  agent_version_ok=false
  agent_version_out=$(docker exec "$CONTAINER_NAME" docker exec "$APP_CONTAINER_ID" timeout 10 agent --version 2>&1) && agent_version_ok=true
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [ "$agent_version_ok" = "true" ]; then
    printf "  PASS: agent --version succeeds (%s)\n" "$(echo "$agent_version_out" | head -1)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    printf "  FAIL: agent --version failed or timed out\n"
    printf "    Output: %s\n" "$agent_version_out"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi

  cursor_link=false
  docker exec "$CONTAINER_NAME" docker exec "$APP_CONTAINER_ID" test -L /root/.config/cursor && cursor_link=true
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [ "$cursor_link" = "true" ]; then
    printf "  PASS: /root/.config/cursor symlink exists\n"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    printf "  FAIL: /root/.config/cursor symlink missing\n"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi

  gh_link=false
  docker exec "$CONTAINER_NAME" docker exec "$APP_CONTAINER_ID" test -L /root/.config/gh && gh_link=true
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [ "$gh_link" = "true" ]; then
    printf "  PASS: /root/.config/gh symlink exists\n"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    printf "  FAIL: /root/.config/gh symlink missing\n"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
fi

PS_RESPONSE=$(curl -s "http://localhost:${MANAGER_HOST_PORT}/api/pools/ps" 2>/dev/null || true)
ps_ok=$(echo "$PS_RESPONSE" | jqp -r '.ok // empty' 2>/dev/null || true)
assert_eq "pools/ps response ok" "true" "$ps_ok"

ps_has_container=$(echo "$PS_RESPONSE" | jqp -r '.containers[0].ID // empty' 2>/dev/null || true)
TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ -n "$ps_has_container" ]; then
  printf "  PASS: pools/ps lists app container\n"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  printf "  FAIL: pools/ps returned no containers\n"
  printf "    Raw response: %.200s\n" "$PS_RESPONSE"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ---------------------------------------------------------------------------
suite "Dev pool — down"
# ---------------------------------------------------------------------------

DOWN_RESPONSE=$(curl -s --max-time 30 -X POST \
  "http://localhost:${MANAGER_HOST_PORT}/api/workspaces/onboarding/dev-pool/down" 2>/dev/null || true)

down_ok=$(echo "$DOWN_RESPONSE" | jqp -r '.ok // empty' 2>/dev/null || true)
assert_eq "pool-down response ok" "true" "$down_ok"

sleep 2
remaining=$(docker exec "$CONTAINER_NAME" docker ps -q --filter "label=com.docker.compose.service=app" 2>/dev/null || true)
TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ -z "$remaining" ]; then
  printf "  PASS: app container removed after pool-down\n"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  printf "  FAIL: app container still running after pool-down\n"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ---------------------------------------------------------------------------
report
