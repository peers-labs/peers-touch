---
name: "architecture-design-methodology"
description: "Guides source-backed architecture design. Invoke when defining system boundaries, ownership, contracts, topology, or design decisions."
---

# Architecture Design Methodology

## Purpose

Use this skill to design architecture before turning it into an execution plan.

This skill answers:

- What system relationships are allowed or forbidden.
- Which runtime units exist and who owns them.
- Which source of truth owns business state, contracts, and local runtime state.
- Which contracts, component relationships, and architecture decisions must be documented.
- Whether the proposed design belongs in architecture, platform, specification, or historical context.

This skill does not answer:

- How to split implementation phases.
- How to migrate files in dependency order.
- How to track task status.
- How to write coding style rules.
- How to invent a domain-specific architecture without reading that domain's sources.

For architecture landing, migration, dependency ordering, and verifiable delivery, use `architecture-execution-methodology` after this skill.

## Source Basis

This skill is a packaging of existing repository guidance. Do not treat it as an invented universal framework.

Required source documents:

- `docs/README.md`
  - Architecture layer source-of-truth defines relationships, boundaries, sources of truth, owners, and allowed or forbidden calls.
  - If the question is "what relationships does the system allow?", it belongs to architecture.
- `docs/global/architecture-document-standard.md`
  - Defines the required architecture document set, file responsibilities, metadata, diagrams, interfaces, component relationships, and ADR-lite decision format.
  - It explicitly does not define every domain's concrete design content.
- `docs/global/architecture.md`
  - Defines source-of-truth and ownership rules: Station owns cross-end business truth, Model owns contract semantics, clients own device-local UI and runtime orchestration.
  - Defines global design principles such as separation of concerns, dependency injection, proto-first contracts, modularity, and platform-specific runtime direction.
- `docs/global/first-principles.md`
  - Defines non-negotiable architecture principles: proto-first domain modeling, current repo boundaries, command path consistency, logging, and security.
- `docs/knowledge/playbooks/documenting-large-requirements.md`
  - Defines how large requirements promote durable design into formal docs and keep them discoverable.

If a proposed rule is not supported by one of these sources or a domain-specific source document, label it as a proposal, not a repository rule.

## Invoke When

Invoke this skill when the user asks for any of the following:

- Architecture design.
- System design.
- Runtime architecture.
- Service topology.
- Domain ownership or source-of-truth definition.
- Cross-layer, cross-runtime, or cross-platform boundaries.
- Contract, protocol, state machine, or data model architecture.
- Allowed and forbidden dependency or call relationships.
- Architecture decisions and tradeoff analysis.
- Formal architecture documents under `docs/architecture/<domain>/`.

Do not invoke this skill for:

- Pure execution planning after the architecture is already defined.
- Code-only refactors that do not change architecture.
- UI design methodology, unless the UI design changes architecture-level boundaries.
- Documentation formatting only.

## Method

### Step 1. Classify the Design Level

Start by deciding which layer owns the question.

Use the repository rule:

- Architecture layer: answers what system relationships are allowed.
- Platform layer: answers how one platform implements those relationships.
- Specification layer: answers how code should be written.
- Historical context: records past research and non-current designs.

Output:

- Target layer.
- Reason the decision belongs there.
- Documents that must constrain the design.
- Documents that are downstream and must not redefine the boundary.

### Step 2. Define Scope And Non-Scope

Architecture must define the possible space before details.

Output:

- What this architecture defines.
- What it explicitly does not define.
- Which runtime units, layers, or platforms are in scope.
- Which current source documents remain upstream.
- Which downstream docs or code paths must conform to it.

### Step 3. Establish Sources Of Truth And Ownership

Apply the repository ownership rule before designing APIs or modules.

Default ownership rule:

- Cross-end business state is owned by `Station`.
- Contract semantics are owned by `Model`.
- Device-local UI and runtime orchestration are owned by the corresponding client runtime.

Output:

- Source-of-truth table.
- Owner for each capability.
- State that must not be duplicated locally.
- Contract files or model roots that must become canonical.
- Ownership exceptions, with rationale and consequences.

### Step 4. Identify Runtime Units And Boundaries

Define the structural model before implementation paths.

Output:

