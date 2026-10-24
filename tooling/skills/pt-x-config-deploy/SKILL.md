---
name: pt-x-config-deploy
description: Deploy or roll back the apps/x-config service to a named SSH target through the reviewed make deploy pipeline (same source-sync/lease pipeline as make station). Use for x-config 服务部署/升级/回滚, deploying x-config to fiveArm corpstable or Home preview, refreshing the x-config server binary/container.
---

# X Config Service Deploy

## Invoke When

- Deploying, upgrading, or rolling back the `apps/x-config` API service to
  one of its named environments:
  - `xconfig-corpstable` — fiveArm `10.37.221.38`, corpstable channel,
    origin `http://10.37.221.38:18082`;
  - `xconfig-preview` — Home `peers.shux.me:12222`, stable channel,
    public origin `https://xconfig.peers.shux.me:28443`.
- Verifying a deployed x-config runtime (health, current snapshot, logs).

Do not use for: publishing catalog content (snapshots/directives/origins go
through `pt-x-config-catalog-publish` via the admin API), Station lifecycle
(`make station`), relay/station service deploys (`make deploy ENV=<their
env>`), or OAuth broker/Vercel deployment (`pt-oauth2-client-2-vercel`).

## Core Rule — Use The Station Pipeline, Never Hand SCP

x-config deploys through the **same reviewed remote pipeline as
`make station` remote mode**: `make deploy ENV=<name>` resolves a
git-tracked deploy definition in the sibling `env` repository, then
source-syncs the exact commit to the target's
`$HOME/peers-touch/repo` worktree, takes a machine/resource lease, runs the
reviewed build and restart commands over SSH, and health-checks.

- The SSH target (host, user, port, paths, build, restart, health URL) is
  declared once in the reviewed, git-crypt-tracked definition:
  `env/peers-touch/<host>/deploy/<name>.env.example` (`PT_DEPLOY_*`).
- **Deploying to another IP is adding or editing a reviewed deploy env
  file, never passing an IP in chat or on a command line.** A new target
  needs its own reviewed definition plus a provisioned runtime root.
- Do not hand-`scp` binaries, run inline SSH build commands, or edit the
  remote runtime outside this pipeline. The deploy definition is the only
  write authority.

## Required Discipline

- Two repositories participate, both on clean tracked revisions:
  - product repo (`peers-touch`): the commit to deploy, built remotely;
  - env repo (`env`, default sibling of the product root, override with
    `PT_ENV_REPO`): the `PT_DEPLOY_*` definition must be committed (the
    resolver rejects untracked/duplicate/dirty env directories).
- `deploy.sh` runs on Unix targets only. The synced source is the whole
  product worktree because `apps/x-config/go.mod` has local `replace`
  directives into `../station/frame`, `../oauth2-client`, and
  `../../packages/github-repository`.
- The container is an `nginx:stable-alpine` shell whose entrypoint runs the
  mounted binary. Deploy replaces the artifact under
  `~/.peers-touch/runtime/x-config-<env>/artifacts/` and rolls the existing
  Compose project; the image, project name, ports, and runtime root stay
  exactly as the infra definitions declare.
- The reviewed build command builds natively on the host (`linux/arm64`,
  static, `CGO_ENABLED=0`) with a per-env Go cache under
  `~/.cache/peers-touch/build/xconfig-<env>` and
  `GOPROXY=https://goproxy.cn,direct` (the corp hosts cannot reach
  proxy.golang.org). It keeps the previous binary as
  `artifacts/x-config-server.prev`.
- `state/` (operator SQLite sessions, mode `0700`, uid/gid `101:101`) is
  the only writable mount. The pipeline never touches it. Never copy,
  restore, reown, or delete it; rolling an older DB over newer state is
  unsupported.
- Secrets live only in the git-crypt `runtime.env` provisioned in the
  runtime root from `peers-touch-infra/x-config-*`. Deploy definitions
  contain no secret values; never print `runtime.env`, commit a decrypted
  copy to the product repo, or pass secrets in argv.
- A deploy does not publish catalogs. After the roll, the current signed
  CAS sequence must still be served byte-identical.

## One-Time Runtime Provisioning (not part of every deploy)

A target host needs, once, from `peers-touch-infra/x-config-<env>/`:

1. `~/.peers-touch/runtime/x-config-<env>/` containing the committed
   `*.compose.yml`, the git-crypt-decrypted `runtime.env` (mode `0600`),
   and `state/` (`0700`, owner `101:101`);
