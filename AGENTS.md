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
- Cross-layer work touching more than one of Desktop Renderer, Desktop Rust, Station, Model, packages, or applets.
- Architecture landing, migration, domain decomposition, runtime ownership, persistence, public API, protocol, or directory boundary changes.
- Large UI / UX redesign that changes product workflow or module ownership.
- Benchmark-driven rebuilds from an external project, such as LobeHub-style Agent capability mapping.

Required behavior:

1. Locate the formal docs home from `docs/README.md`.
2. Write the durable design in the correct `docs/` layer:
   - Architecture boundary / cross-layer capability → `docs/architecture/<taxonomy>/<domain>/`
   - Desktop-only implementation plan → `docs/client/desktop/`
   - Station-only implementation plan → `docs/station/`
   - Coding convention → `docs/global/coding-guide/`
   - Historical research only → `docs/context/`
3. Add an execution plan under the nearest `execution-plans/` directory when delivery spans multiple phases.
4. Update the nearest `README.md` so the new document is discoverable.
5. Keep `.trae/documents/` only as scratch/spec workspace material; if it contains useful decisions, promote them into `docs/`.
6. Before implementation, report the formal docs paths to the user.

Example:

- Agent LobeHub-style rebuild formal design: `docs/architecture/domains/agent/agent-lobehub-blueprint.md`
- Its execution plan: `docs/architecture/domains/agent/execution-plans/20260616-agent-lobehub-rebuild.md`

---

## 4. Thinking Principles

1. **Rationality over minimalism** — Architectural soundness is the goal, not minimum change.
2. **Run scripts first** — Prefer `tooling/scripts/` (`dev-desktop-app.sh`, `pt.sh`, etc.).
3. **Architecture design methodology** — For architecture design / system boundaries / ownership / contracts / topology / design decisions, **MUST** use `pt-architecture-design-methodology` skill before execution planning.
4. **Architecture execution methodology** — For architecture landing / migration / domain decomposition, **MUST** use `pt-architecture-execution-methodology` skill: `Domain Responsibility → Execution Closure → Dependency Order → Verifiable Delivery`.
5. **Runtime projection first** — For Desktop bugs involving chat, contacts, notifications, badges, realtime, or store freshness, first identify the owning runtime and its projection contract. Do not patch stale state only with page/component refreshes; read `docs/client/desktop/runtime-projections.md`.
6. **Page / Runtime / Boot contracts** — When adding or refactoring a Desktop page, projection owner, or startup step, conform to the Page / Runtime / Boot kernel contracts in `docs/client/desktop/runtime-projections.md §6`. Pages are pure renderers (no mount-time fetches); long-lived projections live in `RuntimeDescriptor`s; one-shot section data uses `kernel/usePrefetch`; startup is observable through `kernel/boot.ts` phases.
7. **Desktop debug uses Make** — During investigation, lifecycle debugging, native app E2E, applet runtime debugging, or acceptance triage, start Desktop through `make desktop`. Desktop has no supported browser shell. Do **not** switch to hard packaged `.app` / `tauri build` / release bundle flows unless the user explicitly asks for packaging, release validation, installer validation, or a package-only acceptance gate. See `docs/knowledge/playbooks/desktop-debug-runtime.md`.
8. **UI Identity first** — For any UI/UX design, visual refactor, screenshot review, layout issue, button/style issue, or client UI code change, first read `docs/client/common/ux-design-methodology.md`, `docs/client/common/ui-identity/README.md`, and the closest module contract under `docs/client/common/ui-identity/modules/`. Do not rely on ad-hoc component-library defaults.
9. **Service coordination first** — For cross-service issues (relay mount, DHT bootstrap, federation resolve failures, Station↔Relay↔Desktop connectivity), consult `docs/architecture/platform/runtime/service-coordination.md` before debugging. It defines the dependency DAG, credential lifecycle, and troubleshooting index.
10. **Acceptance Infra ownership first** — Acceptance Core, planner, validator, runner, Evidence Store, lifecycle, and framework tooling work MUST use `pt-acceptance-infra-engineering`. Infra defines and validates injection contracts; it MUST NOT create, repair, weaken, or complete business Domain injection. Business Acceptance onboarding and proof remain with `pt-acceptance-engineering`.
11. **Acceptance Suite reuse first** — Multi-scenario runtime Tasks MUST keep
    build, deploy, account, client, device, storage, and login ownership at Task
    or Suite scope. Scenarios are attach-only and own only namespaced data,
    reset, real product actions, and receiver-visible assertions. Declare
    `runtimeReuse` and audit it with `pt-acceptance-pipeline-auditor`.
12. **Explicit worktree first** — A skill source path never selects the
    execution worktree. Use the canonical worktree explicitly selected for the
    request. Creating, switching, removing, or pruning a worktree requires the
    user's explicit request for that operation.
