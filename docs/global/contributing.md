# Contributing to Peers-Touch

> How to understand, set up, and contribute code to the Peers-Touch project.
> For AI agents: this is the onboarding entry point. Read this before your
> first edit.

---

## 1. What Is Peers-Touch

A decentralized, federated social network framework. Three-tier architecture:

```text
Client  ->  Model  ->  Station
```

| Layer | What it is | Stack |
|-------|-----------|-------|
| **Station** | Shared business runtime | Go, DDD subservers, Hertz, PostgreSQL |
| **Desktop** | Desktop client | Tauri + React/TypeScript + Rust |
| **Mobile** | Mobile client | Tauri v2 Mobile + Web UI + Rust + native plugins |
| **Model** | Shared contracts | Protobuf (`model/domain/*.proto`) |

All data models are defined in proto first. Manual models are forbidden.

For the full project identity, read
[`docs/global/project-identity.md`](project-identity.md).

---

## 2. Repository Layout

```
peers-touch/
├── apps/
│   ├── desktop/           # Tauri + React/TS + Rust
│   ├── mobile/            # Tauri v2 Mobile
│   ├── station/           # Go backend (app/ + frame/)
├── model/domain/          # Proto definitions (single source of truth)
├── packages/              # applet-sdk, applets, locales
├── tooling/
│   ├── scripts/           # Build, dev, acceptance scripts
│   ├── skills/            # Agent skills (see §7)
│   └── make/              # Makefile includes
└── docs/
    ├── README.md          # How to find the right document
    ├── .agent/            # Agent entry: desktop.md, mobile.md, station.md
    ├── architecture/      # System boundaries, ownership, contracts
    ├── client/            # Platform implementation details
    ├── station/           # Station implementation details
    ├── global/            # Cross-platform standards (this file lives here)
    └── knowledge/         # Invariants, pitfalls, playbooks
```

---

## 3. Prerequisites

| Tool | Purpose |
|------|---------|
| Go (latest stable) | Station backend |
| Node.js + pnpm | Desktop web, tooling scripts |
| Rust + Cargo | Desktop/Mobile Tauri shell |
| protoc + plugins | Proto generation |
| PostgreSQL | Station database |
| Make | Unified command entry |

Run `make list` to see all available targets.

---

## 4. Getting Started

### 4.1 Clone and Set Up

```bash
git clone <repo-url> peers-touch
cd peers-touch
pnpm install
```

### 4.2 Quick Verification

```bash
# Station
cd apps/station && go test ./...

# Desktop web
cd apps/desktop && pnpm run check && pnpm run build

# Proto generation
./model/build.sh
```

### 4.3 Local Development

The project uses a profile-based local dev environment. Profiles define which
mode (local, compose, or remote), which host, ports, database, and runtime
parameters to use.

```bash
make profile <name>     # Create or switch profile
make station            # Start Station through the active profile
make desktop            # Start Desktop (Tauri app)
```

Full profile system documentation:
[`docs/global/local-dev-environment.md`](local-dev-environment.md).

---

## 5. What to Read Before Changing Code

### 5.1 Route by Question

| Question | Document |
|----------|----------|
| Why is the system designed this way? | `docs/architecture/` |
| How does this platform implement it? | `docs/client/desktop/`, `docs/client/mobile/`, `docs/station/` |
| What are the coding rules? | `docs/global/coding-guide/`, `docs/global/coding-standards.md` |
| What invariants apply to my file? | `docs/knowledge/invariants/` |
| What bugs have we already paid for? | `docs/knowledge/pitfalls/` |

### 5.2 Route by Platform

| Platform | Start here |
|----------|-----------|
| Desktop | `docs/.agent/desktop.md` → linked architecture and platform sources |
| Mobile | `docs/.agent/mobile.md` → linked sources |
| Station | `docs/.agent/station.md` → linked sources |
| Cross-platform | `docs/global/architecture.md`, `docs/global/domain-model.md` |

### 5.3 Document Hierarchy

