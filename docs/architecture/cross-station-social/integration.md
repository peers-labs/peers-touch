# Cross-Station Private Social - Integration

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-03 | **Updated**: 2026-10-03
> **Owner**: Social / Federation

---

## 1. Repository-Backed Current State

| Surface | Current asset | Required change |
|---|---|---|
| Social private wire | `model/domain/social/private_content.proto` | add a separate private federation message family |
| Content PreKeys | `model/domain/secure_content/prekey.proto` | reuse unchanged canonical types |
| Key Exchange peer wire | `model/domain/key_exchange/key_exchange.proto` | add federated Content PreKey claim wrapper |
| Federation frames | `model/domain/federation/delivery.proto` | add four durable Social payload kinds |
| Shared transport | `apps/station/frame/core/federation/delivery/` | register typed Social receivers; retain neutral mechanics |
| Key Exchange authority | `apps/station/app/subserver/key_exchange/` | authenticated remote claim and exact replay |
| Social authority | `apps/station/app/subserver/social/` | source UOW, receiver projection, interaction, invalidation, object peer read |
| Native crypto | `apps/desktop/src-tauri/src/secure_content/`, `social/` | consume remote proof/projection without new crypto |
| Native projection | `apps/desktop/src/store/privateMoments.ts`, `runtimes/momentsRuntime.ts` | remote delivery and source-unavailable states |
| Browser boundary | `apps/desktop/src/pages/registry.ts`, `services/appRuntime.ts`, module registry | exclude Social from browser-gateway boot |
| Acceptance | `tooling/acceptance/**/social*` | register positive cross-Station gates before functional tasks |

## 2. Ownership Integration

### Social

Social owns:

- audience expansion and immutable recipient snapshot;
- canonical Post, Comment, Reaction, and lifecycle rows;
- source transaction and Federation outbox intent;
- recipient-side viewer projection and tombstone;
- object authorization and remote interaction policy.

### Federation

Federation owns:

- Station authentication and active membership validation;
- domain-neutral frame format;
- durable outbox/inbox, lease, retry, ordering, deduplication, and dispatch;
- authenticated peer request/stream plumbing.

Federation does not parse private Social policy beyond selecting the registered
payload handler and enforcing generic bounds.

### Key Exchange

Key Exchange owns:

- endpoint and actor-recovery Content PreKey pools;
- claim validation and irreversible consumption;
- exact replay receipts;
- remote claim route authorization.

Social persists the exact claim request and consumes the typed result. Social
never reads Key Exchange tables directly.

### Secure Content

Secure Content contributes existing payload, object, envelope, proof, PreKey,
and local crypto contracts. It does not own a cross-Station business workflow.

### Native Desktop

Desktop Rust owns local key material, proof verification, decryption, encrypted
projection storage, recovery, and account/session fencing. The React surface
renders runtime projection and submits user intent.

## 3. Proto And Generated Output Policy

The scoped generator `tooling/scripts/proto-gen-secure-content.mjs` is extended
to include:

- `domain/social/private_federation.proto`;
- `domain/federation/delivery.proto`;
- existing `domain/key_exchange/key_exchange.proto`.

It remains the only generator used by this plan for these contracts and updates:

- Station Go generated files;
- Desktop TypeScript generated files;
- Mobile TypeScript generated files.

Desktop and Mobile Rust bindings are generated at build time. Their `build.rs`
input lists may be updated only when needed to compile the shared contract.

Mobile allowance is generated-only:

- allowed: `apps/mobile/src/gen/proto/**` and required proto input registration;
- forbidden: Mobile feature, runtime, UI, action, acceptance, or readiness
  changes.

`make model-gen` is not this plan's generation command because it targets the
separate `packages/model` SDK outputs.

## 4. Station Integration

### Source publish

The existing Social prepare/submit UOW gains:

1. verified recipient locality partition;
2. local and remote Key Exchange claim ports;
3. per-remote-actor frame construction;
4. transaction-scoped shared Federation outbox writes.

The existing remote-recipient rejection stays active until the complete source
and receiver path passes functional proof. Its deletion is part of the delivery
cutover, not the contract task.

### Receiver

Social registers handlers for the four new payload kinds during Station
composition. Receiver handlers use the Federation inbox UOW hook so receipt and
domain mutation are atomic.

### Object peer route

Federation exposes the authenticated peer route and bounded stream plumbing.
Social supplies the authorization callback and ciphertext reader. Neither layer
creates a public URL.

## 5. Desktop Integration

`momentsRuntime` remains the only freshness owner:

- consumes remote delivery/invalidation events;
- reconciles pending and imported resources;
- restores state after reconnect/restart;
- clears actor-scoped state on account or Station switch.

Pages only render projection and trigger commands. Remote states extend the
existing private Moment state model; they do not create a second store.

The browser-gateway boot path must not register the Moments page, runtime,
module, navigation item, or Social action surface. Tauri WebView registration
remains enabled.

## 6. Acceptance Integration

Acceptance contract registration is the first execution closure. It adds
fail-closed gate definitions and runner tests before later tasks invoke them.

Required gates:

- `social-cross-station-contract`;
- `social-cross-station-prekey`;
- `social-cross-station-delivery`;
- `social-cross-station-interaction`;
- `social-cross-station-revocation-recovery`;
- `social-cross-station-desktop-functional`;
- `social-cross-station-native-e2e`;
- `browser-social-zero-registration`.

The existing `social-private-desktop-e2e` remains the same-Station and public
continuity regression. No Mobile gate is added to this plan.

## 7. Atomic Cutovers

| Concern | New path | Old path removed or changed | Proof |
|---|---|---|---|
| Remote audience | verified locality + remote Key Exchange claim | unconditional remote-recipient rejection | supported remote audience succeeds; unsupported cases still fail before commit |
| Remote delivery | viewer-scoped Federation frame | local-only delivery intent | source/receiver UOW failpoints and duplicate corpus |
| Object read | Social-authorized Federation peer stream | any direct remote/public fallback | wrong actor/device/object/range negatives |
| Interaction | source-authority command/result | receiver-local authoritative mutation | exact replay and parent revoke tests |
| Revocation | source revision + receiver tombstone | TTL/event-only cleanup | stale delivery cannot resurrect |
| Browser | native-only registration policy | unconditional page/runtime/module registration | source/build/route zero-registration gate |
| Acceptance | positive cross-Station feature and gates | negative-only remote boundary as current claim | exact-source two-Station proof |

## 8. Deletion Obligations

At completion:

- no supported same-Federation recipient reaches the old locality rejection;
- no Social-specific transport, client direct-remote route, or public object
  fallback exists;
- no recipient projection stores co-recipient data;
- no Browser Social registration exists;
- no Mobile product implementation is introduced;
- no current-source documentation points to the removed generic Social activity
  module.
