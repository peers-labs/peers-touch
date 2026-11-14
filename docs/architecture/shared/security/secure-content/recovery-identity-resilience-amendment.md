# Recovery Identity Resilience Amendment (SC-D31 / SC-D32 / SC-D33)

> **Status**: accepted by Owner 2026-11-05 (independent review `DESIGN_REVIEW_PASS`); execution plan pending approval
> **Created**: 2026-11-05 | **Updated**: 2026-11-05
> **Module**: Secure Content (`docs/architecture/shared/security/secure-content/`)
> with a cross-module Actor Identity capability (vault; merged into the
> Identity module docs on acceptance)
> **Amends**: `design.md`, `security.md`, `data-model.md`, `integration.md`
> **Decisions**: SC-D31, SC-D32, SC-D33 in `decisions.md`
> **Product gate**: the Mobile first-run backup *onboarding* Journey is explicitly
> out of scope for this amendment; it follows a separate product-design
> contract. Settings-grade capability and architecture are in scope.

This document is the single draft source for the amendment. After acceptance,
the execution plan folds its content into the canonical `design.md`,
`security.md`, `data-model.md`, `integration.md`, and the Actor Identity module
docs; this file then points at the merged locations instead of remaining a
parallel contract.

Owner decisions governing v2:

- **D-OWN-1**: the recovery phrase is the identity root. Recovery Identity
  protects both the Actor Identity seed and the Secure Content recovery
  master, so a wiped single device can re-enroll as the same PTID with the
  phrase alone.
- **D-OWN-2**: zombie-device v1 is authoritative revocation plus typed
  blocking; no liveness auto-demotion, no silent skip.
- **D-OWN-3**: architecture and Settings capability ship first; Mobile
  first-run onboarding is a separate product contract.

---

## 1. Evidence Ledger

### 1.1 Verified facts

