# AGENTS.md — Peers-Touch AI Agent Behavioral Guide

> Single authoritative source for all AI coding agents.
> Platform-specific details live in `docs/.agent/<platform>.md` — load on demand.
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
├── tooling/scripts/       # Build & dev scripts
└── docs/
    ├── .agent/            # Platform-specific agent rules (load on demand)
    ├── .ide/              # IDE scoped rules, documents, specs
    └── global/            # Cross-platform standards
```

---

## 3. Thinking Principles

1. **Rationality over minimalism** — Architectural soundness is the goal, not minimum change.
2. **Run scripts first** — Prefer `tooling/scripts/` (`dev-desktop.sh`, `pt.sh`, etc.).
3. **Architecture methodology** — For architecture landing / migration / domain decomposition, **MUST** use `architecture-execution-methodology` skill: `Domain Responsibility → Execution Closure → Dependency Order → Verifiable Delivery`.

---

## 4. Iron Laws

### Proto-First

- **ALL** data models defined in `model/domain/*.proto` first. Manual models are forbidden.
- Never edit generated files (`.pb.go`, `.pb.dart`, prost `.rs`).
- Inter-app communication: **protobuf only**. JSON forbidden unless interfacing external systems.
- Proto generation: `./model/build.sh` (Go+Dart), `./tooling/scripts/proto-gen-mobile.sh` (Kotlin+Swift).

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

## 5. Bug Fix Protocol

> Activates ONLY when user asks you to fix a problem.

1. **No patch-style fixes** — Analyze root cause from architectural perspective. Remove dead code.
2. **No silent fixes** — Report root cause → present plan → **wait for user approval**.

---

## 6. Code Generation Rules

- **Comments**: English first, always.
- **Readability**: Well-structured code with appropriate comments, blank lines, logical grouping.
- **Change tracking**: Record reason, content, impact in comments for every modification.
- **Feature iteration**: Confirm business logic & directory architecture with user before generating.
- **Desktop UI**: LobeUI first, antd fallback.
- **Subserver code**: Must follow DDD (aggregate root, domain service, domain event).

---

## 7. Error Handling (Universal)

1. Never silently swallow errors.
2. Error messages must include context (operation name, key params, root cause).
3. Use typed error codes, never bare strings.
4. Log before propagating.
5. Station API errors → `ErrorResponse` proto format. Desktop Rust → `AppResult<T>`.
6. Client errors → user-friendly localized messages.

Error code ranges: `10000s` (business), `20000s` (protocol), `30000s` (content).

---

## 8. Verification Commands

| Platform | Commands |
|----------|----------|
| Desktop | `cd apps/desktop && pnpm run check && pnpm run test && pnpm run build` |
| Desktop (Tauri) | `cd apps/desktop && source ~/.cargo/env && CI=false pnpm run tauri:build` |
| Station | `cd apps/station && gofmt -l . && go test ./...` |
| Go Style | `./tooling/scripts/check-go-style.sh` |
| Android | `cd apps/mobile/android && ./gradlew build` |
| Proto | `./model/build.sh` (Go+Dart), `./tooling/scripts/proto-gen-mobile.sh` (Mobile) |

**Completion criteria**: Implementation complete + lint pass + build success + tests pass + functional verification.

---

## 9. Commit Rules

- Verify `.gitignore` coverage before every commit.
- Scan for leaked secrets: `git diff --cached | grep -iE '(secret|password|token|api_key|private_key)'`
- Always commit `.proto` source files; generated files may be gitignored.

---

## 10. Platform-Specific Rules

> **Load the relevant file when working on a specific platform.**

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
│  Proto build      →  ./model/build.sh                        │
│  Mobile proto     →  ./tooling/scripts/proto-gen-mobile.sh   │
│  Desktop dev      →  tooling/scripts/dev-desktop.sh          │
│  Desktop check    →  cd apps/desktop && pnpm run check       │
│  Station test     →  cd apps/station && go test ./...        │
├──────────────────────────────────────────────────────────────┤
│  NO console.log   │  NO println!    │  NO fmt.Println        │
│  NO print()       │  NO any type    │  NO manual models      │
│  NO mock APIs     │  NO hardcoded   │  NO silent error       │
│                   │    secrets       │    swallowing          │
└──────────────────────────────────────────────────────────────┘
```
