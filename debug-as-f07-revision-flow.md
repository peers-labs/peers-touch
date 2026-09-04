# Debug Session: as-f07-revision-flow
- **Status**: [OPEN]
- **Issue**: The first exact-source AS-F07 production scenario times out with
  `agent.acceptance.turnSubmissionTimeout` before emitting independently
  evaluated revision evidence.
- **Debug Server**: http://127.0.0.1:7783/event
- **Log File**: .dbg/trae-debug-log-as-f07-revision-flow.ndjson

## Reproduction Steps
1. Use worktree `peers-ai-agent`, branch
   `feat/p0-streaming-runtime-message-actions`, profile
   `chat-native-disposable`.
2. Deploy Station and build the Acceptance Desktop binary from the same clean
   source commit.
3. Run `agent-v2-kernel-foundation-e2e` with
   `PT_AGENT_V2_ALLOW_STATION_RESTART=1`.
4. Observe the first Browser AS-F07 tuple.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | The cancellable retry-source turn never emits a text event before its 120-second deadline | High | Low | The last checkpoint is `retry-source-started`, with no `retry-source-cancel-requested` |
| B | The retry-source cancellation is acknowledged but its stream never emits terminal cancellation | Medium | Low | Cancellation response is recorded, but `retry-source-finished` is absent |
| C | The completed baseline turn exceeds the generic 120-second turn deadline | Medium | Low | Retry completes and the last checkpoint is `baseline-started` |
| D | A synchronous retry/regenerate/edit command blocks while executing its provider turn | Medium | Low | The last checkpoint is immediately before one revision command |
| E | Branch selection or receiver projection blocks after all revision commands complete | Low | Low | Edit completes and the last checkpoint is branch-selection or DOM wait |
| F | A registered identity-pipeline handler does not settle during Native cleanup logout | High | Low | `cleanup-logout-started` appears without `cleanup-identity-pipeline-finished` |
| G | `realtimeStreamStop` does not settle after the identity pipeline clears local state | Medium | Low | Identity pipeline finishes but `cleanup-realtime-stop-finished` is absent |
| H | `authLogout` does not settle after realtime shutdown | Medium | Low | Realtime stop finishes but `cleanup-auth-logout-finished` is absent |
| I | The Harness wait for unauthenticated state does not settle | Low | Low | Store logout finishes but `cleanup-logout-finished` is absent |
| J | The AS-F07 fixture setup does not leave an enabled binding | Medium | Low | `isolation-preflight` reports zero enabled bindings |
| K | Station classifies the enabled fixture as non-READY | Medium | Low | `isolation-preflight` reports a non-READY state and reason code |
| L | Protobuf JSON returns a string enum while the Harness compares it with a numeric generated enum | High | Low | `isolation-preflight` reports `stateType=string`, `state=CAPABILITY_READINESS_STATE_READY`, and `readyCapabilityCount=0` |
| M | The Harness bridge updates Selenium's deprecated class-level transport timeout instead of the active driver's instance config | High | Low | Browser AS-F07 outlives the HTTP read timeout while later Debug Server checkpoints prove the in-page scenario remained active |
| N | AS-F07's 300-second WebDriver script budget cannot contain its bounded sequence of retry, baseline, regenerate, and edit provider operations | High | Low | The active driver reaches an exact script timeout before the current revision operation returns |
| O | The retry source retains an obsolete long-output prompt after cancellation moved to provider admission, making the real retry path provider-latency dependent | High | Low | Cancellation occurs at `provider_call_started`, then retry of the same 100-item prompt exhausts the 300-second Turn budget |
| P | The edit response and Station readback disagree on the edited user/assistant lineage | High | Low | `revision-assertion-inputs.edit` identifies the first mismatching message, parent, replacement, branch, or active-head field |
| Q | A root user message represents its absent parent differently before and after the edit | Medium | Low | Source and edited parent IDs differ only by absent-value normalization |
| R | The original Turn diagnostic replay changes after sibling revisions even though immutable usage, feedback, attempts, and messages do not | High | Low | Message, feedback, and attempt facts remain equal while only the whole diagnostic hash changes |
| S | The provider reaches a terminal success before the cancellation transaction commits | Medium | Low | Cancellation response status is `completed` and no cancelled stream terminal is observed |
| T | The Desktop cancellation response omits or reshapes the Station `status` field | Medium | Low | Response fields omit `status`, or its runtime type is not `string` |
| U | The Station returns a non-canonical cancellation status spelling | Low | Low | Response status is present but differs from `cancelled` |

