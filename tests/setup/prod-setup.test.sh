#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIND_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=./helpers.sh
source "$SCRIPT_DIR/helpers.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PROD_TEMPLATE="$DIND_ROOT/setup.sh.tmpl"

# ---------------------------------------------------------------------------
suite "Template placeholders"
# ---------------------------------------------------------------------------

test_template_has_placeholders() {
  local content
  content="$(cat "$PROD_TEMPLATE")"
  assert_contains "has __DEFAULT_DIND_IMAGE_REF__" "$content" "__DEFAULT_DIND_IMAGE_REF__"
  assert_contains "has __DEFAULT_SETUP_SCRIPT_URL__" "$content" "__DEFAULT_SETUP_SCRIPT_URL__"
}
test_template_has_placeholders

test_template_renders_placeholders() {
  local rendered="$TMP_DIR/setup-rendered.sh"
  sed \
    -e 's|__DEFAULT_DIND_IMAGE_REF__|myorg/vbr-dind:1.0.0|g' \
    -e 's|__DEFAULT_SETUP_SCRIPT_URL__|https://example.com/setup.sh|g' \
    "$PROD_TEMPLATE" > "$rendered"

  local content
  content="$(cat "$rendered")"
  assert_not_contains "rendered has no __DEFAULT_DIND_IMAGE_REF__" "$content" "__DEFAULT_DIND_IMAGE_REF__"
  assert_not_contains "rendered has no __DEFAULT_SETUP_SCRIPT_URL__" "$content" "__DEFAULT_SETUP_SCRIPT_URL__"
  assert_contains "rendered includes image ref" "$content" "myorg/vbr-dind:1.0.0"
  assert_contains "rendered includes setup URL" "$content" "https://example.com/setup.sh"
}
test_template_renders_placeholders

# ---------------------------------------------------------------------------
suite "Command parsing"
# ---------------------------------------------------------------------------

# Render a full prod script: template preamble (with baked values) + shared body.
# Mirrors what the CI publish workflow does.
render_script() {
  sed \
    -e 's|__DEFAULT_DIND_IMAGE_REF__|test/image:1.0|g' \
    -e 's|__DEFAULT_SETUP_SCRIPT_URL__|https://test.com/setup.sh|g' \
    "$PROD_TEMPLATE"
  sed -n '/^# __SHARED_BODY_START__$/,/^# __SHARED_BODY_END__$/p' \
    "$DIND_ROOT/setup.sh"
}

test_default_command_is_up() {
  local content
  content="$(render_script)"
  assert_contains "default COMMAND is up" "$content" 'COMMAND="up"'
}
test_default_command_is_up

test_help_text() {
  local rendered="$TMP_DIR/setup-help.sh"
  render_script > "$rendered"
  chmod +x "$rendered"

  local output
  output="$(bash "$rendered" help 2>&1)" || true
  assert_contains "help shows install command" "$output" "install"
  assert_contains "help shows up command" "$output" "up"
  assert_contains "help shows down command" "$output" "down"
  assert_contains "help shows status command" "$output" "status"
  assert_contains "help shows logs command" "$output" "logs"
}
test_help_text

test_unknown_command_rejected() {
  local rendered="$TMP_DIR/setup-unknown.sh"
  render_script > "$rendered"
  chmod +x "$rendered"

  # Override docker to be a no-op so we don't need real docker
  export PATH="$TMP_DIR/bin:$PATH"
  mkdir -p "$TMP_DIR/bin"
  cat > "$TMP_DIR/bin/docker" <<'EOF'
#!/bin/bash
echo "mock-docker $@"
exit 0
EOF
  chmod +x "$TMP_DIR/bin/docker"

  local output
  local exit_code=0
  output="$(bash "$rendered" foobar 2>&1)" || exit_code=$?
  assert_eq "unknown command exits non-zero" "1" "$exit_code"
  assert_contains "unknown command error message" "$output" "Unknown command"
}
test_unknown_command_rejected

test_unknown_argument_rejected() {
  local rendered="$TMP_DIR/setup-arg.sh"
  render_script > "$rendered"
  chmod +x "$rendered"

  local output
  local exit_code=0
  output="$(bash "$rendered" up --bogus 2>&1)" || exit_code=$?
  assert_eq "unknown argument exits non-zero" "1" "$exit_code"
  assert_contains "unknown argument error message" "$output" "Unknown argument"
}
test_unknown_argument_rejected

