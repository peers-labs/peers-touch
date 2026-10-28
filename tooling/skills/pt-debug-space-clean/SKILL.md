---
name: pt-debug-space-clean
description: Audit and clean Peers-Touch build artifacts by active task, product surface, platform, and rebuild cost. Use for disk pressure or oversized Cargo, Android, iOS, Node, and tool caches.
---

# PT Debug Space Clean

## Core Rule

Apply the cleanup authority in `docs/global/workflow.md`, section
“编译缓存与开发环境清理”. Current-worktree rebuildable compilation caches
are authorized development maintenance, including complete Cargo profiles,
Gradle/Xcode build output and compiler caches. Do not ask again or stop the
development run for that maintenance. Previously authorized cleanup in another
worktree also proceeds within its explicit scope.

Classify every candidate by:

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
3. Apply the explicit current task even when optional declarations are absent.
   Preserve evidence and unknown data. Exclude active writers before cleanup.
4. Prefer obsolete generations or task-irrelevant output. For disk pressure,
   release a verified complete compilation cache even when it is `keep_hot` or
   `keep_warm`; record the cold-build cost and rebuild it before verification.
5. For scanner-supported Rust groups, use the locked cleanup command. For a
   whole profile or non-Cargo build output, verify its compiler-only contents
   and exclude writers/open files through the original build owner and locks.
   Scanner report-only means that it does not implement that cleanup; it is
   not a human approval requirement.
6. Supply `--confirm` and rebuild-acceptance flags directly for authorized
   cleanup. Do not use partial-generation cleanup when fingerprint proof fails.
7. Report the measured filesystem free-space delta and continue development.
   Candidate sizes are upper
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
  substantial recompilation. Current-worktree cleanup is authorized once its
  contents and concurrent writers are verified.
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

Do not cherry-pick `.rlib`, `.rmeta`, `.d`, `.o`, `.dylib`, `.fingerprint`,
`build/` or incremental files outside a scanner-proven generation. A verified
compiler-only whole profile may instead be released as one unit under the
workflow's cache authority after writers and open files are excluded. Hold the
original build lock through deletion; never remove a live `.cargo-lock`.

## Safety Gates

- Ignore `prunable` Git worktree records but report them. Never prune
  worktrees automatically.
- Revalidate processes, open files, classification, and Cargo locks immediately
  before deletion.
- Fail closed for the affected operation when Git, process or open-file probes
  fail. A failed fingerprint probe blocks selective generation deletion; it
  does not replace independent whole-cache identification.
- Reject cleanup paths containing symbolic links.
- Never remove a whole Cargo `target` when it contains custom evidence.
- Automatically clean verified current-worktree Cargo profiles, Gradle/Xcode
  output and compiler caches when needed. Keep the original build owner and
  concurrent-writer checks; no new permission checkpoint is required.
- Never delete `node_modules` from a current worktree.
- Never delete Acceptance evidence without an owner retention manifest.
- Never delete `.local` wholesale, workspace bindings, secrets, unrelated
  databases, Docker volumes or TRAE product state. Development/test data reset
  uses the exact reviewed non-stable Profile capability and canonical reset
  owner; an existing grant requires no renewed prompt.
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
- infer task scope only from optional declarations or protect every platform
  because any process uses the worktree;
- clean an actively written profile or discard hot output without recording
  its rebuild cost and rebuilding before verification;
- run builds during a low-space scan;
- count a parent together with classified children;
- claim candidate bytes equal actual reclaimed bytes;
- delete files merely because they are old.
- stop authorized development to ask again for current-worktree compilation
  cache cleanup or exact-scope non-stable development data reset.
