# CCU-01 契约基础

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCU-20260922",
  "taskId": "CCU-01-contract",
  "workstreamId": "CCU-W01",
  "title": "Canonical Chat Proto 契约统一与 legacy Proto 删除",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccu-contract",
  "journeyId": "CCU-J01..CCU-J08",
  "runtimeClass": "source-only",
  "writeSet": [
    "model/domain/chat",
    "apps/desktop/src/gen/proto",
    "apps/mobile/src/gen/proto",
    "apps/station/frame/touch/model/chat",
    "apps/desktop/src-tauri/src/model",
    "packages/messaging-core"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "ccu-01-proto-build",
      "command": "./model/build.sh && ./tooling/scripts/proto-gen-mobile.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccu-01-zero-legacy-import",
      "command": "! grep -rn 'friend_chat_pb\\|group_chat_pb' apps/desktop/src apps/mobile/src apps/station/app apps/desktop/src-tauri/src --include='*.ts' --include='*.tsx' --include='*.go' --include='*.rs' | grep -v '/gen/'",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "ccu-01-contract-functional",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.messaging_platform_contract_test",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccu-01-contract-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate messaging-platform-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "friend_chat.proto 和 group_chat.proto 中仍有效的业务字段已迁入 canonical Chat Proto",
    "两个 legacy Proto 源文件已删除",
    "所有平台的生成产物已通过标准生成链重建（无手工修改生成文件）",
    "Desktop TS、Mobile TS、Station Go、Desktop Rust 中 friend_chat_pb / group_chat_pb import 归零",
    "从 canonical Proto 构造的 shared contract fixture 已创建并通过验证",
    "CHAT-G15（client contract conformance）Proto 层面通过"
  ],
  "failureBehavior": [
    "任何 Proto 生成失败或 legacy import 残留都保持本任务未完成",
    "不得手工修改生成文件来绕过 canonical Proto 生成链"
  ],
  "updatedAt": "2026-09-22T13:50:00Z",
  "durableEvidence": []
}
```

## 范围

将 `friend_chat.proto` 和 `group_chat.proto` 中仍被正式产品使用的字段迁入
`conversation_api.proto`、`command.proto`、`event.proto` 或其他 canonical
companion Proto。迁移完成后删除两个 legacy Proto 输入及所有平台生成物，并通过
`./model/build.sh` 和 `./tooling/scripts/proto-gen-mobile.sh` 重建。

本任务是整个 CCU DAG 的根依赖。完成后 W02（Desktop Runtime）和 W04（Mobile
Legacy Adapter）可并行启动。

## 验收判据

- CHAT-G15 Proto 层 PASS
- 两端 build 成功
- 零 legacy Proto import（非生成代码中）

## Current Snapshot

- State: in_progress; prior completion claim withdrawn pending durable source evidence.
- friend_chat.proto and group_chat.proto deleted; all platform generated
  artifacts rebuilt via standard build scripts.
- Proto build (`./model/build.sh`, `./tooling/scripts/proto-gen-mobile.sh`) passes.
- Zero-reference check passes: no non-generated `friend_chat_pb` / `group_chat_pb` imports.
- Station Go compiles and tests pass with `ActorReadCursor` replacements.
- Successor tasks CCU-02 and CCU-04 are unblocked.
