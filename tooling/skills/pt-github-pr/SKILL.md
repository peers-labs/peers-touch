---
name: pt-github-pr
description: >
  Use when the user asks to create a pull request, update a PR, or when you
  need to manage GitHub PRs. Handles PR creation with standardized templates,
  labels, and issue linking for the Peers-Touch project.
stage: "DELIVER"
requires: ["commits pushed to feature branch"]
produces: ["open PR with passing checks"]
next: "pt-github-review"
---

# GitHub PR — Pull Request Management Skill

Create and manage GitHub Pull Requests with standardized descriptions,
automatic labeling, and issue linking using the `gh` CLI.

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth status`)
- Current branch pushed to remote (`git push -u origin <branch>`)

## PR Modes

- **Tracked PR**: the worktree has a live PlanMount. The mounted Plan must be
  complete, the successful Development Session must be supplied to the
  submit-time pipeline, and push/PR must be authorized.
- **Standalone PR**: the worktree has no live PlanMount. It does not require a
  Plan or Development Session. The submit-time pipeline derives scope from the
  Git range and records formal Acceptance as `NOT RUN/UNPROVEN`.

`PLAN_MOUNT_REQUIRED` selects standalone mode. Any malformed, stale, conflicting,
or identity-mismatched mount remains a blocking error. Plan absence alone never forces a draft PR.
Explicit user no-Plan intent also selects standalone mode and forbids creating
a placeholder Plan or Development Session for delivery.

## PR Creation Workflow

### 1. Pre-flight Checks

Classify the current worktree without requiring a Plan:

```bash
python3 tooling/scripts/execution-plan.py \
  --require-complete \
  --allow-untracked
```

For tracked mode, an incomplete Plan blocks a normal ready-for-review PR. For
standalone mode, continue without creating a placeholder Plan or Session.

```bash
# Verify gh auth
gh auth status

# Ensure branch is pushed
git push -u origin "$(git branch --show-current)"

# Check for existing PR on this branch
gh pr list --head "$(git branch --show-current)" --state open
```

### 2. Run Submit-Time Review Pipeline

When the user asks to submit an MR/PR, run the quality lifecycle before creating
or updating the PR. Default to `origin/master` unless the user specifies another
base branch.

```bash
git fetch origin

# Tracked PR
make review-submit \
  REVIEW_BASE=origin/master \
  SESSION=<development-session.json>

# Standalone PR
make review-submit REVIEW_BASE=origin/master
```

This pipeline generates quality evidence, runs strict review framework checks,
validates acceptance structure, plans acceptance gates, runs selected `ci-*`
acceptance gates for tracked work, invokes `pt-acceptance-gap-detector` for
tracked work, and renders the available evidence. Standalone work keeps formal
Acceptance explicitly `NOT RUN/UNPROVEN`; that status is not itself a pipeline
failure.

If the pipeline fails:

- do not open a normal ready-for-review PR;
- fix the failure when it is actionable;
- or ask the user whether to open a draft PR that explicitly lists evidence gaps;
- or record an owner-approved waiver in the PR body.

The generated evidence artifacts are immutable external Evidence Store roles:

- `quality-evidence` / `quality-markdown`
- `quality-evidence` / `quality-json`
- `acceptance-report` / `report`

Inspect them with:

```bash
python3 tooling/scripts/acceptance-artifact.py cat \
  --gate <gate-id> --role <role>
```

### 3. Analyze Changes

```bash
# Get the diff against the target branch (usually main)
git log --oneline origin/master..HEAD
git diff --stat origin/master..HEAD
```

### 4. Determine PR Metadata

#### Title

Use the same Conventional Commits format as commit messages:

```
<type>(<scope>): <concise description>
```

If the PR contains a single commit, reuse its message as the title.
If multiple commits, summarize the overall change.

#### Labels

Map from commit types and changed file paths:

| Commit type | Label |
|-------------|-------|
| `feat` | `enhancement` |
| `fix` | `bug` |
| `docs` | `docs` |
| `refactor` | `refactor` |
| `test` | `test` |
| `ci` | `ci` |
| `perf` | `performance` |

Platform labels are auto-assigned by the labeler workflow based on file paths.

#### Reviewers

If the user specifies reviewers, include them. Otherwise, omit (rely on CODEOWNERS or manual assignment).

### 5. Generate PR Body

Use the project PR template structure. Fill in each section based on actual changes:

```markdown
## Summary / 概述

