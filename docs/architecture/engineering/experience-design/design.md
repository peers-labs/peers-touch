# Experience Design Control Plane - Architecture

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-18 | **Updated**: 2026-10-20
> **Owner**: Developer Experience / Product Design

---

## 1. Core Principles

1. **Semantics before pixels.** Content meaning, information hierarchy and task
   flow are frozen before component composition or visual styling.
2. **One owner per layer.** Product contracts own user outcomes; UI Identity
   owns grammar; platform contracts own adaptation; tooling validates but does
   not redefine any of them.
3. **Trace or fail closed.** A material UI decision without a product,
   Wireflow, grammar and evidence trace remains `UNPROVEN`.
4. **Calibrate both sides.** A rule is enforceable only when positive,
   negative and boundary fixtures show what it accepts, rejects and deliberately
   leaves to judgment.
5. **Findings, not self-approval.** Deterministic evaluation emits findings and
   evidence readiness. An independent review owner decides acceptance.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Current prospective design guidance does not define concept budgets, Journey-owned path vectors or a mandatory Wireflow gate | `verified_fact` | `docs/client/common/ux-design-methodology.md`; `tooling/skills/pt-product-design-methodology/SKILL.md`; `tooling/skills/pt-prototype-design/SKILL.md` | high | none |
| Mobile Station entry repeats one selection concept through `Connect Your Station`, `Choose Station`, `Station` and `Required` | `verified_fact` | `packages/prototypes/mobile/chat/src/pages/LaunchScreen.tsx`; `packages/prototypes/mobile/chat/src/components/StationSelector.tsx` | high | rendered severity remains a review judgment |
| Lark accepted product flow says Add enters scanning directly, while the prototype inserts a Dialog, mode tabs and a managed-app form | `verified_fact` | `docs/architecture/agent/lark/experience-contract.md`; `docs/architecture/agent/lark/prototype/README.md` | high | production behavior is outside this control-plane claim |
| Visual/token conformance alone can leave semantic and path defects undetected | `inference` | the two verified regressions plus the absence of prospective semantic/path contracts | medium | blind cases must test generalization |
| A structured contract stack and deterministic evaluator should become the shared control plane | `proposal` | this document set | n/a | independent architecture review and implementation proof |

The known regressions are calibration inputs. They are not blind evidence that
the proposed rules generalize.

## 3. System Architecture

```text
Product contract
  capability / journey / visible state / acceptance
                    |
                    v
Experience Contract Stack
  Product Intent
  Content Semantics
  Information Architecture
  Task + Path Cost
  State + Recovery
  Action Representation
                    |
                    v
Prototype Compiler
  Wireflow -> UI Grammar Binding -> High-fidelity prototype
                    |
                    v
Evidence Harness
  L1 contract -> L2 render -> L3 dynamic -> L4 runtime quality
                    |
                    v
Finding Router
  product | content | IA | path | state | action | grammar |
  prototype | platform | implementation | evidence owner

Machine evaluator -----------------------------------------------+
  validates closed schemas, trace, budgets, drift and evidence   |
  Reasoning Kernel source-fences Journey/trust/recovery findings |
  emits findings only; cannot mutate contracts or approve them   +
```

## 4. Contract Stack

### 4.1 Product Intent

The product owner supplies stable capability and Journey IDs, target actor,
starting context, promised outcome, non-goals and trust constraints. The
control plane rejects a case that invents product intent locally.

### 4.2 Content Semantics

Content is modeled as concepts, not strings alone. Each copy node declares:

- concept ID and semantic role;
- scope and hierarchy level;
- whether the concept is introduced, clarified or acted upon;
- a per-scope occurrence budget where repetition can create noise;
- an explicit exception when repetition is required for safety, accessibility
  or separated navigation context.

Lexical similarity is an investigation signal only. A finding requires
concept-level evidence. This catches semantic duplication such as repeating
the same Station-selection idea through title, subtitle, field label and badge,
while allowing the product name in genuinely separate accessibility or shell
contexts.

### 4.3 Information Architecture

Each surface declares exactly one main subject, its parent scope, content rail,
action rail, trust rail, floating layer and recovery layer. Secondary regions
must support the main subject or link to another surface; decorative or
ownerless regions are rejected.

### 4.4 Task And Path Cost

Journeys use a cost vector rather than a universal click count:

```text
commitments       irreversible or externally visible decisions
contextSwitches   route, modal, application or mental-model changes
decisionLoad      choices that require understanding before continuing
interruptions     permission, auth or setup breaks in the primary task
recoveryDebt      user work at risk if the next operation fails
```

