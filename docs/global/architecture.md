# Architecture: Three-Tier System

> Current architecture source for how Peers-Touch components relate to each other.

---

## 1. Document Scope

This document defines:

- the project-level three-tier model
- the relationship between Client, Model, and Station
- the high-level role of Desktop, Mobile, and Station
- the system-wide source-of-truth boundaries

This document does **not** define:

- Desktop internal runtime details
- Station internal subserver implementation rules
- platform-specific coding standards

For those, follow:

- `docs/architecture/runtime/desktop-runtime-architecture.md`
- `docs/station/base.md`
- `docs/client/mobile/base.md`
- `docs/global/coding-guide/`

---

## 2. High-Level Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                       CLIENT LAYER                           │
│                                                              │
│  Desktop = desktop-web + desktop-rust + desktop-app         │
│  Mobile  = Android native + iOS native                      │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               │ consumes generated contracts
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                        MODEL LAYER                           │
│                                                              │
│  model/domain/*.proto                                        │
│  Single source of truth for shared contracts and models      │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               │ generated code + protocol contracts
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                       STATION LAYER                          │
│                                                              │
│  apps/station/frame  = framework / transport / infrastructure│
│  apps/station/app    = business domains / subservers         │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Layer Responsibilities

### 3.1 Client Layer

The Client layer is where user-facing interaction happens.

It includes:

- `apps/desktop/`
- `apps/mobile/src/`
- `apps/mobile/src-tauri/`

The Client layer is responsible for:

- rendering UI
- guiding user interaction flows
- adapting device capabilities
- maintaining local ephemeral state and local runtime orchestration

The Client layer is **not** the shared business source of truth.

### 3.2 Model Layer

The Model layer is the contract layer.

Location:

- `model/domain/`

It is responsible for:

- defining shared protobuf contracts
- keeping cross-end model semantics aligned
- serving as the only valid source for generated domain models

No platform is allowed to create parallel manual domain contracts when the same concept belongs in proto.

### 3.3 Station Layer

The Station layer is the shared business system and cross-end truth source.

Location:

- `apps/station/`

It is responsible for:

- domain rules and state machines
- authentication, authorization, audit, quota, and policy
- shared business APIs and event semantics
- federation and server-side persistence

Station owns shared business truth. Clients orchestrate and present it.

---

## 4. Client Variants

### 4.1 Desktop

Desktop is not a single process and not a single layer.

It consists of four runtime units:

- `desktop-web`: React + TypeScript UI
- `desktop-rust`: local runtime / local BFF / command gateway
- `desktop-app`: Tauri native shell and window host
- `station`: remote shared business system

Desktop high-level runtime chain:

```text
desktop-web -> desktop-rust -> station
desktop-app -> hosts desktop-web and carries desktop-rust
```

Desktop is the richer local runtime client. It may host local orchestration and device capabilities, but it does not replace Station as the shared business truth owner.

### 4.2 Mobile

Mobile is a Tauri v2 Mobile client:

- `mobile-web`: shared Web UI and mobile-first presentation
- `mobile-rust`: Tauri Rust capability kernel
- Android / iOS native plugins: device capability integration

Mobile high-level principles:

- shared UI/UX and runtime projection semantics with Desktop where appropriate
- native implementation only for device capabilities and Tauri mobile plugins
- shared contract semantics through proto
- Station remains the shared truth source
- mobile does not become an independent cross-end business truth owner

Applet-related runtime follows the Lynx-based direction through a Tauri mobile native plugin unless a later platform decision replaces it.

---

## 5. System Boundaries

### 5.1 Source Of Truth

- Shared business truth: `Station`
- Shared contract truth: `Model`
- Device-local UI and runtime state: corresponding client runtime

### 5.2 Ownership Rule

When deciding ownership of a capability:

1. If the capability represents cross-end business state, owner is `Station`.
2. If the capability represents contract semantics, owner is `Model`.
3. If the capability represents device interaction or local runtime orchestration, owner is the corresponding client.

### 5.3 Communication Rule

- Client-to-Station communication uses Station APIs and protobuf-aligned contracts.
- Inter-app shared model communication must remain proto-first.
- Clients must not redefine business truth locally when Station already owns it.

---

## 6. Repository Structure

```text
peers-touch/
├── apps/
│   ├── desktop/
│   ├── mobile/
│   │   ├── src/            # mobile-web UI
│   │   ├── src-tauri/      # mobile-rust capability kernel
│   │   ├── src-tauri/gen/  # Tauri generated mobile projects
│   │   ├── android/        # legacy/native plugin source during migration
│   │   ├── ios/            # legacy/native plugin source during migration
│   └── station/
│       ├── app/
│       └── frame/
├── model/
│   └── domain/
├── packages/
└── docs/
```

---

## 7. Generated Contract Direction

Proto source:

- `model/domain/<domain>/<name>.proto`

Generation follows active platform paths:

- Station-side generated Go contracts support `apps/station/...`
- Mobile generation follows `./tooling/scripts/proto-gen-mobile.sh`
- Desktop consumes generated contracts through its active Rust/TS contract paths

The source of truth is always the `.proto`, never the generated file.

---

## 8. Related Architecture Sources

- Desktop runtime details:
  - `docs/architecture/runtime/desktop-runtime-architecture.md`
- Station/Desktop ownership boundary:
  - `docs/architecture/boundaries/station-desktop-scope-boundary.md`
- Station platform overview:
  - `docs/station/base.md`
- Mobile platform overview:
  - `docs/client/mobile/base.md`
- Project identity:
  - `docs/global/project-identity.md`

### Mobile Relay Security
- **TLS**: All Mobile ↔ Station communication over TLS
- **Station Relay Authentication**: Relay messages authenticated via JWT
- **No direct peer exposure**: Mobile clients never expose network endpoints

---

## 📡 Network Topology

```
┌─────────────────────────────────────────────────────────┐
│                   Federation Network                     │
│                                                           │
│  ┌─────────┐         ┌─────────┐         ┌─────────┐  │
│  │Station 1│◄───────►│Station 2│◄───────►│Station 3│  │
│  └────┬────┘         └────┬────┘         └────┬────┘  │
│       │                   │                   │         │
│       │  ActivityPub      │                   │         │
│       │  Federation       │                   │         │
└───────┼───────────────────┼───────────────────┼─────────┘
        │                   │                   │
        │                   │                   │
   ┌────▼────┐         ┌────▼────┐         ┌────▼────┐
   │ Desktop │◄───────►│ Desktop │◄───────►│ Desktop │
   │ (Alice) │  P2P    │  (Bob)  │  P2P    │(Charlie)│
   └─────────┘  libp2p └─────────┘  libp2p └─────────┘
        ▲                   ▲                   ▲
        │ Station            │ Station            │ Station
        │ Relay              │ Relay              │ Relay
   ┌────┴────┐         ┌────┴────┐         ┌────┴────┐
   │ Mobile  │         │ Mobile  │         │ Mobile  │
   │ (Alice) │         │  (Bob)  │         │(Charlie)│
   └─────────┘         └─────────┘         └─────────┘
```

---

## 🎯 Design Principles

### 1. **Separation of Concerns**
- **View**: UI only, no logic
- **Controller**: Business logic + state
- **Model**: Data structure only
- **Service**: External communication

### 2. **Dependency Injection**
- Desktop: Services registered via Rust command bridge
- Android: Hilt / manual DI
- iOS: Swift native DI patterns
- No hardcoded instantiation
- Easy to mock for testing

### 3. **Proto-First**
- Models defined once in .proto
- Generated for all platforms
- Type-safe across tiers

### 4. **Station–Client API: Proto Only**
- **Default**: All Station ↔ Client APIs use **Proto** (application/protobuf). No JSON.
- **Exception**: JSON only when strictly unavoidable; must be documented and planned for migration to Proto.

### 5. **Modular Design**
- Features are self-contained
- Subservers are independent
- Easy to add/remove modules

### 6. **Mobile: Station Relay, No P2P**
- Mobile 端不内置 libp2p，不参与 P2P mesh
- 所有实时消息通过 Station Relay 中转，降低移动端复杂度与功耗
- Desktop 端保留 P2P + Relay 混合策略

### 7. **Applet Container: Lynx**
- Applet / 小程序运行时以 [Lynx](https://github.com/lynx-family/lynx) 为跨端容器方向
- Desktop 使用 Lynx for Web 承载 Applet web bundle；Android / iOS 使用原生 LynxView 承载 native Lynx bundle
- Applet 运行在 Host 托管的 Lynx Runtime 中，通过 canonical bridge (`peers-touch.applet.bridge`) 与 Capability Gateway 调用宿主能力
- 正式架构见 `docs/architecture/applet-runtime/README.md`

---

## 🚀 Deployment Architecture

### Development
```
Developer Machine
├── Desktop App — Tauri dev (port 3000)
├── Android App — Android Studio / Emulator
├── iOS App — Xcode / Simulator
└── Station Backend (port 8080)
```

### Production
```
User's Home Network
├── Station (Docker container on NAS/Raspberry Pi)
│   ├── PostgreSQL (data)
│   ├── Frame + Subservers
│   └── Relay service (for mobile clients)
└── Clients
    ├── Desktop app — P2P + Station API
    └── Mobile app (Android / iOS) — Station Relay + Station API
```

### Federated Network
```
Internet
├── Station A (alice.peers.com)
├── Station B (bob.peers.org)
└── Station C (charlie.peers.net)
    └── All federate via ActivityPub
```

---

## 📚 Related Documents

- **Domain Models**: [domain-model.md](./domain-model.md)
- **Project Identity**: [project-identity.md](./project-identity.md)
- **Desktop Architecture**: [desktop/base.md](../client/desktop/base.md)
- **Station Architecture**: [station/base.md](../station/base.md)

---

*This document provides the 30,000-foot view. For implementation details, see platform-specific prompts.*
