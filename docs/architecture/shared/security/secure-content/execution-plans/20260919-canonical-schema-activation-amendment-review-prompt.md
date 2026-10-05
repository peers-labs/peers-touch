# Secure Content Canonical Schema Activation Amendment - Review Prompt

> **Status**: completed - Owner accepted `SC-D24`
> **Version**: v1.2
> **Created**: 2026-09-19 | **Updated**: 2026-09-19
> **Owner**: Architecture Team

---

## Owner Decision

The Owner supplied a conditional instruction to explicitly accept SC-D24 when
the independent verdict was `PASS`. The verdict below passed after the
maintenance authentication, replay, cancellation, supersession, and
attestation gaps were corrected.

On 2026-09-19, the Owner therefore accepted `SC-D24` at review checkpoint
`83f5f24d53a6a50f5dd59c1820832ab09ecf4346` and authorized the mechanical
execution-plan, task-slice, work-item, Journey, declaration, and tracking
amendments required by the accepted decision.

This acceptance does not authorize implementation, either destructive reset,
push, pull-request creation, history rewrite, W7 `FUNCTIONAL_PASS`, W12
`FUNCTIONAL_PASS`, or formal Acceptance. Those remain governed by the amended
plan and its review gate.

---

## Review Verdict

```text
Verdict: PASS

Findings:
- No blocking architecture findings remain.

Decision checks:
- verified runtime contradiction: PASS
- no compatibility or parallel truth: PASS
- reset owner and non-public maintenance boundary: PASS
- exact authorization and lease boundary: PASS
- activation versus final-cut separation: PASS
- schema-attestation completeness: PASS
- SC-D23 allowlist/public/object/journal preservation: PASS
- plan handoff is mechanically derivable: PASS
```

The review required and incorporated two corrections:

1. SC-D24 now explicitly supersedes only SC-D23's W12-exclusive timing clauses.
2. The maintenance boundary now defines OS-authenticated SSH invocation,
   inherited Local Dev lease possession, scope-wide remote advisory locking,
   journal-bound exact replay, conflicting-replay rejection, and
   cancellation/resume behavior without another bearer secret or truth store.

Residual implementation obligations are not design blockers:

- prove the SSH/lease process tree and scope-wide advisory lock under
  cancellation and competing invocation;
- prove exact replay and conflicting invocation behavior;
- prove source/runtime/service-attestation drift invalidates schema admission;
- prove activation cannot satisfy final-cut or W12 evidence.

The verdict itself did not accept SC-D24 or authorize implementation or reset;
the separate Owner Decision above records acceptance.
Acceptance Gap Detector remains `UNPROVEN`, as required: this review makes no
product, runtime, Gate, or Acceptance proof claim.

---

Review proposed `SC-D24` in:

- `docs/architecture/shared/security/secure-content/decisions.md`
- `docs/architecture/shared/security/secure-content/design.md`
- `docs/architecture/shared/security/secure-content/data-model.md`
- `docs/architecture/shared/security/secure-content/integration.md`
- `docs/architecture/shared/security/secure-content/operations.md`

Upstream accepted constraints:

- `SC-D10`: no legacy plaintext or bespoke-crypto compatibility path.
- `SC-D17`: Social owns durable private prepare/submit state.
- `SC-D22`: product evidence uses one owner-produced runtime manifest.
- `SC-D23`: private Development reset uses exact targets, owner-mediated
  deletion, public snapshot preservation, one journal, and no mixed-schema
  preservation.
- Local Dev Control Plane owns workspace/profile/resource declarations and
  `station.reset` leases.

## Verified Runtime Contradiction

1. W7 exact-source checkpoint
   `ec5c5150501d78d61b7bdf78eb9ba7657dc5d9d5` reaches the first canonical
   `SocialPrivateContentPost` insert.
2. Prepare, Content PreKey claim validation, sender envelope verification,
   snapshot revalidation, and Station commit-proof construction all succeed
   before that insert.
3. The live `four` PostgreSQL `social_private_posts` table retains
   plaintext-era columns `id`, `author_id`, `type`, and `audience_kind` as
   `NOT NULL` without defaults.
4. The canonical encrypted Post model does not and must not populate those
   retired fields.
5. SC-D23 assigns canonical table rebuild to W12 after W11, but W7 and W11
   require canonical private Post writes before W12.
6. W12 still records `DESIGN_AMENDMENT_REQUIRED` for its authenticated
   owner-controlled maintenance command.

## Proposed SC-D24

1. Reuse one SC-D23 reset implementation and closed allowlist; do not add a
   migration, compatibility writer, alternate table, or direct SQL runner.
2. Supersede only SC-D23's W12-exclusive task timing. The accepted profiles,
   scopes, allowlists, dependency order, public snapshot, journal, failure
   behavior, and final W12 evidence meaning remain unchanged.
