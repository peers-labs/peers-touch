# AGENTS.md — Peers-Touch AI Agent Behavioral Guide

> Single authoritative source for all AI coding agents.
> `docs/.agent/<platform>.md` is the agent entry layer: use it to find the real source documents, hard constraints, and verification commands.
>
> Last updated: 2026-08-18

---

## 1. Project Identity

**Peers-Touch** — decentralized, federated social network framework.
Three-tier architecture: **Client → Model → Station**.

| App | Path | Stack |
|-----|------|-------|
| **Station** | `apps/station/` | Go, DDD subservers, Hertz, PostgreSQL |
| **Desktop** | `apps/desktop/` | Tauri + React/TS + Rust |
| **Mobile** | `apps/mobile/` | Tauri v2 Mobile + Web UI + Rust + native plugins |

---

## 2. Repository Layout

```
peers-touch/
├── apps/
│   ├── desktop/           # Tauri + React/TS + Rust
│   ├── mobile/
│   │   ├── src/           # mobile-web UI
│   │   ├── src-tauri/     # mobile-rust capability kernel
│   │   ├── src-tauri/gen/ # Tauri generated Android/iOS projects
│   │   ├── android/       # legacy/native plugin source during migration
│   │   ├── ios/           # legacy/native plugin source during migration
│   ├── station/
│   │   ├── app/           # Business logic + subservers (DDD)
│   │   └── frame/         # Core framework
│   └── oauth2-client/
├── model/domain/          # Proto definitions (single source of truth)
├── packages/              # applet-sdk, applets, locales
├── tooling/
│   ├── scripts/           # Build & dev scripts
│   └── skills/            # Canonical agent skills (see §13). Single source of truth;
│                          # IDE-private dirs (.cursor/, .trae/, ...) MUST NOT hold
│                          # project skills — agents sync from here at startup.
└── docs/
    ├── README.md          # Docs entry: how to find the right source documents
    ├── .agent/            # Agent entry docs: navigation, hard constraints, verification
    ├── .ide/              # IDE scoped rules, documents, specs
    ├── architecture/      # Architecture-layer sources of truth
    ├── client/            # Platform-layer sources for client apps
    ├── station/           # Platform-layer sources for Station
    └── global/            # Cross-platform standards and coding guides
```

---

## 3. Documentation Source Hierarchy

When reading or updating docs, follow the constraint direction below:

1. **Architecture-layer source**
   - Defines allowed system relationships, boundaries, ownership, and source-of-truth decisions.
   - Examples: `docs/architecture/`, `docs/global/architecture.md`
2. **Platform-layer source**
   - Defines how a specific platform implements those architecture decisions.
   - Examples: `docs/client/desktop/`, `docs/client/mobile/`, `docs/station/`
3. **Specification-layer source**
   - Defines coding conventions, API usage, logging, testing, and implementation rules.
   - Examples: `docs/global/coding-guide/`
4. **Agent entry layer**
   - `docs/.agent/*.md` only tells agents what to read first, what is forbidden, and how to verify.
   - It is **not** the place to redefine architecture or full coding standards.
5. **Operational knowledge layer** (NEW)
   - `docs/knowledge/` holds horizontal, machine-readable knowledge that doesn't fit the four layers above:
     - `invariants/` — properties that any code touching the named paths MUST respect.
     - `pitfalls/` — bugs we already paid for, with reproduction + mitigation.
     - `playbooks/` — the standard operating procedure for recurring task classes.
     - `glossary.md` — project-specific terminology.
   - Each `invariants/` / `pitfalls/` / `playbooks/` file carries YAML frontmatter with an `owns:` list of repo paths it governs.
   - Agents MUST consult this layer before editing any path that appears in an `owns:` entry. The `pt-read-before-edit` skill (§13) automates the lookup; AGENTS that do not load the skill must perform the same procedure manually.
   - Knowledge files are PR'd through the same review process as code. Entries are append-only — superseded knowledge is marked `status: superseded-by:<path>`, never deleted.
   - Entry doc: [`docs/knowledge/README.md`](docs/knowledge/README.md). Frontmatter template: [`docs/knowledge/_TEMPLATE.md`](docs/knowledge/_TEMPLATE.md).

