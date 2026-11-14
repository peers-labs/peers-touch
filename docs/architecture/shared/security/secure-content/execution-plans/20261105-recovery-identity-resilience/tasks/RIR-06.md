# RIR-06：双端设备交付管理

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RIR-20261105",
  "taskId": "RIR-06",
  "workstreamId": "DEVICES",
  "title": "device_manage_list/revoke_other 双端命令、Settings 设备页与旧 device_list 入口收敛",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "rir-devices",
  "journeyId": "RG-3",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/desktop",
    "apps/mobile",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "docs/architecture/shared/security/secure-content/recovery-identity-resilience-amendment.md"
  ],
  "budgets": {"focusedCheckSeconds": 900, "functionalRunSeconds": 3600, "cleanupSeconds": 300},
  "checks": [
    {"id": "rir06-desktop-tsc", "command": "pnpm --dir apps/desktop run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir06-desktop-cargo", "command": "cargo check --offline --manifest-path apps/desktop/src-tauri/Cargo.toml -q", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir06-mobile-tsc", "command": "pnpm --dir apps/mobile run check:web", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir06-mobile-cargo", "command": "cargo check --offline --manifest-path apps/mobile/src-tauri/Cargo.toml -q", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir06-functional", "command": "pnpm --dir apps/mobile exec vitest run src/services/deviceManagement.test.ts", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "rg3-zombie-non-blocking", "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 tooling/scripts/acceptance-run.py --plan docs/architecture/shared/security/secure-content/execution-plans/20261105-recovery-identity-resilience/plan.md --gate rg3-zombie-non-blocking", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": [
    "Desktop 新增 device_manage_revoke_other/list（生成 Actor proto 载荷，不触发本地 teardown），自撤销 device_revoke 语义保留为不同命令；旧 device_list Tauri 命令与 TS deviceService 在同一提交改型或退役，无双管理面",
    "Mobile 新增 /device/list 与 /device/revoke 传输、命令与 Settings 设备页；profile version 取列表 max，冲突刷新后显式重试",
    "撤销僵尸后下一次 prepare 立即成功，旧资源保持 recovery 可达；新增 src/services/deviceManagement.test.ts 覆盖 list/revoke 客户端编排（不依赖与本能力无关的既有红测 registry.test.ts）；gates.yaml 新增 rg3-zombie-non-blocking（native-mobile 双设备 cell，含 typed OWN_DEVICE 阻断前置），RG-3 通过"
  ],
  "failureBehavior": [
    "跨设备撤销不得作用于本地 Secure Content 生命周期",
    "不得提供发送方驱动的远程撤销；非当前设备不得走自撤销路径"
  ],
  "updatedAt": "2026-11-05T00:00:00.000Z"
}
```
