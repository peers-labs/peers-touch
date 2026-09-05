# Debug Session: as-f04-denial-evidence
- **Status**: [OPEN]
- **Issue**: Exact-source Browser AS-F04 fails the independent `denialExecutedZero` assertion after the manual-denial evidence projection change.
- **Debug Server**: `http://127.0.0.1:7784/event`
- **Log File**: `.dbg/trae-debug-log-as-f04-denial-evidence.ndjson`

## Reproduction Steps
1. Use worktree `peers-ai-agent`, branch
   `feat/p0-streaming-runtime-message-actions`, and profile
   `chat-native-disposable`.
2. Deploy Station and build the Acceptance Desktop binary from exact source
   `5085e7657b143f7463ef33a96cd24f23cab55991`.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable reset and
   Station restart envelope.
4. Observe Browser `AS-F04 / en / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | `diagnosticToolCase` adds `awaiting_user` to a policy-level deny that never waited for a user. | High | Low | Confirmed: deny fact has `policy=deny`, states `policy_check -> awaiting_user -> denied`, and all execution counters are zero. |
| B | The denied ToolCall executed despite policy denial. | Medium | Low | Rejected: execution, side-effect, result, and continuation counts are all zero. |
| C | The policy mutation did not become authoritative before the Turn snapshot. | Medium | Low | Rejected: policy is `deny` and the binding revision matches. |
| D | The Harness projected a diagnostic fact from a different ToolCall or replay. | Low | Medium | Rejected: target status, binding revision, and repeated replay all match. |

## Log Evidence
- Exact-source run
  `20260904T214921386952Z-ccee9f99fc0168e78fe2fe4d588d6da4`
  on `5085e7657b143f7463ef33a96cd24f23cab55991` reached
  `FIXTURE_READY` and failed first at Browser
  `AS-F04 / en / single / sample-001`.
- The independent oracle reported only `denialExecutedZero=false`.
- Provisioner cleanup completed successfully.
- The current Gate does not persist the denial fact fields needed to
  distinguish hypotheses A-D.
- Diagnostic exact-source run
  `20260904T220822121030Z-ab3b1762700ffe88dac9a83328bbd759`
  on `fa52e32f5fb61f47bbd0a09662baa73e6468295a` emitted one
  `denial-fact` checkpoint:
  - `policy=deny`
  - `states=["policy_check","awaiting_user","denied"]`
  - execution, side-effect, result, and continuation counts all equal `0`
  - target status, binding revision, and replay equality all match
- The independent oracle again failed only `denialExecutedZero`; provisioner
  cleanup passed.

## Instrumentation
- Checkpoint `240aadb00acab41f82ab9052ddfc260ee1654e01` records the deny
  case policy, projected states, execution counters, target status, binding
  revision equality, and replay equality immediately before the unchanged
  AS-F04 assertion.
- Desktop strict checks and 67 native static tests pass.

## Verification Conclusion
Hypothesis A is confirmed and B-D are rejected. The shared projector
incorrectly treats policy-level denial as if it had entered the manual
approval wait state. The fix must branch on policy: `deny` projects
`policy_check -> denied`, while a final manual denial projects
`policy_check -> awaiting_user -> denied`.

## Local Fix Verification
- `diagnosticToolCase` now handles `policy=deny` before the manual approval
  branch.
- Manual terminal denial still projects
  `policy_check -> awaiting_user -> denied`.
- The post-fix debug checkpoint remains active for exact-source comparison.
- Desktop strict checks: passed.
- Desktop tests: 560 passed, with one unrelated environment-dependent skip.
- Desktop production build: passed.
- Agent native static and Group One evaluator tests: 130 passed.
- `git diff --check`: passed.

## Post-Fix Runtime Verification
- Exact-source run
  `20260904T222331747954Z-58f6c341ba8392c6b50a2c1712ec0388`
  on `770e4ec8ae6d0e6fe2ed3d66a76ea89ffff27f55` emitted the
  corrected denial fact twice:
  - `policy=deny`
  - `states=["policy_check","denied"]`
  - execution, side-effect, result, and continuation counts all equal `0`
  - target status, binding revision, and replay equality all match
- The Gate advanced beyond AS-F04 to later Foundation cells. This closes the
  behavior diagnosis, while the debug session remains `[OPEN]` until the Owner
  explicitly authorizes instrumentation removal.
