# Experience Design Plan Review Prompt

Review:

`docs/architecture/engineering/experience-design/execution-plans/20261018-experience-design-control-plane/plan.md`

Against accepted sources:

- `docs/architecture/engineering/experience-design/README.md`
- `docs/architecture/engineering/experience-design/design.md`
- `docs/architecture/engineering/experience-design/decisions.md`
- `docs/architecture/engineering/experience-design/data-model.md`
- `docs/architecture/engineering/experience-design/module-layout.md`
- `docs/architecture/engineering/experience-design/integration.md`

Check findings-first:

1. Every Task is one bounded vertical closure, not a technical layer.
2. Dependencies follow contract intake, evaluation, evidence integrity and
   consumer cutover.
3. The registry capability remains absent until the atomic EDX-04 cutover.
4. Known regressions are calibration, not blind acceptance.
5. Verification proves source behavior without claiming product runtime UX.
6. No Task weakens signed independence, exact evidence, content-addressed
   holdouts or fail-closed semantics.
7. Source claims, authorization and non-claims are complete.
8. `make plan-validate` and module governance pass.

Return `PASSED` or source-backed findings with file/line, consequence and
required correction. Do not execute the Plan.
