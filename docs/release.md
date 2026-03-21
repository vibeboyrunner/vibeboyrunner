# CI/CD and Release Pipeline

This document describes the dind service release flow.

## Workflows

| Workflow      | Trigger                       | What it does                                                                                                        |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `test.yml`    | Push to `main`, pull requests | Runs manager tests, setup script tests, and Docker smoke test                                                      |
| `publish.yml` | Push tag `v*`                 | Verifies tests passed, builds Docker image, renders setup script, publishes to Pages, creates GitHub release      |

No manual workflow triggers are required.

## Publish Pipeline

On a `v*` tag push, `publish.yml` runs:

1. **Verify tests**: checks via GitHub API that a successful Tests run exists for the same commit SHA.
2. **Build image** (parallel matrix): builds native images on:
   - `ubuntu-latest` (amd64)
   - `ubuntu-24.04-arm` (arm64)
3. **Publish Docker image**: merges digests into a multi-arch manifest and pushes semver tags (`X.Y.Z`, `X.Y`, `latest`) to Docker Hub.
4. **Publish setup script**: reads `.env.example` (SHARED + PROD) to generate prod preamble, appends shared body from `setup.sh`, publishes rendered script + skill to `gh-pages`, then creates GitHub Release.

## Required GitHub Configuration

- Secrets:
  - `DOCKERHUB_USERNAME`
  - `DOCKERHUB_TOKEN`
- Variables:
  - `DOCKERHUB_NAMESPACE`
  - `PAGES_BASE` (optional, defaults to `https://vibeboyrunner.github.io/vibeboyrunner`)

## GitHub Pages Layout

| Path                                    | Content                            |
| --------------------------------------- | ---------------------------------- |
| `setups/<tag>/` (example: `setups/v0.0.6/`) | Version-specific rendered files |
| `setups/latest/`                        | Always matches most recent tag     |

Default install URL:

`https://vibeboyrunner.github.io/vibeboyrunner/setups/latest/setup.sh`
