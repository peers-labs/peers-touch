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

### 3. Load Review System Context

Before judging code, run or inspect the same inputs the CI uses:

```bash
tooling/scripts/review/route-change.sh --range <base>...<head>
tooling/scripts/review/knowledge-match.sh --range <base>...<head>
tooling/scripts/review/hard-rules.sh --range <base>...<head>
```

If the PR changes this skill, `docs/global/code-review-framework.md`, `docs/knowledge/**`, or review scripts/fixtures, also run:

```bash
tooling/scripts/review/skill-check.sh
```

### 4. Review Checklist

Check against Peers-Touch project conventions (`AGENTS.md`):

#### Hard Rules (must flag violations)

| Rule | What to check |
|------|---------------|
| `debug-statement` | `console.log`, `println!`, `fmt.Println`, `print`, `debugPrint` |
| `secret-exposure` / No hardcoded secrets | Tokens, passwords, API keys, private keys in code |
| Proto-first | Manual data models instead of proto-generated |
| `mock-api` / No mock APIs | Mock data in frontend-backend APIs (unless explicitly noted) |
| `hardcoded-ui-string` | User-facing UI text must use locale keys and i18n |
| `silent-error` / No silent error swallowing | Empty catch blocks, ignored errors, `_ = err` |
| Error context | Error messages without operation name or key params |
| `generated-file-edit` | Changes to `.pb.go`, `.pb.dart`, prost `.rs` files |

#### Architectural Checks

| Check | Description |
|-------|-------------|
| DDD compliance (Station) | Subserver code follows aggregate root / domain service / domain event |
| Proto source of truth | New data models defined in `model/domain/*.proto` first |
| Logging | Uses domain-specific loggers, not raw print |
| Error codes | Typed error codes in correct range (10000s/20000s/30000s) |
| Inter-app protocol | Protobuf only, no JSON between apps |

#### Review Profiles

Use the profile list emitted by `route-change.sh`. If running manually, apply this mapping:

| Profile | Focus |
|---|---|
| `proto` | `model/domain/*.proto` remains the source of truth; generated files are regenerated, not hand edited |
| `station` | Station owns shared business truth; `app` depends on `frame`; subservers follow DDD and typed errors |
| `desktop` | Desktop follows Tauri command path, Page / Runtime / Boot contracts, runtime projection freshness, logger and i18n rules |
| `mobile` | Mobile remains Tauri v2 Mobile + Web UI + Rust kernel + native plugins; native plugins do not define business truth |
| `packages` | Shared packages do not introduce hidden platform ownership or incompatible public APIs |
| `knowledge` | `docs/knowledge` frontmatter, `owns:`, lifecycle, and recurrence checks are valid |
| `skill` | Review Skill has current freshness hash, golden fixtures, and self-growth evidence |
| `ci` | CI still enforces framework gates and does not bypass hard rules |

#### Operational Knowledge

For every changed path, load matched entries from `docs/knowledge/` using:

```bash
tooling/scripts/review/knowledge-match.sh --range <base>...<head>
```

Treat matched invariants as blocking review rules. Treat matched pitfalls as regressions to actively rule out. Treat matched playbooks as required procedure for that task class.

## Script vs Skill Boundary

Scripts are gates, not reviewers. They provide deterministic evidence:

- `route-change.sh` identifies which review profiles apply.
- `hard-rules.sh` catches simple blocking patterns.
- `knowledge-match.sh` finds operational knowledge that must be read.
- `skill-check.sh` proves this skill is structurally fresh and backed by fixtures.

This skill owns the judgment that scripts cannot make:

- whether a change violates architecture ownership even when syntax passes;
- whether a runtime projection is complete or only refreshed by a page mount;
- whether a Station subserver leaked business rules into `frame`;
- whether proto changes preserve cross-end compatibility;
- whether tests actually cover the changed behavior;
- whether a new review finding should become a fixture, pitfall, invariant, or playbook.

