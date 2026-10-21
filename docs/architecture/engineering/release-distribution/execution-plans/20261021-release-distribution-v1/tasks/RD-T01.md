# RD-T01 — Mirror Parameterization Across Four Build Consumers

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RD-20261021",
  "taskId": "RD-T01",
  "workstreamId": "RD",
  "title": "Parameterize apt/Go/GOPROXY/GOSUMDB mirrors across all station image build consumers with official-source defaults",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "rd-mirror-parameterization",
  "journeyId": "RD-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/docker/station.Dockerfile",
    "tooling/docker/builder-base.Dockerfile",
    "tooling/docker/compose.yml",
    "tooling/docker/station_dockerfile_test.py",
    "tooling/docker/warm-builder-cache.sh",
    "tooling/devctl",
    "tooling/acceptance/runtime/node-connectivity-cluster.compose.yml",
    "tooling/acceptance/runtime/station-access-dual-relay.compose.yml"
  ],
  "readSet": [
    "docs/architecture/engineering/release-distribution/design.md",
    "docs/architecture/engineering/release-distribution/integration.md"
  ],
  "budgets": {"focusedCheckSeconds": 1800, "functionalRunSeconds": 1, "cleanupSeconds": 60},
  "checks": [
    {"id": "rd-t01-dockerfile-tests", "command": "python3 -m pytest tooling/docker/station_dockerfile_test.py", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t01-shellcheck", "command": "shellcheck -S warning tooling/docker/warm-builder-cache.sh", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t01-compose-config", "command": "PEERS_AUTH_SECRET=dummy PEERS_DB_PASSWORD=dummy POSTGRES_USER=peers POSTGRES_DB=peers_touch STATION_PORT=18080 RELAY_STATION_PORT=18081 docker compose -f tooling/docker/compose.yml --profile station --profile infra config -q", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t01-defaults-official", "command": "grep -RInE 'tuna|aliyun|goproxy.cn' tooling/docker/station.Dockerfile tooling/docker/builder-base.Dockerfile && exit 1 || exit 0", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": [
    "station.Dockerfile declares APT_MIRROR/GO_TARBALL_MIRROR/GOPROXY/GOSUMDB ARGs defaulting to official sources in BOTH builder and runtime stages (ARG re-declared after FROM).",
    "builder-base.Dockerfile consumes the same ARG contract.",
    "compose.yml build.args forwards mirror variables with embedded official defaults via ${VAR:-default} substitution so an UNSET variable never passes an empty string that overrides the Dockerfile ARG defaults; CN values arrive only from .env.<env> (synthesized in RD-T02) or profile env (devctl).",
    "devctl runCompose forwards profile mirror overrides; acceptance runtime composes keep BUILDER_IMAGE internal-registry support with explicit internal mirror downgrade.",
    "GOSUMDB defaults to the official checksum database; disabled only via explicit override, never silently.",
    "station_dockerfile_test.py asserts default-official and override-accepted behavior for both stages; no hardcoded tuna/aliyun/goproxy.cn remains as a default in either Dockerfile."
  ],
  "failureBehavior": [
    "Do not flip defaults while the deploy-station env path still hard-depends on CN sources — that path is landed by RD-T02, and RD-T03 (first official-source CI build) depends on both Tasks.",
    "A failed config/test on any consumer path blocks done even when other paths pass.",
    "Evidence boundary for quality gate 6: this Task provides source-level checks for all four consumers; the official-default build is proven for real by the rc1 Journey in RD-T03, while CN-override builds on builder-base/acceptance composes/devctl and the four test-bench hosts stay UNPROVEN until an authorized workflow_dispatch deploy in RD-T02 scope — that residual is explicitly accepted, not silently claimed."
  ],
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

## Scope Notes

- 对应 RD-D13、design.md §5.2、integration.md §3。
- 不修改 entrypoint.sh、deploy-station.yml 与业务代码。
- deploy-station env 合成段的镜像源参数在 RD-T02（同批次切换，DAG 保证 T03 在两者之后）。

## Current Snapshot

- Precondition: none.
- Produces: parameterized Dockerfiles/compose/devctl/acceptance paths; no release behavior change.
- Verification is source-only; official-default image builds first run for real in RD-T03 rc1.