# ---------------------------------------------------------------------------
suite "Port validation (prod)"
# ---------------------------------------------------------------------------

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

test_prod_valid_port_range() {
  local output
  output="$(validate_port_range 20000 20499 "prod port range" 2>&1)"
  assert_exit_code "valid prod range" "0" "$?"
}
test_prod_valid_port_range

test_prod_invalid_port_range() {
  local output
  output="$(validate_port_range 70000 80000 "prod port range" 2>&1)" || true
  assert_contains "rejects invalid prod range" "$output" "expected 1<=start<=end<=65535"
}
test_prod_invalid_port_range

# ---------------------------------------------------------------------------
suite "Default variables (prod)"
# ---------------------------------------------------------------------------

test_prod_default_variables() {
  unset DIND_CONTAINER_NAME DIND_HOME_PATH MANAGER_PORT HOST_PORT_RANGE_START 2>/dev/null || true

  local container_name="${DIND_CONTAINER_NAME:-vibeboyrunner}"
  local home_path="${DIND_HOME_PATH:-/.vibeboyrunner}"
  local manager_port="${MANAGER_PORT:-18080}"
  local host_start="${HOST_PORT_RANGE_START:-20000}"

  assert_eq "prod default container name" "vibeboyrunner" "$container_name"
  assert_eq "prod default home path" "/.vibeboyrunner" "$home_path"
  assert_eq "prod default manager port" "18080" "$manager_port"
  assert_eq "prod default host port start" "20000" "$host_start"
}
test_prod_default_variables

# ---------------------------------------------------------------------------
suite "Volume names (prod)"
# ---------------------------------------------------------------------------

test_prod_volume_names() {
  local container_name="vibeboyrunner"
  local home_vol="${DIND_HOME_VOLUME_NAME:-${container_name}-home}"
  local ws_vol="${DIND_WORKSPACES_VOLUME_NAME:-${container_name}-workspaces}"
  local docker_vol="${DIND_DOCKER_VOLUME_NAME:-${container_name}-docker-data}"

  assert_eq "home volume name" "vibeboyrunner-home" "$home_vol"
  assert_eq "workspaces volume name" "vibeboyrunner-workspaces" "$ws_vol"
  assert_eq "docker volume name" "vibeboyrunner-docker-data" "$docker_vol"
}
test_prod_volume_names

# ---------------------------------------------------------------------------
suite "Install command (prod)"
# ---------------------------------------------------------------------------

test_install_creates_cli() {
  local rendered="$TMP_DIR/setup-install.sh"
  render_script > "$rendered"
  chmod +x "$rendered"

  # Override curl to write a fake binary
  mkdir -p "$TMP_DIR/install-bin"
  cat > "$TMP_DIR/install-bin/curl" <<'EOF'
#!/bin/bash
# Simulate downloading by writing something to the -o target
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) echo "#!/bin/bash\necho vibeboyrunner" > "$2"; shift 2 ;;
    *) shift ;;
  esac
done
EOF
  chmod +x "$TMP_DIR/install-bin/curl"

  local test_home="$TMP_DIR/install-home"
  mkdir -p "$test_home"

  # Pre-create .zshrc so we can check PATH addition
  touch "$test_home/.zshrc"

  HOME="$test_home" SHELL="/bin/zsh" PATH="$TMP_DIR/install-bin:$PATH" \
    bash "$rendered" install 2>&1 || true

  assert_file_exists "CLI binary created" "$test_home/.vibeboyrunner/bin/vibeboyrunner"
  assert_contains "PATH export added to .zshrc" "$(cat "$test_home/.zshrc")" '.vibeboyrunner/bin'
}
test_install_creates_cli

test_install_idempotent_path_export() {
  local rendered="$TMP_DIR/setup-install2.sh"
  render_script > "$rendered"
  chmod +x "$rendered"

  mkdir -p "$TMP_DIR/install-bin2"
  cat > "$TMP_DIR/install-bin2/curl" <<'EOF'
#!/bin/bash
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) echo "#!/bin/bash" > "$2"; shift 2 ;;
    *) shift ;;
  esac