When script output and code-reading disagree, trust the deeper code-reading result and explain the discrepancy in the review.

## Platform Review Playbooks

### Proto Review

Use for `model/domain/**` and generated contract consumers.

Check:

- New shared concepts are added to `model/domain/*.proto`, not hand-written TS/Go/Rust/Kotlin/Swift models.
- Field numbers are stable; removed fields are reserved or intentionally retained for compatibility.
- Request/response messages carry enough context for typed error handling.
- Generated files are not manually edited.
- Station, Desktop, and Mobile contract consumers are updated together or the PR explains staged rollout safety.
- Required generation commands are listed in the PR test plan.

Blocking examples:

- a client-only DTO duplicates a shared business object;
- a generated `.pb.go` file changes without a corresponding `.proto` change;
- a proto field is renumbered or reused.

### Station Review

Use for `apps/station/**`.

Check:

- Shared business truth stays in Station, not in Desktop or Mobile clients.
- `apps/station/app` may depend on `apps/station/frame`; `frame` must not depend on `app`.
- Business capability code is organized as a subserver with handler, application service, domain behavior, and persistence boundaries.
- Domain decisions are not made in transport middleware or shared frame infrastructure.
- Errors use typed codes and include operation context without logging PII or secrets.
- Persistence changes have migration or compatibility reasoning.
- Concurrency paths do not block relay read loops, event streams, or heartbeat processing.

Blocking examples:

- importing an app-layer package from frame code;
- swallowing repository or handler errors;
- logging tokens, passwords, actor-private data, or raw credentials;
- adding business policy to frame middleware.

### Desktop Review

Use for `apps/desktop/**`.

Check:

- `desktop-web -> desktop-rust -> station` remains the default business path.
- Business calls go through `services/desktop_api.ts` and Tauri command contracts unless the PR documents a streaming or multipart exception.
- New Tauri commands are registered in Rust and have aligned TS input/output types.
- Pages are pure renderers over runtime/store state and do not own long-lived business freshness.
- Runtime-backed features have both immediate event consumption and periodic reconciliation.
- User-facing strings use locale keys.
- Logging uses the Desktop logger, not raw console output.
- UI changes preserve LobeUI-first direction unless the PR justifies an alternative.

Blocking examples:

- fixing stale chat/contact/notification state only with `useEffect(...load...)` in a component;
- direct `fetch` for a Station business API without documented exception;
- adding a page only to the legacy router without an explicit reason;
- hardcoded UI text in React components.

### Mobile Review

Use for `apps/mobile/**`.

Check:

- Mobile remains Tauri v2 Mobile + Web UI + Rust capability kernel + native plugins.
- Android Kotlin / iOS Swift code provides device capability integration, not independent business truth.
- Flutter/Dart paths remain deprecated and are not expanded.
- Mobile runtime projections follow the same source-of-truth rule as Desktop where applicable.
- Station/Relay APIs remain the source for cross-end business state.
- Native plugin boundaries do not create private protocols that bypass proto or Station ownership.
- Web UI changes are mobile-first rather than Desktop screens scaled down blindly.

Blocking examples:

- storing shared business truth only in a native plugin;
- adding new Flutter implementation paths;
- defining mobile-only business DTOs for shared concepts;
- bypassing Station truth with private native sync logic.

### Package And Locale Review

Use for `packages/**`.

Check:

- Shared packages do not pull in Desktop-only or Mobile-only runtime dependencies unless the package explicitly owns that platform.
- Public APIs preserve workspace consumers or include migration notes.
- `packages/locales/**` changes line up with new UI keys and do not leave raw fallback strings in components.
- Applet SDK and applet contract changes preserve host/app boundaries.

Blocking examples:

- adding `@tauri-apps/api` to a package intended for shared web use;
- changing exported storage semantics without updating Desktop/Mobile consumers;
- adding UI strings without locale coverage.