- Runtime units.
- Process or runtime boundaries.
- Trust boundaries.
- Local-only versus shared responsibilities.
- Allowed calls.
- Forbidden calls.
- Data flow and control flow.
- Lifecycle boundaries if the architecture owns runtime behavior.

Do not skip forbidden relationships. Architecture is incomplete if it only says what exists and does not say what must not happen.

### Step 5. Define Contracts And Invariants

Architecture must produce stable contracts, not only prose.

Output:

- Proto, API, SDK, bridge, event, or storage contracts.
- State machine or lifecycle states, when applicable.
- Invariants that must remain true across implementations.
- Validation and authorization responsibilities.
- Compatibility expectations.

Apply first principles:

- Use proto-first domain modeling for cross-platform data contracts.
- Do not manually duplicate domain models across clients and Station.
- Keep contracts explicit and version-safe.
- Validate auth and ownership checks for read/write handlers.
- Do not leak secrets through logs or diagnostics.

### Step 6. Design Component Relationships

Use the architecture document standard as the minimum required shape.

Every `design.md` must include:

- Core principles.
- System architecture diagram.
- Core interfaces or contracts.
- Component relationships.
- Endpoints or APIs when applicable.

For each component, define:

- Responsibility.
- Owner.
- Inputs and outputs.
- Dependencies.
- Source of truth it may read or mutate.
- What it must not know or import.

### Step 7. Record Decisions And Alternatives

Architecture must preserve decision context.

For each important decision, write ADR-lite content:

- Context.
- Decision.
- Rationale.
- Alternatives considered.
- Consequences, including negative consequences.

Do not hide tradeoffs. If a decision has operational cost, compatibility cost, performance cost, or security risk, record it.

### Step 8. Select The Document Set

Use the repository architecture document set.

Required:

- `README.md`: scope, background, design goals, navigation.
- `design.md`: principles, system diagram, interfaces, component relationships.
- `decisions.md`: ADR-lite decisions.

Optional, based on module complexity:

- `data-model.md`: protocols, state machines, persistence schema, type mapping.
- `module-layout.md`: directory tree, file responsibilities, dependencies.
- `integration.md`: existing-module mapping, impact surface, migration strategy.
- `prototype/`: runnable prototype for UI or interaction-heavy architecture.
- `execution-plans/`: phased implementation, only after the architecture exists.

### Step 9. Check Architecture Completeness

Before presenting or writing the design, verify:

- The design states why it is architecture-level, not platform-level or coding-level.
- The design defines allowed and forbidden relationships.
- Sources of truth and owners are explicit.
- Runtime units and boundaries are explicit.
- Contracts are explicit and version-safe.
- Component responsibilities do not overlap.
- State ownership is not duplicated without a documented exception.
- Security, authorization, logging, and diagnostics constraints are covered.
- Decisions include alternatives and consequences.
- Downstream implementation docs cannot silently redefine the architecture.

## Output Standard

When responding without writing files, use this structure:

- Source Basis.
- Architecture Level.
- Scope / Non-Scope.
- Sources Of Truth And Ownership.
- Runtime Units And Boundaries.
- Contracts And Invariants.
- Component Relationships.
- Decisions And Alternatives.
- Completeness Check.
- Next Step: execution planning only if architecture is accepted.

When writing files, follow `docs/global/architecture-document-standard.md` and keep generated content in English.

## Composition With Other Skills

Use this skill before:

- `architecture-execution-methodology`, when the user wants a landing plan after the design is accepted.
- `plan-and-document`, when the design must be written into formal repository docs.
- `prototype-design`, when architecture needs a runnable UI or interaction prototype.

Use `architecture-execution-methodology` instead of this skill when:

- The architecture is already decided.
- The task is to split implementation work.
- The task is migration sequencing, phase planning, or verification planning.

## Anti-Patterns

- Starting with files or phases before ownership and boundaries are clear.
- Treating platform implementation details as architecture-level truth.
- Defining a new local business truth when Station already owns the business state.
- Creating manual models instead of proto-first contracts.
- Writing `design.md` without a system diagram.
- Listing components without forbidden dependencies.
- Recording only the selected design and omitting alternatives.
- Turning a proposal into a rule without a cited source.
- Using this skill to justify execution plans instead of designing architecture.
