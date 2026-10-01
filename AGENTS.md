# AGENTS.md — Peers-Touch AI Agent Behavioral Guide

> Single authoritative source for all AI coding agents.
> `docs/.agent/<platform>.md` is the agent entry layer: use it to find the real source documents, hard constraints, and verification commands.
>
> Last updated: 2026-09-19

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
11. **Execution worktree binding first** — A skill source path selects
    instructions, never the execution worktree. Before dispatch and before the
    first edit, bind the explicitly selected current worktree through
    `tooling/scripts/verify-worktree-binding.py` and resolve its canonical root,
    branch, `workspaceId`, immutable initial HEAD, and current expected HEAD.
    Expected HEAD is advancing source identity outside the Plan Package; only
    an explicitly authorized refresh operation defined in §13.5.1 may change
    it.
12. **Development declaration first** — Read-only intake may inspect any
    permitted source, but every non-trivial task MUST publish and confirm its
    source/runtime intent through `make dev-start` before the first repository
    write or runtime acquisition. Scope growth uses `make dev-update`;
    completion/cancellation uses `make dev-release`. See
    `docs/architecture/development-workflow/README.md`. Source overlap across
    different worktrees on different branches is a coordination warning, not a
    lock; same-workspace, same-branch, and exclusive runtime conflicts still
    block.

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

### No Repository Debug Artifacts

- Do not create or commit `debug-*`, `.dbg/`, ad-hoc test prompts, runtime
  logs, DOM dumps, screenshots, traces, or temporary reports at repository
  root.
- Worktree-scoped debug sessions live under
  `~/.peers-touch/dev/workspaces/<workspaceId>/debug/<sessionId>/`.
- Durable conclusions belong in the governing `docs/` source, `docs/knowledge/`,
  or the Acceptance Evidence Store. Temporary debug sessions are deleted after
  closure; they are not retained as repository history.

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
  plans and Context Anchors record `<worktree-name> (<repo-root>)` rather than
  the absolute root. The logical worktree name is mandatory so `<repo-root>`
  cannot make multiple worktrees indistinguishable. A Context Anchor's
  worktree identity also includes the verified branch, `workspaceId`, initial
  HEAD, and expected/verified HEAD.

### Station Runs Through Profile Only

Station **MUST** be started exclusively via `make station`. The active profile
(`make profile <name>`) determines the mode (`local`, `compose`, or `remote`),
target host, ports, database, and all runtime parameters.

Forbidden alternatives — no exceptions, no "just quickly testing":

- `go run .` or `go run ./apps/station/app` directly.
- `go build` followed by running the binary manually.
- `docker compose up station` outside of `make station`.
- Any other path that bypasses the profile-driven `station-dev.sh` pipeline.

Why: the profile system enforces host consistency guards, deploy env binding,
compose project isolation, and health-check contracts. Bypassing it has caused
silent deployment to the wrong remote machine and schema mismatches that took
hours to diagnose.

### Development Resources Are Declared Before Use

- `~/.peers-touch/dev/work.json` is the machine-wide public intent ledger.
- Non-trivial work MUST use `make dev-start` before its first write or runtime
  acquisition and `make dev-check` before each mutation slice.
- An authorized commit, rebase or merge MUST be followed by `make dev-update`
  before the next mutation so the public declaration exposes the current HEAD.
- `RESOURCE_DECLARATION_CONFLICT` blocks the overlapping action. Do not evade it
  by changing worktree, Profile, path or resource.
- A declaration exposes intent only. Runtime exclusivity still requires Local
  Dev Control Plane leases. Delivery and history operations require their
  explicit authorizations. Station reset follows the canonical Profile ID
  policy: IDs containing `stable` case-insensitively are protected; every other
  reviewed Profile is Agent-resettable when binding capability, exact
  declaration scope, source identity, topology, and lease all match.
- `active_work`, branch names, process discovery and private `.local` files are
  not substitutes for public resource intent.
- Before runtime acquisition, every affected module emits one standard
  `ModuleImpact`. `pt-dev-workflow` alone resolves the combined target graph,
  peak capacity, reuse action, and concrete claims into a fenced
  `PlanResourcePlan`.
- Module Skills must not allocate concrete accounts, services, clients,
  devices, Fixtures, or automation sessions. Business Gates are attach-only;
  Local Dev or Acceptance Suite Runtime owns physical lifecycle and quarantine.