13. **Records are optional; real guards are mandatory** — Ordinary source work
    requires no declaration, OWNER, PlanMount, Session, or close receipt.
    Complex tasks may use an explicit `.dev-workflow/tasks/<taskId>` record.
    Runtime operations still require reviewed Profile, capability, exact
    target/scope, current source identity, stable protection, and OS-held
    lease. See `docs/global/workflow.md`.

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

### No Fabricated Evidence

- Never invent, forge, rewrite, or relabel test results, runtime observations,
  review findings, approvals, or Acceptance evidence.
- Report missing or stale proof as unverified. Internal workflow tooling does
  not need signatures, HMACs, or reviewer receipt chains to enforce this rule.

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

### Runtime Resources Use Concrete Guards

- Source and documentation work do not require a machine task ledger.
- Local Dev and Acceptance Suite Runtime own physical resource lifecycle,
  contention, and quarantine.
- Station reset follows the canonical Profile ID policy: IDs ending in
  `stable` case-insensitively are protected; every other reviewed Profile is
  Agent-resettable when binding capability, exact scope, current source
  identity, topology, and OS-held lease all match.
- An existing reviewed non-stable Profile is direct authority for the
  operations declared by its binding capabilities. Selecting or registering
  it, creating its runtime instance, deploying, restarting, and exact-scope
  reset do not require a separate chat authorization prompt.
- Optional task progress, Plan files, Hook state, and chat identity neither
  grant nor block runtime acquisition.
- Do not evade an actual resource conflict by changing worktree, Profile,
  target alias, path, or caller-supplied resource ID.
- Module Skills must not allocate concrete accounts, services, clients,
  devices, Fixtures, or automation sessions. Business Gates are attach-only;
  Local Dev or Acceptance Suite Runtime owns physical lifecycle and quarantine.
- Resource claims for one target are published all-or-none in canonical order.
  Capacity conflict parks only that target and its dependents; independent
  target lanes continue without a global lock.

### Profile-Scoped Development Environment Operations

AI agents may create and operate development runtime instances as needed by the
task. `make profile-init` may create a worktree-local Profile, while an existing
reviewed non-stable Profile may be selected, registered, provisioned, deployed,
restarted, and reset without a separate approval round.

These operations remain bounded:

- the canonical Profile or worktree-local Profile owns topology; do not invent
  an ad-hoc host, port, credential, or arbitrary `PT_DEV_PROFILE_FILE`;
- worktree-local Profiles must remain current-user-owned private regular files
  with shell-safe literal assignments and are parsed into quoted exports, not
  sourced as executable shell;
- environment-repository definitions used for remote mutation must be
  Git-tracked and clean;
- adding or changing a tracked Profile in the sibling `env` repository is an
  ordinary source change only when that repository is explicitly in task scope;
- Profile capability, exact target or reset scope, current source identity,
  stable protection, and OS-held lease must all pass at the concrete entrypoint;
- Profile IDs ending in `stable`, case-insensitively, remain protected from
  autonomous reset; stable selection grants connect only, stable deploy needs
  an explicit user-directed capability binding, and stable reset is forbidden.

Profile selection and runtime provisioning are not worktree creation. They may
proceed automatically inside the user-selected worktree. A missing target or
credential is a real blocker; it must not be guessed.

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
Acceptance proof + explicit disposition of resources owned by the request.

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
| `pt-dev-workflow` | Organize one request from verified intake through implementation, proof, delivery, and owned-resource release; task progress is optional |
| `pt-god-view` | Thin facade: classify intent and route exactly one owning workflow or specialist; never execute or persist state |
| `pt-goal-orchestrator` | Host-neutral scheduler: project bounded Ready/Parked work, ordering, and safe concurrency from an owner-supplied graph |
| `pt-trae-host-adapter` | Bind approved worker/UI actions to capabilities actually exposed by a detected TRAE host |
| `pt-cursor-host-adapter` | Bind approved worker/UI actions to capabilities actually exposed by a detected Cursor host |
| `pt-codex-host-adapter` | Bind approved worker/UI actions to capabilities actually exposed by a detected Codex host |
| `pt-acceptance-infra-engineering` | Optimize and audit Acceptance Infra while enforcing the responsibility firewall against business Domain injection |
| `pt-acceptance-engineering` | Deterministically add, complete, upgrade, or audit Acceptance contracts, runtime scenarios, gates, and evidence |
| `pt-acceptance-pipeline-auditor` | Audit multi-scenario Suite lifecycle reuse, proof strength, resource budgets, and cleanup without modifying product code or evidence |
| `pt-acceptance-gap-detector` | Enforce "No Silent Pass" iron law — detect 25+ bypass patterns (mocks, stale evidence, single-actor, hardcoded creds, downgraded gates) before marking any claim proven |
| `pt-dev-runtime-handoff` | Own host-neutral runtime launch, interaction, exact-source Journey verification, result evidence, and cleanup |
| `pt-architecture-design-methodology` | Design source-backed architecture boundaries, ownership, contracts, topology, and ADR decisions before execution planning (referenced from §4.3) |
| `pt-architecture-execution-methodology` | Derive vertical Journey/functional closures, dependencies, cutovers, and risk-based verification from accepted architecture |
| `pt-branch-conflict-guardian` | Guide semantic conflict resolution across parallel branches: separate mechanical conflicts from ownership/behavior divergence, escalate unclear intent, and verify integrated behavior |
| `pt-context-anchor` | Read-only projection of current Git, an optional explicit task, runtime facts, and evidence |
| `pt-execution-plan-guardian` | Read-only check of one proposed action against explicit scope, architecture, authorization, and real resources |
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
| `pt-oauth2-client-2-vercel` | Publish and verify the OAuth2 Client on Vercel with fail-closed provider, environment, callback, and persistence checks |
| `pt-plan-and-document` | Persist accepted models into canonical frozen Plan Versions and validate them without creating runtime workspace occupancy |
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
5. **Never mutate global hooks**: install only in the explicitly selected
   project scope. Preserve unrelated Hook entries and other workspace roots.
   Hook location and folder order never establish authority.

