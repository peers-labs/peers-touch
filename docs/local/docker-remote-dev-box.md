# Docker Remote Environments

> Local notes — this file is gitignored (`docs/local/`).

## Quick Reference

```bash
# Deploy to a specific remote
make docker-station REMOTE=dev-box
make docker-relay   REMOTE=home-213
make docker-all     REMOTE=dev-box
make docker-ps      REMOTE=dev-box
make docker-down    REMOTE=dev-box

# Local (no REMOTE)
make docker-station

# List all contexts
make docker-remotes
```

## Adding a New Remote

### 1. Create Docker context (one-time)

```bash
docker context create <name> --docker "host=ssh://<user>@<host>"
```

### 2. Create env file (one-time)

```bash
cp tooling/docker/.env.example tooling/docker/.env.<name>
# Edit .env.<name> with remote-specific values (secret, ports, etc.)
```

### 3. Use it

```bash
make docker-station REMOTE=<name>
```

## Registered Remotes

| Context Name | Host | SSH User | Notes |
|-------------|------|----------|-------|
| `dev-box` | `10.37.246.80` | `shuxian` | Office dev server, Docker 26.1.4 |

> Add more rows as you create new contexts.

## How It Works

- `REMOTE=<name>` maps to `docker --context <name>` — direct passthrough, no mapping table.
- Makefile auto-selects `tooling/docker/.env.<name>` if it exists, falls back to `tooling/docker/.env`.
- Docker context is stored locally at `~/.docker/contexts/`.
- `docker build` sends the build context to remote via SSH — use `.dockerignore` for large projects.
- `volumes` in compose files mount **remote** paths, not local paths.

## Current Containers on dev-box

| Container | Image | Port | Name |
|-----------|-------|------|------|
| MySQL 8.0 | `mysql:8.0` | `13306→3306` | `hub-mysql` |
| PostgreSQL 16 | `postgres:16-alpine` | `5432→5432` | `peers-pg` |
| ChromaDB | `chromadb/chroma:1.5.2` | `8000→8000` | `chromadb` |
