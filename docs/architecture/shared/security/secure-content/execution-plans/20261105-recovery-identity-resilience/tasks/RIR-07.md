# RIR-07：重装/轮换/归档恢复真机 Journeys

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RIR-20261105",
  "taskId": "RIR-07",
  "workstreamId": "JOURNEYS",
  "title": "harness iOS slice 上 RG-2 重装闭环、RG-4 轮换历史可达、RG-7 归档恢复重接",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "rir-journeys",
  "journeyId": "RG-2",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "tooling/acceptance",
    "apps/mobile/src/acceptance"
  ],
  "readSet": [
    "apps/mobile",
    "apps/desktop",
    "docs/architecture/shared/security/secure-content/recovery-identity-resilience-amendment.md"
  ],
  "budgets": {"focusedCheckSeconds": 900, "functionalRunSeconds": 5400, "cleanupSeconds": 600},
  "checks": [
    {"id": "rir07-gates-registered", "command": "bash -c 'for id in rg2-reinstall-survival rg4-rotation-history rg7-clean-archive-restore; do grep -q \"$id\" tooling/acceptance/gates.yaml || exit 1; done'", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "rir07-harness-build", "command": "VITE_ACCEPTANCE_HARNESS=1 pnpm --dir apps/mobile exec tauri ios build --ci --debug", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "rg2-reinstall-survival", "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 tooling/scripts/acceptance-run.py --plan docs/architecture/shared/security/secure-content/execution-plans/20261105-recovery-identity-resilience/plan.md --gate rg2-reinstall-survival", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "rg4-rotation-history", "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 tooling/scripts/acceptance-run.py --plan docs/architecture/shared/security/secure-content/execution-plans/20261105-recovery-identity-resilience/plan.md --gate rg4-rotation-history", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "rg7-clean-archive-restore", "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 tooling/scripts/acceptance-run.py --plan docs/architecture/shared/security/secure-content/execution-plans/20261105-recovery-identity-resilience/plan.md --gate rg7-clean-archive-restore", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": [
    "RG-2：A 发布私密内容后擦除容器→登录→短语→vault 解密→同 PTID re-enroll→历史信封可开、endpoint 池补发、新消息端到端可达",
    "RG-4：轮换后新短语可经包装链开轮换前内容、新内容只封 N+1、他设备 OUTDATED 态、旧 vault blob PUT 被拒",
    "RG-7：干净设备先 vault 恢复/re-enroll 再归档水合，READY 证明当前 epoch 而非归档历史 epoch；三个 Gate 均在 gates.yaml 注册且证据含精确清理"
  ],
  "failureBehavior": [
    "三个 Gate 均为 exact-source 真 iOS 运行时（双模拟器+受控 Station），禁止网页/截图替身",
    "Gate 未运行保持 UNPROVEN，不得用调试面板或人工截图替代正式证据"
  ],
  "updatedAt": "2026-11-05T00:00:00.000Z"
}
```