- Resource claims for one target are published all-or-none in canonical order.
  Capacity conflict parks only that target and its dependents; independent
  target lanes continue without a global lock.

### No Unauthorized Development Environments

AI agents MUST NOT create, copy, derive, or register a development profile or
deploy environment unless a human developer explicitly authorizes the exact
environment name and target in the current conversation. This prohibition
includes:

- adding files under the sibling `env/peers-touch/<name>/` repository;
- creating local-only definitions under `.local/dev/profiles/` or
  `.local/deploy/envs/`;
- supplying an arbitrary `PT_DEV_PROFILE_FILE`; run-scoped overrides require
  the Acceptance runtime-manifest authority and containment checks;
- running `make profile-authorize`, minting an authorization receipt, or
  running `make profile-init` without a pre-existing matching grant; and
- turning an ad-hoc host, port, existing pointer, execution plan, or Acceptance
  need into implied creation permission.

A missing environment is a blocker to report, not permission to create one.
Untracked env-repository definitions and local profiles without a matching
consumed human authorization receipt cannot authorize profile selection,
deployment, restart, or reset.

For an existing reviewed Profile, reset policy is derived only after the
directory name and `PT_DEV_PROFILE` value match exactly. No control-mode field,
legacy cache, or machine-state override is allowed. A non-stable Profile reset
never requires human confirmation; a stable Profile fails closed before lease
acquisition. Creating or renaming a Profile remains human-authorized topology
work.

### No Mocking

Frontend-backend collaborative APIs: **NO MOCK** unless the user explicitly says so. Using mock = cheating.

### No Invented Development Workflow Versions

The internal Development Workflow does not carry a synthetic `v1/v2/v3` stage
or release label. Git history and accepted architecture decisions identify its
current state.

- Do not add workflow-stage, Development Workflow document, Plan, Task,
  rollout, or "next-generation" version numbers.
- Internal closed records use their `kind` and exact shape as the current
  contract. Existing machine-state format guards are integrity details, not a
  project or workflow version, and must never be presented as one.
- Product protocols, architecture domains, third-party frameworks, and
  independently released packages retain their separately governed versions.
- A genuine external wire/package compatibility version still requires explicit
  approval and a concrete migration contract.

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
2. **No silent fixes** — Report root cause and the governing plan. An explicit
   fix/continue/execute request authorizes non-destructive work inside accepted
   scope; pause only at the hard boundaries in §13.5.

---

## 7. Code Generation Rules

### Code Aesthetics & Architectural Elegance

Three dimensions for every piece of generated code:

Review these requirements through `pt-code-structure-review`. Its stable
`STRUCT-01` through `STRUCT-09` rubric defines blocking conditions, legal
exceptions, positive/negative examples, and schema-validated calibration
fixtures. Cross-model conformance requires a separate evaluation.

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
- **Feature iteration**: Establish accepted business logic and directory
  architecture before generating. Use project review Skills by default; ask
  the user only when accepted sources cannot resolve a material semantic choice.
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

