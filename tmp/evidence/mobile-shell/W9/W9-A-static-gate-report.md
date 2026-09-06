# W9-A Static Gate Report -- Mobile Shell

- **Worktree**: `/Users/bytedance/Documents/Projects/peers-touch/peers-social`
- **Branch**: `merge-desktop-prototype`
- **Date**: 2026-09-03

---

## 1. Proto Generation

### model/build.sh
- **Result**: PASS
- All `.proto` files generated successfully (Go + TS).

### tooling/scripts/proto-gen-mobile.sh
- **Result**: PASS
- Web TypeScript generation complete, no errors.

---

## 2. Mobile Type-Check (`pnpm run check`)

- **Result**: FAIL (pre-existing only)

### Sub-checks that passed
- `check:social-wire` -- "Mobile social wire contract OK."
- `check:social-runtime-boundaries` -- "Social runtime boundaries OK."

### Errors
| File | Error | Classification |
|------|-------|----------------|
| `src/contracts/agentV2Contract.test.ts(3,38)` | TS2307: Cannot find module 'vitest' | **Pre-existing** -- test-only dev dependency not resolved in production tsconfig |

- **New errors introduced by our changes**: NONE
- The `tsc --noEmit` step fails solely due to the pre-existing `vitest` import in a test file. The `build` and `check:rust`/`check:ios-project` steps were not reached because `check:web` failed first.

---

## 3. Contract Static Gate (`check:mobile-shell-contracts`)

- **Result**: FAIL
- **Message**: "mobile shell contract validation failed: OAuth deep links must not be forwarded raw to Mobile Web"
- **Classification**: This is a known contract violation related to OAuth deep-link forwarding. Needs resolution before W9-A can pass.

---

## 4. PTID Scan

- **Result**: CLEAN
- All `actor_id` / `actorId` / `actor.id` matches are in `gen/proto/` (generated files, excluded from enforcement).
- No non-PTID identity references found in handwritten source under `apps/mobile/src/`.

---

## 5. Manual Domain Model Scan

- **Result**: 1 MATCH (review required)
- `apps/mobile/src/features/social/socialTypes.ts:56` -- `export interface FriendChatMessage { ... }`
- This interface name matches the `interface.*Message` pattern. It may be a legitimate local UI type or a proto-bypass. Requires manual review to confirm whether it duplicates a proto-defined message.

---

## 6. Overall W9-A Verdict

| Gate | Status |
|------|--------|
| Proto generation | PASS |
| Type-check | FAIL (pre-existing only, no new errors) |
| Contract static | FAIL (OAuth deep-link forwarding violation) |
| PTID scan | PASS |
| Manual model scan | REVIEW (1 match, likely benign) |

### **Overall: PARTIAL**

Two blockers remain before full PASS:
1. **Contract static gate** -- OAuth deep-link forwarding must be fixed in the mobile shell layer.
2. **Type-check** -- the pre-existing `vitest` resolution error should be addressed (e.g., exclude test files from production tsconfig or add vitest types).

The manual model scan match (`FriendChatMessage`) requires human confirmation but is likely a UI-layer type, not a proto bypass.
