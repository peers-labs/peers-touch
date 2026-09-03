# Debug Session: foundation-login-readiness
- **Status**: [OPEN]
- **Issue**: Foundation native login authenticates but the Desktop identity lifecycle does not reach `ready`.
- **Debug Server**: http://127.0.0.1:7781/event
- **Log File**: `.dbg/trae-debug-log-foundation-login-readiness.ndjson`

## Reproduction Steps
1. Activate `chat-native-disposable`.
2. Deploy the exact bound source commit.
3. Run `agent-v2-kernel-foundation-e2e`.
4. Observe `loginWithPassword` time out waiting for lifecycle `ready`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | A late boot transition overwrites successful login state | High | Low | Pending |
| B | Login completion runs before `authenticatedPendingCompletion` is observable | High | Low | Pending |
| C | An identity pipeline handler triggers logout or revocation after login | Medium | Medium | Pending |
| D | Session authentication succeeds but identity snapshot publication is stale | Medium | Low | Pending |

## Log Evidence
- Instrumented `identityRuntime.ts:dispatch` to capture every identity event and
  pre/post phase.
- Instrumented Agent Harness login at account-gate readiness, native login
  return, completion return, and first-attempt failure.
- Pre-fix run ID: `pre-fix`.
- Diagnostic run
  `20260903T135544826460Z-0b27c03aa1aea1d5c255a2c01ddceb53`
  was rejected before execution because Foundation requires a clean candidate
  worktree. Instrumentation must therefore be checkpointed and deployed before
  reproduction.

## Verification Conclusion
Pending.
