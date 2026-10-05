---
name: pt-agent-development
description: Produces deterministic Agent ModuleImpact, proof invalidation, and failure ownership for the existing Development Workflow. Use for implementation or fixes on Agent architecture surfaces.
---

# Agent Development

Apply this domain policy inside `pt-dev-workflow`. Dev Workflow still owns
declaration, cross-module aggregation, target resolution, resource planning,
scheduling, authorization, Session state, review, delivery, and resource
release. This Skill emits only one standard `ModuleImpact`: what an Agent
change affects, which target capabilities it needs, and what evidence remains
valid.

## Invoke When

- Changing `model/domain/agent/`, `apps/station/app/subserver/agent/`, Agent
  Desktop/Mobile surfaces, or `packages/agent-catalog/`.
- Changing Agent-owned Acceptance injection, harnesses, fixtures, runtime
  profiles, execution plans, or closure tooling.
- Resuming an Agent task after a failed Journey, Gate, Completion Review, or
  evidence-integrity check.
- Deciding whether an existing Agent proof can be reused after source changes.

Do not invoke for generic workflow or Acceptance Infra development that has no
Agent claim. Route those changes to their owning specialist.

## Required Sources

Read in this order:

1. The current Agent Task and its `closureId`, `journeyId`, `doneWhen`,
   `failureBehavior`, checks, and write set.
2. [`modern-chat-agent/README.md`](../../../docs/architecture/domains/agent/modern-chat-agent/README.md)
   and the architecture documents it prioritizes.
3. The current Development Session, latest formal Gate manifest, and current
   Completion Review receipt.
4. [`impact-policy.json`](./impact-policy.json).

Do not copy Agent architecture facts, Gate commands, or environment topology
into this Skill. Consume their current canonical sources.

## Core Rule

```text
changed paths
  -> deterministic impact classes
  -> affected proof identity
  -> standard ModuleImpact
  -> Dev Workflow target/resource aggregation
  -> one failure owner
  -> fresh Completion Review
```

Git HEAD is audit metadata. It is not proof identity and must not force a
Station deployment or Formal Gate by itself.

## Developer Experience Contract

The developer uses this flow through ordinary natural-language development
requests. The Agent owns the classifier, policy files, commands, and evidence
comparison. Never ask the developer to run an internal script, inspect JSON, or
decide which Gate to execute in order to accept this flow.

Before execution, show one concise decision:

```text
Current worktree: <existing user-selected worktree>
Change impact: <classes in developer language>
Will run: <focused checks, deployments, Journeys, Gates>
Will reuse: <named proof and unchanged identity>
Will not run: <explicitly skipped expensive work and why>
```

Then execute the admitted work autonomously and close with observed results.
The developer accepts behavior by checking that the visible decision matches
the actual actions, not by reading implementation files.

Use the existing worktree selected by the developer. Never create a worktree
unless the developer explicitly asks for a new one in the current request.
`OWNERSHIP_SPLIT_REQUIRED` creates a separate Task and declaration; it does not
authorize another worktree.

## Impact Decision

Run the deterministic classifier internally before selecting checks or runtime
work:

```bash
python3 tooling/skills/pt-agent-development/scripts/impact.py \
  --pretty impact \
  --git-range HEAD
```

For an existing proof, supply both fingerprints:

```bash
python3 tooling/skills/pt-agent-development/scripts/impact.py \
  --pretty impact \
  --git-range <base>..HEAD \
  --before-proof <previous-proof-fingerprint.json> \
  --current-proof <current-proof-fingerprint.json>
```

The output has exactly these impact classes:

| Class | Owner surface | Target selector |
|---|---|---|
| `STATION_RUNTIME` | Station Agent kernel | `station` |
| `DESKTOP_HOST` | Desktop Rust capability/bridge | `desktop-native` |
| `DESKTOP_UI` | Native Desktop embedded renderer | `desktop-native` |
| `SHARED_CONTRACT` | Agent proto/catalog/shared clients | Named affected consumers |
| `ACCEPTANCE_HARNESS` | Agent Gate/driver/fixture/profile | `acceptance-suite-runtime` |
| `WORKFLOW_TOOLING` | Session/Plan/review/admission tooling | none |
| `DOCS_ONLY` | Agent docs/Plan projection | none |

