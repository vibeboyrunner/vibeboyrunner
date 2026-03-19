# VibeBoyRunner

[![tests](https://github.com/vibeboyrunner/vibeboyrunner/actions/workflows/test.yml/badge.svg)](https://github.com/vibeboyrunner/vibeboyrunner/actions/workflows/test.yml)
[![publish](https://github.com/vibeboyrunner/vibeboyrunner/actions/workflows/dind-image-publish.yml/badge.svg)](https://github.com/vibeboyrunner/vibeboyrunner/actions/workflows/dind-image-publish.yml)
[![release](https://img.shields.io/github/v/release/vibeboyrunner/vibeboyrunner?label=release)](https://github.com/vibeboyrunner/vibeboyrunner/releases/latest)
[![docker](https://img.shields.io/docker/v/vibeboyrunner/vibeboyrunner?label=docker&sort=semver)](https://hub.docker.com/r/vibeboyrunner/vibeboyrunner)
[![license](https://img.shields.io/github/license/vibeboyrunner/vibeboyrunner)](LICENSE)

An AI-powered development environment that orchestrates worker agents inside containers. VibeBoyRunner runs a Docker-in-Docker container with a built-in manager service, giving AI agents (like the Cursor Agent) full access to isolated Docker environments for building and running your apps.

## Prerequisites

Before installing, make sure you have:

1. **Docker** installed and running — [get Docker](https://docs.docker.com/get-docker/)
2. **Cursor IDE** installed — [cursor.com](https://cursor.com)
3. **Dev Containers extension** by Anysphere installed in Cursor

## Installation

Install the `vibeboyrunner` CLI:

```bash
curl -fsSL "https://github.com/vibeboyrunner/vibeboyrunner/releases/latest/download/setup.sh" | bash -s install
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
4. Pick the **vbr-dind** container.
5. In the new Cursor window, open the folder `/workdir`.
6. Open the Cursor Agent chat (`Cmd+L` / `Ctrl+L`) and say **Hello** — the Father Agent takes over from here.

On a fresh install the Father Agent detects an empty workspace and walks you through onboarding automatically.

## CLI Commands

| Command                | Description                          |
|------------------------|--------------------------------------|
| `vibeboyrunner up`     | Start or update the container        |
| `vibeboyrunner down`   | Stop and remove the container        |
| `vibeboyrunner status` | Check container status               |
| `vibeboyrunner logs`   | Tail container logs                  |

## Configuration

VibeBoyRunner reads its configuration from a `.env` file. On first run it is generated automatically from defaults. Key settings you may want to customize:

| Variable                   | Description                                                 |
|----------------------------|-------------------------------------------------------------|
| `DIND_IMAGE_REF`           | Docker image to run (registry image or local tag)           |
| `DIND_CONTAINER_NAME`      | Container name (default: `vbr-dind`)                        |
| `MANAGER_PORT`             | Manager HTTP port inside the container (default: `18080`)   |
| `MANAGER_AGENT_MODEL`      | Default AI model for agent tasks                            |
| `GIT_USER_NAME`            | Git identity name for commits (default: `VibeBoyRunner Father Agent`) |
| `GIT_USER_EMAIL`           | Git identity email for commits                              |
| `HOST_PORT_RANGE_START/END`| Host port range mapped into the container (default: `20000–20499`) |

You can override any variable with environment variables when running the CLI:

```bash
DIND_IMAGE_REF="<namespace>/vbr-dind:1.2.3" vibeboyrunner up
```

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

Everything below is aimed at contributors working on VibeBoyRunner itself.

## Architecture Overview

VibeBoyRunner is a Docker-in-Docker (dind) container. The entrypoint bootstraps persistent state (agents, service auth, workspaces) from mounted paths, then starts the Docker daemon and the manager service.

Key source paths inside `services/dind`:

| Path                 | Purpose                                  |
|----------------------|------------------------------------------|
| `Dockerfile`         | Container image build                    |
| `entrypoint.sh`      | Bootstrap + daemon startup               |
| `agents/`            | Father agent skill/rule templates         |
| `manager/`           | Manager service (TypeScript)             |
| `setup.sh`           | Dev build + run script                   |
| `setup.prod.sh`      | Local prod testing script                |
| `setup.prod.sh.tmpl` | Template rendered into release `setup.sh`|

## Dev Quick Start

From `services/dind`:

```bash
./setup.sh
```

This builds the image and starts/restarts the `vbr-dind` container in dev mode. If `.env` is missing, setup creates it from `.env.dev.example`.

For local prod testing (uses a pre-built image):

```bash
./setup.prod.sh up
```

If `.env` is missing, this creates it from `.env.prod.example`.

## Environment Variables (Full Reference)

Configured via `.env` (generated from `.env.dev.example` or `.env.prod.example`):

| Variable                       | Description                                                      |
|--------------------------------|------------------------------------------------------------------|
| `HOST_HOME_PATH`               | Host path for persistent dind state                              |
| `HOST_WORKSPACES_PATH`         | Host path for persistent workspaces                              |
| `DIND_HOME_PATH`               | Mounted path inside container for state root                     |
| `DIND_WORKDIR_PATH`            | Container working directory                                      |
| `DIND_WORKSPACES_PATH`         | Mounted path inside container for workspaces                     |
| `DIND_SERVICES_PATH`           | Mounted path inside container for services root                  |
| `DIND_IMAGE_NAME`              | Docker image name to build/run (dev)                             |
| `DIND_IMAGE_REF`               | Production image reference (local tag or registry)               |
| `DIND_CONTAINER_NAME`          | Container name                                                   |
| `DIND_HOME_VOLUME_NAME`        | Named volume for persistent prod home state                      |
| `DIND_WORKSPACES_VOLUME_NAME`  | Named volume for persistent prod workspaces                      |
| `DIND_DOCKER_VOLUME_NAME`      | Named volume for `/var/lib/docker` (inner Docker cache)          |
| `AGENT_PROVIDERS`              | Comma-separated providers to render (currently: `cursor`)        |
| `MANAGER_PORT`                 | Manager HTTP port inside dind                                    |
| `APP_COMPOSE_SERVICE_NAME`     | Compose service name treated as the main app container           |
| `MANAGER_AGENT_MODEL`          | Default model for `/api/agent/run`                               |
| `GIT_USER_NAME`                | Git identity name                                                |
| `GIT_USER_EMAIL`               | Git identity email                                               |
| `HOST_PORT_RANGE_START`        | Host range start port (inclusive)                                |
| `HOST_PORT_RANGE_END`          | Host range end port (inclusive)                                  |
| `DIND_PORT_RANGE_START`        | Container range start port (inclusive)                           |
| `DIND_PORT_RANGE_END`          | Container range end port (inclusive)                             |

Default port mapping: `20000–20499` on host mapped 1:1 into the container.

## Mounts

**Dev** (`setup.sh`):

- `HOST_HOME_PATH` → `DIND_HOME_PATH`
- `HOST_WORKSPACES_PATH` → `DIND_WORKSPACES_PATH`
- `DIND_DOCKER_VOLUME_NAME` → `/var/lib/docker`
- Host port range → container port range

**Prod** (`setup.prod.sh`):

- `DIND_HOME_VOLUME_NAME` → `DIND_HOME_PATH`
- `DIND_WORKSPACES_VOLUME_NAME` → `DIND_WORKSPACES_PATH`
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

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/workspaces/:workspace/dev-pool/up` | Start workspace dev pool |
| POST | `/api/workspaces/:workspace/dev-pool/down` | Stop workspace dev pool |
| POST | `/api/workspaces/:workspace/features/:feature/dev-pool/up` | Start feature dev pool |
| POST | `/api/workspaces/:workspace/features/:feature/dev-pool/down` | Stop feature dev pool |

Pool `up` scans `apps/*` for directories containing `.vibeboyrunner/config.json` + `.vibeboyrunner/docker-compose.yml`, allocates free ports, and runs `docker compose up -d --build` with resolved bindings. It also:

- Injects compose override to mount shared dind auth states into app containers
- Mounts worker cursor conversation stores into app container root (`/root/.cursor`)
- Runs runtime injection on the main app service (`APP_COMPOSE_SERVICE_NAME`): best-effort install of `gh` and Cursor Agent CLI, plus auth state symlinks

### Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/pools/ps` | Running containers (`?all=true` for stopped too) |

### Agent Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/agent/run` | Run `agent chat` inside an app container |

Request body:
- `containerId` (string) — target container
- `prompt` (string) — prompt to send
- `threadId` (optional string) — omit to create a new thread
- `model` (optional string) — overrides `MANAGER_AGENT_MODEL`

## Conversation Persistence Layout

Conversation state is persisted under `DIND_HOME_PATH/state/conversations`:

| Context | Path | Mounted to |
|---------|------|------------|
| Father agent | `dind/father/cursor/dot-cursor` | `/root/.cursor` in dind |
| App worker | `pools/<workspace>/apps/<app>/worker/cursor/dot-cursor` | `/root/.cursor` in app container |
| Feature app worker | `pools/<workspace>/features/<feature>/apps/<app>/worker/cursor/dot-cursor` | `/root/.cursor` in app container |

## CI/CD

### Docker Hub Image

Workflow: `.github/workflows/dind-image-publish.yml`

Triggers:
- Push to `main`
- Push tag `v*`

Required GitHub configuration:
- Secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`
- Variables: `DOCKERHUB_NAMESPACE`

Published image: `${DOCKERHUB_NAMESPACE}/vbr-dind`

Tag strategy:
- `main` push → `main`, `sha-<short-sha>`
- `vX.Y.Z` tag → `X.Y.Z`, `X.Y`, `X`, `latest`

### Setup Script

Workflow: `.github/workflows/setup-script-publish.yml`

- Artifact on `main`: `setup-script` (contains `setup.sh`)
- Release asset on `v*` tags: `setup.sh`

Default `DIND_IMAGE_REF` injected into the rendered script:
- Tag build (`v1.2.3`) → `${DOCKERHUB_NAMESPACE}/vbr-dind:1.2.3`
- Main build → `${DOCKERHUB_NAMESPACE}/vbr-dind:main`
- No `DOCKERHUB_NAMESPACE` → `vbr-dind:local`

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

# Local prod run
./setup.prod.sh up

# Tail runtime log
tail -f ../../runtime/.vibeboyrunner/runtime/logs.log

# Shell into the container
docker exec -it vbr-dind bash

# Verify installed tools
docker exec vbr-dind sh -lc 'agent --version && gh --version && git --version'

# Check inner Docker daemon
docker exec vbr-dind sh -lc 'docker info'
```
