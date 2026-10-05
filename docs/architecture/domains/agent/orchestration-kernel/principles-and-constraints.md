# Agent Orchestration Kernel — Principles and Constraints

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-24
> **Owner**: Peers-Touch Agent Team

This document defines the stable principles and operational constraints for the Peers-Touch multi-agent orchestration architecture.

It is written as a target architecture reference. It does not describe the historical reasoning process that produced the design.

---

## 1. Architectural Principles

### 1.1 Decision and Execution Are Separate

Agents produce judgments, proposals, objections, verifications, and risk claims.

They do not mutate workflow state and do not execute side effects directly.

State transitions are owned by `WorkflowOrchestrator`. External effects are executed by Providers under policy control.

### 1.2 Decisions Must Be Evidence-Backed

Any acceptance, rejection, blocking, or escalation decision must reference evidence.

Evidence must be independently reviewable through `EvidenceRef`.

Model explanations may help interpret evidence, but they cannot be the only basis for automatic acceptance.

### 1.3 Verification Requires Independence

The producer of an output cannot be the only verifier of that output.

Self-review may exist, but acceptance requires an independent verifier, deterministic gate, rule engine, human signoff, or another trusted verification path.

### 1.4 Policy Is a Runtime Boundary

Policy is not documentation advice. It is a runtime guard.

Policy evaluates collaboration, evidence admission, provider execution, workflow state transition, budget, trust, risk, and federation boundaries.

Hard guards cannot be overridden by LLM output.

### 1.5 Workflow Owns Durable State

The workflow layer is the source of truth for task state, run attempts, checkpoints, and recovery.

LLM context is not durable state.

Resume must start from accepted checkpoints and recorded workflow events.

### 1.6 Providers Execute, But Do Not Accept

Providers execute structured commands and return results plus artifacts.

Provider success means the Provider completed the requested command. It does not mean the task is accepted.

Task acceptance is determined by workflow, policy, evidence, gate results, and verification decisions.

### 1.7 Federation Is Explicitly Untrusted By Default

Remote agents, remote artifacts, and remote evidence are not automatically trusted.

Agent Card is treated as a capability declaration, not proof.

Remote results must pass local trust and evidence policies before they influence local acceptance.

---

## 2. Layer Responsibilities

### 2.1 Collaboration Kernel

Owns:

- Collecting `AgentOutput`.
- Applying evidence admission rules.
- Reducing outputs into `Decision`.
- Evaluating convergence.
- Returning `Decision` and `ConvergenceResult`.

Does not own:

- Durable workflow state.
- Provider execution.
- Artifact storage.
- Budget ledger.
- UI rendering.
- A2A transport.

### 2.2 Workflow Orchestrator

Owns:

- `ProjectContract`.
- `TaskGraph`.
- `Task` lifecycle.
- `Run` lifecycle.
- Workflow events.
- Checkpoints.
- Replan and resume.
- Provider scheduling.
- State transition policy checks.

### 2.3 Provider Layer

Owns:

- Structured command execution.
- External tool, code, data, action, and remote agent adapters.
- `ProviderResult`.
- Artifact production.
- Cancellation and execution receipts.

Does not own:

- Workflow state transition.
- Task acceptance.
- Evidence sufficiency.

### 2.4 Evidence and Artifact Layer

Owns:

- Artifact references.
- Evidence references.
- Verification status.
- Evidence trust level.
- Evidence conflict detection.
- Evidence extraction from provider results and gate results.

### 2.5 Policy / Guard System

Owns:

- Runtime allow/deny/escalate decisions.
- Risk boundaries.
- Budget boundaries.
- Trust boundaries.
- Evidence admission rules.
- Provider preflight and postflight rules.
- State transition safety checks.

### 2.6 Federation / A2A Layer

Owns:

- Remote agent discovery.
- Remote task transport.
- Remote participant projection.
- Remote provider wrapping.
- Delegated budget.
- Disclosure policy.
- Remote evidence verification.
- Audit receipts.

---

## 3. Core Data Contracts

### 3.1 Decision

`Decision` is the structured output of the collaboration kernel.

It must express:

- Decision kind.
- Recommendation.
- Evidence references.
- Accepted and rejected outputs.
- Unresolved objections.
- Execution policy.
- Next action.

It must not directly mutate workflow state.

### 3.2 EvidenceRef

`EvidenceRef` connects a claim to a reviewable factual source.

Minimum fields:

```text
uri
claim
verification_status
```

