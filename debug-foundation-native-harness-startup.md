# Debug Session: foundation-native-harness-startup
- **Status**: [OPEN]
- **Issue**: The exact-source Foundation Gate stops before the 419-cell matrix because the native Tauri Agent Acceptance Harness is unavailable, and cleanup leaves devctl-managed listeners running after the launcher exits.
- **Debug Server**: http://127.0.0.1:7778/event
- **Log File**: .dbg/trae-debug-log-foundation-native-harness-startup.ndjson

## Reproduction Steps
1. Verify the bound worktree at commit `f1963a7f2567a05cbbaaafe3a23ff7f9f493b53d`.
2. Build and smoke the dedicated Acceptance binary.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable profile and Station restart authorization.
4. Observe native startup fail before the first matrix tuple because the Agent Harness is unavailable.
5. Observe cleanup report `portsReleased=false` for Gateway, renderer, and WebDriver after the launcher process group exits.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Foundation devctl does not propagate `VITE_ACCEPTANCE_HARNESS=1` to the renderer process. | High | Low | **Confirmed**: pre-fix log line 12 records `desktopE2E=true` and `viteAcceptanceHarness=false`; lines 13-14 show no Acceptance root or Agent namespace. |
| B | Renderer port `3410` is owned by another worktree and Foundation reuses the foreign renderer. | High | Low | **Rejected**: line 13 records the newly launched current-worktree Vite PID and the devctl state file identifies `worktreeId=peers-ai-agent`. |
| C | The correct renderer starts, but route initialization or a JavaScript error prevents the Agent Harness namespace from mounting. | Medium | Medium | **Rejected**: lines 13-14 show the correct URL, root element, and document transition from interactive to complete; the compile-time Harness root alone remains absent. |
| D | Startup readiness checks the Harness before the renderer reaches the mounted state. | Medium | Medium | **Rejected**: line 14 remains Harness-free after the complete document state and full 60-second bounded probe. |
| E | Cleanup tests mapping truthiness instead of whether any port remains listening. | High | Low | **Rejected**: the map is named `portsReleased`; line 15 records false values together with live listener owners. |
| F | Foundation kills the short-lived `make` process group, but devctl-managed detached Vite/Tauri children require the devctl stop lifecycle. | High | Low | **Confirmed**: line 15 records the launcher PGID exited while Vite and Tauri remain in independent PGIDs and own all three ports. |

## Log Evidence
- Pre-fix Gate run: `20260912T082943713422Z-b48301566d031c38e6ea7aca840bfd5e`.
- Current terminal error: `native-tauri Agent acceptance Harness is unavailable`.
- The native launch environment contains `PT_DESKTOP_E2E=true` but no `VITE_ACCEPTANCE_HARNESS`.
- Vite and Tauri logs show the correct worktree runtime remained healthy for more than 60 seconds.
- Renderer port `3410` is owned by the current worktree's managed Vite process, excluding a foreign-worktree takeover.
- Current cleanup error records `ports still listening: {'gateway': False, 'renderer': False, 'webdriver': False}`; these values are `portsReleased`, so `false` correctly means the listeners remained.
- Devctl state records retain detached managed Vite and Tauri process IDs after the parent `make desktop` process group exits.
- Debug log: `.dbg/trae-debug-log-foundation-native-harness-startup.ndjson`.
- Line 12 proves the missing renderer compile flag.
- Lines 13-14 prove a healthy current-worktree renderer without the Harness before and after the bounded wait.
- Line 15 proves devctl-managed listener ownership survives the launcher PGID.
- Post-fix line 1 records both `desktopE2E=true` and
  `viteAcceptanceHarness=true`.
- Post-fix line 3 records a complete document with the Acceptance root, Agent
  namespace, and locale method all present.
- Post-fix line 4 records all managed ports released with no remaining
  listener owners.

## Verification Conclusion
Pre-fix evidence confirms A and F and rejects B, C, D, and E. The implemented
fix injects the existing Harness compile flag into the generated runtime
profile/launch environment and delegates managed-child teardown to the
corresponding devctl stop mode before final port verification.

The focused post-fix runtime comparison passes: the real native renderer
mounts the Agent Harness and reverse cleanup releases the managed Vite, Tauri,
Gateway, and WebDriver resources. The session remains `[OPEN]`; instrumentation
and the Debug Server remain available for the full Gate comparison.