<EN: Brief description of what this PR does and why>
<CN: 简要描述本 PR 做了什么、为什么做>

## Execution Plans / 执行计划

<Tracked: - `docs/architecture/<domain>/execution-plans/<plan>/plan.md`>
<Standalone: - None>

## Changes / 变更内容

- <EN: change 1 / CN: 变更 1>
- <EN: change 2 / CN: 变更 2>

## Motivation / 动机

<EN: Why is this change needed?>
<CN: 为什么需要这个变更？>

## Type / 变更类型

- [x] `<type>` — <EN description> / <CN 描述>

## Scope / 影响范围

- [x] <affected platform/module>

## Test Plan / 测试计划

- [x] <EN: how it was tested / CN: 如何测试的>

## Quality Evidence / 质量证据

- Execution plan:
- Range:
- Review profiles:
- Matched knowledge:
- Acceptance impacted features:
- Evidence gaps:
- Unproven scope:

## Framework Growth Opportunities / 框架成长机会

- knowledge:
- acceptance:
- hard rules / fixtures:
- skill:
- CI / tooling:
- no-growth justification:

## Related Issues / 关联 Issue

Closes #<issue number>

## AI Traceability / AI 溯源

- Tool / 工具: <tool name>
- Model / 模型: <model name>
```

**Important**: PR title uses English only (Conventional Commits format).
PR body uses bilingual (EN + CN) for all descriptive sections.
Each section header is bilingual. Content within each section should
provide both English and Chinese descriptions.

### 6. Create PR

```bash
gh pr create \
  --title "<type>(<scope>): <description>" \
  --body "$(cat <<'EOF'
<generated PR body>
EOF
)" \
  --label "<label1>,<label2>" \
  --base main
```

For draft PRs (work in progress):

```bash
gh pr create --draft \
  --title "<type>(<scope>): <description>" \
  --body "<body>"
```

## PR Update Operations

### Update title or body

```bash
gh pr edit <pr-number> --title "<new title>"
gh pr edit <pr-number> --body "<new body>"
```

### Add labels

```bash
gh pr edit <pr-number> --add-label "<label1>,<label2>"
```

### Add reviewers

```bash
gh pr edit <pr-number> --add-reviewer "<user1>,<user2>"
```

### Mark ready for review

```bash
gh pr ready <pr-number>
```

### View PR status

```bash
gh pr view <pr-number>
gh pr checks <pr-number>
gh pr diff <pr-number>
```

### Merge PR

```bash
# Squash merge (preferred for feature branches)
gh pr merge <pr-number> --squash --delete-branch

# Merge commit (for long-lived branches)
gh pr merge <pr-number> --merge --delete-branch

# Rebase merge
gh pr merge <pr-number> --rebase --delete-branch
```

### List PRs

```bash
# Open PRs
gh pr list

# PRs by author
gh pr list --author "@me"

# PRs with specific label
gh pr list --label "station"
```

## Branch Naming Convention

When creating feature branches, use:

```
<type>/<scope>-<short-description>
```

Examples:
- `feat/desktop-notification-bell`
- `fix/station-auth-refresh`
- `refactor/proto-core-cleanup`
- `docs/mobile-setup-guide`

## Anti-Patterns

- **Never** create a PR without pushing the branch first
- **Never** require a placeholder Plan or Development Session for standalone work
- **Never** override explicit user no-Plan intent to satisfy PR tooling
- **Never** create a normal ready-for-review PR before running the submit-time review pipeline
- **Never** leave the PR description empty — always fill the template
- **Never** omit quality evidence, evidence gaps, or unproven scope from the PR body
- **Never** force-push to a PR branch that others are reviewing
- **Never** merge your own PR without at least one approval (when team size > 1)
- **Never** include unrelated changes in a PR — keep PRs focused