Upper layers constrain lower layers. When two documents conflict, prefer the
higher layer:

1. **Architecture layer** — system boundaries, ownership, contracts
2. **Platform layer** — how a specific platform implements those decisions
3. **Specification layer** — coding conventions, API usage, testing rules
4. **Knowledge layer** — invariants, pitfalls, playbooks for specific paths

---

## 6. Development Workflow

Every change follows the same control flow, regardless of size:

```text
understand intent → bind worktree → declare intent → execute →
prove functional behavior → run acceptance → review → deliver → release
```

The single workflow standard lives at
[`docs/global/workflow.md`](workflow.md).

### 6.1 Key Commands

```bash
make dev-start WORK_ITEM=<id> PURPOSE='...' SOURCE_CLAIMS='...'
make dev-check WORK_ITEM=<id>
make workflow-snapshot
make acceptance-run
make review REVIEW_RANGE=<range>
make quality-evidence REVIEW_RANGE=<range>
```

### 6.2 Commit and PR

Commits follow Conventional Commits format. The project has a structured
commit skill (`pt-github-commit`) and PR skill (`pt-github-pr`).

```bash
# Secret scan before commit
git diff --cached | grep -iE '(secret|password|token|api_key|private_key)'
```

---

## 7. Working with AI Agents

Peers-Touch is designed for human + AI agent collaborative development.

### 7.1 For Humans Working with an Agent

- Tell the agent **which worktree** and **which task** you want to work on.
- The agent follows `AGENTS.md` as its behavioral contract — you don't need to
  repeat those rules.
- Say "continue" or "resume" to let the agent pick up tracked work.
- Say what you want in natural language; the agent routes to the right skill.
- Review the agent's plan before it executes large changes.

### 7.2 For Agents (Read This on Session Start)

1. Read `AGENTS.md` — your behavioral contract, iron laws, and stage dispatch.
2. Read `docs/.agent/<platform>.md` for the platform you're working on.
3. Read `docs/global/workflow.md` for the development control flow.
4. Check `docs/knowledge/` before editing any file — invariants and pitfalls
   that govern specific paths are listed there.
5. Use `tooling/skills/` — project skills are the canonical source.
   IDE-private directories must not hold project skills.

### 7.3 Available Skills

Skills live in `tooling/skills/<skill-name>/SKILL.md`. Key ones:

| Skill | When to use |
|-------|------------|
| `pt-god-view` | Entry point: status, resume, new work routing |
| `pt-dev-workflow` | Full development lifecycle |
| `pt-small-fix-discipline` | Single-file bug fixes |
| `pt-architecture-design-methodology` | New architecture decisions |
| `pt-acceptance-engineering` | Business domain acceptance |
| `pt-github-commit` / `pt-github-pr` | Commit and PR creation |
| `pt-local-dev-env` | Local environment setup |
| `pt-dev-runtime-handoff` | Launch dev runtime for testing |

---

## 8. Iron Laws (Summary)

These apply to all contributors, human or agent:

- **Proto first** — all data models in `model/domain/*.proto`
- **No debug statements** — use domain-specific loggers
- **No secrets in code** — environment variables only
- **No hardcoded UI strings** — use `packages/locales/` i18n
- **No mock APIs** — unless explicitly authorized
- **No unauthorized version bumps** — ask before bumping anything

Full list in [`AGENTS.md` §5](../../AGENTS.md).

---

## 9. Verification Checklist

Before submitting any change:

| Platform | Command |
|----------|---------|
| Desktop | `cd apps/desktop && pnpm run check && pnpm run test && pnpm run build` |
| Station | `cd apps/station && gofmt -l . && go test ./...` |
| Go style | `./tooling/scripts/check-go-style.sh` |
| Proto | `./model/build.sh` |

For formal acceptance: `make acceptance-run`.

---

## 10. Where to Ask for Help

- Start from `docs/README.md` to navigate the documentation.
- Check `docs/knowledge/` for known pitfalls before debugging.
- For agent sessions, invoke `pt-god-view` to get routed to the right workflow.
