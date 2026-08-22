# Debug Session: chat-restart-detail
- **Status**: [OPEN]
- **Issue**: After Alice restarts and reopens the persisted group, the Native Gate sees the restored transcript but cannot find `[data-chat-detail-toggle]`.
- **Debug Server**: Existing project Debug Servers on ports 7783 and 7785 remain open; immutable Gate artifacts are the primary evidence channel.
- **Log File**: External Acceptance Evidence Store run artifacts.

## Reproduction Steps
1. Deploy clean source `d71c08067b7f9b137adcbc7046929e9d586f12bb` to Profile Three.
2. Build the dedicated Acceptance binary and pass Driver smoke.
3. Run `CHAT_ACCEPTANCE_RESET=1 PT_STATION_SKIP_DEPLOY=true python3 tooling/scripts/acceptance-run.py --gate chat-native-product-closure-e2e`.
4. Observe run `20260821T233451461621Z-f0a7b1bb1f65dee54addee44fab05862`.
5. Confirm attachment conservation passes, then observe restart failure while opening Alice Details.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| A | The restart transcript wait accepts an unrelated or premature DOM state before the active conversation pane is ready. | High | Low | Transcript lengths match while the active pane ID/security or visible group row does not match the target group. |
| B | Details is already open after restart but the Gate's panel selector does not represent the rendered state. | Medium | Low | A visible side panel exists while both the expected panel selector and toggle selector are absent. |
| C | The Native click targets a duplicate hidden/prewarmed group row instead of the visible Chat page row. | Medium | Low | Multiple group nodes exist and the clicked node has no client rect or belongs to a hidden page host. |
| D | Restart leaves the Chat surface in a transient loading/placeholder state longer than the current readiness predicate. | Medium | Low | The target group exists, but pane/toggle appears only after projection or page readiness changes. |
| E | The product loses the selected group after restart because a projection or membership failure resets active selection. | Medium | Medium | Active pane changes or disappears after the group click while logs show projection/member errors. |
| F | The Gate reuses initial-launch logout/login setup during restart, racing restored-session navigation against an injected logout. | High | Low | App logs show successful `auth_restore_session`, followed by Gate-issued `auth_logout`/fresh login, while the final DOM returns to the account chooser. |

## Log Evidence
- Source, live Station, and runtime identity all match clean commit
  `d71c08067b7f9b137adcbc7046929e9d586f12bb`.
- `attachment_count_conservation` passed with Alice and Bob Details both at
  `media=1/files=1`.
- `attachment_byte_exact` passed for both actors.
- The first failure is a Selenium `TimeoutException` while locating
  `[data-chat-detail-toggle]` in `prove_restart`.
- Alice's restarted app log reports one group in the social projection.
- Cleanup released `3330`, `3331`, `4445`, `4446`, and the fault-proxy port.

## Verification Conclusion
Run `20260821T233451461621Z-f0a7b1bb1f65dee54addee44fab05862`
closed the preceding attachment gap:

- Alice Details: `media=1/files=1`.
- Bob Details: `media=1/files=1`.
- Composer outcome, Engine rows, sender row, receiver row, and Details counts
  are conserved.
- Alice and Bob byte hashes match the source files.

The run then failed after Alice restart while locating
`[data-chat-detail-toggle]`. The restarted app log reports one group in the
social projection, but the failed run did not preserve a DOM snapshot at that
boundary. Hypotheses A-E therefore remain inconclusive.

## Instrumentation Under Verification
- `prove_restart` now records phase snapshots after restart, Chat navigation,
  group click, and transcript convergence.
- Each snapshot records URL, document focus, Chat surface, subpage controls,
  target group rows, active conversation panes, transcript IDs, Details panel,
  and Details toggle geometry/visibility.
- A Details-open failure now preserves screenshot, DOM, app log, and structured
  JSON evidence before cleanup.
- Product behavior, waits, clicks, and assertions are unchanged.
- Python compile, product-closure static Gate, and diff check pass.

The first source-bound instrumentation run,
`20260821T234703453070Z-0ba892fd82975073593952ace3fa9005`, did not reach
restart. It failed earlier in the fourth Native file chooser because a
transient zero-window Accessibility sample was used as the chooser baseline.
That independent Gate state-machine defect is tracked in
`debug-chat-background-picker.md`; restart hypotheses A-E remain pending.

The next source-bound run,
`20260821T235706759149Z-f65fe44d9f9e89d1e4f7f9f3f212e09a`, matched clean
source and Station `e210e7b01`, crossed all Native chooser paths, and reached
restart. It failed earlier than the prior restart run while locating the target
`[data-chat-group-ulid]`. The initial instrumentation captured in memory after
restart and Chat navigation but persisted evidence only inside the later
Details-open failure handler, so no restart snapshot artifact survived.

The instrumentation boundary now covers the whole restart journey. Any failure
after actor restart preserves the latest phase snapshot, screenshot, DOM, and
app log before cleanup.

Run `20260822T000832375892Z-87488d6a9fc487419d73f865916197b1`
did not reach restart because it exposed an earlier attachment-open product
failure. Restart hypotheses A-E remain pending until that user path is repaired
and the complete Gate reaches restart again.

Run `20260822T004237818803Z-2a73ae509e64f3f810528a4c06a0e8c0`
matched clean source, binary, and live Station `2eff7abe4`. It proved the
attachment image-load, count-conservation, real Native open, and byte-exact
assertions, then preserved the full restart boundary:

- `after-restart` and `after-enter-chat` show the target group row on the Chat
  surface;
- `after-group-click` and `restart-failure` show the account chooser with no
  Chat surface;
- the app log shows successful `auth_restore_session`, then the Gate's
  initial-launch path issues `auth_logout` and a fresh Harness login.

Hypothesis F is confirmed. The product's persisted session restored
successfully; the Gate invalidated it during restart and introduced a logout
navigation race. The repair separates initial fixture login from restart:
restart now waits read-only for the existing session's canonical PTID and
device identity and never invokes logout/login.