`POLICY_REQUIRED` is fail-closed. Add or correct a path rule before continuing;
do not silently map an unknown path to a broad product deployment.
`NOT_APPLICABLE` means every recognized path belongs to a generic workflow or
Acceptance owner and no Agent-owned path anchored the change; route it to that
owner instead of emitting Agent checks or targets.
`OWNERSHIP_SPLIT_REQUIRED` means product source and generic workflow or
Acceptance infrastructure changed together; move the infrastructure correction
to its own Task in the designated owner worktree before running product proof.
Shared files such as the global Gate registry or generic Provisioners may
contribute impact only when an Agent-owned path anchors the same change set.
They never make a standalone change an Agent task.

## Proof Reuse

Product proof is reusable only when this identity tuple is unchanged:

```text
claimId
+ closureContractDigest
+ affectedComponentDigests
+ gateImplementationDigest
+ runtimeProfileDigest
```

Use content digests from the owning systems. Never substitute branch, commit,
timestamp, file mtime, Gate count, or a prose statement.

Interpret classifier results exactly:

- `REUSE_ALLOWED`: skip product deployment and Formal Gate; run affected
  focused checks and obtain a fresh Completion Review.
- `REUSE_CANDIDATE`: do not schedule product runtime work; refresh and compare
  the proof fingerprints before claiming reuse.
- `REPROVE_REQUIRED`: run only the reported deployments/functional targets,
  then the affected Formal Gate.
- `POLICY_REQUIRED`: stop proof selection and classify the evidence or path
  integrity gap.

Changes to `WORKFLOW_TOOLING` do not invalidate product proof. Changes to the
Gate implementation invalidate Gate proof but not unchanged product runtime.
Changes to a runtime profile require reprovisioning, not an automatic Station
source deployment. Changes to Agent runtime source require only its affected
runtime targets.

## ModuleImpact Contract

The classifier output is `kind=peers-touch-module-impact`. It contains:

- `moduleId`, `changeKinds`, and `moduleDependencies`;
- focused check, target, Journey, Gate, and optional logical resource
  requirements;
- ownership-split and source-freeze classification;
- proof invalidation and reuse evidence.

Target selectors are logical requirements, not deployment commands or concrete
resource IDs. The Skill must not inspect the machine ledger, select accounts,
allocate clients/devices, start services, acquire leases, or provision an
Acceptance runtime.

`pt-dev-workflow` combines every participating module's `ModuleImpact` with the
current Plan target graph and Runtime Owner inventory, then runs
`dev-resources-prepare`. That owner:

- computes target dependency waves and peak reusable capacity;
- deduplicates compatible account, service, client, device, Fixture, and
  automation-session requirements;
- chooses `REUSE | RESTART | BUILD | PROVISION`;
- atomically publishes the concrete claims for each ready target;
- parks only resource-conflicting targets;
- records a source-bound resource plan with a fencing token.

Business Gates consume the prepared Runtime/Suite manifest and remain
attach-only. They never provision, allocate, log in, or release resources.

## Execution Discipline

1. Let `pt-dev-workflow` verify the existing user-selected worktree identity
   and publish the source/runtime declaration. Do not create a worktree.
2. Classify the complete current change set. Do not classify only the latest
   file or latest commit in a remediation chain.
3. Confirm every changed path has one policy rule and inspect the emitted
   impact classes, target selectors, and proof action.
4. If `ownershipSplitRequired=true`, split generic workflow changes from
   product source before continuing.
5. Return the `ModuleImpact` to `pt-dev-workflow`. The Dev Workflow resolves
   targets, resource inventory, existing manifests, and capacity before any
   runtime acquisition. Classifier selectors are requirements, not replacement
   commands.
6. Implement the smallest owner-local correction. Keep workflow, harness, and
   product defects in separate Tasks when ownership differs; use their
   designated existing owner worktrees.
7. Run reported focused checks.
8. Run an agent-led pre-review and remediate findings before source freeze.
9. Freeze a clean exact source. No source edit is allowed between freeze and a
   Formal Gate without returning to step 2.
10. Reuse proof only after the five-part fingerprint comparison authorizes it.
   Otherwise execute only the target actions resolved by Dev Workflow, run the
   real Journey, then run the affected Formal Gate.
11. Obtain a current independent Completion Review receipt. Enter
    `DELIVERY_READY` only when that receipt is `PASS`.

Do not run broad Acceptance before the real affected Journey passes. Do not
repeat a product Journey or Gate for a workflow-only remediation.

