# DIND Service

This service runs a Docker-in-Docker container with:

- Docker daemon (`dockerd`)
- `git`
- GitHub CLI (`gh`)
- Cursor Agent CLI (`agent`)

It also bootstraps persistent runtime state (agents, service auth states, workspaces) from host-mounted paths.

## Quick Start

From `services/dind`:

```bash
./setup.sh
```

This builds and starts/restarts container `vbr-dind` in dev mode.
If `.env` is missing, setup auto-creates it from `.env.dev.example`.
If `.env` already exists, setup uses it as-is.

Local prod testing path (in-repo):

```bash
./setup.prod.sh up
```

If `.env` is missing, this auto-creates `.env` from `.env.prod.example`.

Local CLI install:

```bash
./setup.prod.sh install
vibeboyrunner up
```

Production bootstrap (no local repo required) uses the release `setup.sh` script:

```bash
curl -fsSL "https://github.com/<owner>/<repo>/releases/latest/download/setup.sh" | bash -s -- install
vibeboyrunner up
```

## Docker Hub CI/CD

This repo includes a GitHub Actions workflow for publishing the dind image:

- `.github/workflows/dind-image-publish.yml` (path is relative to dind repo root)
- triggers:
  - push to `main`
  - push tag `v*` (for example `v1.2.3`)

### Required GitHub configuration

Set these in the repository settings:

- Secrets:
  - `DOCKERHUB_USERNAME`
  - `DOCKERHUB_TOKEN`
- Variables:
  - `DOCKERHUB_NAMESPACE` (Docker Hub user/org namespace)

Published image name:

- `${DOCKERHUB_NAMESPACE}/vbr-dind`

Tag behavior:

- `main` push -> `main` and `sha-<short-sha>`
- `vX.Y.Z` tag push -> `X.Y.Z`, `X.Y`, `X`, and `latest`

## Setup Script CI/CD

This repo also publishes a standalone production bootstrap script:

- workflow: `.github/workflows/setup-script-publish.yml`
- artifact on `main`: `setup-script` (contains `setup.sh`)
- release asset on `v*` tags: `setup.sh`

Default `DIND_IMAGE_REF` injection in rendered script:

- tag build (`v1.2.3`) -> `${DOCKERHUB_NAMESPACE}/vbr-dind:1.2.3`
- main build -> `${DOCKERHUB_NAMESPACE}/vbr-dind:main`
- if `DOCKERHUB_NAMESPACE` is not set -> `vbr-dind:local`

No extra server is required: GitHub Releases can host the script.
For tagged releases, users can bootstrap with:

```bash
curl -fsSL "https://github.com/<owner>/<repo>/releases/latest/download/setup.sh" | bash
```

Runtime overrides are supported:

```bash
DIND_IMAGE_REF="<namespace>/vbr-dind:1.2.3" \
DIND_CONTAINER_NAME="vbr-dind-prod" \
curl -fsSL "https://github.com/<owner>/<repo>/releases/latest/download/setup.sh" | bash
```

Standalone prod script commands (`setup.sh` release asset and local `setup.prod.sh`):

- `install`
- `up` (default)
- `down`
- `status`
- `logs`

Production setup should use published image via `.env`:

- `DIND_IMAGE_REF=<dockerhub-namespace>/vbr-dind:<tag>`

## Environment Variables

Configured in local repo `.env` (generated from `.env.dev.example` for dev, or `.env.prod.example` for local prod testing):

