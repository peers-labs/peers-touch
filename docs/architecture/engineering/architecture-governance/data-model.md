# 架构模块治理 - 数据模型

> **Status**: active
> **Version**: v1.4
> **Created**: 2026-09-27 | **Updated**: 2026-10-20
> **Owner**: Architecture Team

---

## 1. Architecture Module Registry

机器声明位于：

```text
docs/architecture/engineering/architecture-governance/architecture-modules.json
```

顶层结构：

```json
{
  "kind": "peers-touch-architecture-module-registry",
  "schemaVersion": 5,
  "taxonomyIndexes": [
    "docs/architecture/domains/README.md",
    "docs/architecture/platform/README.md",
    "docs/architecture/shared/README.md",
    "docs/architecture/engineering/README.md"
  ],
  "documentCollections": [
    "docs/architecture/domains/social/core"
  ],
  "modules": [],
  "reuseDivergences": []
}
```

`taxonomyIndexes` 是精确路径 allowlist。分类 README 只组织信息架构，不取得
capability ownership，也不需要伪装成架构模块。

`documentCollections` 是当前已知、可发现但尚未完成 capability registry 回填的
文档集 root。它只允许文档维护，不赋予 module/capability ownership；未知 root
仍然 fail closed。

每个模块：

```json
{
  "id": "station-access-lifecycle",
  "root": "docs/architecture/platform/station/access",
  "status": "active",
  "owner": "Identity and Access",
  "characteristics": {
    "protocol": true,
    "stateMachine": true,
    "persistence": true,
    "ownership": true,
    "moduleLayout": true,
    "crossRuntime": true,
    "integration": true
  },
  "requiredDocuments": [],
  "decisionIds": [],
  "governedPaths": [],
  "capabilities": [],
  "externalCapabilityRegistries": []
}
```

`id` 是稳定治理身份，不从目录 basename 推导。`root` 必须位于一个已声明的
taxonomy index 下；因此稳定 module ID 可以映射到按业务/平台语义组织的嵌套目录。

## 2. Derived Document Set

```text
base = README.md + design.md + decisions.md
protocol || stateMachine || persistence -> data-model.md
ownership || moduleLayout              -> module-layout.md
crossRuntime || integration            -> integration.md
```

`requiredDocuments` 必须等于推导集合，不允许少报或加入不存在的文件。

## 3. Capability

本模块直接拥有的 capability：

```json
{
  "id": "architecture.module.validate",
  "owner": "architecture.governance",
  "contractRoots": ["tooling/scripts/architecture"],
  "consumers": ["tooling/scripts/plan"],
  "allowedDependencies": ["node.fs"],
  "evidenceGates": ["architecture-module-governance"]
}
```

外部 registry 引用：

```json
{
  "path": "docs/architecture/engineering/api-governance/station-api-capabilities.yaml",
  "capabilityIds": ["station.identity.verify", "access.gate.start"],
  "gate": "station-api-ownership"
}
```

所有列表均为正向集合。schema 不接受表示旧接口、别名或黑名单的字段。
`contractRoots` 必须属于 owning module；`consumers` 是外部依赖者，可以属于
其他 module，但路径必须存在且不能包含 symlink component。

`reuseLayer` 对普通 capability 可省略；但凡 capability 覆盖 Desktop 与 Mobile
共同 direct workspace dependency，就必须存在并与 manifest 类型一致：

- Cargo path dependency -> `portable-rust-core` or a shared
  `platform-adapter` with explicit Host-boundary ownership
- `packages/client-*` pnpm dependency -> `shared-ts-core`
- `packages/ui/*` pnpm dependency -> `shared-ui-primitive`

其余可登记值为 `model-contract`、`presentation-policy` 与
`platform-adapter`。分类只描述复用层，不转移 capability authority。

Shared package capability 可在 `contractRoots` 中同时登记 package manifest 和
实际语义 Owner 文件。Client Form policy 使用独立 `presentation-policy`
capability，并通过 `allowedDependencies` 引用 headless capability；普通
Desktop/Mobile Form specialization 不需要写入 `reuseDivergences`。

## 4. Reuse Divergence

有界的跨客户端分叉与 capability inventory 保存在同一 registry：

```json
{
  "capabilityId": "client.example.headless",
  "axis": "os-capability",
  "canonicalRoot": "packages/client-example",
  "implementations": [
    {
      "capabilityId": "client.example.android",
      "root": "apps/mobile/src-tauri/plugins/example/android",
      "consumers": ["apps/mobile/src-tauri/gen/android"],
      "evidenceGates": ["example-android-native"]
    },
    {
      "capabilityId": "client.example.ios",
      "root": "apps/mobile/src-tauri/plugins/example/ios",
      "consumers": ["apps/mobile/src-tauri/gen/apple"],
      "evidenceGates": ["example-ios-native"]
    }
  ],
  "rationale": "The OS APIs expose incompatible lifecycle callbacks.",
  "decisionId": "EX-D02",
  "reviewTrigger": "Review when both hosts expose the same portable API."
}
```

