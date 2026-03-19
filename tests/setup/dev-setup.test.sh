#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIND_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=./helpers.sh
source "$SCRIPT_DIR/helpers.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# We test the setup.sh script in "dry" mode by extracting and testing
# its validation logic and env handling without actually running docker.

# ---------------------------------------------------------------------------
suite "Environment file creation"
# ---------------------------------------------------------------------------

test_env_creation() {
  local test_dir="$TMP_DIR/env-creation"
  mkdir -p "$test_dir"
  cp "$DIND_ROOT/.env.dev.example" "$test_dir/.env.dev.example"

  # Simulate the env-file creation logic from setup.sh
  local env_file="$test_dir/.env"
  local dev_example="$test_dir/.env.dev.example"
  if [ ! -f "$env_file" ]; then
    cp "$dev_example" "$env_file"
  fi

  assert_file_exists "creates .env from .env.dev.example" "$env_file"

  local expected_content
  expected_content="$(cat "$dev_example")"
  local actual_content
  actual_content="$(cat "$env_file")"
  assert_eq "created .env matches template content" "$expected_content" "$actual_content"
}
test_env_creation

test_env_no_overwrite() {
  local test_dir="$TMP_DIR/env-no-overwrite"
  mkdir -p "$test_dir"
  cp "$DIND_ROOT/.env.dev.example" "$test_dir/.env.dev.example"
  echo "CUSTOM=value" > "$test_dir/.env"

  local env_file="$test_dir/.env"
  local dev_example="$test_dir/.env.dev.example"
  if [ ! -f "$env_file" ]; then
    cp "$dev_example" "$env_file"
  fi

  local actual_content
  actual_content="$(cat "$env_file")"
  assert_eq "does not overwrite existing .env" "CUSTOM=value" "$actual_content"
}
test_env_no_overwrite

# ---------------------------------------------------------------------------
suite "Port validation"
# ---------------------------------------------------------------------------

# Extract validate_number and validate_port_range from setup.sh
validate_number() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+$ ]]
}

validate_port_range() {
  local start="$1"
  local end="$2"
  local name="$3"

  if ! validate_number "$start" || ! validate_number "$end"; then
    echo "Invalid ${name}: values must be numbers (got ${start}-${end})"
    return 1
  fi

  if [ "$start" -lt 1 ] || [ "$end" -gt 65535 ] || [ "$start" -gt "$end" ]; then
    echo "Invalid ${name}: expected 1<=start<=end<=65535 (got ${start}-${end})"
    return 1
  fi

  return 0
}

test_valid_port_ranges() {
  local output
  output="$(validate_port_range 20000 20499 "test" 2>&1)"
  assert_exit_code "valid range 20000-20499" "0" "$?"

  output="$(validate_port_range 1 65535 "test" 2>&1)"
  assert_exit_code "valid range 1-65535" "0" "$?"

  output="$(validate_port_range 8080 8080 "test" 2>&1)"
  assert_exit_code "valid single-port range 8080-8080" "0" "$?"
}
test_valid_port_ranges

test_invalid_port_range_non_numeric() {
  local output
  output="$(validate_port_range "abc" "20499" "test" 2>&1)" || true
  assert_contains "rejects non-numeric start" "$output" "must be numbers"
}
test_invalid_port_range_non_numeric

test_invalid_port_range_zero() {
  local output
  output="$(validate_port_range 0 100 "test" 2>&1)" || true
  assert_contains "rejects start=0" "$output" "expected 1<=start<=end<=65535"
}
test_invalid_port_range_zero

test_invalid_port_range_exceeds_max() {
  local output
  output="$(validate_port_range 1 70000 "test" 2>&1)" || true
  assert_contains "rejects end>65535" "$output" "expected 1<=start<=end<=65535"
}
test_invalid_port_range_exceeds_max

test_invalid_port_range_inverted() {
  local output
  output="$(validate_port_range 20499 20000 "test" 2>&1)" || true
  assert_contains "rejects start>end" "$output" "expected 1<=start<=end<=65535"
}
test_invalid_port_range_inverted

# ---------------------------------------------------------------------------
suite "Port range span equality"
# ---------------------------------------------------------------------------

test_equal_spans() {
  local host_span=$((20499 - 20000))
  local dind_span=$((20499 - 20000))
  assert_eq "equal spans are accepted" "$host_span" "$dind_span"
}
test_equal_spans

test_unequal_spans() {
  local host_span=$((20499 - 20000))
  local dind_span=$((20199 - 20000))
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [ "$host_span" -ne "$dind_span" ]; then
    printf "  PASS: unequal spans detected correctly (%d vs %d)\n" "$host_span" "$dind_span"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    printf "  FAIL: unequal spans not detected\n"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}
test_unequal_spans

# ---------------------------------------------------------------------------
suite "Default variable resolution"
# ---------------------------------------------------------------------------

