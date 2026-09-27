# 架构模块治理 - 数据模型

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-27 | **Updated**: 2026-09-27
> **Owner**: Architecture Team

---

## 1. Architecture Module Registry

机器声明位于：

```text
docs/architecture/architecture-module-governance/architecture-modules.json
```

顶层结构：

```json
{
  "kind": "peers-touch-architecture-module-registry",
  "schemaVersion": 1,
  "modules": []
}
```

每个模块：

```json
{
  "id": "station-access-lifecycle",
  "root": "docs/architecture/station-access-lifecycle",
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
  "path": "docs/architecture/api-ownership/station-api-capabilities.yaml",
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
