# RD-T02 — 公开发布与内部部署分离

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RD-20261021",
  "taskId": "RD-T02",
  "workstreamId": "RD",
  "title": "Remove deploy-station tag trigger and preserve explicit dispatch",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "rd-tag-trigger-separation",
  "journeyId": "RD-J02",
  "runtimeClass": "source-only",
  "writeSet": [".github/workflows/deploy-station.yml"],
  "readSet": [".github/workflows/release.yml", "docs/architecture/engineering/release-distribution/design.md"],
  "budgets": {"focusedCheckSeconds": 600, "functionalRunSeconds": 1, "cleanupSeconds": 60},
  "checks": [
    {"id": "rd-trigger-shape", "command": "python3 -c \"import yaml; d=yaml.safe_load(open('.github/workflows/deploy-station.yml')); triggers=d.get('on',d.get(True)); assert set(triggers)=={'pull_request','workflow_dispatch'}; assert d['permissions']=={'contents':'read'}\"", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-publish-no-ssh", "command": "python3 -c \"from pathlib import Path; s=Path('.github/workflows/release.yml').read_text(); assert 'DEPLOY_SSH_KEY' not in s and 'ssh-agent' not in s\"", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": [
    "Only pull_request and workflow_dispatch triggers remain; existing target choices, PR image checks and T01 mirror injection remain intact.",
    "deploy-station retains contents:read, release workflow has no deployment credentials, and tag publication cannot roll test benches.",
    "Dispatch runtime validation is collected only on a later explicitly authorized target; until then its operational claim stays UNPROVEN."
  ],
  "failureBehavior": [
    "Never preserve tag deployment as a fallback.",
    "A source parser failure is not a successful trigger check; runtime availability never grants dispatch authorization."
  ],
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

## Current Snapshot

- Source-only closure after T01 consumer wiring.
- No dispatch or test-bench operation is authorized by this document revision.
