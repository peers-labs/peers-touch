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

## Replay Cursor Comparison Follow-Up

| ID | Hypothesis | Status | Evidence |
|----|------------|--------|----------|
| I | The observed `REPLAYING` transition cursor is always the cursor sent in the original replay request. | Rejected | Exact-source run `20260907T153830485835Z-c4bbc331c8137f7b8c111e8cb3eb00cb` recorded `afterCursor=22` while the client retained source-bound replay delivery `22`; the separate Station readback from `22` therefore began at `23`. |
| J | The frozen post-cut handoff cursor remains the authoritative original replay boundary. | Rejected by follow-up | Runtime instrumentation showed the original request cursor can be `3` while the post-cut cursor advances to `34`; one mutable field had represented both boundaries. |
| K | Wire sequence values may be numeric strings even though normalized delivery identity is numeric. | Confirmed contract risk | `createAgentTurnSourceDelivery` accepts numeric and string `seq` values; the Python oracle previously compared the raw value to the normalized integer without conversion. |

- The first correction kept the required `REPLAYING` phase observation and
  used `handoff.acknowledgedCursor` for independent Station replay. The
  follow-up evidence below supersedes that boundary choice.
- The independent oracle converts only a valid positive integer or digit string
  before comparing sequence identity; exact raw-payload hashes remain required.
- Focused `183/183` and full `330/330` Agent Acceptance tests plus Desktop check
  and `git diff --check` pass.
- Runtime proof remains pending. Keep this session and its instrumentation open.

## Replay Request Cursor Follow-Up

- Exact-source run
  `20260907T161810060757Z-aaa9b164cc9d9a8d6d5e7fd730bc175a`
  on `b5b3fe8209b74926ebaa996147680124ae7e986d` reproduced Browser English
  AS-F06 with client replay deliveries `12..183` and independent Station
  readback `13..183` when `afterCursor=12`.
- The controlled diagnostic run
  `20260907T163617263286Z-4fc7227e804a51714f2b1b842acef785`
  crossed AS-F06 and later failed at Browser English `BASE-CANCELLED`.
  Debug log lines 1-12 record four AS-F06 preparations. All four original
  replay requests used cursor `3`; the post-cut acknowledged cursor advanced
  to `34` and `33` in two samples and remained `3` in two samples.
- Hypothesis J is rejected. `handoff.acknowledgedCursor` is the post-cut
  projection cursor, not an immutable record of the original replay request.
  The same field was initialized from the request cursor and then overwritten
  after the transport cut, so its meaning depended on callback timing.
- The correction splits immutable `replayRequestCursor` from post-cut
  `acknowledgedCursor`. Replay recording and independent Station readback use
  the request cursor; prefix, duplicate/out-of-order, and mutation checks
  continue to use the post-cut cursor. Both TypeScript and Python oracles
  require `afterCursor == replayRequestCursor <= acknowledgedCursor` and retain
  exact raw-payload hash and source-identity equality.
- Runtime post-fix proof remains pending. Keep this session and all
  instrumentation open.
