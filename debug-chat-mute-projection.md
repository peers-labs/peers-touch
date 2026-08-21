# Debug Session: chat-mute-projection
- **Status**: [OPEN]
- **Issue**: A real Native Mute click in Chat Details does not converge the visible `data-chat-detail-muted` projection to `true`.
- **Debug Server**: http://127.0.0.1:7782/event
- **Log File**: `.dbg/trae-debug-log-chat-mute-projection.ndjson`

## Reproduction Steps
1. Run `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-product-closure`.
2. Complete the real Native thread, transcript, toolbar, Reaction, avatar, and Station attribution journeys.
3. Open Alice's Details panel and click `[data-chat-conversation-action="mute"]`.
4. Observe `timed out waiting for mute projection`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| A | The Native click does not enter the Mute toggle handler | Medium | Low | Gate click returns but no Toggle or action-entry event is emitted |
| B | The handler enters, but the Station settings write returns a typed authorization or membership error | High | Low | Action-entry exists, store write rejects, and no authoritative response is emitted |
| C | Station returns `muted=true`, but `socialChat` does not commit the authoritative projection | High | Low | Service response is correct while the store projection remains false |
| D | Alice commits locally, but realtime invalidation or reconciliation overwrites the state | Medium | Medium | Store commit reaches true and a later load/realtime projection writes false |
| E | The Gate reads the wrong Details DOM owner or conversation state | Medium | Low | Store state is true while the queried panel remains false or belongs to another conversation |

## Log Evidence
Pre-fix clean source-bound run:
`20260821T101103621394Z-083d69ddf9bbc5bdd1b97026df475f9d`.

- Source and Profile Three Station matched commit
  `04fe5680128ac008c350a264e5e9ac20c7000e1f`.
- Driver, thread, transcript, toolbar, Reaction, avatar, and Station attribution
  assertions passed.
- The first failure was `timed out waiting for mute projection`.
- Actor and fault-proxy ports were released.

Instrumentation-only rerun:
`20260821T103108217486Z-e695d7ae3893ecd1e2b33097cd853564`.

- Source, dedicated binary, and Profile Three Station matched commit
  `5d5606bd75784722d5c7647de7be88f2e9d59b87`.
- The Gate failed earlier while sending Alice's real Native Reply, before
  opening Details or clicking Mute.
- The Mute log contains only startup/reconciliation events with no conversation
  settings yet loaded. No toggle, action, Station write, readback, or realtime
  event was reached.
- Hypotheses A-E therefore remain inconclusive. No Mute business fix is
  justified from this run.

## Verification Conclusion
Pre-fix source-bound run:
`20260821T105137876440Z-3c4f7bd0d482a821a2cd920d6236746e`.

| ID | Status | Evidence |
|---|---|---|
| A | Rejected | Toggle click and action entry both ran for the exact group |
| B | Confirmed | Station write returned `FORBIDDEN`; readback returned HTTP 403 `active conversation membership required` |
| C | Rejected | No successful Station response existed to commit |
| D | Rejected | No successful local commit existed for realtime reconciliation to overwrite |
| E | Rejected | UI action, store request, and Station readback used the same conversation ID |

Root cause: MLS genesis atomically writes active actors to canonical
`messaging_conversation_members`, while `/conversation/member/settings` still
authorizes and reads nickname from legacy `conversation_members`. The real
Messaging group is therefore active in the authority plane but absent from the
legacy table, so both settings read and write fail closed with 403.

The fix belongs in Station settings ownership: authorize against the canonical
Messaging authority read model, keep actor-scoped settings (including nickname)
in `conversation_member_settings`, and derive the realtime settings kind from
the canonical authority conversation. Dual-writing legacy membership would
create a second truth source and is rejected.

Post-fix source-bound run:
`20260821T111320224051Z-a00d79d77433a69e1bbb6766037356ad`.

- Source, dedicated binary, and Profile Three Station matched commit
  `b1174eb6f1d188c7e320719ee498ff3da128ec04`.
- Alice's real Native Mute click entered the toggle and action handlers.
- Station returned `muted=true`; the authoritative Desktop projection committed
  `muted=true`; direct Station readback returned `muted=true`.
- Alice's real Native Pin click returned and committed `pinned=true`.
- Later Alice reconciliation retained `muted=true` and `pinned=true`.
- Bob retained actor-scoped defaults, as required by per-member settings
  ownership.
- The Gate advanced to the built-in background picker and failed independently
  while waiting on a hidden Ant Design option node.
- Cleanup released `3330`, `3331`, `4445`, `4446`, and the Reaction proxy port.

The legacy/canonical membership split is fixed for Mute and Pin. This session
remains `[OPEN]` until the complete ConversationActionSurface journey passes
on clean source and the user confirms closure.
