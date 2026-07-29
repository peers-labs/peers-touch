# Debug Session: native-ui-lag
- **Status**: [OPEN]
- **Issue**: Desktop native has severe typing and tab-switch lag while desktop-web is reported smooth. The current transport redesign is blocked because the runtime root cause has not been proven.
- **Debug Server**: `http://127.0.0.1:7777/event`
- **Log File**: `.dbg/trae-debug-log-native-ui-lag.ndjson`

## Reproduction Steps
1. Start the same profile and Station for Desktop native and desktop-web.
2. Use the same account, data set, route, and warmup state.
3. Measure PIN/text input, primary navigation, Settings tabs, and Cron sidebar switching.
4. Repeat in `tauri-webview` dev and packaged native runtimes.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected evidence |
|----|------------|------------|--------|-------------------|
| H1 | Synchronous Tauri command execution occupies a WKWebView/IPC-sensitive thread during interactions | High | Medium | UI long tasks or delayed paint overlap command execution in native but not browser-gateway |
| H2 | Native-only logging and Tauri event traffic amplifies IPC independently of business command cost | High | Low | High `frontend_log` / event count per interaction correlates with input and tab delay |
| H3 | React commits, store fanout, or hidden alive trees dominate the lag even without command traffic | Medium | Low | Slow interactions contain long commits/fanout but no overlapping command |
| H4 | Native and desktop-web currently exercise different request semantics or startup state, invalidating the comparison | Medium | Medium | Trace cohorts differ in commands, account/data, warmup, or runtime bootstrap |
| H5 | Packaged native and `make desktop` dev runtimes have different bottlenecks | Medium | High | P95/P99 and thread samples diverge between dev WebView and packaged release |

## Evidence Ledger
| Claim | Class | Evidence | Confidence | Missing proof |
|-------|-------|----------|------------|---------------|
| Desktop native feels slower than desktop-web | verified_fact (user observation) | Repeated user reports and screenshots | Medium | Controlled paired trace |
| The repository has many synchronous Tauri command wrappers | verified_fact | Repository inventory | High | Runtime thread attribution |
| Synchronous Tauri commands run on tokio workers | rejected claim | Tauri macro source invokes sync commands inline | High | Exact host thread name during reproduction |
| WebSocket is the required final topology | hypothesis | No controlled runtime evidence yet | Low | Comparative transport experiment after root-cause attribution |

## Log Evidence

- Repository inventory: 420 `#[tauri::command]` attributes, 411 sync and 9 async.
- Tauri macro source (`tauri-macros-2.5.5`) executes sync commands inline in
  `body_blocking`; it does not support the prior claim that sync commands are
  automatically dispatched to tokio workers.
- `tooling/acceptance/reports/desktop-performance-cells/tauri-webview.json`:
  `baseline preflight failure`, `PARTIAL`, `UNPROVEN`, zero interaction-linked
  telemetry events.
- `tooling/acceptance/reports/desktop-performance-tauri-webview-playwright.json`:
  proves only one native context-menu interaction (3 events, 16ms visible).
- `desktop-performance-bridge-labelled-tauri-after-prewarm-prune-ai-interaction.json`:
  query filter names a Tauri interaction but raw `eventCount` is 0; rollups
  cannot attribute that interaction.
- Existing native-labeled rollups show startup long tasks and runtime bootstrap
  cost, but they do not distinguish H1-H5 for typing or tab switching.

## Verification Conclusion
| ID | Status | Evidence summary |
|----|--------|------------------|
| H1 | INCONCLUSIVE | Sync command wrappers exist, but no input-linked native thread/bridge trace proves causality |
| H2 | INCONCLUSIVE | Logging/event traffic exists; no per-interaction native count and paint correlation |
| H3 | INCONCLUSIVE | Rollups contain long tasks/runtime bootstrap; target raw interaction events are missing |
| H4 | CONFIRMED | Current formal matrix says native/browser runtime evidence is not comparable and native cell is UNPROVEN |
| H5 | INCONCLUSIVE | No paired dev-native vs packaged-native evidence |

`DESIGN_EVIDENCE_BLOCKED`: transport topology and execution-pool decisions remain
proposals until controlled native runtime evidence distinguishes H1-H5.
