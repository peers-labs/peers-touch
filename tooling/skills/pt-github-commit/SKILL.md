---
name: pt-github-commit
description: >
  Use when the user asks to commit changes, create a commit, or when you need
  to generate a standardized commit message. Enforces Conventional Commits
  format with AI traceability for the Peers-Touch project.
stage: "DELIVER"
requires: ["code changes ready to commit"]
produces: ["conventional commit"]
next: "pt-github-pr"
---

# GitHub Commit — Standardized Commit Skill

Generate and execute standardized git commits following Conventional Commits
format with Peers-Touch project conventions and AI traceability.

## Commit Format

```
<type>(<scope>): <subject>

[body]

[footer]
```

## Rules

### Type (required)

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation only changes |
| `refactor` | Code restructuring (no feature/fix) |
| `test` | Adding or updating tests |
| `chore` | Maintenance, deps, tooling |
| `ci` | CI/CD configuration changes |
| `perf` | Performance improvement |
| `style` | Formatting, whitespace (no logic change) |
| `build` | Build system or external dependency changes |
| `revert` | Reverting a previous commit |

### Scope (recommended)

Derive scope from the changed files:

| Path pattern | Scope |
|-------------|-------|
| `apps/station/**` | `station` |
| `apps/desktop/src/**` | `desktop` |
| `apps/desktop/src-tauri/**` | `desktop` |
| `apps/mobile/android/**` | `android` |
| `apps/mobile/ios/**` | `ios` |
| `model/domain/**` | `proto` |
| `packages/applet-sdk/**` | `applet-sdk` |
| `packages/applets/**` | `applets` |
| `packages/locales/**` | `locales` |
| `tooling/**` | `tooling` |
| `.github/**` | `ci` |
| `apps/oauth2-client/**` | `oauth2` |

If changes span multiple scopes, use the primary scope or omit scope.

### Subject (required)

- English, lowercase start, no period at end
- Max 72 characters
- Imperative mood: "add feature" not "added feature"
- Focus on **why**, not **what**

### Body (optional)

- Explain motivation and context
- Wrap at 100 characters per line
- Use blank line to separate from subject

### Footer — AI Traceability (conditional)

When the commit includes AI-assisted code, add `Made-with` trailer:

```
Made-with: <Tool>/<Model>
```

Examples:
```
Made-with: Trae/Claude-4-Sonnet
Made-with: Cursor/GPT-4.1
```

### Footer — Breaking Changes

If the commit introduces a breaking change:

```
BREAKING CHANGE: <description>
```

### Footer — Issue References

```
Closes #123
Fixes #456
Refs #789
```

## Workflow

1. Run `git diff --cached --stat` to see staged changes
2. Run `git diff --cached` to understand the actual changes
3. Determine `type` from the nature of the change
4. Determine `scope` from the file paths changed
5. Write a concise `subject` describing the intent
6. Add `body` if the change needs explanation
7. Add `Made-with` footer (you are an AI agent)
8. Add issue references if applicable
9. Execute the commit using the HEREDOC format:

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <subject>

<body>

Made-with: <Tool>/<Model>
Closes #<issue>
EOF
)"
```

## Examples

### Feature commit
```
feat(desktop): add real-time notification bell component

Implement WebSocket-based notification system with unread
count badge and click-through to notification center.

Made-with: Trae/Claude-4-Sonnet
Closes #42
```

### Bug fix commit
```
fix(station): resolve auth token refresh race condition

Multiple concurrent requests could trigger parallel token
refreshes, causing 401 cascading failures. Use sync.Once
to ensure single refresh per expiry cycle.

Made-with: Trae/Claude-4-Sonnet
Fixes #87
```

### Proto change commit
```
feat(proto): add relay_config fields to core.proto

Add relay server configuration to PeersConfig for
federated relay node discovery.

Made-with: Trae/Claude-4-Sonnet
```

### Simple chore
```
chore(deps): bump tauri to 2.5.0
```

## Anti-Patterns

- **Never** commit without staged changes
- **Never** use `git add -A` or `git add .` blindly — stage specific files
- **Never** commit `.env`, credentials, or secret files
- **Never** commit generated files (`.pb.go`, `.pb.dart`, prost `.rs`)
- **Never** use vague subjects like "fix bug", "update code", "misc changes"
- **Never** skip the `Made-with` footer when AI-assisted
