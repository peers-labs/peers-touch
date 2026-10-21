# Peers-Touch Agent Guide

> Canonical behavior and safety adapter for coding agents.
> Humans and agents share the same development knowledge under
> [`docs/development/`](docs/development/README.md).

## 1. Start From Shared Knowledge

Read:

1. [Develop Peers-Touch](docs/development/README.md)
2. the relevant [platform guide](docs/development/platforms/README.md)
3. the owning product, architecture, platform, and coding sources
4. every active `docs/knowledge/` entry whose `owns:` covers the edit

This file does not redefine platform architecture, coding guides, command
usage, or verification matrices.

## 2. Select The Exact Worktree

- A Skill source path never selects the execution worktree.
- Every mutation uses the user-selected canonical root as explicit `workdir`.
- File edits use absolute paths under that root.
- Do not read or write a sibling worktree unless it is explicitly in scope.
- Do not create, switch, remove, or prune a worktree unless the user explicitly
  requested that exact operation.
- Preserve unrelated dirty files. Never reset, clean, or overwrite them.

Resume from the explicit request, current Git/runtime facts, one explicit
optional task ID or Plan path, and current evidence.
Never infer a task from branch, mtime, chat, or memory.

## 3. Route Work By Ownership

- Non-trivial implementation: `pt-dev-workflow`.
- Small behavioral fix: `pt-dev-workflow` → `pt-small-fix-discipline`.
- Product Journey or visible state: `pt-product-design-methodology`.
- Architecture boundary or ownership: `pt-architecture-design-methodology`.
- Accepted architecture needing execution structure:
  `pt-architecture-execution-methodology`.
- Formal Plan persistence: `pt-plan-and-document`.
- Runtime verification: `pt-dev-runtime-handoff`.
- Review: `pt-github-review` plus applicable specialist reviews.

`pt-god-view` is a thin router, not an executor.

Ordinary work requires no declaration, OWNER, PlanMount, Session, active-work,
or close receipt. Complex work may use an explicitly selected task record
under `.dev-workflow/tasks/<taskId>/`; it never grants write, runtime,
evidence, or delivery authority.

### Acceptance ownership dispatch

- Acceptance Core, runner, Evidence Store, schema, lifecycle, or framework:
  `pt-acceptance-infra-engineering`.
- Business Feature, Capability, Journey, Fixture, Gate, or product proof:
  `pt-acceptance-engineering`.
- Multi-scenario runtime reuse audit: `pt-acceptance-pipeline-auditor`.

Acceptance Infra ownership first. Infra reports missing business injection as
`BUSINESS_INJECTION_REQUIRED`; it never manufactures product PASS.

## 4. Development Contract

Follow [Development Workflow](docs/development/workflow.md).

Agent automation does not shorten or replace that procedure. Continue across
internal review and evidence refresh while authorized ready work remains. Park
only the blocked action; continue from the ready frontier.

Push, PR, merge, release, history rewrite, destructive cleanup, stable mutation,
and worktree lifecycle remain separately governed operations.

### No Invented Development Workflow Versions

The internal workflow has no synthetic `v1/v2/v3` release. Plans and optional
task records use their current repository contracts; do not turn format
details into a project workflow version.

## 5. Repository Invariants

### Proto first

- Shared cross-platform models start in `model/domain/`.
- Do not hand-write parallel shared domain models.
- Do not edit generated protobuf output.
- Use `./model/build.sh` and the active platform generation path.

### Station starts through Profile

- Select or create a Profile through the canonical development commands.
- Start Station only with `make station` or the native `devctl` adapter.
- Do not run Station with direct `go run`, manual binaries, or ad hoc Compose.
- Profile IDs ending in `stable`, case-insensitively, are protected from
  autonomous reset.

### Desktop uses the native runtime

- Normal development and debugging starts with `make desktop`.
- There is no supported browser-only Desktop product shell.
- Packaged builds are for package or release claims, not routine debugging.
- Pages render projections; runtimes own long-lived state and reconciliation.

### Security and truth

- Never hardcode or log secrets, credentials, tokens, private keys, or PII.
- Never fabricate, relabel, or selectively hide evidence, findings, approvals,
  or test results.
- Never use direct database writes as a product or recovery path.
- User-facing text uses the project i18n system.
- No mock frontend/backend API path unless the user explicitly authorizes the
  changed proof boundary.

### Source hygiene

- Temporary logs, screenshots, traces, DOM dumps, and reports stay outside the
  repository.
- Do not edit generated files or build output.
- Use project logging; no `console.log`, `fmt.Println`, `println!`, `print`, or
  equivalent production debug statements.
- Errors remain typed, contextual, and visible; do not swallow failures.

## 6. Structure And Readability

Use `pt-code-structure-review` for authored source.

- One clear responsibility per file, function, class, and module.
- Dependencies follow architecture direction and remain acyclic.
- Names reveal intent; comments explain why.
- Avoid compatibility shims, dead code, duplicate owners, and half-migrations.
- Keep error paths as deliberate as happy paths.
- Update a directory README when its public structure or contract changes.
- Readability and structural decay are review concerns, not cosmetic
  preferences.

Desktop UI uses the project UI Identity and component stack. Official applet
work under `apps/applets` uses `pt-official-applet-development` and the applet
architecture contract.

## 7. Verification

Follow [Verification](docs/development/verification.md) and the relevant
platform guide.

Select exactly one mode per pass: `DEVELOPMENT_ITERATION`, `CLOSURE`,
`COMPLETION`, or `FULL_RELEASE`.

Development does not auto-escalate to formal Acceptance. Full/release requires
an explicit current request. Unrun Gates remain `UNPROVEN`; impact discovery,
available environments, and Gap output do not trigger automatic backfill.

Current-source evidence must bind the current commit/workspace and actual
runtime. Source changes invalidate affected proof. Framework self-tests do not
prove business behavior.

## 8. Agent Skills

The only project-owned Skill source is:

```text
tooling/skills/<skill-name>/SKILL.md
```

Do not create project Skills under `.trae/`, `.cursor/`, `.agents/`, or another
host-private directory. Install projections with:

```bash
make skills IDE=<trae|cursor|codex>
```

Optional Hooks provide context only. Missing identity, unsupported events, or
Hook failure cannot block ordinary work or change operation permission.

The project is host-neutral: TRAE, Cursor, Codex, and future hosts provide
transport. Repository commands, runtime guards, and evidence contracts define
behavior.

## 9. Delivery

Follow the delivery step in [Development Workflow](docs/development/workflow.md).
Report implemented, proven, unverified, and blocked scope separately, and
release only resources owned by the request.

A local commit is a checkpoint, not proof or publication. Do not push, open a
PR, merge, release, or rewrite history without the corresponding instruction.