| ID | Claim | Evidence |
|---|---|---|
| F1 | Content recovery master `K_sc_recovery` derives from 24-word BIP39 entropy, actor PTID, and recovery epoch (SC-D16 transcript). Phrase/master never uploads. | `security.md` §4; `packages/secure-content-core/src/recovery.rs:41` |
| F2 | Private publish seals one endpoint envelope per active device plus one recovery envelope per recipient, including the author; an unclaimable recovery slot fails prepare before encryption. | `security.md` §8; `apps/station/.../social/private_content_ports.go:254-293`; `private_content_service.go:877-898` |
| F3 | Desktop persists the content master only from chat-archive create/restore. No independent recovery-identity bootstrap exists. | `messaging_recovery.rs:271,386` |
| F4 | Desktop ships phrase generation and a Settings surface that immediately funnels the phrase into `createRevision`; no independent create identity entry. | `messaging_recovery.rs:176-197`; `RecoverySettings.tsx:260-315` |
| F5 | Mobile production has no phrase generation. The only generator is harness-gated `social_private_acceptance_prepare_keys` (random entropy, never surfaced, epoch conflict on repeat). | `apps/mobile/.../social/mod.rs:1898-1926`; `commands/mod.rs:186-279`; `secure_content/store.rs:1637-1647` |
| F6 | Mobile production can only consume a phrase after `RECOVERY_REQUIRED` against an existing envelope epoch; it has no `0 -> 1` pool bootstrap. | `social/mod.rs:1135-1180,1225`; core maintenance publishes recovery only when a local epoch exists (`secure_content/runtime.rs:68-74`) |
| F7 | Active endpoints are exactly non-revoked, locally verified devices with valid key material; departure requires explicit revocation. | `actor_identity/infrastructure/persistence/capabilities.go:113-137` |
| F8 | Claim is all-or-nothing: missing/empty pool for any principal returns depleted and rolls back the transaction. | `key_exchange/infrastructure/content_prekey_store.go:702-720` |
| F9 | Accepted depleted policy is 409/30206 "surface readiness, await replenishment"; no stale-device policy exists. | `decisions.md:2665` |
| F10 | Station exposes `/device/enroll|list|revoke`; revoke is same-actor, optimistic profile version, terminal; SC-D15 fence makes unclaimed endpoint keys ineligible after revoke. | `actor_identity/application/service.go:123-159`; `subserver.go:311-381`; `domain/device.go:326-384` |
| F11 | Enrollment byte-compares the established Actor Identity public key; a wiped device without the seed cannot re-enroll as the same PTID. | `actor_identity/domain/device.go:237-261` |
| F12 | The only production carriers of the actor identity seed to a new device are the chat archive blob (`archive.actor_identity_seed`, restored pre-enrollment) or a second trusted device's cross-signature. | `messaging_recovery.rs:437-466`; `device.go:225-232` cross-signature gate |
| F13 | Desktop Tauri `device_revoke` forbids non-current devices and tears down local Secure Content on success; TS `deviceService` is only consumed by acceptance/tests. | `tauri_commands/conversation.rs:130-176`; `im-service.ts:268-286` |
| F14 | Mobile has no Actor Identity device list/revoke transport anywhere (Rust or TS). | repository-wide grep, zero callers |
| F15 | Prepare-side 30203/30206/30209 collapses to opaque `RecipientUnavailable` with no principal identity. | `desktop .../social/private_moment.rs:257-271` |
| F16 | The claim error loses principal identity at the source: only pool Kind is formatted; Social further collapses to `PrivateContentRecipientKeyUnavailable`; federated peers propagate only the code; remote claims are batched per Station shard across multiple actors. | `content_prekey_store.go:2433-2443`; `private_content_service.go:4694-4701`; `social/handler.go:1106-1122`; `federated_content_prekey.go:259-288`; `private_content_ports.go:419-553` |
| F17 | SC-D12 opaque slots forbid sender-visible endpoint fingerprints; recipient count is an accepted explicit leakage; the accepted failure contract already bounds leakage to an exact missing-recipient count. | SC-D12 (`decisions.md:465-503`); `security.md:94`; `operations.md:257` |
| F18 | SC-D29 typed audiences distinguish client-supplied enumerable targets (explicit CUSTOM list) from server-expanded FRIENDS/FOLLOWERS/GROUP sets. | SC-D29; `private_content_service.go:592-619` |
| F19 | Recovery publication permits epoch `0 -> 1`, `N -> N`, `N -> N+1`; master keyring keyed by `(actor_ptid, recovery_epoch)` retained until explicit reset. | `decisions.md:2609-2614,2718-2723` |
| F20 | Content sealed with no recovery slot has no recoverable key for anyone; cryptographic impossibility. | F2 + `security.md` §8 |
| F21 | `/device/list` returns the full lifecycle (status, revoked_at, profile_version, label, fingerprint, enrolled_at, activation_sequence); sufficient for a management UI. Actor-level current profile version is derived as the maximum device row value. | `actor_identity/.../repository.go:293-318`; `interface/http/handler.go:192-216`; `domain/device.go:345-357` |
| F22 | Desktop ships an equally parallel harness random-phrase generator (`messaging_recovery_acceptance_create_revision`) that never surfaces the phrase. | `messaging_recovery.rs:301-322` |
| F23 | Phrase entry on Mobile uses the native secure input channel; no phrase has ever crossed into the Mobile Web layer. Production Desktop display is React-state scoped, with clipboard copy. | `social/mod.rs:1806-1807`; `RecoverySettings.tsx:39-135,310-317` |

### 1.2 Hypotheses awaiting runtime evidence

| ID | Hypothesis | Gate |
|---|---|---|
| H1 | A production Mobile user's first private prepare fails with 30206 on the author's own recovery slot. | RG-1 negative leg on harness build without seeding; debug panel shows `recoveryPrekeysAvailable` null/0. |
| H2 | Desktop private Social today depends on a manually created chat backup. | RG-5 negative leg on a clean Desktop profile. |
| H3 | iOS reinstall cannot restore private history today. | By construction pre-amendment; RG-2 is the post-amendment falsifier. |

### 1.3 Accepted consequences (not defects)

- Claimed-but-unopened endpoint envelopes for a revoked device are abandoned; actor recovery envelopes are the historical path.
- Pre-rotation content secrecy is bounded by the oldest un-rotated phrase: phrase rotation is not post-compromise forward secrecy for historical content (see §3.4).
- Unopened endpoint private keys grow locally until acknowledged device destruction; heuristic deletion is forbidden.

---

## 2. Scope And Non-Scope

### 2.1 In scope

1. Independent **Recovery Identity lifecycle** that roots BOTH the Actor
   Identity seed and the content recovery master.
2. Station-hosted, client-sealed **Identity Recovery Vault** (Actor Identity
   capability, opaque ciphertext, account-session scoped, monotonic epoch).
