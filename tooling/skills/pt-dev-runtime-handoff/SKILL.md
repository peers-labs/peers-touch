---
name: pt-dev-runtime-handoff
description: >
  Use after code changes when the user wants to prepare a dev runtime and run
  acceptance testing. Guides profile-based startup, restart decisions, and
  execution of Playwright-based acceptance specs against the native Tauri app.
---

# Dev Runtime Handoff

> **Source of truth for environment spec**: `docs/global/local-dev-environment.md`
> This skill defines behavior (when to restart, what to run, how to test).

## Goal

After finishing code, the agent:
1. Prepares the dev runtime (start/restart services).
2. Runs **standardized Playwright acceptance specs** against the native Tauri
   WebView via `@srsholmes/tauri-playwright`.
3. Reports structured results with evidence.

The user does NOT click anything. The agent does NOT guess pixel coordinates.

## Prerequisites

1. A profile must be active (`pt-local-dev-env` applied).
2. For dual-client acceptance, the user MUST provide:
   - Two worktree paths (e.g. `peers-chat-high-chat`, `peers-group-chat`)
   - Profile name (e.g. `two`)
   - Target module (e.g. `chat`, `contacts`, `notifications`)
3. If any prerequisite is missing, **STOP and ask**. Do NOT assume or proceed.

---

## Module Injection Protocol

When adding acceptance for a new module, the agent MUST provide:

1. **`<module>.contract.ts`** — Declares: depends, setup (human-readable), entryRoute,
   readySelector, and the full verification matrix.
2. **`<module>.spec.ts`** — Implements: setup in `beforeAll`, each matrix point as a
   `test()`, using helpers from `helpers.ts`.
3. **Update to `helpers.ts`** — If the module needs shared utilities not yet present
   (e.g. a new gateway command wrapper), add them to helpers.

**Structure of every spec file**:
```ts
import { test, expect } from '../fixtures';
import { MODULE_CONTRACT } from './<module>.contract';
import { login, waitForAuth, ... } from './helpers';

test.describe(MODULE_CONTRACT.module, () => {
  test.beforeAll(async ({ tauriPage }) => {
    // 1. Run depends: ensure auth (and other dependencies) are set up
    // 2. Module-specific setup: create data, navigate to entryRoute
  });

  // One test per matrix entry
  test(MODULE_CONTRACT.matrix[N].name, async ({ tauriPage }) => {
    // Implement action + assert passCondition
  });
});
```

**Rules**:
- Contract matrix is the single source of "what gets tested". If it's not in the
  matrix, it doesn't get a test. If it needs a test, add it to the matrix first.
- Helpers must be idempotent — calling `login()` when already logged in is a no-op.
- Specs must be independently runnable: `pnpm exec playwright test e2e/acceptance/chat.spec.ts`
- Never hardcode ports/URLs — always read from env vars via helpers.

---

## Acceptance Testing Method

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  WebdriverIO Test Runner (npx wdio run wdio.conf.ts)│
│    ↕ WebDriver protocol (port 4444)                 │
│  tauri-driver (cargo install tauri-driver)           │
│    ↕ native WebView bridge                          │
│  Tauri Native App (make desktop)                    │
│    ↕ Tauri IPC                                      │
│  Rust BFF (gateway, messaging, storage)             │
│    ↕ HTTP                                           │
│  Station (remote or local)                          │
└─────────────────────────────────────────────────────┘
```

### How It Works

1. `make desktop` starts the native Tauri app.
2. `tauri-driver` starts a WebDriver server connected to the app's WebView.
3. WebdriverIO connects to the WebDriver server and drives DOM interactions.
4. Specs also call the HTTP gateway directly for backend operations.
5. Both combined = full E2E covering UI + backend.

### Spec Location (Fixed Paths)

```
apps/desktop/e2e/
├── acceptance/                    # Module acceptance specs
│   ├── chat.spec.ts              # Chat module: login, send, receive, multi-round
│   ├── contacts.spec.ts          # Contacts: add, search, block, presence
│   ├── notifications.spec.ts     # Badges, push, realtime updates
│   ├── group-chat.spec.ts        # Group: create, invite, messaging
│   └── ...
├── accounts.ts                   # Standard test accounts (SINGLE SOURCE)
├── fixtures.ts                   # tauri-playwright connection config
├── dual-client.fixtures.ts       # Dual-client fixtures (two sockets)
├── playwright.config.ts          # Playwright config
└── tests/                        # Performance specs (existing)
```

### Standard Test Accounts (`accounts.ts`)

All acceptance specs use these accounts. Never invent new credentials.

```ts
export const TEST_ACCOUNTS = {
  alice: {
    email: 'alice@p.t',
    password: 'Test1234!',
    name: 'Alice two',
    role: 'primary-sender',
  },
  bob: {
    email: 'bob@p.t',
    password: 'Test1234!',
    name: 'Bob two',
    role: 'primary-receiver',
  },
  carol: {
    email: 'carol@p.t',
    password: 'Test1234!',
    name: 'Carol two',
    role: 'group-member',
  },
} as const;
```

### Connection Method

Each Tauri app (started via `make desktop`) exposes a Playwright MCP socket.
The socket path is deterministic per worktree:

```
/tmp/tauri-playwright-<worktree-name>.sock
```

For dual-client tests, two sockets are available simultaneously:
- Socket A: `/tmp/tauri-playwright-peers-chat-high-chat.sock`
- Socket B: `/tmp/tauri-playwright-peers-group-chat.sock`

### How The Agent Runs Acceptance

```bash
# Single client
cd <worktree> && pnpm exec playwright test e2e/acceptance/<module>.spec.ts

