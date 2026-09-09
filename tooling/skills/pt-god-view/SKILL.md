---
name: "pt-god-view"
description: "Orchestrates stage-aware Peers-Touch work. Invoke for new tasks, resume or status requests, and work requiring product-to-delivery gates."
stage: "orchestrator"
requires: []
produces: ["stage-aware reasoning", "correct skill dispatch", "active_work updates", "Context Anchor projection"]
---

# God View

When this skill is active, the agent operates under the Peers-Touch methodology
system. It thinks in stages, dispatches to the right skills, and follows the
project's architectural principles.

**Without god-view**: agent freestyles — just writes code or answers questions.
**With god-view**: agent reasons structurally — identifies the stage, picks the
right skill, follows gates, tracks progress.

---

## 1. What This Skill Does

1. **Situational awareness** — read active_work, know where we are
2. **Stage reasoning** — determine which stage applies to what the user wants
3. **Skill dispatch** — invoke the correct methodology/execution skill
4. **Methodology enforcement** — ensure work follows Peers-Touch principles
5. **Progress tracking** — after a formal plan exists, synchronize plan evidence,
   `active_work`, and the required chat Context Anchor

---

## 2. Trigger Phrases

Invoke when user says:
- "继续做" / "接着" / "continue" / "resume"
- "看看状态" / "what's the status"
- "用体系来做" / "think properly" / "use the system"
- "开始新任务" / "new task"
- "关掉那个" / "close that"

Also invoke when the agent recognizes it should be operating methodologically
rather than freestyling (e.g., cross-module work, architecture decisions,
multi-step implementations).

### 2.1 Worktree Identity Gate

Skill discovery and execution context are separate. A skill source path selects
instructions only; it MUST NOT select or change the execution worktree. The
current verified worktree remains bound.

Before any stage dispatch and before the first edit:

1. Require one explicitly selected current worktree. If the session exposes
   multiple candidate roots and none is explicit, stop for clarification. Do
   not choose from a skill path, plan path, branch name, or nearby repository.
2. From that exact root, capture the candidate identity with
   `python3 tooling/scripts/verify-worktree-binding.py --root '<absolute-root>' --capture`.
3. Compare the captured identity with every worktree identity in `active_work`,
   the selected plan, and the latest Context Anchor. A missing verifier or
   unresolved field returns `WORKTREE_IDENTITY_UNAVAILABLE`; a mismatch or
   later drift returns `WORKTREE_IDENTITY_MISMATCH`. Both stop without
   automatic `cd`, branch switch, or worktree selection.
4. From the same root, immediately verify the captured identity with
   `python3 tooling/scripts/verify-worktree-binding.py --root '<absolute-root>' --branch '<branch>' --workspace-id '<workspaceId>' --head '<expected-head>' --worktree-set-digest '<digest>'`,
   then bind its canonical root, branch, `workspaceId`, initial HEAD, expected
   HEAD, and worktree-set digest. Materialized values must each be one POSIX
   shell-safe argument.
5. Re-run the exact verifier after resume or context compaction and before status,
   readiness, handoff, or completion reporting.

Every mutating tool call must set the bound canonical root as its explicit
`workdir`; file mutation tools must use absolute paths below that root.
Subagents inherit the full immutable binding and verify it before writes.

The initial HEAD remains the audit baseline. Expected HEAD may refresh only
after an explicitly authorized commit, rebase, or merge. The worktree-set
digest may refresh only after an explicitly requested worktree operation. Do
not run `git switch`, `git checkout`, `git worktree add`,
`git worktree remove`, or `git worktree prune`, and do not create a worktree,
unless the user explicitly requested that exact operation.

After initial registration, `active_work` owns the persisted initial HEAD,
expected HEAD, and worktree-set digest. Resume or context compaction verifies
those values and MUST NOT recapture current Git state as a replacement
baseline.

---

## 3. Thinking Framework

When god-view is active, the agent reasons in this order:

0. Verify the immutable worktree binding through §2.1.

### 3.1 What Kind of Work Is This?

First, classify the work mode:

| Mode | Signal | What to do |
|------|--------|-----------|
| **Tracked project** | User mentions something in active_work registry, or says "continue" | Read registry → locate plan → resume from stage+step (§3.2) |
| **New multi-step work** | Cross-module, new capability, architecture implications | Classify stage (§4) → dispatch; register only after a formal plan exists |
| **Standalone task** | Small feature, bug fix, single-module change, "just do X" | Apply execution standards (§3.3) directly — no plan/registry needed |
| **Review/audit** | "Check", "review", "is this right", "validate", "audit" | Identify what to review → pick the right review skill (§3.6) |
| **Unknown** | Cannot confidently classify into any of the above | Apply §3.7 (Uncertainty Protocol) |

