# Debug Session: post-login-update-loop
- **Status**: [OPEN]
- **Issue**: Native Tauri Ready Shell crashes after login with React "Maximum update depth exceeded"; stack includes rc-overflow checkOverflow.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: `.dbg/trae-debug-log-post-login-update-loop.ndjson`

## Reproduction Steps
1. Start the `local-a` Station and Desktop Native Tauri runtime.
2. Complete the disposable local account login and PIN flow.
3. Wait for the Ready Shell, then navigate to the Agent surface.
4. Observe whether the React ErrorBoundary reports a maximum update depth crash.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | LobeUI `Text` receives a referentially unstable `ellipsis` object in `AgentSidebar.NavItem`. | High | Medium | Confirmed: log line 7 component stack ends at `Text -> NavItem`; `useTextOverflow` depends on `ellipsis`; caller creates the object inline. |
| B | AgentWorkbench ResizeObserver and rail state updates form a render feedback loop. | Medium | Low | Rejected: lines 1-6 show only StrictMode's two installs and stable width `1142`; no callback oscillation. |
| C | Eager/idle page preloading mounts the failing component before explicit Agent navigation. | Medium | Low | Partially confirmed as trigger: lines 3 and 6 show Agent mounted and active before the crash, but PageHost itself is not the update-loop owner. |
| D | Authenticated runtime bootstrap continuously updates a store consumed by an overflow component. | Medium | Medium | Rejected for this crash: no D events precede line 7; the crash occurs in the Agent Text effect. |

## Log Evidence
- Lines 1-6: AgentWorkbench installs twice under StrictMode, both at width `1142`; `nextNarrow=false`.
- Line 7: React maximum-depth crash from `checkOverflow`; component stack is `Text -> NavItem -> AgentSidebar -> TopicRail -> AgentWorkbench`.
- LobeUI `useTextOverflow` effect depends on the complete `ellipsis` object and calls `setIsOverflow`.
- Both `AgentSidebar` Text call sites pass a fresh `ellipsis={{ tooltipWhenOverflow: true }}` object on every render.
- First post-fix iteration removed the Text loop and exposed a second maximum-depth stack at `useSyncExternalStore.updateStoreInstance -> AgentSidebar`.
- `AgentSidebar` directly selected a newly allocated object from `useSessionGroupStore` without equality caching; this was replaced with atomic stable selectors.
- Final post-fix run produced 18 events across PageHost, AgentWorkbench, and deferred runtimes with zero ErrorBoundary events.
- Native gate reached `http://localhost:3210/#/agent`, found 11 primary navigation entries and the Agent composer textarea, and captured `tooling/acceptance/reports/agent-native/agent-native-gate.png`.
- `pnpm run check`: PASS. `git diff --check` for touched files: PASS.

## Verification Conclusion
Two independent `AgentSidebar` identity violations caused consecutive React update loops:
1. Unstable LobeUI `Text.ellipsis` object identity repeatedly retriggered overflow measurement.
2. Unstable Zustand object-selector snapshots repeatedly retriggered `useSyncExternalStore`.

Both are fixed at their caller boundaries. Native post-fix evidence is clean; instrumentation remains until user confirmation, as required by the debugger cleanup gate.
