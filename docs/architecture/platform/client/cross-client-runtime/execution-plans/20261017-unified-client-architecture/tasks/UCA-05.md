# UCA-05：Portable Secure Content Core Hard Cut

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UCA-20261017",
  "taskId": "UCA-05",
  "workstreamId": "SECURE-CONTENT-CORE",
  "title": "把 Desktop 与 Mobile Secure Content 平行机制收敛到现有 portable core",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "uca-secure-content-core",
  "journeyId": "CCR-J05-secure-content-core-hard-cut",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/desktop/src-tauri/src/secure_content",
    "apps/desktop/src-tauri/src/social",
    "apps/desktop/src-tauri/src/interface/http_gateway",
    "apps/desktop/src-tauri/src/interface/tauri_commands",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src/runtimes",
    "apps/desktop/src/services",
    "apps/mobile/src-tauri/src/secure_content",
    "apps/mobile/src-tauri/src/social",
    "apps/mobile/src-tauri/src/commands",
    "apps/mobile/src-tauri/src/lib.rs",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/services",
    "packages/secure-content-core",
    "docs/architecture/platform/client/cross-client-runtime/design.md",
    "docs/architecture/platform/client/cross-client-runtime/decisions.md",
    "docs/architecture/platform/client/cross-client-runtime/data-model.md",
    "docs/architecture/platform/client/cross-client-runtime/module-layout.md",
    "docs/architecture/platform/client/cross-client-runtime/integration.md",
    "docs/architecture/shared/security/secure-content/README.md",
    "docs/architecture/shared/security/secure-content/design.md",
    "docs/architecture/shared/security/secure-content/decisions.md",
    "docs/architecture/shared/security/secure-content/data-model.md",
    "docs/architecture/shared/security/secure-content/module-layout.md",
    "docs/architecture/shared/security/secure-content/integration.md",
    "docs/architecture/shared/security/secure-content/operations.md",
    "docs/architecture/shared/security/secure-content/security.md",
    "tooling/acceptance/gates/mobile/unified_secure_content_suite.py",
    "tooling/acceptance/gates/mobile/unified_secure_content_suite_test.py",
    "tooling/acceptance/gates/unified_client/secure_content_owner_zero.py",
    "tooling/acceptance/features/unified-client-secure-content-core.yaml",
    "tooling/acceptance/features/unified-client-secure-content-runtime.yaml",
    "tooling/acceptance/capabilities/mobile.yaml"
  ],
  "readSet": [
    "apps/station/app/subserver/key_exchange",
    "apps/station/app/subserver/social",
    "docs/knowledge",
    "model",
    "packages/messaging-core"
  ],
  "budgets": {
    "focusedCheckSeconds": 3600,
    "functionalRunSeconds": 5400,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "uca05-secure-content-source",
      "command": "cargo test --manifest-path packages/secure-content-core/Cargo.toml --offline && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml secure_content --offline && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml secure_content --offline",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "uca05-social-functional",
      "command": "python3 -m unittest tooling.acceptance.gates.mobile.unified_secure_content_suite_test tooling.acceptance.gates.mobile.secure_content_portable_core_test",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "uca05-social-formal",
      "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 tooling/scripts/acceptance-run.py --gate secure-content-owner-hard-cut-zero",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "secure-content-core 按 SC-D30 独占 crypto、PreKey publication planning、device-local operation state、readback-first reconciliation、recovery continuation 和 object transfer checkpoint 机制",
    "Desktop 与 Mobile 只保留 secure storage、native secret input、media file、transport、local database 和 lifecycle adapter",
    "Social 继续拥有 audience、authorization、outer prepare/submit transaction、resource/object grant、revocation truth、routes、audit、GC 和产品 projection",
    "endpoint 与 actor-recovery pool、canonical command ID、protobuf content negotiation、Prepared 与 UNKNOWN_OUTCOME 语义只有一个实现",
    "旧 Desktop/Mobile secure-content worker/state/reconciliation 平行 owner、重复 encoder 和兼容 facade 当前源码引用归零",
    "Desktop 与 Mobile adapter 对同一 private content operation、恢复和 object transfer 合同通过当前源码聚焦 smoke，且 Station 从不接触 plaintext",
    "tree-wide owner inventory 和 secure-content-owner-hard-cut-zero 证明旧 operation symbols 与调用者引用归零"
  ],
  "failureBehavior": [
    "不把 Social audience 或 Station authorization 下沉到 secure-content-core",
    "不持久化派生 recovery private key，不把 runtime active 等同于 write admission open",
    "不允许 Mobile 或 Desktop adapter 单独实现 command ID、PreKey wire、retry order 或 content negotiation",
    "模拟器冒烟不扩大为物理设备、推送 provider 或完整私密内容产品 Journey 证明"
  ],
  "updatedAt": "2026-10-19T16:52:14.000Z"
}
```

## 完整闭环

迁移按 envelope/PreKey、store policy、submission/reconciliation、recovery/media
四个语义批次进行；每批先扩展现有 `secure-content-core`，再切换两端消费者并删除
旧实现。最终以两端 adapter 聚焦检查和三端启动冒烟确认 portable core 可组合；
真实 private publish、receiver read、revocation 与物理设备发布证明留作后续。
