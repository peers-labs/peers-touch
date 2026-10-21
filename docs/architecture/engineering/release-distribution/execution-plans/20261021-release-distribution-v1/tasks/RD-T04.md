# RD-T04 — User Distribution Surface And One-Command Install

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RD-20261021",
  "taskId": "RD-T04",
  "workstreamId": "RD",
  "title": "Add tooling/distribution, release asset/checksum upload, and verify-install clean-host Journey (rc2/rc3)",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "rd-station-installer",
  "journeyId": "RD-J04",
  "runtimeClass": "service",
  "writeSet": [
    "tooling/distribution",
    ".github/workflows/release.yml"
  ],
  "readSet": [
    "tooling/docker/entrypoint.sh",
    "tooling/docker/compose.yml",
    "docs/architecture/engineering/release-distribution/design.md"
  ],
  "budgets": {"focusedCheckSeconds": 1200, "functionalRunSeconds": 3600, "cleanupSeconds": 300},
  "checks": [
    {"id": "rd-t04-shellcheck", "command": "shellcheck -S warning tooling/distribution/install.sh", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t04-unit-tests", "command": "bash tooling/distribution/install.test.sh", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t04-compose-config", "command": "docker compose -f tooling/distribution/docker-compose.yml config -q", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t04-verify-install-rc2", "command": "gh run list -w release.yml -c $(git rev-parse v0.1.0-rc2^{commit}) --json conclusion --jq '.[0].conclusion' | jq -e '. == \"success\"'", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "rd-t04-verify-install-rc3", "command": "gh run list -w release.yml -c $(git rev-parse v0.1.0-rc3^{commit}) --json conclusion --jq '.[0].conclusion' | jq -e '. == \"success\"'", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "tooling/distribution contains install.sh, install.test.sh, docker-compose.yml (image-only, pinned tag, postgres+station, named volumes, 18080/4001), .env.example, README.md.",
    "install.sh implements install/upgrade/rollback/uninstall(--purge); fixed project name peers-touch-station; state ~/.peers-touch/station/state.json recording current/previous tag, compose checksum, pg major version.",
    "Secrets are generated locally (openssl, fallback /dev/urandom), .env 0600, never echoed; existing .env is never overwritten.",
    "Preflight fails closed: docker/compose v2/daemon/arch(amd64,arm64)/ports 18080,4001; federation advanced vars require a complete set or refuse to start.",
    "Installed compose is downloaded from the same fixed tag and verified against Release checksums.txt generated from the actually uploaded assets; mismatch aborts.",
    "Upgrade is fail-forward: failed healthz keeps new containers and prints rollback --to <prev>; rollback is explicit; pg major change with an existing volume is refused.",
    "release.yml station-image uploads compose/install.sh and generates checksums.txt; a new verify-install job (clean ubuntu runner, Docker-in-Docker) gates finalize; finalize needs becomes [station-image, verify-install] in the same change.",
    "verify-install runs the full Journey across rc2 (clean install, idempotency, checksum-tamper negative) and rc3 (upgrade rc2->rc3, state advance, rollback to rc2, uninstall keeps volumes, --purge removes them)."
  ],
  "failureBehavior": [
    "Preflight failure aborts before any .env/volume write; no half-initialized state.",
    "Tampered compose (checksum mismatch) aborts; the negative case is part of the Journey.",
    "Only fixed-tag raw URLs are documented; branch/HEAD URLs never appear.",
    "rc tags are pushed by the operator, not the agent (plan push=denied); UNPROVEN until the rc2/rc3 runs exist."
  ],
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

## Scope Notes

- 对应 RD-D02/D03/D04/D11/D14；design.md §5.3/§5.4/§6；质量门 1/7。
- release.yml 的资产/checksum/verify-install 修改是本纵向闭环组成部分（finalize needs 同点切换）。
- 用户发行物首次出现在 rc2；rc1 无分发面，安装 Journey 不从 rc1 开始。

## Current Snapshot

- Precondition: RD-T03 merged; rc1 image pullable from public GHCR.
- Produces: tooling/distribution, release asset steps, verify-install job.
- Two tags required: rc2 install baseline, rc3 upgrade/rollback target; both pushed by operator.
