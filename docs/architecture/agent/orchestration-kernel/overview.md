# Agent Orchestration Kernel — Overview

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-24
> **Owner**: Peers-Touch Agent Team
> **Scope**: Agent collaboration kernel, policy-driven profiles, workflow boundary, provider boundary, and federation constraints.

---

## 1. Thesis

Peers-Touch multi-agent orchestration is a policy-driven collaboration system.

Its core responsibility is to transform multiple evidence-backed agent outputs into auditable decisions:

```text
multiple AgentOutput
  -> evidence admission
  -> reduction
  -> convergence check
  -> Decision
```

Collaboration modes are expressed through reusable profiles. Participants are expressed through perspectives, authorities, and trust levels. Long-running work, provider execution, policy enforcement, evidence storage, and federation are separate layers around the collaboration kernel.

---

## 2. First Principles

The orchestration engine exists because single-agent or naive multi-agent execution fails in predictable ways:

| Failure mode | Required mechanism |
|---|---|
| Multiple agents produce conflicting outputs | ReductionPolicy |
| Agents discuss forever | ConvergencePolicy |
| Producers self-validate their own work | ParticipantPolicy separation rules |
| Agents make unsupported claims | EvidencePolicy and EvidenceRef |
| Long tasks lose progress or drift | WorkflowOrchestrator |
| Providers perform unsafe side effects | Provider boundary and Policy Guard |
| Remote agents are not inherently trustworthy | TrustPolicy and RemoteEvidencePolicy |

Each architectural mechanism must remove a concrete failure mode. The kernel remains small; higher-level capabilities are composed through policy, workflow, provider, and federation layers.

---

## 3. Layered Architecture

```text
TaskCharacterization
  -> ProfileSelector
  -> CollaborationProfile
  -> CollaborationKernel
  -> Decision
  -> WorkflowOrchestrator
  -> Provider
  -> Artifact
  -> EvidenceRef
  -> Verification Decision
```

### 3.1 Collaboration Kernel

The collaboration kernel is the minimal multi-agent decision system.

It owns:

- Collecting `AgentOutput`.
- Applying `EvidencePolicy`.
- Applying `ReductionPolicy`.
- Applying `ConvergencePolicy`.
- Emitting `Decision` and `ConvergenceResult`.

It does not own:

- Long-running task state.
- Provider execution.
- Artifact storage.
- Budget enforcement.
- A2A transport.
- UI presentation.

### 3.2 Workflow Orchestrator

The workflow layer owns long-running execution.

It consumes `Decision`, checks Policy, updates state, schedules Providers, records artifacts, creates checkpoints, and triggers replan/resume.

`Decision` is a recommendation. Workflow state transition is a separate transaction.

### 3.3 Provider Layer

Providers execute external effects and return `ProviderResult` plus `Artifact`.

Providers cannot mark tasks accepted. Provider success only means the Provider completed the requested command.

### 3.4 Policy / Guard System

Policy is a cross-cutting guard layer. It checks collaboration, evidence admission, provider execution, workflow state transition, budget, risk, and federation boundaries.

Hard guards cannot be overridden by LLM output.

### 3.5 Federation / A2A Layer

A2A is transport, not trust.

Remote agents can be represented as `RemoteParticipant` or `RemoteAgentProvider`, but their outputs and artifacts must pass local TrustPolicy and EvidencePolicy before they affect local acceptance.

---

## 4. Core Pipeline

```text
1. Characterize task
2. Select minimal sufficient CollaborationProfile
3. Instantiate ParticipantPolicy, EvidencePolicy, ReductionPolicy, ConvergencePolicy
4. Collect AgentOutput from participants
5. Admit or reject EvidenceRef according to EvidencePolicy
6. Reduce outputs into Decision
7. Check convergence
8. Return one of:
   - converged: emit Decision
   - continue: run next round with focus
   - escalate: ask user or upper layer
   - failed: terminate with reasons
```

