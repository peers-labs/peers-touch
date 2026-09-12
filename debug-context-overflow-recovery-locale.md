# Debug Session: context-overflow-recovery-locale
- **Status**: [OPEN]
- **Issue**: Browser BASE-CONTEXT_OVERFLOW passes typed rejection and cleanup but fails only `localizedRecoveryVisible` for Simplified Chinese.
- **Debug Server**: `http://10.4.55.179:7792/event`
- **Log File**: `.dbg/trae-debug-log-context-overflow-recovery-locale.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile and exact-source Station.
2. Run C08 and require `DONE / PROVEN`.
3. Run the unchanged `agent-v2-kernel-foundation-e2e`.
4. Observe Browser `BASE-CONTEXT_OVERFLOW / zh-CN / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | The recovery action is visible with correct localized text before click, then disappears after the recovery click as intended, while the producer samples visibility too late. | High | Low | Pre-click visibility/text hashes match; post-click visibility is false and focus/draft recovery succeeds. | Rejected: both locales remained visible after click. |
| B | The active locale or Agent namespace is wrong for the Simplified Chinese tuple. | Medium | Low | Active locale differs from `zh-CN`, or actual and expected text hashes differ before click. | Rejected: locale and both text hashes matched. |
| C | The recovery action exists but is hidden before click because the typed error projection is incomplete. | Medium | Low | Pre-click element presence is true but visibility is false. | Rejected: recovery was connected and visible. |
| D | The Harness selects a stale error surface from another Turn. | Low | Medium | Multiple matching surfaces exist or the selected surface changes before recovery. | Rejected in this run: exactly one surface existed before and after click. |

## Instrumentation Plan
- Record locale, matching surface count, error/recovery presence and visibility,
  and hashes of actual/expected localized text before recovery.
- Record the same presence/visibility facts after click and after the reduced
  draft is applied, plus focus state.
- Do not record text, identity, drafts, Turn IDs, credentials, or payloads.

## Instrumentation
- `runFoundationContextOverflowScenario` records one pre-click snapshot after
  the typed receiver and recovery action are visible.
- It records one post-click snapshot after focus restoration and the reduced
  draft are complete.
- Events contain only locale, counts, booleans, and SHA-256 text hashes.

## Log Evidence
- Exact-source C08 run
  `20260911T214403167521Z-884c868de07aec4a5a91ad6c44d8cbc6`
  on `040912bcabad6eb67db15fda2d37c5d7066da0dc` is
  `DONE / PROVEN`, 19/19, with clean cleanup.
- Foundation run
  `20260911T214508595389Z-0e79b626b70d9158805ecc8382e7e54e`
  crossed BASE-INCOMPATIBLE_CAPABILITY and failed first at Browser
  `BASE-CONTEXT_OVERFLOW / zh-CN / single / sample-001` with only
  `localizedRecoveryVisible=false`.
- Outer Provisioner cleanup passed.
- Exact-source C08 run
  `20260911T222805881767Z-f6325398e35ef10bbc86e10e3f291ff1`
  on `07351dcf4f28fd8b81a2de58f493609b7086177a` is
  `DONE / PROVEN`, 19/19, with clean cleanup.
- Foundation run
  `20260911T222932042410Z-f62cac19455ffd1a5c5bb8bd182423b4`
  crossed both Browser `BASE-CONTEXT_OVERFLOW` locale cells. The four
  pre/post events show one matching surface, matching localized error and
  recovery hashes, visible error/recovery elements, restored composer focus,
  and the reduced draft for both `en` and `zh-CN`.
- The same Foundation run failed later at Browser Simplified Chinese
  `BASE-DUPLICATE_CONFLICT` while waiting for the original Turn details.
- Outer run
  `20260911T222931919783Z-035e57e4db549bbe72107ed12eb1db2f`
  is `FAILED / PARTIAL / UNPROVEN`; Provisioner cleanup is
  `DONE / PROVEN / passed`.

## Verification Conclusion
The previously observed context-overflow visibility failure did not reproduce.
Hypotheses A-D are rejected for this exact-source run, and the Gate advanced to
the next typed-error vertical. No context-overflow behavior change is justified
from the current evidence. The session remains `[OPEN]`; instrumentation and
the collector are retained until the enclosing Foundation proof is complete or
the user authorizes cleanup.

## Iteration 2: Final-Fact Sampling Race

Exact-source Foundation run
`20260912T000634915947Z-ab105f5f3f6e2f29fdfedf9169d85b02`
on `ae12997a91ea4e5525b2e17e5817e2396c8abca4` again failed only
`localizedRecoveryVisible` for Browser `zh-CN`. The current run's pre- and
post-click telemetry still records matching localized hashes and visible error
and recovery elements for both locales.

