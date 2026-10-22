# UCA-06：共享 TypeScript 与实体语义收敛

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UCA-20261017",
  "taskId": "UCA-06",
  "workstreamId": "SHARED-CLIENT-SEMANTICS",
  "title": "复用现有 client packages 并把 Presentation Policy 留在 Client Form",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "uca-shared-client-semantics",
  "journeyId": "CCR-J06-shared-client-semantics",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/desktop/src",
    "apps/mobile/src",
    "packages/client-chat-core",
    "packages/client-media-security",
    "packages/client-storage",
    "pnpm-workspace.yaml",
    "docs/architecture/engineering/architecture-governance/README.md",
    "docs/architecture/engineering/architecture-governance/design.md",
    "docs/architecture/engineering/architecture-governance/decisions.md",
    "docs/architecture/engineering/architecture-governance/data-model.md",
    "docs/architecture/engineering/architecture-governance/module-layout.md",
    "docs/architecture/engineering/architecture-governance/integration.md",
    "docs/architecture/engineering/architecture-governance/architecture-modules.json",
    "docs/architecture/platform/client/cross-client-runtime/design.md",
    "docs/architecture/platform/client/cross-client-runtime/decisions.md",
    "docs/architecture/platform/client/cross-client-runtime/data-model.md",
    "docs/architecture/platform/client/cross-client-runtime/module-layout.md",
    "docs/architecture/platform/client/cross-client-runtime/integration.md",
    "docs/client/common",
    "tooling/acceptance/capabilities/chat.yaml",
    "tooling/acceptance/behavior-rules/chat-receipts.yaml",
    "tooling/acceptance/domains/chat.yaml",
    "tooling/acceptance/features/chat-direct-delivered-receipt.yaml",
    "tooling/acceptance/features/chat-message-interactions.yaml",
    "tooling/acceptance/features/chat-message-publishing.yaml",
    "tooling/acceptance/features/unified-client-shared-semantics.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/gates/unified_client/shared_semantics.py",
    "tooling/acceptance/gates/unified_client/shared_semantics_test.py",
    "tooling/acceptance/gates/unified_client/unproven.py",
    "tooling/scripts/architecture/module-governance.mjs",
    "tooling/scripts/architecture/module-governance.test.mjs"
  ],
  "readSet": [
    "docs/architecture/domains/chat/messaging",
    "docs/architecture/platform/client/mobile",
    "docs/knowledge",
    "model",
    "packages/messaging-core",
    "packages/secure-content-core"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "uca06-shared-packages",
      "command": "pnpm --filter @peers-touch/client-chat-core test && pnpm --filter @peers-touch/client-media-security test && pnpm --filter @peers-touch/client-storage test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "uca06-client-contracts",
      "command": "pnpm --dir apps/desktop run check && pnpm --dir apps/mobile run check:web",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "uca06-domain-formal",
      "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 tooling/scripts/acceptance-run.py --gate unified-client-shared-semantics",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "renderer-neutral Chat projection、media security、storage scope、codec、selector 和 capability admission 各自只有一个 client-* owner",
    "Desktop/Mobile 中与共享 Model 或 portable core 同义的手写 DTO、状态映射和 retry policy 当前源码引用归零",
    "UI 共享只包含 entity anatomy、state derivation、action contract、accessibility label 和 stable marker；navigation、density、gesture、focus、safe-area 与 keyboard policy 留在 form shell",
    "Android 与 iOS 不分叉 Mobile React component、store 或 route descriptor",
    "每个新增共享 package、primitive 或第二消费者均通过 capability registry；无法共享的语义有 accepted divergence record",
    "Desktop 与 Mobile 分别通过本地 presentation contract，同时消费同一 headless output",
    "unified-client-shared-semantics 机械证明重复 DTO/selector/retry owner 归零且 Presentation Policy 未泄漏进 shared package"
  ],
  "failureBehavior": [
    "不创建 universal mega-package，不把 app shell、route、Tauri global 或 OS API 放入 shared package",
    "不以视觉相似为由共享内部 anatomy 或交互合同不同的组件",
    "不把产品功能 parity 缺口夹带进本项；需要新业务能力时另走 Product Design",
    "domain validation 缺少 current evidence 时保持 UNPROVEN，不降级为 TypeScript compile success"
  ],
  "updatedAt": "2026-10-19T16:52:14.000Z"
}
```

## 完整闭环

先用 import graph 与结构化语义 inventory 找出第二 owner，再按
`reuse -> extend -> extract -> form-specialize -> host-specialize` 分类。共享包先形成
完整 public contract 和 focused tests，消费者同批切换，旧 local helper 同批删除。

## Amendment 2026-10-18

UCA-06 的完成条件要求正式 Gate 与 capability registry 同批切换。原 writeSet
只包含 Gate 实现文件，遗漏 catalog、feature/capability/domain 投影、
fail-closed placeholder 清理，以及共享 Cargo Host adapter 的 reuse-layer
分类。上述文件已机械加入 writeSet；北极星、边界、检查与 doneWhen 均未改变。
