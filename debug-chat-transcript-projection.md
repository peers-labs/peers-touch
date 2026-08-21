# Debug Session: chat-transcript-projection
- **Status**: [OPEN]
- **Issue**: Exact thread proof passes, but the Native Gate waits for three standalone transcript rows after the reply is correctly projected under its thread root.
- **Debug Server**: http://127.0.0.1:7780/event
- **Log File**: `.dbg/trae-debug-log-chat-transcript-projection.ndjson`

## Reproduction Steps
1. Run `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-product-closure`.
2. Complete Alice root, Bob root, and Alice Reply through real Native UI.
3. Verify the visible thread preview and `thread_exact=PASS`.
4. Close the Thread panel.
5. Observe `timed out waiting for Alice complete transcript`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| O | Alice has exactly the two top-level root rows after the reply moves into the thread | High | Low | Alice transcript IDs equal root IDs and exclude reply ID |
| P | The reply disappeared from every visible/thread surface | Low | Low | Rejected if `thread_exact=PASS` retains the reply ID |
| Q | Alice and Bob top-level transcript arrays diverge | Medium | Low | Actor arrays differ by ID/order/content |
| R | The Gate's `len >= 3` condition conflates top-level transcript and thread replies | High | Low | Both actor arrays are equal with length `2` while thread proof is exact |
| S | A top-level row lacks authority sequence and is filtered by the final assertion | Low | Low | Any transcript sequence is zero |

## Log Evidence
Initial run:
`20260821T082035385490Z-faae0c63f2931335197d41fe3dd5bccd`.

- `thread_exact=PASS`.
- The real Thread close action completed.
- The next failure was `timed out waiting for Alice complete transcript`.

Pre-fix transcript run:
`20260821T082955521231Z-92bb52961590839d47eec49cc176fc32`.

- Alice top-level IDs:
  `01M0HQ6MGEVXHPZHAF8XF1RSD5`,
  `01M0HQ6W02FKKVE1TN6KRNWHAQ`.
- Bob exposes the same IDs, order, content hashes, content lengths, and
  authority sequences `3,4`.
- Reply `01M0HQ75N7MKNMTKWA7EK42MZB` is absent from both top-level arrays and
  remains present in the exact thread summary and panel.
- Immutable cleanup evidence reports ports `3330/3331/4445/4446` released;
  direct `lsof` verification found no listeners.

## Verification Conclusion
| ID | Status | Evidence |
|---|---|---|
| O | Confirmed | Alice has exactly the two expected top-level roots |
| P | Rejected | `thread_exact=PASS` retains the reply |
| Q | Rejected | Alice and Bob top-level arrays are exact |
| R | Confirmed | Gate waits for a third standalone row that the contract forbids |
| S | Rejected | Both top-level authority sequences are positive |

Root cause: the Gate's `len >= 3` wait conflates a rooted thread reply with a
top-level transcript row. The product projection is correct.

Fix under verification:

- Wait for the exact expected root IDs on Alice and Bob.
- Require exact actor arrays and expected root content.
- Require positive, ordered authority sequences.
- Explicitly reject the reply ID from the top-level transcript.
- Retain `thread_exact` as the independent reply proof.

Post-fix assertion run:
`20260821T085148009517Z-f6f0a3c957625f32c2a82c4c92e32c1b`.

- `thread_exact=PASS`.
- Alice and Bob expose identical top-level IDs, authority order, attachment
  counts, and raw DOM content.
- The corrected exact-root wait completed and the rooted reply remained absent
  from both top-level arrays.
- The first `transcript_exact` implementation over-constrained each raw
  `[data-message-content]` `innerText` to equal the sent payload. The DOM value
  includes the same UI glyph prefix and trailing newline in both clients.
- The evidence-backed assertion retains byte-for-byte Alice/Bob transcript
  equality and requires each corresponding DOM content value to contain the
  exact sent payload.
- Cleanup evidence and direct `lsof` verification show ports
  `3330/3331/4445/4446` released.

Post-fix verification run:
`20260821T085747312015Z-8ee1be3046571316504a0988f1cb3746`.

- `thread_exact=PASS`.
- `transcript_exact=PASS`.
- Alice and Bob exposed the same two top-level IDs, authority sequences,
  attachment counts, and decorated DOM content.
- Each DOM content value contained the exact corresponding sent payload.
- The rooted reply remained excluded from the top-level arrays and exact in the
  thread summary/panel.
- The run advanced to toolbar geometry, where a separate WebDriver `DOMRect`
  serialization defect became the new first failure.
- Cleanup evidence and direct `lsof` verification show ports
  `3330/3331/4445/4446` released.