3. Production Mobile create/confirm/rotate/recover contracts and a
   Settings-grade surface, including a NEW native secure-view host capability
   that blocks capture/screenshots for the Web phrase session; Desktop
   convergence; deletion of every bootstrap inversion and parallel random
   generator.
4. Productized device delivery management (list, cross-device revoke) and
   the privacy-scoped typed prepare-blocking projection.
5. Production-delegating acceptance injection and RG-1…RG-8 source-bound
   gates.

### 2.2 Non-scope

- Mobile first-run onboarding prompts/Journeys and product copy beyond
  Settings entry (separate product contract).
- Server-side device dormancy, `last-seen`, auto-demotion.
- Silent skipping of active devices in prepare.
- Recovery of content sealed before any recovery pool existed (F20).
- Changes to Key Exchange pool/claim semantics; federation transport
  semantics; only the error *projection* changes, and only as specified.
- Post-compromise secret-sharing/SSSS or hardware-key custody.
- Chat archive encryption rework; the archive stops being an identity
  carrier but keeps its own format.

---

## 3. Target Architecture

### 3.1 Recovery Identity object (SC-D31)

```text
Recovery Identity (per actor)
  phrase            BIP39-24, created on one trusted device, displayed once
  entropy (32B)
    |- HKDF domain "peers-touch:identity-vault:v1"     -> K_vault(ptid)
    |     AEAD key for the Identity Recovery Vault record
    |- HKDF domain "peers-touch:identity-master-wrap:v1"
    |     -> K_wrap(ptid); wraps prior content masters with (actor, epoch) AAD
    |- HKDF domain SC-D16 "peers-touch:secure-content:recovery:v1"
          -> K_sc_recovery(ptid, epoch) for content recovery PreKeys
```

All three derivation transcripts are byte-exact and specified in `security.md`,
with the same wordlist/NFKD/checksum entry conditions as SC-D16. Each domain
has its own salt/info pair; no key serves two contexts. Each wrapped-master
entry is AEAD-sealed under `K_wrap` with authenticated AAD binding
`(actor_ptid, recovery_epoch, entry_version)`, so an entry cannot be moved
between actors, epochs, or positions.

Client lifecycle states:

```text
ABSENT          no vault, no local master; private Social unavailable
CREATING        phrase generated -> user confirms words -> master derived
READY(N)        vault sealed/uploaded; content recovery pool at N published
ROTATING(N+1)   new entropy; vault re-sealed incl wrapped history; pool N+1
RECOVERED       phrase entered; vault fetched/decrypted; seed + keyring restored
RESET           explicit actor recovery reset; vault and masters purged
```

### 3.2 Identity Recovery Vault (cross-module Actor Identity capability)

The Station stores ONE opaque encrypted record per actor:

```text
IdentityRecoveryVaultRecord {
  actor_ptid            // authority scope
  recovery_epoch        // current epoch; server-enforced monotonic scalar
  sealed_vault          // client-produced ciphertext under K_vault; Station never decrypts
  sealing_key_id        // KDF transcript/version tag, not the key
  version               // optimistic record-version for concurrent writes
  updated_at
}

SealedVault (plaintext, client-only) {
  actor_identity_seed          // immutable for the actor's lifetime
  current_master               // K_sc_recovery at current epoch
  wrapped_previous_masters[]   // (epoch, AAD-bound AEAD under K_wrap)
}
```

Contracts:

1. **Endpoints** (proto-first, Actor Identity domain):
   `GetIdentityRecoveryVault` / `PutIdentityRecoveryVault`. GET is
   authenticated by the actor JWT session only (same wrapper class as
   `/device/list`) so a reinstalled, not-yet-enrolled device can fetch it;
   PUT requires an authenticated active device with possession proof, since
   creation and rotation always run on an enrolled device. Actor Identity
   routes today have no Key-Exchange-style device-possession wrapper, so PUT
   requires a NEW active-device proof wrapper whose contract is owned by the
   Identity domain review (§7); GET deliberately stays JWT-only. Both are
   actor-scoped and rate-limited. Station validates scope, record version,
   and epoch only; it never parses `sealed_vault`.
2. **Rollback/downgrade defense**: PUT commits in one Station transaction
   that enforces BOTH the optimistic record `version` CAS AND non-decreasing
   integer `recovery_epoch` (and non-decreasing sealing transcript tag).
   A replayed older blob therefore fails even with the current version.
   The check compares integer scalars only; Station still never decrypts.
   Conflicts return the existing stale-version typed error.
