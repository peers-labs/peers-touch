# AFL-07B · 私密权威切割：密文子链替换在役 secure-content 写路径

> **STATUS: DEFERRED to v2（r4，2026-11-07，AD-08）**——v1 不切割在役 E2EE 管线，
> `social_private_posts` 与跨站私密投递零改动（native private gates 必须保持全绿）。
> 本任务移出 v1 tasks/closures/criteria，切割方案保留备查。

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-07B",
  "workstreamId": "PRIVATE-CUT",
  "title": "私密发帖/撤回改走密文链；revocation 级联复用；native private gates 回归",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "afl-j07b-private-cut",
  "closureId": "afl-07b-private-clean-cut",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/station/app/subserver/social/application",
    "apps/station/app/subserver/social/infrastructure",
    "apps/desktop/src",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/station/app/subserver/social/infrastructure/private_content_store.go",
    "apps/station/app/subserver/social/infrastructure/private_content_revocation.go",
    "apps/station/app/subserver/social/application/private_content_recovery.go",
    "tooling/acceptance/features/social-private-moments-desktop.yaml"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl07b-go",
      "command": "cd apps/station/app && go test ./subserver/social/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl07b-grep",
      "command": "bash -lc '! rg -n \"plaintext|明文\" apps/station/app/subserver/social/infrastructure --glob \"*feed*\"'",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "afl07b-journey",
      "command": "python3 tooling/scripts/acceptance-run.py --scope social-private-moments-desktop",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "私密 prepare/submit 写路径改为密文子链事件+投影；tombstone/撤回级联销毁复用 private_content_revocation.go（跨站 invalidation/grants/delivery-intent 已验证存在）",
    "Station 存储 grep 无私密明文落盘；既有 native private social Journey（desktop + cross-platform）回归通过",
    "旧私密直写与本切割原子替换，回滚=revert"
  ],
  "failureBehavior": [
    "不改 E2EE 算法/密钥体系",
    "私密跨站传输仍走 federated_private_resource peer stream"
  ],
  "updatedAt": "2026-11-06T13:30:00.000Z"
}
```

## 完整闭环

私密权威独立切割（AD-07b），依赖真实子链合同与现有 native private gates 回归；复用已验证存在的 revocation 级联。
