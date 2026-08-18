---
name: "pt-completion-auditor"
description: "Audits Peers-Touch work for completion, architecture, security, code quality, tests, docs, and evidence. Invoke for AI self-checks or readiness claims."
---

# Peers-Touch Completion Auditor

Use this skill to audit whether a Peers-Touch change is actually complete,
well-structured, safe, and honestly evidenced.

This is a project-wide auditor. It is not specific to Atelier and must cover all
relevant Peers-Touch domains: Desktop, Station, Mobile, Applet runtime, Agent /
orchestration, federation, model/proto contracts, packages, tooling, docs, and
prototype surfaces.

## Invoke When

Invoke this skill when the user asks any of:

- "检查完成度", "审核完成度", "做完了吗", "还差什么", "继续前先检查".
- "检查代码", "检查规范", "检查架构", "检查安全", "全局看一下".
- "AI 自检", "让 AI 审核自己的完成", "不要只说完成".
- Before claiming a non-trivial feature, phase, integration, or refactor is
  complete, ready, production-ready, or safe to联调.
- After work spans more than one Peers-Touch layer, for example Desktop +
  Station, applet-sdk + manifest + gateway, proto + generated clients, or docs +
  code + tests.

Do not invoke for isolated one-line edits unless the user explicitly asks for
completion, readiness, or risk review.

## Core Rule

Never audit by vibes.

Every conclusion must be tied to:

- Concrete changed files.
- Accepted product capabilities, journeys, visible states, and acceptance
  assertions when the work is product-facing.
- Authoritative plan/spec/docs, when available.
- Runtime / contract boundaries.
- Executed commands or explicitly missing evidence.
- Known Peers-Touch architecture rules.

If a claim is not proven, mark it as `UNPROVEN`, not `PASS`.

## Relationship To Existing Skills

- `pt-execution-plan-guardian`: keeps work tied to plan and evidence while
  executing.
- `pt-quality-check`: gathers review/acceptance evidence for a PR or range.
- `pt-completion-auditor`: performs a multi-dimensional completion and
  architecture audit for a change or workstream, including AI overclaim checks.

Use this skill when the question is broader than code review and asks whether
the work is complete, coherent, safe, and aligned across Peers-Touch.

## Required Audit Dimensions

### 1. Requested Scope Completion

Check the user's actual request and the current workstream.

- Trace product-facing work to accepted product capability/journey IDs.
- List requested outcomes.
- Mark each as `DONE`, `PARTIAL`, `UNPROVEN`, `NOT STARTED`, or `OUT OF SCOPE`.
- Identify any "done" wording that is only backed by mock, mapper, docs, or
  local-only evidence.
- Separate formal plan completion from conversation-local progress.

### 2. Peers-Touch Architecture Fit

Check whether the implementation respects Peers-Touch boundaries.

- Desktop app is a host / gateway / client shell, not a Station replacement.
- Station subservers own backend truth, persistence, and typed service behavior.
- Applets use applet-sdk / Host bridge and declared manifest permissions.
- Agent / orchestration owns multi-agent execution, provider scheduling,
  checkpoints, gates, traces, and runtime decisions.
- Prototypes may demonstrate UI but must not be reported as production runtime.
- Docs must not claim stronger readiness than code and tests prove.

Flag any boundary violation as at least `P1`, and `P0` if it creates data loss,
security bypass, or false production readiness.

### 3. Cross-Layer Contract Consistency

For any cross-layer change, verify all relevant representations line up:

- TypeScript types and runtime adapters.
- Rust Desktop gateway payloads, permissions, and event translation.
- Go Station request/response structs and service mappers.
- Protobuf / model objects, if touched or implied.
- Applet manifest permissions and capability registry.
- JSON field naming compatibility: `snake_case` and `camelCase` where events
  cross Go / Rust / TypeScript.
- Docs and examples.

Report mismatches with the exact layers involved.

### 4. Security And Permission Review

Check:

- Authentication and actor/session context.
- Ownership checks for task, artifact, message, file, applet, or station data.
- Manifest permission allow/deny behavior.
- Gateway method authorization.
- Dangerous operations: purge, delete, revoke, publish, rollback, filesystem,
  network, token, secret, and event subscription.
- Data leakage through logs, telemetry, projection payloads, or docs.

Security claims require direct evidence. If only the happy path was tested, say
so.

### 5. Robustness And State Semantics

Check:

- Empty, nil, malformed, or partial payloads.
- Duplicate events, replay, outbox retry, SSE reconnect, and idempotency.
- Snapshot vs incremental event consistency.
- Local fallback vs Host runtime behavior.
- Lifecycle operations and irreversible actions.
- Error behavior and user-facing failure state.
- Backward compatibility with existing mock/prototype data.

### 6. Code Quality And Maintainability

Check:

- Clear domain naming and no misleading capability names.
- No fake APIs or manifest permissions for unimplemented gateway methods.
- No hidden coupling across Desktop / Station / applet / prototype layers.
- No over-broad helpers that collide with existing package functions.
- Minimal duplication, or duplication called out as temporary compatibility.
- Tests are targeted and not just implementation restatements.

### 7. Verification Evidence

Classify every verification command:

- `PASS`: command ran and covers the claim.
- `FAIL`: command ran and failed.
- `NOT RUN`: command not executed.
- `NOT APPLICABLE`: not required for this scope.
- `INSUFFICIENT`: command ran but does not prove the claim.

Never treat:

