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
| A | A late boot transition overwrites successful login state | High | Low | Rejected: account gate was ready before login and no later boot event appeared |
| B | Login completion runs before `authenticatedPendingCompletion` is observable | High | Low | Confirmed consequence: completion returned while phase remained `accountGate` |
| C | An identity pipeline handler triggers logout or revocation after login | Medium | Medium | Rejected: logout events appeared only during cleanup after timeout |
| D | Session authentication succeeds but identity snapshot publication is stale | Medium | Low | Confirmed root cause: auth command returned while session remained unauthenticated |

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
- Exact-source pre-fix run
  `20260903T134255845569Z-75b5760a81ae7b0ecf9199486052cf1c`
  reproduced the timeout after Station selection had succeeded.
- Log lines 9-11 show `accountGate` ready before login, followed by successful
  auth-command and completion returns while `sessionAuthenticated=false` and
  phase remained `accountGate`.
- Log lines 15-18 show logout/account-gate transitions only during cleanup,
  after the timeout.

## Verification Conclusion
The password-login path received a valid auth response but did not call the
session store's `activateAuthenticatedSession`. Consequently
`acceptAuthenticatedEdgeFromCurrentSession` found no current user, emitted no
`FRESH_LOGIN_AUTHENTICATED` event, and `completeCurrentSession` remained a
no-op.

## Fix
- Successful password, access-gate, and OAuth responses now activate the
  authenticated session before identity reconciliation.
- `identityRuntime.loginWithPassword` delegates to the store-owned login path
  before accepting the fresh authenticated edge.
- Focused identity/session tests: 9 passed.
- Desktop type-check and runtime-boundary checks: passed.

## Post-Fix Verification
- Run ID: `post-fix`.
- Pending exact-source Foundation reproduction.
