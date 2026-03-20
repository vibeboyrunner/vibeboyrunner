# VibeBoyRunner

[tests](https://github.com/vibeboyrunner/vibeboyrunner/actions/workflows/test.yml?query=branch%3Amain)
[publish](https://github.com/vibeboyrunner/vibeboyrunner/actions/workflows/publish.yml)
[release](https://github.com/vibeboyrunner/vibeboyrunner/releases/latest)
[docker](https://hub.docker.com/r/vibeboyrunner/vibeboyrunner)
[license](LICENSE)

An AI-powered development environment that orchestrates worker agents inside containers. VibeBoyRunner runs a Docker-in-Docker container with a built-in manager service, giving AI agents (like the Cursor Agent) full access to isolated Docker environments for building and running your apps..

## Prerequisites

Before installing, make sure you have:

1. **Docker** installed and running — [get Docker](https://docs.docker.com/get-docker/)
2. **Cursor IDE** installed — [cursor.com](https://cursor.com)
3. **Dev Containers extension** by Anysphere installed in Cursor

## Installation

### Option A: Agent-Assisted Setup

Open the Cursor Agent chat (`Cmd+L` / `Ctrl+L`) and paste:

```
Read https://vibeboyrunner.github.io/vibeboyrunner/setups/latest/setup_skill.md and follow the instructions to set up VibeBoyRunner
```

The agent will walk you through the entire setup — installing the CLI, starting the container, and connecting Cursor.

### Option B: Manual Setup

Install the `vibeboyrunner` CLI:

```bash
curl -fsSL "https://vibeboyrunner.github.io/vibeboyrunner/setups/latest/setup.sh" | bash -s install
```

This places the CLI at `~/.vibeboyrunner/bin/vibeboyrunner` and adds it to your PATH. Open a new terminal (or run `export PATH="$HOME/.vibeboyrunner/bin:$PATH"`) to pick it up.

Verify:

```bash
vibeboyrunner --help
```

## Getting Started

Start VibeBoyRunner:

```bash
vibeboyrunner up
```

This pulls the Docker image (if needed) and starts the container. Connect Cursor to it:

1. Open **Cursor IDE**.
2. Open Command Palette — `Cmd+Shift+P` (macOS) / `Ctrl+Shift+P` (Linux/Windows).
3. Select **Dev Containers: Attach to Running Container...**
4. Pick the **vibeboyrunner** container.
5. In the new Cursor window, open the folder `/workdir`.
6. Open the Cursor Agent chat (`Cmd+L` / `Ctrl+L`) and say **Hello** — the Father Agent takes over from here.

On a fresh install the Father Agent detects an empty workspace and walks you through onboarding automatically.

## CLI Commands


| Command                | Description                   |
| ---------------------- | ----------------------------- |
| `vibeboyrunner up`     | Start or update the container |
| `vibeboyrunner down`   | Stop and remove the container |
| `vibeboyrunner status` | Check container status        |
| `vibeboyrunner logs`   | Tail container logs           |


## Configuration

Override any setting with environment variables when running the CLI:

```bash
DIND_IMAGE_REF="<namespace>/vibeboyrunner:1.2.3" vibeboyrunner up
```


| Variable                    | Description                                                        |
| --------------------------- | ------------------------------------------------------------------ |
| `DIND_IMAGE_REF`            | Docker image to run (default: version-pinned release image)        |
| `DIND_CONTAINER_NAME`       | Container name (default: `vibeboyrunner`)                          |
| `MANAGER_PORT`              | Manager HTTP port inside the container (default: `18080`)          |
| `MANAGER_AGENT_MODEL`       | Default AI model for agent tasks                                   |
| `GIT_USER_NAME`             | Git identity name for commits                                      |
| `GIT_USER_EMAIL`            | Git identity email for commits                                     |
| `HOST_PORT_RANGE_START/END` | Host port range mapped into the container (default: `20000–20499`) |


## What's Inside

The VibeBoyRunner container ships with:

- Docker daemon (Docker-in-Docker)
- Git 2.53.0
- GitHub CLI (`gh`)
- Cursor Agent CLI (`agent`)
- Node.js 22 LTS
- Manager service for orchestrating dev pools

---

# Development

Everything below is for contributors working on VibeBoyRunner itself.

## Dev Quick Start

From `services/dind`:

```bash
./setup.sh
```

This builds the image locally and starts the `vbr-dind` container in dev mode. If `.env` is missing, it is created from `.env.example`.

All subcommands work in dev too:

```bash
./setup.sh down      # stop container
./setup.sh status    # check status
./setup.sh logs      # tail logs
```

## Setup Script Structure

All setup logic lives in a single file to prevent drift between dev and prod:


| File            | Purpose                                                               |
| --------------- | --------------------------------------------------------------------- |
| `setup.sh`      | Dev preamble + shared body (single source of truth for all logic)     |
| `setup.sh.tmpl` | Static 3-line prod header (`VBR_MODE="prod"`) — CI generates the rest |
| `.env.example`  | Full env contract with `__SHARED__`, `__DEV__`, `__PROD__` sections   |


`setup.sh` is structured in two sections separated by marker comments:

1. **Dev preamble** — sources SHARED + DEV sections from `.env` (excluding PROD), resolves host bind-mount paths, sets `VBR_MODE=dev`.
2. **Shared body** (between `# __SHARED_BODY_START__` / `# __SHARED_BODY_END__`) — validation, subcommands, `docker run` with all `-e` env flags. Branches on `VBR_MODE` for the few genuine differences:


| Behavior       | Dev                      | Prod                        |
| -------------- | ------------------------ | --------------------------- |
| Image          | `docker build` locally   | `docker pull` from registry |
| Storage        | Bind mounts (host paths) | Named Docker volumes        |
| Restart policy | None                     | `unless-stopped`            |
| Install cmd    | N/A                      | `curl` from release URL     |


`.env.example` is the single source of truth for all environment defaults. It uses section markers:

- `# __SHARED__` — vars identical for both modes (container paths, ports, agent config)
- `# __DEV__` — dev-only vars (host bind-mount paths, local image name)
- `# __PROD__` — prod-only vars and overrides (image ref, setup URL, volume names, container name)

At build time, CI reads SHARED + PROD sections from `.env.example`, generates `: "${VAR:=value}"` lines, and concatenates: template header + generated preamble + shared body. The result is a self-contained distributable script with no placeholders.

## Architecture Overview

VibeBoyRunner is a Docker-in-Docker (dind) container. The entrypoint bootstraps persistent state (agents, service auth, workspaces) from mounted paths, then starts the Docker daemon and the manager service.

Key source paths inside `services/dind`:


| Path            | Purpose                                    |
| --------------- | ------------------------------------------ |
| `Dockerfile`    | Container image build                      |
| `entrypoint.sh` | Bootstrap + daemon startup                 |
| `agents/`       | Father agent skill/rule templates          |
| `manager/`      | Manager service (TypeScript)               |
| `setup.sh`      | Dev preamble + shared setup logic          |
| `setup.sh.tmpl` | Static prod header (CI generates preamble) |
| `.env.example`  | Full env contract (shared + dev + prod)    |


## Environment Variables (Full Reference)

Configured via `.env` (generated from `.env.example`). The `.env.example` file contains all variables organized by `__SHARED__`, `__DEV__`, and `__PROD__` sections:


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


Default port mapping: `20000–20499` on host mapped 1:1 into the container.

## Mounts (Dev)

- `HOST_HOME_PATH` → `DIND_HOME_PATH`
- `HOST_WORKSPACES_PATH` → `DIND_WORKSPACES_PATH`
- `DIND_DOCKER_VOLUME_NAME` → `/var/lib/docker`
- Host port range → container port range

Logs are written to `DIND_HOME_PATH/runtime/logs.log` (on host: `HOST_HOME_PATH/runtime/logs.log`).

## Bootstrap Contract

On startup, `entrypoint.sh` runs the following init sequence:

### 1) Agents Store

Creates:

- `DIND_HOME_PATH/agents/father/skill.md`
- `DIND_HOME_PATH/agents/father/rule.mdc`

For the Cursor provider, renders symlinks:

- `DIND_WORKDIR_PATH/.cursor/skills/father/SKILL.md` → `DIND_HOME_PATH/agents/father/skill.md`
- `DIND_WORKDIR_PATH/.cursor/rules/father.mdc` → `DIND_HOME_PATH/agents/father/rule.mdc`

### 2) Service Auth States

Creates default states:

- `DIND_HOME_PATH/services/gh/default`
- `DIND_HOME_PATH/services/cursor/default`

Renders active state symlinks:

- `/root/.config/gh` → `DIND_HOME_PATH/services/gh/default`
- `/root/.config/cursor` → `DIND_HOME_PATH/services/cursor/default`

### 3) Workspaces

Ensures `DIND_WORKSPACES_PATH` exists and creates:

- `DIND_WORKSPACES_PATH/default/apps` and `DIND_WORKSPACES_PATH/default/features` if no workspace dirs are present.
- For every workspace directory (existing or new), backfills `<workspace>/apps` and `<workspace>/features`.

### 4) Manager Service

On startup the manager is built and started:

- Installs deps on first boot (`DIND_SERVICES_PATH/manager/node_modules`)
- Builds with `npm run build`
- Runs `npm run start`

Manager source lives under `services/dind/manager` — both dev and prod use the copy baked into the image at build time.

### 5) Git Identity Bootstrap

Configures git identity from env vars:

- `git config --global user.name` ← `GIT_USER_NAME`
- `git config --global user.email` ← `GIT_USER_EMAIL`

## Manager API

### Pool Orchestration


| Method | Endpoint                                                     | Description              |
| ------ | ------------------------------------------------------------ | ------------------------ |
| POST   | `/api/workspaces/:workspace/dev-pool/up`                     | Start workspace dev pool |
| POST   | `/api/workspaces/:workspace/dev-pool/down`                   | Stop workspace dev pool  |
| POST   | `/api/workspaces/:workspace/features/:feature/dev-pool/up`   | Start feature dev pool   |
| POST   | `/api/workspaces/:workspace/features/:feature/dev-pool/down` | Stop feature dev pool    |


Pool `up` scans `apps/`* for directories containing `.vibeboyrunner/config.json` + `.vibeboyrunner/docker-compose.yml`, allocates free ports, and runs `docker compose up -d --build` with resolved bindings. It also:

- Injects compose override to mount shared dind auth states into app containers
- Mounts worker cursor conversation stores into app container root (`/root/.cursor`)
- Runs runtime injection on the main app service (`APP_COMPOSE_SERVICE_NAME`): best-effort install of `gh` and Cursor Agent CLI, plus auth state symlinks

### Monitoring


| Method | Endpoint        | Description                                      |
| ------ | --------------- | ------------------------------------------------ |
| GET    | `/health`       | Health check                                     |
| GET    | `/api/pools/ps` | Running containers (`?all=true` for stopped too) |


### Agent Execution


| Method | Endpoint         | Description                              |
| ------ | ---------------- | ---------------------------------------- |
| POST   | `/api/agent/run` | Run `agent chat` inside an app container |


Request body:

- `containerId` (string) — target container
- `prompt` (string) — prompt to send
- `threadId` (optional string) — omit to create a new thread
- `model` (optional string) — overrides `MANAGER_AGENT_MODEL`

## Conversation Persistence Layout

Conversation state is persisted under `DIND_HOME_PATH/state/conversations`:


| Context            | Path                                                                       | Mounted to                       |
| ------------------ | -------------------------------------------------------------------------- | -------------------------------- |
| Father agent       | `dind/father/cursor/dot-cursor`                                            | `/root/.cursor` in dind          |
| App worker         | `pools/<workspace>/apps/<app>/worker/cursor/dot-cursor`                    | `/root/.cursor` in app container |
| Feature app worker | `pools/<workspace>/features/<feature>/apps/<app>/worker/cursor/dot-cursor` | `/root/.cursor` in app container |


## CI/CD

Two workflows, no manual triggers:


| Workflow      | Trigger                       | What it does                                                                                                        |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `test.yml`    | Push to `main`, pull requests | Runs manager tests, setup script tests, Docker smoke test                                                           |
| `publish.yml` | Push tag `v*`                 | Verifies tests passed → builds Docker image → renders setup script → publishes to gh-pages → creates GitHub release |


### Publish Pipeline

On a `v*` tag push, `publish.yml` runs four jobs:

1. **Verify tests** — queries the GitHub API to confirm a successful Tests run exists for the same commit SHA. Fails if the commit wasn't tested on `main` first.
2. **Build image** (parallel matrix) — builds Docker images natively on `ubuntu-latest` (amd64) and `ubuntu-24.04-arm` (arm64) in parallel. Each pushes a single-platform digest.
3. **Publish Docker image** — merges the two digests into a multi-arch manifest and pushes to Docker Hub with semver tags (`X.Y.Z`, `X.Y`, `latest`).
4. **Publish setup script** — reads `.env.example` (SHARED + PROD sections) to generate the prod preamble, appends the shared body from `setup.sh`, and publishes the rendered script + skill to the `gh-pages` branch. Also creates a GitHub Release.

Required GitHub configuration:

- Secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`
- Variables: `DOCKERHUB_NAMESPACE`, `PAGES_BASE` (optional, defaults to `https://vibeboyrunner.github.io/vibeboyrunner`)

### GitHub Pages Structure


| Path                                    | Content                            |
| --------------------------------------- | ---------------------------------- |
| `setups/<tag>/` (e.g. `setups/v0.0.6/`) | Version-specific rendered files    |
| `setups/latest/`                        | Always matches the most recent tag |


Default install URL: `https://vibeboyrunner.github.io/vibeboyrunner/setups/latest/setup.sh`

## Extending

`entrypoint.sh` is split into init + render steps by design:

- **New agent provider** — add a renderer function and a `case` branch in `render_agents()`.
- **New service schema** — add `init_service_states "<name>"` and `render_service_links "<name>" "<target>"`.
- **Multiple active states** — replace hardcoded `default` with a selected state value and link that state.

## Useful Dev Commands

From `services/dind`:

```bash
# Dev build + restart
./setup.sh

# Stop container
./setup.sh down

# Check container status
./setup.sh status

# Tail container logs
./setup.sh logs

# Tail runtime log
tail -f dev/runtime/.vibeboyrunner/runtime/logs.log

# Shell into the container
docker exec -it vbr-dind bash

# Verify installed tools
docker exec vbr-dind sh -lc 'agent --version && gh --version && git --version'

# Check inner Docker daemon
docker exec vbr-dind sh -lc 'docker info'
```