Each Journey owns its own budget based on frequency, risk and reversibility.
The evaluator compares vectors component-wise and never converts them to an
averaged score. A high-risk destructive flow may legitimately exceed a
frequent low-risk flow.

### 4.5 State And Recovery

Every material Journey defines reachable visible states and transitions.
Recoverable failure must name:

- preserved input and durable state;
- retry, cancel or alternate action;
- focus/return destination;
- authority readback when outcome is uncertain.

The evaluator rejects terminal-looking success without authoritative evidence
and recoverable failure without a recovery transition.

### 4.6 Action Representation

Every action binds intent, risk and frequency to one representation:

- one primary commitment per surface;
- icon-only only for canonical, repeated, low-risk actions with tooltip and
  accessible label;
- destructive actions are never icon-only;
- the same action keeps one representation across equivalent surfaces;
- option sets use menus, tabs or segmented controls; binary state uses a
  switch/checkbox; numeric input uses the appropriate bounded control.

These are semantic roles. Visual geometry remains owned by UI Identity.

## 5. UI Grammar Binding

`docs/client/common/ui-identity/grammar-bindings.json` is the machine-readable
bridge from semantic roles to shared component roles and platform adapters.
It records:

- action, surface, state and navigation roles;
- allowed component roles;
- required labels, confirmation or recovery properties;
- Desktop and Mobile adapter families;
- source document for the human-readable rule.

The binding does not freeze CSS values, component imports or page-specific
markup. Unknown roles fail closed; module contracts may narrow a binding but
cannot redefine global meaning.

## 6. Prototype Compiler

The compiler is a process boundary, not a code generator:

```text
accepted Experience Contract
  -> Wireflow: nodes, transitions, copy concepts, actions and states
  -> trace validation
  -> UI Grammar binding
  -> high-fidelity prototype
```

High-fidelity work cannot compensate for a missing or failing Wireflow. The
prototype must preserve stable IDs from Product through Evidence. Any
intentional deviation is a contract amendment, not an implementation detail.

### 6.1 Reasoning Kernel Admission

The subordinate [Reasoning Kernel](./reasoning-kernel.md) source-fences the
accepted contract, candidate Journey graph and supplied evidence before high
fidelity. It separates facts, accepted contracts, inferences and unproven
cells; validates trust and recovery projections; and deterministically ranks
eligible findings.

The Kernel does not replace the Contract Stack or Prototype Compiler. Its
`ReviewResult` is one evaluator projection and must bind the same stable
Product, Wireflow and evidence IDs used by the canonical Experience Case.

## 7. Evidence Harness

### 7.1 Evidence Levels

- `L1_CONTRACT`: source paths, IDs, grammar bindings and reachable state map.
- `L2_VISUAL`: inspected renders for required viewport, theme, content and
  state cells.
- `L3_DYNAMIC`: real transitions, recovery, input preservation, focus, touch
  and reduced-motion paths.
- `L4_RUNTIME`: semantics, assistive technology, contrast, target size,
  performance and exact runtime cells.

The harness validates metadata, source binding and coverage. It cannot infer
visual quality from artifact existence. Missing cells remain `UNPROVEN`.

### 7.2 Independent Review Boundary

The evaluator returns:

```text
changes-required | ready-for-independent-review | unproven
```

It never returns `passed`, updates a contract, changes a fixture expectation or
marks an evidence cell accepted. A reviewer must be different from the
contract, candidate, evidence and expectation authors for an acceptance
decision. Review receipts bind all input digests and are validated separately;
the evaluator never creates them. Author and reviewer digests use issuer-scoped
principals and Ed25519 attestations against an explicit trusted public-key
registry. Without that attestation the result can expose findings but cannot
establish an accepted review.

## 8. Components

All components are pure, process-local functions invoked by the CLI. They have
no background lifecycle, concurrency, network, persistence or mutation owner.

