# Peers-Touch Terminology Glossary

> Quick reference for current project terminology.
> Historical Flutter/GetX-era terms may appear in `docs/context/`, but they are not current source-of-truth terminology.

---

## Core Concepts

### Client
User-facing applications in the Peers-Touch system.

- Desktop: `apps/desktop/`
- Mobile: `apps/mobile/android/` and `apps/mobile/ios/`

### Model
The shared contract layer defined by Protocol Buffers.

- Source of truth: `model/domain/*.proto`

### Station
The backend runtime that owns shared business truth, service boundaries, and persistence.

- Current location: `apps/station/`

### Actor
A network identity or participant represented in shared contracts and Station-owned business semantics.

### Federation
Cross-station communication and interoperability across decentralized deployments.

---

## Architecture Terms

### Three-Tier Architecture
The repository-wide system shape:

- Client
- Model
- Station

### Proto / Protobuf
The only allowed shared data model definition mechanism.

- Define first in `model/domain/*.proto`
- Generate into platform-specific targets
- Do not hand-write parallel shared models

### Source of Truth
The document or system layer that is allowed to define a decision boundary.

- Architecture source defines allowed system relationships
- Platform source defines how one platform implements those relationships
- Specification source defines coding and usage rules

### Execution Plan
A delivery-oriented document that records migration order, rollout phases, or implementation progress.

- These belong under a domain `execution-plans/` directory, not in architecture truth documents

---

## Desktop Terms

### Desktop Web
The TypeScript/React runtime rendered in browser or WebView.

### Desktop Rust
The Rust runtime used by Desktop for local application services and gateway responsibilities.

### Desktop App
The Tauri host application that carries Desktop Web and Desktop Rust together in native app mode.

### GlobalContext Kernel
Desktop's cross-cutting state coordination kernel.

- Shared semantics source: `docs/client/common/globalcontext.md`
- Desktop implementation source: `docs/client/desktop/global-context-kernel.md`

### Provider
An AI provider configuration entry, including protocol, credentials, endpoint behavior, and model discovery policy.

### Model Registry
The normalized provider/model view consumed by Desktop after merging presets, local state, and future sync inputs.

---

## Mobile Terms

### Native Dual Platform
The current Mobile mainline architecture: Android and iOS are implemented natively, not through a shared Flutter runtime.

### Applet Container
The Mobile host runtime for Lynx-based applets and Bridge V2 integration.

### Sync Protocol
The Mobile-side contract and behavior for synchronization with Station-managed business truth.

---

## Station Terms

### App Layer
The Station business layer where domain capabilities and subservers live.

- Location: `apps/station/app/`

### Frame Layer
The Station framework layer that provides shared runtime infrastructure.

- Location: `apps/station/frame/`

### Subserver
A modular Station business capability unit under the app layer.

- Location: `apps/station/app/subserver/`

### DDD
Domain-driven design conventions used for Station business capabilities, especially subserver boundaries and domain ownership.

---

## Cross-Cutting Terms

### Applet
A packaged capability module that runs inside the Peers-Touch host environment using defined manifest and bridge contracts.

### Manifest V2
The manifest contract that describes applet metadata, permissions, targets, and loading semantics.

### Bridge V2
The applet-host interaction contract used by Desktop and Mobile applet runtimes.

### i18n
The localization architecture for user-facing strings and localized error presentation.

### ADR
Architecture Decision Record.

- Historical and decision records live under `docs/context/decisions/`

---

## Network Terms

### Relay
A Station-side or infrastructure-side mediated communication path used when direct connectivity is not appropriate or not available.

### libp2p
The peer-to-peer networking foundation used for direct connectivity scenarios.

### ICE
Interactive Connectivity Establishment related capability for candidate discovery and connectivity setup in real-time communication scenarios.

---

## Common Abbreviations

| Abbreviation | Full Term | Meaning |
|--------------|-----------|---------|
| ADR | Architecture Decision Record | Important decision record |
| API | Application Programming Interface | Contracted service interface |
| DDD | Domain-Driven Design | Business boundary design method |
| DTO | Data Transfer Object | Transport-layer data structure |
| ICE | Interactive Connectivity Establishment | Connectivity setup mechanism |
| i18n | Internationalization | Localization architecture |
| P2P | Peer-to-Peer | Direct node-to-node communication |
| Proto | Protocol Buffers | Shared contract definition mechanism |
| SoT | Source of Truth | Authoritative owner of a decision or dataset |
| UI | User Interface | Visual interaction layer |
| UX | User Experience | Interaction and product experience |

---

## Legacy Terms

### GetX
A historical Flutter-era state management and dependency pattern that may still appear in archived documents under `docs/context/`.

### StatefulWidget / StatelessWidget
Historical Flutter widget terminology. These are not current project-wide client architecture rules.

### peers_touch_ui
A historical shared UI library name that may appear in archived Flutter-era material.

---

## Guardrails

- Do not treat archived terminology in `docs/context/` as current architectural truth
- Do not treat generated model output as the source of truth
- Do not redefine platform runtime boundaries inside glossary entries

---

## Related Documents

- `docs/README.md`
- `docs/global/architecture.md`
- `docs/client/common/globalcontext.md`
- `docs/station/base.md`

---

*This glossary tracks current terminology. Historical terms should be explicitly marked as legacy when retained.*
