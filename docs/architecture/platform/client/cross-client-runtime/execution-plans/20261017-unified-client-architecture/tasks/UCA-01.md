# UCA-01：真实平台基线与复用准入

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UCA-20261017",
  "taskId": "UCA-01",
  "workstreamId": "PLATFORM-BASELINE",
  "title": "建立真实 release target、能力登记和证据矩阵基线",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "uca-platform-baseline",
  "journeyId": "CCR-J01-platform-baseline",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/desktop/src-tauri/src/application/system/mod.rs",
    "apps/desktop/src/services/api.test.ts",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/mobile/package.json",
    "apps/mobile/scripts",
    "apps/mobile/src/services/platform",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/pages/settings",
    "apps/mobile/src-tauri/plugins/platform-permissions/src",
    "apps/mobile/src-tauri/src/commands/build_identity.rs",
    "apps/mobile/src-tauri/src/commands/health.rs",
    "apps/mobile/src-tauri/src/commands/platform_bridge.rs",
    "apps/mobile/src-tauri/src/lib.rs",
    "apps/mobile/src-tauri/src/platform",
    "package.json",
    "docs/architecture/engineering/acceptance/README.md",
    "docs/architecture/engineering/acceptance/design.md",
    "docs/architecture/engineering/acceptance/decisions.md",
    "docs/architecture/engineering/acceptance/data-model.md",
    "docs/architecture/engineering/acceptance/module-layout.md",
    "docs/architecture/engineering/acceptance/integration.md",
    "docs/architecture/engineering/architecture-governance/README.md",
    "docs/architecture/engineering/architecture-governance/design.md",
    "docs/architecture/engineering/architecture-governance/decisions.md",
    "docs/architecture/engineering/architecture-governance/data-model.md",
    "docs/architecture/engineering/architecture-governance/module-layout.md",
    "docs/architecture/engineering/architecture-governance/integration.md",
    "docs/architecture/engineering/architecture-governance/architecture-modules.json",
    "docs/architecture/platform/client/cross-client-runtime/README.md",
    "docs/architecture/platform/client/cross-client-runtime/design.md",
    "docs/architecture/platform/client/cross-client-runtime/decisions.md",
    "docs/architecture/platform/client/cross-client-runtime/data-model.md",
    "docs/architecture/platform/client/cross-client-runtime/module-layout.md",
    "docs/architecture/platform/client/cross-client-runtime/integration.md",
    "docs/architecture/platform/client/mobile/README.md",
    "docs/architecture/platform/client/mobile/design.md",
    "docs/architecture/platform/client/mobile/decisions.md",
    "docs/architecture/platform/client/mobile/data-model.md",
    "docs/architecture/platform/client/mobile/module-layout.md",
    "docs/architecture/platform/client/mobile/integration.md",
    "docs/architecture/platform/client/mobile/acceptance-matrix.md",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/unified_client",
    "tooling/acceptance/registry.yaml",
    "tooling/scripts/architecture"
  ],
  "readSet": [
    "apps/desktop/package.json",
    "apps/desktop/src-tauri/build.rs",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/mobile/src-tauri/Cargo.toml",
    "docs/context/implementation-reports/20261016-android-ios-mobile-desktop-alignment-audit.md",
    "model",
    "packages/client-chat-core",
    "packages/client-media-security",
    "packages/client-storage",
    "packages/messaging-core",
    "packages/secure-content-core",
    "pnpm-workspace.yaml"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "uca01-platform-source",
      "command": "uv run --with PyYAML==6.0.2 -- pnpm --dir apps/mobile run check:native-platforms && uv run --with PyYAML==6.0.2 -- node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "uca01-baseline-contract",
      "command": "pnpm --dir apps/desktop exec vitest run src/services/api.test.ts && python3 -m unittest tooling.acceptance.gates.unified_client.baseline_contract_test tooling.acceptance.gates.unified_client.architecture_aggregate_test",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Rust、TypeScript、build identity 和 diagnostics 从编译目标或 native observation 得到 desktop/android/ios；Desktop system_health 投影 desktop release target 与编译期 source identity，Mobile 删除 ios_first 与 tauri-ios 静态真源并拒绝 build-target mismatch",
    "Android 与 iOS 都有 init、dev、build、project check 入口，并进入 required Mobile build matrix",
    "架构 registry 登记所有 Desktop/Mobile 共享 direct workspace dependency、canonical owner、consumer、allowed dependency 和 evidence gate",
    "capability inventory 明确每个能力属于 Model、portable Rust、shared TS、shared UI、Presentation Policy 或 Platform Host",
    "shared Rust/TypeScript platform port、capability fact、admission projection 与 system-action contract 在 Host task 前冻结",
    "Acceptance catalog 登记独立 Android/iOS Host、Messaging、Secure Content、hard-cut zero-reference 和最终 aggregate Gate",
    "final aggregate Gate 只执行 bounded source-baseline checks 并校验 child evidence identity、freshness、required cells、owner-zero 与 cleanup，不调用任何 child provisioner",
    "每个 readiness claim 使用 capability x release target x runtime mode x source revision evidence cell，缺失 cell 为 UNPROVEN",
    "当前平行实现要么进入后续 hard-cut inventory，要么有 accepted divergence record；空白或 schedule pressure 不能视为例外"
  ],
  "failureBehavior": [
    "不把运行时 user agent、CSS media query 或手工环境变量当 release target authority",
    "不因 iOS Gate 已存在而把 Android 降为 optional diagnostics",
    "不让 registry package presence 代替语义 owner review",
    "本项不提前迁移 Messaging、Secure Content 或 Applet 业务实现"
  ],
  "updatedAt": "2026-10-19T16:52:14.000Z"
}
```

## 完整闭环

先从 manifest、Cargo metadata、native host 和 Acceptance registry 生成 inventory，
再修平台身份与 build matrix。该 inventory 是 UCA-02 至 UCA-06 的写入前置；后续
发现未登记共享消费者必须先回到本项修订，不能在业务任务中临时复制能力。
