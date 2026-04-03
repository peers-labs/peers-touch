# Peers Touch Desktop (Tauri)

## PREFACE

Desktop has been migrated to a Tauri architecture and is no longer Flutter-based.

Current stack:
- Frontend: React + TypeScript (`apps/desktop/src`)
- Desktop shell and command layer: Tauri + Rust (`apps/desktop/src-tauri/src`)
- API bridge: `apps/desktop/src/services/desktop_api.ts`

## Core Rules

1. App-first runtime:
   - Validate with `tauri:build` and native app launch.
   - Do not treat web-only runtime as the default acceptance path.

2. Layered architecture:
   - UI/store in TypeScript only.
   - Business command contracts in Rust `interface/contracts`.
   - Command handlers in Rust `interface/tauri_commands`.
   - Implementation in Rust `application/*`.

3. Single call path:
   - Prefer `invokeRustDataFromStatus(...)` for business APIs.
   - Keep direct HTTP/fetch only for explicit multipart/streaming exceptions.

4. Contract consistency:
   - TS input/output types must align with Rust contracts.
   - Command names must be registered in `src-tauri/src/main.rs`.

## Directory Baseline

```
apps/desktop/
├── src/
│   ├── pages/
│   ├── components/
│   ├── store/
│   └── services/desktop_api.ts
└── src-tauri/src/
    ├── interface/contracts/
    ├── interface/tauri_commands/
    ├── application/
    ├── domain/
    └── infrastructure/
```

## Delivery Checklist

Before claiming completion:

```bash
cd apps/desktop
pnpm run check
pnpm run test
pnpm run build
```

For app validation:

```bash
cd apps/desktop
source ~/.cargo/env
CI=false pnpm run tauri:build
```

## Notes

- This file supersedes old Flutter desktop guidance.
- Any prompt content that requires `client/desktop` or GetX should be considered outdated.
   flutter build macos --debug  # or your platform
   ```
   - Must complete without errors
   - Verify the build output exists

3. **Test Check** (if tests exist):
   ```bash
   cd client/desktop
   flutter test
   ```
   - All tests must pass
   - No skipped tests without justification

### Why This Matters

- **Lint**: Catches code style violations, potential bugs, and deprecated API usage
- **Build**: Ensures code compiles and all dependencies are resolved
- **Test**: Verifies functionality works as expected

### When to Run

- ✅ **After every feature implementation**
- ✅ **Before marking a task as complete**
- ✅ **Before committing code**
- ✅ **After fixing bugs**

### What to Do If Checks Fail

1. **Read the error message carefully**
2. **Fix the issue in your code**
3. **Re-run the check**
4. **Repeat until all checks pass**

**DO NOT**:
- ❌ Ignore lint warnings
- ❌ Comment out failing tests
- ❌ Commit code that doesn't compile
- ❌ Skip checks "because it works on my machine"

---

## 其它Prompt

其它非Base级的Prompt在 './PROMPTs' 目录下