Constraint rule:

- Upper layers constrain lower layers.
- Lower layers may refine implementation detail, but may not redefine upper-layer boundaries.
- If two docs appear to conflict, prefer the higher layer unless the user explicitly chooses a new source of truth.

Primary docs entry:

- Start from `docs/README.md` when you need to locate the right source document.

### Large Requirement Documentation Protocol

For any module-level or architecture-level demand, `.trae/documents/` is not sufficient. Agents MUST create or update formal project documentation under `docs/` before or alongside implementation.

This protocol applies when a request includes any of the following:

- New product capability set or major feature rebuild.
- Cross-layer work touching more than one of Desktop Web, Desktop Rust, Station, Model, packages, or applets.
- Architecture landing, migration, domain decomposition, runtime ownership, persistence, public API, protocol, or directory boundary changes.
- Large UI / UX redesign that changes product workflow or module ownership.
- Benchmark-driven rebuilds from an external project, such as LobeHub-style Agent capability mapping.

Required behavior:

1. Locate the formal docs home from `docs/README.md`.
2. Write the durable design in the correct `docs/` layer:
   - Architecture boundary / cross-layer capability → `docs/architecture/<domain>/`
   - Desktop-only implementation plan → `docs/client/desktop/`
   - Station-only implementation plan → `docs/station/`
   - Coding convention → `docs/global/coding-guide/`
   - Historical research only → `docs/context/`
3. Add an execution plan under the nearest `execution-plans/` directory when delivery spans multiple phases.
4. Update the nearest `README.md` so the new document is discoverable.
5. Keep `.trae/documents/` only as scratch/spec workspace material; if it contains useful decisions, promote them into `docs/`.
6. Before implementation, report the formal docs paths to the user.

Example:

- Agent LobeHub-style rebuild formal design: `docs/architecture/agent/agent-lobehub-blueprint.md`
- Its execution plan: `docs/architecture/agent/execution-plans/20260616-agent-lobehub-rebuild.md`

---

## 4. Thinking Principles

1. **Rationality over minimalism** — Architectural soundness is the goal, not minimum change.
2. **Run scripts first** — Prefer `tooling/scripts/` (`dev-desktop-app.sh`, `dev-desktop-web.sh`, `pt.sh`, etc.).
3. **Architecture design methodology** — For architecture design / system boundaries / ownership / contracts / topology / design decisions, **MUST** use `pt-architecture-design-methodology` skill before execution planning.
4. **Architecture execution methodology** — For architecture landing / migration / domain decomposition, **MUST** use `pt-architecture-execution-methodology` skill: `Domain Responsibility → Execution Closure → Dependency Order → Verifiable Delivery`.
5. **Runtime projection first** — For Desktop bugs involving chat, contacts, notifications, badges, realtime, or store freshness, first identify the owning runtime and its projection contract. Do not patch stale state only with page/component refreshes; read `docs/client/desktop/runtime-projections.md`.
6. **Page / Runtime / Boot contracts** — When adding or refactoring a Desktop page, projection owner, or startup step, conform to the Page / Runtime / Boot kernel contracts in `docs/client/desktop/runtime-projections.md §6`. Pages are pure renderers (no mount-time fetches); long-lived projections live in `RuntimeDescriptor`s; one-shot section data uses `kernel/usePrefetch`; startup is observable through `kernel/boot.ts` phases.
7. **Desktop debug uses Make** — During investigation, lifecycle debugging, browser/app E2E, applet runtime debugging, or acceptance triage, start Desktop through `make desktop` (or `make desktop-web` only when the task explicitly needs the browser shell). Do **not** switch to hard packaged `.app` / `tauri build` / release bundle flows unless the user explicitly asks for packaging, release validation, installer validation, or a package-only acceptance gate. See `docs/knowledge/playbooks/desktop-debug-runtime.md`.
8. **UI Identity first** — For any UI/UX design, visual refactor, screenshot review, layout issue, button/style issue, or client UI code change, first read `docs/client/common/ux-design-methodology.md`, `docs/client/common/ui-identity/README.md`, and the closest module contract under `docs/client/common/ui-identity/modules/`. Do not rely on ad-hoc component-library defaults.
9. **Service coordination first** — For cross-service issues (relay mount, DHT bootstrap, federation resolve failures, Station↔Relay↔Desktop connectivity), consult `docs/architecture/service-coordination.md` before debugging. It defines the dependency DAG, credential lifecycle, and troubleshooting index.
10. **Acceptance Infra ownership first** — Acceptance Core, planner, validator, runner, Evidence Store, lifecycle, and framework tooling work MUST use `pt-acceptance-infra-engineering`. Infra defines and validates injection contracts; it MUST NOT create, repair, weaken, or complete business Domain injection. Business Acceptance onboarding and proof remain with `pt-acceptance-engineering`.