## Instrumentation
- Record one redacted stage checkpoint before and after each AS-F07 production
  action.
- Record only stage name, elapsed time, terminal event type, sequence, and
  presence/count facts. Do not record content, actor identity, credentials, or
  tokens.

## Log Evidence
- Exact-source run
  `20260830T085407159167Z-7d59eb27f0e0e3b9a727cdbc9fa93c95`
  reached Browser AS-F07 after all AS-F06 tuples passed, then failed with
  `agent.acceptance.turnSubmissionTimeout`.
- The failure did not identify which of the two observed turns timed out.
- Exact-source run
  `20260830T092128791528Z-9a9c827e6d32f6b854cb103f7e29d6d8`
  used clean source, deployed Station, and Desktop commit
  `4fc6bcd5645c6c3a8587f822e4ea8a0fbf6ba4b7`.
- `.dbg/trae-debug-log-as-f07-revision-flow.ndjson` lines 1-3 show that
  Browser AS-F07 started, requested cancellation after the first text event
  at 2361 ms / sequence 3, and observed a `cancelled` terminal event at
  3092 ms.
- The immutable Gate log then failed at `agent_retry_turn failed`; no
  `retry-finished` checkpoint was emitted.
- Exact-source rerun
  `20260830T105006501570Z-9ea71a2d66bc221db156d1ea3dc3c69d`
  passed AS-F05 and AS-F06, entered Browser AS-F07, and emitted only
  `scenario-started` before `agent.acceptance.turnSubmissionTimeout`.
  No `retry-source-cancel-requested` event was emitted.
- Exact-source run
  `20260830T111643174494Z-96ed0bfa4a8c8fb9f72039d48a16aff7`
  cancelled at durable `provider_call_started` sequence 2 in 3207 ms and
  observed terminal `cancelled` in 3421 ms. Retry started with conversation
  version 4 and one terminal attempt (`status=13`), then returned
  `RustCommandException / INTERNAL_ERROR` in 113 ms. Station logs show the
  retry transaction completed and `turn started` was emitted before the HTTP
  handler returned 500.
- Exact-source run
  `20260830T114748280303Z-4519f9380180cb5ed5ba6536ddcf714c`
  reproduced the same cancellation and 113 ms retry failure. The Station error
  body was generic and contained no typed code/message.
- `ExecuteTurn` registers ownership before `createOrReopenTurnRecord`. Retry
  supplies only `ExistingTurnID`, so the current implementation generates and
  registers a different `TurnID`, then replaces it with the existing Turn ID.
  The first `emitTurnEvent` consequently fails the ownership fence as
  superseded. The existing early-retry test supplied both IDs and masked this
  production shape.
- Checkpoint `a05900a5caa699a7b1c7a33dee3959c386925d45`
  resolved execution ownership from the admitted Turn ID. Exact-source run
  `20260830T122020868414Z-9839533f2d4beeafe189649535e82bd3`
  removed the prior 113 ms HTTP 500: Station accepted the retry, reused
  `turn_47afbf8dcf8d18d4f93fe64d`, entered the provider path, and returned HTTP
  200 after 34.338 seconds. The Desktop command failed after approximately
  15 seconds with transport status `0`, before the Station response arrived.
  Cleanup passed and AS-F07 remained the first failing tuple.

## Verification Conclusion
- Hypothesis A is confirmed as nondeterministic: one run emitted cancellable
  text in 2361 ms, while the next source-matched run emitted no text within
  120 seconds.
- Hypothesis B is rejected: cancellation reached a terminal `cancelled` event.
- Hypothesis C is not reached.
- Hypothesis D is confirmed at the first retry command, but its owning
  Station/transport error is not yet identified.
