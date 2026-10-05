# Architecture Module Governance - Plan Review Prompt

Review:

- Plan Package:
  `docs/architecture/architecture-module-governance/execution-plans/20260927-architecture-module-governance/plan.md`
- Architecture sources:
  `docs/architecture/architecture-module-governance/`
- First backfill target:
  `docs/architecture/station-access-lifecycle/`

Required findings-first checks:

1. Every Task is one bounded vertical closure and follows the declared DAG.
2. The design uses positive current-state declarations, not historical-name blacklists.
3. Document requirements derive from module characteristics.
4. Hook, Plan and Review consume one shared parser.
5. Hook receipts do not grant authority or persist workflow state.
6. Station Access cleanup removes migration vocabulary without weakening current
   capability coverage.
7. Formal proof is source-only and does not claim product runtime behavior.
8. Local commit is allowed; push, PR, runtime deploy and history rewrite are denied.
9. `make plan-validate` passes.

Return `通过`, `有条件通过`, or `需要修改`, followed by source-backed findings.