### Knowledge Review

Use for `docs/knowledge/**` and for PRs that fix bugs or discover invariants.

Check:

- Frontmatter includes `kind`, `title`, `status`, `owns`, and `detected`.
- Active `owns:` entries point to existing files or valid directory prefixes.
- Invariants state what must hold and include `How to verify`.
- Pitfalls include symptom, root cause, mitigation, and recurrence detection.
- Playbooks include a concrete procedure.
- Superseded knowledge is marked with `status: superseded-by:<path>` and not deleted.

Blocking examples:

- adding a pitfall without recurrence detection;
- deleting old knowledge instead of superseding it;
- using knowledge files as a generic wiki with no path ownership.

### Review-System Review

Use for `tooling/scripts/review/**`, `tooling/review-fixtures/**`, `tooling/skills/github-review/**`, `.github/**`, and this framework.

Check:

- Deterministic gates remain portable to macOS local runs and Ubuntu CI.
- New hard rules include at least one fixture.
- Fixtures are intentionally excluded from normal source hard-rule scans but are scanned by `skill-check.sh`.
- Review Skill changes update `FRESHNESS.md` only after checking whether upstream rule behavior changed.
- CODEOWNERS protects skill, knowledge, review scripts, fixtures, architecture docs, and CI.
- CI produces actionable review summaries, not only pass/fail output.

Blocking examples:

- adding a new hard-rule grep without a fixture;
- making `skill-check.sh` pass while bypassing fixture detection;
- letting the Review Skill silently self-modify without owner review.

#### Quality Checks

| Check | Description |
|-------|-------------|
| Logic correctness | Edge cases, off-by-one, null/nil handling |
| Concurrency | Race conditions, deadlocks, missing locks |
| Performance | N+1 queries, unnecessary allocations, missing indexes |
| Security | SQL injection, XSS, auth bypass, IDOR |
| Test coverage | Critical paths have test coverage |

### 5. Submit Review

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

### 6. Severity Levels

Use these prefixes in review comments:

| Prefix | Meaning | Blocks merge? |
|--------|---------|---------------|
| `[critical]` | Security vulnerability, data loss risk, crash | Yes |
| `[bug]` | Logic error that causes incorrect behavior | Yes |
| `[convention]` | Violates AGENTS.md iron laws | Yes |
| `[suggestion]` | Improvement idea, not blocking | No |
| `[question]` | Need clarification on intent | No |
| `[nit]` | Minor style preference (use sparingly) | No |

## Skill Freshness

This skill is fresh only if all of the following pass:

```bash
tooling/scripts/review/skill-check.sh
```

The freshness proof is composed of:

- required section markers in this `SKILL.md`;
- upstream rule hash in `tooling/skills/github-review/FRESHNESS.md`;
- golden fixtures under `tooling/review-fixtures/`;
- explicit references to hard rules, review profiles, operational knowledge, CODEOWNERS, generated-file handling, runtime projection checks, and self-growth.

If an upstream rule file changes and the freshness hash changes, the PR must either update this skill or explain why the rule change does not affect review behavior, then refresh the hash in the same PR.

## Self-Growth

The Review Skill can propose growth but must not silently rewrite itself. Use this loop:

1. Classify accepted findings and escaped defects as one-off, invariant, pitfall, playbook, or skill-rule gap.
2. Add or update a golden fixture when the issue should be caught again.
3. Update `docs/knowledge/**` when the issue is operational knowledge.
4. Update this `SKILL.md` when the issue changes review behavior.
5. Run `tooling/scripts/review/skill-check.sh`.
6. Require human owner review through CODEOWNERS before merge.

Growth triggers:

- one escaped `critical` or `bug` finding requires a fixture;
- the same issue class appearing twice should become a pitfall or invariant;
- a repeated task procedure should become a playbook;
- three false positives should narrow the rule and add a fixture for the allowed shape.

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