Evidence is not merely an explanation. It must point to something that can be reviewed, reproduced, checked, or authorized.

### 3.3 Participant

Participants are described by runtime properties:

```text
kind
perspective
authority
capabilities
trust_level
cost_class
```

Participants can be LLM agents, deterministic gates, humans, local services, or remote agents.

### 3.4 CollaborationProfile

`CollaborationProfile` packages collaboration policies for a reusable task pattern.

It includes:

- Participant policy.
- Evidence policy.
- Reduction policy.
- Convergence policy.
- Activation conditions.
- Anti-patterns.
- Cost class.

Profiles are selected by task characterization and budget/risk/trust constraints.

---

## 4. Operational Constraints

### 4.1 Evidence Constraints

- Acceptance requires sufficient evidence.
- Blocking decisions require reasons and evidence.
- Model-only evidence cannot support automatic acceptance.
- Evidence conflicts block automatic acceptance until resolved.
- Remote evidence must include trust level and verification status.
- Deterministic evidence should be preferred when available.

### 4.2 Participant Constraints

- Producers and verifiers must be independently represented for acceptance.
- Self-review cannot be the only verification source.
- High-risk actions require risk evaluation.
- L2 subjective judgment requires human signoff or escalation.
- Remote untrusted participants cannot be the only verifier, hard blocker, or acceptance source.

### 4.3 Workflow Constraints

- Workflow state transitions must pass policy checks.
- `Task` and `Run` are separate concepts.
- A task must have acceptance predicates before execution.
- Replan should produce bounded graph patches.
- Resume must use accepted checkpoints.
- Supervisor behavior is workflow monitoring, not free-form conversation.

### 4.4 Provider Constraints

- Provider commands must be structured.
- Provider execution must pass preflight policy.
- Provider output must pass postflight policy.
- Provider artifacts must become evidence before supporting verification.
- ActionProvider requires explicit high-risk controls.
- Provider cost must be recorded in budget accounting.

### 4.5 Policy Constraints

Policy decision status is structured:

```text
allow
allow_with_constraints
deny
require_human
require_more_evidence
escalate
```

Policy priority:

```text
Safety / Legal / Privacy
> User Explicit Consent
> Budget
> Trust Boundary
> Task Contract
> Evidence / Verification
> Profile Strategy
> Optimization / Cost Efficiency
> UX Convenience
```

Human signoff is authorization and responsibility evidence. It does not override safety, legal, privacy, or impossible-permission boundaries.

### 4.6 Federation Constraints

- Remote agents are untrusted by default.
- Remote capability declarations require verification before high-trust use.
- Remote calls use minimal context disclosure.
- Remote calls require delegated budget.
- Remote task state is projected into local workflow state.
- Local workflow remains the local source of truth.
- Remote calls require audit receipts.

---

## 5. Evolution Boundaries

### 5.1 Kernel Before Profiles

Implementation should first prove the kernel contracts:

- `AgentOutput`.
- `EvidenceRef`.
- `Decision`.
- `ParticipantPolicy`.
- `EvidencePolicy`.
- `ReductionPolicy`.
- `ConvergencePolicy`.

Reusable collaboration profiles should be layered after those contracts are stable.

### 5.2 Local Evidence Before Remote Trust

The first implementation should prioritize local deterministic evidence and local verification gates.

Remote evidence, remote providers, and federated trust should be added after local evidence semantics are stable.

### 5.3 Workflow Guard Before Automation Depth

Long-task automation should be introduced only after workflow state transition guards are in place.

Automation depth must not exceed the system's ability to verify state, evidence, budget, and policy constraints.

### 5.4 High-Risk Actions Last

ActionProvider automation should be introduced only after:

- Policy guards are enforced.
- Human signoff paths exist.
- Audit receipts exist.
- Rollback or irreversibility declarations are represented.

---

## 6. Architecture Invariants

These invariants must remain true across implementation phases:

- Agent output cannot directly mutate workflow state.
- Provider output cannot directly accept a task.
- Remote self-declaration cannot establish trust.
- Model explanation cannot be the only basis for automatic acceptance.
- L2 subjective judgment cannot be automatically accepted.
- Hard risk, privacy, legal, and budget guards cannot be bypassed by LLM output.
- Evidence-backed blocking objections cannot be silently dropped.
- Round exhaustion cannot force acceptance.
- Additional collaboration rounds must have a concrete focus.
- Resume cannot rely on LLM context as the source of truth.
