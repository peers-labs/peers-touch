# Debug Session: offline-snapshot-divergence
- **Status**: [OPEN]
- **Issue**: Alice and Bob produce different conversation snapshots immediately before the offline-recovery journey.
- **Debug Server**: Existing Acceptance evidence store
- **Log File**: Gate evidence artifact `offline-before-divergence`

## Reproduction Steps
1. Build and lease `desktop-linux-native` from exact committed source.
2. Deploy the same commit to Profile Three.
3. Run `CHAT_ACCEPTANCE_RESET=1 CHAT_ACCEPTANCE_ALLOW_STATION_RESTART=1 make acceptance-chat-native-product-closure RUNTIME_CELL=desktop-linux-native`.
4. Complete the attachment product path.
5. Observe `Alice and Bob diverged before offline recovery`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | Sender and receiver attachment availability states are sampled during a local/remote transition. | High | Low | Snapshot differs only in attachment `state`. | Rejected |
| B | One actor's transcript projection contains a missing, extra, or stale message. | Medium | Low | Snapshot transcript IDs or content differ. | Rejected |
| C | Opening and closing the thread panel exposes a transient thread projection difference. | Medium | Low | Snapshot differs only in thread summary or panel fields. | Rejected |
| D | Attachment DOM ordering is unstable despite identical IDs and counts. | Low | Low | Attachment arrays contain the same IDs in a different order. | Rejected |
| E | Transcript extraction reads attachment chrome from the full message bubble instead of the dedicated plaintext marker. | High | Low | IDs, sequences, thread, reaction, and attachments match; sender transcript alone includes sender-only attachment chrome. | Confirmed |

## Log Evidence
- Exact-source Linux run
  `20260826T054343905664Z-d28f8cbe8bf6e2effd7d392175cfc296`
  at `ec172850b57cfe1c4546fab6f354a760299eb0c9` passed attachment count,
  image-load, and byte-exact assertions before failing at the immediate
  Alice/Bob snapshot equality check.
- Exact-source Linux run
  `20260826T065143807493Z-14e8928a6d5161416cda00edf029837e`
  at `7b409f0db422127e9728af9646f563cdec218091` emitted
  `offline-before-divergence`. Both actors had identical message IDs,
  authority sequences, thread summary/panel, reaction state, attachment IDs,
  kinds, availability states, and image-load state.
- The only difference was transcript `content`: Alice's attachment rows
  included the sender-only `Chat` visibility badge because `transcript()`
  read the full `[data-message-content]` bubble. Bob had no such badge.
- The existing product DOM contract exposes plaintext separately through
  `[data-message-text]`; `attachment_message()` already consumes that marker
  while `transcript()` did not.

## Verification Conclusion
Hypotheses A-D are rejected. Hypothesis E is confirmed. The product projections
converged; the Gate compared actor-specific attachment chrome as if it were
message plaintext. The repair keeps exact transcript equality and changes only
the semantic DOM field used for `content`.