3. **Bootstrap ordering**: local word confirmation → derive keys → persist
   encrypted master locally BEFORE any network call → publish content
   recovery pool `0 -> 1` AND put vault; READY is reported only after BOTH
   receipt commit and an explicit maintenance wake confirm the pool is
   queryable. Partial failure uses the existing UNKNOWN_COMMIT/reconcile
   pattern; READY never reports on unverified publication.
4. **Reinstall recovery**: login on the new device → `GetVault` (JWT-only) →
   decrypt with phrase (failure is local; Station receives no correctness
   signal) → restore identity seed → the restored identity key self-signs the
   new device certificate; existing enrollment continuity accepts this
   because it verifies the cross-signature with the request-carried identity
   key and byte-compares it with the established actor key → restore keyring
   → maintenance resumes pools `N -> N`; recovery queries then authorize
   under the same PTID as a new device row. No chat archive and no second
   online device are required.
5. **Rotation**: new phrase entropy; the identity seed is **immutable for
   the actor's lifetime** — Actor Identity has no key-rotation contract and
   enrollment rejects a changed key, so rotation changes ONLY the content
   master and the vault/wrapping roots. The vault is re-sealed under the new
   `K_vault`, the prior master chain is wrapped under the new `K_wrap`, and
   content recovery advances `N -> N+1`. Old epoch masters remain usable by
   devices that already hold them and are recoverable on a wiped device via
   the wrapped chain under the CURRENT phrase. Prepare/submit during
   rotation: in-flight plans receive the existing SC-D17 stale rejection,
   which clients map to a typed retry; the client admission layer blocks new
   prepares while ROTATING.
6. **Multi-device after rotation**: another trusted device holding only the
   old root cannot open N+1 envelopes. Inventory/prepare surfaces a typed
   `RECOVERY_IDENTITY_OUTDATED` state; the device adopts the new epoch only
   after the user enters the new phrase. It continues to open its own
   endpoint mail and old-epoch content meanwhile. Rotation UI must state this
   out-of-band obligation explicitly.
7. **Existing Desktop users**: their local identity seed and current content
   master are canonical and need no data migration, but the vault cannot be
   sealed without the phrase (the master is not reversible to entropy).
   Settings offers one bounded bootstrap: enter the existing phrase →
   vault sealed at the current epoch. If the phrase is unavailable, no vault
   is created and content master pools keep working, but reinstall recovery
   stays unavailable until the phrase is recovered; rotation never silently
   replaces the identity seed.
8. **Chat archive becomes a pure consumer**: archive create requires READY
   (or phrase entry establishing it); it stops seeding the content master and
   stops being the identity-restore authority. Archive restore on a clean
   device is rewired: Recovery Identity/vault restore runs first, then
   optional archive hydration. The master-seeding branch in
   `messaging_recovery_create_revision` AND `messaging_recovery_restore_latest`
   is deleted in the same change.
9. The archive's embedded seed copy may remain only as an inert offline
   legacy record for one archive-format generation; after the cut no
   production code path may restore identity or authority from it. The vault
   is the sole identity-recovery authority.

### 3.3 Device delivery management and typed blocking (SC-D32)

**Device management**

- Production commands on both clients: `device_manage_list` and
  `device_manage_revoke_other { device_id, observed_profile_version }`,
  payloads use generated Actor proto types (the current desktop raw-JSON
  passthrough is not copied). Profile version is the max of listed rows;
  conflict refreshes the list and requires explicit re-intent.
- Cross-device revoke is distinct from self-revoke/self-logout and never
  runs local `teardown_actor`; the current self-only `device_revoke` keeps
  its local-destruction semantics.
- Revoking a zombie removes it from the next manifest; SC-D15 fencing makes
  subsequent claims skip it with no Station schema change.

**Typed prepare-blocking projection**

The Key Exchange domain error carries the failing principal
`(pool_kind, actor_ptid, device_id?)` inside the claim transaction. Because
claim currently fails fast on the first empty pool, a local availability
prescan over ALL claimed principals runs inside the same transaction before
selection and aggregates every depleted principal (the scan is non-mutating;
claim still consumes nothing when it fails). The prescan must take the same
pool/candidate row locks (`FOR UPDATE`) the selection path holds until commit,
so a concurrent claim cannot invalidate the aggregate (TOCTOU). Social maps the aggregate into a
new typed protobuf prepare error (never the free-form `details` map);
federation mapping stays code/aggregate-only. Social classifies each blocked
principal ONLY by looking it up in the claim targets persisted for that
prepare (SC-D17 signed plan audience snapshot): an unrecognized principal
fails closed as a generic unavailable projection, never as attributed
identity, and classification never uses a replayed or current audience that
differs from the signed plan.

