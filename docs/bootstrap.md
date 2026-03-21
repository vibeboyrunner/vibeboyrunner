# Bootstrap and Runtime Contract

This document describes what the dind container initializes at startup and how persistent state is mounted.

## Architecture Overview

VibeBoyRunner is a Docker-in-Docker container. `entrypoint.sh` bootstraps persistent state (agents, service auth, workspaces), then starts the inner Docker daemon and manager service.

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

## Bootstrap Sequence

On startup, `entrypoint.sh` runs:

### 1) Agents store

Creates:

- `DIND_HOME_PATH/agents/father/skill.md`
- `DIND_HOME_PATH/agents/father/rule.mdc`

For Cursor provider, renders symlinks:

- `DIND_WORKDIR_PATH/.cursor/skills/father/SKILL.md` -> `DIND_HOME_PATH/agents/father/skill.md`
- `DIND_WORKDIR_PATH/.cursor/rules/father.mdc` -> `DIND_HOME_PATH/agents/father/rule.mdc`

### 2) Service auth states

Creates default state directories:

- `DIND_HOME_PATH/services/gh/default`
- `DIND_HOME_PATH/services/cursor/default`

Renders active-state symlinks:

- `/root/.config/gh` -> `DIND_HOME_PATH/services/gh/default`
- `/root/.config/cursor` -> `DIND_HOME_PATH/services/cursor/default`

### 3) Workspaces

Ensures `DIND_WORKSPACES_PATH` exists.

For each existing workspace, backfills:

- `<workspace>/apps`
- `<workspace>/features`

Note: bootstrap does not auto-create onboarding scaffold. Onboarding starts explicitly by user request; the Father Agent creates `workspaces/onboarding/{apps,features}` when needed.

### 4) Manager service

Manager is built and started:

- Installs deps on first boot (`DIND_SERVICES_PATH/manager/node_modules`)
- Builds with `npm run build`
- Runs with `npm run start`

Manager source is under `services/dind/manager`; both dev and prod use the image-baked copy.

### 5) Git identity bootstrap

Configures git identity from env:

- `git config --global user.name` <- `GIT_USER_NAME`
- `git config --global user.email` <- `GIT_USER_EMAIL`

## Conversation Persistence Layout

Conversation state persists under `DIND_HOME_PATH/state/conversations`:

| Context            | Path                                                                       | Mounted to                       |
| ------------------ | -------------------------------------------------------------------------- | -------------------------------- |
| Father agent       | `dind/father/cursor/dot-cursor`                                            | `/root/.cursor` in dind          |
| App worker         | `pools/<workspace>/apps/<app>/worker/cursor/dot-cursor`                    | `/root/.cursor` in app container |
| Feature app worker | `pools/<workspace>/features/<feature>/apps/<app>/worker/cursor/dot-cursor` | `/root/.cursor` in app container |

## Agent Providers

The manager uses an `AgentProvider` interface and selects providers via `AGENT_PROVIDERS`.

| Provider | CLI      | Status    | `AGENT_PROVIDERS` value |
| -------- | -------- | --------- | ----------------------- |
| Cursor   | `agent`  | Available | `cursor` (default)      |
| Claude   | `claude` | Planned   | `claude`                |
| Gemini   | `gemini` | Planned   | `gemini`                |

Each provider handles CLI install, config symlinks, conversation paths, and chat execution.

## Extension Points

### Adding an agent provider

1. Implement `manager/src/providers/<name>Provider.ts` (`buildInstallScript`, `buildConfigScript`, `createThread`, `runChat`, `getServicePaths`).
2. Register in `manager/src/providers/index.ts` (`createAgentProvider` factory).
3. Add renderer branch in `render_agents()` in `entrypoint.sh`.
4. Add `init_service_states "<name>"` and `render_service_links "<name>" "<target>"` in `entrypoint.sh`.

### Other extension points

- New service schema: add `init_service_states "<name>"` and `render_service_links "<name>" "<target>"`.
- Multiple active states: replace hardcoded `default` with a selected state value and link that state.
