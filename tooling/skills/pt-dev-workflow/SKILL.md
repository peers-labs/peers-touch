---
name: pt-dev-workflow
description: >
  Use when the user asks to start a complete development task, from planning
  through coding to PR creation. Drives the full Peers-Touch development
  lifecycle with status tracking and standardized outputs at each phase.
---

# Dev Workflow — Development Lifecycle Skill

Drive a complete development task through a structured workflow with
status tracking, confirmation checkpoints, and standardized deliverables.

## Workflow Phases

```
planning → coding → review → release → completion
```

| Phase | Description | Deliverable |
|-------|-------------|-------------|
| `planning` | Gather requirements, analyze scope, design solution | Execution plan |
| `coding` | Implement changes, write tests | Code + commits |
| `review` | Create PR, self-review, address feedback | Approved PR |
| `release` | Merge PR, tag version (if needed) | Merged code |
| `completion` | Verify, generate summary | Summary report |

## Status Tracking

All workflow state is tracked in `.pt-dev-workflow/<session-id>/status.json`.
See `status-schema.md` for the full schema.

### Four-Beat Rhythm (every step)

1. **Read** status.json → know current phase and context
2. **Execute** the operation for current phase
3. **Write** deliverable artifacts
4. **Update** status.json with results

## Phase Details

### Phase 1: Planning

**Entry**: User describes a task or issue.

**Actions**:
1. Analyze the request — what needs to change and why
2. Identify affected platforms/modules (Station, Desktop, Mobile, Proto)
3. Read relevant source code to understand current state
4. Draft execution plan

**Confirmation Checkpoint**: Present the plan to the user and wait for approval.

```markdown
## Execution Plan / 执行计划

### Goal / 目标
EN: <what we're building>
CN: <我们要做什么>

### Scope / 范围
- Files to modify: <list>
- New files: <list>
- Platform: <Station|Desktop|Mobile|Proto>

### Approach / 方案
EN: <how we'll implement it>
CN: <如何实现>

### Risks / 风险
- <potential issues>
```

**Wait for user approval before proceeding.**

### Phase 2: Coding

**Entry**: Plan approved by user.

**Actions**:
1. Implement changes following the approved plan
2. Follow platform-specific conventions (see `docs/.agent/<platform>.md`)
3. Write tests if applicable
4. Create standardized commits using `pt-github-commit` skill
5. Push to feature branch

**Branch naming**: `<type>/<scope>-<short-description>`

**Commit convention**: Use `pt-github-commit` skill for every commit.

### Phase 3: Review

**Entry**: Coding complete, branch pushed.

**Actions**:
1. Run submit-time review pipeline:

   ```bash
   make review-submit REVIEW_BASE=origin/master
   ```

2. Self-review the diff and evidence:
   - `git diff origin/master..HEAD`
   - `tooling/acceptance/reports/latest-quality-evidence.md`
   - `tooling/acceptance/reports/latest-report.md`
3. Run additional platform verification commands when the submit pipeline or route profile requires them:
   - Desktop: `cd apps/desktop && pnpm run check && pnpm run test`
   - Station: `cd apps/station && go test ./...`
   - Go style: `./tooling/scripts/check-go-style.sh`
4. Create PR using `pt-github-pr` skill (bilingual description with quality evidence and growth opportunities)
5. Address any CI failures

**Deliverable**: Open PR with passing checks.

### Phase 4: Release (optional)

**Entry**: PR approved and merged.

Only if the user requests a release:
1. Determine version bump from commits using `pt-github-release` skill
2. Create tag and GitHub Release with bilingual changelog

### Phase 5: Completion

**Entry**: PR merged (and optionally released).

**Actions**:
1. Generate summary report
2. Clean up feature branch
3. Update status.json to completed

**Summary template**:

```markdown
## Development Summary / 开发总结

### Task / 任务
EN: <what was done>
CN: <做了什么>

### Changes / 变更
- <list of changes>

### PR
- PR #<number>: <title>
- Status: Merged

### Verification / 验证
- [ ] Lint: passed
- [ ] Tests: passed
- [ ] Build: passed

### AI Traceability / AI 溯源
- Tool: <tool>
- Model: <model>
```

## Skill Dependencies

This workflow orchestrates other skills:

| Phase | Skills Used |
|-------|------------|
| coding | `pt-github-commit` |
| review | `pt-github-pr`, `pt-github-review` |
| release | `pt-github-release` |

## Session Management

- Each task gets a unique session: `YYYYMMDD-HHmmss`
- Status file: `.pt-dev-workflow/<session-id>/status.json`
- Artifacts: `.pt-dev-workflow/<session-id>/plan.md`, `summary.md`
- Sessions are local (gitignored)

Add to `.gitignore`:
```
.pt-dev-workflow/
```

## Interruption & Resume

If a session is interrupted:
1. Read the latest `status.json`
2. Resume from `current_phase`
3. Re-read any existing artifacts
4. Continue from where it left off

## Anti-Patterns

- **Never** skip the planning checkpoint — always get user approval
- **Never** proceed to review without running verification commands
- **Never** create a PR with empty or template-only description
- **Never** fabricate test results or verification outcomes
- **Never** merge without at least self-review of the full diff
