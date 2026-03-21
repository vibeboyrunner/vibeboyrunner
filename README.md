# VibeBoyRunner

[![tests](https://img.shields.io/github/actions/workflow/status/vibeboyrunner/vibeboyrunner/test.yml?branch=main&label=tests)](https://github.com/vibeboyrunner/vibeboyrunner/actions/workflows/test.yml?query=branch%3Amain)
[![publish](https://img.shields.io/github/actions/workflow/status/vibeboyrunner/vibeboyrunner/publish.yml?label=publish)](https://github.com/vibeboyrunner/vibeboyrunner/actions/workflows/publish.yml)
[![release](https://img.shields.io/github/v/release/vibeboyrunner/vibeboyrunner?label=release)](https://github.com/vibeboyrunner/vibeboyrunner/releases/latest)
[![docker](https://img.shields.io/docker/v/vibeboyrunner/vibeboyrunner?label=docker&sort=semver)](https://hub.docker.com/r/vibeboyrunner/vibeboyrunner)
[![license](https://img.shields.io/github/license/vibeboyrunner/vibeboyrunner)](LICENSE)

An AI-powered development environment that orchestrates worker agents inside containers. VibeBoyRunner runs a Docker-in-Docker container with a built-in manager service, giving AI agents full access to isolated Docker environments for building and running your apps.

## Prerequisites

- Docker installed and running - [get Docker](https://docs.docker.com/get-docker/)
- Cursor IDE installed - [cursor.com](https://cursor.com)
- Dev Containers extension by Anysphere installed in Cursor

## 60-Second Start

### Option A: Agent-assisted setup

Open Cursor Agent chat (`Cmd+L` / `Ctrl+L`) and paste:

```text
Read https://vibeboyrunner.github.io/vibeboyrunner/setups/latest/setup_skill.md and follow the instructions to set up VibeBoyRunner
```

### Option B: Manual setup

Install CLI:

```bash
curl -fsSL "https://vibeboyrunner.github.io/vibeboyrunner/setups/latest/setup.sh" | bash -s install
```

Open a new shell (or run `export PATH="$HOME/.vibeboyrunner/bin:$PATH"`), then verify:

```bash
vibeboyrunner --help
```

Start the container:

```bash
vibeboyrunner up
```

Attach from Cursor:

1. Open Cursor.
2. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
3. Select **Dev Containers: Attach to Running Container...**
4. Pick `vibeboyrunner`.
5. In the new window, open `/workdir`.
6. Open Cursor Agent chat and say: **Hey, let's start onboarding!**

If you only want to use VibeBoyRunner, you can stop here.

## CLI Basics

| Command                | Description                   |
| ---------------------- | ----------------------------- |
| `vibeboyrunner up`     | Start or update the container |
| `vibeboyrunner down`   | Stop and remove the container |
| `vibeboyrunner status` | Check container status        |
| `vibeboyrunner logs`   | Tail container logs           |

## Configuration

Override settings with environment variables:

```bash
DIND_IMAGE_REF="<namespace>/vibeboyrunner:1.2.3" vibeboyrunner up
```

Most-used variables:

| Variable                    | Description                                                        |
| --------------------------- | ------------------------------------------------------------------ |
| `DIND_IMAGE_REF`            | Docker image to run (default: version-pinned release image)        |
| `DIND_CONTAINER_NAME`       | Container name (default: `vibeboyrunner`)                          |
| `MANAGER_PORT`              | Manager HTTP port inside the container (default: `18080`)          |
| `MANAGER_AGENT_MODEL`       | Default AI model for agent tasks                                   |
| `GIT_USER_NAME`             | Git identity name for commits                                      |
| `GIT_USER_EMAIL`            | Git identity email for commits                                     |
| `HOST_PORT_RANGE_START/END` | Host port range mapped into the container (default: `20000-20499`) |

Full reference: [`docs/configuration.md`](docs/configuration.md)

## What's Inside

The container includes:

- Docker daemon (Docker-in-Docker)
- Git 2.53.0
- GitHub CLI (`gh`)
- Cursor Agent CLI (`agent`)
- Node.js 22 LTS
- Manager service for orchestrating dev pools

## Agent Providers

Configure providers via `AGENT_PROVIDERS`.

| Provider | CLI     | Status    | `AGENT_PROVIDERS` value |
| -------- | ------- | --------- | ----------------------- |
| Cursor   | `agent`  | Available | `cursor` (default)      |
| Claude   | `claude` | Planned   | `claude`                |
| Gemini   | `gemini` | Planned   | `gemini`                |

Provider extension details: [`docs/bootstrap.md`](docs/bootstrap.md) and [`docs/manager-api.md`](docs/manager-api.md)

## Development

Everything below is for contributors working on VibeBoyRunner itself.

### Dev quick start

From `services/dind`:

```bash
./setup.sh
```

If `.env` is missing, it is created from `.env.example`.

Common dev commands:

```bash
./setup.sh down
./setup.sh status
./setup.sh logs
tail -f dev/runtime/.vibeboyrunner/runtime/logs.log
docker exec -it vbr-dind bash
docker exec vbr-dind sh -lc 'agent --version && gh --version && git --version'
docker exec vbr-dind sh -lc 'docker info'
```

### Deep-dive docs

- Setup script model and shared-body generation: [`docs/configuration.md`](docs/configuration.md)
- Bootstrap sequence and mounted state contracts: [`docs/bootstrap.md`](docs/bootstrap.md)
- Manager API and streaming behavior: [`docs/manager-api.md`](docs/manager-api.md)
- CI/CD and release publishing pipeline: [`docs/release.md`](docs/release.md)

## Extending

### Adding an agent provider

1. Create `manager/src/providers/<name>Provider.ts` implementing `AgentProvider`.
2. Register it in `manager/src/providers/index.ts` (`createAgentProvider`).
3. Add renderer branch in `render_agents()` inside `entrypoint.sh`.
4. Add `init_service_states "<name>"` and `render_service_links "<name>" "<target>"` in `entrypoint.sh`.

### Other extension points

- New service schema: add `init_service_states "<name>"` and `render_service_links "<name>" "<target>"`.
- Multiple active states: replace hardcoded `default` with selected state value and link that state.
