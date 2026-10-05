# MCA-D22 Capability Scenario Control Plane Review

> **Status**: review-complete
> **Created**: 2026-09-18 | **Updated**: 2026-09-18
> **Owner**: Peers-Touch Agent Team

---

Review:

`docs/architecture/domains/agent/modern-chat-agent/proposals/20260918-mca-d22-capability-scenario-control-plane.md`

against:

- `product-definition.md`
- `experience-contract.md`
- `product-state-model.md`
- `design.md`
- `decisions.md`
- `data-model.md`
- `integration.md`
- MCA-D21 runtime-truthful formal evidence
- `tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml`
- `tasks/MCA-A03.md`

## Verified Trigger

- J02 requires 69 independently executed tuples.
- The current J02 runner executes one composite Native flow.
- Model declares catalog and binding error enums that Station does not emit.
- The public capability API has no generic manifest-registration operation.
- Several reviewed error and taxonomy cells therefore have no deterministic
  runtime path.
- Reusing the composite capture, static tests, or labels would violate MCA-D21.

## Required Review

1. Station remains the only capability manifest, binding, readiness, and
   failure authority.
2. Scenario control is setup/barrier/cleanup only and cannot emit a verdict or
   evidence role.
3. Scenario control is unavailable outside an explicitly enabled Acceptance
   environment.
4. No generic production manifest-registration endpoint is introduced.
5. Catalog and binding failures use exact typed codes, locale keys,
   retryability, terminality, and safe details.
6. Desktop and Browser observe failures through canonical product surfaces and
   APIs.
7. The six taxonomy states are executed independently and preserve the
   `pending` client-state versus Station-readiness distinction.
8. AS-10 uses a secondary actor plus distinct device/session identities without
   changing the candidate-wide primary actor identity.
9. Mobile contract tuples run one source-bound test invocation each.
10. AS-16 uses only scoped hard-cut checks and emits no product-runtime claim.
11. Cleanup is idempotent, run-scoped, and mandatory.
12. The 69-tuple matrix and MCA-D21 anti-fabrication rules remain unchanged.

## Required Verdict

Return one:

```text
APPROVE MCA-D22
```

or:

```text
REQUEST CHANGES MCA-D22: <blocking findings>
```

## Verdict

```text
APPROVE MCA-D22
```

The Owner accepted MCA-D22 on 2026-09-18.