- `HOST_HOME_PATH`: host path for persistent dind state
- `HOST_WORKSPACES_PATH`: host path for persistent workspaces
- `DIND_HOME_PATH`: mounted path inside container for state root
- `DIND_WORKDIR_PATH`: container working directory
- `DIND_WORKSPACES_PATH`: mounted path inside container for workspaces
- `DIND_SERVICES_PATH`: mounted path inside container for services root
- `DIND_IMAGE_NAME`: docker image name to build/run
- `DIND_IMAGE_REF`: production image reference used by `setup.prod.sh` (local tag or registry image)
- `DIND_CONTAINER_NAME`: container name
- `DIND_HOME_VOLUME_NAME`: named volume for persistent prod home state
- `DIND_WORKSPACES_VOLUME_NAME`: named volume for persistent prod workspaces
- `DIND_DOCKER_VOLUME_NAME`: Docker named volume mounted to `/var/lib/docker` for inner Docker image/cache persistence
- `AGENT_PROVIDERS`: comma-separated providers to render (currently supports `cursor`)
- `MANAGER_PORT`: manager HTTP server port inside dind
- `APP_COMPOSE_SERVICE_NAME`: compose service name treated as the main app container (default: `app`)
- `MANAGER_AGENT_MODEL`: default model used by `/api/agent/run` when request doesn't provide `model`
- `GIT_USER_NAME`: default git identity name configured in dind for commit operations
- `GIT_USER_EMAIL`: default git identity email configured in dind for commit operations
- `HOST_PORT_RANGE_START`: host range start port (inclusive)
- `HOST_PORT_RANGE_END`: host range end port (inclusive)
- `DIND_PORT_RANGE_START`: container range start port (inclusive)
- `DIND_PORT_RANGE_END`: container range end port (inclusive)

Default mapping publishes 500 ports 1:1:

- `20000-20499` on host -> `20000-20499` in dind

## Mounts

`setup.sh` mounts:

- `HOST_HOME_PATH -> DIND_HOME_PATH`
- `HOST_WORKSPACES_PATH -> DIND_WORKSPACES_PATH`
- `DIND_DOCKER_VOLUME_NAME -> /var/lib/docker`
- `HOST_PORT_RANGE_START-HOST_PORT_RANGE_END -> DIND_PORT_RANGE_START-DIND_PORT_RANGE_END`

`setup.prod.sh` mounts:

- `DIND_HOME_VOLUME_NAME -> DIND_HOME_PATH`
- `DIND_WORKSPACES_VOLUME_NAME -> DIND_WORKSPACES_PATH`
- `DIND_DOCKER_VOLUME_NAME -> /var/lib/docker`
- `HOST_PORT_RANGE_START-HOST_PORT_RANGE_END -> DIND_PORT_RANGE_START-DIND_PORT_RANGE_END`

Logs are written to:

- `DIND_HOME_PATH/runtime/logs.log`
- On host: `HOST_HOME_PATH/runtime/logs.log`

## Bootstrap Contract

On startup, `entrypoint.sh` ensures:

### 1) Agents Store

- `DIND_HOME_PATH/agents/father/skill.md`
- `DIND_HOME_PATH/agents/father/rule.mdc`

For Cursor provider, it renders symlinks:

- `DIND_WORKDIR_PATH/.cursor/skills/father/SKILL.md -> DIND_HOME_PATH/agents/father/skill.md`
- `DIND_WORKDIR_PATH/.cursor/rules/father.mdc -> DIND_HOME_PATH/agents/father/rule.mdc`

### 2) Service Auth States

Creates default states:

- `DIND_HOME_PATH/services/gh/default`
- `DIND_HOME_PATH/services/cursor/default`

Renders active state symlinks:

- `/root/.config/gh -> DIND_HOME_PATH/services/gh/default`
- `/root/.config/cursor -> DIND_HOME_PATH/services/cursor/default`

### 3) Workspaces

Ensures `DIND_WORKSPACES_PATH` exists and creates:

- `DIND_WORKSPACES_PATH/default/apps` and `DIND_WORKSPACES_PATH/default/features` if no workspace dirs are present.
- For every workspace directory (existing or new), backfills:
  - `<workspace>/apps`
  - `<workspace>/features`

### 4) Manager Service

On startup, dind launches:

- manager in TypeScript dev mode:
  - installs deps on first boot in `DIND_SERVICES_PATH/manager/node_modules`
  - builds with `npm run build`
  - runs `npm run start` from `DIND_SERVICES_PATH/manager`

Manager source location:

- canonical source now lives under `services/dind/manager`
- both dev and prod use manager copied into image at build time

### 5) Git Identity Bootstrap

On startup, dind ensures git identity exists for Father commits:

