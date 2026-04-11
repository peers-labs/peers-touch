# Desktop (TypeScript + Rust) — Agent Platform Rules

> Load this file when working on `apps/desktop/`.
> Parent rules: [AGENTS.md](../../AGENTS.md)

---

## TypeScript / React Standards

| Rule | Detail |
|------|--------|
| Components | Function components only, no class components |
| Typing | TypeScript strict mode, **no `any`** |
| State | Zustand (`use<Feature>Store`) |
| UI Library | LobeUI first, antd as fallback |
| Exports | Named exports (except page/App entry) |
| Variables | `const` preferred, `let` when needed, **never `var`** |
| File naming | Components: PascalCase (`.tsx`), utils: camelCase (`.ts`) |

### Import Order

```typescript
// 1. React core
// 2. Third-party libs
// 3. Kernel / internal layer
// 4. Modules / business modules
// 5. Local files
```

### Logger

```typescript
import { log } from '@/utils/logger';

log.info('chat', 'conversation created', { sessionId: 'sess-123' });
log.error('auth', 'token refresh failed', { status: 401 });
```

**Forbidden**: `console.log`, `console.error`, `console.warn`, `console.debug`.

### Tag Conventions

| Tag | Scope |
|-----|-------|
| `app` | Global events (startup, crash, lifecycle) |
| `chat` | Conversations, messages |
| `store` | State management |
| `auth` | Authentication |
| `network` | HTTP requests |
| `applet` | Applet runtime |

---

## Rust (Tauri) Standards

| Rule | Detail |
|------|--------|
| Error handling | All commands return `AppResult<T>`, **never panic** |
| Error types | Use `thiserror` for custom errors |
| State | `Mutex<T>` wrapping `AppState`, via `tauri::State` |
| Proto types | Via prost `include!()` macro |

### DDD Layers

```
src-tauri/src/
├── domain/          # Entities, value objects, domain services
├── application/     # Use cases, command handlers
├── infrastructure/  # DB, network, filesystem
└── interface/       # Tauri commands, events
```

### Logger

```rust
tracing::info!(user_id = %id, "user logged in");
tracing::error!(?err, "failed to connect");
```

**Forbidden**: `println!`, `eprintln!`.

### Error Pattern

```rust
// Success
AppResult::success(data)

// Failure — never panic
AppResult::fail(ErrorCode::InvalidArgument, "name is required", None)
AppResult::fail(ErrorCode::InternalError, format!("db error: {}", err), None)
```

### TypeScript ↔ Rust Error Bridge

```
Rust AppResult<T>  →  Tauri IPC  →  TS RustCommandResult<T>
     ErrorCode          invoke()       RustErrorCode (string)
```

TS side: `invokeRustCommand<T>()` wraps all calls. Store/page layer uses try/catch.

---

## Verification

```bash
cd apps/desktop
pnpm run check        # Lint + typecheck
pnpm run test         # Unit tests
pnpm run build        # Production build
```

Tauri app verification:

```bash
source ~/.cargo/env
CI=false pnpm run tauri:build
```