- Hypothesis E is not reached.
- The fixture must not use external provider first-token latency as the
  cancellation boundary. The next implementation cancels on the durable
  `provider_call_started` progress event, which is emitted after source user
  message persistence, while preserving the real provider, cancellation, and
  retry paths. Typed retry error instrumentation remains active.
- The cancellation-boundary correction is runtime-confirmed. Hypothesis D is
  now narrowed to the early retry execution path after atomic admission and
  before provider invocation. The next instrumentation extracts only the
  typed Station error code/message from the existing HTTP error body.
- Hypothesis D is confirmed: retry execution ownership is registered against
  the wrong Turn ID. The fix must bind ownership to the precreated/existing
  admission ID before execution starts; instrumentation remains for post-fix
  comparison.
- The post-fix run confirms the ownership correction and refines Hypothesis D:
  retry execution completes successfully on Station, but the synchronous
  revision request exceeds Desktop's generic 15-second JSON transport timeout.
  The next investigation must decide from the accepted revision contract
  whether revision commands return a durable admission acknowledgement or use
  a long-running Turn-specific transport timeout.
- Source-backed timing identified a second Station defect: the original
  execution used the pinned `128000` context window, while retry used `0`,
  forced compression for only 190 estimated tokens, spent about 29 seconds
  generating an unnecessary summary, and split the conversation before the
  final provider call. The local fix now restores the context limit from the
  persisted reconciled runtime snapshot and rejects invalid limits.
- Reconcile Gate A retained the existing synchronous Proto response contract.
  Desktop now routes retry/regenerate/edit through a bounded Turn-execution
  transport policy and moves native blocking work off the Tauri main thread.
  Branch/tombstone remain short interactive requests. Post-fix runtime
  comparison is pending.
- Exact-source run
  `20260830T154703060073Z-5ec0d1b6ce4880d6a1e73af571e369d5`
  on `30c0fdb99ec8ad166985366fb4aa223867c3bb74` passed the prior
  Browser AS-F04 failure and reached Browser AS-F07, where
  `agent_retry_turn failed`. The Debug Server had exited during the long
  Foundation run, so `.dbg/trae-debug-log-as-f07-revision-flow.ndjson`
  remained empty and this run cannot distinguish a Station response,
  Turn-execution transport timeout, or native command failure. The same
  exact-source run must be repeated with the Debug Server retained.
- Exact-source run
  `20260830T162124124250Z-d80b623b486ff157036d4f6beafbf873`
  on `06eeb9dce5a2f92507dd7eeee503a01fb78da5d4` retained the
  Debug Server and reproduced the Browser failure. Debug lines 1-5 show
  cancellation requested at provider admission, terminal `cancelled` at
  1979.9 ms, retry start from conversation version `4`, and HTTP
  `409 CONFLICT` at 2295.5 ms.
- Station logs show `/turn/retry` returned 409 in 4 ms. Database readback shows
  the source Turn and attempt were `cancelled`, the conversation version
  remained `4`, no revision command was inserted, and the latest assistant
  message for that Turn was `completed` because the provider tool-call message
  had already been persisted.
- Hypothesis D is refined and confirmed: transport and execution ownership are
  no longer failing. `RevisionService` rejects the authoritative cancelled Turn
  because it incorrectly applies retry eligibility to the immutable completed
  tool-call assistant artifact.
- The local fix preserves the completed tool-call message, creates a distinct
  pending assistant projection for the new attempt under the existing branch,
  and keeps provider context rooted at the source user message. Post-fix
  runtime comparison is pending.
- Exact-source run
  `20260830T170657748668Z-0a16fea71d2a39b75506d46374c2d4d4`
  on `3803fd4423173f06c06a5e080185854a5a82d06e` confirms the
  retry fix. Debug lines 1-5 show source cancellation at 3352.7 ms and retry
  completion at 7042.4 ms, with attempt count increasing from one to two.