约束：

- `capabilityId` 必须引用当前 capability；
- `canonicalRoot` 必须位于该 capability 的 `contractRoots`；
- `axis` 只能是 Presentation Policy、OS capability、runtime constraint 或
  security boundary；
- 每个 implementation root 独立绑定其当前 consumer 与 evidence Gate；
- implementation capability 必须是独立 registered capability，并通过
  `allowedDependencies` 引用 canonical capability；
- implementation root 与 consumer 必须有 registered architecture owner；
- root、consumer 与 evidence Gate 必须分别由 implementation capability
  的 contract root、consumer 和 evidence 声明覆盖；
- evidence Gate 还必须存在于 `tooling/acceptance/gates.yaml`；
- `decisionId` 必须是已登记模块的 accepted decision；
- evidence Gate 与 review trigger 必须非空；
- 当前没有例外时使用显式空数组，不创建隐式平台豁免。

## 4.1 Architecture Diagram Spec

canonical 架构图在所属目录使用 `*.diagram.json`：

```json
{
  "kind": "peers-touch-architecture-diagram",
  "schemaVersion": 3,
  "id": "cross-client-runtime.reuse-topology",
  "module": "cross-client-runtime",
  "viewpoint": "reuse-topology",
  "layout": "composition",
  "output": "architecture.svg",
  "title": "跨端客户端复用拓扑",
  "canvas": {
    "width": 1400,
    "height": 830
  },
  "edgeMeaning": null,
  "scene": {
    "rows": [],
    "rail": null,
    "relations": []
  }
}
```

- `id`：全局稳定 Diagram ID；
- `module`：当前 registry module ID，项目级图使用 `project`；
- `viewpoint`：该图唯一主要视角；
- `layout`：与 viewpoint 一一匹配的视觉语法；
- `output`：同目录唯一 SVG 资产；
- `canvas`：画布；
- `edgeMeaning`：该图唯一箭头语义；无箭头时为 `null`；
- `scene`：layout-specific 结构，例如 C4 system boundary、layer bands、
  runtime zones、authority matrix、sequence lanes、control loop 或 reuse rows。
- sequence fragment 的 `kind` 只能是 `alt`、`else` 或 `region`；composition
  `rail` 用于 Model 等非运行时 contract substrate。

spec 是架构文档的视觉投影，不复制 module registry、capability owner 或业务
契约。图内只保留标题和短副词；源码路径与解释放在正文。renderer 校验边界、
节点重叠、引用、文本容量、正交路径、无关节点穿越与标签遮挡；SVG 生成后还必须
经过位图视觉检查。反向引用只从真实 Markdown SVG 链接推导。

## 5. Pre-edit Context Receipt

```json
{
  "kind": "peers-touch-pre-edit-context",
  "schemaVersion": 1,
  "targets": ["tooling/scripts/plan/plan-package.mjs"],
  "knowledge": [
    {
      "path": "docs/knowledge/invariants/example.md",
      "digest": "<sha256>"
    }
  ],
  "architecture": [
    {
      "moduleId": "architecture-module-governance",
      "documents": ["design.md", "decisions.md"],
      "capabilityIds": ["architecture.module.validate"],
      "digest": "<sha256>"
    }
  ],
  "receiptDigest": "<sha256>"
}
```

回执采用排序后的 canonical JSON 计算 SHA-256。它只描述本次输入和已读取真源，
不持久化，不授予写权限。

## 6. Validation Result

```json
{
  "ok": true,
  "modules": ["architecture-module-governance"],
  "sharedClientDependencies": [
    {
      "ecosystem": "pnpm",
      "package": "@peers-touch/client-storage",
      "manifest": "packages/client-storage/package.json",
      "consumers": [
        "apps/desktop/package.json",
        "apps/mobile/package.json"
      ],
      "capabilityId": "client.storage.headless",
      "owner": "client.storage",
      "canonicalRoots": ["packages/client-storage/package.json"],
      "allowedDependencies": ["web.storage"],
      "evidenceGates": [
        "CCR-G09",
        "client-storage-contract",
        "unified-client-shared-semantics"
      ],
      "reuseLayer": "shared-ts-core"
    }
  ],
  "reuseDivergences": [],
  "changedPaths": [],
  "receipt": null
}
```

失败结果必须带稳定 code、message 和定位信息。至少包括：

- `ARCHITECTURE_REGISTRY_INVALID`
- `ARCHITECTURE_MODULE_UNREGISTERED`
- `ARCHITECTURE_DOCUMENT_REQUIRED`
- `ARCHITECTURE_STATUS_MISMATCH`
- `ARCHITECTURE_DECISION_INVALID`
- `ARCHITECTURE_CAPABILITY_UNKNOWN`
- `ARCHITECTURE_REUSE_INVALID`
- `ARCHITECTURE_REUSE_UNREGISTERED`
- `ARCHITECTURE_INDEX_MISSING`
- `KNOWLEDGE_CONTEXT_UNREADABLE`
