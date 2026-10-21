# Client Common Architecture

> **Status**: active
> **Version**: v2.1
> **Updated**: 2026-10-17
> **Owner**: Client Platform Team

---

## 1. Scope

This document defines what Desktop and Mobile share and what remains
client-form or release-target specific.

The governing architecture is
[Cross-Client Runtime](../../architecture/platform/client/cross-client-runtime/README.md).

## 2. Shared Layers

### 2.1 Model contracts

`model/domain/**/*.proto` is the shared contract source. Desktop, Mobile, and
Station consume generated contracts. No client maintains a parallel shared
domain model.

### 2.2 Portable Rust mechanisms

Host-neutral Rust libraries under `packages/` may be embedded by Desktop and
Mobile when they own reusable protocol, security, state, or transaction
mechanisms.

Current client-consumed Rust libraries include:

- `packages/messaging-core/`
- `packages/secure-content-core/`
- `packages/station-libp2p-http/`
- `packages/station-trust/`

Each library retains its own semantic owner. Sharing code does not move
business authority out of Station or contract authority out of Model.

### 2.3 TypeScript packages

Shared TypeScript packages are capability-specific:

- `packages/applet-contract/`
- `packages/applet-kernel/`
- `packages/applet-sdk/`
- `packages/client-chat-core/`
- `packages/client-media-security/`
- `packages/client-storage/`
- `packages/locales/`

A package is shared only when both its API and ownership are intentionally
cross-client. Similar source files inside Desktop and Mobile do not by
themselves establish a shared package.

Current shared semantic ownership is:

- `client-chat-core`: IM projection, selectors, wire codec, composer
  admission, and Chat Storage scope/reconciliation/retry;
- `client-media-security`: media descriptor codec and browser-crypto policy;
- `client-storage`: storage domains, scopes, envelopes, keys and repositories.

Desktop/Mobile adapters bind generated Model types, transport and lifecycle.
They do not duplicate the shared state machine or codec. Chat geometry and
composer profiles remain in each Client Form's presentation-policy module.

### 2.4 Product contracts

Cross-client product semantics live in domain or common client documents, for
example:

- Chat lifecycle and Messaging Platform architecture;
- shared UI Identity;
- form-control and Chat UX contracts;
- Frontend Runtime lifecycle and admission semantics.

These contracts define common outcomes. Desktop and Mobile may use different
presentation policies.

## 3. Client-Form Responsibilities

Desktop owns:

- desktop navigation, windowing, shortcuts, tray, and dense layout;
- Desktop Tauri host integration;
- Desktop runtime projections and local OS ports.

Mobile owns:

- mobile navigation, touch, safe areas, keyboard, and background/resume;
- one shared Mobile presentation/runtime tree;
- Android and iOS host adapters and native capability plugins.

Android and iOS are release targets of one Mobile product. They do not own
separate feature or business-state trees.

## 4. Dependency Rules

```text
Presentation
  -> client runtime projections
  -> Desktop/Mobile Rust host
  -> portable Rust core and typed runtime ports
  -> generated Model contracts and Station APIs
```

Rules:

- presentation does not call OS SDKs directly;
- native plugins do not mutate product stores;
- portable cores do not import Tauri or UI types;
- client-local durable state has an explicit local owner and migration policy;
- Station confirms shared business outcomes;
- evidence from Desktop, Android, or iOS proves only its declared runtime cell.

## 5. Package Admission

A new shared package requires:

1. a named semantic owner;
2. an accepted cross-client contract or a second real consumer ready to use it;
3. no duplicate source of truth;
4. explicit public API and dependency direction;
5. focused tests for shared semantics;
6. architecture capability registration with canonical root and consumers;
7. separate host integration evidence where applicable.

When cross-client scope is already known, extract from the first
implementation. Otherwise extraction must complete before the second consumer
merges. Do not create a package merely because code looks similar when product
or lifecycle semantics differ.

Reuse placement follows this order:

1. Model/Proto contract;
2. portable Rust core;
3. shared TypeScript core;
4. policy-neutral shared UI primitive;
5. Desktop/Mobile Presentation Policy;
6. Desktop/Android/iOS Host adapter.

## 6. Related Sources

- [Cross-Client Runtime](../../architecture/platform/client/cross-client-runtime/README.md)
- [Frontend Runtime](../../architecture/platform/client/frontend-runtime/README.md)
- [Desktop](../desktop/base.md)
- [Mobile](../mobile/base.md)
- [Shared packages](./packages.md)
- [UI Identity](./ui-identity/README.md)