- The next AS-F07 baseline Turn did not finish before the 120-second deadline.
  Station events show a real `skills_list` ToolCall, manual approval request,
  and `waiting_local_tool`; teardown then cancelled the Turn. This is an
  Acceptance scenario isolation defect, not a retry transport or Station
  revision failure.
- The local follow-up runs the entire AS-F07 revision scenario inside the
  existing fail-closed capability-disable/restore boundary used by other
  Foundation scenarios. This removes unrelated ToolCalls without prompt
  steering, mocks, or automatic approval. Runtime verification is pending.
- Exact-source run
  `20260830T191447672147Z-34c5f98bcd80d1d669fb91c6d9fbc571`
  on `9b8914432c56399a6d9b9b8bafe08b24c1dde312` provisioned
  matching Station and Desktop runtimes but failed before AS-F07 produced a
  candidate. The inner scenario run recorded
  `CLEANUP_FAILED: runtime release failed; primary=FoundationCandidateError`.
  Native logout exceeded its 30-second WebDriver script budget, while Browser
  cleanup, all six runtime ports, both storage roots, and actor identity
  cleanup completed. The outer run's `cleanupStatus=passed` describes only
  provisioner cleanup and does not override the inner failed cleanup sidecar.
  AS-F07 instrumentation remained empty, so F-I require stage-level logout
  instrumentation before any behavior change.
- Instrumented exact-source run
  `20260830T193203658069Z-418da7749a9af6320a312537a45aed04`
  on `3c5366986afcbc3bbd41a3d27bb3d174f02c18cd` reproduced the
  same Native logout timeout. Both Browser and Native traces show every
  identity handler finishing, followed by `realtimeStreamStop` and
  `authLogout`, all within one second. The Harness call nevertheless exceeded
  30 seconds, leaving its only remaining wait on `session.authenticated`.
  Hypotheses F, G, and H are rejected; I is confirmed. The source race is that
  `clear-zustand-stores` drops `session.authenticated` while
  `identityRuntime` still reports `ready`, so `useAppLifecycle` may restore the
  still-live Rust session before `authLogout` finishes. The fix must dispatch
  `LOGOUT_REQUESTED` through the identity owner before running the existing
  session logout pipeline, then enter the auth gate.
- Post-fix exact-source run
  `20260830T201952431343Z-613a60e8abe65c11f8ee17d13db918fb`
  on `128c044049aadb37d364f2d25e9f593a2780d6b7` closes
  hypothesis I. Both clients emitted
  `cleanup-identity-runtime-logout-finished` with
  `authenticated=false` followed by `cleanup-harness-logout-finished`.
  The inner cleanup sidecar is fully clean for both clients, all ports,
  storage roots, and actor identity.
- The newly visible first failure is Browser AS-F03
  `agent.acceptance.foundationCapabilityIsolationUnavailable`. The strict
  positive-READY prerequisite introduced for AS-F07 was incorrectly applied
  to the shared AS-F03/F06 isolation helper. AS-F03 permits a real zero-READY
  starting state and proves that readiness and tool-definition tokens remain
  zero. The local correction scopes positive effective capability proof to
  AS-F07, permits non-negative journal readiness for recovery, and skips
  journal creation entirely when there are no enabled bindings to mutate.
- Authorized exact-source run
  `20260830T205732579819Z-f21c5d46213c2c92b7d03592bdbd9186`
  on `2dc3dd22b81b30dc0cefe6003e0f020cb1274d1e` passed the AS-F03
  prefix and all AS-F06 tuples after restoring the required Station restart
  authorization. It reached Browser AS-F07 and failed first with
  `agent.acceptance.foundationCapabilityIsolationUnavailable`. The immutable
  manifest records matching source, Station, and workspace identity,
  `cleanupStatus=passed`, redaction passed, and `proofStatus=UNPROVEN`.
  This rejects AS-F03 zero-READY compatibility and AS-F06 restart handling as
  the current owner; AS-F07 requires a deterministic real positive-capability
  fixture before entering the strict isolation boundary.
