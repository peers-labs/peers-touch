---
name: pt-x-config-deploy
description: Deploy or roll back the apps/x-config service binary/runtime (corpstable on fiveArm, preview on Home) via its env-repository Compose definition. Use for x-config 服务部署/升级/回滚, deploying x-config to fiveArm or Home, refreshing the x-config server binary/container.
---

# X Config Service Deploy

## Invoke When

- Deploying, upgrading, or rolling back the `apps/x-config` API service
  runtime (binary + Compose + env files).
- Shipping a merged `apps/x-config` change to the corpstable or preview
  x-config host.
- Verifying a deployed x-config runtime (health, current snapshot, state).

Do not use for: publishing catalog content (snapshots/directives/origins go
through `pt-x-config-catalog-publish` via the admin API), Station service
lifecycle (`make station`), or OAuth broker/Vercel deployment
(`pt-oauth2-client-2-vercel`).

## Required Discipline

- Placement truth lives in the sibling `env` repository, never in chat
  memory:
  - corpstable: `peers-touch-infra/x-config-corpstable/`
    (`inventory.yml`, `corp.compose.yml`, git-crypt `runtime.env`),
    host fiveArm `shuxian@10.37.221.38`, runtime root
    `~/.peers-touch/runtime/x-config-corpstable`, origin
    `http://10.37.221.38:18082`, channel `corpstable`.
  - preview: `peers-touch-infra/x-config-preview/`
    (`inventory.yml`, `home.compose.yml`, `home-web.conf`,
    `home-edge.conf`, git-crypt `runtime.env`), Home host, runtime root
    `~/.peers-touch/runtime/x-config-preview`, origin
    `https://xconfig.peers.shux.me:28443` (edge TLS), channel `stable`.
- Build the binary from one clean, committed application revision; never
  deploy an uncommitted tree. Report the exact app commit and env commit.
- The container image is only an `nginx:stable-alpine` shell whose
  entrypoint runs the mounted binary. A service deploy replaces the
  artifact (and env files when reviewed), not the image. Compose project
  name, runtime root, and ports must stay exactly as inventory declares;
  running Compose from another directory creates a second, wrong project.
- `state/` is the only writable mount and owns operator SQLite sessions.
  Never overwrite, copy, restore, or chown it as part of a deploy;
  copying an older database over newer state is unsupported. The
  container runs as uid/gid `101:101`; leave an existing healthy state
  ownership alone.
- `runtime.env` stays git-crypt encrypted in the env repo. Read it in
  place, `scp` it directly to the runtime root, and never print values,
  copy it into the product repository, logs, evidence, or argv. The local
  decrypted working copy must not be committed.
- corpstable is private-network plain HTTP; integrity is the signed
  snapshot, and the service requires `X_CONFIG_ALLOW_PRIVATE_HTTP=1` (already
  in its env). Seed publication probes from fiveArm reach the Home relay
  over IPv6 only; the Compose runtime network must keep its ULA/NAT66
  configuration.
- Catalog/publication truth is the GitHub CAS repository; a service deploy
  does not mutate catalogs. After deploy, the current signed sequence must
  still be served unchanged.

## Workflow — corpstable (fiveArm)

### 1. Preflight

1. Product repo: confirm a clean tree and the exact commit to deploy;
   record it.
2. Env repo: pull and record the commit of
   `peers-touch-infra/x-config-corpstable`; confirm the local
   `runtime.env` is decrypted (git-crypt) without printing it.
3. Confirm target facts from `inventory.yml` (host, runtime root,
   channel, ports); verify SSH:
   `ssh shuxian@10.37.221.38 'uname -m; docker ps --filter name=peers-x-config-corpstable-api'`
   (expect `aarch64`, one container). Note the currently served sequence:
   `curl -fsS http://10.37.221.38:18082/channels/corpstable/latest.pb | wc -c`.

### 2. Build the static binary

```sh
cd apps/x-config
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath \
  -o /tmp/x-config-server-<short-sha> ./cmd/server
shasum -a 256 /tmp/x-config-server-<short-sha>
```

Do not strip differently from the existing artifact without reason; the
deployed file must be a static Linux aarch64 ELF (`file` check).

### 3. Stage artifact and reviewed env atomically

