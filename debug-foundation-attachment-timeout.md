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
| A | The upload command returns a non-rejection result, so no rejection event can satisfy the waiter. | High | Low | Pending |
| B | Station emits the rejection, but the harness filters on the wrong conversation, attachment, or event shape. | High | Low | Pending |
| C | The browser stream subscription starts after rejection and misses the event before replay or reconciliation. | Medium | Low | Pending |
| D | The prepared attachment is accepted or fails earlier because the fixture no longer violates the active model capability. | Medium | Medium | Pending |

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

## Instrumentation Plan
- `useAgentAttachmentDrafts.ts`: file-selection metadata, upload start,
  resolved result shape, and rejected error.
- `harness.ts`: synthetic input dispatch and ready-wait timeout DOM state.
- Instrumentation applied with `runId=pre-fix`; Desktop TypeScript checks and
  `git diff --check` pass.

## Verification Conclusion
Pending instrumentation evidence.
