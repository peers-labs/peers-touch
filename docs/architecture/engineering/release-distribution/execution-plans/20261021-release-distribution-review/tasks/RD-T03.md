# RD-T03 — 候选资产和精确证据读回

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RD-20261021",
  "taskId": "RD-T03",
  "workstreamId": "RD",
  "title": "Build source-bound Station candidate assets and exact run evidence checks",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "rd-station-ghcr-release",
  "journeyId": "RD-J03",
  "runtimeClass": "service",
  "writeSet": [".github/workflows/release.yml", "tooling/distribution"],
  "readSet": ["tooling/docker/station.Dockerfile", "tooling/acceptance/core/suite_runtime.py", "docs/architecture/engineering/release-distribution/design.md"],
  "budgets": {"focusedCheckSeconds": 1200, "functionalRunSeconds": 3600, "cleanupSeconds": 120},
  "checks": [
    {"id": "rd-version-unit", "command": "node --test tooling/distribution/release-version-check.test.mjs", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-evidence-unit", "command": "node --test tooling/distribution/release-evidence-check.test.mjs", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-candidate-suite", "command": "node tooling/distribution/release-evidence-check.mjs --repo peers-labs/peers-touch --run-id \"${PT_RD_RUN_ID:?}\" --attempt \"${PT_RD_RUN_ATTEMPT:?}\" --tag \"${PT_RD_TAG:?}\" --source \"$(git rev-parse HEAD)\" --task RD-T03 --phase candidate", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "rd-candidate-suite",
    "scenarioIds": ["rd-station-start", "rd-station-build-identity"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.5,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Version check compares full tag SemVer to all three versions including prerelease; mismatch blocks candidate creation and actual version preparation remains separately authorized.",
    "One owner creates draft Release; Station build uses canonical multiarch image definition and publishes immutable candidate digests with exact OCI labels.",
    "Suite prepares Docker/network once and runs start plus build identity/readback scenarios on real candidate images; no mock business API, per-scenario rebuild or deployment.",
    "release-evidence-check parses complete gh run view JSON and source-bound Suite reports; checks explicit run/attempt/tag/HEAD, required steps/scenarios, artifact digests and cleanup.",
    "Unit negatives cover raw success string, failed/missing/pending run, wrong attempt/tag/HEAD, missing scenario/steps and tampered artifact/report; no bare workflow success becomes FUNCTIONAL_PASS.",
    "Secret-value scan runs on candidate content with reviewed literal exceptions; missing files and scanner errors fail, and later upload bytes/digests match those verified."
  ],
  "failureBehavior": [
    "No public download or stable update claim is made by this draft-stage task.",
    "Failed candidate checks preserve draft and diagnostics; immutable digest/tag mismatch refuses overwrite.",
    "Missing run or authorization parks verification, never publishes or moves a tag to satisfy a check."
  ],
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

## Current Snapshot

- Scripts and Suite entrypoint are planned implementation artifacts, not existing proof.
- Future checks require one exact authorized candidate run and immutable Suite report.
- Phase-specific workflow steps remain valid when installer/desktop jobs are added by successors.
