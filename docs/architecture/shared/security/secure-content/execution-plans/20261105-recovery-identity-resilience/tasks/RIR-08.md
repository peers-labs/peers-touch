# RIR-08：clean-cut 收口、结构性 source gate 与文档合并

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RIR-20261105",
  "taskId": "RIR-08",
  "workstreamId": "CUTOVER",
  "title": "RG-8 无隐式短语生成器 source gate、播种分支死路径证明与修正案折入 canonical 文档",
  "workClass": "documentation",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "rir-cutover",
  "journeyId": "RG-8",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture",
    "tooling/scripts"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "tooling/acceptance",
    "docs/architecture/shared/security/secure-content"
  ],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 300, "cleanupSeconds": 60},
  "checks": [
    {"id": "rir08-no-implicit-generator", "command": "python3 tooling/scripts/verify_no_implicit_recovery_phrase_generator.py", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "rir08-generator-symbols-removed", "command": "bash -c '! grep -RInE \"social_private_acceptance_prepare_keys|messaging_recovery_acceptance_create_revision\" apps packages tooling --include=\"*.rs\" --include=\"*.ts\" --include=\"*.tsx\" --include=\"*.py\"'", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "rir08-seeding-branches-removed", "command": "bash -c '! grep -RInE \"next_secure_content_recovery_epoch|store_secure_content_recovery_master\" apps/desktop/src-tauri/src/interface/tauri_commands --include=\"*.rs\"'", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "rir08-doc-index", "command": "node tooling/scripts/architecture/document-index.mjs --check", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": [
    "新建 verify_no_implicit_recovery_phrase_generator.py 明确规则：非 acceptance cfg 块内禁止 Mnemonic::generate/OsRng 熵→短语路径；harness 注入端口必须显式 cfg 门且接受外部短语；检查双端全部目标",
    "两个旧生成器符号在 rs/ts/py 零命中；桌面 tauri 命令内 epoch 分配与 master 播种调用零命中（命令名本身可保留为 READY 消费者）",
    "SC-D31/D32/D33 内容折入 design/security/data-model/integration 与 Identity 域文档，amendment 仅保留指向合并位置的指针，document-index 绿灯"
  ],
  "failureBehavior": [
    "不得保留平行 bootstrap、兼容开关或归档 seed 恢复权威",
    "文档折入不得改变已接受语义；语义变更需要新修正案"
  ],
  "updatedAt": "2026-11-05T00:00:00.000Z"
}
```
