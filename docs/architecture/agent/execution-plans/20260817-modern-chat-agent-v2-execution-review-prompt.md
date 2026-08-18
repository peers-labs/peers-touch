# Modern Chat Agent V2 — Execution Plan Review Prompt

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-17 | **Updated**: 2026-08-17
> **Owner**: Peers-Touch Agent Team
> **Review gate**: completed — nineteenth review `PLAN_READY_FOR_EXECUTION`

---

You are an independent execution-plan reviewer.

Mandatory review inputs:

- `docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2-execution.md`
- `docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2-runtime-matrix.yaml`
- accepted Product sources under
  `docs/architecture/agent/modern-chat-agent/`
- accepted DESIGN sources and D01-D18/C01-C15/A01-A20.
- current implementation under `model/domain/agent/`,
  `apps/station/app/subserver/agent/`, `apps/desktop/`, `apps/mobile/`, and
  `tooling/acceptance/`.

Current-source inspection is mandatory, not optional. Verify the checked-out
branch/worktree, follow every symbol/path in §3.1 and all tree-wide matches for
legacy/deletion/D11/approval/Gate symbols, and report any live entrypoint or
consumer absent from the plan. Do not constrain review to documentation.

Prior-finding regression checklist:

- all Canvas/collaboration create/start/recovery/resume/interrupt/node-result/
  executor-claim/Atelier paths are guarded before mutation;
- Tool approval inventory matches live imports and typed event payloads;
- runner and validator are independent proof producers, and domain proof pins
  one immutable seven-Gate proof set rather than mutable pointers;
- queue and all budget tests prove deterministic limit/limit+1 boundaries.
- `toolRuntime` is the sole approval projection/side-effect owner.
- all 28 BASE, 26 ERR, and D11 keys plus recovery actions have English/Chinese
  parity and translated receiver evidence.
- runtime attestations are per Gate/cell/sample while source identity is global;
- runtime matrix scope/sample counts come only from the versioned plan-owned
  matrix, never Gate self-declaration;
- `toolRuntime` owns approval submission, projection, and lifecycle with no
  Rust waiter;
- frozen V2 scope proves P12/stateless CLI non-advertisement and introduces no
  candidate certification, promotion authority, or hidden runtime ingress.
- D11 is reviewed route-by-route, including guarded, read-only, non-execution
  mutation, and cleanup dispositions; every Desktop Rust
  `handle_atelier` action alias has an exact downstream target/disposition.
- Mobile uses independent P01-P11 and V2 semantic contract cells rather than
  Browser scenarios or one aggregate portability result.
- `AS-04-UNAVAILABLE` has a binary Browser/Mobile oracle and zero-operation/
  dispatch/process evidence.
- `AS-F10` executes on Desktop, Browser, and Mobile contract rows.
- C12 inventory includes `store/agent.ts#chatConfig` and every live
  Skill/Knowledge/MCP/Tool/Connector reader/writer.
- `AS-16-CUSTOM-PLUGIN-RETIREMENT` deletes the rejected page, local credential
  and direct fetch, proto/generated contracts, Station CRUD/persistence/table,
  and proves no automatic import or residual symbol.

Do not modify files, implement code, approve EXECUTE for the Owner, or redesign
accepted architecture.

## Review Dimensions

1. **Traceability**: F1-F4 implement and delete the remaining C01-C10 paths;
   every V2 workstream maps product capability/journey, C11-C15, D14-D18,
   A15-A20, and a required final Gate.
2. **Dependency order**: contracts before owners, substrate before consumers,
   canonical ToolCall before Evaluation, cutover before deletion.
3. **Parallel safety**: F3/F4, W2/W3, and W4/W5/W6 parallelism do not create
   split truth or incompatible contracts.
4. **Atomic cutover**: every old source has one replacement, consumer inventory,
   deletion condition, and tree-wide proof.
5. **Failure semantics**: idempotency, timeout, cancel, replay, takeover,
   unknown side effects, OAuth/device revoke, cleanup, and deletion remain
   architecture-conformant.
6. **Acceptance coverage**: every accepted state and all eleven mandatory
   races in both orderings have binary user-facing scenarios, receiver DOM,
   Station readback, runtime side-effect/cleanup, and evidence path.
7. **Proto-first**: shared contracts precede generated adapters and consumers.
8. **No redesign**: plan does not invent topology, ownership, protocol, or
   weaker Gate semantics.
9. **Evidence honesty**: static checks/prototype/aggregate status cannot prove
   production behavior; runner/validator proof roles, exact source-identity
   tuple, runtime identities, quantitative workloads, and thresholds fail
   closed.
10. **Entry gate**: plan stops before EXECUTE and requires Owner approval.
11. **Conditional scope**: frozen V2 proves P12 and stateless CLI are not
    advertised; advertising either requires PRODUCT/DESIGN/PLAN amendment.
12. **Exact cells**: runtime binding/snapshot attestation, six taxonomy cells,
    all 26 V2 typed errors, compression continuity, Mobile P01-P11/V2 contract
    semantics, three-platform AS-F10, MCP unavailable degradation, rejected
    Custom Plugin retirement, and D11 downstream gating are independently
    executable.

## Required Output

1. Verdict: `passed`, `conditionally passed`, or `changes required`.
2. Blocking findings with exact file/line references.
3. Non-blocking findings.
4. Missing dependency, cutover, scenario, or evidence coverage.
5. Explicit `PLAN_READY_FOR_EXECUTION` or `PLAN_AMENDMENT_REQUIRED`.
