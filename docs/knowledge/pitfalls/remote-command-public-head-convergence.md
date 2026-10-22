---
kind: pitfall
title: Remote commands must reprepare after follower lag
status: active
owns:
  - apps/desktop/src-tauri/src/messaging/transport.rs
  - apps/mobile/src-tauri/src/messaging/transport.rs
  - tooling/acceptance/gates/chat/lifecycle_mixed_client_group_mls.py
referenced-by: []
related:
  - docs/architecture/domains/chat/messaging/decisions.md
  - docs/architecture/domains/chat/messaging/data-model.md
detected: 2026-10-21
---

# Remote commands must reprepare after follower lag

## Symptom

A removed Mobile Group member rejoined and reached the new MLS and membership
epochs, but its first post-rejoin message never reached the Desktop owner. The
sender Home Station logged:

```text
GET /conversation/public-head 403
```

The message command had already received a valid plan from Conversation
Authority. Device-local MLS state converged before the Home Station follower
projection applied the same rejoin event.

## Root cause

Remote command proposal signing reads the Home Station follower public head
after authority plan preparation. A follower authorization denial at that
point means the command's authority plan is stale relative to local routing
truth; it is not a generic terminal transport failure. Desktop and Mobile
classified every HTTP 403 as terminal, so the durable command never entered
the existing supersede and reprepare path.

## Mitigation

### What was done in code

- Desktop and Mobile classify HTTP 403 only from the remote public-head read
  as `StaleAuthorityPlan`.
- The durable outbox supersedes the exact command and reparses the current
  authority plan before retrying the logical message.
- Generic HTTP 403 responses remain terminal; the change does not weaken other
  authorization boundaries.

### What guards against regression

Focused transport tests prove the public-head-specific classification while
retaining generic 403 terminal behavior. The mixed-client Group MLS Gate proves
remove, rejoin, epoch convergence, and post-rejoin encrypted delivery.

## How to detect a recurrence

```bash
cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml \
  command_error_classification_is_bounded --offline
```

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  follower_public_head_denial_requires_fresh_authority_plan \
  --no-default-features --features acceptance-webdriver --offline
```

```bash
python3 tooling/scripts/acceptance-run.py \
  --runtime-cell desktop-macos-native \
  --gate chat-lifecycle-mixed-client-group-mls-e2e
```

## Crosswalks

- `MP-D13` and `MP-D14` define authoritative event ordering and command
  re-preparation.
- `CHAT-D02` keeps Conversation Authority and Federation follower projection
  as distinct owners.
