# Project Identity: What Is Peers-Touch?

> Foundation-level identity document for what the project is, what it owns, and what it is trying to become.
> For system relationships, read `docs/global/architecture.md`.

---

## 1. Project Definition

**Peers-Touch** is a decentralized, federated social network framework organized around three layers:

- `Client`
- `Model`
- `Station`

It is not a single app. It is a system that supports multiple client runtimes, shared protobuf contracts, and a backend runtime that owns shared business truth.

---

## 2. Core Mission

Peers-Touch exists to build a user-centered social and intelligent runtime where:

- users can own and move their identity across deployments
- communities can run independent stations with their own governance
- clients can provide rich local experiences without becoming the shared business source of truth
- shared contracts remain consistent across runtimes through proto-first design

---

## 3. System Shape

```text
Client -> Model -> Station
```

### 3.1 Client

The user-facing runtimes:

- Desktop: Tauri + React/TypeScript + Rust
- Mobile: Android native + iOS native

### 3.2 Model

The shared contract layer:

- `model/domain/*.proto`

### 3.3 Station

The shared business runtime:

- `apps/station/frame/`
- `apps/station/app/`

---

## 4. What The Project Builds

Peers-Touch is building a system that can support:

- identity and authentication
- cross-device and cross-station social interaction
- messaging and event-driven communication
- applet-style extensibility
- agent and AI-assisted capabilities
- local-runtime-rich clients coordinated by Station-owned business truth

This document defines the identity and scope of the project, not detailed feature delivery status.

---

## 5. Active Runtime Landscape

### 5.1 Desktop

Desktop is a multi-runtime client, not just a UI:

- `desktop-web`
- `desktop-rust`
- `desktop-app`
- `station`

At a high level:

```text
desktop-web -> desktop-rust -> station
desktop-app -> hosts desktop-web and carries desktop-rust
```

### 5.2 Mobile

Mobile is a native dual-platform client:

- Android: Kotlin + Jetpack Compose
- iOS: Swift + SwiftUI

`apps/mobile/flutter/` is historical only and not the active implementation direction.

### 5.3 Station

Station is the shared backend runtime that owns:

- shared business state
- server-side policies
- persistence
- federation behavior
- subserver-based domain capabilities

---

## 6. Architectural Identity

### 6.1 Proto-First

All shared data contracts start in `model/domain/*.proto`.

This is not just a tooling preference. It is one of the project's core identity rules:

- shared models are defined once
- platforms consume generated contracts
- manual parallel shared models are forbidden

### 6.2 Federated And Decentralized

The project is designed for a world where multiple independent stations can exist and interoperate.

That means the project identity includes:

- decentralized deployment
- federated communication
- portable identity and interoperable contracts

### 6.3 Local-Runtime-Rich Clients

Peers-Touch is not “backend-only truth plus thin clients”.

Clients may own:

- UI behavior
- device capability integration
- local orchestration
- applet hosting
- runtime-specific coordination

But clients do not become the shared business truth owner when Station already owns that role.

---

## 7. Repository Shape

```text
peers-touch/
├── apps/
│   ├── desktop/
│   ├── mobile/
│   │   ├── android/
│   │   ├── ios/
│   │   └── flutter/        # deprecated
│   └── station/
│       ├── app/
│       └── frame/
├── model/
│   └── domain/
├── packages/
└── docs/
```

---

## 8. What Peers-Touch Is Not

Peers-Touch is not:

- a centralized single-vendor platform
- a blockchain-first product
- a Flutter-only client stack
- a single-process desktop application model
- a JSON-first shared contract architecture

---

## 9. Reading Path

If you are new to the project, read in this order:

1. `docs/README.md`
2. `docs/global/architecture.md`
3. `docs/global/domain-model.md`
4. platform base documents:
   - `docs/client/desktop/base.md`
   - `docs/client/mobile/base.md`
   - `docs/station/base.md`

---

## 10. Boundaries Of This Document

This document defines:

- what the project is
- what the main layers are
- what kinds of runtimes exist
- what high-level identity rules the project follows

This document does not define:

- Desktop internal architecture details
- Mobile module structure details
- Station subserver coding rules
- delivery phase, roadmap, or implementation status

For those, follow the corresponding architecture, platform, and specification documents.
