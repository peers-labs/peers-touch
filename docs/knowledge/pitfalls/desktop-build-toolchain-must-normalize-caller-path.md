---
kind: pitfall
title: Desktop build identity must use the same selected Python across callers
status: active
owns:
  - tooling/acceptance/provisioners/desktop_acceptance_build.py
  - tooling/acceptance/tests/test_desktop_acceptance_build.py
  - tooling/acceptance/tests/test_provisioning_owners.py
related:
  - docs/architecture/engineering/acceptance/integration.md
referenced-by: []
detected: 2026-10-24
---

# Selected build toolchain

The Make build and the Native Cell must use one effective build environment.
Acceptance policy prepends its selected Python directory to PATH. A standalone
Make caller can select the same interpreter without that prefix. Hashing these
two forms before normalization produces different configuration identities and
forces another full frontend and Rust build for identical source and tools.

The build owner resolves the explicitly selected interpreter, rejects a missing
executable, prepends its directory to the Make-exported tool path and removes
duplicate entries before hashing. Python participates in measured tool identity.
Source, binary bytes, actual tool changes, compiler flags and external build
inputs continue to invalidate reuse.

## Actual native installation

The macOS cargo/rustc PATH entries are rustup proxies. Their bytes and printed
versions cannot detect changes to the delegated compiler library or SDK.
The Rust installation owner resolves both existing delegates from the actual
Cargo directory, binds all compiler installation bytes and selection files,
and owns the Cargo configuration include graph consumed by metadata too.
The native owner observes the actual process image UUIDs/content and binds the
complete C toolchain, builtin resources and selected SDK. Unknown delegation,
loader configuration, image records or a conflicting SDK refuse observation.
Make's normalized environment reaches both owners unchanged; compiler and SDK
drift invalidate both retained build stages. Native and pnpm tool observations
produce JSON-native platform arrays, including every macOS version-info field.
An embedded tuple becomes a list after persistence and causes strict receipt
equality to reject identical inputs. Normalize at the input producer; retain
full consumer equality and reject drift rather than comparing only digests or
coercing old receipts. These installation observations
do not qualify cache wrappers, resolved native dependencies, build scripts or
product input/output proof.

## Completed stage ownership

A successful frontend build used most of a cold request's budget before Rust
timed out. Discarding the completed stage caused the next request to repeat that
cost. The build owner retains one frontend receipt with the full candidate
identity, complete nonempty dist inventory, output hashes and original producer
cost/logs. A later request verifies both identity and bytes before reuse.
Incomplete frontend work is never retained as qualified output, and source or
output drift invalidates the checkpoint. The final binary receipt still requires
Cargo success and source/output recheck. Neither checkpoint nor cache is a
product result; all original timeouts remain in force.
The build observer still persists terminal failure, but
`EphemeralLaunchCleanupFailed` must remain the original exception with its
cleanup result. Converting it to `BlockedError` lets a parent report successful
resource cleanup while an owned build process failed termination.

## Synthetic Git isolation

Build and attestation self-tests create temporary source repositories. Native
Git still reads the machine's global configuration there. An operator commit
Hook can therefore run for every synthetic commit, add external work to the
qualification cost, or mutate data outside the fixture. Selecting native Git
and removing IDE telemetry variables does not isolate that Hook.

`tests/synthetic_git.py` owns the disposable source operations for build,
attestation, execution-budget and execution-graph fixtures. It resolves Git's
`--exec-path` toolchain delegate, removes IDE telemetry variables and puts the
delegate directory first for fixture source readers. Global `trace2.eventTarget`
still emitted events from native Git after telemetry variables were removed.
The receiving background process recreated `.git/ai` during removal. The fixture
environment explicitly disables all three Trace2 streams for source operations
and readers, including synthetic Runner children. A recording Trace2 target in
the real temporary global configuration reproduces the missing isolation.
Each operation disables hooks and background maintenance in its own command
configuration and has a five-second subprocess limit. TemporaryDirectory
performs one terminal removal; deletion retries cannot hide a live writer.
The operator configuration and real repository Hooks remain intact. Synthetic
source changes, build-input invalidation, real process cancellation and all
product assertions retain their original behavior and budgets.

## How to detect a recurrence

Run from the selected worktree:

```bash
.local/acceptance/python-venv/bin/python3 -m unittest \
  tooling.acceptance.tests.test_desktop_acceptance_build.DesktopAcceptanceBuildTests.test_make_and_policy_python_prefix_reuse_the_same_verified_build
```

`test_make_and_policy_python_prefix_reuse_the_same_verified_build` exercises
the real owner with synthetic tools and requires one build across both caller
forms. Qualification additionally compares actual Make/Cell identities and
requires current-source `VERIFIED_BUILD` in the Native Gate. Budget limits remain
unchanged; self-tests alone do not prove a product Journey.
`test_native_installation_drift_invalidates_both_build_receipts` requires one
build for stable installation inputs, then frontend and binary rebuilds for
compiler and SDK content changes. `test_native_toolchain` additionally compiles
a temporary native executable and shared dependency; changing the dependency
must change the observed image content/output, and removal must fail. The
same actual observations must remain exactly equal after a JSON roundtrip.
The build installation fixture consumes the actual compiled native tool Owner
output, requires one build across stable receipt reuse, then still rebuilds
for compiler/SDK drift. The pnpm real Node test requires the same roundtrip
without changing source, cache, exit or incomplete-input boundaries. The
Rust owner tests retain automatic-install rejection and same-size/restored-mtime
installation drift. Actual current-source tool selection and stable repeated
installation observations remain necessary supporting evidence.
`test_failed_process_cleanup_preserves_exception_and_terminal_observation`
requires both the original Launcher failure and the persisted failed observation,
without a successful build receipt.
`test_synthetic_source_commits_do_not_invoke_operator_hooks` installs a real
recording Hook and Trace2 target through a temporary global Git configuration.
Fixture creation and a later source commit must leave both markers absent. Run the complete build
and attestation modules, then the unchanged Runtime qualification command within
the original deadline; partial unittest output remains UNPROVEN.

## Total budget includes synchronous publication

An actual cold build published READY after 130.849504 seconds against its
130-second limit. Child timeouts and installed-input guards did not cover
output hashing, binary copy, receipt commit or the terminal observation write.
The existing owner now covers its complete success path with the same POSIX
main-thread deadline. Successful observation is written before that guard
unwinds, and READY return checks the same end time. Expiry invalidates a new
binary receipt; completed frontend stage reuse still requires exact identity
and inventory. Failure diagnostics use the caller's existing bounded exit tail.

`test_public_deadline_covers_synchronous_verification_and_commit` uses actual
public ensure, synthetic tool processes and filesystem boundaries. Delayed
warm verification, output reads, copy, receipt replacement and READY observation
must cancel, release temporary files and the lock, and record FAILED. The warm
input receipt stays unchanged. An earlier outer deadline retains its original
exception instance and attribution; process cleanup failure stays typed.
These checks enforce the declared budget, not a new performance objective.
