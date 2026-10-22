# Cross-Client Runtime Architecture - Module Layout

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-10-16 | **Updated**: 2026-10-20
> **Owner**: Client Platform Team
> **Module**: Desktop and Mobile client runtime boundaries

---

## 1. Architecture Documents

```text
docs/architecture/platform/client/
├── cross-client-runtime/
│   ├── README.md
│   ├── architecture.diagram.json
│   ├── architecture.svg
│   ├── design.md
│   ├── decisions.md
│   ├── data-model.md
│   ├── module-layout.md
│   ├── integration.md
│   ├── reference-analysis.md
│   └── execution-plans/
│       └── 20261017-unified-client-architecture/
│           ├── artifacts/
│           │   └── UCA-01-baseline-inventory.json
│           ├── plan.md
│           ├── outcome-comparison.md
│           ├── review-prompt.md
│           └── tasks/
├── desktop/
├── frontend-runtime/
└── mobile/
```

`cross-client-runtime` owns the relationship among client forms, release
targets, portable cores, hosts, runtime ports, and presentation policy.
Sibling modules own their detailed runtime and product contracts.

The unified-client Plan is a candidate execution model. Its
`outcome-comparison.md` is human-readable: the planned section is bound to the
Plan Version digest, while actual outcomes update only from current-source
proof.

## 2. Current Code Mapping

```text
apps/
├── desktop/
│   ├── src/                         # Desktop presentation and frontend runtime
│   └── src-tauri/                   # Desktop Rust host/runtime
│       └── src/secure_content/
│           ├── prekey_runtime.rs    # portable PreKey composition
│           ├── object_runtime.rs    # object worker ports/codecs/files
│           └── store.rs             # SQLCipher operation/transfer repository
└── mobile/
    ├── src/                         # One Mobile presentation/runtime tree
    │   └── services/platform/
    │       ├── mobilePlatform.ts    # Native-observed platform adapter
    │       └── platformContracts.ts # Shared Mobile port/fact/admission contract
    └── src-tauri/
        ├── src/                     # Mobile Rust host/runtime
        │   ├── secure_content/
        │   │   ├── runtime.rs       # operation/PreKey/reconciliation composition
        │   │   ├── object_runtime.rs# object worker ports/codecs/files
        │   │   ├── store.rs         # SQLCipher operation/transfer repository
        │   │   └── transport.rs     # Station transport adapter
        │   └── platform/
        │       └── ios.rs           # Existing host source path; now target-neutral
        │                            # identity + typed port/fact/action contract
        ├── plugins/                 # Typed Android/iOS native capability ports
        └── gen/
            ├── android/             # Android release host
            └── apple/               # iOS release host

packages/
├── client-chat-core/               # Shared headless Chat/client projection logic
│   └── src/
│       ├── chatStorageProjection.ts # Scope-fenced storage projection/retry owner
│       └── wireCodec.ts             # Renderer-neutral wire scalar codec
├── client-media-security/          # Shared client media-security policy
├── client-storage/                 # Shared client storage contracts/helpers
├── messaging-core/                  # Portable messaging protocol/security core
├── secure-content-core/             # Portable secure-content mechanism core
├── station-libp2p-http/             # Shared Station transport library
├── station-trust/                   # Shared Station trust library
└── ui/
    └── desktop/                     # Desktop-only visual primitives

model/domain/                         # Shared contract truth
apps/station/                         # Shared business truth
```

The package list records current Rust library reuse. It does not grant this
module ownership of the domain semantics inside those packages.

## 3. Responsibility Map

| Path | Responsibility |
|---|---|
| `apps/desktop/src/` | Desktop presentation policy and runtime projection |
| `apps/desktop/src-tauri/` | Desktop host, local runtime, ports, and core composition |
| `apps/mobile/src/` | Shared Mobile presentation policy and runtime projection |
| `apps/mobile/src-tauri/src/` | Shared Mobile Rust runtime and core composition |
| `apps/mobile/src-tauri/plugins/` | Typed native capability adapters |
| `apps/mobile/src-tauri/gen/android/` | Android packaging and OS host |
| `apps/mobile/src-tauri/gen/apple/` | iOS packaging and OS host |
| `packages/client-chat-core/` | Shared renderer-neutral Chat projection, selector, codec, admission and storage reconciliation |
| `packages/client-media-security/` | Shared renderer-neutral media descriptor and cryptographic processing |
| `packages/client-storage/` | Shared storage domain, scope, envelope and repository contracts |
| `packages/*-core/` | Host-neutral reusable mechanisms with explicit semantic owners |
| `packages/messaging-native-filesystem/` | Shared native Host adapter for Messaging physical file facts/actions; never a portable-core dependency |
| `packages/ui/desktop/` | Desktop Presentation Policy primitives; not a cross-client UI owner |
| `model/domain/` | Proto contract source |
| `apps/station/` | Cross-device business rules and durable shared state |

