# Gate Execution Summary

> **Projection status**: `UNPROVEN`
> **Authority**: human-readable projection only
> **Formal source**: sealed `EvidenceReport` and immutable Evidence Store refs

Do not replace `UNPROVEN` with `PROVEN` manually. Formal proof status is derived
by the Runner and proof reader after source, assertions, cleanup, finalizers,
and evidence freshness are validated.

## Identity

- Gate:
- Run ID:
- Source identity:
- Workspace identity:
- Execution mode:
- Runtime cell:
- Environment/Profile:
- Started at:
- Finished at:

## Requested Scope

- Requested Capability/Feature/Gate scope:
- Resolved prerequisite closure:
- Explicit exclusions:
- Nonclaims:

## Execution

- Command/entrypoint:
- Execution-input owner and digest:
- Provisioned resources:
- Reused prerequisites:
- Operations performed:
- Cleanup/finalizers:

## Result Tuple

- Status: `UNPROVEN`
- Completion:
- Proof:
- Cleanup:
- Formal reason code:

## Assertions

- Required observations:
- Passing assertions:
- Failed assertions:
- Missing observations:

## Immutable Evidence

- Run manifest ref:
- EvidenceReport ref:
- Source attestation ref:
- Runtime manifest ref:
- Assertion artifact refs:
- Cleanup/finalizer refs:
- Report digest:

## Timing And Resources

- Total duration:
- Critical path:
- Gate duration:
- Provisioning duration:
- Operation duration:
- Cleanup/publication duration:
- Lock wait/hold:
- Budget outcome:

## Failure Ownership

- First failed stage:
- Root owner:
- Failure classification:
- Diagnostic evidence refs:
- Repair validation refs:

## Residual Gaps

- Unexecuted scope:
- Unsupported cells/topologies:
- Missing business injection:
- Evidence freshness limitations:
- Follow-up owner:

## Verdict

State what the sealed report proves and what remains `UNPROVEN`. Cite immutable
references. Do not infer product readiness from command success, framework
self-tests, reusable prerequisites, or this summary.