This keeps `tooling/skills/` as the single git-tracked truth and prevents skill drift across IDE instances or contributors.

After a governance-source update, follow
`docs/architecture/engineering/development-workflow/host-neutral-agent-integration.md`.
Run `make skills IDE=<host>` only for the explicitly selected project scope.
Skill projection and optional Hook diagnostics are reported separately. Hook
failure does not disable project Skills or ordinary development.

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

Any non-trivial development task (cross-module, new feature, architecture change)
progresses through ordered stages unless the user explicitly selects standalone
execution without a Plan. **Agent MUST detect the current stage, preserve that
Plan policy, and dispatch to the correct skill.**

An explicit user instruction such as `no plan`, `不要 plan`, or `直接做，不创建计划`
is authoritative for the current request. It forbids creating a Plan Version
or substitute task record. The Agent may execute against existing accepted
product and architecture sources, run focused verification, and deliver the
authorized result.
If the work cannot be executed safely without a new formal Plan, report that
boundary instead of silently creating one.

| Stage | Entry condition | Skill(s) to invoke | Gate (exit condition) | Artifact |
|-------|----------------|--------------------|-----------------------|----------|
| **PRODUCT** | New capability, workflow, user journey, or visible state is undefined | `pt-dev-workflow` → `pt-product-design-methodology` | Product contract accepted; required prototype confirmed or explicitly blocked | Product docs + optional prototype |
| **DESIGN** | New architecture / boundary / ownership decision needed | `pt-dev-workflow` → `pt-architecture-design-methodology` | Architecture review prompt generated → agent review/remediation loop passes, or one precise hard-boundary decision is escalated | `docs/architecture/<taxonomy>/<module>/` |
| **PLAN** | Architecture accepted and formal planning is authorized | `pt-dev-workflow` → `pt-architecture-execution-methodology` → `pt-plan-and-document` (frozen Plan Version + review prompt) | Plan review passes or one precise hard-boundary decision is escalated | Plan Version |
| **EXECUTE** | Plan accepted, or no-Plan work has sufficient accepted sources | `pt-dev-workflow` coordinates host-neutral execution and optional task progress | required Journeys and proof obligations pass; `pt-completion-auditor` accepts the named scope | Code + tests + functional and formal evidence |
| **DELIVER** | Code complete, tests pass | `pt-dev-workflow` → `pt-github-commit` → `pt-github-pr` → `pt-github-review` | PR merged | Merged PR |

**Dispatch rules:**

1. `pt-dev-workflow` is the single organizer for non-trivial development.
   Ordinary writes need no declaration. Runtime acquisition uses its concrete
   operation guard.
2. `pt-god-view` is only a facade/router. It never executes, schedules, guards,
   or persists workflow state.
3. During EXECUTE, Goal Orchestrator may schedule **what** is ready from an
   explicit work graph. Execution Plan Guardian checks concrete scope and
   authorization. Context Anchor is read-only.
4. Planned work and no-Plan work share the same source, verification, review,
   delivery, and cleanup requirements. A Plan and optional task record do not
   add execution authority.
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
7. **Stage detection**: use the explicit request and, when selected, one
   `.dev-workflow/tasks/<taskId>` record. Do not guess from mtime, branch,
   project memory, chat, or historical active-work.
8. If no active work exists and user's request is ambiguous, ask: "Is this a new architecture decision, or implementation of an existing plan?" Never ask
   this after the user explicitly selected no-Plan standalone execution.