**Completion criteria**: Implementation complete + focused source checks +
required exact-source Journeys at `FUNCTIONAL_PASS` + required formal
Acceptance proof + released Development declaration and runtime resources.

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
| `pt-dev-workflow` | Own one non-trivial Development Run from verified intake and declaration through stage dispatch, execution, proof, delivery, and resource release |
| `pt-god-view` | Thin facade: classify intent and route exactly one owning workflow or specialist; never execute or persist state |
| `pt-goal-orchestrator` | Host-neutral scheduler: project bounded Ready/Parked work, ordering, and safe concurrency from an owner-supplied graph |
| `pt-trae-host-adapter` | Bind approved worker/UI actions to capabilities actually exposed by a detected TRAE host |
| `pt-cursor-host-adapter` | Bind approved worker/UI actions to capabilities actually exposed by a detected Cursor host |
| `pt-codex-host-adapter` | Bind approved worker/UI actions to capabilities actually exposed by a detected Codex host |
| `pt-acceptance-infra-engineering` | Optimize and audit Acceptance Infra while enforcing the responsibility firewall against business Domain injection |
| `pt-acceptance-engineering` | Deterministically add, complete, upgrade, or audit Acceptance contracts, runtime scenarios, gates, and evidence |
| `pt-acceptance-gap-detector` | Enforce "No Silent Pass" iron law — detect 25+ bypass patterns (mocks, stale evidence, single-actor, hardcoded creds, downgraded gates) before marking any claim proven |
| `pt-dev-runtime-handoff` | Own host-neutral runtime launch, interaction, exact-source Journey verification, Session result projection, and cleanup |
| `pt-architecture-design-methodology` | Design source-backed architecture boundaries, ownership, contracts, topology, and ADR decisions before execution planning (referenced from §4.3) |
| `pt-architecture-execution-methodology` | Derive vertical Journey/functional closures, dependencies, cutovers, and risk-based verification from accepted architecture |
| `pt-branch-conflict-guardian` | Guide semantic conflict resolution across parallel branches: separate mechanical conflicts from ownership/behavior divergence, escalate unclear intent, and verify integrated behavior |
| `pt-context-anchor` | Read-only projection of verified tracked-work state into chat; report owner mismatches without repairing them |
| `pt-execution-plan-guardian` | Read-only policy guard that allows, denies, or escalates one scheduler-proposed action |
| `pt-agent-development` | Emit Agent `ModuleImpact`, proof invalidation, and failure ownership for aggregation by the Development Workflow |
| `pt-official-applet-development` | Create, scaffold, implement, and validate official applet product units under `apps/applets/` using the applet architecture contract |
| `pt-desktop-runtime-projections` | Enforce Page / Runtime / Boot kernel contracts under `apps/desktop/src/{kernel,runtimes,services,store,pages,components}` |
| `pt-read-before-edit` | Consult `docs/knowledge/` invariants / pitfalls / playbooks whose `owns:` covers the path being edited (referenced from §3.5) |
| `pt-quality-check` | Produce review-ready evidence from review profiles, acceptance, knowledge, deterministic gates, and test coverage |
| `pt-code-structure-review` | Review authored source against stable structural rule IDs, blocking boundaries, legal exceptions, and fixture-calibrated verdicts |
| `pt-github-commit` | Conventional commit message generation with AI traceability |
| `pt-github-pr` | PR creation with templates, labels, and issue linking |
| `pt-github-release` | Semantic versioning, changelog generation, GitHub Release creation |
| `pt-github-review` | Structured PR code review and comment submission |
| `pt-local-dev-env` | Select and activate local development environment profiles |
| `pt-plan-and-document` | Persist accepted models into canonical docs/Plan Packages, validate them, and create or advance the workspace Plan generation |
| `pt-prototype-design` | Create, modify, and review executable UI / UX prototypes under the project prototype system |
| `pt-prototype-sync-guardian` | Keep product implementation and prototypes aligned when visible behavior changes |
| `pt-completion-auditor` | Audit Peers-Touch work for completion, architecture, code quality, safety, evidence, and overclaim risk |
| `pt-defect-closure` | Close the defect loop: debug → fix → acceptance injection; ensures every behavioral bug fix leaves behind a regression Gate |
| `pt-frontend-component-tree-review` | Review frontend component tree structure, boundaries, and UI implementation quality |
| `pt-debug-space-clean` | Audit and clean generated artifacts by current task, product surface, platform, and rebuild cost |
| `pt-small-fix-discipline` | Govern small fixes so agents locate the governing spec, fix the correct architectural layer, keep changes surgical, and self-grade before claiming done |
| `pt-skill-author` | Govern creation, naming, cleanup, and verification of Peers-Touch `pt-*` project skills |

### 13.2 IDE Sync (Read by Agents on Startup)

IDE-specific skill/rule directories (`.cursor/rules/`, `.cursor/skills/`,
`.trae/skills/`, `.agents/skills/`, `.windsurf/`, `.zed/`,
`.vscode/skills/`, etc.) are **agent-private feature surfaces**, not project
storage.

Agent responsibilities at startup:

1. **Discover**: read every `tooling/skills/*/SKILL.md` in the repo.
2. **Integrate**: run `make skills IDE=<trae|cursor|codex>` at a durable
   boundary. For a TRAE multi-root workspace, pass
   `WORKSPACE=<absolute-.code-workspace-path>`. It projects Skills in the
   selected source worktree and one descriptor-selected workspace hook
   bootstrap.
3. **Resolve conflicts**: if a same-named skill already exists in the IDE-private directory, the project copy in `tooling/skills/` wins.
4. **Never write back**: do not edit, generate, or persist project skills inside the IDE-private directory.
5. **Never mutate global hooks**: Cursor and Codex integration writes only this
   worktree's projection. TRAE writes one bootstrap in the descriptor's first
   folder and removes managed project hooks from existing sibling `.trae`
   projections; it preserves unrelated hook entries and never creates sibling
   host directories except for the bootstrap or selected source worktree. The
   first blockable tool event selects authority from an explicit declared task
   root or one mutation root, never from bootstrap location or folder order.

