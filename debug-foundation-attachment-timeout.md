# Debug Session: foundation-attachment-timeout
- **Status**: [OPEN]
- **Issue**: Browser `BASE-ATTACHMENT_REJECTED` times out waiting for the rejected attachment upload after canonical matrix dispatch succeeds.
- **Debug Server**: http://127.0.0.1:7787/event
- **Log File**: `.dbg/trae-debug-log-foundation-attachment-timeout.ndjson`

## Reproduction Steps
1. Use exact source commit `f4c264c5b5e96a0aee840ea72021e1c949868729`.
2. Activate the approved `chat-native-disposable` profile.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable and restart flags.
4. Observe Browser English `BASE-ATTACHMENT_REJECTED`.
5. Current result: timeout waiting for `rejected attachment upload`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The upload command rejects before a Turn can be submitted. | High | Low | Confirmed: `RustCommandException` with `agent.errors.attachmentRejected`. |
| B | Station emits the rejection, but the harness filters the event incorrectly. | High | Low | Rejected: event subscription occurs only after the failed upload-ready wait. |
| C | The browser subscribes too late and misses the rejection event. | Medium | Low | Rejected: Send is never reached. |
| D | The fake PDF is rejected by an earlier validation boundary. | Medium | Medium | Confirmed: Desktop Rust enforces the PDF signature before OSS upload. |
| E | The authenticated delete command fails before creating a tombstone. | Medium | Low | Rejected: Browser gateway recorded `oss_delete_file` with `resultOk=true`. |
| F | Browser command parity omits owner-side file listing, so tombstone readback never reaches Station. | High | Low | Confirmed: Browser gateway recorded `oss_list_my_files` with `resultOk=false`, and the gateway dispatch table has no matching command branch. |
| G | Owner-side listing succeeds but omits the deleted object. | Medium | Low | Not reached: the command failed at the Browser gateway before returning a listing. |
| H | The evidence payload exposes a secret-bearing field name even though its value is hashed. | High | Low | Confirmed: the candidate rejected `cleanup.proof.deletionReadback.keyHash` after the complete scenario returned. |

## Log Evidence
- Pre-fix Gate run: `20260907T020559327723Z-5246e94c2d4cef5c9e0718aecae554ae`.
- Failure: `timed out waiting for: rejected attachment upload`.
- Existing gateway instrumentation shows `oss_upload_agent_attachment_bytes`
  was dispatched and returned `ok=false` before the harness observed a ready
  draft.
- First focused reproduction launched only the Browser client and stopped
  before the target scenario because no capability session was registered.
  Cleanup was clean; the next reproduction retains the required two-client
  bootstrap and executes only the Browser attachment cell.
- The instrumented full Gate correctly returned `BLOCKED/UNPROVEN` before
  provisioning because exact-source proof rejects a dirty candidate worktree.
  Instrumentation must therefore be checkpointed and deployed before the
  diagnostic Gate can execute.
- Exact-source instrumentation run
  `20260907T025814477916Z-561c6b1f04cf5cc33d898714f11ddefe`
  captured one 23-byte `application/pdf`, then
  `upload-rejected(errorName=RustCommandException,
  errorMessage=agent.errors.attachmentRejected)`. The retained draft was
  `failed` with no object reference. Provisioner cleanup completed
  `DONE / PROVEN / passed`.
- The first exact-source post-fix run
  `20260907T042006102971Z-c1553f21eb781688558bada7dffcb589`
  stopped earlier at Browser AS-F06 replay parity. A single unchanged rerun was
  justified because predecessor source had crossed AS-F06 and the candidate
  changed only the later attachment scenario.
- Exact-source rerun
  `20260907T043756969291Z-0b7ec3f7772fd0dc867abc34f64094d2`
  crossed AS-F06 and reached Browser English `BASE-ATTACHMENT_REJECTED`.
  Instrumentation captured a valid 46-byte PDF, successful upload, and a ready
  draft with attachment/object identities. Gateway evidence then recorded
  successful `oss_delete_file` followed by failed `oss_list_my_files` on both
  the primary and cleanup paths. Provisioner cleanup completed
  `DONE / PROVEN / passed`.
- Checkpoint `504c543b8186f3033654750d5070bd6abfdda306` restored Browser
  `oss_list_my_files` parity. Exact-source run
  `20260907T053637546032Z-3ba1d711d87edb0c2290589af51c5f88`
  then completed upload, delete, first-attempt owner-list tombstone readback,
  the Station rejection path, and post-rejection tombstone readback. Candidate
  validation rejected only the field name
  `cleanup.proof.deletionReadback.keyHash` as secret-bearing. Provisioner
  cleanup completed `DONE / PROVEN / passed`.

## Instrumentation Plan
- `useAgentAttachmentDrafts.ts`: file-selection metadata, upload start,
  resolved result shape, and rejected error.