The kernel must not continue without focus. Every additional round needs a concrete unresolved issue.

---

## 5. Profiles, Not Engines

`CollaborationProfile` is a policy bundle:

```text
CollaborationProfile =
  ParticipantPolicy
  + EvidencePolicy
  + ReductionPolicy
  + ConvergencePolicy
  + activation_conditions
  + anti_patterns
  + cost_class
```

Examples:

| Profile | Purpose | Primary reduction |
|---|---|---|
| VerificationGate | L0 deterministic verification | gate result |
| Roundtable | Exploration and option discovery | summary |
| DebateJudge | Conflicting alternatives | judge decision |
| Swarm | Homogeneous parallel work | majority / score |
| ExpertMesh | Multi-domain synthesis | merge |
| Hierarchy | Authority-controlled signoff | authority |
| ExpertHierarchy | High-risk, high-complexity long task | merge then signoff |

The default is not ExpertHierarchy. The default is the minimal sufficient profile selected from task characterization.

---

## 6. Roles, Not Fixed Agents

The architecture does not require nine always-on roles.

A participant is described by:

```text
Participant = kind + perspective + authority + trust_level + capabilities
```

Perspectives are temporary collaboration viewpoints:

- `producer`
- `critic`
- `verifier`
- `reducer`
- `authority`
- `risk_guard`
- `observer`

The minimum useful collaboration is:

```text
producer + independent verifier
```

Self-review may exist, but it cannot be the only acceptance source.

---

## 7. Evidence-Centered Trust

Evidence is not a model explanation.

Evidence is a independently reviewable factual anchor:

```text
EvidenceRef = uri + claim + verification_status + trust_level
```

`Artifact` is the produced object. `EvidenceRef` is the claim that uses the artifact as proof.

Model-only evidence cannot support automatic acceptance. Deterministic evidence should be preferred whenever available.

---

## 8. Long Task Boundary

Long-running work is outside the minimal kernel.

The workflow layer owns:

- `ProjectContract`
- `TaskGraph`
- `Task`
- `Run`
- `Artifact`
- `GateResult`
- `Checkpoint`
- `WorkflowEvent`

Resume happens from accepted checkpoints, not from LLM context.

Replan should produce a bounded `TaskGraphPatch`, not a full restart.

---

## 9. Provider Boundary

Provider commands must be structured:

```text
ProviderCommand = intent + target + inputs + constraints + expected_artifacts + policy_scope
```

Provider execution is guarded by:

- PreflightPolicy
- ExecutionPolicy
- PostflightPolicy

High-risk side effects belong to `ActionProvider` and require RiskPolicy plus human signoff by default.

---

## 10. Federation Boundary

Remote agents are untrusted by default.

Agent Card is a capability claim, not a capability proof.

Remote evidence has three levels:

1. `RemoteClaim`
2. `RemoteSignedArtifact`
3. `LocallyReproducedEvidence`

Local Workflow remains the local source of truth. Remote task state is only a projection.

Federated calls require:

- TrustPolicy
- DelegatedBudget
- DisclosurePolicy
- AuditReceipt
- RemoteEvidencePolicy

---

## 11. Non-Goals

This document does not define:

- Concrete database schema.
- Concrete Go interfaces.
- Desktop UI components.
- A2A protocol field mapping.
- Full provider implementations.
- Product copy or interaction design.

Those should be derived after this architecture is accepted.

---

## 12. Current Decision

The first version of the Peers-Touch multi-agent orchestration design should implement the architecture as:

```text
Policy-driven Collaboration Kernel
+ Long-running Workflow Orchestrator
+ Provider execution boundary
+ Cross-cutting Policy Guard
+ Federation-aware Trust/Evidence model
```

The central invariant:

```text
Agent judges.
Policy guards.
Workflow owns state.
Provider executes.
Artifact anchors facts.
Human authorizes.
```
