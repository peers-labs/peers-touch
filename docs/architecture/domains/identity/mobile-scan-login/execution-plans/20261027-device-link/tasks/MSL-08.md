# MSL-08：当前源码原生闭环

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MSL-20261027",
  "taskId": "MSL-08",
  "workstreamId": "PROOF",
  "title": "多手机、Direct Circuit 与当前源码证据收口",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "msl-proof",
  "journeyId": "MSL-A01-MSL-A09",
  "runtimeClass": "native-desktop",
  "writeSet": ["tooling/acceptance", "docs/architecture/domains/identity/mobile-scan-login", "docs/architecture/shared/schema", "docs/architecture/engineering/architecture-governance"],
  "readSet": ["apps", "model", "packages", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 5400, "cleanupSeconds": 120},
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "msl08-native",
    "scenarioIds": ["same-station-chat", "cross-class-coexistence", "desktop-device-coexistence", "mobile-device-coexistence"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 5,
    "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "checks": [
    {"id": "msl08-structure", "command": "node tooling/scripts/architecture/module-governance.mjs validate", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "msl08-native", "command": "python3 -m tooling.acceptance.gates.station_access.session_class_suite_e2e", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "msl08-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-session-class-suite-e2e", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["五个预置 native 客户端的设备共存收消息通过", "Android iOS 真机扫描 Desktop 屏幕码、Direct Circuit、撤销重启 ack 丢失格逐项证实或明确 UNPROVEN", "结构安全 UX 审查与 owned cleanup 完成，效果报告绑定 current-source evidence"],
  "failureBehavior": ["未运行格不能标 PASS", "不提交推送 PR 或发布，不把模拟器解码当真机相机"],
  "updatedAt": "2026-10-27T01:00:00.000Z"
}
```
