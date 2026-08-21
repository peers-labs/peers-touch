# Debug Session: chat-reaction-recovery
- **Status**: [OPEN]
- **Issue**: The real Native reaction picker succeeds, but the fault-injected reaction path never exposes an actionable error state.
- **Debug Server**: http://127.0.0.1:7781/event
- **Log File**: `.dbg/trae-debug-log-chat-reaction-recovery.ndjson`

## Reproduction Steps
1. Run `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-product-closure`.
2. Complete the real Native thread, transcript, and toolbar geometry journey.
3. Open the visible reaction picker and select one emoji successfully.
4. Route the next reaction submit through the declared fault proxy.
5. Observe `timed out waiting for reaction actionable error`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|---|---|---|---|---|
| A | The fault proxy does not intercept the actual reaction submit endpoint | Medium | Low | Proxy evidence reports no matching failed request |
| B | The mutation reaches `error`, but the message row does not expose the expected error DOM state | High | Low | Store/render instrumentation reports error while the selector is absent |
| C | A realtime success projection clears the local error before the Gate can observe it | Medium | Low | Error transition is immediately followed by success/clear for the same request |
| D | The actionable error is rendered on a different message or surface than the Gate queries | Medium | Low | Error DOM exists with a different message ID or selector owner |
| E | The configured proxy receives reaction traffic on a path other than `/messaging/command/submit` | High | Low | Forwarded path counters identify the actual request path |
| F | `reactToMessage` rejects before the transport submit reaches the proxy | Medium | Low | Mutation instrumentation emits `catch-error` without `accepted` |
| G | `reactToMessage` resolves and the actionable error is produced only by the projection timeout | High | Low | `accepted` is followed by `timeout-error` after the bounded projection wait |
| H | The Station switch is not active when the reaction begins | Medium | Low | Proxy path counters contain only unrelated reconciliation traffic |
| I | Activating the proxy URL creates a distinct logical Station session without the token required by `active_engine` | High | Low | The sanitized Tauri error reports missing or unauthorized active-session state |
| J | Switching the logical Station immediately before the action races engine/profile reconfiguration | High | Low | Identical runs alternate between pre-submit rejection and controlled submit interception |

## Log Evidence
Initial failure:
`20260821T090516808440Z-1988cb9bf29221b33a8b5c464afc75a5`.

- `thread_exact=PASS`.
- `transcript_exact=PASS`.
- `toolbar_geometry=PASS`.
- `reaction_picker_success=PASS`.
- The first failure was `timed out waiting for reaction actionable error`.
- Cleanup evidence and direct `lsof` verification show ports
  `3330/3331/4445/4446` released.

Descendant-surface diagnostic run:
`20260821T091251080573Z-2132c9326a866483e5dd76458cebfcd3`.

- A confirmed: the armed proxy forwarded 112 requests but observed no
  `/messaging/command/submit`, request hash, command hash, or connection loss.
- B confirmed: every snapshot exposed one descendant with
  `data-message-reaction-state="error"`, emoji `🔥`, and one retry control,
  while the message-row root had no reaction-state attribute.
- C rejected: the same actionable descendant remained visible throughout the
  30-second Gate wait.
- D rejected: the descendant and retry control were inside the exact queried
  message row.
- The run remains `PARTIAL/UNPROVEN`; the visible error cannot be claimed as a
  controlled connection-loss result because the fault proxy did not intercept
  the submit.
- Cleanup evidence and direct `lsof` verification show ports
  `3330/3331/4445/4446` released.

## Verification Conclusion
| ID | Status | Evidence |
|---|---|---|
| A | Confirmed | Proxy evidence remained at zero matching submits and zero connection losses |
| B | Confirmed | The actionable error exists on a row descendant, not the row root |
| C | Rejected | The descendant remained in `error` for the complete wait |
| D | Rejected | The error and retry control belong to the expected message row |
| E | Rejected | Forwarded paths contain no alternate mutation submit endpoint |
| F | Confirmed | The failure reaction emitted `catch-error` without `accepted` |
| G | Rejected | No projection-timeout event occurred |
| H | Rejected | Background traffic proves the proxy Station switch was active |
| I | Rejected | A later run accepted the command and intercepted its exact submit bytes through the proxy |
| J | Confirmed | Identical runs alternated between pre-submit rejection and controlled submit interception after runtime Station switching |

The next instrumentation records forwarded proxy paths and the reaction
`begin`, `accepted`, `catch-error`, and `timeout-error` transitions. No selector
or fault-routing behavior changes until this evidence identifies the real
failure source.

Mutation-source diagnostic run:
`20260821T093354484080Z-7f080a8e2ca1c7ca4f44c3b9c7534a18`.

- The successful add/remove reactions emitted `begin -> accepted`.
- The failure reaction emitted `begin -> catch-error` in 33ms, with no
  `accepted` or `timeout-error`.
- The armed proxy received profile, conversation-list, device-enroll,
  queue-claim, notification, and telemetry traffic, but no mutation submit path.
- E is rejected: no alternate mutation endpoint crossed the proxy.
- F is confirmed: the command rejected before transport submit.
- G is rejected: the 8-second projection timeout did not produce the error.
- H is rejected: the Station switch was active and routed background traffic
  through the proxy.
- New hypothesis I: registering and activating the proxy URL creates a distinct
  logical Station session without the authenticated token required by
  `active_engine`, so the Tauri command rejects before Engine submission.
- The next diagnostic records the sanitized command error name/code/message.

Controlled-submit diagnostic run:
`20260821T094259738728Z-a0501f847173424298f431c78d2ad866`.

- The failure reaction emitted `begin -> accepted -> timeout-error`.
- The proxy observed `/messaging/command/prepare` and intercepted the exact same
  `/messaging/command/submit` command hash four times.
- The descendant moved from `awaiting-projection` to `error` with one retry
  control after the bounded 8-second projection timeout.
- I is rejected: the proxy URL can carry the authenticated Engine command.
- J is confirmed: switching the logical Station immediately before the action
  is nondeterministic; the previous run rejected before submit, while this run
  intercepted the controlled submit.
- The fix starts Alice through the disarmed transparent proxy before login,
  arms only for the failure action, requires exact controlled-loss evidence
  together with the descendant error, disarms before real Native retry, and
  includes the proxy port in reverse cleanup.

Pre-login proxy verification run:
`20260821T095103680817Z-18f2ee6459432d2a31730c02f465cb25`.

- Alice authenticated and completed the full pre-Reaction journey through the
  disarmed transparent proxy.
- The proxy intercepted three submits carrying one exact command hash.
- The mutation reached descendant `error` with one retry control after the
  bounded projection timeout.
- The real Native retry click ran after proxy disarm and converged on Alice and
  Bob; `reaction_failure_recovery=PASS`.
- Cleanup released actor ports and proxy port `58945`.
- The next first failure is a Gate evidence serialization error after
  `avatar_exact_loaded=PASS`; it does not invalidate Reaction recovery.

Clean source-bound verification:
`20260821T101103621394Z-083d69ddf9bbc5bdd1b97026df475f9d`.

- Source and Profile Three Station matched commit
  `04fe5680128ac008c350a264e5e9ac20c7000e1f`.
- `reaction_picker_success=PASS` and
  `reaction_failure_recovery=PASS`.
- Avatar and Station attribution also passed before the independent Mute
  projection failure.
- Actor and fault-proxy ports, including `65465`, were released.