This keeps `tooling/skills/` as the single git-tracked truth and prevents skill drift across IDE instances or contributors.

After a governance-source update, follow
`docs/architecture/development-workflow/host-neutral-agent-integration.md`.
Installation rejects every live machine declaration, child assignment, and
workflow action except the current exact OWNER-bound `make skills` action.
Persist a Context Anchor, release the declaration, run
`make skills IDE=<host> [WORKSPACE=<absolute-.code-workspace-path>]`, restart
the IDE when hooks changed, audit, then resume. The hard cut deletes only the
old conversation and workflow-action stores; it does not migrate or read them.
Do not hot-swap Skills during an in-flight action.

### 13.3 Hard Constraints

- **DO NOT** create new agent skills, rules, or behavioral guides directly
  inside `.cursor/rules/`, `.cursor/skills/`, `.trae/`, `.agents/skills/`,
  `.windsurf/`, `.zed/`, `.vscode/`, or any other IDE/agent-private folder.
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
| **PRODUCT** | New capability, workflow, user journey, or visible state is undefined | `pt-dev-workflow` → `pt-product-design-methodology` | Product contract accepted; required prototype confirmed or explicitly blocked | Product docs + optional prototype |
| **DESIGN** | New architecture / boundary / ownership decision needed | `pt-dev-workflow` → `pt-architecture-design-methodology` | Architecture review prompt generated → agent review/remediation loop passes, or one precise hard-boundary decision is escalated | `docs/architecture/<module>/` |
| **PLAN** | Architecture accepted (or trivial enough to skip DESIGN) | `pt-dev-workflow` → `pt-architecture-execution-methodology` (vertical model) → `pt-plan-and-document` (persistence + generation-bound Plan ownership + review prompt) | Plan review prompt generated → agent review/remediation loop passes, or one precise hard-boundary decision is escalated | Plan Package |
| **EXECUTE** | Plan accepted | `pt-dev-workflow` coordinates host-neutral scheduler (`pt-goal-orchestrator`) + policy guard (`pt-execution-plan-guardian`) | required Journeys reach `FUNCTIONAL_PASS`, formal proof obligations pass, and `pt-completion-auditor` accepts the named scope | Code + tests + functional and formal evidence |
| **DELIVER** | Code complete, tests pass | `pt-dev-workflow` → `pt-github-commit` → `pt-github-pr` → `pt-github-review` | PR merged | Merged PR |

**Dispatch rules:**

1. `pt-dev-workflow` is the single orchestrator for non-trivial development.
   Read-only intake may precede declaration; the first write/runtime acquisition
   requires a confirmed public declaration.
2. `pt-god-view` is only a facade/router. It never executes, schedules, guards,
   or persists workflow state.
3. During EXECUTE, Goal Orchestrator schedules **what** is ready, Execution Plan
   Guardian decides whether one proposed action **may** run, and Dev Workflow
   executes allowed work and persists owner state. Context Anchor is read-only.
4. Each stage MUST pass its gate before entering the next. No skipping gates.
5. Review pattern is uniform across stages: generate a structured review prompt
   → invoke the applicable project Review Skills → fix source-backed findings
   → rerun affected checks/review → pass. The user is not the default reviewer.
   Escalate only an operation absent from the accepted authorization envelope,
   a destructive/irreversible or separately governed operation (including
   version/schema bump and worktree topology), a missing external resource, or
   a material product/architecture/security/privacy/compatibility/rollout
   choice that accepted sources cannot resolve.
6. **Small fixes** (single-file bug fix, cosmetic tweak) skip DESIGN + PLAN.
   Mutating fixes enter EXECUTE through `pt-dev-workflow`, which dispatches
   `pt-small-fix-discipline`; only a trivial text-only correction may invoke
   the specialist directly.
7. **Stage detection**: read this workspace's machine-local
   `workflow/active-work.json` → validate its Plan/Task/Session owners →
   determine current stage. Project memory and chat are never runtime inputs.