The remaining divergence is after the instrumented post-click boundary:
`clearFoundationLocalConversationProjection()` runs before the receiver facts
read `getClientRects()` from the captured DOM nodes. React may commit that clear
before the final facts are sampled, making a receiver that was visibly proven
appear absent. The local correction freezes error/recovery visibility and text
before executing recovery and cleanup, then emits those observed values into
the receiver facts. Recovery execution, cleanup order, independent oracle,
tuples, and timeouts are unchanged.

## Local Verification
- Desktop strict check: PASS.
- Focused Foundation static/oracle tests: `234/234` PASS.
- `git diff --check`: PASS.

## Iteration 3: Cleanup Readback

Exact-source Foundation run
`20260912T090751589578Z-8609947413ae347978a77156d5021b64`
on `f94b2fb4d360b6ae1f6f8401ac1df81955142903` crossed the
`BASE-INTERRUPTED` frontier and failed only
`BASE-CONTEXT_OVERFLOW / browser / en / cleanupComplete`. Runtime and
Provisioner cleanup both completed without leaked process, port, storage, or
lease resources.

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| E | Conversation deletion returns before the authoritative readback reaches `deleted` or not-found. | High | Low | Delete call succeeds, immediate readback has a non-deleted status, and the final cleanup fact is false. |
| F | The baseline Turn remains active long enough to block conversation deletion. | Medium | Low | Pre-delete status or delete retries report `ACTIVE_DEPENDENCY`. |
| G | Local projection cleanup leaves an operation/session buffer behind. | Medium | Low | Final `localProjectionCleared` is false while conversation deletion succeeds. |
| H | The controlled composer update has not committed before cleanup facts are sampled. | Low | Low | Final `draftCleared` is false. |
| I | Shared cleanup compares the runtime cell against a non-canonical ID and never enters the deletion branch. | High | Low | Runtime uses `BASE-CONTEXT_OVERFLOW`, while cleanup code checks `BASE-CONTEXT-OVERFLOW`; no cleanup-dispatch event is emitted. |

The next instrumentation records only hashed Conversation identity, bounded
status/error categories, and the three final cleanup booleans. It does not
record drafts, messages, actor identity, or credentials.

The first two reduced diagnostic launches did not execute the target cell:
outside the full Provisioner lifecycle, the freshly reset local identity could
not satisfy the Station actor-device continuity contract. Both diagnostics
failed before product actions and released every client and fault-transport
resource. They are not evidence for or against E-H.

The retained Harness instrumentation now records
`cleanup-dispatch-entered` immediately before the shared Conversation deletion
phase. A source-bound diagnostic checkpoint is required because Foundation
correctly rejects dirty-worktree product evidence.

## Iteration 4: Cleanup Branch Admission

Exact-source Foundation run
`20260912T125854097224Z-4aadb1165f439562306772b14ce522c5`
on `08d16193949cd19757c099302fa25dda35dfb836` again failed only
`BASE-CONTEXT-OVERFLOW / browser / en / cleanupComplete`. The pre/post
recovery snapshots prove the receiver state, focus restoration, and reduced
draft, but `cleanup-dispatch-entered` was not emitted.

The next instrumentation distinguishes:

- whether the scenario returned a non-empty Conversation and Turn identity;
- whether the shared cleanup branch saw `scenarioFacts` and the current
  Conversation identity;
- whether authoritative Conversation deletion completed;
- which of `draftCleared`, `localProjectionCleared`, and
  `conversationDeleted` reached the final assertion input.

No cleanup, assertion, timeout, matrix, or product behavior changes.

## Iteration 5: Canonical Cell ID Root Cause

Exact-source Foundation run
`20260912T125854097224Z-4aadb1165f439562306772b14ce522c5`
on `08d16193949cd19757c099302fa25dda35dfb836` reproduced Browser English
`BASE-CONTEXT_OVERFLOW / cleanupComplete`. The pre/post recovery observations
were correct, while no cleanup-branch observation was emitted.

Source inspection confirms hypothesis I. The matrix and evaluator use
`BASE-CONTEXT_OVERFLOW`, but the shared deletion, telemetry, result, and
assertion-input branches checked the non-canonical
`BASE-CONTEXT-OVERFLOW`. The scenario therefore returned its intentional
pre-deletion `conversationDeleted=false`, skipped authoritative deletion and
cleanup fact enrichment, and failed `cleanupComplete`.

The owner-layer fix replaces only those four stale comparisons with the
canonical matrix ID and adds a static regression that rejects the hyphenated
alias. The Gate matrix, timeout, assertions, provider, and cleanup requirements
remain unchanged.

## Iteration 6: Controlled Composer Draft Writeback