- Checkpoint `05f59f4d2` deployed to `station-two`, but the independent health
  check failed before a post-fix Gate could start. Remote PostgreSQL repeatedly
  aborts its recovery checkpoint with `No space left on device` while writing
  `pg_logical/replorigin_checkpoint.tmp`. The remote root filesystem has zero
  available blocks; `/var/lib/docker` accounts for 101 GiB and the active Relay
  container JSON log alone accounts for approximately 10.3 GiB. This is an
  environment blocker, not AS-F07 post-fix evidence. Debug instrumentation,
  server, and retained logs remain active.
- Exact-source run
  `20260831T010242155595Z-5cfa82b94fcf878b7c737305cf35ca10`
  on `58ba31f526c6cf0d0b746429c6ceaf666f0b91dc` failed first at
  Browser AS-F01 `agent.acceptance.foundationTurnTimeout`. Station completed
  one provider Turn in 1.96 seconds; the next provider request returned HTTP
  200 with zero tokens but no terminal Turn event. Cleanup, source identity,
  redaction, and deployment health passed, so one unchanged-source rerun was
  required before assigning code ownership.
- Unchanged-source run
  `20260831T010906030175Z-a64195abef171d12db40216420212e6d`
  passed the AS-F01 transient and all AS-F06 tuples, then reproduced Browser
  AS-F07 `agent.acceptance.foundationCapabilityIsolationUnavailable`.
  PostgreSQL readback on deployment node `station-two` shows the exact
  `tool:skills_list` binding enabled at Agent version 142 and the three
  surrounding readiness snapshots classified it as
  `CAPABILITY_READINESS_STATE_READY`. Hypotheses J-L now distinguish binding
  loss, Station readiness rejection, and Desktop protobuf-JSON enum
  normalization before any behavior correction.
- Diagnostic run
  `20260831T013305917274Z-cdf29a553e5fe2cd9f65a010ea5b7480`
  on `fdee74dea8ebb952e5c783be20ad33e9aa65ec11` again reached Browser
  AS-F07 and failed with
  `agent.acceptance.foundationCapabilityIsolationUnavailable`; exact source,
  redaction, and cleanup passed. The new preflight event was not persisted
  because the reporter was fire-and-forget and the precondition threw
  immediately afterward. The instrumentation now awaits only that preflight
  report before evaluating the unchanged assertion.
- Awaited-evidence run
  `20260831T015223794507Z-17e34707800877c7574cec66cf7885d1`
  on `a06bf96dc7369603219a2f560fbfd163f5055974` confirms hypothesis L:
  `isolation-preflight` recorded one enabled binding and Station readiness
  `state=CAPABILITY_READINESS_STATE_READY` with `stateType=string`, while the
  Harness computed `readyCapabilityCount=0`. Hypotheses J and K are rejected.
  The Desktop API's legacy protobuf-JSON projection typed enum values as the
  generated numeric enum, and four Foundation checks compared the runtime
  string with numeric `READY`. The local fix gives that JSON field its exact
  string-enum type and routes all four checks through one exact predicate.
  Instrumentation remains active for post-fix comparison.
- Exact-source run
  `20260831T052152649161Z-db7b6ded7811e787291df17ac9933b5b`
  on `8848e36d4bfc06c3f31f589f4bbe8704beaae395` confirms the
  readiness correction: `isolation-preflight` records one enabled binding and
  `readyCapabilityCount=1`. AS-F07 then completes retry, baseline,
  regeneration, edit/stale-conflict, and branch projection in the page by
  255.228 seconds. The Browser adapter nevertheless fails at 133.353 seconds
  with an HTTP read timeout. This confirms hypothesis M: the Harness bridge
  calls Selenium's deprecated class-level `RemoteConnection.set_timeout`,
  which can update another driver's config after Native/Browser restarts,
  instead of the active command executor's `_client_config.timeout`.
  Source identity, redaction, and cleanup passed.
- A two-connection Selenium reproduction confirms the ownership defect:
  calling `first.set_timeout(305)` leaves the first connection at `120`
  seconds and mutates the second connection to `305` seconds. The local
  correction writes the bounded timeout directly to the active command
  executor's `_client_config.timeout`, retaining the deprecated setter only
  for executors without an instance config. Focused Harness and Foundation
  tests plus Acceptance Infra self-validation pass; exact-source runtime
  comparison is pending.