8. If no active work exists and user's request is ambiguous, ask: "Is this a new architecture decision, or implementation of an existing plan?"
9. **Acceptance ownership dispatch**:
   - Core/runtime/planner/validator/runner/Evidence Store/framework optimization → `pt-acceptance-infra-engineering`.
   - Domain/Feature/Capability/Registry rule/concrete Gate/Environment/Provisioner/Fixture/product proof → `pt-acceptance-engineering`.
   - Mixed requests MUST be split. Infra reports business gaps as `BUSINESS_INJECTION_REQUIRED`; it does not implement them.
10. **Functional fence**: focused source checks and one exact-source Journey
   precede Acceptance expansion. `SOURCE_CHECK`, `STRUCTURAL_CHECK`, `UX_REVIEW`,
   Gate count and test count cannot establish `FUNCTIONAL_PASS`.
11. **Acceptance scenario selection**: derive scenarios from product states,
    changed failure semantics, receiver outcomes, and concrete architecture
    risks; never require a generic five-variant matrix for every closure.
12. **Anchor creation boundary**: PRODUCT/DESIGN work without a formal execution
    plan is not tracked work and has no Context Anchor. After
    `pt-plan-and-document` creates and binds the plan, Dev Workflow derives this
    workspace's active-work record from owners; only then may
    `pt-context-anchor` emit a chat projection.
13. **Continuous Plan Run**: one explicit `continue`, `resume`, `execute the
    plan`, or equivalent request authorizes `pt-dev-workflow` to continue across
    Task closures, successor activation, internal review gates, and context
    compaction within the accepted Plan and authorization envelope. Goal Slice
    remains a single-Task internal scheduling unit. Do not ask `Continue?`
    after a Task, review, or Context Anchor while dependency-ready work remains.
14. **Host-neutral execution**: project Skills own scheduling, runtime
    verification, Session state, and evidence semantics. Detect TRAE, Cursor,
    Codex, or another host only when selecting an optional tool transport.
    `pt-goal-orchestrator` projects the capability request; after Guardian
    admission, `pt-dev-workflow` dispatches the matching `pt-*-host-adapter`.
    Repository-native
    Make/Harness/WebDriver/Appium paths take priority. Missing host capability
    degrades only that transport and never changes the required proof. Adapters
    do not execute repository-native fallback. Failed cleanup enters one
    bounded `HOST_CLEANUP_QUARANTINED` state; it cannot recursively invoke
    cleanup or block independent ready Tasks. Missing capability and cleanup
    observations persist immutable request identity in the Development Session.
    Only `UNAVAILABLE -> AVAILABLE` or post-expiry
    `QUARANTINED -> RELEASED | ESCALATION_REQUIRED` may update the blocked
    observation; unchanged requests cannot retry at zero progress.

#### 13.5.1 Owner-Rooted Workflow Binding Contract

This contract is fail-closed and applies before stage dispatch, execution,
edits, status claims, and completion claims.

1. One visible chat creates exactly one immutable `OWNER` binding at the first
   blockable `PreToolUse`. TRAE uses only `chat_session_id` for owner identity;
   its `session_id` is execution-session identity and never creates another
   owner. Cursor uses only `conversation_id`; Codex uses only `session_id`.
   Host-field aliases and process-global identity fallbacks are forbidden.
2. `WORKER` and `REVIEWER` are create-once assigned children. Every child
   preserves `rootBindingDigest`, direct `parentBindingDigest`, assignment,
   Development Session, role, and bounded lease. Expired or terminal children
   are history and cannot make current claims. OWNER authority has no generic
   TTL.
3. The canonical `BindingProjection` is not a worktree lease or cross-agent
   lock. It constrains one lineage: reads may use another `subjectRoot`, while
   every cross-worktree write is denied.
4. If the host exposes no required root-chat ID or no blockable pre-tool
   event, report `OBSERVE_ONLY`; never claim that hook enforcement is active.
   If a manual execution root remains ambiguous, stop and ask the user rather
   than inferring it from a Skill path, Plan path, branch name, or nearby repo.
5. From the bound current worktree root, capture its identity:
   `python3 tooling/scripts/verify-worktree-binding.py --root '<absolute-root>' --capture`.
6. Reconcile the captured identity with this workspace's active-work record,
   the formal plan, and the latest Context Anchor. Any mismatch,
   or any later root, branch, HEAD, or `workspaceId` drift,
   returns `WORKTREE_IDENTITY_MISMATCH` and stops. Do not repair a mismatch by
   automatically changing directories, switching branches, or selecting a
   different worktree.
