# Station Backend: Base Architecture

> Platform-level source for what Station is, how it is structured, and how App and Frame relate.

---

## 1. Document Scope

This document defines:

- what `apps/station/` is responsible for
- how Station is split into `app/` and `frame/`
- how Station fits into the project-wide architecture
- where to continue reading for Station details

This document does **not** define:

- the full Subserver implementation standard
- the full Go coding standard
- cross-platform ownership decisions in detail

For those, follow:

- `subserver-standard.md`
- `go-standards.md`
- `lib-usage.md`
- `../architecture/platform/station-desktop-boundary.md`

---

## 2. Station Role

Station is the shared backend system of Peers-Touch.

It is responsible for:

- shared business truth across clients
- authentication, authorization, audit, quota, and policy
- persistence, event semantics, and federation
- shared APIs consumed by Desktop and Mobile

Chat API ownership is resource-based:

- Conversation is the sole Chat business owner and exposes `/conversation/*`.
- Actor Device, Conversation Delivery, Recovery, Key Exchange, and Federation
  expose `/device/*`, `/device/inbox/*`, `/recovery/*`, `/key-exchange/*`, and
  peer-only `/federation/*`.
- Internal Messaging Engine code may support delivery and cryptography, but
  Station does not expose a Messaging business API or facade.

Station is **not** responsible for:

- Desktop local window or device interaction
- Mobile native UI runtime
- client-side presentation state

In short:

- shared business state belongs to Station
- local interaction runtime belongs to clients

---

## 3. Platform Structure

```text
apps/station/
├── app/      # business domains and subservers
└── frame/    # framework, transport, shared infrastructure
```

### 3.1 App Layer

Location:

- `apps/station/app/`

Role:

- hosts domain-facing business capabilities
- organizes business modules as subservers
- contains application services, domain objects, and persistence integration

Typical active areas in current codebase include:

- `activitypub`
- `agent`
- `conversation`
- `dashboard`
- `events`
- `federation`
- `key_exchange`
- `launcher`
- `oauth`
- `oss`
- `social`

### 3.2 Frame Layer

Location:

- `apps/station/frame/`

Role:

- provides transport, routing, middleware, logging, auth, config, and shared infrastructure
- acts as the runtime foundation for App-layer business modules

Frame is not where business truth should accumulate.

---

## 4. Dependency Rule

The core dependency rule is:

- `app` depends on `frame`
- `frame` must not depend on `app`

This keeps Station layered:

- Frame provides infrastructure and runtime capabilities
- App provides domain behavior and business policy

If a module change requires `frame` to know business semantics from `app`, the layering is likely wrong.

---

## 5. Runtime Model

Station serves as the shared backend runtime for Desktop and Mobile.

High-level request path:

```text
Client
  -> Station transport entry
  -> middleware / auth / routing
  -> subserver handler
  -> application service
  -> persistence / infrastructure
  -> response or event output
```

This path may differ per protocol or subserver, but the layered responsibility stays the same:

- transport and cross-cutting concerns in `frame`
- business decision and domain execution in `app`

---

## 6. Subserver Model

Station business capabilities are organized as subservers.

A subserver is the unit that owns:

- a business capability or bounded domain area
- its handlers and application services
- its domain-level persistence mapping
- its integration with Station runtime

Examples in current codebase:

- `agent` for agent-domain execution, memory, growth, review, and scheduler abilities
- `conversation` for Direct and Group Chat business authority
- resource owners for Device, Inbox, Recovery, Key Exchange, and Federation APIs
- `events` for event-related capabilities
- `oauth` and `oss` for integration and storage-related capabilities
- `social` for social-domain business logic

The exact internal standard lives in:

- `subserver-standard.md`
- `app-layer.md`

---

## 7. Station In The Whole System

At the project level:

- `model/domain/` defines shared contracts
- `apps/station/` owns shared business truth
- clients consume Station through platform-specific runtime paths

Related examples:

- Desktop uses Station through its local runtime and command bridge
- Mobile uses Station through native networking and relay-oriented flows

Detailed cross-system ownership is defined in:

- `../global/architecture.md`
- `../architecture/platform/station-desktop-boundary.md`

---

## 8. Read Next

If you are working on Station, continue with:

- [App Layer](./app-layer.md)
- [Frame Layer](./frame-layer.md)
- [Subserver Standard](./subserver-standard.md)
- [Go Standards](./go-standards.md)
- [Lib Usage](./lib-usage.md)

If you are resolving cross-end ownership:

- [Project Architecture](../global/architecture.md)
- [Station/Desktop Scope Boundary](../architecture/platform/station-desktop-boundary.md)