- `git config --global user.name` from `GIT_USER_NAME` (default: `VibeBoyRunner Father`)
- `git config --global user.email` from `GIT_USER_EMAIL` (default: `father@vibeboyrunner.local`)

Manager endpoint currently implemented:

- `POST /api/workspaces/:workspaceName/dev-pool/up`
  - scans `DIND_WORKSPACES_PATH/<workspaceName>/apps/*`
  - for each app with `.vibeboyrunner/config.json` + `.vibeboyrunner/docker-compose.yml`
  - allocates free ports from `DIND_PORT_RANGE_START..DIND_PORT_RANGE_END`
  - passes resolved `bindings.ports` and default `bindings.envs` to `docker compose up -d --build`
  - injects compose override to mount shared dind auth states into app container:
    - `/.vibeboyrunner/services -> /.vibeboyrunner/services`
  - mounts worker cursor conversation stores into app container root:
    - `/root/.cursor`
    - source path template:
      - `DIND_HOME_PATH/state/conversations/pools/<workspace>/apps/<app>/worker/cursor/dot-cursor`
  - runs runtime injection only for main app service container (`APP_COMPOSE_SERVICE_NAME`):
    - best-effort install of `gh` and Cursor Agent CLI
    - symlink `/root/.config/gh` and `/root/.config/cursor` to `/.vibeboyrunner/services/.../default`
- `POST /api/workspaces/:workspaceName/dev-pool/down`
  - scans `DIND_WORKSPACES_PATH/<workspaceName>/apps/*`
  - runs `docker compose down` for each app that has compose config
- `POST /api/workspaces/:workspaceName/features/:featureName/dev-pool/up`
  - scans `DIND_WORKSPACES_PATH/<workspaceName>/features/<featureName>/apps/*`
  - same orchestration behavior as workspace pool up
- `POST /api/workspaces/:workspaceName/features/:featureName/dev-pool/down`
  - scans `DIND_WORKSPACES_PATH/<workspaceName>/features/<featureName>/apps/*`
  - same orchestration behavior as workspace pool down

Health endpoint:

- `GET /health`
- `GET /api/pools/ps`
  - proxy-like `docker ps` response for running containers
  - use `GET /api/pools/ps?all=true` to include stopped containers (`docker ps -a`)
- `POST /api/agent/run`
  - runs `agent chat` inside a specific app container
  - request body:
    - `containerId` (string)
    - `prompt` (string)
    - `threadId` (optional string; if omitted manager auto-creates a new thread)
    - `model` (optional string; overrides `MANAGER_AGENT_MODEL` for this request)

## Extending Design

`entrypoint.sh` is intentionally split into init + render steps.

- **New agent provider**: add a new renderer function and a `case` branch in `render_agents()`.
- **New service schema**: add `init_service_states "<name>"` and `render_service_links "<name>" "<container target>"`.
- **Multiple active states**: replace hardcoded `default` with a selected state value (env/config) and link that state.

## Conversation Persistence Layout

Conversation-related cursor state is persisted under `DIND_HOME_PATH/state/conversations`
(and therefore on host under `HOST_HOME_PATH/state/conversations`):

- Dind father agent:
  - `dind/father/cursor/dot-cursor` -> symlinked to `/root/.cursor` in dind
- App worker agents (per pool + per app):
  - `pools/<workspace>/apps/<app>/worker/cursor/dot-cursor` -> mounted to `/root/.cursor` in app container
- Feature app worker agents (per feature pool + per app):
  - `pools/<workspace>/features/<feature>/apps/<app>/worker/cursor/dot-cursor` -> mounted to `/root/.cursor` in app container

## Useful Commands

From `services/dind`:

- Dev build + restart:
  - `./setup.sh`
- Local prod run from image:
  - `./setup.prod.sh`
- Tail runtime log:
  - `tail -f ../../runtime/.vibeboyrunner/runtime/logs.log`
- Open shell in container:
  - `docker exec -it vbr-dind bash`
- Check tools:
  - `docker exec vbr-dind sh -lc 'agent --version && gh --version && git --version'`
  - expected git version: `2.53.0`
- Check dind daemon:
  - `docker exec vbr-dind sh -lc 'docker info'`

