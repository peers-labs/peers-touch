# RD-T01 — 镜像源和全部消费方原子接线

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RD-20261021",
  "taskId": "RD-T01",
  "workstreamId": "RD",
  "title": "Parameterize both image stages and wire every build consumer atomically",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "rd-mirror-parameterization",
  "journeyId": "RD-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/docker",
    "tooling/devctl",
    ".github/workflows/deploy-station.yml",
    "tooling/acceptance/runtime/node-connectivity-cluster.compose.yml",
    "tooling/acceptance/runtime/station-access-dual-relay.compose.yml"
  ],
  "readSet": ["docs/architecture/engineering/release-distribution/design.md"],
  "budgets": {"focusedCheckSeconds": 1800, "functionalRunSeconds": 1, "cleanupSeconds": 60},
  "checks": [
    {"id": "rd-mirror-tests", "command": "python3 tooling/docker/station_dockerfile_test.py", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-mirror-shell", "command": "shellcheck -S warning tooling/docker/warm-builder-cache.sh", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-compose-shape", "command": "PEERS_AUTH_SECRET=shape-check-only PEERS_DB_PASSWORD=shape-check-only docker compose -f tooling/docker/compose.yml --profile station --profile infra config -q", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": [
    "Both Dockerfile stages declare mirror ARGs, empty APT_MIRROR retains each base image's own official sources, and GOSUMDB/GONOSUMCHECK defaults preserve checksum verification.",
    "compose, builder-base/warm-cache, devctl, acceptance composes and deploy-station env synthesis consume one parameter contract; unset variables cannot override ARG defaults with empty invalid values.",
    "All consumer wiring and default changes land in one atomic change; existing CN overrides remain supplied through reviewed configuration.",
    "Focused tests verify official defaults and explicit overrides in both stages; each required build path has separate evidence before claiming no regression."
  ],
  "failureBehavior": [
    "Missing consumer wiring blocks the cutover; do not defer deploy env to another task.",
    "Unavailable CN/internal build targets remain UNPROVEN and block a no-regression claim; one dispatch build does not prove every consumer.",
    "Parsing, missing files and build failures propagate nonzero, not grep fallback success."
  ],
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

## Current Snapshot

- Static source closure; no runtime or release proof exists.
- Expected output is a single source cutover across all consumer paths.
