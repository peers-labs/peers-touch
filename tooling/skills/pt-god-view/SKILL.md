---
name: "pt-god-view"
description: >
  God view: the Peers-Touch methodology operating system. When invoked, the agent
  enters structured thinking mode — using the project's stage pipeline, skill
  system, and architectural principles to reason about and execute work. Invoke
  when user says "continue", "resume", "use the system", "think properly", or
  any time the agent should operate under the full Peers-Touch methodology.
stage: "orchestrator"
requires: []
produces: ["stage-aware reasoning", "correct skill dispatch", "active_work updates"]
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
5. **Progress tracking** — update active_work registry after state changes

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

---

## 3. Thinking Framework

When god-view is active, the agent reasons in this order:

### 3.1 What Kind of Work Is This?

First, classify the work mode:

| Mode | Signal | What to do |
|------|--------|-----------|
| **Tracked project** | User mentions something in active_work registry, or says "continue" | Read registry → locate plan → resume from stage+step (§3.2) |
| **New multi-step work** | Cross-module, new capability, architecture implications | Classify stage (§4) → maybe create registry entry → dispatch |
| **Standalone task** | Small feature, bug fix, single-module change, "just do X" | Apply execution standards (§3.3) directly — no plan/registry needed |
| **Review/audit** | "Check", "review", "is this right", "validate", "audit" | Identify what to review → pick the right review skill (§3.6) |
| **Unknown** | Cannot confidently classify into any of the above | Apply §3.7 (Uncertainty Protocol) |

For standalone tasks, the agent skips DESIGN/PLAN stages but still operates
under methodology: proper edits, proper checks, proper commits.

### 3.2 Stage Reasoning (for tracked/multi-step work)

```
Read project_memory.md → active_work registry table
Match user's intent to a registry entry (by plan name, keyword, or #id)
If resuming: locate plan file path + stage + current_step
If new multi-step: classify (§4) and add to registry
```

| Stage | The agent is asking... | Key skill |
|-------|----------------------|-----------|
| DESIGN | "What are the boundaries, ownership, contracts?" | `pt-architecture-design-methodology` |
| PLAN | "What's the dependency order, what can parallelize?" | `pt-architecture-execution-methodology` + `pt-plan-and-document` |
| EXECUTE | "What's the next step in the plan?" | `pt-execution-plan-guardian` |
| DELIVER | "Is this ready to ship?" | `pt-github-commit` + `pt-github-pr` |

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
- **Architecture constrains implementation** — upper layers constrain lower
- **Plan before code** — no freestyle on multi-step work
- **Evidence before claims** — verify with commands, not assumptions
- **Review before advance** — generate review prompt at each gate

### 3.5 What Skill Do I Call?

The agent must NOT do the work itself when a skill exists for it:

| Situation | Do NOT freestyle | DO invoke |
|-----------|-----------------|-----------|
| Need to design architecture | Write design ad-hoc | `pt-architecture-design-methodology` |
| Need to break down into steps | List steps from memory | `pt-architecture-execution-methodology` |
| Need to write plan to file | Just dump markdown | `pt-plan-and-document` |
| Need to implement planned step | Code without checking plan | `pt-execution-plan-guardian` |
| Need to commit | `git commit -m "stuff"` | `pt-github-commit` |
| Need to create PR | `gh pr create` bare | `pt-github-pr` |
| Need review | Self-approve | `pt-github-review` |
| Touching Desktop kernel | Edit freely | Check `pt-desktop-runtime-projections` |
| Any file edit | Just edit | Check `pt-read-before-edit` |

### 3.6 Review/Audit Dispatch

When the user wants to check, validate, or audit something:

| What to review | How | Reference |
|----------------|-----|-----------|
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
| Needs new boundary / ownership / contract decision | DESIGN | Architecture not yet defined |
| Architecture exists, needs implementation breakdown | PLAN | Architecture accepted, plan needed |
| Plan exists and accepted | EXECUTE | Ready to implement |
| Single-file bug / cosmetic fix | EXECUTE (small-fix) | Skip DESIGN+PLAN |
| Code done, ready to ship | DELIVER | Package and submit |

If unclear: "Is this a new architecture decision, or implementation of something already planned?"

---

## 5. Status Display

When asked for status or resuming:

```
## Current Work

| # | Work | Stage | Step | Branch | Last Active |
|---|------|-------|------|--------|-------------|
| 1 | Provider Station Ownership Phase 1 | EXECUTE | Step 1 | main | 2026-07-23 |

Currently at: EXECUTE stage, Step 1 (Proto generation).
Next action: invoke pt-execution-plan-guardian to execute Step 1.

Continue?
```

---

## 6. Lifecycle Operations

| User says | Action |
|-----------|--------|
| "new task" | Classify → add to registry → dispatch |
| "close #N" | Set `stage: complete` |
| "blocked" | Set `blocked: true` + reason |
| "switch to #N" | Change focus → dispatch |

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
5. **Track state** — update active_work registry on every meaningful state change.
6. **Respect gates** — never skip a review boundary.
