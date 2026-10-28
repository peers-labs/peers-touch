# RD-T02 — Separate Public Release Tag From Test-Bench Deployment

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RD-20261021",
  "taskId": "RD-T02",
  "workstreamId": "RD",
  "title": "Remove v*.*.* tag trigger from deploy-station and add mirror build args to env synthesis",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "rd-tag-trigger-separation",
  "journeyId": "RD-J02",
  "runtimeClass": "source-only",
  "writeSet": [
    ".github/workflows/deploy-station.yml"
  ],
  "readSet": [
    ".github/workflows/release.yml",
    "docs/architecture/engineering/release-distribution/design.md",
    "docs/architecture/engineering/release-distribution/decisions.md"
  ],
  "budgets": {"focusedCheckSeconds": 600, "functionalRunSeconds": 1, "cleanupSeconds": 60},
  "checks": [
    {"id": "rd-t02-yaml-lint", "command": "python3 -c \"import yaml; yaml.safe_load(open('.github/workflows/deploy-station.yml'))\"", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t02-trigger-set", "command": "python3 -c \"import yaml; w=yaml.safe_load(open('.github/workflows/deploy-station.yml'))[True]; assert set(w)=={'pull_request','workflow_dispatch'}, list(w); assert 'v*.*.*' not in str(w)\"", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t02-no-ssh-secret-leak", "command": "grep -n 'packages: write' .github/workflows/deploy-station.yml && exit 1 || exit 0", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t02-release-no-ssh", "command": "grep -nE 'DEPLOY_SSH_KEY|ssh-agent' .github/workflows/release.yml && exit 1 || exit 0", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": [
    "deploy-station.yml triggers are exactly pull_request and workflow_dispatch; push.tags v*.*.* and its 'release rolls all four' path are removed.",
    "Env synthesis (Materialise env file step) emits the RD-T01 mirror build-arg variables with CN values so remote test-bench builds keep current behavior after Dockerfile defaults flip.",
    "workflow_dispatch target choices (pt-relay/pt-station-1/pt-station-2/pt-station-relay-only/all) are unchanged; PR pr-build job is unchanged.",
    "Permissions remain contents: read with no packages:write; no new secret is introduced."
  ],
  "failureBehavior": [
    "The workflow_dispatch healthy-deploy evidence requires explicit operator authorization; until it exists the dispatch path is reported UNPROVEN, not assumed.",
    "Do not keep the tag trigger 'just in case': dual triggering is the defect being cut (RD-D09)."
  ],
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

## Scope Notes

- 对应 RD-D09、RD-D13；design.md §5.1/§6。
- 回滚 = VCS revert（clean cut，无 feature flag）。
- 含一处刻意折中：本 Task 同时承载 tag 摘除与 RD-D13 的 deploy 合成段（同一文件单切换点，RD-T01 已声明该分工）。

## Current Snapshot

- Precondition: none; may merge in parallel with RD-T01 (different files).
- Produces: deploy-station.yml dispatch-only with CN mirror args.
- Operator-authorized workflow_dispatch run is external evidence and stays UNPROVEN until observed.
