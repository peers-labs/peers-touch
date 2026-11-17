# RES-05：ID 共享与覆盖的当前源码证明

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "LDCP-RES-20261114",
  "taskId": "RES-05",
  "workstreamId": "RESOURCE-PROOF",
  "title": "登记共享/覆盖原生 Gate 并证明全部 consumer cut",
  "workClass": "infrastructure",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "resource-proof",
  "journeyId": "LDCP-R01-R10-current-source-proof",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/domains",
    "tooling/acceptance/features",
    "tooling/acceptance/gates/mobile/resource_dependencies_e2e.py",
    "tooling/acceptance/gates/mobile/resource_dependencies_e2e_test.py",
    "docs/architecture/engineering/local-dev",
    "docs/architecture/engineering/architecture-governance/architecture-modules.json",
    "docs/knowledge/invariants/profile-resources-use-machine-owner.md"
  ],
  "readSet": ["tooling/scripts/local-dev", "tooling/acceptance", "tooling/scripts/acceptance-run.py", "apps/mobile/scripts/ios-dev-sim.sh", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 600, "functionalRunSeconds": 3600, "cleanupSeconds": 180},
  "checks": [
    {"id": "res05-structure", "command": "python3 tooling/scripts/acceptance-validate.py && node tooling/scripts/architecture/module-governance.mjs validate", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "res05-owner", "command": "python3 tooling/scripts/acceptance-run.py --gate machine-dev-registry-self", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "res05-sharing", "command": "python3 tooling/scripts/acceptance-run.py --gate profile-resource-id-sharing-native-e2e", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "res05-overwrite", "command": "python3 tooling/scripts/acceptance-run.py --gate profile-resource-overwrite-native-e2e", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": [
    "目标 native Gate 按原 Domain/Feature/Environment 注册，唯一 Acceptance Execution 映射 LDCP-R01 至 R10",
    "canonical ID/provider readback 证明 user assignments、same-ID sharing、equal-count distinct IDs 和物理排他",
    "数量/用途/名称通过真实 inventory 解析，主视图不要求 raw UUID；同名、改名、过期列表不改变选定身份",
    "native overwrite proof 观察 notice/refusal/具体 force、共享方新 source、reference/content race、无锁绕过",
    "provider/data readback 证明 retained/unknown、connect-only、creation recovery、detach/release/delete 分离",
    "原 iOS fallback 完整移除，docs/Skills/knowledge 与实现一致，缺 user decision/未执行项保持未证实",
    "五维结果只按 current-source evidence 回填，source 改变重跑受影响证明，收尾只限本次 owned 资源"
  ],
  "failureBehavior": [
    "缺 actual native/source artifacts、fixture ID 或具体 force 时 UNPROVEN/BLOCKED",
    "真实 user decision 不由 fake input/mock PASS/blanket force 替代",
    "不为 proof 接管/覆盖四、停止其他进程、部署 Station 或改共享 env"
  ],
  "updatedAt": "2026-11-15T00:00:00.000Z"
}
```

聚合 Task 不自己持有 product runtime，原 Environment/Provisioner 执行实际
启动/收尾。完成前按明确 scope 使用 Gap Detector/Completion Auditor。