Chat Presentation Policy remains explicit in the consuming forms:

- `apps/desktop/src/components/chat/chatPresentationPolicy.ts`
- `apps/mobile/src/pages/chat/chatPresentationPolicy.ts`

These files may differ in geometry and interaction affordances while consuming
the same headless composer admission and Chat projection outputs.

## 4. Dependency Direction

**View: Reuse Topology.** Arrows mean source dependency.

```text
Desktop presentation ─┐
                      ├─> client runtime projection
Mobile presentation  ─┘             |
                                    v
                         Desktop/Mobile Rust host
                           |                  |
                           v                  v
                   portable Rust cores   runtime ports
```

Live Client ↔ Station calls belong to the Runtime Topology in `design.md`.
Model bindings are generated into every runtime that consumes shared wire
semantics; Model is not a runtime dependency hop.

Allowed:

- hosts depend on portable cores;
- portable cores depend on narrow host-neutral port traits;
- host adapters implement those traits;
- presentation depends on runtime and admission projections;
- all layers consume generated Model contracts where semantics cross a
  process or device boundary.

Forbidden:

- portable cores importing Tauri application state or UI types;
- native plugins importing product page state;
- Android/iOS hosts defining separate Mobile domain stores;
- presentation bypassing client runtime to call untyped plugin interfaces;
- Station depending on a client host implementation.

## 5. Placement Rules

| Semantic layer | Canonical placement |
|---|---|
| Cross-process/device contract | `model/domain/` |
| Host-neutral Rust mechanism | capability-owned Rust crate under `packages/` |
| Renderer-neutral client logic | capability-owned TypeScript package under `packages/client-*` |
| Policy-neutral shared UI primitive | `packages/ui/shared/` after capability registration |
| Desktop visual policy | `packages/ui/desktop/` or `apps/desktop/src/` |
| Mobile visual policy | `apps/mobile/src/` |
| Android/iOS OS capability | `apps/mobile/src-tauri/plugins/` or generated host |

`packages/ui/shared/` is an admitted target root, not a claim that a current
shared UI implementation exists. Until a policy-neutral component has two
consumers, shared entity semantics remain in a headless package and each client
form owns its shell.

## 6. Core Extraction Rule

A reusable Rust library belongs under `packages/` only when:

1. its semantic owner is explicit;
2. it has no Tauri or OS-host dependency;
3. host interaction is expressed through narrow ports;
4. local persistence has an explicit schema and migration owner;
5. at least one consuming client binds it through a reviewed adapter;
6. tests distinguish portable semantics from host integration proof.

Code shared only by one host remains in that host until these conditions hold,
unless its accepted contract already requires another client form.

## 7. TypeScript And UI Extraction Rule

A shared TypeScript or UI asset belongs under `packages/` only when:

1. semantic owner and capability ID are registered;
2. inputs, outputs, failure behavior, and consumer scope are explicit;
3. it imports no app shell, route, Tauri global, or OS adapter;
4. Desktop and Mobile presentation policy can remain outside it;
5. the second consumer uses the canonical package before merge;
6. focused tests run at the shared package boundary.

Entity semantics shared across surfaces are extracted before a second
look-alike component lands. Visual composition is shared only when anatomy and
interaction are policy-neutral.

## 8. Native Plugin Rule

Mobile plugins are organized by capability, not by business feature. A plugin
may own:

- permission requests and status observation;
- OS API calls;
- callback normalization;
- capability-specific event delivery.

A plugin may not own:

- Station authorization;
- business retry or reconciliation;
- a parallel Mobile feature store;
- shared domain DTO definitions;
- UI navigation or product admission.

## 9. Reuse Governance

`architecture-modules.json` is the only reusable-capability inventory. The
governance validator derives direct workspace dependencies shared by Desktop
and Mobile from:

- `apps/desktop/package.json` and `apps/mobile/package.json`;
- `apps/desktop/src-tauri/Cargo.toml` and
  `apps/mobile/src-tauri/Cargo.toml`.

Every derived shared package or crate must be covered by at least one
registered capability contract root. Package manifests prove consumption;
they do not replace semantic ownership.
