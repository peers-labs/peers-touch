---
kind: pitfall
title: GUI launch must reuse the last identity-verified profile
status: active
owns:
  - apps/desktop/src-tauri/src/bootstrap.rs
  - apps/desktop/src-tauri/src/infrastructure/storage/active_profile.rs
  - apps/desktop/src-tauri/src/application/auth/service.rs
referenced-by:
  - docs/knowledge/playbooks/desktop-debug-runtime-with-qualified-chooser.md
related:
  - docs/knowledge/pitfalls/sqlcipher-raw-key-no-utf8-lossy.md
  - docs/knowledge/pitfalls/desktop-installed-runtime-drift.md
  - docs/knowledge/invariants/desktop-identity-lifecycle-closure.md
  - docs/knowledge/playbooks/desktop-debug-runtime-with-qualified-chooser.md
detected: 2026-10-30
owner: desktop-runtime
review-cadence: annual
next-review: 2027-10-30
---

# GUI launch must reuse the last identity-verified profile

## Symptom

After the identity-seed/SQLCipher-key migration to the profile-scoped file
store (`<storage-root>/<profile>/data/secure-store`), double-clicking the
installed app (Finder/Dock/LaunchServices, no `PT_PROFILE` in the environment)
showed:

- an empty chat surface ("No conversations") even though the terminal-launched
  instance loaded `direct:2, group:1`;
- opening/starting a chat surfaced "Conversation action failed", with
  `messaging_create_direct` never reaching the wire;
- the whole account appeared "lost".

The log of the fallback profile (`.../peers-touch/desktop/logs/app.log.*`)
contained, hundreds of times per session:

```
restored/validated session retained while durable messaging activation awaits retry
  error="messaging actor identity unavailable: identity continuity conflict:
         no local identity seed matches the Station continuity record"
DESIGN_AMENDMENT_REQUIRED: active session has no actor-device engine
account_get_device_id FAIL INTERNAL_ERROR "messaging device identity is unavailable"
```

## Root cause

Identity material is per-profile, but GUI launch profile selection was not
persisted: terminal/Make launches passed `PT_PROFILE=corpstable-app`, while a
double-clicked bundle had no such environment and `bootstrap.rs` hardcoded the
fallback `"desktop"`. That legacy profile directory held a *different* identity
seed plus ~180 pre-profile storage keys. Station correctly rejected the foreign
seed as a continuity conflict, so no messaging engine ever activated and every
identity-gated command failed. No data was lost — the verified identity and all
databases were intact under the `corpstable-app` profile; the UI was simply
running against the wrong storage partition.

The system property that allowed this: **profile selection authority was split**
(explicit environment in some launch paths, hardcoded default in others) with
no record of which profile had actually proven its identity on this machine.

## Mitigation

### What was done in code

- New `infrastructure::storage::active_profile` module owns one launch-profile
  decision: explicit `PT_PROFILE` → cross-profile pointer
  `<storage-root>/active-profile.json` → `"desktop"` fallback.
- Bootstrap calls `resolve_launch_profile()` exactly once and publishes the
  result back into `PT_PROFILE`, so storage layout, SQLCipher DB names and the
  other env-reading components share a single selection.
- The pointer is written only after
  `activate_messaging_profile` has matched the local identity seed against the
  Station continuity record and activated the worker. A conflicting/foreign
  profile can never overwrite it; writes are idempotent (same profile = no
  rewrite) and atomic (temp file + rename, `0600`).
- Pointer ids are validated as one bounded path component
  (`[A-Za-z0-9._-]{1,64}`, no `.`/`..`/separators), a dangling pointer whose
  profile directory is gone is ignored, and `PEERS_STORAGE_ROOT` sandboxes
  (acceptance/device tests) neither read nor write the pointer.

### What guards against regression

- `cargo test --lib active_profile` — nine unit tests cover precedence,
  identifier validation, corrupt/unknown-version/dangling pointers, sandbox
  isolation, pointer file permissions and write idempotency.
- A healthy launch logs `Launch profile resolved profile=<id>
  selection=active-profile.json` (or `env:PT_PROFILE` / `default:desktop`).
  `selection=default:desktop` on a machine that should use another profile is
  the early-warning signal.

## How to detect a recurrence

```bash
# 1. What did the GUI launch select? (must not be default:desktop for a
#    profile-scoped account)
grep -h 'Launch profile resolved' \
  "$HOME/Library/Application Support/peers-touch/"*/logs/app.log.$(date +%F)

# 2. Continuity conflicts mean the running profile's seed does not match Station
grep -hc 'identity continuity conflict' \
  "$HOME/Library/Application Support/peers-touch/desktop/logs/app.log.$(date +%F)"

# 3. Pointer content and ownership
cat "$HOME/Library/Application Support/peers-touch/active-profile.json"
ls -l "$HOME/Library/Application Support/peers-touch/active-profile.json"   # 0600
```

Operator overrides still work: launch with an explicit `PT_PROFILE=<id>` to
force a profile; identity recovery/reset flows are separate and must never be
triggered just to "fix" an empty conversation list.

## Crosswalks

- Pitfall `sqlcipher-raw-key-no-utf8-lossy.md` — why storage keys are
  profile-scoped file secrets rather than Keychain ACL material.
- Playbook `desktop-debug-runtime-with-qualified-chooser.md` — the supported
  debug launch path; package launches are for packaging validation only.
- Invariant `desktop-identity-lifecycle-closure.md` — identity activation and
  recovery lifecycle that gates pointer persistence.