7. From the same root, immediately verify all captured values:
   `python3 tooling/scripts/verify-worktree-binding.py --root '<absolute-root>' --branch '<branch>' --workspace-id '<workspaceId>' --head '<expected-head>'`.
   Every materialized value must be one POSIX shell-safe argument.
   Bind the verified canonical root, branch, `workspaceId`, initial HEAD,
   and expected HEAD. On first registration, expected HEAD equals initial HEAD.
   A missing verifier or unresolved field is
   `WORKTREE_IDENTITY_UNAVAILABLE`; a wrong invocation directory, identity
   mismatch, or later drift is `WORKTREE_IDENTITY_MISMATCH`. Both stop work.
8. Every mutating tool call must carry the OWNER's canonical root as its
   explicit `workdir`. File mutation tools must use absolute paths beneath that
   root. Subagents require an assigned child binding; an unassigned internal
   session inherits OWNER admission and cannot claim independent worker or
   reviewer authority.
9. Revalidate the same `BindingProjection` after resume or compaction and
   before status, readiness, handoff, worker result, review, or completion
   claims. Completion Review uses only the exact current owner-command Action
   Receipt and assigned REVIEWER; it never enumerates worktree bindings.
10. The initial HEAD remains the audit baseline. Expected HEAD may refresh only
   after a commit, rebase, or merge that the user explicitly authorized.
   Resume and context compaction verify the persisted values; they MUST NOT
   recapture current Git state as a replacement baseline. Unrelated sibling
   worktree inventory is machine topology and never part of this binding.
11. Do not run `git switch`, `git checkout`, `git worktree add`,
   `git worktree remove`, or `git worktree prune`, and do not create a
   worktree, unless the user explicitly requested that exact operation.
    A Plan binding or lifecycle conflict is never implicit permission to create
    another worktree.
12. A repository or PR may contain multiple active Plan Packages. Each
    workspace resolves only
    `~/.peers-touch/dev/workspaces/<workspaceId>/workflow/plan-binding.json`;
    branch scans, directory order, active status and synchronized foreign Plans
    never select execution ownership.
13. `make plan-bind PLAN=<path>` creates the workspace's first
    `planId + planPath` generation. The same tuple is idempotent; a different
    tuple returns `WORKSPACE_PLAN_REBIND_DENIED`.
14. `make plan-binding-advance PLAN=<path> EXPECTED_GENERATION=<n>` is the only
    next-Plan path for an existing workspace. It requires the current Plan to
    be completed and the workspace to have no live declaration, active-work
    projection, or runtime lease. It atomically advances one generation and
    retains immutable history.
15. Plan manifest, tracked declaration, workspace active-work record, Session
    and Context Anchor must match the immutable binding. A bound workspace
    cannot publish untracked work. CI has no machine binding and must receive
    an explicit Plan.

Legacy shared `project_memory.md ## active_work` rows are not runtime state and
cannot resume directly. The bounded Plan migration flow may read a declared
legacy registry to verify a reviewed `NONE -> NONE` or source crosswalk, but no
compatibility writer updates that Markdown. Resume requires the current
worktree's Plan binding, declaration and Session owners to validate first, then
`make active-work-sync WORK_ITEM=<id>` creates the workspace-owned record.
Missing or contradictory owners fail closed; another workspace's record is
never read as a fallback.

### 13.6 Session Continuity Protocol

**This protocol is triggered explicitly via `pt-god-view` skill, not automatically on every session start.**

When a user invokes `pt-god-view` (by saying "继续做" / "接着" / "看看状态" / "resume" etc.):

1. `pt-god-view` classifies the intent and selects exactly one owner.
2. Status/handoff routes to read-only `pt-context-anchor`.
3. Continue/resume routes to `pt-dev-workflow`, which verifies binding,
   reconciles Plan/Task/Session/workspace active-work, and starts or resumes the
   authorized Plan Run.
4. Dev Workflow asks `pt-goal-orchestrator` for the Ready/Parked schedule
   and concurrency lanes.
5. Every proposed action is evaluated by `pt-execution-plan-guardian`; only
   `ACTION_ALLOWED` work executes.
6. Dev Workflow persists meaningful results through owner commands, performs
   required agent review/remediation, activates a dependency-ready successor,
   and repeats until the Plan is terminal or a hard boundary exhausts the
   runnable frontier.
7. Context Anchor may project meaningful progress or support context compaction,
   but it does not pause the Plan Run or request confirmation.