# Dual client (both worktrees must be running)
cd <worktree-A> && PEER_SOCKET=/tmp/tauri-playwright-<worktree-B>.sock \
  pnpm exec playwright test e2e/acceptance/<module>.spec.ts
```

The agent MUST:
1. Ensure both `make desktop` instances are running and healthy.
2. Verify gateway ports respond (`curl -s localhost:<port>/api/gateway`).
3. Run the spec file — NOT ad-hoc curl commands, NOT pixel clicking.
4. Read the Playwright JSON report from `tooling/acceptance/reports/`.
5. Report results using the template below.

---

## Entry Points (Profile System)

All commands from the repository root:

```bash
# Core dev commands
make station                # Start/verify Station
make desktop                # Desktop Tauri app (native)
make desktop-web            # Desktop in browser (debugging only)
make mobile                 # Mobile iOS Simulator

# Lifecycle
make status                 # Show running services
make stop                   # Stop all
make restart                # Restart all
make station-restart        # Restart Station only
make desktop-restart        # Restart Desktop only
```

Docker remote variants:

```bash
make docker-station REMOTE=pt-station-1
make docker-station REMOTE=pt-station-2
make docker-relay REMOTE=pt-relay
```

## Runtime Selection

- `make desktop`: single native Tauri app verification.
- `make desktop-web`: browser-mode (debugging only, NOT for acceptance).
- **Dual-client acceptance**: `make desktop` in **two separate worktrees**.
- `make station`: Station code changed, local mode.
- `make mobile`: Mobile iOS verification.

### Dual-Client Setup (Two Worktrees)

Each worktree produces an independent Tauri app with a unique bundle identifier,
allowing macOS to run both simultaneously.

```
Worktree A (e.g. peers-chat-high-chat):
  cd <worktree-A-path> && make desktop
  → Gateway: PT_DESKTOP_APP_GATEWAY_PORT from profile
  → Socket: /tmp/tauri-playwright-peers-chat-high-chat.sock

Worktree B (e.g. peers-group-chat):
  cd <worktree-B-path> && make desktop
  → Gateway: PT_DESKTOP_APP_GATEWAY_PORT from profile (different port)
  → Socket: /tmp/tauri-playwright-peers-group-chat.sock
```

Both share the same Station. Each has its own Rust BFF, Vite, and storage.

---

## Restart And Deploy Decisions

### Station

Restart when changes touch:
- `apps/station/**`
- `model/domain/**` plus regenerated proto output
- database models, migrations, auth, SSE/realtime, notification, chat, federation

Use: `make station-restart` or `make docker-station REMOTE=<ctx>`

### Desktop Rust BFF / Tauri

Restart when changes touch:
- `apps/desktop/src-tauri/**`
- Tauri command signatures, gateway, auth, event stream, storage

Use: `make desktop-restart`

### Desktop Web

For `apps/desktop/src/**` UI changes, rely on Vite HMR first.
Use `make desktop-restart` if HMR is insufficient.

### Proto

Run `make model-gen` before runtime verification, then restart affected services.

---

## Dev Handoff Workflow

1. Check what changed (Station, Desktop Rust, Desktop Web, proto).
2. Decide restart scope.
3. If remote deploy needed and uncommitted changes exist, commit first.
4. Start/deploy with `make`, not direct scripts.
5. Wait until gateway ports respond.
6. **Run acceptance spec**: `pnpm exec playwright test e2e/acceptance/<module>.spec.ts`
7. Read report from `tooling/acceptance/reports/`.
8. Report results to user.

---

## Dual Client Acceptance

**Required inputs** (agent must ask if missing):
- Worktree A path (account A)
- Worktree B path (account B)
- Profile name
- Target module

**Execution**:
1. `make desktop` in both worktrees (background).
2. Wait for both gateways to respond.
3. Run the dual-client spec from worktree A with `PEER_SOCKET` pointing to B.
4. Collect results.

### Verification Criteria (Chat Module)

1. A sends message to B; B sees it without manual refresh.
2. Chat badge updates immediately when B is not viewing the conversation.
3. Badge clears when B views the conversation.
4. Typing indicator appears and clears after idle/send/blur.
5. Multi-round messaging is stable (no state drift).
6. Presence updates without page remount.

### Failure Inspection Order

1. Station logs (`make status` shows log path).
2. Rust BFF event stream and Tauri event names.
3. `eventStream.ts` protobuf frame decode.
4. Runtime owner (`socialRealtime`, `notification`, `navigationBadges`).
5. Store projection.
6. Component rendering.

Do not patch page-level `useEffect` as the primary fix. The owning runtime must
consume events and reconcile.

---

## Reporting Template

```markdown
Acceptance test results:
- Profile: <name>
- Worktrees: <A (account)> + <B (account)>
- Module: <target module>
- Spec file: apps/desktop/e2e/acceptance/<module>.spec.ts
- Runtime: make desktop × 2 worktrees
- Results:
  | Test Case | Result | Duration |
  |-----------|--------|----------|
  | ... | PASS/FAIL | Xms |
- Failures: <details with root cause>
- Evidence: tooling/acceptance/reports/<module>-<timestamp>.json
- Open risk: <if any>
```

---

## What This Skill Does NOT Do

- Does NOT use Computer Use / pixel coordinate guessing.
- Does NOT open a browser to test (unless `make desktop-web` mode explicitly).
- Does NOT invent test accounts — uses `apps/desktop/e2e/accounts.ts` only.
- Does NOT run ad-hoc curl commands as "acceptance" — runs spec files.
- Does NOT claim acceptance passed without a Playwright report artifact.
