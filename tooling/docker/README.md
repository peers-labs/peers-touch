# Docker Deploy — Peers-Touch Test Environment

Five-node test topology, fully isolated at the Docker layer:

| Env | Host | Profile | Port |
|-----|------|---------|------|
| `pt-relay`              | 192.0.2.20 | relay   | 18081 |
| `pt-station-1`          | 192.0.2.10 | station | 18080 |
| `pt-station-2`          | 192.0.2.60 | station | 18080 |
| `pt-station-relay-only` | 192.0.2.60 | station | 18082 |
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

## Build cache contract

Station builds require BuildKit. The default Go and Ubuntu references use
official tags pinned to multi-architecture index digests, shared by amd64 and
arm64. `builder-base.Dockerfile` pins the same Ubuntu index. Update these
digests deliberately when updating the SDK or base OS; daemon registry mirrors
remain responsible for fetching missing content.

The cache belongs to the Docker builder on each target host. Once the pinned
manifest, config, and layers are present in that builder's content cache,
BuildKit can resolve the base from local content. A metadata step in the build
log does not itself mean layers were downloaded. Another builder or host, cache
pruning, missing content, a changed digest, or an explicit pull can require
registry access again.

Build commit, label, and time are declared after builder dependencies and after
all runtime filesystem layers. Changing this metadata therefore preserves the
dependency-download and runtime package-install layers. Both Go binaries share
the persistent BuildKit cache at `/root/.cache/go-build`: changed source or
linker metadata still rebuilds the binaries while reusing compiled dependencies.
The first build after introducing the cache mount populates this compiler cache.

For a focused check, run the canonical Station deploy twice on the same target
with a different build time. Confirm the runtime `apt-get` and dependency
download steps are `CACHED`, compare both Go build durations, and verify the
deployed `/app-meta/version` still reports the intended commit and new build
time. `--network=none` only restricts build-step networking and is not proof
that base-image metadata resolution worked offline.

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
  Linux host `192.0.2.20`. Station and Relay may run on different hosts;
  Acceptance opens separate reviewed transports and never assumes
  co-location.
- **Hierarchy-merge overlays** (no source-tree edits): `entrypoint.sh`
  emits `store.docker.yml` (DSN), `paths.docker.yml` (key paths under
  `/app/data`), and `bootstrap.docker.yml` (DHT seeds) into `/app/conf/`
  at startup, then appends them to `peers.yml`'s `includes:` list.
  `apps/station/app/conf/peers.yml` and `sub_bootstrap.yml` are
  **never modified** — overlays win by being last.
- **Persistent identities**: a single named volume `peers_data:/app/data`
  persists `bootstrap.key` as the logical Station root and
  `station-node.key` as the physical node identity. The current transport key
  remains persisted until the NCP-03 atomic transport cut removes that data
  plane.
- **Federation rollout — two-step plan** (see [`.localenv`](../../.localenv) §6):
    - Step 1 (this PR): libp2p layer — DHT seed wiring via overlays.
      Zero station Go code change.
    - Step 2 (next PR): application layer — Station auto-registers with
      Relay's HTTP `register` endpoint on boot, and the
      `PEERS_FEDERATION_DIRECT_*` switches become real flags consumed
      by station code.
