# Experience Design Control Plane - Reasoning Kernel Layout

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-19 | **Updated**: 2026-10-19
> **Owner**: Experience Design

---

This is a component-level refinement of
[module-layout.md](./module-layout.md). It may add review files under the
canonical control-plane directory, but it does not own a second module root or
CLI.

## 1. Directory Tree

```text
docs/
└── architecture/engineering/
    ├── experience-design/
    │   ├── README.md
    │   ├── design.md
    │   ├── decisions.md
    │   ├── data-model.md
    │   ├── module-layout.md
    │   └── integration.md
    └── quality/
        └── blind-validation/
            ├── README.md
            ├── manifest.json
            ├── rubric.md
            ├── cases/
            └── reviewer-only/

tooling/
├── scripts/experience-design/
│   ├── experience-design.mjs
│   ├── review-result-schema.mjs
│   ├── ranking.mjs
│   ├── validator.mjs
│   ├── source-fence.mjs
│   ├── admission.mjs
│   ├── review-result-cli.test.mjs
│   ├── review-result-schema.test.mjs
│   ├── ranking.test.mjs
│   ├── validator.test.mjs
│   └── fixtures/
│       ├── positive/
│       ├── negative/
│       └── boundary/
└── skills/
    ├── pt-product-design-methodology/SKILL.md
    ├── pt-prototype-design/SKILL.md
    └── pt-quality-check/SKILL.md
```

The files above are subordinate components invoked through the canonical
`experience-design.mjs` CLI.

## 2. File Responsibilities

| Path | Responsibility |
|---|---|
| `experience-design/reasoning-kernel.md` | Four-layer review context and Kernel pipeline |
| `experience-design/decisions.md` | Canonical control-plane and Kernel decisions |
| `experience-design/review-result.md` | Closed review, ranking and holdout contracts |
| `experience-design/review-kernel-layout.md` | Kernel component refinement |
| `experience-design/review-kernel-integration.md` | Kernel-specific integration mapping |
| `quality/blind-validation/` | Quality-owned calibration and blind package assets |
| `experience-design.mjs` | Canonical control-plane and ReviewResult CLI |
| `review-result-schema.mjs` | Closed ReviewResult shapes, enums and reference primitives |
| `ranking.mjs` | State ordering, candidate eligibility and tuple comparison |
| `validator.mjs` | Pure graph, trust, recovery and ReviewResult validation |
| `source-fence.mjs` | Current Git/source blob and source range verification |
| `admission.mjs` | Independent decision plus current package/source verification |
| `fixtures/positive/` | Valid complete review results |
| `fixtures/negative/` | One intentional contract violation per fixture |
| `fixtures/boundary/` | Legal edge cases that must not become false positives |
| Product Skill | Produces accepted Journey/trust/recovery inputs |
| Prototype Skill | Consumes accepted result and preserves trace through Wireflow |
| Quality Skill | Owns holdout, scoring, exposure and promotion |

## 3. Dependency Direction

```text
Product / Client contracts
  -> ReviewResult authoring
      -> review-result-schema.mjs
      -> ranking.mjs
      -> validator.mjs
          -> experience-design.mjs review-*
              -> independent review
                  -> Prototype Compiler

Quality blind package
  -> sealed run envelope
      -> Kernel review
          -> frozen reports
              -> Quality scoring / promotion
```

`ranking.mjs` may depend on ReviewResult schema constants. `validator.mjs` may
depend on that schema and ranking. `source-fence.mjs` consumes validator/schema;
`admission.mjs` consumes SourceFence and independent-decision validation.
Validator never imports SourceFence or admission. No library imports the CLI.

## 4. Ownership

| Concern | Owner |
|---|---|
| Journey, promised outcome and visible states | Product domain |
| Trust, scope and next-Gate semantics | Owning Product / Client contract |
| Platform interaction refinement | Desktop / Mobile Client contract |
| Review schema, graph and ranking | Experience Reasoning Kernel |
| Wireflow and high-fidelity artifact | Prototype Compiler |
| L1-L4 evidence production | Prototype / runtime owner |
| Blind package, key, score and promotion | Quality |
| Final review judgment | Independent reviewer / GitHub Review |

## 5. Forbidden Layout

- No second CLI, module registry entry, Product contract or UI Grammar owned by
  the Kernel.
- No private signing key in repository source.
- No mutable score, answer key or Promotion Ledger owned by the Kernel.
- No second Experience Design Skill that competes with Product, Prototype or
  Quality owners.