- Type-check as product runtime proof.
- Unit mapper tests as end-to-end proof.
- Mock bridge as real Host proof.
- Manifest validation as live permission proof.
- Docs update as implementation proof.

### 8. Documentation And Plan Alignment

Check:

- Product definition, benchmark disposition, experience/state contracts,
  prototype status, architecture, and plan remain mutually consistent.
- Docs updated where behavior or contract changed.
- Old docs do not contradict new architecture.
- The plan-owned Context Anchor matches the actual worktree and branch, status
  table, tracking source, evidence, blockers, and next action.
- `active_work`, todos, dashboards, and chat projections do not claim progress
  stronger than the plan-owned Anchor.
- Acceptance Infra readiness is judged from `acceptance_core_self_validation`
  and framework evidence. Business injection and reverse-validation gaps are
  reported separately and do not block Infra unless the generic mechanism is
  defective.
- "Current state" and "remaining work" are explicit.
- Terms like `done`, `ready`, `production`, `联调`, `真源`, `mock`,
  `projection`, and `runtime` are used accurately.

### 9. Global Completion Map

For multi-layer work, produce a map:

- UI / client surface.
- Runtime adapter.
- Applet SDK / bridge.
- Desktop gateway.
- Station endpoint / service.
- Persistence / model / proto.
- Agent / orchestration.
- Tests / gates.
- Docs / operational knowledge.

Each layer must be marked `DONE`, `PARTIAL`, `UNPROVEN`, `NOT STARTED`, or
`OUT OF SCOPE`.

## Severity

Use this severity model:

- `P0`: Blocks correctness, security, data integrity, or would make a readiness
  claim false in a dangerous way.
- `P1`: Important completion, architecture, permission, or robustness gap that
  should be fixed before merge or real联调.
- `P2`: Maintainability, documentation, or evidence gap that should be tracked
  but does not block the next local step.

## Workflow

### Step 1. Establish Audit Target

Identify:

- User request being audited.
- Changed files or planned files.
- Whether the audit target is local diff, a named module, a workstream, or a
  readiness claim.
- Which Peers-Touch domains are touched.

If the scope is unclear, ask one concise clarification question.

Before building the completion matrix, invoke `pt-acceptance-gap-detector` for
every product or runtime proof claim. Carry each detector gap into Findings and
keep the affected requirement `UNPROVEN` or `BLOCKED`.

### Step 2. Find Authoritative Sources

Prefer:

- Accepted product definition, benchmark disposition, experience/state
  contracts, acceptance matrix, and confirmed prototype references.
- `docs/architecture/**`
- `docs/client/**`
- `docs/station/**`
- `docs/global/**`
- `docs/knowledge/**`
- `AGENTS.md`, `PROJECT.md`, `README.md`
- Applet manifests and package contracts.
- User decisions in the current conversation.

If no source exists, say `No formal source found` and audit against an explicit
temporary checklist.

### Step 3. Inspect Cross-Layer Diffs

Read changed files and nearby code. For each changed layer, inspect its
counterparts:

- TS contract -> Rust gateway -> Go service -> docs.
- Manifest permission -> capability registry -> gateway authorization.
- Snapshot type -> mapper -> event patch -> runtime applyPatch -> UI consumer.
- Proto/model -> persistence -> service -> generated clients.

Do not audit only the file that changed if the behavior crosses layers.

### Step 4. Build The Completion Matrix

Create a table:

| Requirement | Status | Evidence | Gaps |
| --- | --- | --- | --- |

Statuses must be one of:

- `DONE`
- `PARTIAL`
- `UNPROVEN`
- `NOT STARTED`
- `OUT OF SCOPE`

### Step 5. Produce Findings

List concrete issues first, ordered by severity.

Each finding must include:

- Title.
- Severity.
- Confidence.
- Location.
- Why it matters.
- Suggested fix or next evidence.

If no concrete defect is found, say so, but still list residual unproven areas.

### Step 6. Make An Honest Readiness Claim

End with the strongest accurate claim:

- `Ready for local continuation`
- `Ready for static review only`
- `Ready for fake-host integration`
- `Ready for real Desktop/Station联调`
- `Not ready`

Choose the weakest claim that is fully supported by evidence.

## Output Format

Use this structure:

```markdown
**Audit Scope**
- Target:
- Domains:
- Sources:

**Findings**
- `P0/P1/P2` <title> — <location>
  Impact:
  Evidence:
  Fix:

**Completion Matrix**
| Product capability/journey | Architecture/plan closure | Status | Evidence | Gaps |
| --- | --- | --- | --- | --- |

**Architecture Map**
| Layer | Status | Notes |
| --- | --- | --- |

**Verification**
- `<command>`: PASS/FAIL/NOT RUN/INSUFFICIENT — <what it proves>

**Residual Risk**
- <risk that remains unproven>

**Readiness Claim**
- <one accurate claim>
```

## Anti-Overclaim Rules

Never say:

- "全局完成" when only a projection or mapper is implemented.
- "真实可用" when only mock / fake host / unit tests ran.
- "安全" when only manifest validation passed but deny-path was not tested.
- "端到端" when Desktop Host, Station, persistence, and UI were not exercised in
  one flow.
- "生产 ready" while bundle integrity, rollout, revoke, audit, or migration gates
  are pending.

Always distinguish:

- Code exists.
- Code compiles.
- Unit tests pass.
- Fake integration passes.
- Real environment passes.
- Product readiness gates pass.
