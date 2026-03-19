#!/usr/bin/env bash
set -euo pipefail

log() {
  local level="$1"
  shift
  printf '[%s] [%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$level" "$*"
}

ensure_dir() {
  local dir_path="$1"
  mkdir -p "$dir_path"
}

ensure_file() {
  local file_path="$1"
  ensure_dir "$(dirname "$file_path")"
  touch "$file_path"
}

seed_file_if_missing() {
  local template_path="$1"
  local target_path="$2"

  ensure_dir "$(dirname "$target_path")"

  if [ -s "$target_path" ]; then
    return
  fi

  if [ -f "$template_path" ]; then
    cp "$template_path" "$target_path"
    log INFO "Seeded file from template: ${target_path}"
  else
    touch "$target_path"
    log WARN "Template missing; created empty file: ${target_path}"
  fi
}

ensure_symlink() {
  local source_path="$1"
  local target_path="$2"

  ensure_dir "$(dirname "$target_path")"

  if [ -L "$target_path" ]; then
    ln -sfn "$source_path" "$target_path"
    return
  fi

  if [ -e "$target_path" ]; then
    local backup_path="${target_path}.backup.$(date +%s)"
    mv "$target_path" "$backup_path"
    log WARN "Moved existing path to backup: $backup_path"
  fi

  ln -sfn "$source_path" "$target_path"
}

init_agents_store() {
  local bootstrap_agents_root="${BOOTSTRAP_AGENTS_PATH:-/opt/vbr-bootstrap/agents}"
  local agents_root="${DIND_HOME_PATH}/agents"
  local father_template_root="${bootstrap_agents_root}/father"
  local father_root="${agents_root}/father"
  local father_skill="${father_root}/skill.md"
  local father_rule="${father_root}/rule.mdc"

  ensure_dir "$father_root"
  seed_file_if_missing "${father_template_root}/skill.md" "$father_skill"
  seed_file_if_missing "${father_template_root}/rule.mdc" "$father_rule"

  log INFO "Initialized agents store at ${agents_root}"
}

render_agents_for_cursor_provider() {
  local father_root="${DIND_HOME_PATH}/agents/father"
  local workdir_cursor_root="${DIND_WORKDIR_PATH}/.cursor"

  ensure_dir "${workdir_cursor_root}/skills"
  ensure_dir "${workdir_cursor_root}/rules"
  ensure_dir "${workdir_cursor_root}/skills/father"

  # Cleanup legacy flat skill/rule paths from older bootstrap layouts.
  rm -f "${workdir_cursor_root}/skills/father.md"
  rm -f "${workdir_cursor_root}/rules/father.md"

  ensure_symlink "${father_root}/skill.md" "${workdir_cursor_root}/skills/father/SKILL.md"
  ensure_symlink "${father_root}/rule.mdc" "${workdir_cursor_root}/rules/father.mdc"

  log INFO "Rendered cursor provider agent links"
}

render_agents() {
  local providers="${AGENT_PROVIDERS:-cursor}"
  IFS=',' read -r -a provider_list <<< "$providers"

  for provider in "${provider_list[@]}"; do
    case "$provider" in
      cursor)
        render_agents_for_cursor_provider
        ;;
      *)
        log WARN "Unknown provider '${provider}' - skipping renderer"
        ;;
    esac
  done
}

init_service_states() {
  local service_name="$1"
  local service_root="${DIND_HOME_PATH}/services/${service_name}"
  local default_state_root="${service_root}/default"

  ensure_dir "$default_state_root"
  log INFO "Initialized service state: ${service_name}/default"
}

render_service_links() {
  local service_name="$1"
  local container_target="$2"
  local active_state_root="${DIND_HOME_PATH}/services/${service_name}/default"

  ensure_dir "$active_state_root"
  ensure_symlink "$active_state_root" "$container_target"
  log INFO "Linked service state for ${service_name}: ${container_target}"
}

init_services() {
  init_service_states "gh"
  init_service_states "cursor"

  # Service schema renderer: can be extended with more services later.
  render_service_links "gh" "/root/.config/gh"
  render_service_links "cursor" "/root/.config/cursor"
}

