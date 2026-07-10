# Agent LobeHub Fullstack Parity - M1 Implementation Kickoff

> **Status**: blocked-before-confirmed-prototype
> **Version**: v0.2
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Model + Station + Desktop
> **Plan Step**: PLAN-P5 / M1 kickoff preparation
> **Prepared Evidence**: EVID-011-O-pre, EVID-011-AB-pre
> **Implementation Evidence**: EVID-012
> **Depends On**: Owner confirmation for EVID-010-PROTOTYPE-REBUILD-N `agent-lobehub-parity`

---

## 1. Purpose

This document is the operational kickoff packet for M1 Contract And Identity Foundation.

It is not implementation permission. Product edits remain blocked because `agent-lobehub-parity` is only `pending-review`, not Owner-confirmed; M1 can start only after the prototype is confirmed or Owner explicitly allows contract-only M1 work.

## 2. Entry Gate

M1 may start only when all conditions are true:

| Condition | Required Evidence | Current Status |
| --- | --- | --- |
| Replacement prototype is confirmed or contract-only M1 is explicitly authorized | Owner confirmation for EVID-010-PROTOTYPE-REBUILD-N or Owner exception | blocked |
| M1 contract scope is selected | `contract-foundation.md` plus this document | prepared |
| Evidence target is predeclared | EVID-012 | prepared |
| Target paths and checks are known | this document | prepared |
| Product code edits are authorized by BOM/Spec/Gate binding | ledger row for EVID-012 | blocked until confirmed |

`plan-p5-entry-gate.md` is the hard pre-edit gate after Owner confirmation and before the EVID-012 working row can authorize product changes.

If `agent-lobehub-parity` remains `pending-review`, is rejected, or is `SUPERSEDED`, this kickoff remains blocked unless the Owner explicitly allows M1 contract work to proceed independently.

## 3. BOM / Spec / Gate Binding

| Field | Binding |
| --- | --- |
| BOM | BOM-013, BOM-014, BOM-015 |
| Spec | SPEC-003, SPEC-004, SPEC-006, SPEC-007, SPEC-008, SPEC-009, SPEC-011, SPEC-012, SPEC-013 |
| Plan Step | PLAN-P5 / M1 |
| Gate | GATE-005, GATE-006, GATE-007, GATE-008 |
| Prepared Evidence | EVID-011-A-pre, EVID-011-J-pre, EVID-011-K-pre, EVID-011-L-pre |
| Implementation Evidence | EVID-012 |

## 4. Target Impact Surface

M1 is contract-first. It must not start from Desktop UI, page layout, or Station business behavior.

| Layer | Target Paths | M1 Role |
| --- | --- | --- |
| Proto source | `model/domain/agent/agent.proto`, possibly split files under `model/domain/agent/` | Define canonical refs/events/resources/reserved contracts. |
| Model generation | `model/build.sh`, `packages/model/buf.yaml`, `packages/model/buf.gen.yaml` | Generate supported Go/TS outputs from proto source. |
| Station generated output | `apps/station/app/subserver/agent/model/*.pb.go` | Generated only; do not hand edit. |
| Desktop generated output | `apps/desktop/src/gen/proto/domain/agent/*_pb.ts` | Generated only; do not hand edit. |
| Station compatibility adapters | `apps/station/app/subserver/agent/service/`, `apps/station/app/subserver/agent/domain/` | Map old fields to new contracts without changing product behavior broadly. |
| Desktop Rust bridge compatibility | `apps/desktop/src-tauri/src/application/agent_turn/`, `apps/desktop/src-tauri/src/interface/tauri_commands/agent_turn.rs` | Accept or forward new contract fields only if needed for compilation/compatibility. |
| Desktop Web contract consumers | `apps/desktop/src/services/`, `apps/desktop/src/store/` | Add type alignment only; full runtime/store migration belongs to M2/M3/M4. |

## 5. M1 Work Order

1. Record revised prototype acceptance or explicit contract-only authorization in the ledger.
2. Create the EVID-012 working row before product edits.
3. Inspect path-owned knowledge for every product path to be edited.
4. Update proto source for:
   - `AgentModelRef`
   - `AgentRuntimeEvent`
   - `AgentResourceRef`
   - tool approval/result policy objects
   - Actor#agent reserved contract objects
5. Run model generation with `./model/build.sh`.
6. Review generated Go/TS diffs and reject any manual edits to generated outputs.
7. Add the smallest Station/Desktop compatibility adapters required for compilation and old request compatibility.
8. Run deterministic checks.
9. Append EVID-012 with paths, commands, result and remaining risk.

## 6. Minimal Verification Commands

Run from repository root unless noted:

```bash
./model/build.sh
pnpm --dir apps/desktop run check
```

Run if Station service/domain paths are touched:

```bash
cd apps/station && go test ./app/subserver/agent/...
```

Run if Desktop Rust bridge paths are touched:

```bash
cd apps/desktop/src-tauri && cargo test
```

If a narrower Rust or Go command is used, EVID-012 must record why it covers the touched paths.

## 7. Required Review Assertions

EVID-012 must answer all assertions:

| Assertion | Required Proof |
| --- | --- |
| Generated outputs trace to proto source | `git diff` shows generated files changed only after proto source changes and generation command. |
| Provider/model identity is contractually unique | `AgentModelRef` includes both `provider_id` and `model_id`; no new model-only identity path is introduced. |
| Runtime event taxonomy is canonical | Station/Desktop mapping points at one proto-owned event taxonomy or a documented compatibility adapter. |
| Resource refs do not leak local paths | Local files/folders use opaque refs, not raw Web durable paths. |
| Tool approval can be audited | Approval request/result objects carry turn/tool identity and policy/risk information. |
| Actor#agent remains reserved | New fields express identity/visibility/capability/event scope without enabling social UI behavior. |
| Old clients remain compatible | Existing `provider/model` request fields are still mapped or explicitly rejected only on conflict. |

## 8. Stop Conditions

Stop implementation and do not append a success claim if any condition occurs:

1. EVID-010 remains `REVISION REQUIRED` and no later acceptance or explicit contract-only authorization exists.
2. `./model/build.sh` fails and no supported replacement generation path is identified.
3. Generated files are edited by hand.
4. Desktop Web introduces page/store behavior changes that belong to M2/M3/M4.
5. A new cross-layer manual DTO duplicates proto contract semantics.
6. Provider/model validation uses `model_id` alone.
7. Actor#agent fields enable product social behavior.
8. GATE-008 checks are skipped for touched layers.

## 9. EVID-012 Template

Append after implementation:

```md
| EVID-012 | BOM-013/BOM-014/BOM-015 | SPEC-003/SPEC-004/SPEC-006/SPEC-007/SPEC-008/SPEC-009/SPEC-011/SPEC-012/SPEC-013 | PLAN-P5 / M1 | GATE-005/GATE-006/GATE-007/GATE-008 | <proto paths>; <generated paths>; <adapter paths>; commands: `./model/build.sh`, `<checks>` | Contract foundation implemented; generated consumers compile; compatibility assertions satisfied | <remaining M2-M10 risks> |
```

## 10. Current Claim

M1 implementation is ready to start only after revised prototype acceptance or explicit contract-only authorization.

This kickoff package prepares execution discipline and evidence shape, but it does not start PLAN-P5 and does not claim product migration.