```sh
H=shuxian@10.37.221.38
R=~/.peers-touch/runtime/x-config-corpstable
scp /tmp/x-config-server-<short-sha> "$H:$R/artifacts/x-config-server.new"
ssh "$H" "
  cd $R &&
  cp -p artifacts/x-config-server artifacts/x-config-server.prev &&
  install -m 0755 artifacts/x-config-server.new artifacts/x-config-server &&
  rm artifacts/x-config-server.new"
# Only when the env revision actually changed:
scp ../../env/peers-touch-infra/x-config-corpstable/corp.compose.yml "$H:$R/"
scp ../../env/peers-touch-infra/x-config-corpstable/runtime.env "$H:$R/runtime.env"
ssh "$H" 'chmod 600 ~/.peers-touch/runtime/x-config-corpstable/runtime.env'
```

`x-config-server.prev` is the rollback artifact. Never upload or touch
`state/`.

### 4. Validate and roll

```sh
ssh "$H" 'cd ~/.peers-touch/runtime/x-config-corpstable &&
  docker compose -f corp.compose.yml config >/dev/null &&
  docker compose -f corp.compose.yml up -d &&
  sleep 5 &&
  docker ps --filter name=peers-x-config-corpstable-api --format "{{.Status}}" &&
  curl -fsS http://127.0.0.1:18082/healthz && echo &&
  curl -fsS http://127.0.0.1:18082/channels/corpstable/latest.pb -o /dev/null -w "%{http_code}\n"'
```

Wait for `(healthy)`; inspect logs on any restart loop:
`docker logs --tail=100 peers-x-config-corpstable-api`. Startup must fail
loudly on a bad SQLite path/schema/record key rather than silently serving.

### 5. Verify no behavior regression

- `/healthz` 200 and the container is healthy.
- Anonymous `latest.pb` returns the same CAS sequence/payload as before
  (compare SHA-256 against the GitHub CAS snapshot, or against the
  pre-deploy capture), with `application/protobuf`, ETag, `nosniff`.
- Operator login and an admin session probe only when the deploy touched
  auth/session code; otherwise operator state is untouched.
- From a corp-network client, confirm reachability on
  `http://10.37.221.38:18082`.

## Workflow — preview (Home) differences

Same discipline; additional steps:

1. Build both the Linux API binary and the console
   (`apps/x-config/console`: install + production build) and stage the
   console assets the `home.compose.yml` mounts.
2. Validate and install `home-web.conf`/`home-edge.conf` only when the
   reviewed env revision changed; reload the shared Home edge nginx after
   replacement. Application containers stay loopback-only on `127.0.0.1:18082`.
3. Verify the public TLS origin `https://xconfig.peers.shux.me:28443`
   (healthz, stable `latest.pb`), not only loopback.
4. The OAuth broker callback must already point at the Home callback
   before operator-login verification can pass; broker changes are a
   separate skill and deploy.

## Rollback

```sh
ssh "$H" 'cd ~/.peers-touch/runtime/x-config-corpstable &&
  install -m 0755 artifacts/x-config-server.prev artifacts/x-config-server &&
  docker compose -f corp.compose.yml up -d'
```

Then rerun step 5. Rollback never restores or rewrites `state/`. If an env
revision caused the failure, revert to the previous reviewed env files
with the same staging procedure; never hand-edit secrets on the host.

## Output

Report: deployed app commit, env commit, artifact SHA-256, target host and
runtime root, container status, health result, served channel sequence,
and any unproven scope. A deploy checkpoint is not Acceptance; real
operator/public-read journeys follow
`docs/architecture/platform/client/control-plane/runtime-verification.md`.

## Verification

- `file artifacts/x-config-server` on the host reports
  `ELF 64-bit LSB executable, ARM aarch64, statically linked`.
- Exactly one project container exists:
  `docker ps --filter name=peers-x-config-corpstable-api` (preview:
  `peers-x-config-api`), healthy.
- `docker inspect ... --format '{{range .Mounts}}{{.Source}}->{{.Destination}} {{end}}'`
  shows the read-only artifact and the single `state` mount; no other
  host paths.
- Snapshot bytes after deploy equal the GitHub CAS current sequence.
- `rg -n 'X_CONFIG_' tooling/skills/pt-x-config-deploy/SKILL.md` lists key
  names only; no secret values are recorded anywhere in the product repo.

## Anti-Patterns

- Building on the host, building a dirty tree, or deploying a
  macOS/dynamic binary.
- Running `docker compose up` from outside the declared runtime root or
  with a different project name.
- Touching `state/`, restoring an old SQLite file, or "fixing" its
  ownership while the container is healthy.
- Printing `runtime.env`, committing a decrypted env file, or passing
  secrets on argv.
- Bundling a catalog publication, OAuth broker change, or Station deploy
  into this operation.
- Declaring success from container start alone without health and
  current-sequence verification.