init_workspaces() {
  ensure_dir "${DIND_WORKSPACES_PATH}"

  local has_workspace="false"
  local candidate
  for candidate in "${DIND_WORKSPACES_PATH}"/*; do
    if [ -d "$candidate" ]; then
      has_workspace="true"
      break
    fi
  done

  if [ "$has_workspace" = "false" ]; then
    ensure_dir "${DIND_WORKSPACES_PATH}/onboarding/apps"
    ensure_dir "${DIND_WORKSPACES_PATH}/onboarding/features"
    log INFO "No workspaces found; created onboarding workspace scaffold"
  else
    log INFO "Existing workspaces detected"
  fi

  # Backfill required workspace structure for both existing and new workspaces.
  for candidate in "${DIND_WORKSPACES_PATH}"/*; do
    if [ -d "$candidate" ]; then
      ensure_dir "${candidate}/apps"
      ensure_dir "${candidate}/features"
    fi
  done
}

init_conversation_stores() {
  local state_root="${DIND_HOME_PATH}/state"
  local dind_father_cursor_root="${state_root}/conversations/dind/father/cursor"
  local pools_root="${state_root}/conversations/pools"

  ensure_dir "${dind_father_cursor_root}/dot-cursor"
  ensure_dir "$pools_root"

  # Persist father cursor conversation cache in dind home state.
  ensure_symlink "${dind_father_cursor_root}/dot-cursor" "/root/.cursor"
  log INFO "Initialized conversation stores under ${state_root}/conversations"
}

init_git_identity() {
  local git_user_name="${GIT_USER_NAME:-VibeBoyRunner Father}"
  local git_user_email="${GIT_USER_EMAIL:-father@vibeboyrunner.local}"
  local current_name=""
  local current_email=""

  current_name="$(git config --global --get user.name || true)"
  current_email="$(git config --global --get user.email || true)"

  if [ -z "$current_name" ]; then
    git config --global user.name "$git_user_name"
    log INFO "Configured global git user.name for dind: ${git_user_name}"
  fi

  if [ -z "$current_email" ]; then
    git config --global user.email "$git_user_email"
    log INFO "Configured global git user.email for dind: ${git_user_email}"
  fi
}

start_manager_service() {
  local services_root="${DIND_SERVICES_PATH:-/vibeboyrunner/services}"
  local manager_root="${services_root}/manager"
  local manager_entry="${manager_root}/src/server.ts"

  if ! command -v node >/dev/null 2>&1; then
    log WARN "Node.js is not available; manager service will not start"
    return
  fi

  if ! command -v npm >/dev/null 2>&1; then
    log WARN "npm is not available; manager service will not start"
    return
  fi

  if [ ! -f "$manager_entry" ] || [ ! -f "${manager_root}/package.json" ]; then
    log WARN "Manager entrypoint not found: ${manager_entry}"
    return
  fi

  if [ ! -d "${manager_root}/node_modules" ]; then
    log INFO "Installing manager dependencies at ${manager_root}"
    (cd "$manager_root" && npm install --no-audit --no-fund)
  fi

  (cd "$manager_root" && npm run build && npm run start) &
  local manager_pid="$!"
  log INFO "Started manager service pid=${manager_pid} entry=${manager_entry} mode=typescript-compiled"
}

main() {
  export DIND_HOME_PATH="${DIND_HOME_PATH:-/.vibeboyrunner}"
  export DIND_WORKDIR_PATH="${DIND_WORKDIR_PATH:-/workdir}"
  export DIND_WORKSPACES_PATH="${DIND_WORKSPACES_PATH:-${DIND_WORKDIR_PATH}/workspaces}"
  export DIND_SERVICES_PATH="${DIND_SERVICES_PATH:-/vibeboyrunner/services}"
  export BOOTSTRAP_AGENTS_PATH="${BOOTSTRAP_AGENTS_PATH:-/opt/vbr-bootstrap/agents}"
  export GIT_USER_NAME="${GIT_USER_NAME:-VibeBoyRunner Father}"
  export GIT_USER_EMAIL="${GIT_USER_EMAIL:-father@vibeboyrunner.local}"

  ensure_dir "${DIND_HOME_PATH}/runtime"
  local log_file="${DIND_HOME_PATH}/runtime/logs.log"
  ensure_file "$log_file"

  exec > >(tee -a "$log_file") 2>&1

  log INFO "Starting dind bootstrap"
  log INFO "DIND_HOME_PATH=${DIND_HOME_PATH}"
  log INFO "DIND_WORKDIR_PATH=${DIND_WORKDIR_PATH}"
  log INFO "DIND_WORKSPACES_PATH=${DIND_WORKSPACES_PATH}"

  ensure_dir "$DIND_HOME_PATH"
  ensure_dir "$DIND_WORKDIR_PATH"
  ensure_dir "$DIND_WORKSPACES_PATH"
  ensure_dir "$DIND_SERVICES_PATH"

  init_agents_store
  render_agents
  init_services
  init_workspaces
  init_conversation_stores
  init_git_identity
  start_manager_service

  cd "$DIND_WORKDIR_PATH"
  log INFO "Bootstrap completed; starting daemon command: $*"
  exec "$@"
}

main "$@"
