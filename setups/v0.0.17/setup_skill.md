---
name: vibeboyrunner-setup
description: Guides a user through installing and connecting to Vibeboyrunner — an AI-powered development environment that orchestrates worker agents inside containers.
---

# Vibeboyrunner Setup Skill

You are helping a user set up Vibeboyrunner on their machine. Follow the steps below in order. Execute one step at a time and wait for the user to confirm before moving to the next.

## Environment Detection

Before starting, determine your execution context. This affects how you guide the user.

**Try running any shell command** (e.g., `echo ok`).

- **If you CAN run commands** → you are in a terminal-capable client (Cursor, Claude Code, Windsurf, etc.). Proceed with automated checks and installations. Detect which client you are running in — this matters for the Cursor check later.
- **If you CANNOT run commands** → you are in a non-terminal client (ChatGPT, web chat, etc.). You must guide the user manually through every step using copy-pasteable commands and links. Prefix every instruction with what the user should run in their own terminal.

## Prerequisites Check

Check each prerequisite below. If something is missing, offer to install it. Always ask for confirmation before installing anything.

### 1. Docker

**Terminal mode:** run `docker info`.

**No-terminal mode:** ask the user to open a terminal and run `docker info`, then report the result.

If Docker is not installed or not running, detect the platform (`uname -s` or ask the user) and offer to install:

- **macOS** — check for Homebrew (`which brew`). If available: `brew install --cask docker`. Otherwise direct user to https://docs.docker.com/get-docker/
- **Linux** — offer: `curl -fsSL https://get.docker.com | sh`
- **Windows** — direct user to https://docs.docker.com/get-docker/ (Docker Desktop installer)

After installation, remind the user to **start Docker Desktop** (macOS/Windows) or **start the Docker daemon** (Linux: `sudo systemctl start docker`). Re-run `docker info` to confirm.

### 2. Cursor IDE

Vibeboyrunner requires Cursor IDE as the host for the Father Agent inside the container.

**If you are running inside Cursor** — already satisfied, skip.

**If you are running in a different terminal client or non-terminal client:**

Check if Cursor is installed:

- **Terminal mode:** run `which cursor || ls /Applications/Cursor.app 2>/dev/null || ls "$LOCALAPPDATA/Programs/Cursor" 2>/dev/null` (adapt to detected OS).
- **No-terminal mode:** ask the user if they have Cursor installed.

If not installed, offer to install:

- **macOS with Homebrew:** `brew install --cask cursor`
- **All platforms:** direct user to https://cursor.com/download

After installation, ensure the `cursor` shell command is available. If not, tell the user to open Cursor, open the Command Palette (Cmd+Shift+P / Ctrl+Shift+P), and run **Shell Command: Install 'cursor' command in PATH**.

### 3. Dev Containers Extension

**Terminal mode:** run `cursor --list-extensions 2>/dev/null | grep -i "dev.containers\|remote-containers"`.

If the extension is not found, offer to install it:

```
cursor --install-extension ms-vscode-remote.remote-containers
```

If the `cursor` CLI is not available (the command fails), tell the user to:
1. Open Cursor
2. Open the Command Palette (Cmd+Shift+P / Ctrl+Shift+P)
3. Run **Shell Command: Install 'cursor' command in PATH**
4. Then retry the install command above

**No-terminal mode:** tell the user to open Cursor, go to Extensions (Cmd+Shift+X / Ctrl+Shift+X), search "Dev Containers", and install it.

**Stop and wait** for user confirmation that all prerequisites are satisfied before proceeding.

## Step 1 — Install Vibeboyrunner CLI

**Terminal mode:** run the setup script directly:

```
curl -fsSL "https://vibeboyrunner.github.io/vibeboyrunner/setups/v0.0.17/setup.sh" | bash -s install
```

**No-terminal mode:** give the user the command above to copy-paste into their terminal.

This downloads the setup script and runs the `install` command, which:
- Places the `vibeboyrunner` CLI at `~/.vibeboyrunner/bin/vibeboyrunner`.
- Adds `~/.vibeboyrunner/bin` to the user's PATH in their shell rc file.

**Important:** The PATH change only takes effect in new shells. In the current session (and in every subsequent shell command you run), you MUST prepend the PATH export when calling `vibeboyrunner`. Always use this pattern:

```
export PATH="$HOME/.vibeboyrunner/bin:$PATH" && vibeboyrunner <command>
```

Verify the CLI is available:

```
export PATH="$HOME/.vibeboyrunner/bin:$PATH" && vibeboyrunner help
```

**Stop and wait** for user confirmation.

## Step 2 — Start Vibeboyrunner

Run (or tell the user to run):

```
export PATH="$HOME/.vibeboyrunner/bin:$PATH" && vibeboyrunner up
```

This pulls the Vibeboyrunner Docker image (if not already present) and starts the container. The user should see output confirming the container started successfully, including an **"Open in Cursor"** deeplink.

To check status at any time:

```
export PATH="$HOME/.vibeboyrunner/bin:$PATH" && vibeboyrunner status
```

To view logs:

```
export PATH="$HOME/.vibeboyrunner/bin:$PATH" && vibeboyrunner logs
```

**Stop and wait** for user confirmation that the container is running.

## Step 3 — Connect Cursor IDE to the Container

The `vibeboyrunner up` output includes an **"Open in Cursor"** deeplink. Tell the user to click or paste this link into their browser. It opens a new Cursor window already attached to the container at `/workdir` — no manual steps required.

The link looks like: `cursor://vscode-remote/attached-container+<hex>/workdir?windowId=_blank`

If the deeplink does not work (e.g., Cursor is not registered as a URI handler), fall back to the manual method:

1. Open **Cursor IDE**.
2. Open the Command Palette: **Cmd+Shift+P** (macOS) or **Ctrl+Shift+P** (Windows/Linux).
3. Type and select: **Dev Containers: Attach to Running Container...**
4. Select the container named **vibeboyrunner** (or the name shown in `vibeboyrunner status`).
5. Once connected, open the folder: **File → Open Folder → /workdir**

**Stop and wait** for user confirmation that they are connected and see `/workdir` in Cursor.

## Step 4 — Say Hi to the Father Agent

The user is now inside the Vibeboyrunner environment in Cursor. Tell them to:

1. Open the Cursor Agent chat (Cmd+L / Ctrl+L or the chat panel).
2. Say **Hello** — the Father Agent will detect this is a fresh installation and start the onboarding flow automatically.

The Father Agent takes over from here. The user is all set — happy coding!

**If you are a non-terminal LLM:** your job is done. The Father Agent inside the container handles everything from here. Tell the user they can continue their journey in the Cursor chat inside the container.

## Summary

Recap what was done:
- Verified and installed prerequisites (Docker, Cursor, Dev Containers extension).
- Installed the `vibeboyrunner` CLI.
- Started the Vibeboyrunner container.
- Connected Cursor IDE to the container via the deeplink.
- Introduced the Father Agent who handles everything inside the environment.

The user can manage the environment anytime with (in a new terminal, or by prepending `export PATH="$HOME/.vibeboyrunner/bin:$PATH" &&`):
- `vibeboyrunner up` — start/update the container.
- `vibeboyrunner down` — stop and remove the container.
- `vibeboyrunner status` — check container status.
- `vibeboyrunner logs` — tail container logs.
- `vibeboyrunner version` — show installed version.
