# Development Workflow

> **Status**: active
> **Audience**: human developers and development agents
> **Owner**: Platform Team

This is the single end-to-end development procedure for Peers-Touch. Tools,
Skills, architecture documents, and CI support this flow; none of them defines
a second flow.

## The Outcome Comes First

Every change starts with the user or engineering result it should improve.
Plans, task counts, commits, checks, and Gates are supporting facts, not the
result.

Before changing source, be able to state:

- the result being improved;
- this change's contribution;
- what proves completion;
- the selected worktree and scope;
- separately governed actions such as push, PR, merge, release, destructive
  cleanup, or stable-environment mutation.

Ask only when a missing fact changes behavior, safety, or authorization.

## 1. Understand

Read the nearest product, architecture, platform, and coding sources. Follow
the actual code path rather than relying on document names or memory.

- Confirm facts from current source or runtime evidence.
- Mark uncertain explanations as hypotheses.
- Reproduce a bug or collect equivalent evidence before fixing it.
- Reuse existing SDKs, components, contracts, and command surfaces.
- Keep unrelated findings outside the current scope.

Start from the [Dev index](./README.md) and the relevant
[platform guide](./platforms/README.md).

## 2. Design

Choose the layer that owns the behavior and define the result together with its
verification.

- A local correction can use a short root-cause and verification note.
- A behavior change spanning modules needs explicit impact and dependency
  order.
- A new product or architecture decision needs its governing document and
  confirmation before implementation.
- UI work uses the project's prototype and UI-identity sources when product
  shape needs confirmation.

Do not hide a redesign inside a small patch. Do not create a formal Plan merely
because tooling can consume one.

## 3. Prepare

Verify the exact worktree, branch, HEAD, and current dirty files. Existing
unrelated changes remain untouched.

- Creating, switching, removing, or pruning a worktree requires an explicit
  request for that operation.
- Source isolation does not imply runtime isolation.
- Start Station only through a selected Profile.
- Start Desktop through the native development entrypoint.
- Acquire runtime resources only when the next verification step needs them.

Use [Development Environment](./environment.md) for commands.

## 4. Implement

Change the owning layer and every affected consumer.

- Shared cross-platform models start in `model/domain/`.
- Generated files are regenerated through the canonical build path.
- Structural replacements migrate all current consumers and delete the old
  path in the same change.
- Documentation and operational knowledge move with the implementation.
- Temporary debug files stay outside the repository.

Before editing code, load path-owned entries from `docs/knowledge/`. A missing
Hook or host integration does not remove this obligation and does not block
ordinary work.

A local commit may be used as a coherent checkpoint for traceability or
exact-source runtime verification. It is not proof, delivery, or permission to
push.

## 5. Verify

Verification starts from the completion statement, not from a fixed test list.
Keep these evidence classes separate:

- `SOURCE_CHECK`: formatting, type checking, compilation, unit or contract
  checks.
- `STRUCTURAL_CHECK`: architecture, ownership, dependency, and repository
  shape.
- `UX_REVIEW`: layout, interaction, accessibility, and prototype alignment.
- `FUNCTIONAL_CHECK`: a focused Journey on the current runtime.
- `ACCEPTANCE_PROOF`: formal, source-bound product evidence.

Run the narrowest mode that proves the current obligation:

- `DEVELOPMENT_ITERATION`: affected source checks plus one focused Journey.
- `CLOSURE`: the explicitly selected formal closure after the Journey passes.
- `COMPLETION`: completion Gates when entering delivery.
- `FULL_RELEASE`: only for an explicitly requested release or full Acceptance.

Do not promote a narrow run into a broad run automatically. Unrun scope remains
`UNPROVEN`. See [Verification](./verification.md).

### Route Acceptance work by ownership

- Acceptance Core, runner, Evidence Store, schema, lifecycle, and framework
  tooling are infrastructure.
- Business Domain Feature, Capability, Journey, Fixture, Gate, and product
  proof remain with the business owner.

Infra reports missing business providers as `BUSINESS_INJECTION_REQUIRED`;
it does not add mock business injection or weaken assertions. Business Gate `FAILED`, `BLOCKED`, or `UNPROVEN` does not block
independent Acceptance Infra repair, and Infra health does not prove business
behavior.

## 6. Review

Review is findings-first:

- correctness and user-visible regressions;
- architecture and ownership;
- security and privacy;
- failure and recovery behavior;
- tests and evidence gaps;
- readability and structural debt.

Fix source-backed findings and rerun affected evidence. Framework self-tests do
not prove product behavior.

## 7. Deliver

Report:

- what changed;
- what current-source evidence passed;
- what remains unverified or blocked;
- where retained runtime resources live;
- whether commit, push, PR, merge, and release occurred.

Push, PR, merge, release, history rewrite, and destructive cleanup are separate
operations. Do not infer them from implementation approval or test success.

## Work Size

- **Small**: existing behavior and ownership are clear; implement and verify
  directly.
- **Standard**: multiple modules or behavior changes; state impact, dependency
  order, and Journey before implementation.
- **Complex**: new product flow, architecture, protocol, persistence, security,
  or release behavior; establish accepted design and a durable execution model.

Optional task records under `.dev-workflow/tasks/<taskId>/` may help recover a
complex change. They never authorize writes, runtime operations, or delivery.

## Continuity

One accepted request continues through implementation, internal review,
evidence refresh, and context changes while ready work remains. Stop only for a
real scope change, missing decision, missing external permission/resource, or a
separately governed operation.