## Failure Ownership

Record the first actionable failure using exactly one of:

- `PRODUCT_DEFECT`
- `HARNESS_DEFECT`
- `WORKFLOW_DEFECT`
- `ENVIRONMENT_BLOCKER`
- `EVIDENCE_INTEGRITY`

Use the deterministic failure classifier:

```bash
python3 tooling/skills/pt-agent-development/scripts/impact.py \
  --pretty failure \
  --signals <failure-signals.json>
```

The signal precedence is evidence integrity, environment readiness, workflow
integrity, harness integrity, then the independent product oracle. Fix the
classified owner only. After the fix, reclassify the complete change set
instead of replaying the previous deployment sequence.

Examples:

- A product oracle fails with healthy evidence, environment, workflow, and
  harness: `PRODUCT_DEFECT`.
- The real product Journey passes but an assertion/cleanup driver fails:
  `HARNESS_DEFECT`.
- Session, Plan, admission, or Completion Review rejects valid product
  evidence: `WORKFLOW_DEFECT`.
- Credentials, host availability, or an external service prevents execution:
  `ENVIRONMENT_BLOCKER`.
- A digest is missing/stale, source is not frozen, or proof identity cannot be
  reconstructed: `EVIDENCE_INTEGRITY`.

## Verification

Internal deterministic verification:

```bash
python3 tooling/skills/pt-agent-development/scripts/test_impact.py
python3 tooling/skills/pt-agent-development/scripts/impact.py \
  replay
tooling/scripts/review/skill-check.sh
git diff --check -- tooling/skills/pt-agent-development AGENTS.md
```

The MCA-P04 replay must contain 18 forensic commits. In particular:

- `545c165eb` must classify as `DOCS_ONLY + WORKFLOW_TOOLING`, with no
  Station deployment and no Formal Gate.
- `9112be8c2` must classify identically.
- Runtime and harness commits must still require their affected proof.

Use `replay --verify-git` only in a forensic checkout that contains every
referenced commit object; ordinary clones validate the captured path fixture.

Developer-facing black-box acceptance uses normal requests, not commands:

1. **Workflow-only remediation** — ask the Agent to continue an Agent task whose
   current change contains only Plan/docs/Completion Review tooling. The visible
   decision must say no Station deployment and no Agent Formal Gate; execution
   runs focused workflow checks and refreshes Completion Review.
2. **Station runtime change** — ask for an Agent Station behavior change. The
   visible decision must include Station deployment, the real Agent Journey,
   and affected Formal Gate.
3. **Mixed ownership** — ask for one change that combines Agent product source
   with generic workflow or Acceptance Infra repair. The Agent must create a
   separate Task, stay in existing designated worktrees, and must not run
   product proof over the mixed source set.
4. **Worktree guard** — in every scenario, the Agent must name the current
   worktree before execution and create no worktree unless the current request
   explicitly asks for one.

Acceptance fails if the visible decision and observed commands differ, if the
developer must choose internal checks, or if skipped expensive work has no
proof-reuse reason.

## Output

Persist the classifier JSON as internal evidence. Show the developer:

```text
Agent task/claim
Impact classes
Focused checks
Target selectors and resolved runtime actions
Proof reuse decision
Failure classification
Source freeze
Completion Review receipt
Delivery state
```

Do not claim `DELIVERY_READY` when proof reuse is pending, source changed after
freeze, a required Gate is unproven, or Completion Review is not current PASS.

## Anti-Patterns

Never:

- become a second Dev Workflow, scheduler, Guardian, or Acceptance registry;
- select concrete accounts, services, clients, devices, Fixtures, or
  automation sessions;
- translate target selectors into deployment commands;
- ask the developer to run classifier/test scripts or inspect policy JSON to
  accept the process;
- create a worktree without an explicit current-request instruction;
- deploy Station because any file changed or because Git HEAD changed;
- rerun a Formal Gate for `WORKFLOW_TOOLING` or operational doc changes when
  the five-part product proof identity is unchanged;
- reuse proof because the same Gate name passed on an earlier source;
- treat harness, workflow, or environment failures as product defects;
- patch generic workflow/Acceptance infrastructure inside an Agent product task;
- run review after Formal Gate and then edit source, forcing another proof loop;
- mark `DELIVERY_READY` before independent current-source Completion Review
  returns `PASS`.