9. **Acceptance ownership dispatch**:
   - Core/runtime/planner/validator/runner/Evidence Store/framework optimization → `pt-acceptance-infra-engineering`.
   - Domain/Feature/Capability/Registry rule/concrete Gate/Environment/Provisioner/Fixture/product proof → `pt-acceptance-engineering`.
   - Multi-scenario lifecycle reuse and proof-strength audit → `pt-acceptance-pipeline-auditor`.
   - Mixed requests MUST be split. Infra reports business gaps as `BUSINESS_INJECTION_REQUIRED`; it does not implement them.
10. **Functional fence**: focused source checks and one exact-source Journey
   precede Acceptance expansion. `SOURCE_CHECK`, `STRUCTURAL_CHECK`, `UX_REVIEW`,
   Gate count and test count cannot establish `FUNCTIONAL_PASS`.
11. **Acceptance scenario selection**: derive scenarios from product states,
    changed failure semantics, receiver outcomes, and concrete architecture
    risks; never require a generic five-variant matrix for every closure.
12. **Anchor boundary**: Context Anchor may project any explicit request.
    Without task progress it reports no selected task; it does not create one.
13. **Continuous Plan Run**: one explicit `continue`, `resume`, `execute the
    plan`, or equivalent request authorizes `pt-dev-workflow` to continue across
    Task closures, successor activation, internal review gates, and context
    compaction within the accepted Plan and authorization envelope. Goal Slice
    remains a single-Task internal scheduling unit. Do not ask `Continue?`
    after a Task, review, or Context Anchor while dependency-ready work remains.
14. **Host-neutral execution**: project Skills own scheduling, runtime
    verification, and evidence semantics. Detect TRAE, Cursor,
    Codex, or another host only when selecting an optional tool transport.
    `pt-goal-orchestrator` projects the capability request; after Guardian
    admission, `pt-dev-workflow` dispatches the matching `pt-*-host-adapter`.
    Repository-native
    Make/Harness/WebDriver/Appium paths take priority. Missing host capability
    degrades only that transport and never changes the required proof. Adapters
    do not execute repository-native fallback or create repository authority.
    Failed transport cleanup cannot block independent ready work.

#### 13.5.1 Current-Source Workflow Contract

1. The user-selected canonical worktree and current request define scope.
   Hook, host identity, Plan state, task progress, chat history, and memory do
   not authorize repository or runtime operations.
2. Every mutating tool call uses the selected canonical root as explicit
   `workdir`; file edits use absolute paths under that root. Reading or writing
   another worktree requires explicit scope.
3. Do not create, switch, remove, or prune a worktree unless the user explicitly
   requested that exact worktree operation.
4. Ordinary work requires no formal Plan and no task record. A frozen Plan is
   read only from an explicit path. A task record is created only when durable
   recovery is useful and is selected by explicit `taskId`.
5. Optional task records live under `.dev-workflow/tasks/<taskId>/`, use one
   checksum-protected atomic snapshot with revision/CAS, and never grant write,
   runtime, delivery, or evidence authority.
6. Resume and status derive from the current request, current Git/runtime facts,
   one explicit task ID, an explicit Plan/task selector when supplied, and
   current evidence. Never infer a task from branch, mtime, chat, or memory.
7. The Agent may create a local checkpoint commit at any useful coherent
   boundary for traceability, rollback, integration, or exact-source runtime.
   Stage only task-owned files and run checkpoint-appropriate source and secret
   checks. A commit is not proof, completion, or delivery. Push, PR, merge,
   release, history rewrite, and worktree operations remain separately
   governed.
8. Hook events are advisory. Unknown events, missing identity, ambiguous host
   context, and Hook failures return neutral output. Real permission, stable
   protection, data scope, and OS-held resource locks stay in concrete
   operation entrypoints.
9. Current-source evidence must bind the current commit and workspace digest.
   Source changes invalidate prior evidence. Caller-authored PASS values do not
   become formal proof.
10. Completion review consumes explicit obligations, current source, and current
   evidence. Closing affects only the selected task and resources it actually
   owns; it never seals the worktree.

### 13.6 Resume And Goal Continuity

When the user invokes `pt-god-view` for status or resume:

1. Route status/handoff to read-only `pt-context-anchor`.
2. Route continuation to `pt-dev-workflow`.
3. Use `pt-goal-orchestrator` only for a bounded work graph derived from the
   accepted scope.
4. Schedule from actual dependencies, write overlap, generated outputs,
   runtime resources, verification isolation, and integration order.
5. Continue while the ready frontier contains authorized work. Park only the
   blocked action. Mark the Goal blocked only when the frontier is empty and an
   external decision or state change is required.
6. Context compaction, internal review, task closure, and optional checkpoint
   output do not consume the user's existing continuation authorization.

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
