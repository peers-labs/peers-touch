# Debug Session: base-credential-runtime-event
- **Status**: [OPEN]
- **Issue**: `BASE-CREDENTIAL_MISSING` fails because the emitted
  `runtime-events` role does not match the observed credential rejection.
- **Debug Server**: http://127.0.0.1:7789/event
- **Log File**: `.dbg/trae-debug-log-base-credential-runtime-event.ndjson`

## Reproduction Steps
1. Use the bound `peers-ai-agent` worktree and `chat-native-disposable`.
2. Run the unchanged `agent-v2-kernel-foundation-e2e` Gate with the approved
   profile, restart, and disposable authorizations.
3. Observe Browser English `BASE-CREDENTIAL_MISSING`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| J | The scenario returns the post-cleanup attestation event instead of the credential rejection event. | Confirmed | Low | Runtime evidence showed scenario `error / PROVIDER_CREDENTIAL_MISSING` versus returned `done` from another conversation. |
| K | Candidate role serialization mutates a correct credential event. | Rejected | Low | The mismatch already exists before candidate serialization. |
| L | The Python oracle expects fields not emitted by the TypeScript scenario contract. | Rejected | Low | The oracle expectation matches `facts.runtimeEvent`; the top-level return was wrong. |
| M | Source-delivery identity or payload hashing diverges before role assembly. | Rejected | Low | Event ID, conversation identity, and payload hash differ because the returned event is the attestation event. |

The first change is instrumentation only. No scenario result, Gate assertion,
matrix tuple, timeout, or cleanup behavior changes.

## Execution Notes

- Run `20260908T030131873316Z-d81b20246d0084c261ce2a5a23b2de02`
  failed before `BASE-CREDENTIAL_MISSING` at
  `BASE-ACTIVE_MUTATION_CONFLICT`.
- Root cause: the instrumentation block was attached to the wrong repeated
  `runFoundationDirectAttestationTurn` return boundary. That scenario has no
  credential `facts.runtimeEvent`, so the probe raised
  `agent.acceptance.foundationCredentialMissingRuntimeEventMissing`.
- This is an instrumentation placement defect, not product evidence for or
  against J-M. Cleanup completed `DONE / PROVEN / passed`.
- The probe has been relocated to
  `runFoundationCredentialMissingScenario` without changing scenario output.
- Exact-source run
  `20260908T033604748910Z-e1de9eda72f09ed1e723b09771320057`
  captured:
  - scenario event: `error / PROVIDER_CREDENTIAL_MISSING`,
    empty source Turn, source sequence `0`;
  - returned event: `done`, non-empty source Turn, different conversation,
    event ID, and payload hash.
- Root fix: the scenario now returns its observed credential rejection as the
  `runtimeEvent`; the successful attestation remains responsible for the
  readback conversation and Turn identifiers.
- Post-fix instrumentation now reports the actual outgoing `runtimeEvent` with
  `runId=post-fix`, so the next exact-source run can compare the same return
  boundary against the pre-fix J evidence without changing scenario behavior.

## Post-Fix Runtime Evidence

- Exact-source run
  `20260908T043330745234Z-38d98efe6f7911850fc19b1213f56064` on
  `3718bc254b364b13c6578fa3598403db361f66be` captured one `post-fix`
  return-boundary event.
- The scenario and returned event are both
  `error / PROVIDER_CREDENTIAL_MISSING`, retain an empty source Turn and source
  sequence `0`, and match on event ID, source conversation, and payload hash.
- The prior runtime-event ownership mismatch is fixed. The Gate advanced to
  candidate evidence sanitization and then rejected the non-secret schema field
  `station-readback.credentialStatus`; cleanup completed
  `DONE / PROVEN / passed`.
- The candidate producer now allowlists only the exact
  `credentialStatus` schema field while retaining recursive value scanning.
  Focused producer and Foundation suites pass `15/15` and `132/132`.
- The session remains `[OPEN]` until the sanitizer correction is exercised by
  another exact-source Gate run.