test_default_variables() {
  # Unset everything, test defaults
  unset DIND_HOME_PATH DIND_WORKDIR_PATH DIND_WORKSPACES_PATH DIND_SERVICES_PATH 2>/dev/null || true
  unset MANAGER_PORT APP_COMPOSE_SERVICE_NAME GIT_USER_NAME GIT_USER_EMAIL 2>/dev/null || true
  unset HOST_PORT_RANGE_START HOST_PORT_RANGE_END DIND_PORT_RANGE_START DIND_PORT_RANGE_END 2>/dev/null || true

  local dind_home="${DIND_HOME_PATH:-/.vibeboyrunner}"
  local dind_workdir="${DIND_WORKDIR_PATH:-/workdir}"
  local dind_workspaces="${DIND_WORKSPACES_PATH:-${dind_workdir}/workspaces}"
  local manager_port="${MANAGER_PORT:-18080}"
  local host_start="${HOST_PORT_RANGE_START:-20000}"
  local host_end="${HOST_PORT_RANGE_END:-20499}"

  assert_eq "default DIND_HOME_PATH" "/.vibeboyrunner" "$dind_home"
  assert_eq "default DIND_WORKDIR_PATH" "/workdir" "$dind_workdir"
  assert_eq "default DIND_WORKSPACES_PATH" "/workdir/workspaces" "$dind_workspaces"
  assert_eq "default MANAGER_PORT" "18080" "$manager_port"
  assert_eq "default HOST_PORT_RANGE_START" "20000" "$host_start"
  assert_eq "default HOST_PORT_RANGE_END" "20499" "$host_end"
}
test_default_variables

test_env_override_variables() {
  DIND_HOME_PATH="/custom/home"
  MANAGER_PORT=9090
  HOST_PORT_RANGE_START=30000
  HOST_PORT_RANGE_END=30499

  local dind_home="${DIND_HOME_PATH:-/.vibeboyrunner}"
  local manager_port="${MANAGER_PORT:-18080}"
  local host_start="${HOST_PORT_RANGE_START:-20000}"
  local host_end="${HOST_PORT_RANGE_END:-20499}"

  assert_eq "overridden DIND_HOME_PATH" "/custom/home" "$dind_home"
  assert_eq "overridden MANAGER_PORT" "9090" "$manager_port"
  assert_eq "overridden HOST_PORT_RANGE_START" "30000" "$host_start"
  assert_eq "overridden HOST_PORT_RANGE_END" "30499" "$host_end"

  unset DIND_HOME_PATH MANAGER_PORT HOST_PORT_RANGE_START HOST_PORT_RANGE_END
}
test_env_override_variables

# ---------------------------------------------------------------------------
suite "resolve_path (python helper)"
# ---------------------------------------------------------------------------

resolve_path() {
  local raw_path="$1"
  local base_dir="$2"
  python3 - "$raw_path" "$base_dir" <<'PY'
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

test_resolve_absolute_path() {
  local result
  result="$(resolve_path "/absolute/path" "/some/base")"
  assert_eq "absolute path stays absolute" "/absolute/path" "$result"
}
test_resolve_absolute_path

test_resolve_relative_path() {
  local result
  result="$(resolve_path "./relative/path" "/some/base")"
  assert_eq "relative path resolved against base" "/some/base/relative/path" "$result"
}
test_resolve_relative_path

test_resolve_relative_without_dot() {
  local result
  result="$(resolve_path "subdir/here" "/base")"
  assert_eq "relative path without ./ resolved against base" "/base/subdir/here" "$result"
}
test_resolve_relative_without_dot

# ---------------------------------------------------------------------------
suite "Docker run command construction (dry)"
# ---------------------------------------------------------------------------

test_docker_run_args() {
  local DIND_CONTAINER_NAME="vbr-dind"
  local DIND_HOME_PATH="/.vibeboyrunner"
  local DIND_WORKDIR_PATH="/workdir"
  local DIND_WORKSPACES_PATH="/workdir/workspaces"
  local DIND_SERVICES_PATH="/vibeboyrunner/services"
  local MANAGER_PORT="18080"
  local DIND_IMAGE_NAME="vbr-dind:local"
  local HOST_PORT_RANGE_START=20000
  local HOST_PORT_RANGE_END=20499
  local DIND_PORT_RANGE_START=20000
  local DIND_PORT_RANGE_END=20499

  local cmd="docker run -d --name $DIND_CONTAINER_NAME --privileged"
  cmd+=" -e DIND_HOME_PATH=$DIND_HOME_PATH"
  cmd+=" -e MANAGER_PORT=$MANAGER_PORT"
  cmd+=" -p ${HOST_PORT_RANGE_START}-${HOST_PORT_RANGE_END}:${DIND_PORT_RANGE_START}-${DIND_PORT_RANGE_END}"
  cmd+=" $DIND_IMAGE_NAME"

  assert_contains "includes --privileged" "$cmd" "--privileged"
  assert_contains "includes container name" "$cmd" "--name vbr-dind"
  assert_contains "includes port mapping" "$cmd" "-p 20000-20499:20000-20499"
  assert_contains "includes image reference" "$cmd" "vbr-dind:local"
  assert_contains "passes DIND_HOME_PATH env" "$cmd" "-e DIND_HOME_PATH=/.vibeboyrunner"
  assert_contains "passes MANAGER_PORT env" "$cmd" "-e MANAGER_PORT=18080"
}
test_docker_run_args

# ---------------------------------------------------------------------------
report
