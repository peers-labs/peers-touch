# Debug Session: foundation-gate-budget
- **Status**: [OPEN]
- **Issue**: The exact-source Foundation Gate exhausts its unchanged 3600-second budget after sequential native and hidden-browser Tauri rebuilds, before the 419-cell scenario reaches AS-F10.
- **Debug Server**: Existing Foundation collectors remain active on ports 7778, 7783, 7785, and 7786.
- **Log Files**: `.dbg/trae-debug-log-foundation-*.ndjson`

## Reproduction Steps
1. Verify the `peers-ai-agent` binding at checkpoint `2e3f702f8144c08898419b6ef5813dd2f5805fbe`.
2. Deploy the same commit to `chat-native-disposable-station`.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable profile and unchanged 3600-second timeout.
4. Observe native and hidden-browser startup, product-cell progress, timeout, and physical cleanup.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Native and hidden-browser Tauri configurations invalidate one shared Cargo target, consuming most of the Gate budget on sequential rebuilds. | High | Low | Confirmed by two sequential `cargo build --bins --no-default-features --features e2e-testing,tauri/native-tls` trees under one `apps/desktop/src-tauri/target` directory; each configuration took about 15 minutes. |
| B | The remaining product scenarios fit the unchanged Gate budget when both runtime configurations start from independent warm build caches. | Medium | Medium | Pending an exact-source Gate after per-runtime cache preparation. |
| C | The outer Gate timeout does not terminate nested runtime process groups created with `start_new_session=True`, so cleanup can report passed while clients remain alive. | High | Low | Confirmed on run `20260906T133344461560Z-c620ac933b899e0d466b41ac32a70f5b`: process groups `58058` and `77420` remained after a `timedOut=true` manifest and were terminated separately. |
| D | Stable per-runtime Cargo target directories and stable Foundation process profiles eliminate cross-configuration and per-run fingerprint churn without changing product behavior, Gate timeout, or evidence assertions. | High | Medium | The first isolated-cache prewarm completed cleanly for both runtimes; a subsequent Gate still rebuilt because its run-random profile differed from the prewarm profile, confirming the remaining cache-key drift. |

## Log Evidence
- Exact-source run `20260906T125759409828Z-9641e70157e74de764e8e5640e5249e3`
  on `2e3f702f8144c08898419b6ef5813dd2f5805fbe` failed before product tuples
  because Browser launch context spent 39.676 seconds before Gateway dispatch;
  cleanup passed.
- Exact-source run `20260906T133344461560Z-c620ac933b899e0d466b41ac32a70f5b`
  on the same source passed both AS-F02 locales and AS-F06, then hit the
  unchanged 3600-second outer timeout.
- AS-F02 evidence in the timed-out run proves strict `8/8`, FIFO `1..8`,
  `ADMISSION_QUEUE_FULL`, queue cancellation, active cancellation, residual
  settlement, final queue size zero, and equal source/replay hashes.
- The native and hidden-browser clients were built sequentially against the
  same Cargo target with different Tauri configuration fingerprints.
- Physical inspection after timeout found the scenario runner plus restarted
  native and browser process groups still alive despite a passed Provisioner
  cleanup artifact. Only those owned process groups were terminated.

## Verification Conclusion
The 3600-second timeout is not evidence of a product assertion failure. The
current run spent approximately half its budget recompiling two incompatible
Tauri configurations into one target directory and still advanced through
AS-F06. The next change isolates Cargo targets by Foundation runtime so a
native build cannot invalidate the hidden-browser build and vice versa. The
Gate timeout and every product assertion remain unchanged.

## Fix
- Derive one stable worktree-local Cargo target for each Foundation runtime:
  `native-tauri` and `browser`.
- Use stable Foundation process profiles for native and browser; per-run
  isolation remains owned by storage roots, ports, and process lifecycles.
- Inject the selected target through the existing client launch environment.
- Keep runtime storage, ports, profiles, Station binding, Gate timeout, and
  product assertions unchanged.
- Preserve the build caches across Gate cleanup; they are ignored local build
  artifacts, not product state or evidence.

## Local Verification
- Foundation runtime, Provisioner, scenario, static, and Group One focused
  suites: 206/206 passed.
- `git diff --check`: passed.
- Exact-source warm-cache Gate evidence: pending.
