---
name: pt-debug-space-clean
description: Audit and clean Peers-Touch build artifacts by active task, product surface, platform, and rebuild cost. Use for disk pressure or oversized Cargo, Android, iOS, Node, and tool caches.
---

# PT Debug Space Clean

## Core Rule

Rebuildable does not mean disposable. Classify every candidate by:

`worktree x current task x product surface x platform x profile x artifact role`

Never decide from directory age, branch name, or whole-worktree activity alone.

## Workflow

1. Run the co-located scanner from any worktree in the repository:

   ```bash
   bash tooling/skills/pt-debug-space-clean/scan.sh
   ```

2. Review the component-level report. The scanner combines:
   - Git worktree identity;
   - ACTIVE Development declarations and source claims;
   - dirty source paths;
   - process working directories and platform-specific build commands;
   - actual Desktop, Mobile host, iOS, Android, Node, Gradle, and Xcode outputs.
3. Preserve `keep_hot`, `keep_warm`, `evidence_review`, and `blocked`.
4. Explain cold-build consequences for `current_task_irrelevant` and
   `derived_idle`.
5. Treat whole components and all non-Cargo outputs as report-only. Their build
   tools do not provide a cleanup exclusion lock shared with this scanner.
6. Ask once before a supported Rust generation or stale test-binary deletion.
7. Report the measured filesystem free-space delta. Candidate sizes are upper
   bounds, especially on APFS.

## Classification

- `keep_hot`: required by the current task, dirty source, or active platform
  process.
- `keep_warm`: shared code or a broad task claim makes the platform a likely
  near-term validation target.
- `current_task_irrelevant`: generated output belongs to another product
  surface or platform. It may be deleted after accepting a future cold build.
- `derived_idle`: generated output in a worktree with no current task, dirty
  source, or process.
- `safe_now`: stale final test executables that can be relinked without
  discarding dependency caches.
- `active_graph_unreachable`: an old complete Cargo generation outside the
  retained fingerprint closure. It is removable inside an active worktree
  after accepting that an old alternate configuration may rebuild.
- `rebuildable_cache`: source-safe compiler cache whose deletion causes
  substantial recompilation. Report only.
- `evidence_review`: logs, screenshots, app bundles, test results, and unknown
  artifacts requiring an owner retention decision.
- `blocked`: active writer, open file, Cargo lock, primary data, or unknown
  ownership.

## Platform Semantics

- `apps/desktop/src-tauri/target/{debug,release}` belongs only to Desktop
  native development.
- `apps/mobile/src-tauri/target/{debug,release}` is the macOS host cache used by
  Mobile Rust `cargo check` and `cargo test`.
- `aarch64-apple-ios-sim` and `x86_64-apple-ios` belong to iOS Simulator.
- `aarch64-apple-ios` belongs to iOS device builds.
- `*-linux-android*` belongs to a specific Android ABI.
- `gen/android/app/build` is Gradle output.
- `gen/apple/build` is Xcode output.
- Files and custom directories stored beside Cargo profiles under `target/`
  are not assumed to be Cargo cache. Treat them as `evidence_review`.

A Desktop-only current task may release Mobile platform caches in the same
worktree. An iOS-only task may release Android caches, and vice versa. Shared
Mobile Rust changes keep the host cache hot and both native platforms warm
until the task or acceptance contract narrows the required platform set.

## Rust GC

For retained `keep_hot` and `keep_warm` Cargo profiles larger than the deep-scan
threshold, build an active artifact graph without compiling:

1. Read the package name from the owning `Cargo.toml`.
2. Read existing `.fingerprint/<package>-<hash>/*.json` units.
3. Aggregate host and cross-target profiles owned by the same `Cargo.toml`.
4. Retain root units used within 14 days plus the newest four generations per
   root configuration.
5. Follow Cargo dependency short hashes across the combined profile graph.
6. If a dependency fingerprint is missing, protect every unit with that crate
   name and traverse all of their dependencies. If no matching unit exists,
   fail the entire graph closed.
7. If any fingerprint JSON, marker, or fingerprint path is malformed or
   symlinked, fail closed and expose no deletion candidates for that graph.
8. Classify old fingerprint directories and their matching `deps/` and
   `build/` artifacts outside the retained closure as active-graph unreachable.
9. Deduplicate hard-linked inodes. Per-group reclaim counts only blocks whose
   links are all contained in that one group; cross-group links count only in
   the profile-local batch estimate and never inflate a single-group claim.

This analysis may identify large closure-external generations inside an
actively used worktree. Active worktrees are analysis-only because an arbitrary
direct `rustc` invocation does not honor Cargo's profile lock. The report uses
`candidate_id` there and does not expose an executable `cleanup_id`.

After the worktree has no process, dirty source, or ACTIVE declaration, re-scan
from another worktree. An inactive candidate may expose `cleanup_id`. Delete
one generation only after reviewing that ID:

```bash
bash tooling/skills/pt-debug-space-clean/scan.sh \
  --clean-rust-group-id '<cleanup-id>' \
  --confirm \
  --accept-alternate-config-rebuild
```

The cleanup command re-scans, acquires every related Cargo profile lock,
rechecks process, dirty-source, declaration, open-file, and directory identity
state, and refuses deletion if the worktree became active or the generation
became reachable.
The consequence is limited to a future rebuild of an old feature, test, or
target configuration; the retained current graph stays warm.

The scanner may classify old extensionless hashed executables under
`deps/` as `safe_now` when they:

- are older than seven days;
- are not open by a process;
- are not the root application binary;
- belong to a fully inactive worktree;
- belong to a component without an active Cargo or rustc writer.

Delete these only through:

```bash
bash tooling/skills/pt-debug-space-clean/scan.sh --clean-safe --confirm
```

Do not manually delete `.rlib`, `.rmeta`, `.d`, `.o`, `.dylib`,
`.fingerprint`, `build/`, incremental sessions, or `.cargo-lock`. Hashed
compiler artifacts are removable only as one scanner-proven unreachable
generation.

## Safety Gates

- Ignore `prunable` Git worktree records but report them. Never prune
  worktrees automatically.
- Revalidate processes, open files, classification, and Cargo locks immediately
  before deletion.
- Fail closed when Git, process, open-file, or fingerprint probes fail.
- Reject cleanup paths containing symbolic links.
- Never remove a whole Cargo `target` when it contains custom evidence.
- Do not automatically delete whole Cargo profiles, Gradle/Xcode output,
  `node_modules`, or language caches; report them for owner action.
- Never delete `node_modules` from a current worktree.
- Never delete Acceptance evidence without an owner retention manifest.
- Never delete `.local` wholesale, workspace bindings, Station data, secrets,
  databases, Docker volumes, or TRAE product state.
- Global Go, Cargo, pnpm, Xcode, and simulator caches are report-only unless a
  dedicated owner-specific cleanup rule authorizes them.

## Output

The JSON report must include:

- current free disk;
- prunable worktree records;
- current-task evidence for every worktree;
- per-component platform, size, class, reason, and rebuild consequence;
- retained root fingerprints, live closure size, unresolved dependency
  protection, and largest unreachable Rust generations;
- `safe_now`, cold-build, evidence-review, and blocked totals;
- explicit Rust generation IDs accepted by the cleanup command.

## Anti-Patterns

Never:

- equate "rebuildable" with "safe now";
- infer task scope from a branch name;
- protect or delete every platform because any process uses the worktree;
- delete iOS output for an active iOS task or Android output for an active
  Android task;
- run builds during a low-space scan;
- count a parent together with classified children;
- claim candidate bytes equal actual reclaimed bytes;
- delete files merely because they are old.
