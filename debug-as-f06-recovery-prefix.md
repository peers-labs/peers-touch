# Debug Session: as-f06-recovery-prefix
- **Status**: [OPEN]
- **Issue**: The exact-source Foundation run intermittently rejects Browser
  AS-F06 preparation with `agent.acceptance.foundationRecoveryPrefixMissing`
  after observing a text event and at least two durable event sequences.
- **Debug Server**: http://127.0.0.1:7779/event
- **Log File**: `.dbg/trae-debug-log-as-f06-recovery-prefix.ndjson`

## Reproduction Steps
1. Use worktree `peers-ai-agent`, branch
   `feat/p0-streaming-runtime-message-actions`, profile `two`.
2. Deploy Station and build the Acceptance Desktop binary from the same clean
   source commit.
3. Run `agent-v2-kernel-foundation-e2e` with
   `PT_AGENT_V2_ALLOW_STATION_RESTART=1`.
4. Observe Browser AS-F06 preparation.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | A durable `text` event can carry an empty payload, so event type alone is not a valid non-empty recovery-prefix boundary | High | Low | Boundary facts show `textEventCount > 0` but `nonEmptyTextEventCount = 0` |
| B | The recovery cursor can advance beyond text already observed by the callback while the callback's event list omits that text | Medium | Low | `acknowledgedCursor` exceeds the maximum text sequence |
| C | Provider output begins with non-text progress/tool events and reaches the duplicate/out-of-order threshold before any non-empty text delta | High | Low | Durable sequence count reaches two while all non-empty text sequences are absent |
| D | Text content is stored under an event field not covered by `content ?? text` | Medium | Low | Redacted event shape reports a non-empty alternative payload field |

## Instrumentation
- `harness.ts:prepareFoundationF06Conversation` records the durable event
  type/sequence list, acknowledged cursor, text-event payload keys, text
  lengths, and aggregate prefix length at the fault-boundary decision.
- Separate `prefix-missing` and `prefix-ready` checkpoints preserve a binary
  post-fix comparison without recording content or identity.

## Log Evidence
- Exact-source run
  `20260831T190230256694Z-d26d4bba1809c91e4081196d6cb2355d`
  on `5458a5403554dad25cbae505f021005ef4c41abb` failed first at
  Browser AS-F06 `agent.acceptance.foundationRecoveryPrefixMissing`.
- Source identity, deployment identity, redaction, and cleanup passed.
- Instrumented exact-source run
  `20260831T194336872605Z-abd54827ed1f0675c34c227d8fbbb0e2`
  on `dece8bada00c5c421d7def8283fe7f02d56f6a91` completed all four
  AS-F06 preparations. Every boundary observed a non-empty sequence-3 `text`
  payload with a one-character prefix; the fourth tuple also included
  duplicate sequence-2 progress/snapshot replay before that text event.
- That run advanced past AS-F12 and failed at the first unimplemented direct
  error fixture, `BASE-ACTIVE_MUTATION_CONFLICT`. Exact source, redaction, and
  cleanup passed.
- Exact-source run
  `20260831T210408061338Z-a4f858ddbe963a87f5beb824f6d74a26`
  on `d344de98807e85b731c11c4b1d4da6b6bb6c8836` reproduced the
  failure. Debug lines 7-8 show a non-empty text event at sequence 3 while the
  recovery owner still acknowledged cursor 2. Filtering the prefix to
  `sequence <= acknowledgedCursor` therefore produced no eligible text and
  failed before the recovery cursor could catch up.

## Verification Conclusion
Hypothesis B is confirmed. Hypotheses A, C, and D are rejected for the failing
sample: the text payload was non-empty and used the normalized `text` field,
but its sequence had not yet been acknowledged by the recovery owner. The
minimal correction waits when no text event is at or below the acknowledged
cursor; it retains the fail-closed empty-prefix check once an acknowledged text
event exists. Instrumentation remains active for post-fix comparison.
