# Developer Onboarding Acceptance

Revertible end-to-end acceptance for the L1 onboarding manual: starting from a
clean Linux host, `make dev-up` must install the toolchain, start Station via
compose, and leave the Desktop/Mobile toolchains installable without a GUI.

## What it verifies

1. zero-dependency preflight (Node installed with only bash/curl/tar);
2. toolchain bootstrap (Docker Engine + compose, Go pinned to `go.mod`, Node
   LTS, Rust, protoc, Tauri Linux system libraries) through reachable mirrors;
3. worktree-local compose profile works **without** a sibling `env` repository;
4. Postgres + Station containers become healthy on the restricted network
   using the internal image registry;
5. the four dev accounts are seeded;
6. Desktop/Mobile install steps succeed headless: `pnpm install`, proto
   generation, `pnpm run check`, and `cargo check` — no GUI is launched.

## Usage

```bash
# from the peers-touch repository
tooling/scripts/dev-onboarding/accept-onboarding.sh authorize   # one-time central git key
tooling/scripts/dev-onboarding/accept-onboarding.sh all         # clone → dev-up → assert → clients
tooling/scripts/dev-onboarding/accept-onboarding.sh reset       # containers/volumes/clone gone
tooling/scripts/dev-onboarding/accept-onboarding.sh teardown    # host back to pre-run state
```

Configuration (environment overrides):

| Variable | Default | Purpose |
| --- | --- | --- |
| `ACCEPT_HOST` | `shuxian@10.37.52.145` | target clean host |
| `ACCEPT_BRANCH` | `feat/developer-guidance-enhancement` | branch to exercise |
| `ACCEPT_DIR` | `~/peers-touch-onboarding` | remote clone location |
| `ACCEPT_REGISTRY` | `hub.byted.org` | image prefix (`""` for Docker Hub) |
| `BOOTSTRAP_DOCKER_APT` | _(unset → aliyun)_ | docker-ce apt mirror override |

## Revertibility contract

- `reset` removes only acceptance-owned state: the compose project
  (`pt-local`) containers, volumes and local images, the clone, and its
  machine registration. Toolchain packages stay installed for fast reruns.
- `teardown` additionally purges docker/go/node/rust packages, apt sources,
  `/opt/peers-dev`, `/etc/profile.d/peers-dev.sh`, cargo/rustup state, and
  revokes the host's key on the central git server.

After `teardown`, a subsequent `all` run must observe the same first-run
behaviour (preflight re-installs Node, docker group membership is recreated
with the exit-code-3 relogin step).

## Manual single-run flow (when debugging)

```bash
ssh shuxian@10.37.52.145
git clone -b <branch> shuxian@10.37.246.80:peers-touch/bare.git ~/peers-touch-onboarding
cd ~/peers-touch-onboarding
make dev-up CHECK_ONLY=1
make dev-up INSECURE_REGISTRY=hub.byted.org IMAGE_REGISTRY=hub.byted.org
# exit code 3 → open a new SSH session and rerun; previous steps are cached
make station-check
```
