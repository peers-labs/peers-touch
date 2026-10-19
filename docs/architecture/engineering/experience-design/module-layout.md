# Experience Design Control Plane - Module Layout

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-18 | **Updated**: 2026-10-20
> **Owner**: Developer Experience / Product Design

---

## 1. Directory Tree

```text
docs/
├── architecture/engineering/experience-design/
│   ├── README.md
│   ├── design.md
│   ├── decisions.md
│   ├── data-model.md
│   ├── reasoning-kernel.md
│   ├── review-result.md
│   ├── review-kernel-integration.md
│   ├── review-kernel-layout.md
│   ├── module-layout.md
│   ├── integration.md
│   ├── rules.json
│   └── execution-plans/
└── client/common/
    ├── interaction-design-methodology.md
    └── ui-identity/
        └── grammar-bindings.json

tooling/
├── scripts/experience-design/
│   ├── experience-design.mjs
│   ├── canonical.mjs
│   ├── source-version.mjs
│   ├── evaluator.mjs
│   ├── evidence.mjs
│   ├── schema.mjs
│   ├── review-result-schema.mjs
│   ├── validator.mjs
│   ├── ranking.mjs
│   ├── source-fence.mjs
│   ├── review-receipt.mjs
│   ├── holdout.mjs
│   ├── calibration.mjs
│   ├── evaluator.test.mjs
│   ├── evidence.test.mjs
│   ├── schema.test.mjs
│   ├── review-receipt.test.mjs
│   ├── holdout.test.mjs
│   ├── source-version.test.mjs
│   ├── integration.test.mjs
│   ├── test-fixture.mjs
│   └── fixtures/
│       ├── calibration-manifest.json
│       ├── trusted-issuers.json
│       ├── positive/
│       ├── negative/
│       ├── boundary/
│       ├── holdout/
│       ├── holdout-results/
│       ├── reviews/
│       └── holdout-ledger/
└── skills/
    ├── pt-product-design-methodology/SKILL.md
    ├── pt-prototype-design/SKILL.md
    └── pt-quality-check/SKILL.md
```

## 2. File Responsibilities

| Path | Responsibility |
|---|---|
| `experience-design/README.md` | Module entry and scope |
| `experience-design/design.md` | Ownership, contracts, components and Gates |
| `experience-design/decisions.md` | Accepted architecture decisions |
| `experience-design/data-model.md` | Closed machine model and rule IDs |
| `experience-design/reasoning-kernel.md` | Source-fenced Journey, trust, recovery and Finding reasoning |
| `experience-design/review-result.md` | ReviewResult and promotion data model |
| `experience-design/review-kernel-*.md` | Reasoning component integration and layout refinements |
| `experience-design/module-layout.md` | Canonical source layout |
| `experience-design/integration.md` | Consumer boundaries and cutover |
| `experience-design/rules.json` | Canonical rule severity, disposition, exit and owner |
| `interaction-design-methodology.md` | Human/Agent product interaction method |
| `grammar-bindings.json` | UI Identity-owned machine grammar |
| `schema.mjs` | Closed schema and reference validation |
| `review-result-schema.mjs` | Closed ReviewResult primitive validation |
| `validator.mjs` | ReviewResult graph, recovery, finding and admission validation |
| `ranking.mjs` | Deterministic eligible Finding ordering |
| `source-fence.mjs` | Exact report package and repository source binding |
| `canonical.mjs` | Canonical JSON, digest and Ed25519 verification primitives |
| `source-version.mjs` | Exact control-plane source identity for result binding |
| `evaluator.mjs` | Pure deterministic rule evaluation |
| `evidence.mjs` | Exact evidence-cell, artifact and metric matching |
| `experience-design.mjs` | CLI parsing and stable output |
| `review-receipt.mjs` | Digest and reviewer-independence validation |
| `holdout.mjs` | Content-addressed blind chain and promotion validation |
| `calibration.mjs` | Three-class coverage and exact expectation runner |
| `fixtures/` | Calibrated cases and content-addressed blind holdout records |
| `*.test.mjs` | Rule, fixture and Skill integration proof |

## 3. Dependency Direction

```text
product contracts
  -> interaction-design-methodology
      -> experience case JSON
          -> schema.mjs
          -> grammar-bindings.json
          -> evaluator.mjs
              -> findings JSON
                  -> Product / Prototype / Review / Quality owners
```

Skills may invoke the CLI and cite methodology. They must not import private
evaluator helpers or duplicate `rules.json`. Trusted issuer public keys are an
explicit CLI input owned by the review host; the repository stores no private
review key.

## 4. Ownership

| Concern | Owner |
|---|---|
| Product outcome, Journey and state requirement | Product module |
| Cross-client interaction method | Client Common |
| Component and platform grammar | UI Identity |
| Schema, deterministic evaluation and calibration | Experience Design control plane |
| Prototype implementation and evidence capture | Prototype module |
| Acceptance decision | Independent review owner |

## 5. Forbidden Layout

- No second `experience-design` Skill.
- No copied grammar table inside Product or Prototype Skills.
- No fixture expectations embedded in evaluator source.
- No mutable status, approval receipt or evidence artifact under the frozen
  execution Plan.
- No page-specific CSS, component imports or business copy in the control
  plane.
