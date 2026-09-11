# Debug Session: conversation-open-500
- **Status**: [OPEN]
- **Issue**: The current-profile native two-client Chat Gate reaches both authenticated Desktop clients and source attestation, then `conversation.open` fails because Station returns HTTP 500.
- **Debug Server**: http://10.4.55.179:7779/event
- **Log File**: .dbg/trae-debug-log-conversation-open-500.ndjson

## Reproduction Steps
1. Use the canonical `four` profile and deploy Station through `make station`.
2. Run the `chat-native-current-profile-two-client-e2e` Acceptance Gate.
3. Observe successful Station identity, existing actor fixture, Alice/Bob native client bindings, and runtime source identity.
4. Observe `conversation.open` fail at `chat.createDirectConversation` with Station HTTP 500.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Signed direct genesis recovery rejects persisted post-state decoding or semantic equivalence. | High | Low | Rejected: conversation list and Direct creation both rehydrate the existing authority projection successfully. |
| B | Canonical event sealer verification fails because persisted bytes or the deployed sealer identity differ. | Medium | Low | Rejected: Station returned 200 for `POST /conversation/direct`. |
| C | Recovery succeeds but rewriting `conversation_member_devices` violates a transaction constraint. | High | Medium | Rejected: the failing call is the later device inbox claim, not authority persistence. |
| D | The HTTP 500 occurs outside direct projection recovery in create/list authority queries. | Medium | Low | Confirmed: Direct creation succeeds; the Tauri command fails during its post-create queue drain. |
| E | Station returns a typed domain cause but Gateway/Harness strips the details. | Medium | Low | Confirmed: Station logs `delivery.claim: device: is not active for the authenticated actor`, while the client sees an empty HTTP 500 body. |

## Log Evidence
Instrumentation points:

- D entry: bound account, actor, endpoint device, and runtime profile.
- D Station result: distinguishes `/conversation/direct` from later work.
- C-E drain result: captures the exact post-create queue-drain result and endpoint.

Existing immutable run evidence:

- Run `20260911T051620333813Z-4640f78c3a8eddb332a6239a39482afb`
  started two isolated native clients and passed source/runtime identity.
- Station request `c394112c-aed8-4734-a695-55080b420133` returned 200 for
  `POST /conversation/direct`.
- Subsequent `/device/inbox/claim` requests failed because the requested
  device was not active for the authenticated actor.
- Pre-fix Debug Server line 1 records Alice engine endpoint
  `01M27G2ZNZ64HKWEVWB3ETW0VD`.
- Pre-fix Debug Server line 2 records successful Direct reuse for
  `direct-8933203d465fd79ac34b9b33953757a2`.
- Pre-fix Debug Server line 3 records the subsequent queue drain failure.
- Station has one active Alice device, `01M276A60YVV4Q9MWN9NPHD3RE`; the
  run-created endpoint was not enrolled.
- The group-chat local seed contains Bob's canonical actor identity but a stale
  Alice identity; the high-chat local seed contains Alice's canonical actor
  identity but a stale Bob identity.

## Verification Conclusion
The current-profile Provisioner clones one worktree's Desktop identity seed
for both actors. The accepted native Chat workflow requires Alice and Bob to
use the isolated high-chat and group-chat profile states. Alice therefore
generated a device certificate under the wrong actor continuity key,
`/device/enroll` returned 409, and the synchronous post-create drain surfaced
the later inactive-device error as if Direct creation had failed.