---

## 5. Iron Laws

### Proto-First

- **ALL** data models defined in `model/domain/*.proto` first. Manual models are forbidden.
- Never edit generated files (`.pb.go`, `.pb.dart`, prost `.rs`).
- Inter-app communication: **protobuf only**. JSON forbidden unless interfacing external systems.
- Proto generation must follow the active platform path:
  - Shared / server-side generation: `./model/build.sh`
  - Mobile generation: `./tooling/scripts/proto-gen-mobile.sh`
- Do not introduce or expand deprecated Flutter/Dart generation paths.

### No Debug Statements

`console.log`, `print`, `println!`, `fmt.Println`, `debugPrint` — **absolutely forbidden**.
Use domain-specific loggers only (see platform docs for specifics).

### No Secrets in Code

- Never hardcode keys, tokens, passwords.
- All secrets via environment variables.
- `.gitignore` must cover: `*.key`, `*.pem`, `*.local.yml`, `*.jks`, `*.keystore`.

### No User-Home Absolute Paths

- Committed docs, plans, prompts, reports, knowledge, skills, fixtures, and
  configuration must not contain paths rooted in a developer or CI user's home.
- Use repo-relative paths for repository content.
- Use `<repo-root>`, `<workspace-root>`, `<runtime-home>`, or `$HOME` only when
  a portable placeholder is semantically required.
- Runtime worktree verification may use the real absolute path, but persisted
  Context Anchors record `<repo-root>` plus the verified branch.

### No Mocking

Frontend-backend collaborative APIs: **NO MOCK** unless the user explicitly says so. Using mock = cheating.

### No Unauthorized Version Bumps

The project is at its **current stage (v1)**. Do not "upgrade" version numbers on your own initiative.

