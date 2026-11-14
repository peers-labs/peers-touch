# DLA-07：原生 E2E 证据收口与治理登记

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DLA-20261112",
  "taskId": "DLA-07",
  "workstreamId": "PROOF",
  "title": "跨设备审批原生 Journey、失败语义格、chat 门禁移除证明与模块转 active",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dla-proof",
  "journeyId": "DLA-J07",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "tooling/acceptance",
    "docs/architecture/domains/identity/device-login-approval",
    "docs/architecture/domains/identity/mobile-scan-login",
    "docs/architecture/engineering/architecture-governance",
    "docs/README.md"
  ],
  "readSet": ["apps", "model", "packages", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 5400, "cleanupSeconds": 180},
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "dla07-cross-device",
    "scenarioIds": ["phone-request-desktop-approve", "desktop-request-phone-approve", "deny-cancel-expire", "approver-revoked", "chat-no-recovery-gate"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 6,
    "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "checks": [
    {"id": "dla07-structure", "command": "node tooling/scripts/architecture/module-governance.mjs validate", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "dla07-cross-device", "command": "python3 -m tooling.acceptance.gates.device_login_approval.cross_device_native_e2e", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "dla07-proof-cross-device", "command": "python3 tooling/scripts/acceptance-run.py --gate dla-approval-cross-device-native-e2e", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "dla07-proof-failure", "command": "python3 tooling/scripts/acceptance-run.py --gate dla-approval-failure-semantics-native-e2e", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "dla07-proof-recovery", "command": "python3 tooling/scripts/acceptance-run.py --gate dla-chat-recovery-gate-removed-e2e", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": [
    "手机申请桌面批准与桌面申请手机批准两条原生 Journey 证明会话并存、device_id 不同且引擎 active",
    "deny/cancel/expired/approver-revoked 失败语义格逐项证明，claimant 卡片原因类型化",
    "审批登录后 chat 无 MessagingRecoveryGate 的原生 Journey 通过",
    "模块文档转 active、registry 登记通过治理校验，mobile-scan-login design.md 过时索引表述更正"
  ],
  "failureBehavior": [
    "未运行格保持 UNPROVEN，源码测试不得升级为原生产品证明",
    "Gate 注册走 pt-acceptance-engineering 既有合同，不发明运行时 override",
    "不提交、推送、PR 或发布；owned 资源按 Suite scope 清理"
  ],
  "updatedAt": "2026-11-12T01:00:00.000Z"
}
```
