# Configuration Reference

This document contains full configuration details for `services/dind`, including environment model, setup script generation, and mount behavior.

## Setup Script Structure

All setup logic lives in a single source (`setup.sh`) to prevent drift between dev and prod.

| File            | Purpose                                                               |
| --------------- | --------------------------------------------------------------------- |
| `setup.sh`      | Dev preamble + shared body (single source of truth for all logic)     |
| `setup.sh.tmpl` | Static 3-line prod header (`VBR_MODE="prod"`); CI generates the rest  |
| `.env.example`  | Full env contract with `__SHARED__`, `__DEV__`, `__PROD__` sections   |

`setup.sh` has two sections separated by markers:

1. **Dev preamble**: loads SHARED + DEV vars from `.env` (excluding PROD), resolves host bind-mount paths, sets `VBR_MODE=dev`.
2. **Shared body** (`# __SHARED_BODY_START__` / `# __SHARED_BODY_END__`): validation, subcommands, and `docker run` flags. It branches on `VBR_MODE` only for true mode differences.

| Behavior       | Dev                      | Prod                        |
| -------------- | ------------------------ | --------------------------- |
| Image          | `docker build` locally   | `docker pull` from registry |
| Storage        | Bind mounts (host paths) | Named Docker volumes        |
| Restart policy | None                     | `unless-stopped`            |
| Install cmd    | N/A                      | `curl` from release URL     |

## Environment Variables (Full Reference)

Configured via `.env` (generated from `.env.example`). Variables are organized in `__SHARED__`, `__DEV__`, and `__PROD__` sections.

| Variable                   | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `HOST_HOME_PATH`           | Host path for persistent dind state                       |
| `HOST_WORKSPACES_PATH`     | Host path for persistent workspaces                       |
| `DIND_HOME_PATH`           | Mounted path inside container for state root              |
| `DIND_WORKDIR_PATH`        | Container working directory                               |
| `DIND_WORKSPACES_PATH`     | Mounted path inside container for workspaces              |
| `DIND_SERVICES_PATH`       | Mounted path inside container for services root           |
| `DIND_IMAGE_NAME`          | Docker image name to build/run (dev)                      |
| `DIND_CONTAINER_NAME`      | Container name                                            |
| `DIND_DOCKER_VOLUME_NAME`  | Named volume for `/var/lib/docker` (inner Docker cache)   |
| `AGENT_PROVIDERS`          | Comma-separated providers to render (currently: `cursor`) |
| `MANAGER_PORT`             | Manager HTTP port inside dind                             |
| `APP_COMPOSE_SERVICE_NAME` | Compose service name treated as the main app container    |
| `MANAGER_AGENT_MODEL`      | Default model for `/api/agent/run`                        |
| `GIT_USER_NAME`            | Git identity name                                         |
| `GIT_USER_EMAIL`           | Git identity email                                        |
| `HOST_PORT_RANGE_START`    | Host range start port (inclusive)                         |
| `HOST_PORT_RANGE_END`      | Host range end port (inclusive)                           |
| `DIND_PORT_RANGE_START`    | Container range start port (inclusive)                    |
| `DIND_PORT_RANGE_END`      | Container range end port (inclusive)                      |

Default port mapping: `20000-20499` on host mapped 1:1 into the container.

## Mounts (Dev)

- `HOST_HOME_PATH` -> `DIND_HOME_PATH`
- `HOST_WORKSPACES_PATH` -> `DIND_WORKSPACES_PATH`
- `DIND_DOCKER_VOLUME_NAME` -> `/var/lib/docker`
- Host port range -> container port range

Logs are written to `DIND_HOME_PATH/runtime/logs.log` (on host: `HOST_HOME_PATH/runtime/logs.log`).

## CI Rendering Contract

`.env.example` is the single source of truth for defaults:

- `# __SHARED__`: vars identical for both modes
- `# __DEV__`: dev-only vars (bind mounts, local image)
- `# __PROD__`: prod-only vars and overrides

At publish time, CI reads SHARED + PROD vars, generates `: "${VAR:=value}"` preamble lines, and concatenates:

1. `setup.sh.tmpl` header
2. Generated preamble
3. Shared body from `setup.sh`

Result: a self-contained distributable setup script with no placeholders.