For standalone tasks, the agent skips PRODUCT/DESIGN/PLAN stages but still operates
under methodology: proper edits, proper checks, proper commits.

### 3.2 Stage Reasoning (for tracked/multi-step work)

```
Read project_memory.md → active_work registry table
Match user's intent to a registry entry (by plan name, keyword, or #id)
If resuming: locate plan file path + stage + current_step
If new multi-step: classify (§4); PRODUCT/DESIGN remain untracked
When pt-plan-and-document creates the formal plan: add the active_work row
```

| Stage | The agent is asking... | Key skill |
|-------|----------------------|-----------|
| PRODUCT | "Who is this for, what complete outcome and experience must we deliver?" | `pt-product-design-methodology` |
| DESIGN | "What are the boundaries, ownership, contracts?" | `pt-architecture-design-methodology` |
| PLAN | "What's the dependency order, what can parallelize?" | `pt-architecture-execution-methodology` + `pt-plan-and-document` |
| EXECUTE | "What's the next step in the plan?" | `pt-execution-plan-guardian` |
| DELIVER | "Is this ready to ship?" | `pt-github-commit` + `pt-github-pr` |

For a tracked Goal, `blocked=true` is not accepted as a permanent shortcut.
On resume, rerun `pt-trae-goal-orchestrator` queue review and
`pt-execution-plan-guardian` frontier derivation. Clear the tracked blocker when
accepted sources expose any legal ready, diagnostic, remediation, or mechanical
plan-amendment action.

### 3.3 Execution Standards (ALWAYS apply, any work mode)

Regardless of whether it's a tracked project or standalone task, the agent MUST:

| Before | Standard | How |
|--------|----------|-----|
| Before editing any file | Check operational knowledge | `pt-read-before-edit` |
| Before fixing a bug | Layer-ownership audit | Ask: "Which layer owns this state?" — if the fix targets a different layer than the owner, STOP and redesign. See §3.3.1 |
| Before editing Desktop kernel | Check runtime contracts | `pt-desktop-runtime-projections` |
| Before writing UI strings | Use i18n | `packages/locales/` — never hardcode |
| Before committing | Conventional format | `pt-github-commit` |
| While writing code | Follow §5 Iron Laws + §7 Code Generation Rules | No console.log, no secrets, no mock, no `any` type |
| While writing Go | DDD + Go style | `./tooling/scripts/check-go-style.sh` |
| While writing TS | No debug statements, proper typing | `pnpm run check` |
| After implementation | Verify | Platform verification commands (§10 of AGENTS.md) |

#### 3.3.1 Layer-Ownership Audit (mandatory before bug fixes)

Before writing ANY fix, the agent MUST answer these three questions internally:

1. **What state is broken?** (e.g., "deleted model reappears")
2. **Who owns that state?** (per architecture docs: Station / Rust BFF / Frontend)
3. **Does my fix write to the owning layer?**

If the answer to #3 is NO — the fix is a **patch** and MUST be rejected. The agent
reports: "This requires a change at [owning layer]. Here's what's needed." and
proposes the correct-layer fix instead.

**Patch indicators** (auto-reject if detected in own output):
- Frontend filtering/hiding data that should be persisted server-side
- Adding local state for something that belongs in Station
- Stubbing a command that should have real backend logic
- Using `setTimeout`/polling to mask a missing event/notification

### 3.4 Core Principles (always in effect)

- **Proto-first** — cross-platform contracts in proto before implementation
- **Station owns truth** — client caches, Station decides
- **Product outcome before architecture** — user journeys and acceptance constrain system design
- **Architecture constrains implementation** — upper layers constrain lower
- **Plan before code** — no freestyle on multi-step work
- **Evidence before claims** — verify with commands, not assumptions
- **Review before advance** — generate review prompt at each gate

### 3.5 What Skill Do I Call?

The agent must NOT do the work itself when a skill exists for it:

