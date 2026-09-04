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
| A | `diagnosticToolCase` adds `awaiting_user` to a policy-level deny that never waited for a user. | High | Low | Deny fact has `policy=deny`, states `policy_check -> awaiting_user -> denied`, and all execution counters remain zero. |
| B | The denied ToolCall executed despite policy denial. | Medium | Low | At least one execution, side-effect, result, or continuation count is nonzero. |
| C | The policy mutation did not become authoritative before the Turn snapshot. | Medium | Low | Deny fact reports `manual` or `auto`, or its binding revision does not match the updated binding. |
| D | The Harness projected a diagnostic fact from a different ToolCall or replay. | Low | Medium | Turn/ToolCall lineage or repeated replay identity differs from the denial case. |

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

## Instrumentation
- Checkpoint `240aadb00acab41f82ab9052ddfc260ee1654e01` records the deny
  case policy, projected states, execution counters, target status, binding
  revision equality, and replay equality immediately before the unchanged
  AS-F04 assertion.
- Desktop strict checks and 67 native static tests pass.

## Verification Conclusion
Runtime evidence is insufficient to change behavior. Deploy the diagnostic
checkpoint and rerun the same exact-source Gate.
