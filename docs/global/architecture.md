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

- `docs/architecture/platform/client/desktop/runtime.md`
- `docs/station/base.md`
- `docs/client/mobile/base.md`
- `docs/global/coding-guide/`

---

## 2. High-Level Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                       CLIENT LAYER                           │
│                                                              │
│  Desktop = embedded renderer + desktop-rust + desktop-app   │
│  Mobile  = mobile-web + mobile-rust + native plugins        │
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

- embedded renderer: React + TypeScript UI inside the Tauri WebView
- `desktop-rust`: local runtime / local BFF / command gateway
- `desktop-app`: Tauri native shell and window host
- `station`: remote shared business system

Desktop high-level runtime chain:

```text
embedded renderer -> desktop-rust -> station
desktop-app -> hosts the renderer and carries desktop-rust
```

Desktop is the richer local runtime client. It may host local orchestration and device capabilities, but it does not replace Station as the shared business truth owner.
Desktop has no browser launch mode; all product proof uses the native Tauri
application.

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

### 6.1 Architecture Documentation Projection

`docs/architecture/` projects the code and ownership model through four
non-overlapping categories:

| Documentation category | Repository relationship |
|---|---|
| `domains/` | Station business owners, Model semantics, and cross-client product projections |
| `platform/` | Client runtimes, Station framework boundaries, contracts, and runtime foundations |
| `shared/` | Cross-domain capabilities with narrow owners and no business authority |
| `engineering/` | Development, governance, quality, Acceptance, and tooling control planes |

This is an ownership projection, not a mirror of every source directory.
Code-backed areas without accepted architecture remain explicit gaps in the
nearest category README.

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
  - `docs/architecture/platform/client/desktop/runtime.md`
- Station/Desktop ownership boundary:
  - `docs/architecture/platform/station-desktop-boundary.md`
- Station platform overview:
  - `docs/station/base.md`
- Mobile platform overview:
  - `docs/client/mobile/base.md`
- Project identity:
  - `docs/global/project-identity.md`
- Node connectivity and Relay:
  - `docs/architecture/platform/runtime/node-connectivity/README.md`

### Mobile Relay Security
- **Station identity**: Client scope is pinned to logical `station_peer_id`;
  authorized Node PeerID, URL and Relay identity are route hints only.
- **End-to-end TLS**: When Mobile uses Relay, TLS 1.3 terminates at Station and
  its SPKI is pinned by the Station-signed route attestation.
- **Relay opacity**: Relay sees Circuit metadata and bounded ciphertext, not
  Station Session credentials or business payload.
- **No general peer mesh**: the target Mobile transport uses a dial-only Host;
  it exposes no application listener, Relay service or Federation authority.

---

## 📡 Network Topology

```
Desktop / Mobile
        │
        │ direct HTTPS or secure libp2p Direct / Circuit v2
        ▼
   Home Station
        │
        │ typed Station-to-Station delivery
        ▼
  Remote Station

Optional Relay roles provide opaque routes for both client and peer traffic.
They do not own Station identity, Federation membership or business payload.
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
- Mobile Web/Rust: runtime registry + typed Tauri ports
- Android/iOS: native plugin adapters only
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

### 6. **Mobile: Station Access, No Peer Mesh**
- Mobile 的目标 Native transport 使用 dial-only libp2p Host，不参与公共 P2P mesh
- Mobile 通过 direct Station API 或已验证 Node 的 Circuit route 接入同一逻辑 Station
- Relay 不终止 Station Session 或业务 TLS
- Desktop/Mobile route 差异不改变 shared business scope

### 7. **Applet Container: Lynx**
- Applet / 小程序运行时以 [Lynx](https://github.com/lynx-family/lynx) 为跨端容器方向
- Desktop 使用 Lynx for Web 承载 Applet web bundle；Android / iOS 使用原生 LynxView 承载 native Lynx bundle
- Applet 运行在 Host 托管的 Lynx Runtime 中，通过 canonical bridge (`peers-touch.applet.bridge`) 与 Capability Gateway 调用宿主能力
- 正式架构见 `docs/architecture/platform/applet-runtime/README.md`

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
│   └── Frame + Subservers
├── Optional external Relay role (same binary, isolated process)
└── Clients
    ├── Desktop app — direct or standard Relay Circuit Station transport
    └── Mobile app — direct or standard Relay Circuit Station transport
```

### Federated Network
```
Internet
├── Station A (alice.peers.com)
├── Station B (bob.peers.org)
├── Station C (charlie.peers.net)
└── Optional Relay roles for private/NAT Station reachability
```

One logical Station may contain one or multiple physical Station nodes. Every
node has its own PeerID and signed root authorization; N>1 requires shared
database/object state, durable events and domain fencing. Ingress stays inside
Frame. Target contracts and outstanding proof are defined by Node Connectivity;
this topology is not a claim that cluster deployment has already been verified.

---

## 📚 Related Documents

- **Domain Models**: [domain-model.md](./domain-model.md)
- **Project Identity**: [project-identity.md](./project-identity.md)
- **Desktop Architecture**: [desktop/base.md](../client/desktop/base.md)
- **Station Architecture**: [station/base.md](../station/base.md)

---

*This document provides the 30,000-foot view. For implementation details, see platform-specific prompts.*