- Exact-source run
  `20260831T055806279596Z-f13e9ec5abc9b4969e179ffebe3aa12f`
  on `618b715f0730753995bee9a8131a2cb92a2ec639` rejects a remaining
  transport-config mismatch: the Browser adapter now stays attached for the
  full declared 300-second script budget. It then fails with Chrome's typed
  `script timeout`, not an HTTP read timeout. The last AS-F07 checkpoint is
  `retry-started` at 5.764 seconds, followed by cleanup at the 300-second
  boundary. This confirms hypothesis N. The concrete AS-F07 scenario contains
  multiple independently bounded provider-backed revision commands, so its
  aggregate WebDriver budget now matches the existing 900-second AS-F04
  multi-command budget. Exact-source runtime verification is pending.
- Exact-source run
  `20260831T063340123688Z-447dcc791dcad419fade0929bd57889f`
  on `f1060608821b06b48c7773858d55c8cbb141900e` confirms hypothesis
  N's timeout correction: the Harness remains attached beyond 300 seconds and
  returns the owning typed `agent_retry_turn failed` result instead of a
  WebDriver timeout. Debug evidence records `retry-started` at 3.828 seconds
  and the production Turn timeout at 303.996 seconds. This confirms hypothesis
  O. The 100-item prompt is obsolete because cancellation now occurs at the
  durable `provider_call_started` event before response generation. The local
  fixture correction uses a short response prompt, preserving real admission,
  cancellation, retry, and Station lineage while removing unrelated
  long-output latency. Exact-source runtime verification is pending.
- Exact-source run
  `20260831T074027598526Z-c5e380bfc18629a3411a163af9a72f7a`
  on `cfaba07dd64eeca3105a6286c7042857c911c883` completed the full
  Browser AS-F07 production sequence and confirmed hypotheses P-R. PostgreSQL
  readback on deployment node `station-two` contains the correct edited
  assistant parent, but the Station conversation JSON handler omits
  `parent_message_id`; the evidence producer also compares root-parent `null`
  with normalized empty string. Original message, feedback, and attempt counts
  remain stable; only the hash of the diagnostics response changes because its
  nested replay carries a fresh `generated_at`. The local corrections expose
  persisted parent lineage, normalize the optional root parent, and hash the
  immutable attempt/usage facts instead of the generated diagnostics envelope.
  Exact-source runtime verification is pending.
- Exact-source run
  `20260831T070443015488Z-de318ef7a65994457f2279f4e0f7ac9c`
  on `ac98a06faf5ffd7e721a79f0309d0b9f23da1183` proves the bounded
  retry fixture: retry completed in 20.283 seconds and the full AS-F07
  production path completed in 218.298 seconds. The independent oracle then
  failed `editCreatedSibling` and `originalImmutable`. Hypotheses P-R add one
  redacted assertion-input checkpoint to distinguish a real Station lineage
  mutation from an evidence-normalization defect before any behavior change.
  Source identity, redaction, and cleanup passed.
- Exact-source run
  `20260904T203015364850Z-7ea6de81d43dab92e5680877c894ac1e`
  on `6858918203ac0d115669b2bc93e9a42d187e053c` advanced through
  the repaired `BASE-APPROVAL-DENIED` tuple and failed first at Browser AS-F07
  with `agent.acceptance.foundationRevisionRetrySourceNotCancelled`.
  The existing AS-F07 trace recorded `scenario-started` and
  `retry-source-cancel-requested` at durable sequence 2 after 1451 ms, then
  entered cleanup without `retry-source-finished`. This places the failure
  after the cancellation response returned and before retry admission.
- Port `7777` is owned by a Debug Server whose working directory is another
  worktree. The dedicated AS-F07 collector now listens on
  `127.0.0.1:7783`, and the reporter targets that port. One awaited,
  redacted checkpoint records normalized cancellation status, raw status type,
  and response field names before the unchanged fail-closed assertion.
  No product or Gate behavior has changed.
