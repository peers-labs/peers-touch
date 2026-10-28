# RD-T03 — GHCR Station Image And Release Pipeline Skeleton

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RD-20261021",
  "taskId": "RD-T03",
  "workstreamId": "RD",
  "title": "Restructure release.yml into release-notes/station-image/finalize with prerelease-aware version gate, secret scan, multi-arch GHCR push",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "rd-station-ghcr-release",
  "journeyId": "RD-J03",
  "runtimeClass": "service",
  "writeSet": [
    ".github/workflows/release.yml",
    "tooling/distribution/release-version-check.mjs",
    "tooling/distribution/release-version-check.test.mjs"
  ],
  "readSet": [
    "tooling/docker/station.Dockerfile",
    "docs/architecture/engineering/release-distribution/design.md"
  ],
  "budgets": {"focusedCheckSeconds": 900, "functionalRunSeconds": 3600, "cleanupSeconds": 120},
  "checks": [
    {"id": "rd-t03-workflow-yaml", "command": "python3 -c \"import yaml; yaml.safe_load(open('.github/workflows/release.yml'))\"", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t03-version-check-unit", "command": "node --test tooling/distribution/release-version-check.test.mjs", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t03-rc1-run", "command": "gh run list -w release.yml -c $(git rev-parse v0.1.0-rc1^{commit}) --json conclusion --jq '.[0].conclusion' | jq -e '. == \"success\"'", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "release.yml declares permissions contents:write + packages:write only for tag events and contains release-notes, station-image (needs release-notes), finalize (needs station-image in this Task).",
    "release-notes runs tooling/distribution/release-version-check.mjs: accepts vX.Y.Z and vX.Y.Z-<prerelease> when the X.Y.Z core equals all three version sources, rejects every mismatch; the negative cases are unit tests.",
    "release-notes creates a single draft Release and runs a secret-literal scan over tooling/distribution and staged assets (pattern: secret|password|token|api_key|private_key with allowlist), failing the job on any hit.",
    "station-image uses setup-qemu + setup-buildx, builds linux/amd64,linux/arm64 from tooling/docker/station.Dockerfile with official mirror defaults, pushes ghcr.io/peers-labs/peers-touch-station:<tag> atomically, injecting BUILD_COMMIT=$GITHUB_SHA, BUILD_LABEL=<tag>, BUILD_TIME.",
    "No distribution asset upload exists yet (files land in RD-T04); steps are guarded by file existence so rc1 succeeds without them.",
    "finalize publishes the Release only after green needs; tags containing '-' are marked prerelease=true and cannot become /releases/latest; the /releases/latest exclusion is asserted by a query in the rc1 functional evidence.",
    "rc1 operator-tagged run proves: imagetools inspect shows amd64+arm64; labels version=<tag>/revision=<sha>; arm64 starts under QEMU and /sub-oss/healthz returns 200; anonymous pull succeeds after the one-time package-public operator step."
  ],
  "failureBehavior": [
    "Partial-architecture pushes are impossible (buildx atomic); failed leg leaves no published :<tag>.",
    "Private GHCR package fails the Journey closed on anonymous pull; no documentation workaround.",
    "Failed rc runs are fixed by new commits and a new rc tag; agents never push tags (operator action per plan External Prerequisites)."
  ],
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

## Scope Notes

- 对应 RD-D01/D08/D09/D10；design.md §5.1/§5.2/§6；质量门 2/5/7。
- 本 Task 的 finalize `needs` 仅 `[station-image]`；RD-T04 改为 `[station-image, verify-install]`，RD-T05 扩为三项，每个中间 commit 的工作流 YAML 必须各自有效。
- rc1 不含 install 链，不产生任何分发资产。

## Current Snapshot

- Precondition: RD-T01 and RD-T02 merged (official mirrors usable on GitHub runners; test-bench path keeps CN args).
- Produces: restructured release.yml, version-check script + tests, public GHCR package via operator-pushed rc1.
- External ops: GHCR package public; rc tag push; tag protection.

## Evidence Mapping

- 功能性证据：rc1 真实流水线——imagetools/label/匿名拉取/QEMU healthz/版本门反向单测/prerelease latest 排除/密钥扫描。
- 不注册形式化 acceptance Gate（plan Non-Goals）。
