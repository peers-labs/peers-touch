# RD-T04 — 安装、备份、升级和恢复闭环

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RD-20261021",
  "taskId": "RD-T04",
  "workstreamId": "RD",
  "title": "Install real candidate bytes, enforce backup and schema-safe rollback, then verify anonymous public install",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "rd-station-installer",
  "journeyId": "RD-J04",
  "runtimeClass": "service",
  "writeSet": ["tooling/distribution", ".github/workflows/release.yml"],
  "readSet": ["tooling/docker/entrypoint.sh", "tooling/docker/compose.yml", "docs/architecture/engineering/release-distribution/data-model.md"],
  "budgets": {"focusedCheckSeconds": 1200, "functionalRunSeconds": 3600, "cleanupSeconds": 300},
  "checks": [
    {"id": "rd-installer-shell", "command": "shellcheck -S warning tooling/distribution/install.sh", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-installer-unit", "command": "bash tooling/distribution/install.test.sh", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-installer-candidate-suite", "command": "node tooling/distribution/release-evidence-check.mjs --repo peers-labs/peers-touch --run-id \"${PT_RD_RUN_ID:?}\" --attempt \"${PT_RD_RUN_ATTEMPT:?}\" --tag \"${PT_RD_TAG:?}\" --source \"$(git rev-parse HEAD)\" --task RD-T04 --phase candidate --from-tag \"${PT_RD_FROM_TAG:?}\"", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "rd-installer-public-suite", "command": "node tooling/distribution/release-evidence-check.mjs --repo peers-labs/peers-touch --run-id \"${PT_RD_RUN_ID:?}\" --attempt \"${PT_RD_RUN_ATTEMPT:?}\" --tag \"${PT_RD_TAG:?}\" --source \"$(git rev-parse HEAD)\" --task RD-T04 --phase public", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "rd-installer-candidate-suite",
    "scenarioIds": ["rd-install", "rd-install-idempotent", "rd-checksum-reject", "rd-backup", "rd-upgrade", "rd-rollback-compatible", "rd-rollback-reject", "rd-backup-restore", "rd-uninstall"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.8,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Install assets are generated from one tag and image digest; explicit-version raw installer selects the same complete asset set, checks SHA256 and propagates fetch/parse failures.",
    "Authenticated Suite downloader fetches actual draft assets and serves unchanged bytes via private HTTPS; installer receives no GitHub token. This candidate check makes no anonymous GitHub access claim.",
    "Suite establishes one Docker target/project and actual storage; scenarios attach. Upgrade/rollback/restore/uninstall are product actions by Suite owner, not scenario-owned provisioning.",
    "Preflight respects this instance's occupied ports; health probes use configured port and build identity. Repeated install preserves keys and state.",
    "Before upgrade, writes stop and complete database/peers_data/config/digest snapshot is verified; failed backup blocks upgrade.",
    "In-place rollback requires version-pair/schema/digest compatibility proof; absent/mismatched proof refuses. Explicit backup restore retains failed scene, restores complete snapshot into new volumes and reads back identity, attachments and business data before switching.",
    "Known-incompatible schema and corrupt backup cases refuse safely; compatible rollback and full restore both read seeded product data, not only healthz.",
    "Workflow order is candidate verification -> finalize make_latest=false -> public anonymous verification. Public verification provisions a separate clean Suite without any product download credentials and verifies real tag URLs and GHCR pull.",
    "Default uninstall keeps registered data/backups; explicit purge targets only this instance and requires confirmation. Candidate and public Suite reports each bind exact source/digests and terminal cleanup.",
    "Versions A and B are explicit published-or-candidate inputs with complete increasing SemVer and real assets; no assumed rc numbering or nonexistent baseline assets."
  ],
  "failureBehavior": [
    "Candidate failure keeps draft; public failure keeps the release non-latest and blocks stable promotion.",
    "Backup, schema compatibility or restore failure preserves original volumes; human confirmation alone cannot grant in-place downgrade.",
    "No public tag, production restore or GitHub settings change is authorized by current documentation work."
  ],
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

## Current Snapshot

- Candidate and public trust boundaries have separate Suite reports and entry checks.
- A public Suite uses the same attach-only install/idempotency/readback lifecycle in a new namespace.
- Snapshot restore explicitly acknowledges writes after the snapshot are outside the recovery point.
