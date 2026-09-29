---
kind: invariant
title: Desktop SQLite paths stay within the platform budget
status: active
owns:
  - apps/desktop/src-tauri/src/infrastructure/storage/
  - apps/desktop/src-tauri/src/domain/storage/
  - tooling/development/secure_content/runtime_owner.py
referenced-by:
  - docs/knowledge/README.md
related:
  - docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut/tasks/W12A.md
detected: 2026-09-29
---

# Desktop SQLite paths stay within the platform budget

## What must hold

Desktop database paths MUST stay below the non-Windows SQLite 512-byte path
limit. Identity-derived directory names MAY be replaced by a deterministic
digest only when the complete path reaches that limit. The full identity MUST
remain the encryption key identity, and existing short-scope paths MUST remain
unchanged.

## Why this is non-negotiable

Federated account IDs combine Station identity, provider, and Actor PTID. Under
an isolated Acceptance runtime root, a valid remote identity can make the
database path exactly 512 bytes. SQLite then reports `unable to open database
file`, leaving the messaging engine and Secure Content supervisor unavailable.

Always hashing scopes would avoid the limit but silently relocate existing
short-path databases. Conditional compaction preserves compatible local data
while making previously unopenable deep paths deterministic and bounded.

## How to verify

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml infrastructure::storage::tests`
  must pass.
- `long_database_path_uses_a_bounded_stable_scope` must cover a path at or
  above 512 bytes and assert a stable `scope-<sha256>` directory below the
  limit.
- `short_database_path_preserves_the_existing_scope` must prove existing
  short-scope paths do not move.
- W8 `run-w8-suite` must start the cross-Station remote recipient and reach
  receiver-visible product assertions.

## Crosswalks

- W8 failure runtime:
  `development/secure-content/runtime-owner/w8-suite-d94fddb7e8b9-27236-1790694181666781000/`.
- W12A owns source repair before W8 is replayed.
