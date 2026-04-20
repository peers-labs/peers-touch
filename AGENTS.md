# AGENTS.md — Peers-Touch AI Agent Behavioral Guide

> Single authoritative source for all AI coding agents.
> `docs/.agent/<platform>.md` is the agent entry layer: use it to find the real source documents, hard constraints, and verification commands.
>
> Last updated: 2026-04-12

---

## 1. Project Identity

**Peers-Touch** — decentralized, federated social network framework.
Three-tier architecture: **Client → Model → Station**.

| App | Path | Stack |
|-----|------|-------|
| **Station** | `apps/station/` | Go, DDD subservers, Hertz, PostgreSQL |
| **Desktop** | `apps/desktop/` | Tauri + React/TS + Rust |
| **Mobile** | `apps/mobile/` | Android (Kotlin/Compose), iOS (Swift/SwiftUI) |

---

## 2. Repository Layout

```
peers-touch/
├── apps/
│   ├── desktop/           # Tauri + React/TS + Rust
│   ├── mobile/
│   │   ├── android/       # Kotlin + Jetpack Compose
│   │   ├── ios/           # Swift + SwiftUI
│   │   └── flutter/       # ⚠️ DEPRECATED — do not touch
│   ├── station/
│   │   ├── app/           # Business logic + subservers (DDD)
│   │   └── frame/         # Core framework
│   └── oauth2-client/
├── model/domain/          # Proto definitions (single source of truth)
├── packages/              # applet-sdk, applets, locales
├── tooling/
│   ├── scripts/           # Build & dev scripts
│   └── skills/            # Dev skills for AI agents (github-pr, github-commit, etc.)
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

Constraint rule:

- Upper layers constrain lower layers.
- Lower layers may refine implementation detail, but may not redefine upper-layer boundaries.
- If two docs appear to conflict, prefer the higher layer unless the user explicitly chooses a new source of truth.

Primary docs entry:

- Start from `docs/README.md` when you need to locate the right source document.

---

## 4. Thinking Principles

1. **Rationality over minimalism** — Architectural soundness is the goal, not minimum change.
2. **Run scripts first** — Prefer `tooling/scripts/` (`dev-desktop-app.sh`, `dev-desktop-web.sh`, `pt.sh`, etc.).
3. **Architecture methodology** — For architecture landing / migration / domain decomposition, **MUST** use `architecture-execution-methodology` skill: `Domain Responsibility → Execution Closure → Dependency Order → Verifiable Delivery`.

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

### No Mocking

Frontend-backend collaborative APIs: **NO MOCK** unless the user explicitly says so. Using mock = cheating.

### Logging Security

Never log tokens, passwords, secret keys, or PII. Error logs must include context + details.

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
| Android | `cd apps/mobile/android && ./gradlew build` |
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
| Mobile (Kotlin + Swift) | [`docs/.agent/mobile.md`](docs/.agent/mobile.md) |

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
└──────────────────────────────────────────────────────────────┘
```