Exact-source Foundation run
`20260912T144543109509Z-bc0f12ef86eccfff0a1261c8526c6f7b`
on `b4d086986beb22cf7bcd345157d7b10e69d2efcf` reached Browser English
`BASE-CONTEXT_OVERFLOW` and failed only `cleanupComplete`.

The retained events establish the transition:

- `scenario-cleanup-sampled`: `draftCleared=true`,
  `localProjectionCleared=true`;
- `cleanup-dispatch-entered`: `draftCleared=false`,
  `localProjectionCleared=true`, `conversationDeleted=false`;
- `cleanup-deletion-completed`: `draftCleared=false`,
  `localProjectionCleared=true`, `conversationDeleted=true`;
- `assertion-input`: `draftCleared=false`,
  `localProjectionCleared=true`, `conversationDeleted=true`.

| ID | Hypothesis | Likelihood | Effort | Expected Signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| J | Harness mutates the controlled textarea DOM without updating the `ChatInput` draft owner, so React later writes the retained reduced draft back. | High | Low | DOM is empty immediately, then becomes non-empty without a new Harness fill request; `ChatInput` remains controlled by local `input` state. | Confirmed: runtime transition above plus `ChatInput.tsx` binds `value={input}` while the Harness uses the native textarea setter. |
| K | A pending `composerFill` request writes the reduced draft after cleanup. | Low | Low | The reduced draft is requested through `fillComposer` and consumed after cleanup starts. | Rejected: the scenario uses the DOM setter for the reduced draft; no reduced-draft `composerFill` request exists. |
| L | A session-key transition restores the reduced draft from `topicDraftRef`. | Medium | Medium | `currentSessionKey` changes between scenario cleanup and shared deletion. | Not required to explain the observed writeback; no session selection occurs in that interval. |
| M | Conversation deletion or local projection cleanup restores the draft. | Low | Low | Draft changes only after deletion/projection mutation. | Rejected: draft is already non-empty before deletion starts while local projection cleanup remains true. |

The broken state is the client-local composer draft. `ChatInput` is its owner,
and `useChatStore.fillComposer()` is the existing production request channel
that updates that owner. The Harness must use that channel for reduced and empty
draft transitions and wait for both request consumption and controlled DOM
commit before recording cleanup. Direct prototype-setter mutation is not an
authoritative product action and must be removed from this scenario.

The local correction now does that for the reduced draft, normal cleanup,
scenario-failure cleanup, and outer cleanup. Static coverage rejects restoring
the prototype setter. Post-fix exact-source runtime evidence is pending; this
session remains `[OPEN]`.

## Iteration 6 Local Verification

- Agent Acceptance tests: `418/418` PASS.
- Agent native static tests: `85/85` PASS.
- Desktop Vitest: `622/622` PASS with one existing environment-only skip.
- Desktop strict check: PASS.
- Desktop production build: PASS.
- Acceptance planner, Provisioner, runner, validator, responsibility-boundary,
  Gap Detector, coverage, and quality self-tests: PASS.
- `git diff --check`: PASS.

## Iteration 7: Composer Owner Commit Ordering

Exact-source C08 run
`20260912T154305828038Z-5576a1b0184154cc2ea5f09b08bc5c40`
on `7c10521a51d521f30cf36c0173171e4175d0b418` is
`DONE / PROVEN`. The same-source Foundation run
`20260912T154441125137Z-e0e1b6e88414d48337d349c72bc4883c`
again failed only Browser English `BASE-CONTEXT_OVERFLOW /
cleanupComplete`.

Post-fix telemetry still records:

- `scenario-cleanup-sampled`: `draftCleared=true`;
- `cleanup-dispatch-entered`: `draftCleared=false`;
- `cleanup-deletion-completed`: `conversationDeleted=true`;
- `assertion-input`: only `draftCleared=false`.

The first owner-path correction therefore proves that request consumption plus
one empty DOM observation is not yet a stable composer-owner acknowledgement.
The following hypotheses are now active:

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| N | `composerFill` is consumed before the controlled `input` state and per-session draft cache commit atomically. | High | Low | Empty fill is observed and consumed, then the committed input returns to the previous non-empty length. |
| O | A later `currentSessionKey` effect restores the stale reduced draft from `topicDraftRef`. | High | Low | A session-draft restore occurs after empty fill consumption with a non-empty restored length. |
| P | The scenario's textarea reference is detached and the active controlled node retains the old value. | Medium | Low | The Harness reports `isConnected=false` or the current query no longer equals the captured node. |
| Q | A native input event or another composer-fill request restores the old draft. | Low | Low | A later input handler or non-empty fill request appears after empty cleanup. |

The next change is instrumentation-only in `ChatInput` and the Harness. It
records lengths, booleans, and state-transition kinds only; no draft text,
session identity, actor identity, or credential is emitted.
