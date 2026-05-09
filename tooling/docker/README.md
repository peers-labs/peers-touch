# Docker Deploy — Peers-Touch Station

Deploy Station and Relay Station via Docker Compose, locally or to a remote dev-box.

## Quick Start

```bash
# 1. Create .env from template
cp tooling/docker/.env.example tooling/docker/.env
# Edit .env — at minimum set PEERS_AUTH_SECRET

# 2. Deploy Station locally
make docker-station

# 3. Deploy Relay Station to remote dev-box
make docker-relay REMOTE=1
```

## Commands

| Command | Description |
|---------|-------------|
| `make docker-station` | Build + start Station + PostgreSQL |
| `make docker-relay` | Build + start Relay Station + PostgreSQL |
| `make docker-up` | Start all services (station + relay) |
| `make docker-down` | Stop and remove all containers |
| `make docker-logs` | Tail logs from all services |
| `make docker-ps` | Show running containers |

Add `REMOTE=1` to any command to deploy via the `dev-box` Docker context (SSH to `10.37.118.48`).

## Files

```
tooling/docker/
├── station.Dockerfile   # Multi-stage Go build → Alpine runtime
├── compose.yml          # Service definitions with profiles
├── .env.example         # Environment variable template
├── .env                 # Your local config (gitignored)
└── README.md            # This file
```

## Architecture

- **Single Dockerfile**: Station and Relay use the same binary, differentiated by config.
- **Compose profiles**: `station` and `relay` can be started independently or together.
- **PostgreSQL**: Shared database, auto-started as a dependency.
- **REMOTE mode**: Uses `docker --context dev-box` to route all commands to the remote Docker Engine via SSH.

## Configuration

Environment variables in `.env`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PEERS_AUTH_SECRET` | Yes | — | JWT signing secret |
| `POSTGRES_USER` | No | `peers` | Database user |
| `POSTGRES_PASSWORD` | No | `peers` | Database password |
| `POSTGRES_DB` | No | `peers_touch` | Database name |
| `STATION_PORT` | No | `18080` | Station host port |
| `RELAY_STATION_PORT` | No | `18081` | Relay Station host port |

Station config files are mounted from `apps/station/app/conf/` as read-only volumes.