done
EOF
  chmod +x "$TMP_DIR/install-bin2/curl"

  local test_home="$TMP_DIR/install-home2"
  mkdir -p "$test_home"
  touch "$test_home/.zshrc"

  HOME="$test_home" SHELL="/bin/zsh" PATH="$TMP_DIR/install-bin2:$PATH" \
    bash "$rendered" install 2>&1 || true
  HOME="$test_home" SHELL="/bin/zsh" PATH="$TMP_DIR/install-bin2:$PATH" \
    bash "$rendered" install 2>&1 || true

  local count
  count="$(grep -c '.vibeboyrunner/bin' "$test_home/.zshrc")"
  assert_eq "PATH export added only once" "1" "$count"
}
test_install_idempotent_path_export

# ---------------------------------------------------------------------------
suite "Docker run construction (prod dry)"
# ---------------------------------------------------------------------------

test_prod_docker_run_args() {
  local DIND_CONTAINER_NAME="vibeboyrunner"
  local DIND_IMAGE_REF="myorg/vbr-dind:2.0.0"
  local DIND_HOME_PATH="/.vibeboyrunner"
  local DIND_HOME_VOLUME_NAME="${DIND_CONTAINER_NAME}-home"
  local DIND_WORKSPACES_VOLUME_NAME="${DIND_CONTAINER_NAME}-workspaces"
  local DIND_DOCKER_VOLUME_NAME="${DIND_CONTAINER_NAME}-docker-data"
  local HOST_PORT_RANGE_START=20000
  local HOST_PORT_RANGE_END=20499
  local DIND_PORT_RANGE_START=20000
  local DIND_PORT_RANGE_END=20499

  local cmd="docker run -d --name $DIND_CONTAINER_NAME --restart unless-stopped --privileged"
  cmd+=" -v ${DIND_HOME_VOLUME_NAME}:${DIND_HOME_PATH}"
  cmd+=" -v ${DIND_DOCKER_VOLUME_NAME}:/var/lib/docker"
  cmd+=" -p ${HOST_PORT_RANGE_START}-${HOST_PORT_RANGE_END}:${DIND_PORT_RANGE_START}-${DIND_PORT_RANGE_END}"
  cmd+=" $DIND_IMAGE_REF"

  assert_contains "prod includes --restart unless-stopped" "$cmd" "--restart unless-stopped"
  assert_contains "prod includes --privileged" "$cmd" "--privileged"
  assert_contains "prod includes home volume" "$cmd" "vibeboyrunner-home:/.vibeboyrunner"
  assert_contains "prod includes docker volume" "$cmd" "vibeboyrunner-docker-data:/var/lib/docker"
  assert_contains "prod includes port mapping" "$cmd" "20000-20499:20000-20499"
  assert_contains "prod includes image ref" "$cmd" "myorg/vbr-dind:2.0.0"
}
test_prod_docker_run_args

# ---------------------------------------------------------------------------
suite "Image override via --image flag"
# ---------------------------------------------------------------------------

test_image_arg_parsing() {
  local IMAGE_ARG=""
  local DIND_IMAGE_REF="default/image:latest"

  # Simulate flag parsing
  local args=("--image" "custom/image:v2")
  while [ "${#args[@]}" -gt 0 ]; do
    case "${args[0]}" in
      --image)
        IMAGE_ARG="${args[1]:-}"
        args=("${args[@]:2}")
        ;;
      *)
        args=("${args[@]:1}")
        ;;
    esac
  done

  DIND_IMAGE_REF="${IMAGE_ARG:-$DIND_IMAGE_REF}"
  assert_eq "--image flag overrides default ref" "custom/image:v2" "$DIND_IMAGE_REF"
}
test_image_arg_parsing

test_default_image_when_no_flag() {
  local IMAGE_ARG=""
  local DIND_IMAGE_REF="default/image:latest"

  DIND_IMAGE_REF="${IMAGE_ARG:-$DIND_IMAGE_REF}"
  assert_eq "default ref when no --image flag" "default/image:latest" "$DIND_IMAGE_REF"
}
test_default_image_when_no_flag

# ---------------------------------------------------------------------------
report