| Situation | Do NOT freestyle | DO invoke |
|-----------|-----------------|-----------|
| Need to design a product/capability | Start from a feature checklist | `pt-product-design-methodology` |
| Need to design architecture | Write design ad-hoc | `pt-architecture-design-methodology` |
| Need to break down into steps | List steps from memory | `pt-architecture-execution-methodology` |
| Need to write plan to file | Just dump markdown | `pt-plan-and-document` |
| Need a TRAE `/goal`, multi-subagent execution contract, or Goal review | Assemble an ad hoc prompt | `pt-trae-goal-orchestrator` |
| Need tracked-work status, resume, handoff, or blocker projection | Reconstruct from chat | `pt-context-anchor` |
| Need to implement planned step | Code without checking plan | `pt-execution-plan-guardian` |
| Need to optimize/audit Acceptance Infra | Let business evidence drive framework readiness | `pt-acceptance-infra-engineering` |
| Need business Domain Acceptance injection/proof | Infer onboarding or start from a Gate | `pt-acceptance-engineering` |
| Need to commit | `git commit -m "stuff"` | `pt-github-commit` |
| Need to create PR | `gh pr create` bare | `pt-github-pr` |
| Need review | Self-approve | `pt-github-review` |
| Touching Desktop kernel | Edit freely | Check `pt-desktop-runtime-projections` |
| Any file edit | Just edit | Check `pt-read-before-edit` |

### 3.6 Review/Audit Dispatch

When the user wants to check, validate, or audit something:

| What to review | How | Reference |
|----------------|-----|-----------|
| Product design quality | Use `pt-product-design-methodology` review gate | Users/jobs, benchmark disposition, journeys, states, prototype, acceptance |
| Architecture docs (structure, naming, completeness) | Read `docs/global/architecture-document-standard.md` → check each file against spec | Required files, metadata, naming rules |
| Architecture design quality | Generate architecture review prompt (per earlier pattern) → user sends to reviewer | Invariants, ownership table, forbidden relationships |
| Execution plan quality | Generate plan review prompt (§7.2 of `pt-plan-and-document`) → user sends | Dependency order, scope, verification |
| Code quality / PR readiness | `pt-quality-check` → `pt-completion-auditor` | Evidence, tests, style |
| PR code review | `pt-github-review` | Risk-focused merge recommendation |
| UI component structure | `pt-frontend-component-tree-review` | Lifetime, alive policy, jank |

For "check if docs are 规范的" specifically:
1. Read `docs/global/architecture-document-standard.md` for the spec
2. List all files in the target module directory
3. Check: required files present? metadata blocks? naming conventions? navigation links?
4. Report findings as a structured checklist

### 3.7 Uncertainty Protocol

When the agent cannot confidently classify the work mode or determine which
skill to invoke:

**Rule: ask, don't guess. Do nothing until clarified.**

1. State what you understood from the user's request (one sentence).
2. State what you're unsure about (one sentence).
3. Offer 2-3 concrete options for the user to pick from.

Example:
```
I understand you want to do something with the provider module, but I'm not
sure if this is:
- (A) Continue implementing Phase 1 of the existing plan
- (B) A new standalone change unrelated to the plan
- (C) A review/audit of what's already done

Which one?
```

**What the agent MUST NOT do when uncertain:**
- Guess a work mode and proceed silently
- Fall back to freestyle (ignoring methodology)
- Invoke a random skill hoping it fits
- Start writing code without knowing the context

---

## 4. Task Classification

When starting new work:

| Signal | Stage | Reasoning |
|--------|-------|-----------|
| New product/module/capability, workflow redesign, or benchmark rebuild | PRODUCT | Product outcome and acceptance are not yet defined |
| Add/complete Acceptance for an existing module | CROSS-STAGE | Invoke `pt-acceptance-engineering`; its gap matrix determines PRODUCT, DESIGN, PLAN, EXECUTE, or REVIEW |
| Optimize or audit Acceptance Core, planner, validator, runner, Evidence Store, generic lifecycle, or framework tooling | CROSS-STAGE | Invoke `pt-acceptance-infra-engineering`; business injection gaps are non-blocking handoffs |
| Product accepted; needs new boundary / ownership / contract decision | DESIGN | Architecture not yet defined |
| Product and architecture accepted; needs implementation breakdown | PLAN | Accepted contracts need an execution plan |
| Plan exists and accepted | EXECUTE | Ready to implement |
| Single-file bug / cosmetic fix | EXECUTE (small-fix) | Skip PRODUCT+DESIGN+PLAN |
| Code done, ready to ship | DELIVER | Package and submit |

If unclear: "Is this a new product/capability, a new architecture decision, or
implementation of something already accepted and planned?"