- `harness.ts`: synthetic input dispatch and ready-wait timeout DOM state.
- Exact-source pre-fix evidence was captured with `runId=pre-fix`.
- Instrumentation remains active with `runId=post-fix` for the unchanged Gate
  rerun; it must not be removed before the user confirmation gate.
- The next checkpoint also records successful delete metadata and authenticated
  tombstone readback without exposing object references.

## Verification Conclusion
The fake PDF is rejected by Desktop Rust before upload, so the scenario never
submits a Turn and cannot observe a Station rejection.

## Fix
- Upload valid PDF bytes through the real composer.
- Tombstone the returned actor-owned OSS object before Send.
- Keep the ready draft mounted and click the real Send action.
- Require Station `CONTEXT_ATTACHMENT_REJECTED` with exact reason
  `attachment_object_is_unavailable`.
- Preserve localized receiver, draft retention, removal, zero-side-effect,
  replay, and deletion-readback assertions.
- Local verification passes: Desktop TypeScript check, all `573` Desktop tests
  with one unrelated environment-dependent skip, `164/164` focused
  Foundation/static tests, and `git diff --check`.
- Browser HTTP gateway parity now needs the existing `oss_list_my_files`
  application command wired into its dispatch table. Station remains the
  tombstone source of truth; the fixture must not infer deletion from the
  successful delete response alone.
- The local parity correction passes Desktop TypeScript check, all `573`
  Desktop tests with one unrelated environment-dependent skip, the complete
  HTTP-gateway Rust module (`6` passed, `1` intentionally ignored), `145/145`
  focused Foundation/oracle tests, Rust formatting, and `git diff --check`.
- The hashed bare-object locator field is renamed from `keyHash` to
  `objectPathHash`; its value and the independent SHA-256 assertion are
  unchanged.
- The dedicated evidence-safety regression and `145/145` focused
  Foundation/oracle tests pass. A broader candidate-producer invocation
  retains its two known unrelated `receiver-dom` fixture/profile errors.
- Exact-source post-evidence-field deployment and runtime evidence remain
  pending.

## 2026-09-10 Browser AS-F05 Turn Timeout

### Reproduction

- Exact source: `52cc444b6d1f980c7e4b1c18b5cf01a65c02ded5`.
- C08 run `20260910T055522829091Z-9681f326699ee03f46adacc14c119f39`
  passed all 19 assertions with clean resource release.
- Foundation run
  `20260910T055707604178Z-af431ffdcb8a1a040ddc0687391de851`
  reached `FIXTURE_READY`, then failed at Browser `AS-F05 / en /
  sample-001` with `agent.acceptance.turnSubmissionTimeout`.
- Provisioner cleanup completed `DONE / PROVEN / passed`.

### Hypotheses

| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| I | Browser retained a cut or stale fault-proxy state from a preceding scenario. | High | Low | Submission starts while proxy or browser transport reports unavailable/reconnecting. |
| J | Station reaches a terminal Turn, but Browser misses or filters its terminal SSE event. | High | Medium | Station readback is terminal while observed event list lacks the matching terminal sequence. |
| K | Provider execution itself remains active beyond the fixed 120-second Turn bound. | Medium | Low | Station readback remains non-terminal with provider attempt still active at timeout. |
| L | Shared Native/Browser capability-session state is stale after the preceding matrix rows. | Medium | Medium | Submitted Turn references a session/revision that no longer matches current readiness. |
| M | Another Acceptance process contends for a local port or shared runtime resource. | Low | Low | Runtime metadata or process table shows conflicting listener/profile ownership. |

### Current Evidence

- Historical `foundation-attachment-timeout` post-fix entries show upload,
  tombstone readback, Station rejection, and cleanup succeeding; they do not
  contain this AS-F05 positive Turn submission.
- The failed Foundation run produced no candidate manifest, so its outer
  result cannot distinguish Station/provider progress from Browser event loss.
- No product assertion, timeout, tuple, or retry policy may change during
  diagnosis.
- Exact-source instrumentation run
  `20260910T072607175644Z-c90314dd22ec5c31a74c08cfb37c5cc8`
  reproduced Browser `AS-F05 / en / single / sample-001`. The Turn was
  admitted and yielded four `progress` events followed by 1,074 ordered
  `thinking` events (`seq=5..1078`) across 120 seconds, with no answer or
  terminal event. The Turn ID and configured capability session were present,
  and provisioner cleanup passed.
- Hypotheses I, J, L, and M are rejected for this failure. Hypothesis K is
  confirmed: the provider-backed Turn remained in a thinking-only stream until
  the existing client bound expired.
- The attachment scenario does not assert thinking behavior. The evidence-backed
  fix is to submit this focused Turn with the existing production contract
  `thinkingMode: disabled`, retaining the same provider, model, attachment
  inputs, timeout, evidence roles, and product assertions.

## 2026-09-12 C08 Capability-Isolation Regression

### Reproduction

