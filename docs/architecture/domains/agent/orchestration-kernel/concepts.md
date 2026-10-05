# Agent Orchestration Kernel — Concepts

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-24
> **Owner**: Peers-Touch Agent Team

---

## 1. Concept Map

```text
TaskCharacterization
  -> ProfileSelector
  -> CollaborationProfile
  -> CollaborationSession
  -> AgentOutput[]
  -> EvidencePolicy
  -> ReductionPolicy
  -> Decision
  -> ConvergencePolicy
  -> ConvergenceResult
  -> WorkflowOrchestrator
```

---

## 2. CollaborationSession

A bounded collaboration instance.

It is not a long-running workflow state machine. It is the "room" in which participants produce outputs, the kernel reduces them, and convergence is evaluated.

Minimum fields:

```text
CollaborationSession {
  id
  goal
  round
  status
  participants
  outputs
  decisions
}
```

---

## 3. AgentOutput

The raw output from one participant in one collaboration round.

Minimum fields:

```text
AgentOutput {
  id
  participant_id
  perspective
  stance
  content
  evidence_refs
  confidence
}
```

Rules:

- Raw outputs must be retained for audit and attribution.
- Outputs without evidence may be considered candidates, but cannot become automatic acceptance evidence.
- Outputs from remote participants must include trust metadata.

---

## 4. ParticipantPolicy

Defines who participates, what perspective each participant has, what authority each participant has, and which authorities must be separated.

It replaces fixed role lists.

Minimum structure:

```text
ParticipantPolicy {
  participants
  perspectives
  authorities
  separation_rules
  expansion_rules
}
```

Core perspectives:

- `producer`
- `critic`
- `verifier`
- `reducer`
- `authority`
- `risk_guard`
- `observer`

Core authorities:

- `propose`
- `object`
- `verify`
- `veto`
- `reduce`
- `signoff`
- `escalate`

Minimum collaboration:

```text
producer + independent verifier
```

---

## 5. EvidenceRef

A reference to an independently reviewable factual anchor that supports a claim.

EvidenceRef is not the same as Artifact.

```text
Artifact = produced object
EvidenceRef = claim supported by that object
```

Minimum fields:

```text
EvidenceRef {
  id
  type
  uri
  claim
  locator
  verification_status
  trust_level
  produced_by
  observed_at
}
```

Minimum required fields:

```text
uri + claim + verification_status
```

Evidence types:

- `deterministic_evidence`
- `source_evidence`
- `runtime_evidence`
- `human_evidence`
- `model_evidence`
- `remote_evidence`

Verification status:

- `unverified`
- `self_reported`
- `verified_local`
- `verified_remote_signature`
- `verified_reproduced`
- `disputed`
- `expired`

---

## 6. EvidencePolicy

Defines which evidence is admissible for proposal, objection, verification, blocking, or acceptance.

Minimum structure:

```text
EvidencePolicy {
  required_for_acceptance
  required_for_veto
  min_trust_level
  allowed_evidence_types
  expiration_rules
  conflict_resolution_rules
}
```

Rules:

- Model evidence cannot be the only evidence for automatic acceptance.
- Evidence conflict blocks automatic acceptance until resolved.
- Remote evidence must declare trust level and verification status.
- Deterministic evidence should be preferred when available.

---

## 7. ReductionPolicy

Defines how multiple `AgentOutput` objects are reduced into one `Decision`.

It answers:

```text
Who can influence the result?
How are outputs merged, selected, or rejected?
What vetoes block reduction?
```

Minimum structure:

```text
ReductionPolicy {
  mode
  participant_weights
  authority_rules
  veto_rules
  evidence_rules
  conflict_rules
  output_selection_rules
}
```

Common modes:

- `summary`
- `majority`
- `ranked_vote`
- `judge`
- `authority`
- `veto_gate`
- `score`
- `merge`

---

## 8. Decision

A structured result produced by the collaboration kernel.

Decision is not a command, not a state transition, and not a provider execution.

Minimum structure:

