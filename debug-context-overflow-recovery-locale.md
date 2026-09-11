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

## Local Verification
- Desktop strict check: PASS.
- Focused Foundation static/oracle tests: `234/234` PASS.
- `git diff --check`: PASS.