- Exact source: `8e88a63b26e82af0f17fd1f40ad2e31e3228e7ab`.
- C08 run:
  `20260911T163226025417Z-a4b0aae2aa8f3bbbcce3bb7b4b622f5e`.
- The first Desktop `AS-F05` positive attachment Turn failed after the existing
  120-second bound with `agent.acceptance.turnSubmissionTimeout`.
- Source identity, Station attestation, Provisioner cleanup, and secret scanning
  passed.

### Evidence

- Desktop submitted the real Turn with the canonical Ark provider/model, two
  uploaded attachments, the selected capability session, and
  `thinking_mode=disabled`.
- The Turn emitted four `progress` events, then `tool_call` at sequence 5,
  `tool_approval_required` at sequence 6, `progress` at sequence 7,
  `connection_lost`, and a replay `snapshot`.
- The provider therefore completed far enough to request a governed Tool. The
  timeout was not caused by missing dispatch, Ark connection establishment, or
  a thinking-only stream.
- The preceding exact-source C08 run
  `20260911T154347342462Z-2fcba4ec93404d8b5091120bc7d72792`
  passed the same `attachment_admission` step in 19.573 seconds, showing that
  provider choice between text and ToolCall made the existing fixture
  nondeterministic.
- Source inspection shows `runFoundationF05Scenario` disables only one
  platform-selected binding (`local_clipboard_read` for Desktop or
  `skills_list` for Browser). Other active Agent capability bindings remain
  eligible for provider ToolCall selection.
- The repository already provides `withFoundationCapabilitiesDisabled`, which
  journals, disables, verifies, and restores every active binding for a
  provider-backed scenario.

### Verification Conclusion

- Request-not-dispatched and provider-stall hypotheses are rejected.
- Terminal projection loss is secondary: the Turn correctly remained
  `waiting_approval` after the unexpected ToolCall and therefore had no
  successful terminal to project.
- The confirmed root cause is incomplete Acceptance Fixture isolation in
  `runFoundationF05Scenario`.
- The owner-layer correction is to run the positive AS-F05 attachment Turn
  inside `withFoundationCapabilitiesDisabled` and remove its single-binding
  mutation path. Product ToolCall behavior, provider configuration, timeouts,
  matrix rows, and assertions remain unchanged.

## 2026-09-13 Rejected Attachment Removal Visibility

### Reproduction

- Exact source:
  `2daee9556a68974c4a3cec688a31f366f3db975c`.
- C08 run:
  `20260913T074523829296Z-d20e989bf3f387f7324b708643290a0a`.
- The eleven primary AS-F05 assertions and every setup step passed, including
  upload, tombstone readback, typed Station rejection, rejected draft, and
  localized error surface.
- The independent `BASE-ATTACHMENT_REJECTED` oracle failed only
  `localizedRemovalVisible`. Gate-process and Provisioner cleanup passed.

### Hypotheses

| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| I | The remove action exists but its rendered box is temporarily zero when sampled. | High | Low | Connected button with matching label and zero client rects/size. |
| J | The remove action is visible but its accessible label differs from the active locale expectation. | Medium | Low | Positive geometry with unequal label and expected text. |
| K | The rejected draft is present but hidden by parent style or detached between waits. | Medium | Low | Rejected draft has zero geometry or disconnected child. |
| L | Multiple attachment drafts exist and the global selector samples a stale hidden draft. | Medium | Low | More than one rejected/remove element with mixed visibility. |

The next exact-source run records sanitized draft/button geometry, connection,
computed visibility, locale, selector counts, and label equality immediately
before the production remove click. No behavior, timeout, Gate assertion, or
cleanup rule changes during this diagnostic iteration.

### Receiver Snapshot Timing

- Exact-source run
  `20260913T094836502489Z-a682e895d24041cc009f8ac56ce520c5`
  on `7d72baab4f4e8987a796a73a9805b614733e00fd` again failed only
  `localizedRemovalVisible`; all eleven AS-F05 assertions and Provisioner
  cleanup passed.
- Immediately before the real Remove click, the rejected draft and remove
  action were unique, connected, visible, and measured `260x60` and `24x24`.
  The remove label was non-empty and exactly matched the English locale; the
  selected attachment identity also matched.
- After the click, both saved draft/button nodes were disconnected, the target
  attachment was absent, and owner-side deletion readback remained complete.
- Source inspection identifies the producer mismatch: removal visibility/text
  are captured before the click, but error visibility/text are read later from
  a saved DOM node after the removal-driven render. The assertion requires
  both surfaces at the pre-action receiver boundary.

The correction freezes localized error visibility/text and removal
visibility/text together before executing Remove, then separately verifies the
post-action draft/object deletion. It does not change UI behavior, copy,
selectors, timeout, Gate assertions, or cleanup.

Local verification passes Desktop strict check, Desktop `622/622` with one
existing environment-only skip, Agent Acceptance `419/419`, Python compilation,
and diff hygiene. Exact-source C08 proof remains pending.
