---
name: pt-github-release
description: >
  Use when the user asks to create a release, generate a changelog, bump version,
  or tag a new version. Handles semantic versioning, changelog generation from
  conventional commits, and GitHub Release creation for the Peers-Touch project.
---

# GitHub Release — Version & Changelog Skill

Manage releases with semantic versioning, auto-generated changelogs from
Conventional Commits, and GitHub Releases using `gh` CLI.

## Semantic Versioning

Format: `v<MAJOR>.<MINOR>.<PATCH>`

| Commit type | Version bump |
|-------------|-------------|
| `feat` | MINOR (0.x.0) |
| `fix`, `perf` | PATCH (0.0.x) |
| `BREAKING CHANGE` in footer | MAJOR (x.0.0) |
| `docs`, `test`, `chore`, `ci`, `style`, `refactor`, `build` | No bump (include in changelog only) |

## Release Workflow

### 0. Run Explicit Full Acceptance

A release request is explicit authorization for the current formal plan's full
Acceptance matrix. Before versioning or tagging:

```bash
python3 tooling/scripts/execution-plan.py \
  --plan <completed-execution-plan> \
  --require-complete
python3 tooling/scripts/acceptance-run.py \
  --execution-plan <completed-execution-plan> \
  --full
```

Do not infer release intent from a completed plan, merged PR, available runtime
environment, or version-like commit. A failed, blocked, or unproven full
Acceptance run stops release creation.

### 1. Determine Version Bump

```bash
# Get the latest tag
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
echo "Latest tag: $LATEST_TAG"

# List commits since last tag
git log "${LATEST_TAG}..HEAD" --oneline
```

Analyze commit types to determine bump level:
- Any `BREAKING CHANGE` footer → MAJOR
- Any `feat` → at least MINOR
- Only `fix`/`perf` → PATCH
- Only `docs`/`test`/`chore`/`ci`/`style`/`refactor`/`build` → PATCH (or skip release)

### 2. Generate Changelog

Group commits by type, using bilingual section headers:

```markdown
# Changelog

## [v<VERSION>] - <YYYY-MM-DD>

### New Features / 新功能
- <scope>: <subject> (#<PR>)

### Bug Fixes / 缺陷修复
- <scope>: <subject> (#<PR>)

### Performance / 性能优化
- <scope>: <subject> (#<PR>)

### Refactoring / 重构
- <scope>: <subject> (#<PR>)

### Documentation / 文档
- <scope>: <subject> (#<PR>)

### CI/CD
- <scope>: <subject> (#<PR>)

### Other Changes / 其它变更
- <scope>: <subject> (#<PR>)

### Breaking Changes / 破坏性变更
- <description>
```

Generate from git log:

```bash
# Commits grouped for changelog
git log "${LATEST_TAG}..HEAD" --pretty=format:"%s (%h)" --reverse
```

Parse each commit's `<type>(<scope>): <subject>` and group accordingly.

### 3. Create Git Tag

```bash
NEW_VERSION="v<MAJOR>.<MINOR>.<PATCH>"
git tag -a "$NEW_VERSION" -m "Release $NEW_VERSION"
git push origin "$NEW_VERSION"
```

### 4. Create GitHub Release

```bash
gh release create "$NEW_VERSION" \
  --title "$NEW_VERSION" \
  --notes "$(cat <<'EOF'
<generated changelog for this version>
EOF
)" \
  --latest
```

For pre-releases:

```bash
gh release create "$NEW_VERSION" \
  --title "$NEW_VERSION" \
  --notes "<changelog>" \
  --prerelease
```

### 5. Verify Release

```bash
gh release view "$NEW_VERSION"
```

## Platform-Specific Release Notes

When a release affects specific platforms, add platform sections:

```markdown
### Station
- <station-specific changes>

### Desktop
- <desktop-specific changes>

### Mobile
- <mobile-specific changes>
```

## Hotfix Release

For urgent fixes on a released version:

```bash
# Create hotfix branch from the tag
git checkout -b hotfix/<description> <tag>

# Apply fix, commit, push
# ...

# Create PR to main AND tag the hotfix
git tag -a "v<X>.<Y>.<Z+1>" -m "Hotfix: <description>"
git push origin "v<X>.<Y>.<Z+1>"

gh release create "v<X>.<Y>.<Z+1>" \
  --title "v<X>.<Y>.<Z+1> (Hotfix)" \
  --notes "<hotfix description>"
```

## Anti-Patterns

- **Never** create a release without a tag
- **Never** delete or move an existing release tag
- **Never** release without reviewing the changelog
- **Never** release without explicit user intent and a passed full Acceptance run
- **Never** skip version numbers (go sequentially)
- **Never** release directly from a feature branch — only from `main`
