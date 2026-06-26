# Agent Orchestration Kernel

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-24
> **Owner**: Peers-Touch Agent Team

This directory defines the Peers-Touch multi-agent orchestration architecture.

The design centers on a policy-driven collaboration kernel. The kernel turns multiple evidence-backed agent outputs into auditable decisions, while workflow, providers, policy guards, evidence storage, and federation remain separate architectural layers.

---

## Documents

| Document | Purpose |
|---|---|
| [overview.md](./overview.md) | Layered architecture, kernel boundary, workflow/provider/policy/federation boundaries |
| [concepts.md](./concepts.md) | Canonical concepts: CollaborationSession, AgentOutput, EvidenceRef, Decision, policies, profiles, providers |
| [principles-and-constraints.md](./principles-and-constraints.md) | Architecture principles, operational constraints, and implementation boundaries |

---

## Core Position

```text
Agent judges.
Policy guards.
Workflow owns state.
Provider executes.
Artifact anchors facts.
Human authorizes.
```

---

## Read Order

1. Read [overview.md](./overview.md) for the architecture shape.
2. Read [concepts.md](./concepts.md) for the vocabulary.
3. Read [principles-and-constraints.md](./principles-and-constraints.md) before writing implementation plans.

---

## Implementation Entry

Implementation should start from the stable kernel contracts:

```text
CollaborationKernel
ParticipantPolicy
EvidencePolicy
ReductionPolicy
ConvergencePolicy
Decision
```

Collaboration profiles, workflow automation, provider integrations, and federation capabilities should be layered on top of these contracts.