| Component | Inputs | Outputs | Dependencies | Source access | Forbidden behavior |
|---|---|---|---|---|---|
| Contract validator | case JSON | typed case or schema error | schema module | read explicit case only | infer product meaning, repair input |
| Semantic validator | concepts, copy nodes | `ED-SEM-001` findings | validated case | none | judge prose taste or edit copy |
| IA validator | surface contracts/candidates | `ED-IA-001` findings | validated case, grammar | read grammar | infer pixel layout |
| Path validator | accepted action contracts, states, steps | derived vector and `ED-PATH-001` | validated case | none | trust candidate aggregate cost, use universal threshold |
| State validator | taxonomy, state graph, requirements | `ED-STATE-001` findings | validated case | read grammar state roles | invent backend truth or transitions |
| Action validator | action contracts/candidates | `ED-ACTION-001` findings | validated case, grammar | read grammar | style components or redefine grammar |
| Grammar validator | grammar JSON, candidate roles | `ED-GRAMMAR-001` findings | schema module | read canonical grammar only | accept unknown roles |
| Trace/drift detector | accepted trace, candidate trace | `ED-TRACE-001`/`ED-DRIFT-001` | validated case | none | amend either trace |
| Evidence matcher | requirement cells, evidence records | exact matches and `ED-EVIDENCE-001` | digest helper | verify explicit artifact paths | inspect visuals automatically or relabel evidence |
| Calibration runner | fixture directories | coverage and expectation mismatch | evaluator | read fixtures and grammar | author expected findings, consume holdout |
| Review receipt validator | case/result/receipt digests | valid receipt or independence error | digest helper | read explicit receipt | create receipt or approve findings |
| Reasoning Kernel | accepted contract, Journey graph, source fence | source-bound ReviewResult and ranked findings | review-result schema | read explicit package and source blobs | define Product truth or admit high fidelity |
| Finding router | rule catalog findings | owner-grouped projection | rule catalog | none | patch downstream symptoms |

The CLI owns process exit and serialization only. Validators do not execute
commands, import Skills, read Git history or write artifacts.

## 9. Allowed And Forbidden Relationships

Allowed:

- Product Design writes product and experience contracts.
- Prototype Design consumes accepted contracts and produces Wireflow/evidence.
- UI Identity supplies grammar bindings.
- Review and Quality consume findings and evidence readiness.

Forbidden:

- Evaluator edits or approves its own input.
- Prototype defines a new product Journey or business authority.
- Skill duplicates the canonical contract stack or UI Grammar.
- Screenshot-only evidence proves dynamic, accessibility or runtime claims.
- A negative fixture alone creates a universal rule.
- High-fidelity implementation starts while a required contract conflicts.
- Candidate-authored aggregate cost or verdict is treated as authority.
- Calibration expectations are derived from the same evaluator output.
- Holdout/blind cases are read by the calibration runner.

## 10. Rule Catalog And Failure Semantics

`rules.json` is the canonical machine source for rule ID, severity,
disposition, exit behavior and default owner. The table below is a
human-readable projection and is validated against that file.

| Condition | Rule/code | Severity | Disposition | CLI exit |
|---|---|---|---|---|
| Missing/invalid layer or unresolved reference | `ED-CONTRACT-001` | blocking | `changes-required` | 1 |
| Concept budget exceeded without legal exception | `ED-SEM-001` | blocking | `changes-required` | 1 |
| Main subject/region ownership invalid | `ED-IA-001` | blocking | `changes-required` | 1 |
| Derived path vector exceeds Journey budget | `ED-PATH-001` | blocking | `changes-required` | 1 |
| Required state, recovery or readback missing | `ED-STATE-001` | blocking | `changes-required` | 1 |
| Action representation illegal or inconsistent | `ED-ACTION-001` | blocking | `changes-required` | 1 |
| Unknown grammar role/adapter | `ED-GRAMMAR-001` | blocking | `changes-required` | 1 |
| Required trace link incomplete | `ED-TRACE-001` | blocking | `changes-required` | 1 |
| Required evidence cell has no exact current match | `ED-EVIDENCE-001` | unproven | `unproven` | 2 |
| Candidate differs from accepted Journey trace | `ED-DRIFT-001` | blocking | `changes-required` | 1 |
| Calibration class/expectation missing | `CALIBRATION_INCOMPLETE` | blocking | command failure | 1 |
| Receipt author overlaps an input author or digest is stale | `INDEPENDENT_REVIEW_REQUIRED` | blocking | review invalid | 1 |

Disposition precedence is deterministic:

1. any blocking finding -> `changes-required`;
2. otherwise any unmatched evidence requirement -> `unproven`;
3. otherwise -> `ready-for-independent-review`.

Warnings may add context but never change precedence. Schema/fixture/review
receipt command errors are not findings and always exit non-zero.

Validation is deterministic and side-effect free. Invalid input produces a
non-zero exit and structured error; it never rewrites the input.

## 11. Quality Gates

| Gate | Claim |
|---|---|
| `EDX-G01` | Architecture docs, module registry and grammar source validate |
| `EDX-G02` | Schema, semantic, IA, path, state, action, trace and drift tests pass |
| `EDX-G03` | Every enforceable rule has positive, negative and boundary calibration |
| `EDX-G04` | Product/Prototype/Quality skills reference the canonical control plane |
| `EDX-G05` | Known semantic-redundancy and Lark contract-drift regressions are detected |

These gates prove the control plane's source behavior. They do not prove a
future design is usable or a production UI is ready.
