---
kind: playbook
title: Rust build disk optimization (sccache + lean profiles)
status: active
owns:
  - .cargo/config.toml
  - apps/desktop/src-tauri/Cargo.toml
  - apps/mobile/src-tauri/Cargo.toml
  - tooling/scripts/cargo-cache.sh
related:
  - docs/global/local-dev-environment.md
detected: 2026-10-16
---

# Rust build disk optimization (sccache + lean profiles)

## When to use

You are running out of local disk because multiple Rust worktrees each carry a
full `target/debug` (desktop ~50 GB, mobile ~5 GB). Or you want a clean build
after `cargo clean` to stay fast across worktrees.

This playbook covers the team-default configuration (committed) and the
per-developer aggressive overrides (personal `~/.cargo/config.toml`).

## Pre-conditions

- [ ] Rust toolchain installed (`rustc --version` succeeds).
- [ ] (recommended) `sccache` installed (`cargo install sccache` or
      `brew install sccache`). Not required — builds fall back to plain
      `rustc` when absent.

## Steps

### Team defaults (already committed — do not re-add)

The repository ships the following Rust build defaults:

1. `.cargo/config.toml` sets `[profile.dev] debug = 1`
   (line-tables-only). This cuts `target/debug` by ~40 % vs the Cargo
   default `debug = 2` while keeping `file:line` in panic stack traces.
   It applies to every Rust workspace in every worktree automatically.

2. sccache (shared compiler cache across worktrees) is provided by
   `tooling/scripts/cargo-cache.sh`, registered as the Cargo
   `rustc-wrapper`. On developer machines the wrapper lives at
   `~/.peers-touch/dev/cargo-cache/bin/peers-rustc-wrapper` and is wired
   into `~/.cargo/config.toml` via an `include`. It finds sccache on
   `PATH`, falls back to plain `rustc` when absent, and can be disabled
   with `PT_CARGO_CACHE=0`. Verify with `cargo-cache.sh status` /
   `cargo-cache.sh verify` (or `peers-rustc-wrapper status`).

   This is the single sccache integration point. Do **not** add
   `RUSTC_WRAPPER` exports to the Makefile or build scripts — the env
   var overrides `rustc-wrapper` and bypasses the wrapper's
   `SCCACHE_DIR` / `SCCACHE_CACHE_SIZE` configuration.

### Per-developer aggressive overrides (optional, personal only)

For further space savings, edit your **personal**
`~/.cargo/config.toml` (never commit these to the repo — they trade
debuggability for disk):

```toml
[profile.dev]
debug = 0             # no debug symbols at all; cannot use lldb on Rust
incremental = false   # rely on sccache instead of Cargo incremental cache
```

- `debug = 0` saves another ~15–20 % on top of `debug = 1`.
- `incremental = false` removes the per-worktree `target/debug/incremental/`
  directory (~20–30 % of target size). Rebuilds hit sccache for unchanged
  crates, so the penalty is small **only if sccache is installed**. Do not
  disable incremental without sccache — full rebuilds become very slow.

### Reclaiming space from inactive worktrees

1. In the inactive worktree:
   ```bash
   cd apps/desktop/src-tauri && cargo clean
   cd ../../mobile/src-tauri && cargo clean
   ```
2. Next build of that worktree restores dependencies from the shared
   sccache cache in seconds; only locally changed crates recompile.

## Verification

- [ ] `cargo build --profile dev -Z build-std` is **not** used — the
      repo's `.cargo/config.toml` must be the only source of `[profile.dev]`.
- [ ] `sccache --show-stats` shows non-zero `Compile requests` after a
      `make desktop` build when sccache is installed.
- [ ] `grep -n 'debug =' .cargo/config.toml` reports `debug = 1`.
- [ ] A fresh `cargo build` after `cargo clean` completes in well under
      the cold-build time when sccache is warm (cache hits visible in
      `sccache --show-stats`).
- [ ] `make desktop` does not fail when sccache is **not** installed
      (fallback to `rustc`).

## Crosswalks

- Invariants: none directly — this is a build-tooling playbook.
- Pitfalls: none yet. If a committed profile change breaks CI debugging,
  add one under `pitfalls/` referencing this playbook.