---

## 5. Status Display

When asked for tracked-work status or resume:

1. Re-verify the bound canonical root, branch, `workspaceId`, expected HEAD,
   and worktree-set digest through §2.1 without replacing the persisted
   baseline.
2. Resolve the `active_work` entry and readable formal plan.
3. Invoke `pt-context-anchor`.
4. Record `<worktree-name> (<repo-root>)`, verified branch, `workspaceId`,
   initial HEAD, expected/verified HEAD, and worktree-set digest in the chat
   projection. A bare `<repo-root>` is invalid; never persist a user-home
   absolute path.
5. For a status-only request, end the response with the exact fenced chat
   projection required by that skill. For "continue" or "resume" with one
   unambiguous tracked item, emit a concise update and dispatch the next legal
   Ready Queue action without asking for another confirmation.

If no formal plan and matching `active_work` row exist, do not fabricate an
Anchor. Report the current PRODUCT/DESIGN/PLAN gate in normal prose.

---

## 6. Lifecycle Operations

| User says | Action |
|-----------|--------|
| "new task" | Classify → dispatch; add to registry only after a formal plan is created |
| "close #N" | Set `stage: complete` |
| "blocked" | Run queue exhaustion audit; set `blocked: true` only when no legal ready/remediation action remains |
| "switch to #N" | Change tracked-work focus only after its identity matches the current binding; never switch branch/worktree implicitly |

---

## 7. Gate Enforcement

At each stage boundary, the agent MUST:

1. Generate a structured review prompt (per the stage skill's template)
2. Present it to the user
3. Wait for user to decide whether to send for review
4. Only advance past the gate when review passes or user explicitly approves

The agent NEVER self-approves a gate.

---

## 8. Stale Detection

When showing status, flag entries with `last_session` >14 days:

```
⚠️ #2 has been idle for 25 days. Still active?
```

---

## 9. Relationship Map

```
pt-god-view (methodology OS / entry point)
  │
  ├── TRAE GOAL orchestration
  │     └── pt-trae-goal-orchestrator (stage-owned graph → bounded adaptive Goal queue)
  │
  ├── TRACKED-WORK projection
  │     └── pt-context-anchor (active_work + plan evidence → fenced chat block)
  │
  ├── ACCEPTANCE cross-stage entry
  │     ├── pt-acceptance-infra-engineering
  │     │     └── framework-only contracts, lifecycle, tooling, and self-validation
  │     └── pt-acceptance-engineering
  │           ├── business Domain injection and proof
  │           ├── pt-dev-runtime-handoff (runtime evidence)
  │           └── pt-quality-check (review evidence)
  │
  ├── PRODUCT stage
  │     ├── pt-product-design-methodology
  │     └── pt-prototype-design (when UI is material)
  │
  ├── DESIGN stage
  │     └── pt-architecture-design-methodology
  │
  ├── PLAN stage
  │     ├── pt-architecture-execution-methodology (analysis)
  │     └── pt-plan-and-document (file + review prompt)
  │
  ├── EXECUTE stage
  │     ├── pt-execution-plan-guardian (plan adherence)
  │     ├── pt-read-before-edit (knowledge check)
  │     ├── pt-desktop-runtime-projections (if Desktop)
  │     └── pt-completion-auditor (exit gate)
  │
  └── DELIVER stage
        ├── pt-github-commit
        ├── pt-github-pr
        └── pt-github-review
```

---

## 10. Rules

1. **Explicit invocation only** — does not auto-trigger on casual chat.
2. **Methodology over speed** — when active, the agent follows the system even if it's "slower" than freestyling.
3. **Show reasoning** — state which stage, which skill, why, before acting.
4. **Delegate to skills** — god-view decides WHO to call, never does the work itself.
5. **Track state** — pre-plan PRODUCT/DESIGN work has no Anchor. Once a formal
   plan exists, update plan/tracking evidence first, then `active_work`, then
   emit the `pt-context-anchor` chat projection when reporting.
6. **Respect gates** — never skip a review boundary.
7. **Fail closed on identity** — return `WORKTREE_IDENTITY_MISMATCH` for an
   unresolved, mismatched, or drifting binding; never repair it implicitly.
8. **Block only after exhaustion** — park blocked actions, recompute the full
   in-scope ready frontier, and continue legal work. A Goal-level block requires
   an empty ready queue and only hard governance or unavailable external
   resource boundaries remaining.
