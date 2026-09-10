# Debug Session: base-active-mutation-conflict
- **Status**: [OPEN]
- **Issue**: The exact-source Browser
  `BASE-ACTIVE_MUTATION_CONFLICT` scenario proves the Station rejection and
  receiver recovery, but its generic runtime attestation can depend on stale
  conversation/Turn state left by an earlier tuple.
- **Debug Server**: http://127.0.0.1:7780/event
- **Log File**: `.dbg/trae-debug-log-base-active-mutation-conflict.ndjson`

## Reproduction Steps
1. Use worktree `peers-ai-agent`, branch
   `feat/p0-streaming-runtime-message-actions`, profile `two`.
2. Deploy Station and build both clients from the same clean source commit.
3. Run `agent-v2-kernel-foundation-e2e` with Station restart authorization.
4. Observe Browser `BASE-ACTIVE_MUTATION_CONFLICT` in English.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | Agent Profile does not mount before the 30-second receiver wait | Medium | Low | Surface selector is absent while store conflict state is present |
| B | The profile mounts for a different selected Agent | Medium | Low | Profile Agent ID differs from the disposable fixture ID |
| C | Conflict state reaches the store but the expected selectors are hidden or absent | High | Low | Store reports `conflict`; conflict/reload selector visibility is false |
| D | The selectors are visible but localized text differs from the expected locale keys | Medium | Low | Captured actual and expected text hashes differ |
| E | The exact typed error is not classified by the store | Low | Low | Rejection code is correct but save state is not `conflict` |

## Instrumentation
- Active instrumentation records only Agent ID hashes, selected surface,
  save-state value, selector presence/visibility, and localized-text hashes
  before the receiver assertion.

## Log Evidence
- Exact-source run
  `20260902T070303965649Z-71a64c78ea7a07f259ca547edd9753f8`
  on `b717ccac3b7f99b656fa8be3c647886e7ba3564e` failed only
  `localizedRecoveryVisible` for Browser English.
- Exact source, redaction, and cleanup passed.
- Debug lines 1-2 prove the disposable Agent, profile surface, exact rejection,
  save state, and both selectors were correct and visible. The tuple requested
  English, but the runtime locale remained `zh-CN`; both expected strings were
  unresolved global i18n keys rather than Agent-namespace translations.

## Verification Conclusion
Hypothesis D is confirmed. Hypotheses A, B, C, and E are rejected. The
Foundation direct probe did not apply each tuple's locale after AS-F06 left the
client in Chinese, and the producer called global `i18n.t` without the `agent`
namespace. The correction applies and verifies locale before every non-AS-F06
direct probe, and resolves both expected strings from the Agent namespace.
Instrumentation remains active for post-fix comparison.

## Current Failure
- Exact-source retry
  `20260907T070147144683Z-7245b23cfd64bf4ec824427fca07bf12`
  on `87aa51437a2faea4803d34d08bf2bcfaed5980b1` failed at Browser
  English `BASE-ACTIVE_MUTATION_CONFLICT` with
  `agent.acceptance.directRuntimeFactsMissing`.
- Provisioner cleanup completed `DONE / PROVEN / passed`; source identity and
  redaction passed.

## Current Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| F | The cell creates no conversation/Turn of its own, so generic attestation has no exact runtime facts | High | Low | Confirmed: the scenario creates/deletes only the disposable Agent, while attestation requires selected session, conversation readback, and Turn evidence |
| G | A capability session is unavailable for the cell | Low | Low | Rejected: the same direct-runtime client completed prior cells and the failure names missing aggregate runtime facts, not session reconciliation |
| H | Prior passing runs consumed incidental `chatState.currentSessionKey` and prior Turn evidence | High | Low | Confirmed by source flow: no prepared IDs are assigned for this cell, so fallback state determines the attestation target |

## Current Verification Conclusion
The failure is an Acceptance producer lifecycle defect. The cell must create a
bounded direct-runtime attestation Turn, bind the exact conversation and Turn
IDs into the shared attestation path, and delete the attestation conversation
in addition to the disposable Agent. Product conflict semantics, matrix
identity, timeouts, and independent assertions remain unchanged. The Debug
Server and instrumentation remain active for post-fix comparison.

## Local Correction
- The producer creates one capability-isolated Direct attestation Turn after
  the profile-conflict journey succeeds.
- The cell binds its exact conversation and Turn IDs and cannot fall back to a
  prior `chatState.currentSessionKey` or assistant message.
- Both helper failure paths and the outer Gate failure path delete the
  attestation conversation.
- Local and independent cleanup assertions require the disposable Agent and
  attestation conversation to be deleted.
- Debug events now use `runId=post-fix`; the existing log was retained.

## Local Verification
- Desktop TypeScript check: passed.
- Desktop tests: `573` passed, `1` unrelated environment-dependent skip.
- Desktop production build: passed.
- Foundation static and independent scenario tests: `146/146` passed.
- Acceptance plan self-check and `git diff --check`: passed.
- Agent Domain validation: expected fail-closed because latest runtime evidence
  is source-bound to the prior checkpoint.
- Exact-source post-fix Gate:
  `20260907T081328279276Z-0783821f1a985ba756eec42588629ed5`.
- Browser English attestation Turn completed in `1079.1ms`; Browser Simplified
  Chinese completed in `2583.1ms`.
- Both rows emitted exact conversation/Turn hashes and
  `conversationDeleted=true`; the Gate advanced to `BASE-CANCELLED`.
- Foundation remains `PARTIAL / UNPROVEN` because `BASE-CANCELLED` is the next
  unimplemented direct-runtime group.
