# 架构模块治理 - 数据模型

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-27 | **Updated**: 2026-10-05
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
  "schemaVersion": 3,
  "taxonomyIndexes": [
    "docs/architecture/domains/README.md",
    "docs/architecture/platform/README.md",
    "docs/architecture/shared/README.md",
    "docs/architecture/engineering/README.md"
  ],
  "documentCollections": [
    "docs/architecture/domains/social/core"
  ],
  "modules": []
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

## 4. Pre-edit Context Receipt

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

## 5. Validation Result

```json
{
  "ok": true,
  "modules": ["architecture-module-governance"],
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
- `ARCHITECTURE_INDEX_MISSING`
- `KNOWLEDGE_CONTEXT_UNREADABLE`
