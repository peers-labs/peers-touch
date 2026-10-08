# Docker Deploy — Peers-Touch Test Environment

Five-node test topology, fully isolated at the Docker layer:

| Env | Host | Profile | Port |
|-----|------|---------|------|
| `pt-relay`              | 10.37.118.48 | relay   | 18081 |
| `pt-station-1`          | 10.37.246.80 | station | 18080 |
| `pt-station-2`          | 10.37.195.98 | station | 18080 |
| `pt-station-relay-only` | 10.37.195.98 | station | 18082 |
| `pt-station-local`      | localhost    | station | 18080 |

Each environment is **its own compose project** (`COMPOSE_PROJECT_NAME=pt-<env>`),
ships **its own postgres container**, and runs on **its own bridge network**.
Hosts only need Docker engine + SSH; everything else lives inside Docker.
See [`.localenv`](../../.localenv) §0 for the isolation contract.

## Quick start

First-time bring-up (Relay must come up before Stations can seed against it):

```bash
make pt-bootstrap                # one-time: register docker contexts, probe SSH
make pt-up   ENV=pt-relay        # bring Relay online
make pt-discover-relay           # write Relay's libp2p multiaddr into station envs
make pt-up   ENV=all             # all five envs
make pt-status                   # health roll-up across all five
make pt-desktop ENV=pt-station-1 # launch paired Desktop client
make pt-down    ENV=pt-station-1 # tear down (host returns to neutral state)
```

`ENV=all` works for `pt-up` / `pt-down`. After the first `pt-discover-relay`,
Relay's PeerID is persisted (named volume `peers_data`), so subsequent
restarts don't need re-discovery. Re-run `make pt-discover-relay` only if
you ever wipe the volume.

## Files

```
tooling/docker/
├── compose.yml                       station + relay + postgres, profile-driven
├── station.Dockerfile                multi-stage Go build, shared by both roles
├── entrypoint.sh                     emits store/paths/bootstrap overlays
├── .env.example                      template (committed)
├── .env                              local Station-3        (gitignored)
├── .env.pt-relay                     real secrets           (gitignored)
├── .env.pt-station-1                 real secrets           (gitignored)
├── .env.pt-station-2                 real secrets           (gitignored)
├── .env.pt-station-relay-only        real secrets           (gitignored)
└── README.md                         this file
```

## Environment variables (per-env)

Required:

| Variable | Purpose |
|----------|---------|
| `COMPOSE_PROJECT_NAME` | Docker-layer namespace; must equal the env name |
| `PEERS_AUTH_SECRET`    | JWT signing secret (per env) |
| `PEERS_DB_PASSWORD`    | Postgres password (shared across envs) |

Optional / structural:

| Variable | Default | Notes |
|----------|---------|-------|
| `POSTGRES_USER`              | `peers`        | |
| `POSTGRES_DB`                | `peers_touch`  | `peers_relay` for the relay env |
| `STATION_HOST`               | —              | Read by `make dev-app REMOTE=<env>` |
| `STATION_PORT`               | `18080`        | Host-side port |
| `RELAY_STATION_PORT`         | `18081`        | Relay env only |
| `LIBP2P_PORT`                | `4001`         | Host-side port for the bootstrap subserver. `4002` on `pt-station-relay-only` to coexist with `pt-station-2`. |
| `PEERS_BOOTSTRAP_NODES`      | empty          | Comma-separated multiaddrs. Filled in by `make pt-discover-relay`; entrypoint translates it into `peers.node.server.subserver.bootstrap.bootstrap-nodes` via the `bootstrap.docker.yml` overlay. |
| `PEERS_FEDERATION_DIRECT_OUTBOUND` | `true`   | Set `false` on `pt-station-relay-only`. Step 2 (code) — placeholder today. |
| `PEERS_FEDERATION_DIRECT_INBOUND`  | `true`   | Set `false` on `pt-station-relay-only`. Step 2 (code) — placeholder today. |

Relay-only, required:

