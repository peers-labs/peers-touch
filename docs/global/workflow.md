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

## 3) Declare development resources

Read-only investigation may happen before declaration. Before the first
repository write or runtime acquisition for any non-trivial task:

```bash
make dev-start \
  WORK_ITEM=<stable-id> \
  PURPOSE='<purpose>' \
  SOURCE_CLAIMS='<shared-read|exclusive-write>:<repo-path>[;...]' \
  RUNTIME_CLAIMS='<shared|exclusive>:<kind>:<resource-id>[;...]'
```

Rules:

- The command atomically publishes intent to
  `~/.peers-touch/dev/work.json`, checks cross-worktree conflicts, and reads the
  declaration back.
- Run `make dev-check WORK_ITEM=<id>` before each mutation slice.
- Use `make dev-update` before growing source or runtime scope.
- Refresh the declared source HEAD with `make dev-update` after an authorized
  commit, rebase or merge.
- Use `make dev-status-all` to inspect all worktree declarations.
- A declaration is public intent, not a Profile/Station lease or operation
  authorization.
- Completion, cancellation and abandonment require
  `make dev-release WORK_ITEM=<id>`.

Architecture source:
`docs/architecture/development-workflow/README.md`.

---

## 4) Route Acceptance work by ownership

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

## 5) Use correct paths

- Desktop: `apps/desktop`
- Mobile Android: `apps/mobile/android`
- Mobile iOS: `apps/mobile/ios`
- Station App: `apps/station/app`
- Station Frame: `apps/station/frame`
- Domain Model: `model/domain`

---

## 6) Product-first implementation sequence

For every dependency-ready workstream:

1. Bind one product Journey or class-specific functional boundary.
2. Reproduce once and record the first actionable failure.
3. Define/adjust contracts (`model/domain` or Desktop Tauri contracts).
4. Implement the root correction at the owning layer.
5. Connect consumers and UI.
6. Run focused unit/type/contract checks.
7. Create an authorized checkpoint commit when exact-source runtime is needed.
8. Deploy/start through Local Dev Control Plane and Make.
9. Run the real Journey:
   - `FAIL` → return the first failure to implementation;
   - `BLOCKED` → park the environment or authorization edge;
   - `PASS` → record `FUNCTIONAL_PASS`.
10. Only after `FUNCTIONAL_PASS`, promote the same Journey into formal
    Acceptance and run final exact-source proof.

Before `FUNCTIONAL_PASS`, do not run coverage, Gap Detector, Completion Auditor,
cross-platform matrices, submit pipeline, or unrelated broad Gate bundles.

---

## 7) Verification commands

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

## 8) Verification classes

| Class | Meaning |
|---|---|
| `SOURCE_CHECK` | unit, typecheck, build, or focused contract check |
| `STRUCTURAL_CHECK` | source, registry, schema, or static relation |
| `UX_REVIEW` | prototype or screenshot contract |
| `FUNCTIONAL_CHECK` | exact-source real product Journey |
| `ACCEPTANCE_PROOF` | formal capability proof |

Only `FUNCTIONAL_CHECK` supports “this Journey works”. `PROVEN` is reserved for
formal Acceptance.

---

## 9) Completion criteria

Only mark task done when:
- Implementation is complete
- Relevant lint/check passes
- Build succeeds
- Tests pass
- Required exact-source Journeys have `FUNCTIONAL_CHECK`
- Required formal capabilities have `ACCEPTANCE_PROOF`
- Public resource declaration and runtime leases are released

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