2. `artifacts/` with an initial `x-config-server` binary;
3. corpstable only: the ULA/NAT66 compose network and
   `X_CONFIG_ALLOW_PRIVATE_HTTP=1` (already in its env);
4. preview only: edge nginx config (`home-web.conf`/`home-edge.conf`)
   reloaded, and the console static bundle under `artifacts/console`.

Provisioning changes are reviewed in the env/infra repositories. Re-running
`make deploy` for a code bump never re-provisions these.

## Workflow

### 1. Preflight

```sh
# product repo: exact commit being deployed
git status --short && git rev-parse HEAD
# env repo: clean and current; the resolved definition must be unique
bash tooling/scripts/deploy/deploy.sh resolve xconfig-corpstable
# target reachability + current snapshot (record before/after)
curl -fsS http://10.37.221.38:18082/channels/corpstable/latest.pb | shasum -a 256
```

Deploying a non-default ref: `BRANCH=<ref> make deploy ENV=xconfig-corpstable`.

### 2. Deploy

```sh
make deploy ENV=xconfig-corpstable          # or xconfig-preview
```

The pipeline: source-sync exact commit to `$HOME/peers-touch/repo` → lease
→ remote static Go build into `artifacts/x-config-server.new` → keep
`.prev`, atomic `install` → `docker compose ... up -d` → health poll. A
failed health check exits non-zero and leaves the previous container
stopped/failed visibly; inspect logs, do not retry blindly.

### 3. Verify

```sh
make deploy-status ENV=xconfig-corpstable
make deploy-logs   ENV=xconfig-corpstable
docker ps --filter name=peers-x-config-corpstable-api   # healthy
```

- Health endpoint in the deploy definition returns success.
- `latest.pb` SHA-256 equals the GitHub CAS current sequence and the
  pre-deploy payload (a service deploy changes no catalog content).
- Response keeps `application/protobuf`, ETag, `nosniff`.
- corpstable: confirm from a corp-network client on
  `http://10.37.221.38:18082`.
- preview: confirm the public TLS origin and, when touched, operator login;
  the console bundle is rebuilt in the same deploy command.

### 4. Rollback

```sh
make deploy-repair ENV=xconfig-corpstable   # reviewed restart only
```

Binary rollback: on the host, `install -m 0755
artifacts/x-config-server.prev artifacts/x-config-server` in the runtime
root and re-run `make deploy ENV=...` (or the reviewed restart command),
then repeat step 3. Never roll back by restoring `state/`. If an env
revision caused the failure, revert/redeploy the reviewed definition; do
not hand-edit secrets on the host.

## Output

Report: environment name, deployed app commit and branch, env-repository
revision of the deploy definition, target host/SSH port, container status,
health result, served channel sequence before/after, and any unproven
scope. A deploy checkpoint is not Acceptance; real operator/public-read
journeys follow
`docs/architecture/platform/client/control-plane/runtime-verification.md`.

## Verification

- `bash tooling/scripts/deploy/deploy.sh resolve xconfig-corpstable` and
  `... xconfig-preview` each resolve to exactly one git-tracked file.
- `make deploy-status ENV=<name>` reaches the right host (host in the
  definition equals the intended target) before any deploy.
- Exactly one project container exists after roll:
  `peers-x-config-corpstable-api` / `peers-x-config-api` (+
  `peers-x-config-web` on preview).
- The remote build artifact is a static Linux aarch64 ELF:
  `file artifacts/x-config-server` on the host.
- `rg -n 'X_CONFIG_(OAUTH_REDEEM_SECRET|SIGNING_KEYS)' env/peers-touch/`
  shows key names only inside git-crypt runtime files, never in deploy
  definitions or the product repo.

## Anti-Patterns

- Hand-`scp` of binaries, ad-hoc SSH build commands, or a chat-supplied IP
  instead of a reviewed deploy env.
- Building on a macOS workstation and shipping the binary, or building a
  dirty/uncommitted tree.
- Running compose from a different directory/project name, or replacing
  the nginx-shell image.
- Touching, restoring, or chowning `state/`, or printing/committing
  `runtime.env`.
- Forgetting that the corp hosts need `GOPROXY=https://goproxy.cn,direct`
  (proxy.golang.org is unreachable there).
- Bundling catalog publication, OAuth broker work, Station/relay deploys,
  or one-time runtime provisioning into a code deploy.
- Declaring success from container start alone without health and
  current-sequence verification.
