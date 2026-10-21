# Development Docker Assets

This directory contains the shared Station, Relay, PostgreSQL, builder-cache,
and test container definitions used by Local Dev, CI, deployment, and
Acceptance.

Normal source development starts through a Profile:

```bash
make profile-init local
make profile local
make station
```

Do not call `docker compose up station` directly. `devctl` supplies the selected
Profile, isolated project name, ports, generated local secrets, build identity,
and readiness closure.

## Files

- `compose.yml`: shared development and test service graph.
- `station.Dockerfile`: Station and Relay image.
- `builder-base.Dockerfile`: reusable build-toolchain base.
- `entrypoint.sh`: runtime configuration overlays and role startup.
- `.env.example`: operator reference for manually managed environments.
- `configure-apt-mirror.sh`: explicit optional package-mirror configuration.
- `warm-builder-cache.sh`: reviewed remote builder-cache operation.

Worktree-local `profile-init` does not copy `.env.example`. It creates a
minimal private file under `.local/dev/compose/<profile>.env` with generated
Station and PostgreSQL secrets.

## Ownership Boundaries

- Local topology and ports come from the selected Profile and machine binding.
- Remote topology comes from the reviewed sibling `env` repository.
- Public self-host installation uses immutable assets under
  `tooling/distribution/`; it does not consume this development Compose file.
- Acceptance may consume this image contract through isolated runtime
  manifests; Gates do not invent service URLs or credentials.
- Release images default to official upstream package sources. Reviewed mirror
  values are explicit build inputs, never hidden Dockerfile defaults.

## Secrets

`PEERS_AUTH_SECRET` and `PEERS_DB_PASSWORD` are required runtime secrets.
Generated local values are Git-ignored and private. Remote, CI, Acceptance, and
release paths inject their own scoped values.

Never commit `.env`, key files, credentials, generated runtime configuration,
database volumes, or container logs.

## Focused Checks

```bash
PEERS_AUTH_SECRET=shape-check \
PEERS_DB_PASSWORD=shape-check \
docker compose -f tooling/docker/compose.yml \
  --profile infra --profile station config -q

python3 -m unittest tooling/docker/station_dockerfile_test.py
```

Image build and runtime claims require a working Docker daemon. Static Compose
rendering alone does not prove Station startup or persistence.
