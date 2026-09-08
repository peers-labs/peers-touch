# Debug Session: base-duplicate-conflict
- **Status**: [OPEN]
- **Issue**: Exact-source Browser `BASE-DUPLICATE_CONFLICT` rejects
  `originalCommandPreserved` after the cancellation fix advances the Gate.
- **Debug Server**: http://127.0.0.1:7790/event
- **Log File**: `.dbg/trae-debug-log-base-duplicate-conflict.ndjson`

## Reproduction Steps
1. Use worktree `peers-ai-agent`, branch
   `feat/p0-streaming-runtime-message-actions`.
2. Use approved profile `chat-native-disposable` and exact-source Station
   commit `032bb05473906cb39aa9524131970f2aa2dab1ee`.
3. Use Acceptance binary SHA-256
   `ac8f5cc4e3ed24485d461e44f9aeb35402680f65ba7902df700d2ee1005ae0a6`.
4. Run `agent-v2-kernel-foundation-e2e` with explicit disposable and Station
   restart authorization.
5. Observe Browser English `BASE-DUPLICATE_CONFLICT`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | The before/after preservation hash includes a legitimate volatile or reordered field. | High | Low | Stable IDs and persisted payload agree while only a timestamp, revision, or ordering field changes. |
| B | `openOriginal` resolves a different authoritative Turn than the duplicate error identifies. | Medium | Low | Recovery target ID differs from `existing_command_id` or the original Turn ID. |
| C | The rejected duplicate request mutates the original Turn, message, queue, or attempt row. | Medium | Medium | A canonical field or row count changes between before and after readback. |
| D | The before/after capture races an asynchronous projection refresh. | Medium | Medium | Station truth remains stable while one client projection hash changes after recovery. |
| E | The independent Python oracle and TypeScript producer compare different preservation fields. | Low | Low | Producer and independent evaluator disagree for the same facts. |

## Log Evidence
- Exact-source Gate run
  `20260908T085631432448Z-cba84508b9ffeadfbe84947c59ebe7c0`
  on checkpoint `032bb05473906cb39aa9524131970f2aa2dab1ee`
  failed first at Browser English `BASE-DUPLICATE_CONFLICT` on
  `originalCommandPreserved`.
- Outer run
  `20260908T085631308481Z-35cecbd98946132a0c9edd7313c634b8`
  completed `FAILED / PARTIAL / UNPROVEN`.
- Provisioner cleanup completed `DONE / PROVEN / passed`.
- The independent evaluator reported only `originalCommandPreserved` as
  failed. All other assertions passed, which proves:
  - typed `details.existing_command_id` equals the original Turn ID;
  - `openOriginal` opened that same Turn;
  - before/after full readback hashes are equal;
  - replay hashes are equal;
  - Turn/message/queue/provider deltas are zero.
- Source inspection shows the `station` evidence projection emits
  `originalTurnId` but omits `existingCommandId`, while both the TypeScript and
  independent Python oracles require
  `station.existingCommandId == station.originalTurnId`.

## Instrumentation
- The existing stable Gate output and independent assertion decomposition
  already isolate every preservation predicate without exposing identifiers.
  No additional product instrumentation is required.

## Verification Conclusion
Hypotheses A-D are rejected by equal full readback/replay hashes, zero deltas,
and the successful recovery target assertion. Hypothesis E is rejected because
the producer and independent evaluator agree on the failed assertion. The
confirmed defect is an Acceptance producer projection omission: it validates
the typed existing command ID but does not copy that already-proven value into
the `station` facts consumed by `originalCommandPreserved`.

## Local Correction
- The Harness now projects
  `rejectedOutcome.details.existing_command_id` as
  `station.existingCommandId`.
- No Station behavior, product assertion, Gate tuple, timeout, recovery target,
  or cleanup contract changed.
- Desktop TypeScript passed; focused Harness/independent-oracle tests passed
  `200/200`; `git diff --check` passed.
- Exact-source checkpoint, deployment, and rerun remain pending.
