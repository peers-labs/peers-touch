# Experience Reasoning Kernel - Module Layout

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-19 | **Updated**: 2026-10-19
> **Owner**: Experience Design

---

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
│   ├── experience-review.mjs
│   ├── schema.mjs
│   ├── ranking.mjs
│   ├── validator.mjs
│   ├── source-fence.mjs
│   ├── experience-review.test.mjs
│   ├── schema.test.mjs
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

The tooling tree is the accepted minimal target. Until those files land and
pass focused tests, tooling remains `UNPROVEN`.

## 2. File Responsibilities

| Path | Responsibility |
|---|---|
| `experience-design/README.md` | Module scope, problem and navigation |
| `experience-design/design.md` | Four-layer ownership and review pipeline |
| `experience-design/decisions.md` | Accepted decisions and rejected alternatives |
| `experience-design/data-model.md` | Closed review, ranking and holdout contracts |
| `experience-design/module-layout.md` | Canonical ownership and file layout |
| `experience-design/integration.md` | Product, Client, Prototype, Quality and Review mapping |
| `quality/blind-validation/` | Quality-owned calibration and blind package assets |
| `experience-review.mjs` | Thin CLI and stable JSON/error output |
| `schema.mjs` | Closed object shapes, enums and reference primitives |
| `ranking.mjs` | State ordering, candidate eligibility and tuple comparison |
| `validator.mjs` | Pure graph, trust, recovery and ReviewResult validation |
| `source-fence.mjs` | Current Git/source blob and source range verification |
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
      -> schema.mjs
      -> ranking.mjs
      -> validator.mjs
          -> experience-review.mjs
              -> independent review
                  -> Prototype Compiler

Quality blind package
  -> sealed run envelope
      -> Kernel review
          -> frozen reports
              -> Quality scoring / promotion
```

`ranking.mjs` may depend on schema constants. `validator.mjs` may depend on
schema and ranking. No library module imports the CLI.

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

- No `rules.json` that duplicates Product / Client semantics.
- No Lark-specific or domain-specific fixture inside Kernel source.
- No private signing key, Ed25519 review protocol or historical evaluator
  replay subsystem.
- No full UI Grammar mirror under `tooling/scripts/experience-design/`.
- No mutable score, answer key or Promotion Ledger owned by the Kernel.
- No second Experience Design Skill that competes with Product, Prototype or
  Quality owners.