- **Ask the user before bumping ANY version number** — framework, protocol/wire, proto message version, document, dependency/library, package, API, or schema. No exceptions.
- Do not write speculative "v2 / next-gen / phase-next" version labels into project rules, design docs, or code as if they were the current stage. Describe the current stage as **v1**.
- Third-party protocol names that happen to contain a version (e.g. an external spec's own "vN") are **references, not our version** — cite them as external names and never let them imply a bump to our own artifacts.
- If a change genuinely needs a new version, STOP and get explicit approval first; then bump exactly the one artifact approved, and update its changelog/migration notes in the same change.

### Logging Security

Never log tokens, passwords, secret keys, or PII. Error logs must include context + details.

### No Hardcoded UI Strings

All user-facing text **MUST** go through the i18n system (`packages/locales/`).
Never embed raw Chinese, English, or any natural-language string literals in components, services, or utility modules.
Fallback/error messages use **locale keys**, not literal text.
Non-React modules that cannot use hooks should throw errors with locale key identifiers; the UI layer translates them via `t()`.

### No Compliance Drift

When the user challenges, questions, or pushes back on an agent's output, the agent MUST NOT reflexively agree and change course just to appear cooperative. Instead:

1. **Evaluate independently** — Does the user's challenge expose a real flaw, or is the original reasoning actually sound?
2. **Defend when correct** — If the original output was right, explain why concisely and hold the position.
3. **Concede when wrong** — If the challenge reveals a genuine error, acknowledge it, explain what was wrong, and fix it.
4. **Never fabricate agreement** — Do not add items to a plan, remove items from a plan, or change a technical decision solely because the user questioned it. Every change must have a technical justification independent of the social pressure to agree.

This rule exists because compliance drift produces worse outcomes than honest disagreement: it introduces unnecessary work, masks real problems, and trains the user to distrust agent output.

---

## 6. Bug Fix Protocol

> Activates ONLY when user asks you to fix a problem.

1. **No patch-style fixes** — Analyze root cause from architectural perspective. Remove dead code.
2. **No silent fixes** — Report root cause → present plan → **wait for user approval**.

---

## 7. Code Generation Rules

### Code Aesthetics & Architectural Elegance

Three dimensions for every piece of generated code:

1. **Human-Readable**
   - Names are self-documenting: a reader should understand purpose without jumping to the definition.
   - Explicit over implicit: no magic numbers, no hidden side-effects, no unnamed boolean parameters.
   - Comments explain *why*, never *what*. If the *what* needs a comment, rename or restructure.
   - Logical grouping: related declarations stay together, separated by blank lines from unrelated ones.

2. **Architecturally Elegant**
   - Single Responsibility at every level: file, function, class, module.
   - Respect layer boundaries: never reach across two layers in one call.
   - Composition over inheritance; pure functions over stateful methods when possible.
   - No circular dependencies — if A imports B, B must never import A (directly or transitively).

3. **Design-Conscious**
   - Code structure reveals intent: a new reader can grasp the module's purpose from its file tree and public API alone.
   - APIs are intuitive: parameter order follows natural language, defaults are sensible, edge cases are impossible to misuse.
   - UI code respects pixel-level alignment, spacing rhythm, and visual hierarchy.
   - Error paths receive the same craftsmanship as happy paths — never an afterthought.

### General Rules

- **Comments**: English first, always.
- **Readability**: Well-structured code with appropriate comments, blank lines, logical grouping.
- **Change tracking**: Record reason, content, impact in comments for every modification.
- **Feature iteration**: Confirm business logic & directory architecture with user before generating.
- **Desktop UI**: LobeUI first, antd fallback.
- **Subserver code**: Must follow DDD (aggregate root, domain service, domain event).

---

## 8. Project Freshness / 项目新鲜度维护

### Directory README Maintenance / 目录 README 维护

> **When modifying files in a directory, always check if the directory has a README.md and whether it needs updating.**

- If a directory contains a `README.md`, any significant changes to files in that directory should be reflected in the README.
- This includes: new files, deleted files, renamed files, changed APIs, updated conventions.
- Keeping READMEs up-to-date ensures documentation stays synchronized with code.

---

## 9. Error Handling (Universal)

1. Never silently swallow errors.
2. Error messages must include context (operation name, key params, root cause).
3. Use typed error codes, never bare strings.
4. Log before propagating.
5. Station API errors → `ErrorResponse` proto format. Desktop Rust → `AppResult<T>`.
6. Client errors → user-friendly localized messages.

Error code ranges: `10000s` (business), `20000s` (protocol), `30000s` (content).

---

## 10. Verification Commands

| Platform | Commands |
|----------|----------|
| Desktop | `cd apps/desktop && pnpm run check && pnpm run test && pnpm run build` |
| Desktop (Tauri) | `cd apps/desktop && source ~/.cargo/env && CI=false pnpm run tauri:build` |
| Station | `cd apps/station && gofmt -l . && go test ./...` |
| Go Style | `./tooling/scripts/check-go-style.sh` |
| Mobile | `pnpm mobile:check` (target script during Tauri Mobile migration; use `docs/.agent/mobile.md` for current fallback checks) |
| Proto | `./model/build.sh`, `./tooling/scripts/proto-gen-mobile.sh` |

**Completion criteria**: Implementation complete + lint pass + build success + tests pass + functional verification.

---

## 11. Commit Rules

- Verify `.gitignore` coverage before every commit.
- Scan for leaked secrets: `git diff --cached | grep -iE '(secret|password|token|api_key|private_key)'`
- Always commit `.proto` source files; generated files may be gitignored.

---

## 12. Platform-Specific Rules

> **Load the relevant `.agent` file first when working on a specific platform.**
> Then follow its links to the actual architecture/platform/specification source documents.
> Do not treat `.agent` files as full architecture or full coding-standard sources.

| Platform | Agent Rules File |
|----------|-----------------|
| Station (Go) | [`docs/.agent/station.md`](docs/.agent/station.md) |
| Desktop (TS + Rust) | [`docs/.agent/desktop.md`](docs/.agent/desktop.md) |
| Mobile (Tauri + native plugins) | [`docs/.agent/mobile.md`](docs/.agent/mobile.md) |

---

## 13. Agent Skills

### 13.1 Single Source

The project owns its agent skills. **The only canonical location is**:

```
tooling/skills/<skill-name>/SKILL.md
```

Each skill directory contains:

- `SKILL.md` — required, with frontmatter `name` + `description`, then the body.
- Optional supporting files (templates, schemas, examples) co-located in the same directory.

Current project skills:

| Skill | Purpose |
|-------|---------|
| `pt-dev-workflow` | Drive a complete development task from planning to PR |
| `pt-god-view` | God view: explicitly invoked to show global work status, route to correct stage skill, manage work lifecycle |
| `pt-acceptance-infra-engineering` | Optimize and audit Acceptance Infra while enforcing the responsibility firewall against business Domain injection |
| `pt-acceptance-engineering` | Deterministically add, complete, upgrade, or audit Acceptance contracts, runtime scenarios, gates, and evidence |
| `pt-acceptance-gap-detector` | Enforce "No Silent Pass" iron law — detect 25+ bypass patterns (mocks, stale evidence, single-actor, hardcoded creds, downgraded gates) before marking any claim proven |
| `pt-dev-runtime-handoff` | Choose & start the right dev runtime (make targets) for acceptance testing |
| `pt-architecture-design-methodology` | Design source-backed architecture boundaries, ownership, contracts, topology, and ADR decisions before execution planning (referenced from §4.3) |
| `pt-architecture-execution-methodology` | Decompose architectural designs into actionable execution plans, domain ownership, and verification systems (referenced from §4.3) |
| `pt-branch-conflict-guardian` | Guide semantic conflict resolution across parallel branches: separate mechanical conflicts from ownership/behavior divergence, escalate unclear intent, and verify integrated behavior |
| `pt-context-anchor` | Synchronize verified tracked-work state from `active_work` + plan evidence into a fenced chat block; never write an Anchor into execution plans |
| `pt-execution-plan-guardian` | Keep execution, continuation, merge, and readiness reports tied to plan sources, scope boundaries, gates, and evidence |
| `pt-official-applet-development` | Create, scaffold, implement, and validate official applet product units under `apps/applets/` using the applet architecture contract |
| `pt-desktop-runtime-projections` | Enforce Page / Runtime / Boot kernel contracts under `apps/desktop/src/{kernel,runtimes,services,store,pages,components}` |
| `pt-read-before-edit` | Consult `docs/knowledge/` invariants / pitfalls / playbooks whose `owns:` covers the path being edited (referenced from §3.5) |
| `pt-quality-check` | Produce review-ready evidence from review profiles, acceptance, knowledge, deterministic gates, and test coverage |
| `pt-github-commit` | Conventional commit message generation with AI traceability |
| `pt-github-pr` | PR creation with templates, labels, and issue linking |
| `pt-github-release` | Semantic versioning, changelog generation, GitHub Release creation |
| `pt-github-review` | Structured PR code review and comment submission |
| `pt-local-dev-env` | Select and activate local development environment profiles |
| `pt-plan-and-document` | Route architecture, planning, and documentation work to the right project docs and workflows |
| `pt-prototype-design` | Create, modify, and review executable UI / UX prototypes under the project prototype system |
| `pt-prototype-sync-guardian` | Keep product implementation and prototypes aligned when visible behavior changes |
| `pt-completion-auditor` | Audit Peers-Touch work for completion, architecture, code quality, safety, evidence, and overclaim risk |
| `pt-frontend-component-tree-review` | Review frontend component tree structure, boundaries, and UI implementation quality |
| `pt-small-fix-discipline` | Govern small fixes so agents locate the governing spec, fix the correct architectural layer, keep changes surgical, and self-grade before claiming done |
| `pt-skill-author` | Govern creation, naming, cleanup, and verification of Peers-Touch `pt-*` project skills |

### 13.2 IDE Sync (Read by Agents on Startup)

IDE-specific skill/rule directories (`.cursor/rules/`, `.cursor/skills/`, `.trae/skills/`, `.windsurf/`, `.zed/`, `.vscode/skills/`, etc.) are **agent-private feature surfaces**, not project storage.

Agent responsibilities at startup:

1. **Discover**: read every `tooling/skills/*/SKILL.md` in the repo.
2. **Sync**: project the discovered skills into the agent's own feature directory (e.g. Cursor places them under `.cursor/skills/` or its in-memory registry; other IDEs do the equivalent).
3. **Resolve conflicts**: if a same-named skill already exists in the IDE-private directory, the project copy in `tooling/skills/` wins.
4. **Never write back**: do not edit, generate, or persist project skills inside the IDE-private directory.

This keeps `tooling/skills/` as the single git-tracked truth and prevents skill drift across IDE instances or contributors.

### 13.3 Hard Constraints

- **DO NOT** create new agent skills, rules, or behavioral guides directly inside `.cursor/rules/`, `.cursor/skills/`, `.trae/`, `.windsurf/`, `.zed/`, `.vscode/`, or any other IDE/agent-private folder.
- **DO** create them under `tooling/skills/<skill-name>/SKILL.md`, register them in §13.1 above, and let the IDE agent sync them at startup.
- **DO NOT** silently mirror project skills into IDE-private folders for "convenience". If the IDE needs a copy, that is the agent's runtime responsibility, not the repo's source-tree responsibility.
- Skill content is part of the architectural contract — same governance as `docs/`. Updates follow the same review process.

### 13.4 Adding a New Skill

1. Use `pt-skill-author` after the generic skill creator.
2. Create `tooling/skills/pt-<skill-name>/SKILL.md` with matching `name: "pt-<skill-name>"` + `description` frontmatter.
3. If the skill has supporting templates / schemas / examples, co-locate them in the same directory.
4. Add the skill to the table in §13.1.
5. If the skill enforces rules tied to a specific source-of-truth doc (e.g. `pt-desktop-runtime-projections` ↔ `docs/client/desktop/runtime-projections.md`), reverse-link both ways.
6. Do **not** also add the same content under `.cursor/rules/` etc. — the agent will sync it on startup per §13.2.

### 13.5 Stage Dispatch Protocol

Any non-trivial development task (cross-module, new feature, architecture change) progresses through ordered stages. **Agent MUST detect the current stage and dispatch to the correct skill.**

| Stage | Entry condition | Skill(s) to invoke | Gate (exit condition) | Artifact |
|-------|----------------|--------------------|-----------------------|----------|
| **DESIGN** | New architecture / boundary / ownership decision needed | `pt-architecture-design-methodology` | Architecture review prompt generated → user initiates review → review passes | `docs/architecture/<module>/` |
| **PLAN** | Architecture accepted (or trivial enough to skip DESIGN) | `pt-architecture-execution-methodology` (analysis) → `pt-plan-and-document` (落盘 + `active_work` registration + review prompt) | Plan review prompt generated → user initiates review → review passes | `execution-plans/<plan>.md` |
| **EXECUTE** | Plan accepted | `pt-execution-plan-guardian` | `pt-completion-auditor` passes OR completion criteria in plan all checked | Code + tests + evidence |
| **DELIVER** | Code complete, tests pass | `pt-github-commit` → `pt-github-pr` → `pt-github-review` | PR merged | Merged PR |

**Dispatch rules:**

1. Each stage MUST pass its gate before entering the next. No skipping gates.
2. Review pattern is uniform across stages: generate structured review prompt → user decides whether to send → iterate if needed → pass.
3. **Small fixes** (single-file bug fix, cosmetic tweak) skip DESIGN + PLAN, enter directly at EXECUTE via `pt-small-fix-discipline`.
4. **Stage detection**: check `active_work` in project memory → read the referenced execution plan status table → determine current stage.
5. If no active work exists and user's request is ambiguous, ask: "Is this a new architecture decision, or implementation of an existing plan?"
6. **Acceptance ownership dispatch**:
   - Core/runtime/planner/validator/runner/Evidence Store/framework optimization → `pt-acceptance-infra-engineering`.
   - Domain/Feature/Capability/Registry rule/concrete Gate/Environment/Provisioner/Fixture/product proof → `pt-acceptance-engineering`.
   - Mixed requests MUST be split. Infra reports business gaps as `BUSINESS_INJECTION_REQUIRED`; it does not implement them.
7. **Anchor creation boundary**: PRODUCT/DESIGN work without a formal execution plan is not tracked work and has no Context Anchor. After `pt-plan-and-document` creates the plan, register `active_work`; only then may `pt-context-anchor` emit a chat projection.

### 13.6 Session Continuity Protocol

**This protocol is triggered explicitly via `pt-god-view` skill, not automatically on every session start.**

When a user invokes `pt-god-view` (by saying "继续做" / "接着" / "看看状态" / "resume" etc.):

1. Read `project_memory.md` → check `active_work` registry.
2. Open the referenced plan and verify its `Context Anchor` through `pt-context-anchor`.
3. If one entry with `stage != complete`:
   - Report in one sentence: current plan, stage, step.
   - Suggest the next action (which skill to invoke).
   - Wait for user confirmation.
4. If multiple entries with `stage != complete`:
   - List all active entries (plan name, stage, branch).
   - Ask: "Which work do you want to continue?"
   - Wait for user selection.
5. If all entries are `complete` or registry is empty → offer to start new task.
6. Dispatch to the correct stage skill per §13.5.

**active_work registry schema** (maintained in `project_memory.md`):

```markdown
## active_work

| id | plan | stage | current_step | branch | blocked | last_session |
|----|------|-------|--------------|--------|---------|--------------|
| 1 | docs/.../execution-plans/20260723-phase1.md | EXECUTE | Step 3 | main | false | 2026-07-23 |
| 2 | docs/.../federation-phase2.md | PLAN | — | feat/federation | false | 2026-07-22 |
```

**Lifecycle rules:**

- **New pre-plan work** → run PRODUCT/DESIGN without an Anchor; do not create a placeholder row or fabricate a plan path.
- **Plan created** → append a row with the repository-relative plan path and `stage: PLAN`.
- **Stage transition** → update `stage` + `current_step` in corresponding row.
- **Session end** → update `last_session` date.
- **Branch merged** → if all phases complete, set `stage: complete`; if subsequent phases remain, update `branch` to target branch (e.g. `main`).
- **User explicitly closes** → set `stage: complete` regardless of plan status.
- **Stale detection** → if `last_session` is >14 days old and user hasn't mentioned it, ask on next session: "This work has been idle for N days — still active or should I close it?"

Context Anchor rules:

- `active_work` is the durable current-state index; the plan and linked tracking artifacts own scope, detailed progress, and evidence.
- Execution plans MUST NOT contain a `## Context Anchor` section.
- Tracked-work status, resume, handoff, blocker, readiness, and close responses end with the single fenced chat projection required by `pt-context-anchor`.

---

## Quick Reference Card

```
┌──────────────────────────────────────────────────────────────┐
│  Proto source     →  model/domain/<domain>/<name>.proto      │
│  Docs entry       →  docs/README.md                          │
│  Proto build      →  ./model/build.sh                        │
│  Mobile proto     →  ./tooling/scripts/proto-gen-mobile.sh   │
│  Desktop check    →  cd apps/desktop && pnpm run check       │
│  Station test     →  cd apps/station && go test ./...        │
├──────────────────────────────────────────────────────────────┤
│  NO console.log   │  NO println!    │  NO fmt.Println        │
│  NO print()       │  NO any type    │  NO manual models      │
│  NO mock APIs     │  NO hardcoded   │  NO silent error       │
│                   │    secrets       │    swallowing          │
│  NO hardcoded UI strings — use locale keys via i18n          │
└──────────────────────────────────────────────────────────────┘
```
