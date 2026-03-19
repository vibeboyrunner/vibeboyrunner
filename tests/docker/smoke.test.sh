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

# ---------------------------------------------------------------------------
report
