# Agent LobeHub Fullstack Parity - PLAN-P5 Implementation Control Board

> **Status**: blocked-before-confirmed-prototype
> **Version**: v0.2
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P5 control preparation
> **Prepared Evidence**: EVID-011-O-pre, EVID-011-AB-pre
> **Depends On**: Owner confirmation after EVID-010-PROTOTYPE-REBUILD-N

---

## 1. Purpose

This control board centralizes execution order, entry gates, evidence targets, verification commands and claim boundaries for PLAN-P5.

It does not start product migration. It exists so every implementation batch can be entered with a predeclared BOM/Spec/Gate/Evidence contract.

## 2. Global Entry Gate

PLAN-P5 remains blocked while the replacement high-fidelity prototype is `pending-review` but not Owner-confirmed.

EVID-010 can record one of:

- `CONFIRMED`: start M1 through `m1-implementation-kickoff.md`.
- `REVISION REQUIRED`: keep product migration blocked unless Owner explicitly allows contract-only M1 work.
- `SUPERSEDED`: stop this migration path and create a replacement prototype gate.

EVID-010-PROTOTYPE-RESET records that the rejected prototype was removed. Historical prototype evidence is not implementation permission.

EVID-010-PROTOTYPE-REBUILD-N records that `agent-lobehub-parity` reached `pending-review`. This is review permission only, not implementation permission.

No implementation evidence from EVID-012 to EVID-021 may be recorded as successful before the prototype is confirmed.

Decision input:

- `docs/architecture/agent/lobehub-parity/owner-decision-status-snapshot.md`
- `docs/architecture/agent/lobehub-parity/plan-p5-entry-gate.md`
- `EVID-010-PROTOTYPE-REBUILD-N` in `tmp/agent-lobehub-fullstack-ledger.md`

## 3. Batch Control Table

| Batch | Evidence | Depends On | Primary Owner | Gate | Current Status | First Document |
| --- | --- | --- | --- | --- | --- | --- |
| M0 Prototype confirmation | EVID-010-PROTOTYPE-REBUILD-N / Owner confirmation TBD | EVID-008, EVID-009, EVID-010, EVID-010-PROTOTYPE-RESET | Owner | GATE-003/GATE-004 | pending-owner-review | `docs/architecture/agent/prototype-lobehub-parity/README.md` |
| M1 Contract foundation | EVID-012 | accepted new high-fidelity prototype | Model + Station + Desktop | GATE-005/GATE-006/GATE-007/GATE-008 | blocked | `m1-implementation-kickoff.md` |
| M2 Desktop runtime shell | EVID-013 | EVID-012 | Desktop Web | GATE-004/GATE-006/GATE-008 | not-started | `desktop-runtime-shell.md` |
| M3 Provider/model correctness | EVID-014 | EVID-013 | Provider Runtime + Desktop | GATE-005/GATE-008 | not-started | `provider-model-correctness.md` |
| M4 Session/topic/message runtime | EVID-015 | EVID-014 | Station + Desktop Rust + Desktop Web | GATE-006/GATE-008 | not-started | `session-topic-runtime.md` |
| M5 Agent config/profile parity | EVID-016 | EVID-015 | Station + Desktop | GATE-006/GATE-008 | not-started | `agent-config-profile.md` |
| M6 Memory projection parity | EVID-017 | EVID-016 | Station + Desktop | GATE-006/GATE-008 | not-started | `memory-projection-parity.md` |
| M7 Knowledge/files parity | EVID-018 | EVID-017 | Station + Desktop Rust + Desktop | GATE-006/GATE-008 | not-started | `knowledge-files-parity.md` |
| M8 Tool/plugin/skill parity | EVID-019 | EVID-018 | Station + Desktop Rust + Desktop | GATE-006/GATE-008 | not-started | `tool-plugin-skill-parity.md` |
| M9 Error recovery/diagnostics | EVID-020 | EVID-019 | Station + Desktop | GATE-008 | not-started | `error-recovery-diagnostics.md` |
| M10 Actor#agent reserved alignment | EVID-021 | EVID-020 | Model + Station | GATE-007/GATE-008 | not-started | `actor-agent-reserved-contract.md` |

## 4. Required Evidence State Machine

Allowed transitions:

```text
blocked -> in-progress -> implemented -> verified
blocked -> deferred
in-progress -> blocked
in-progress -> deferred
```

Rules:

- `verified` requires deterministic commands and manual acceptance evidence where the batch requires browser/runtime behavior.
- `implemented` is allowed only when code changes exist and compile/check evidence passes for the touched layers.
- `in-progress` must name target paths and checks before product edits.
- `deferred` must name the replacement evidence or later batch.
- A failed check keeps the batch `in-progress` or moves it to `blocked`; it must not be recorded as `implemented`.

## 5. Verification Command Matrix

| Touched Layer | Required Command Or Evidence |
| --- | --- |
| Proto/model contracts | `./model/build.sh` |
| Desktop Web | `pnpm --dir apps/desktop run check` |
| Desktop Rust bridge | `cd apps/desktop/src-tauri && cargo test` or a narrower recorded Cargo command |
| Station Agent service | `cd apps/station && go test ./app/subserver/agent/...` or a narrower recorded Go command |
| Prototype | `make run-prototype` plus browser review evidence |
| Runtime/browser interaction | Browser acceptance notes or screenshot/report paths tied to the batch |
| Cross-layer event behavior | Station test + Rust bridge test + Desktop projection check, unless explicitly out of scope |

## 6. Batch Entry Checklist

Before editing product code for any PLAN-P5 batch:

1. Confirm all dependency evidence rows exist.
2. For EVID-012, satisfy `plan-p5-entry-gate.md`; for later batches, satisfy dependency gates and create/update the batch working evidence row in `tmp/agent-lobehub-fullstack-ledger.md`.
3. List target paths.
4. Run `pt-read-before-edit` knowledge scan for product paths.
5. Re-read the batch spec and this control board.
6. Confirm forbidden relationships are not violated.
7. Name deterministic checks before editing.

## 7. Forbidden Claim Shortcuts

Do not claim:

- GATE-008 from docs-only evidence.
- Provider/model correctness until product code rejects or disambiguates duplicate model IDs by provider.
- Runtime parity until typed events, abort, retry, reconcile and error states are verified in the product path.
- Memory/Knowledge/Tool parity from mock prototype tabs.
- Actor#agent readiness from reserved architecture alone.
- Desktop readiness from Station-only tests, or Station readiness from Desktop-only checks.

## 8. Minimum Evidence Row Template

```md
| <EVID-ID> | <BOM-ID> | <SPEC-ID> | PLAN-P5 / <M#> | <GATE-ID> | paths: `<changed paths>`; commands: `<commands>`; acceptance: `<manual/browser evidence if any>` | <implemented/verified result> | <unproven scope and next evidence> |
```

## 9. Current Control Claim

PLAN-P5 has an execution control board and M1 kickoff package.

Product migration is still not started. The rejected prototype was deleted; the replacement prototype is pending Owner review and must become `confirmed` before implementation.
