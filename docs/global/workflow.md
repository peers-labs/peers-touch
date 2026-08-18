# Development Workflow

> How to execute tasks in the current `apps/*` architecture.

---

## 1) Read before coding

1. [project-identity.md](./project-identity.md)
2. [architecture.md](./architecture.md)
3. [domain-model.md](./domain-model.md)
4. [docs/README.md](../README.md)

Then select platform docs:
- Desktop: `docs/client/desktop/`
- Mobile: `docs/client/mobile/`
- Station: `docs/station/`

---

## 2) Bind the active worktree

When the user starts by saying which worktree to use, that worktree becomes the
task's active worktree.

Default rule:
- All edits, generated files, staging, commits, and PR operations must stay
  inside the active worktree.
- Other worktrees are read-only unless the user explicitly grants write scope
  for another path.
- IDE-open files, search results, shell defaults, and previous conversation
  context do not override the active worktree.
- Before editing or staging, verify `pwd` and `git rev-parse --show-toplevel`
  point to the active worktree.
- If a required change appears to belong in another worktree, stop and ask
  before writing.

Cross-worktree comparison is allowed for investigation, conflict analysis, and
PR review, but write scope remains bound to the active worktree.

---

## 3) Route Acceptance work by ownership

Before changing Acceptance code, classify responsibility:

| Work | Required Skill | Ownership |
|---|---|---|
| Core contracts, planner, validator, runner, reporter, Evidence Store, generic lifecycle, registration mechanism, framework self-tests | `pt-acceptance-infra-engineering` | Acceptance Infra |
| Domain, Feature, Capability, Registry rule, concrete Gate, Environment, Provisioner, Fixture, actor/client role, credential reference, product evidence | `pt-acceptance-engineering` | Business module injection |

Rules:

- Infra defines how business modules inject; business modules provide the
  injected content.
- A path under `tooling/acceptance/` is not automatically Infra-owned.
- Missing business injection blocks only its Domain and is reported as
  `BUSINESS_INJECTION_REQUIRED`.
- Business Gate `FAILED`, `BLOCKED`, or `UNPROVEN` does not block Acceptance
  Infra completion.
- Mixed requests are split into separate work items and ownership contexts.
- Infra Agents must not add placeholders, mocks, default identities, concrete
  actor roles, or weakened product assertions to make framework checks pass.

Architecture source:
`docs/architecture/acceptance-framework/decisions.md` D-12.

---

## 4) Use correct paths

- Desktop: `apps/desktop`
- Mobile Android: `apps/mobile/android`
- Mobile iOS: `apps/mobile/ios`
- Station App: `apps/station/app`
- Station Frame: `apps/station/frame`
- Domain Model: `model/domain`

---

## 5) Implementation sequence

1. Define/adjust contracts (`model/domain` or desktop tauri contracts)
2. Implement backend/station or tauri command layer
3. Connect frontend/store and pages
4. Add/adjust tests
5. Run verification commands

---

## 6) Verification commands

### Desktop

```bash
cd apps/desktop
pnpm run check
pnpm run test
pnpm run build
```

App-only check:

```bash
cd apps/desktop
source ~/.cargo/env
CI=false pnpm run tauri:build
```

### Mobile

```bash
cd apps/mobile/android && ./gradlew build
cd apps/mobile/ios && xcodebuild -scheme PeersTouch -configuration Debug build
```

### Station

```bash
cd apps/station
gofmt -l .
go test ./...
```

---

## 7) Completion criteria

Only mark task done when:
- Implementation is complete
- Relevant lint/check passes
- Build succeeds
- Tests pass
- Functional path is verified

Suggested report format:

```markdown
✅ Task Completed

## Implementation
- ...

## Verification
- ✅ check/lint
- ✅ build
- ✅ tests
- ✅ functional validation

## Files
- [file](file:///absolute/path)
```