8. Multiple plausible tracked items return `TRACKED_WORK_SELECTION_REQUIRED`.
   Empty/completed registries route to new-task intake.

For EXECUTE work, the Goal scheduler applies one explicit concurrency decision
before source edits.
Choose parallel, serial, or hybrid execution from actual dependencies,
write-set overlap, generated outputs, shared runtime resources, verification
isolation, and integration order. Parallel lanes require reserved exclusive
write sets; shared contracts, generated artifacts, reconciliation, commits,
deployments, Fixture mutation, and final product Gates retain one integrator
owner unless the plan proves stronger isolation. Only live,
backend-addressable agents with the same Goal identity conflict. Listed but
backend-unaddressable entries are stale metadata, not a reason to serialize the
Goal or persist a blanket no-subagent constraint.

God View, Goal Orchestrator, Execution Plan Guardian, Context Anchor and Peers
Dev are read-only with respect to Plan/Task/Session/workspace active-work.
Dev Workflow coordinates writes through owner commands.

**Workspace active-work record**

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/active-work.json
```

The closed record contains revision/digest, workspace/work-item identity,
Plan/Task locator and lifecycle, Session/Journey locator and `devState`, branch,
immutable initial HEAD, advancing expected HEAD and update time. It is derived
from owners by `make active-work-sync WORK_ITEM=<id>`; callers cannot submit
arbitrary replacement JSON.

**Lifecycle rules:**

- **New pre-plan work** → run PRODUCT/DESIGN without an Anchor; do not create a
  placeholder record or fabricate a plan path.
- **First Plan created** → validate it, create generation 1, publish the tracked
  declaration, then derive this workspace's record.
- **Next Plan created** → after the current Plan is completed and declaration,
  active-work, and runtime leases are released, explicitly advance the
  generation with expected-generation CAS. Never create a worktree as an Agent
  workaround.
- **Worktree binding created** → record the verified `workspace_id`,
  `initial_head`, and `expected_head`; initially both HEAD fields are
  identical. Never derive identity from a skill path or copy it from another
  worktree.
- **Task/Session transition** → Dev Workflow updates manifest/Task/Session
  owners first, then invokes active-work sync with revision/CAS.
- **Task done with ready successor** → Dev Workflow advances the manifest,
  refreshes the declaration locator and active-work record, asks Goal
  Orchestrator for the successor Slice, and continues the same Plan Run without
  user confirmation.
- **Action blocked** → the scheduler parks the action in its projection; Dev
  Workflow persists only owner-defined blocker state and resynchronizes.
- **Goal blocked** → Plan/Task/Session owners record fixed-point exhaustion;
  active-work only mirrors those owners.
- **Close** → `make active-work-close WORK_ITEM=<id>
  EXPECTED_REVISION=<n>` removes only this workspace's record with CAS.
- **Distribution** → `peers-dev-workflow` publishes the implementation; the
  installed copy derives the consuming worktree's canonical root and
  `workspaceId`. The source repository owns no consumer runtime state.

Context Anchor rules:

- The workspace active-work file is a durable locator projection; Plan, Task,
  Session, declaration and Git remain the state owners.
- Execution plans MUST NOT contain a `## Context Anchor` section.
- Context Anchor validates and projects; it never writes or repairs active-work.
- The Workflow Kernel renders the exact Anchor at Stop and stores only its
  machine-local receipt. A terminal or blocked conversation releases only
  after that exact projection is observable in the assistant response or host
  transcript.
- The chat projection records `<worktree-name> (<repo-root>)`, verified branch,
  `workspaceId`, initial HEAD, and expected/verified HEAD.
  It never persists a developer or CI user-home absolute path or an ambiguous
  bare `<repo-root>`.
- The chat projection also records completed delta, dependency-ready queue,
  execution mode and live backend-addressable lanes, conflict controls,
  critical path, Plan Run queue/mandate/autonomous horizon/stop conditions, and
  an evidence-backed ETA or `unknown`.
- Resume verification is internal workflow state. It must not interrupt an
  authorized execution turn merely to emit an Anchor.
- Task closure, review success, Context Anchor output, and context compaction
  are internal Plan Run boundaries; none consumes the user's continuation
  authorization.
- Tracked-work status, resume, handoff, blocker, readiness, and close responses end with the single fenced chat projection required by `pt-context-anchor`.
- Project memory and chat are outputs only. No normal path writes a shared
  cross-workspace `active_work` table.

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