3. Local Dev Control Plane authenticates exact workspace, plan task, source,
   destructive scope, and live `station.reset` lease.
4. The Secure Content Development reset owner owns immutable manifest,
   quiescence, journal, and orchestration.
5. A non-public, OS-authenticated Station maintenance CLI composes Social
   database reset and OSS object deletion. Its local SSH transport is a direct
   child of the generic `machine-dev` lease wrapper, which retains the
   inherited reset lock.
6. Each CLI attempt receives a bounded `SecureContentResetInvocationV1` over
   SSH stdin. It validates declaration, plan/task, source, environment, scope,
   intent, manifest, and expiry, then acquires a database advisory lock keyed
   by environment and scope. The journal records accepted invocation IDs and
   digests; exact replay returns current state and a conflicting digest for one
   invocation ID fails. No network route or reusable bearer exists.
7. Add two separately authorized reset intents:
   - `SCHEMA_ACTIVATION`: complete SC-D23 reset on `four` and `fiveArm` for the
     exact source/runtime checkpoint before any private Social Journey.
   - `FINAL_CUT`: execute a fresh SC-D23 reset after W11 readiness, then rerun
     the complete product matrix.
8. Each reset run has a fresh reset ID, immutable manifest, journal,
   declaration, exact scope authorization, and lease. Retry attempts preserve
   the reset ID and manifest but use fresh invocation IDs. Activation cannot be
   relabelled as final-cut evidence.
9. Cancellation before database commit rolls back. Cancellation, timeout,
   disconnect, or lease loss after a durable transition leaves Station
   quiesced and resumes only from the same manifest with a fresh invocation ID.
10. A completed invocation emits
   `CanonicalPrivateSchemaAttestationV1`, binding source, workspace, profile,
   deployment environment, destructive scope, Station service/peer/runtime
   identity, service attestation, reset intent, reset manifest, completed
   journal, canonical schema digest, retired-column absence, and public
   snapshot.
11. Every private Social Development Runtime Manifest must bind one current
   schema attestation per Station service before client launch.
12. Missing or mismatched attestation returns
   `CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE` before the first product action.
   Source/runtime/service-attestation/schema drift requires fresh activation.
13. The plan may be amended only after review and explicit Owner acceptance:
    implement the shared reset owner and schema attestation, execute activation
    before W7, retain final cut and matrix after W11, and preserve all current
    W7-W13 evidence meanings.

## Rejected Alternatives

- Populate legacy `id`, `author_id`, `type`, or `audience_kind`.
- Make retired columns nullable or add defaults until W12.
- Add a second canonical private Post table and swap later.
- Point W7 at an undeclared fresh database or profile.
- Treat schema inspection, manual DDL, or a partial reset as product evidence.
- Move the final W12 product result wholesale before W7.

## Review Questions

1. Does the proposal resolve the W7/W12 dependency cycle without creating a
   compatibility path or parallel Social truth?
2. Is one non-public Station maintenance entrypoint the correct mutation owner
   while Local Dev Control Plane retains authorization and lease truth?
3. Do the two reset intents preserve SC-D23's exact allowlist, public snapshot,
   object ownership, journal, and partial-failure semantics?
4. Does the schema attestation prevent product Journeys from starting against a
   mixed or stale schema?
5. Is it explicit that activation does not satisfy final cut, W12
   `FUNCTIONAL_PASS`, or formal Acceptance?
6. Are repeated destructive invocations independently authorized and
   auditable?
7. Does the proposal preserve consumed Key Exchange one-time keys and avoid any
   reset of non-Social authority?
8. Are there any missing authentication, retry, cancellation, or restart
   semantics for the owner-controlled maintenance command?
9. Does SC-D24 clearly supersede only SC-D23's W12-exclusive timing without
   weakening any accepted destructive invariant?

## Required Verdict

Return:

```text
Verdict: PASS | HOLD | REJECT

Findings:
- severity
- exact source reference
- violated invariant or missing semantic
- required correction

Decision checks:
- verified runtime contradiction: PASS | HOLD
- no compatibility or parallel truth: PASS | HOLD
- reset owner and non-public maintenance boundary: PASS | HOLD
- exact authorization and lease boundary: PASS | HOLD
- activation versus final-cut separation: PASS | HOLD
- schema-attestation completeness: PASS | HOLD
- SC-D23 allowlist/public/object/journal preservation: PASS | HOLD
- plan handoff is mechanically derivable: PASS | HOLD
```

A `PASS` means `SC-D24` is internally consistent and ready for explicit Owner
acceptance. It does not accept the decision, authorize a destructive reset,
authorize implementation, establish W7/W12 `FUNCTIONAL_PASS`, or permit push,
pull-request creation, or history rewrite.
