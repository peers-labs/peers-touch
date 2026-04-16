---
name: github-review
description: >
  Use when the user asks to review a pull request, provide code review feedback,
  or when you need to analyze PR changes and submit structured review comments
  on GitHub for the Peers-Touch project.
---

# GitHub Review — Code Review Skill

Perform structured code reviews on GitHub Pull Requests using `gh` CLI,
following Peers-Touch project conventions.

## Review Philosophy

1. **Focus on substance** — logic errors, security issues, architectural violations, performance
2. **Skip trivia** — do not comment on formatting, naming style, or obvious patterns
3. **Be constructive** — suggest fixes, not just point out problems
4. **Respect context** — understand the PR's intent before reviewing

## Review Workflow

### 1. Fetch PR Information

```bash
# View PR metadata
gh pr view <pr-number>

# View the diff
gh pr diff <pr-number>

# Check CI status
gh pr checks <pr-number>

# List changed files
gh pr diff <pr-number> --name-only
```

### 2. Understand Context

Before reviewing code:
- Read the PR description (Summary + Motivation)
- Check related issues
- Understand the scope (which platform/module)
- Review the test plan

### 3. Review Checklist

Check against Peers-Touch project conventions (`AGENTS.md`):

#### Hard Rules (must flag violations)

| Rule | What to check |
|------|---------------|
| No debug statements | `console.log`, `println!`, `fmt.Println`, `print`, `debugPrint` |
| No hardcoded secrets | Tokens, passwords, API keys, private keys in code |
| Proto-first | Manual data models instead of proto-generated |
| No mock APIs | Mock data in frontend-backend APIs (unless explicitly noted) |
| No silent error swallowing | Empty catch blocks, ignored errors, `_ = err` |
| Error context | Error messages without operation name or key params |
| Generated file edits | Changes to `.pb.go`, `.pb.dart`, prost `.rs` files |

#### Architectural Checks

| Check | Description |
|-------|-------------|
| DDD compliance (Station) | Subserver code follows aggregate root / domain service / domain event |
| Proto source of truth | New data models defined in `model/domain/*.proto` first |
| Logging | Uses domain-specific loggers, not raw print |
| Error codes | Typed error codes in correct range (10000s/20000s/30000s) |
| Inter-app protocol | Protobuf only, no JSON between apps |

#### Quality Checks

| Check | Description |
|-------|-------------|
| Logic correctness | Edge cases, off-by-one, null/nil handling |
| Concurrency | Race conditions, deadlocks, missing locks |
| Performance | N+1 queries, unnecessary allocations, missing indexes |
| Security | SQL injection, XSS, auth bypass, IDOR |
| Test coverage | Critical paths have test coverage |

### 4. Submit Review

#### Approve (no issues found)

```bash
gh pr review <pr-number> --approve --body "LGTM. Changes look correct and follow project conventions."
```

#### Request Changes (blocking issues)

```bash
gh pr review <pr-number> --request-changes --body "$(cat <<'EOF'
## Review Summary / 审查总结

<EN: Overall assessment>
<CN: 整体评估>

## Issues Found / 发现的问题

### 1. [severity] <title>

**File**: `<file-path>#L<line>`
**Issue**: <EN description>
**问题**: <CN description>
**Suggestion**: <proposed fix>

### 2. ...

EOF
)"
```

#### Comment (non-blocking feedback)

```bash
gh pr review <pr-number> --comment --body "$(cat <<'EOF'
## Review Feedback / 审查反馈

<EN + CN bilingual feedback>

EOF
)"
```

#### Inline Comments

For specific line-level feedback, use the GitHub web UI or:

```bash
# Add a single-line comment
gh api repos/{owner}/{repo}/pulls/<pr-number>/comments \
  -f body="<comment>" \
  -f commit_id="<commit-sha>" \
  -f path="<file-path>" \
  -F line=<line-number> \
  -f side="RIGHT"
```

### 5. Severity Levels

Use these prefixes in review comments:

| Prefix | Meaning | Blocks merge? |
|--------|---------|---------------|
| `[critical]` | Security vulnerability, data loss risk, crash | Yes |
| `[bug]` | Logic error that causes incorrect behavior | Yes |
| `[convention]` | Violates AGENTS.md iron laws | Yes |
| `[suggestion]` | Improvement idea, not blocking | No |
| `[question]` | Need clarification on intent | No |
| `[nit]` | Minor style preference (use sparingly) | No |

## Review Output Format

Use bilingual format for all review comments:

```markdown
## Review Summary / 审查总结

EN: <assessment>
CN: <评估>

### Issues / 问题

1. **[severity] <title>**
   - File: `path/to/file.ts#L42`
   - EN: <description>
   - CN: <描述>
   - Fix: <suggestion>

### Positive Notes / 亮点 (optional, only if genuinely noteworthy)

- <notable positive aspect>
```

## Anti-Patterns

- **Never** approve a PR you haven't fully read
- **Never** comment on every file just to show thoroughness
- **Never** block a PR for style preferences — only for real issues
- **Never** review your own PR as the sole reviewer
- **Never** provide feedback without actionable suggestions
- **Never** use harsh or judgmental language
