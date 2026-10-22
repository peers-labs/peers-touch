# UCA-05A：Secure Content Client Operation Core

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UCA-20261017",
  "taskId": "UCA-05A",
  "workstreamId": "SECURE-CONTENT-CORE",
  "title": "按 SC-D30 补齐 host-neutral client operation mechanism 与 ports",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "uca-secure-content-core-contract",
  "journeyId": "CCR-J05A-secure-content-operation-contract",
  "runtimeClass": "source-only",
  "writeSet": [
    "packages/secure-content-core",
    "docs/architecture/shared/security/secure-content/README.md",
    "docs/architecture/shared/security/secure-content/design.md",
    "docs/architecture/shared/security/secure-content/decisions.md",
    "docs/architecture/shared/security/secure-content/data-model.md",
    "docs/architecture/shared/security/secure-content/module-layout.md",
    "docs/architecture/shared/security/secure-content/integration.md",
    "docs/architecture/shared/security/secure-content/operations.md",
    "docs/architecture/shared/security/secure-content/security.md",
    "tooling/acceptance/gates/mobile/secure_content_portable_core.py",
    "tooling/acceptance/gates/mobile/secure_content_portable_core_test.py",
    "tooling/acceptance/gates/unified_client/unproven.py",
    "tooling/acceptance/features/social-private-moments-desktop.yaml",
    "tooling/acceptance/features/unified-client-secure-content-core.yaml",
    "tooling/acceptance/capabilities/mobile.yaml",
    "tooling/acceptance/domains/mobile.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml"
  ],
  "readSet": [
    "apps/desktop/src-tauri/src/secure_content",
    "apps/mobile/src-tauri/src/secure_content",
    "apps/station/app/subserver/key_exchange",
    "apps/station/app/subserver/social",
    "docs/knowledge",
    "model",
    "packages/messaging-core"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "uca05a-core-source",
      "command": "cargo test --manifest-path packages/secure-content-core/Cargo.toml --offline",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "uca05a-core-boundary",
      "command": "python3 -m unittest tooling.acceptance.gates.mobile.secure_content_portable_core_test",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "uca05a-core-formal",
      "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 tooling/scripts/acceptance-run.py --gate secure-content-portable-core",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "secure-content-core 按 SC-D30 独占 PreKey publication planning、operation states、generation/lease transition、readback-before-retry decision、recovery continuation 和 typed outcome",
    "core 只依赖 encrypted-store、transport、clock、key-material、opaque-file 和 lifecycle-cancellation ports",
    "Social/Conversation audience、authorization、outer transaction、resource/object grant、revocation truth、routes、audit 和 GC 保持原 owner",
    "core 不导入 HTTP、SQLCipher、filesystem path、Tauri、UI、Social 或 Conversation implementation",
    "Desktop/Mobile operation inventory 的每个待迁移符号映射到 core API、Host port 或明确保留的 domain adapter",
    "device-local operation schema migration 在消费者切换前冻结，禁止双写"
  ],
  "failureBehavior": [
    "不把 private submit business transaction、grant 或 revocation authority 移入 core",
    "不新增第二 Secure Content package 或通用 Host escape hatch",
    "本项不激活第二 worker；新机制在 UCA-05 hard cut 前只由测试消费",
    "SC-D30 边界无法满足时阻塞 UCA-05，不在 Host adapter 复制 operation logic"
  ],
  "updatedAt": "2026-10-19T16:52:14.000Z"
}
```

## 完整闭环

本项只实现已接受的 SC-D30 机制和 port contract，不切换生产消费者。UCA-05 在一个
原子 Task 中迁移 Desktop/Mobile adapter、执行本地 schema migration、删除旧
worker/state owner 并运行三目标 Suite。