Social classifies each blocked principal by sender entitlement:

| Target relation | Enumerability | Projection to sender |
|---|---|---|
| self | always | exact pool kind + device id |
| actor in client-supplied enumerable targets (explicit CUSTOM list) | sender already knows membership | actor ptid + pool kind |
| server-expanded audience (FRIENDS/FOLLOWERS/GROUP/…) | Station-resolved | pool kind + numeric count only |
| federated/remote recipients | peer-scoped | pool kind + affected-target UPPER BOUND per peer shard (the peer reports only the code, so exact depletion count is unavailable and never fabricated) |

Client states: `RECOVERY_IDENTITY_MISSING` (self recovery slot → create),
`OWN_DEVICE_DELIVERY_STALLED` (named own device → revoke/repair),
`RECIPIENT_DELIVERY_UNAVAILABLE` (aggregate; nudge, no identity).
Unenriched 30206 still fails closed as today. This rule does not reveal
post-filter membership (block/deleted/policy) and adds no inventory probe:
the prescan only reads claimability of principals the Social prepare itself
constructed.

Explicitly rejected: skipping depleted active devices; liveness
auto-demotion; sender-driven revocation; actor attribution for
server-expanded/remote audiences.

### 3.4 Security additions (folded into security.md)

- Phrase compromise impact is account-class: it decrypts the vault and
  enrolls devices. Mitigations: 24-word entropy, session-authed vault
  endpoint, rate limiting, no Station oracle for wrong phrases, typed
  recovery-event surface, and rotate + device revoke as the response.
- The vault endpoint returns identical responses for absent/wrong-scope
  actors where the transport contract permits; word validation and all
  decryption stay client-side.
- Phrase display on Mobile Web is a bounded exception during the
  create/confirm session only: React-state lifetime, no Web storage, no
  clipboard on Mobile, no logging, no acceptance evidence. Screenshot
  obscuring for a Web-rendered phrase session does NOT exist today
  (FLAG_SECURE covers only native SecureInput); the amendment therefore adds
  a native secure-view capability (host plugin exposes a capture-blocked
  render surface) as a delivery prerequisite for the Mobile create surface.
  Entry continues through native SecureInput.
- Rotation is not historical PFS; the wrapped-master chain means possession
  of the current phrase opens all epochs. This is stated in the rotate
  confirmation surface.

### 3.5 Deterministic recovery evidence (SC-D33)

- Harness-only deterministic phrase injection into the production
  create/recover contracts, owner-provided phrase; the Mobile random seeder
  AND the Desktop `messaging_recovery_acceptance_create_revision` random
  generator are both removed. A source gate asserts no production build
  contains a phrase generator.
- Deterministic handles: create, rotate, recover, vault get/put conflict,
  device list/revoke, canonical pool exhaustion via real claims.

Gates (each an exact-source Journey):

- **RG-1 fresh device**: unseeded harness device → negative prepare returns
  self recovery-missing (30206 typed) → production create completes vault +
  pool → prepare/publish succeeds; debug panel reports both pools; the phrase
  session renders through the capture-blocked native secure-view surface
  (asserted via its host contract).
- **RG-2 reinstall survival (headline)**: A posts private content → wipe
  app container → login → enter phrase → vault decrypt → re-enroll same
  PTID → recovery query lists resources; envelopes open; endpoint pool
  republished; new messages delivered end to end.
- **RG-3 zombie non-blocking**: two devices; exhaust device-2 endpoint pool
  via canonical claims → typed `OWN_DEVICE_DELIVERY_STALLED` names it →
  device-1 `device_manage_revoke_other` → next prepare succeeds; prior
  resources stay recovery-reachable.
- **RG-4 rotation**: READY N → rotate → wrapped chain lets a wiped device
  with the NEW phrase open pre-rotation recovery content; new content seals
  only to N+1; second device shows RECOVERY_IDENTITY_OUTDATED until new
  phrase entry; in-flight stale prepare retries typed; PUT of the pre-rotation
  vault blob is rejected by the Station monotonic-epoch/version guard.
