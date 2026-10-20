# Experience Design Control Plane - Integration

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-10-18 | **Updated**: 2026-10-20
> **Owner**: Developer Experience / Product Design

---

## 1. Existing Source Mapping

The table below is the active integration. Architecture, client methodology,
UI Grammar, Rule Catalog, evaluator, calibration, review validation and the
three Skill consumers are one source cut.

| Existing source | Retained responsibility | Target integration |
|---|---|---|
| `pt-product-design-methodology` | Product thesis, Journey, visible state, acceptance | Produces the Experience Contract layers and path budgets |
| `ux-design-methodology.md` | Case-to-contract diagnosis | Delegates prospective interaction design to the new methodology |
| `ui-identity/*` | Visual, spatial, interaction and accessibility truth | Owns machine-readable grammar bindings |
| `pt-prototype-design` | Runnable prototype and L1-L4 evidence | Requires traced Wireflow and evaluator run before high fidelity |
| `pt-quality-check` | Evidence aggregation | Reports experience findings and missing review/evidence cells |
| `pt-github-review` | Final review judgment | Consumes findings; no new merge authority is introduced |

No existing Skill or contract is replaced. The integration removes implicit
ownership gaps between Product and Prototype.

## 2. Product Design Integration

For material UI, Product Design additionally emits:

1. content concept inventory and per-scope occurrence budgets;
2. surface main-subject and region contract;
3. Journey path cost budget;
4. state/recovery/readback requirements;
5. semantic action roles;
6. required evidence levels.

These fields are product semantics, not implementation sequencing. Product
review must resolve conflicts before architecture or prototype work proceeds.

## 3. Prototype Integration

Prototype Design follows:

```text
accepted Experience Contract
  -> author Wireflow candidate
  -> run deterministic evaluator
  -> remediate blocking findings
  -> independent Wireflow review
  -> bind UI Grammar
  -> implement high fidelity
  -> collect L1-L4 evidence
  -> rerun evaluator and independent craft review
```

The prototype README records the case path, findings artifact and exact
`UNPROVEN` cells. A screenshot path without inspection metadata is not evidence.

## 4. UI Identity Integration

The JSON grammar binding is reviewed with the human-readable UI Identity
documents. Its roles are stable semantic names, not library component names.

Module UI contracts may:

- narrow allowed roles;
- select one allowed platform adapter;
- require additional confirmation or evidence.

They may not:

- change the meaning of `primary`, `destructive`, `recovery` or trust roles;
- introduce an unregistered action representation;
- silently relax accessibility or evidence requirements.

## 5. Review And Quality Integration

Quality evidence for material UI records:

- case path and source digests;
- evaluator disposition and findings;
- source-fenced `ReviewResult`, primary Finding tuple and scoped unproven cells;
- calibration suite status;
- independent review status;
- L1-L4 cells run and not run;
- contract drift status;
- product/runtime non-claims.

Zero deterministic findings means only `ready-for-independent-review`.

Final `review-admission` requires the same explicit repository, package,
envelope, case, manifest and rubric arguments as `review-verify`; it recomputes
their current links and source bytes. A prior validation cannot be reused as
freshness authority. Calibration promotion also validates the reciprocal blind
chain when invoked separately from `check`.
`pt-github-review` remains the final code-review owner.

The Reasoning Kernel is invoked by the same canonical CLI and consumes the
same accepted Experience Case. It must not maintain a second Product contract,
UI Grammar, Rule Catalog or Skill-level admission procedure. Quality owns fresh
holdout sealing, exposure, scoring and retirement; the evaluator owns only
deterministic validation and findings.

## 6. Finding Routing

| Rule | Default owner |
|---|---|
| `ED-CONTRACT-001` | Product or architecture source owner |
| `ED-SEM-001` | Content/Product |
| `ED-IA-001` | Product information architecture |
| `ED-PATH-001` | Product Journey |
| `ED-STATE-001` | Product state owner; runtime owner if authority is missing |
| `ED-ACTION-001` | Product interaction contract |
| `ED-GRAMMAR-001` | UI Identity |
| `ED-TRACE-001` | Prototype compiler |
| `ED-EVIDENCE-001` | Evidence/runtime owner |
| `ED-DRIFT-001` | The owner of the accepted contract, never the downstream symptom |

## 7. Known Regression Integration

The initial calibration set includes:

- semantic repetition in Mobile Station entry: repeated product/Station
  concepts across brand, title, subtitle, field and status;
- Lark connection drift: accepted direct-scan Journey versus prototype
  Dialog/Tab/form steps;
- positive and boundary controls that preserve legitimate brand,
  accessibility and safety repetition.

These are calibration fixtures, not the future blind acceptance set.

## 8. Cutover

Atomic cutover requires:

1. architecture and client methodology accepted;
2. grammar binding and evaluator landed together;
3. calibrated fixtures passing;
4. Product, Prototype and Quality Skills pointing to the canonical source;
5. known regressions detected;
6. no second active rule table in Skills or evaluator code.

Only after all six conditions hold may the architecture registry add the
evaluator source path, Skill consumers and `experience.design.evaluate`
capability. The current registry contains that capability because the canonical
CLI, calibration fixtures, digest-bound review validation and all three consumers
land together. `experience-design.mjs check` is the source-only cutover check.

Rollback is a VCS revert of the atomic source change. No compatibility mode or
dual evaluator is retained.

Tomorrow's real Peers/user examples remain outside calibration. Their first
blind result must be content-addressed and frozen before an independent review
or any promoted calibration case is created.

## 9. External Calibration Sources

External evidence informs the design but does not own Peers contracts:

- Figma MCP and Code Connect: structured design context and component binding;
- Vercel v0 Design System Skills: reusable design-system instruction;
- Anthropic evaluator-optimizer: explicit evaluator/producer separation;
- Nielsen Norman Group wireflows: task flow before visual detail;
- Storybook, Playwright and WCAG 2.2: state, interaction and accessibility
  evidence.

References are evidence inputs only. The repository contracts and Peers
product intent remain authoritative.
