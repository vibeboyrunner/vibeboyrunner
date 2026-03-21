# Manager API Reference

The manager runs inside the dind container and orchestrates workspace pools plus agent execution.

## Endpoints

### Pool orchestration

| Method | Endpoint                                                     | Description              |
| ------ | ------------------------------------------------------------ | ------------------------ |
| POST   | `/api/workspaces/:workspace/dev-pool/up`                     | Start workspace dev pool |
| POST   | `/api/workspaces/:workspace/dev-pool/down`                   | Stop workspace dev pool  |
| POST   | `/api/workspaces/:workspace/features/:feature/dev-pool/up`   | Start feature dev pool   |
| POST   | `/api/workspaces/:workspace/features/:feature/dev-pool/down` | Stop feature dev pool    |

Pool `up` scans `apps/*` for directories containing both:

- `.vibeboyrunner/config.json`
- `.vibeboyrunner/docker-compose.yml`

Then it allocates free ports and runs `docker compose up -d --build` with resolved bindings. It also:

- Injects compose override to mount shared dind auth states into app containers
- Mounts worker cursor conversation stores into app container root (`/root/.cursor`)
- Runs runtime injection on the main app service (`APP_COMPOSE_SERVICE_NAME`): best-effort install of `git` `2.53.0`, `gh`, and Cursor Agent CLI, plus auth state symlinks

### Monitoring

| Method | Endpoint        | Description                                      |
| ------ | --------------- | ------------------------------------------------ |
| GET    | `/health`       | Health check                                     |
| GET    | `/api/pools/ps` | Running containers (`?all=true` includes stopped)|

### Agent execution

| Method | Endpoint         | Description                              |
| ------ | ---------------- | ---------------------------------------- |
| POST   | `/api/agent/run` | Run `agent chat` inside an app container |

Request body:

- `containerId` (string): target container
- `prompt` (string): prompt to send
- `threadId` (optional string): omit to create a new thread
- `model` (optional string): overrides `MANAGER_AGENT_MODEL`
- `stream` (optional boolean): default `true`; set `false` for legacy single JSON response
- `streamFormat` (optional string): `unified` (default) or `raw`
- `streamEnvelope` (optional string): `plain` (default) or `sse`

## Streaming Behavior

When `stream=true`:

- `streamEnvelope: "plain"` (default): content type `text/plain`; emits chunks without `event:` / `data:` wrappers
- `streamEnvelope: "sse"`: content type `text/event-stream`

### `streamFormat: "unified"` events

- `start`: metadata and selected stream format
- `message`: provider-normalized content chunk (`assistant_text` or `system_log`, including tool progress where available)
- `final`: beautified final payload (`output`, `logs`, provider, thread)
- `result`: full raw result payload (compatibility/debugging)
- `done`: successful stream completion marker
- `error`: failure payload (stream terminates after this event)

### `streamFormat: "raw"` events

- `start`: metadata emitted before execution begins
- `stdout`: streaming stdout chunks from worker
- `stderr`: streaming stderr chunks from worker
- `final`: beautified final payload
- `result`: final structured result payload (same shape as non-streaming response body minus top-level HTTP envelope)
- `done`: successful stream completion marker
- `error`: failure payload (stream terminates after this event)

For pure text streaming in FA/chat UIs, use:

- `stream: true`
- `streamFormat: "unified"` (or `raw`)
- `streamEnvelope: "plain"`
