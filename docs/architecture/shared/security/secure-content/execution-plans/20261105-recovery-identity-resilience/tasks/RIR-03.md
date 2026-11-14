# RIR-03：Desktop 恢复身份纵切

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RIR-20261105",
  "taskId": "RIR-03",
  "workstreamId": "DESKTOP",
  "title": "Desktop 创建/轮换/恢复身份生产命令、Settings UI、归档解耦、fixture owner 改线与随机生成器删除",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "rir-desktop",
  "journeyId": "RG-5",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "packages/locales",
    "tooling/development",
    "tooling/acceptance"
  ],
  "readSet": [
    "packages/secure-content-core",
    "docs/architecture/shared/security/secure-content/recovery-identity-resilience-amendment.md"
  ],
  "budgets": {"focusedCheckSeconds": 900, "functionalRunSeconds": 3600, "cleanupSeconds": 180},
  "checks": [
    {"id": "rir03-tsc", "command": "pnpm --dir apps/desktop run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir03-cargo", "command": "cargo check --offline --manifest-path apps/desktop/src-tauri/Cargo.toml -q", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir03-functional", "command": "pnpm --dir apps/desktop exec vitest run recoveryIdentity", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "rir03-owner-fixtures", "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 -m unittest tooling.development.secure_content.test_runtime_owner", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "rir03-static-gate", "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 -m unittest tooling.acceptance.gates.chat.native_interactions_static_test", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "rg5-desktop-convergence", "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 tooling/scripts/acceptance-run.py --plan docs/architecture/shared/security/secure-content/execution-plans/20261105-recovery-identity-resilience/plan.md --gate rg5-desktop-convergence", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": [
    "干净 profile 无聊天归档即可创建 Recovery Identity（Settings），随后 createRevision 只消费 READY 不再分配 epoch 或写 master；restoreLatest 改为 vault-first 后才水合归档",
    "createRevision/restoreLatest master 播种分支与 acceptance 随机短语生成器在同一原子提交删除；新增测试文件名包含 recoveryIdentity 以便 focused 命令稳定命中",
    "runtime_owner.py 对 generate/createRevision/restore 的引导全部改走确定性短语注入生产句柄；已注册 Gate chat-native-visible-static 的旧恢复顺序断言在同提交更新且 rir03-static-gate 保持绿灯",
    "epoch 分配与 master 写入从 tauri_commands 层迁入 secure-content-core host port 调用层，tauri 命令层不再含 next_secure_content_recovery_epoch/store_secure_content_recovery_master 符号（保持 RIR-08 结构门可达）",
    "gates.yaml 新增 rg5-desktop-convergence 定义（native-desktop cell、精确清理），RG-5 exact-source Journey 通过"
  ],
  "failureBehavior": [
    "无 READY 身份时归档创建被类型化拒绝而非隐式生成 master",
    "短语只在创建会话展示；恢复失败走本地错误，Station 无正误信号；fixture 引导不得保留平行随机路径"
  ],
  "updatedAt": "2026-11-05T00:00:00.000Z"
}
```
