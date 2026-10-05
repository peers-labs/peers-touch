# Runtime Feature Flags

> **Client-side desktop controls.** Values are interpreted only by the
> Electron/Tauri shell in `peers-chat`. There is **no** Station-side
> flag service today; ops cannot toggle these remotely without shipping
> a build or instructing users to use devtools / a future settings UI.
> A future RFC may add server-pushed flags — that work is explicitly
> out of scope for this document.

Cryptographic correctness is not feature-flagged. The canonical Chat encryption
contract is `docs/architecture/domains/chat/encryption/README.md` and requires a hard
single-path implementation.

---

## 1. Purpose

Runtime feature flags control non-security product experiments and diagnostic
telemetry. They must not select encryption, identity, persistence, or delivery
semantics.

---

## 2. Storage & Source of Truth

- **Overrides** live in `localStorage` under keys
  `peers-touch:feature-flag:<dotted.name>` (see §3).
- **Defaults** are defined in TypeScript (`readFeatureFlags` and related
  helpers in `apps/desktop/src/modules/settings/featureFlags.ts`). If a
  key is absent or malformed, the in-code default wins.
- Flags apply per browser profile / Tauri WebView origin, not per
  actor account, unless the product later namespaces keys by actor
  (not done today).

Rust and other native code **does not** read these keys in M0; native
behavior stays unchanged until a later phase wires explicit IPC or
build-time config.

---

## 3. Naming Convention

- **Prefix by domain**, lowest-to-highest specificity, separated by
  dots: `<area>.<feature>.<aspect?>`.
- Use **lowercase** `snake_case` segments after the first dot if needed;
  the catalog below uses `crypto.dr_*` for the chat ratchet program.
- **Avoid** generic names (`experimental`, `v2`) without a domain
  prefix — grep and documentation should make ownership obvious.
- **Reserve** names in the catalog (§4) before adding new keys; append
  new sections rather than overloading an existing dotted name.

The `peers-touch:feature-flag:` prefix is mandatory so application data
does not collide with unrelated product keys.

---

## 4. Flag Catalog

### 4.1 crypto.dr_enabled

- **Storage key:** `peers-touch:feature-flag:crypto.dr_enabled`
- **Default:** `true`
- **Type:** boolean
- **Phase:** Introduced in **M1** and flipped to `true` for **M2** on
  2026-07-31. The override remains the rollback kill switch (§7).
- **Effect (when true):** Key bundles may advertise Double Ratchet
  capability (`supported_versions` includes `1`) where the product
  wires that publication; pairwise sessions negotiate `v = 1` only when
  both peers ship compatible code and flags.
- **Effect (when false):** New sessions negotiate the encrypted legacy
  chain-only protocol (`v = 0`); plaintext sending is never enabled.

### 4.2 crypto.dr_telemetry_enabled

- **Storage key:** `peers-touch:feature-flag:crypto.dr_telemetry_enabled`
- **Default:** `true`
- **Type:** boolean
- **Phase:** **M0** — telemetry only; no cryptographic behavior change.
- **Effect (when true):** The desktop shell periodically snapshots
  in-process ratchet decrypt counters (legacy vs. future DR) via the
  `crypto_ratchet_telemetry_snapshot` Tauri command and logs a summary
  (for example once per active session per day) so we can estimate the
  population of legacy decrypts before flipping defaults in M2.
- **Effect (when false):** Those client-side snapshots are not
  scheduled; native counters may still increment when decrypt runs.

## 5. Lifecycle (Add / Promote-to-default / Retire)

1. **Add:** Document the flag in this file (new §4.x), implement the
   TypeScript accessor with a conservative default, and land code paths
   that are inert until the flag is toggled or the default changes.
2. **Promote:** Changing the coded default is a product/architecture decision;
   update the owning design in the same change.
3. **Retire:** After ≥1 release with no overrides, remove dead branches
   and delete the flag entry (or mark deprecated with a removal
   milestone). Prefer removing `localStorage` keys only in migration
   tooling if needed; benign stale keys are acceptable.

---

## 6. Anti-patterns

- **Secret or security-critical behavior** gated only by client flags
  (attackers control `localStorage`). Acceptable: phased UX and protocol
  rollout where the server still enforces identity and rate limits.
- **Silent cross-cutting defaults** without catalog entries — every key
  gets a row in §4.
- **Persisting telemetry-derived secrets** — M0 ratchet counters are
  deliberately in-memory in Rust; see `telemetry.rs` module docs.

---

## 7. References

- `docs/architecture/domains/chat/encryption/README.md` — non-flagged Chat encryption
  contract.
- `apps/desktop/src/modules/settings/featureFlags.ts` — canonical
  TypeScript accessors for flags listed above.
- `apps/desktop/src-tauri/src/domain/crypto/telemetry.rs` — in-process
  decrypt-path counters for M0.
