# Domain Models: Proto-First Contract Rules

> Current global source for shared contract ownership, proto-first rules, and generated model boundaries.

---

## 1. Core Principle

All shared data contracts in Peers-Touch must be defined in Protocol Buffers first.

Source of truth:

- `model/domain/<domain>/<name>.proto`

This is non-negotiable.

If a concept is shared across runtimes or crosses the Client / Model / Station boundary, its contract belongs in proto first.

---

## 2. What This Document Defines

This document defines:

- where shared model truth lives
- what counts as a generated contract consumer
- how generated outputs relate to the source proto
- what is forbidden when evolving shared models

This document does not define:

- one platform's internal DTO conventions
- one platform's local-only runtime state shape
- detailed generation implementation of every build script

---

## 3. Source Of Truth Rule

### 3.1 Only One Shared Contract Truth

For shared models:

- `.proto` is the truth
- generated files are derivatives
- manual replicas are forbidden

### 3.2 Generated Files Are Not Truth

Generated files exist to serve runtimes and toolchains. They must not become the place where field meaning or ownership is redefined.

That means:

- do not edit generated files by hand
- do not fix contract problems only in generated output
- do not let one platform's hand-written DTO drift away from the proto contract

---

## 4. Contract Ownership Boundaries

### 4.1 What Belongs In Proto

Put a model in proto when it represents:

- shared API request/response structure
- shared event payloads
- cross-runtime business entities
- enums and status values that must stay aligned across runtimes

### 4.2 What Does Not Need To Be Proto

These can remain local to one runtime when they are not shared contracts:

- transient UI-only view state
- local form state
- local orchestration-only objects
- platform-private adapter or persistence helpers

---

## 5. Current Consumer Directions

The repository currently contains multiple generated consumer targets.

### 5.1 Station

Station consumes generated Go contracts under active `apps/station/...` paths, including:

- `apps/station/frame/touch/model/`
- selected app-layer generated model targets such as subserver-owned model directories

### 5.2 Desktop

Desktop consumes generated contracts in two forms:

- TypeScript generated files under `apps/desktop/src/gen/proto/`
- Rust `prost-build` outputs under `apps/desktop/src-tauri/src/model/`

### 5.3 Mobile

Mobile consumes generated contracts under app-owned directories:

- Android output under `apps/mobile/android/...`
- iOS output under `apps/mobile/ios/PeersTouch/Core/Proto/`

The exact build implementation may evolve, but the ownership rule does not:

- generated outputs follow active app paths
- they do not redefine contract truth

---

## 6. Generation Entry Rules

Repository policy entry points are:

- shared / server-side generation: `./model/build.sh`
- mobile generation: `./tooling/scripts/proto-gen-mobile.sh`

Additional platform-specific generation may exist inside a platform build pipeline, such as Desktop Rust build-time generation.

Regardless of entry point:

- the source remains `model/domain/*.proto`
- generated outputs must follow active platform paths
- deprecated Flutter/Dart generation paths must not be expanded

---

## 7. Evolution Rules

When changing a proto contract:

1. update the `.proto` first
2. preserve backward-compatible field evolution where required
3. regenerate affected targets
4. update consuming code
5. verify that no platform-specific manual contract has drifted

### 7.1 Compatibility Constraints

- append fields instead of reusing removed field numbers
- do not silently change semantic meaning of an existing field
- define shared enums in proto, not separately in each platform
- keep package and ownership semantics stable unless intentionally migrated

---

## 8. Forbidden Patterns

- hand-writing a parallel shared model because generation feels inconvenient
- editing `.pb.go`, generated Rust model files, generated TS protobuf files, or Mobile generated outputs manually
- using JSON-only hand-written cross-runtime DTOs where the same concept already belongs in proto
- letting generated artifacts land outside active app-owned directories
- expanding deprecated Flutter/Dart shared-generation paths as if they were still primary

---

## 9. Minimal Change Flow

When a new shared business concept appears:

1. add or update the proto definition
2. regenerate affected outputs
3. adapt Station handlers and services
4. adapt Desktop and Mobile consumers
5. verify compatibility and ownership boundaries

This keeps contract change upstream and implementation change downstream.

---

## 10. Related Documents

- `docs/global/architecture.md`
- `docs/client/mobile/base.md`
- `docs/station/base.md`
- `docs/station/subserver-standard.md`

---

*Proto files are the shared contract truth. Generated files serve runtimes; they do not redefine the model.*