```text
Decision {
  id
  session_id
  kind
  summary
  recommendation
  evidence_refs
  participants
  accepted_outputs
  rejected_outputs
  unresolved_objections
  confidence
  execution_policy
  next_action
}
```

Decision kinds:

- `proposal`
- `verification`
- `rejection`
- `clarification`
- `escalation`
- `plan`
- `risk_block`

Decision levels:

- `informational`
- `advisory`
- `blocking`

Rules:

- Acceptance decisions require sufficient evidence.
- Blocking decisions must expose reasons and evidence.
- Decision cannot directly modify Workflow state.

---

## 9. ConvergencePolicy

Defines whether a `Decision` is enough to end the collaboration.

It answers:

```text
Can we stop?
Should we continue another round?
Should we escalate?
Should we fail?
```

Minimum structure:

```text
ConvergencePolicy {
  max_rounds
  acceptance_conditions
  blocking_objection_rules
  continuation_rules
  escalation_rules
  failure_rules
}
```

---

## 10. ConvergenceResult

The result of applying `ConvergencePolicy` to a `Decision`.

Minimum structure:

```text
ConvergenceResult {
  status
  reasons
  next_round_focus
  escalation_payload
}
```

Statuses:

- `converged`
- `continue`
- `escalate`
- `failed`

Rules:

- `continue` must include `next_round_focus`.
- `max_rounds` exhaustion cannot force acceptance.
- L2 subjective judgment cannot be automatically accepted.

---

## 11. CollaborationProfile

A reusable policy bundle. It is not an engine class.

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

- `VerificationGate`
- `Roundtable`
- `DebateJudge`
- `Swarm`
- `ExpertMesh`
- `Hierarchy`
- `ExpertHierarchy`

The default selection principle is minimal sufficient profile.

---

## 12. TaskCharacterization

The normalized task profile used by `ProfileSelector`.

Minimum fields:

```text
TaskCharacterization {
  intent_type
  complexity
  risk_level
  subjectivity_level
  verifiability_level
  parallelizability
  domain_diversity
  conflict_likelihood
  evidence_availability
  trust_boundary
  budget_class
  requires_signoff
}
```

The selector should not map raw user input directly to a profile.

---

## 13. ProfileSelector

Selects a minimal sufficient profile or a staged profile plan.

Output:

```text
ProfileSelection {
  profile_id
  characterization
  rationale
  required_policies
  disabled_capabilities
  escalation_expectation
  cost_estimate
}
```

Rules:

- Rule-based guards precede LLM suggestions.
- LLM cannot downgrade risk or bypass budget/trust/human-signoff requirements.
- Complex tasks may produce `ProfilePlan` instead of a single profile.

---

## 14. WorkflowOrchestrator

The long-running task controller.

It owns:

- Task state.
- TaskGraph.
- Provider scheduling.
- State transitions.
- Checkpoints.
- Replan and resume.
- Budget circuit breaking.

It consumes Decision; it does not delegate state ownership to the collaboration kernel.

---

## 15. Provider

An execution adapter that performs external effects.

Provider returns:

```text
ProviderResult + Artifact[]
```

Provider cannot mark a task accepted.

Provider command:

```text
ProviderCommand {
  intent
  target
  inputs
  constraints
  expected_artifacts
  policy_scope
}
```

Provider types:

- `CodingProvider`
- `DataProvider`
- `ResearchProvider`
- `ActionProvider`
- `RemoteAgentProvider`

---

## 16. PolicyDecision

The structured output of policy checks.

```text
PolicyDecision {
  status
  reasons
  required_actions
  constraints
  evidence_refs
  escalation_payload
}
```

Statuses:

- `allow`
- `allow_with_constraints`
- `deny`
- `require_human`
- `require_more_evidence`
- `escalate`

---

## 17. RemoteParticipant and RemoteAgentProvider

Remote agents can participate in collaboration or execute delegated work, but both paths must pass local trust and evidence policies.

Remote evidence levels:

- `RemoteClaim`
- `RemoteSignedArtifact`
- `LocallyReproducedEvidence`

Agent Card is a capability claim, not a capability proof.

Remote agents are `remote_untrusted` by default.
