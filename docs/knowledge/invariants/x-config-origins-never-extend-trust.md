---
kind: invariant
title: X-Config origins steer transport, never trust
status: active
owns:
  - apps/x-config/internal/publication/
  - packages/x-config-core/src/
  - apps/desktop/src-tauri/src/application/x_config/
  - apps/mobile/src-tauri/src/runtime/x_config.rs
  - tooling/distribution/
referenced-by: []
related:
  - docs/architecture/platform/client/control-plane/decisions.md  # XCFG-D06
  - docs/architecture/platform/client/control-plane/data-model.md
detected: 2026-10-24
---

# X-Config origins steer transport, never trust

## What must hold

The set of x-config snapshot origins — baked `PT_DIST_X_CONFIG_URLS`,
runtime `PEERS_X_CONFIG_URL`, and origins advertised inside an accepted
snapshot's `distribution` section (XCFG-D06) — MUST only choose where a
client fetches bytes. It MUST NOT add or rotate publisher keys, signing
authority, channel identity, or watermark policy. Every fetched envelope,
regardless of which origin served it, MUST be verified against the
app-embedded publisher keyring and the monotonic channel watermark.
Publisher key rotation MUST ship in an app release; a signed snapshot
cannot advertise the next key.

## Why this is non-negotiable

Trust cannot be conferred by data fetched under the trust being established.
If an accepted snapshot could name a new publisher key, anyone who ever
obtains one valid signing key — or who stands up an origin a poisoned
snapshot points at — could mint an unlimited successor chain and ship
directives, endpoint seeds, and releases to every client. The integrity
boundary is ed25519 verification against keys baked into the binary,
independent of transport; this is exactly why plain HTTP over private IP
literals is admitted for corp channels.

The failover merge order (`PEERS_X_CONFIG_URL` override, advertised
origins, baked tail anchors; dedup first occurrence; effective list capped)
exists to bound transport behavior. Baked anchors MUST survive a bad
advertised set so an operator error or a hostile origin cannot strand
clients; rejected envelopes MUST advance failover without downgrading the
currently accepted snapshot. Violating any of these turns an advisory
transport list into mutable trust or a single-origin outage lever.

## How to verify

- `rg -n 'keyring|publisher' apps/desktop/src-tauri/src/application/x_config apps/mobile/src-tauri/src/runtime/x_config.rs` — key construction must reference only the embedded `publisher-keys.json` / `PublisherKeyring`; no origin-derived key input.
- `go test ./apps/x-config/internal/publication/` (`distribution_test.go`) and `cargo test --manifest-path packages/x-config-core/Cargo.toml` (`origins`, `failover`) — admission limits, merge order, and reject-advances-without-downgrade must pass.
- Grep the `distribution` section: `rg -n 'distribution' model/domain/x_config/x_config.proto` — it contains only `DistributionOrigin { string origin }`, never a key or key id.

## Crosswalks

- Decision XCFG-D06 defines the three origin classes and failover semantics.
- See pitfall `pitfalls/mobile-proto-regen-import-closure.md` for the
  generated-code closure that bit this feature's mobile client.
