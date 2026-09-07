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
- Exact-source post-parity deployment and runtime evidence remain pending.