| Variable | Purpose |
|----------|---------|
| `PEERS_NODE_SERVER_BASEURL` | Public HTTPS Relay origin |
| `RELAY_STREAM_LISTEN_ADDR` | Station mount listener |
| `RELAY_TLS_CERT_FILE` / `RELAY_TLS_KEY_FILE` | TLS 1.3 server identity |
| `RELAY_SIGNING_KEY_FILE` | Relay discovery/attestation signing key |
| `RELAY_OPERATOR_KEY_FILE` | Dedicated operator JWT signing key |
| `RELAY_OPERATOR_ISSUER` | Required operator token issuer |
| `RELAY_OPERATOR_AUDIENCE` | Required operator token audience |
| `RELAY_OPERATOR_SCOPE` | Required operator token scope |

`RELAY_ALLOW_INSECURE_LOOPBACK=true` is a development-only exception. It
requires both the stream listener and public HTTP origin to be loopback and
cannot produce formal Acceptance evidence.

Postgres is **never** exposed to the host. To attach a debugger:

```bash
docker --context pt-station-1 compose -p pt-station-1 \
       exec postgres psql -U peers peers_touch
```

## CI/CD

GitHub Actions workflow [`deploy-station.yml`](../../.github/workflows/deploy-station.yml):

- `workflow_dispatch` — manual deploy of one env or all four remote envs.
- `push tag v*.*.*` — auto-deploy to all four remote envs.
- Build runs **on each remote** via `docker --context` over SSH. No GHCR.
- Per-env Secrets (`PEERS_AUTH_SECRET`, `PEERS_DB_PASSWORD`) live in
  GitHub Environments named identically to the envs.

## Architecture notes

- **Single Dockerfile**, single image. The `relay` profile and the `station`
  profile share `station.Dockerfile`; Compose sets `PEERS_NODE_ROLE` explicitly.
  The Relay allowlist excludes all Station business subservers. Relay service
  hosts are Linux/POSIX-only; Windows remains a client or separately governed
  Station platform.
- **Relay secret ownership**: the reviewed Linux deploy owner prepares
  signing/operator/TLS files under its isolated runtime root and mounts only
  the required files read-only at `/app/relay-secrets`. The CA private key is
  never mounted into the Relay container.
- **Official applet service closure**: Station may bundle official applet
  services via local Go module `replace` directives. The Docker build context
  therefore includes `apps/applets/` so `apps/station/app/go.mod` can resolve
  `../../applets/<id>/service` inside the builder without applet-specific
  Dockerfile edits.
- **Healthcheck endpoint**: Station uses `/sub-oss/healthz`; Relay uses its
  role-owned `/healthz` probe. Relay `/metrics` requires an operator credential.
- **Canonical Relay host**: profile `one` binds the Relay Compose owner to
  Linux host `10.37.118.48`. Station and Relay may run on different hosts;
  Acceptance opens separate reviewed transports and never assumes
  co-location.
- **Hierarchy-merge overlays** (no source-tree edits): `entrypoint.sh`
  emits `store.docker.yml` (DSN), `paths.docker.yml` (key paths under
  `/app/data`), and `bootstrap.docker.yml` (DHT seeds) into `/app/conf/`
  at startup, then appends them to `peers.yml`'s `includes:` list.
  `apps/station/app/conf/peers.yml` and `sub_bootstrap.yml` are
  **never modified** — overlays win by being last.
- **Persistent libp2p identities**: a single named volume
  `peers_data:/app/data` persists both `libp2pIdentity.key` (transport)
  and `bootstrap.key` (bootstrap subserver), so PeerIDs survive container
  recreation. `make pt-discover-relay` therefore only needs to run once
  per topology (until you `pt-down ENV=pt-relay -v`).
- **Federation rollout — two-step plan** (see [`.localenv`](../../.localenv) §6):
    - Step 1 (this PR): libp2p layer — DHT seed wiring via overlays.
      Zero station Go code change.
    - Step 2 (next PR): application layer — Station auto-registers with
      Relay's HTTP `register` endpoint on boot, and the
      `PEERS_FEDERATION_DIRECT_*` switches become real flags consumed
      by station code.
