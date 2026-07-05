---
name: "pt-branch-conflict-guardian"
description: "Guides semantic conflict resolution across parallel branches. Invoke when rebasing, merging, cherry-picking, or reconciling overlapping PRs/worktrees."
---

# Branch Conflict Guardian

Use this skill when parallel branches, worktrees, PRs, or commits overlap and
the agent is asked to merge, rebase, cherry-pick, reconcile, or resolve conflicts.

## Invoke When

- A branch is behind `master` / `main` and must be updated.
- A PR conflicts after another PR lands.
- The user says "有冲突", "处理冲突", "rebase", "merge", "cherry-pick",
  "更新到 master", "合并分支", or equivalent.
- Multiple worktrees are in active development and touched file sets overlap.
- A conflict involves generated artifacts, contracts, runtime projections,
  persistence, protocol, product behavior, or tests that encode behavior.

## Core Rule

Conflict resolution is semantic integration, not text selection.

Auto-resolve only when the intended result is mechanically provable. For every
behavioral, ownership, protocol, persistence, UI/UX, or test-expectation
divergence, first explain both branches' intent and evidence. If the intent is
unclear or the correct owner is unclear, stop and ask the developer.

This skill exists because Peers-Touch often has multiple active PRs touching the
same runtime surface. Passing CI after a merge is not enough; the integrated
behavior must still match the source-of-truth contract.

## Workflow

### 1. Build The Merge Map

Before changing files, collect the topology and scope:

- current branch and target branch;
- merge base;
- commits, PR numbers, titles, and summaries on both sides;
- overlapping files grouped by domain;
- source files vs generated files;
- relevant plan, architecture, runtime, or knowledge documents.

Use read-only commands first:

```bash
git status --short --branch
git merge-base HEAD <target>
git log --oneline --decorate <target>..HEAD
git log --oneline --decorate HEAD..<target>
git diff --name-status <target>...HEAD
git diff --name-status HEAD..<target>
git merge-tree $(git merge-base HEAD <target>) HEAD <target>
```

### 2. Classify Each Conflict

Classify each conflict before editing:

| Class | Meaning | Agent Action |
|---|---|---|
| `mechanical` | Formatting, import order, deterministic generated output, duplicate locale/test reorder. | May auto-resolve with explanation and verification. |
| `contract` | Proto/API/runtime projection/source-of-truth semantics differ. | Resolve only from the owning contract or escalate. |
| `behavior` | Product flow, UI/UX, state model, or failure behavior differs. | Escalate unless source docs/tests decide it. |
| `persistence` | Schema, migration, idempotency, cursor, durability, or ownership differs. | Treat as high risk; require tests and owner clarity. |
| `test-intent` | Both sides changed tests or fixtures to encode different behavior. | Identify the real requirement before changing tests. |
| `unknown` | The agent cannot explain either side's intent. | Stop and ask. |

For every non-mechanical conflict, maintain a conflict ledger:

- `File`
- `Our Side`: what current branch introduced and why
- `Their Side`: what target branch introduced and why
- `Evidence`: commits, PR body, docs, tests, code ownership
- `Shared Intent`: the behavior both sides appear to preserve
- `Divergence`: the incompatible behavior or ownership choice
- `Decision`: auto-resolved / resolved from source of truth / escalated

The ledger can be local notes, but final reports must summarize semantic
decisions and all escalations.

### 3. Decide Whether The Agent May Resolve

The agent may resolve without asking only when all are true:

- the conflict is mechanical or ordering-only;
- both sides preserve the same source-of-truth contract;
- a deterministic generator, authoritative document, or focused test proves the
  intended result;
- no product behavior, persistence semantics, security posture, or ownership
  boundary changes.

The agent must escalate when any are true:

- either side's background is unknown;
- both sides are valid but encode different product choices;
- the merged behavior would create a new contract not stated by either branch;
- passing tests could be achieved by weakening or rewriting test intent;
- resolving requires choosing a runtime owner, persistence owner, or rollout
  policy.

### 4. Resolve With Source-Of-Truth Priority

When resolution is allowed:

- prefer the highest source-of-truth layer: architecture > platform >
  specification > execution plan > PR text > local inference;
- regenerate generated files from their source, never hand-merge them as the
  deciding artifact;
- preserve both branch intents only when the combined behavior has a clear owner
  and failure mode;
- add or update tests that prove the integrated behavior;
- keep the final diff minimal and delete dead alternatives created during
  conflict exploration.

### 5. Escalate With A Useful Packet

When owner input is required, ask one precise question per conflict group:

```markdown
Conflict: `<file or behavior>`
Our side: <what this branch introduced, with commit/PR if known>
Their side: <what target branch introduced, with commit/PR if known>
Functional divergence: <the incompatible behavior or ownership choice>
Background found: <docs/PR/tests/code evidence already checked>
Options:
1. <integrate both by ...> - risk: <risk>
2. <prefer current branch behavior ...> - risk: <risk>
3. <prefer target branch behavior ...> - risk: <risk>
Recommendation: <only if evidence supports it>
Question: Which behavior should own this contract?
```

Do not continue that semantic conflict until the owner answers or a
source-of-truth document unambiguously decides it. Continue independent
mechanical conflicts only if they cannot bias the pending decision.

## Verification

Before claiming the merge/rebase is ready:

- `git status --short --branch` shows no unresolved conflicts.
- Conflict ledger has no `blocked` entries.
- Source files, not generated artifacts alone, explain generated changes.
- Relevant tests or gates for each affected domain have run or are explicitly
  listed as not run.
- If a developer answered an escalation, the final report cites the decision.
- The final diff does not contain compatibility shims, silent fallbacks, or
  duplicated implementations introduced only to avoid choosing a contract.

For PR readiness, also run the normal review or submit pipeline for the target
scope, such as `make review-submit REVIEW_BASE=<base>`.

## Output

Use this report shape:

```markdown
Plan Source
- <branch/PR/docs/gates used>

Scope Completed
- <branches reconciled and domains touched>

Conflict Decisions
- <file/domain>: <resolution and why>

Escalations
- <unresolved semantic conflicts, or "None">

Evidence
- <commands/gates and result>

Claim
- <strongest accurate claim>
```

## Anti-Patterns

Never:

- use `git checkout --ours`, `git checkout --theirs`, `git reset --hard`, or
  mass file replacement as the resolution strategy;
- resolve by "keeping both" when both implementations claim the same ownership;
- resolve unknown behavior by making tests match the merged code;
- hide a functional divergence under "merge cleanup";
- treat CI passing as proof that semantic conflicts were correctly resolved;
- merge generated files without checking the source contract;
- continue past a conflict you cannot explain clearly to the responsible
  developer.