- **RG-5 desktop convergence**: clean Desktop profile creates identity with
  no chat archive; archive revision afterwards consumes READY without epoch
  allocation; established users complete the one-time phrase bootstrap;
  content masters never migrate.
- **RG-6 opaque remote blocking**: server-expanded and federated audiences
  return kind+count/bound only; negative assertions assert no remote
  actor/device id and no membership enumeration on the wire; explicit-CUSTOM
  targets may carry actor+kind. The gate includes differential probes: vary
  the server-expanded audience membership (blocked/deleted/policy-filtered
  actors) and assert the error body fields are indistinguishable across
  variants (code and counts scoped to the signed plan), and that 30203 vs
  30206 responses cannot distinguish actor membership state. Timing is not
  asserted by the Journey; instead the Station contract mandates constant
  response shaping and rate limiting for vault/claim failures, verified
  separately as an operations gate.
- **RG-7 clean-device archive restore**: phrase vault restore + re-enroll
  precedes archive hydration; archive-embedded seed is no longer required;
  READY attests the current epoch, not the archive's historical one.
- **RG-8 structural source gate**: no implicit/random phrase generator in
  production build paths (both clients); harness ports are build-gated.

Unproven Gates stay `UNPROVEN`; no automatic backfill.

---

## 4. Ownership And Sources Of Truth

| Concern | Owner | Mutates | Reads |
|---|---|---|---|
| Recovery Identity lifecycle, KDFs, wrapping chain | portable secure-content core | local keyring via host ports | SC-D16 transcript, vault, inventory |
| Identity Recovery Vault record | Actor Identity (Station) | vault row (opaque) | actor session scope/version |
| Secret storage and phrase UI sessions | Desktop/Mobile host ports | encrypted per-account stores | — |
| Recovery pools/epochs | Key Exchange | pools/receipts | Actor Identity fence |
| Device directory/revocation | Actor Identity | device rows, profile version | manifests |
| Typed blocking projection | Social application (Station) | none | claim principal, target enumerability |
| Device management UI | client Settings | production commands only | device list projection |
| Chat archive | messaging recovery owner | archive revisions | READY identity |
| Acceptance barriers | harness-gated host ports | production state through production contracts | deterministic handles |

### 4.1 Required change surface (no hidden scope)

1. Key Exchange domain error: retain failing principal internally.
2. Social application: classify principal against target enumerability.
3. New protobuf prepare-error projection (social private proto) and
   identity-vault proto (Actor Identity proto); generated clients regenerated.
4. Federation error mapping: code/aggregate-only (no new peer data).
5. Portable core recovery lifecycle + host ports; Desktop/Mobile Rust
   commands and TS runtimes/Settings; archive bootstrap deletion; removal of
   both random acceptance generators.

No Station tables beyond the vault record are introduced; pools, devices,
and plans are unchanged.

## 5. Forbidden Relationships

- No recovery-master writer outside the portable recovery lifecycle; chat
  archive code may only require/consume.
- No Station parsing, validating, or deriving secrets from `sealed_vault`.
- No revocation without same-actor authenticated session and observed
  profile version; no sender-driven or automatic revocation.
- No remote actor/device identity in blocking projections for
  server-expanded or federated audiences.
- No phrase in Web storage, clipboard (Mobile), logs, records, traces,
  acceptance evidence, or URLs; no phrase generation in Web layers.
- No epoch substitution; one derivation transcript per domain; no second
  archive-based identity path kept alive after the cut.
- No parallel bootstrap or random phrase generator in any build path.

## 6. Quality Outcomes

- One device, no second hardware, no chat archive: wipe, reinstall, phrase
  in → same PTID, history opens, new messages flow.
- Private publishing cannot be permanently blocked by a dead device;
  remediation is one authenticated Settings action; senders never learn
  remote membership/inventory.
- Phrase rotation preserves owners' history through the wrapping chain with
  explicit multi-device obligations.
- Production builds verifiably contain no implicit phrase path.

## 7. Open Questions For Review

1. RESET scope/purge ordering across vault, keyring, and pools — same
   milestone or follow-up amendment?
2. Vault rate-limit and lockout policy values (Station ops contract) for
   online phrase guessing; recommend fixed low quota + exponential backoff,
   no Station-side success signal.
3. Exact Actor Identity module/proto placement and endpoint path for the
   vault (owned by Identity domain review).
