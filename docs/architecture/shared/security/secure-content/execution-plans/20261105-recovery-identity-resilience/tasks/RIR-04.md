# RIR-04：Mobile 恢复身份纵切

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RIR-20261105",
  "taskId": "RIR-04",
  "workstreamId": "MOBILE",
  "title": "Mobile 生产 create/rotate/recover、vault 传输、archive 身份路径 vault-first、secure-view 与 Settings UI",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "rir-mobile",
  "journeyId": "RG-1",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "packages/secure-content-core",
    "docs/architecture/shared/security/secure-content/recovery-identity-resilience-amendment.md"
  ],
  "budgets": {"focusedCheckSeconds": 900, "functionalRunSeconds": 3600, "cleanupSeconds": 300},
  "checks": [
    {"id": "rir04-web", "command": "pnpm --dir apps/mobile run check:web", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir04-proto", "command": "./tooling/scripts/proto-gen-mobile.sh web", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "rir04-cargo", "command": "cargo check --offline --manifest-path apps/mobile/src-tauri/Cargo.toml -q", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir04-functional", "command": "pnpm --dir apps/mobile exec vitest run src/acceptance/debug src/runtimes/privateMomentsRuntime.test.ts", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "rg1-fresh-device", "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 tooling/scripts/acceptance-run.py --plan docs/architecture/shared/security/secure-content/execution-plans/20261105-recovery-identity-resilience/plan.md --gate rg1-fresh-device", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": [
    "无种子 harness 设备 prepare 负腿返回类型化 self recovery-missing；生产 create 完成 vault+池并显式唤醒维护后才报 READY，正腿 prepare/publish 成功",
    "secure-view 原生插件（iOS/Android）在 Web 短语会话期阻止截屏/采集，短语输入仍走 SecureInput",
    "messaging_recover_identity_with_native_input 不再直接以 archive.actor_identity_seed 建身份，改为 vault 恢复→同 PTID re-enroll→归档水合；归档内嵌 seed cut 后仅 inert",
    "acceptance 随机种子器替换为确定性短语注入端口；gates.yaml 新增 rg1-fresh-device（native-mobile cell、含负/正腿与容器重置），RG-1 通过"
  ],
  "failureBehavior": [
    "Mobile Web 层不得持久化短语或写剪贴板；secure-view 缺失时 create 面不得发布",
    "无 vault/无 master 路径不得通过任何非 harness 命令隐式写恢复材料"
  ],
  "updatedAt": "2026-11-05T00:00:00.000Z"
}
```
