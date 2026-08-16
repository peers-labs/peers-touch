# Acceptance Gap Detection Procedures

## Inputs

- Exact completion or proof claim.
- Git range or explicit changed paths.
- `tooling/acceptance/reports/latest-plan.json`.
- `tooling/acceptance/reports/latest-run.json`.
- Feature, Capability, Domain, Registry, Gate, Runtime Manifest, and source
  evidence referenced by the claim.

## Procedure

### 1. Product Promise

Identify the receiver, visible surface, owning truth, and runtime cell. Reject a
claim that is broader than its Feature/Capability assertion.

### 2. Gate Coverage

Verify:

- changed owned paths map to the correct Feature;
- Capability-required Gates are selected;
- receiver-visible state changes select receiver-proof Gates;
- no cheaper Gate substitutes for a required runtime Gate;
- every non-local Gate that declares a Provisioner has a Runtime Manifest.

### 3. Evidence Integrity

For each required Gate require:

- actual execution, not dry-run;
- `status=passed`, `completionStatus=DONE`, and `proofStatus=PROVEN`;
- source artifact, runtime/build identity, actor identity, and current run ID;
- `FIXTURE_READY` Runtime Manifest for provisioned Gates;
- current source commit and runtime cell;
- redacted evidence with no credential values.

### 4. Failure Honesty

Keep these states distinct:

| State | Meaning | Allowed claim |
|---|---|---|
| `PASSED/PROVEN` | Required Gate completed with valid source evidence | Exact asserted scope only |
| `BLOCKED/UNPROVEN` | Precondition or environment prevented Gate execution | Environment gap only |
| `FAILED/UNPROVEN` | Product assertion or execution failed | Failure observed |
| `UNPROVEN` | Gate absent, unrun, stale, partial, or invalid | No product claim |

Do not retry, downgrade, substitute, or edit evidence to change the state.

## Bypass Pattern Matrix

| # | Pattern | Detection | Required closure |
|---|---|---|---|
| 1 | Mock API | Fixture/mock server replaces Station/Desktop | Run real declared runtime |
| 2 | Single actor | Two-actor claim has one client/identity | Provision isolated actors |
| 3 | Stale evidence | Commit/run/runtime identity differs | Execute fresh Gate |
| 4 | Hardcoded PTID | Literal production actor identity in runner | Consume Actor Manifest |
| 5 | Gateway-only receipt | No native sender-visible receipt proof | Run native two-client Gate |
| 6 | Provisioning skipped | No Runtime Manifest for provisioned Gate | Run Provisioner first |
| 7 | Screenshot-only | Image without source/runtime trace | Produce Gate evidence |
| 8 | Exit-code proof | Exit zero but proof metadata incomplete | Validate evidence artifact |
| 9 | Unit-as-E2E | Unit/static check claims product journey | Run product Gate |
| 10 | Debug-log proof | Console/log observation is sole evidence | Add stable assertion |
| 11 | API-as-native | API result claims native DOM behavior | Run native receiver Gate |
| 12 | Forged attestation | Gate/Agent authored Station identity | Use deployment producer |
| 13 | Profile mismatch | Filename and `PT_DEV_PROFILE` differ | Repair/activate profile |
| 14 | Credential literal | Secret appears in code/command/report | Use CredentialRef |
| 15 | Selective journey | Required steps/assertions omitted | Run full Gate |
| 16 | Edited evidence | Artifact changed after producer run | Regenerate from runner |
| 17 | Dry-run pass | Planning output presented as proof | Execute Gate |
| 18 | Wrong worktree | Evidence source path/commit differs | Run in owning worktree |
| 19 | Build-as-product | Compile/typecheck claims behavior | Run product Gate |
| 20 | Claim without command | No execution/evidence artifact | Run required Gate |
| 21 | Cleanup skipped | Process/port/storage/session residue | Complete cleanup audit |
| 22 | Fake actor fixture | Actor data is fabricated or copied | Use Domain Fixture |
| 23 | Tier downgrade | Required env Gate moved to cheap tier | Restore declared tier |
| 24 | Blocked-as-passed | Provisioning blocker ignored | Keep BLOCKED/UNPROVEN |
| 25 | Swallowed failure | Exception hidden or exit forced zero | Propagate structured failure |

## Commands

```bash
python3 tooling/scripts/acceptance-gap-detect.py \
  --claim "<claim>" \
  --range <range>

python3 tooling/scripts/acceptance-gap-detect-test.py
```

The default detector execution is read-only and writes no artifact. Use
`--output` only when a review workflow explicitly requires a report file.

## Artifacts

The detector emits an `acceptance-gap-report` JSON object containing:

- claim and proof state;
- changed paths;
- selected and required Gates;
- zero or more `acceptance-gap` entries;
- gap type, owner stage, source evidence, and required closure.

## Failure States

- `RECEIVER_PROOF_GATE_NOT_SELECTED`
- `REQUIRED_GATE_NOT_RUN`
- `GATE_BLOCKED_BY_ENVIRONMENT`
- `GATE_EVIDENCE_UNPROVEN`
- `RUNTIME_MANIFEST_MISSING`
- `ACCEPTANCE_GAP_DETECTOR_INPUT_INVALID`

Any failure keeps the claim `UNPROVEN` and dispatches closure to
`pt-acceptance-engineering`.

## Exit Criteria

- Every required Gate has current source-bound `DONE/PROVEN` evidence.
- Provisioned Gates include a matching `FIXTURE_READY` Runtime Manifest.
- No bypass pattern applies.
- The final claim is no broader than the proven receiver/runtime assertion.
