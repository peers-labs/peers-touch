# Station 接入生命周期 - 模块目录结构

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-27 | **Updated**: 2026-10-06
> **Owner**: Identity and Access

---

## 1. 目标目录

```text
model/domain/
├── access_gate/                 # Access attempt, gate and decision Proto
└── peer/station_identity.proto  # signed Station identity

apps/station/
├── frame/core/facility/session/ # canonical client-class Session slots
├── frame/touch/accessgate/      # access policy and attempt owner
├── frame/touch/actor/           # actor and device session owner
└── app/subserver/federation/    # Federation context and operator API

apps/desktop/
├── src/kernel/                  # identity and startup orchestration
├── src/runtimes/                # scope-bound runtime lifecycle
└── src-tauri/src/application/   # typed Host adapters

apps/mobile/
├── src/features/auth/           # Access Gate UI and state
├── src/runtimes/                # scope-bound runtime lifecycle
└── src-tauri/src/runtime/       # typed native adapters

docs/architecture/engineering/architecture-governance/
└── architecture-modules.json    # module governance registry
```

## 2. Responsibilities

| 路径 | 职责 | 不得承担 |
|---|---|---|
| `model/domain/access_gate/` | 跨端 Access Gate wire contract | 平台 UI 或持久化策略 |
| `frame/core/facility/session/` | Session class slot、撤销与持久化 | 客户端运行时标签或 UI policy |
| `frame/touch/accessgate/` | gate policy、attempt、decision | 客户端 projection |
| `frame/touch/actor/` | Actor/Device session truth | Federation topology |
| `app/subserver/federation/` | Federation context 与 operator 能力 | 普通客户端 UI |
| `apps/desktop/src/kernel/` | Desktop identity/startup 编排 | Station policy |
| `apps/mobile/src/features/auth/` | Mobile gate 呈现与输入 | Station policy |
| 双端 `runtimes/` | scope 生命周期与异步 fence | 共享业务真相 |

## 3. Dependency Direction

```text
generated Access Gate / Station Identity contracts
  <- Station owners
  <- Desktop and Mobile platform adapters
  <- client runtime orchestration
  <- UI projection

Station Federation context
  <- client context consumers

Station / operator Relay state
  -> read-only client diagnosis
```

客户端不得反向定义 Station identity、Access policy、Federation membership 或
Relay routing。
