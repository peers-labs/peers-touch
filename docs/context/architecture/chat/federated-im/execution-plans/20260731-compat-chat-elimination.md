# Execution Plan: compat_chat Elimination & Unified Conversation API

> **Status**: ready-for-execution
> **Created**: 2026-07-31
> **Architecture source**: `docs/context/architecture/chat/federated-im/proposals/compat-chat-elimination.md`
> **Branch**: `feat/compat-chat-elimination` (to be created from current HEAD)
> **Predecessor**: `20260729-signal-level-chat-modernization.md` (F1/F3 work continues in parallel)

---

## 1. Architecture Traceability

| Plan requirement | Architecture source | Decision/Invariant |
|---|---|---|
| Add indexed Repository methods | §6 Repository Additions | D3: Indexed thread queries |
| Add DB migrations (thread index, read cursors, thread counters) | §6 Database migrations | D3 |
| Add new conversation subserver routes | §5 Target API Surface | D1: Delete compat_chat |
| Rewire BFF gateway commands | §7 BFF Rewire | D1, D2 |
| Client consumes CommittedConversationEvent directly | §8 Contracts | D2: Client consumes events |
| Delete compat_chat package | §3 Target Deletions | D1 |
| Denormalized thread counters (Slack pattern) | §0 Industry Reference, §6 | D3 |
| Server-side read cursors | §0 Industry Reference, §6 | Read cursor contract |

---

## 2. Current-State Inventory

| Asset | Path | Fate |
|-------|------|------|
| compat_chat subserver | `apps/station/app/subserver/compat_chat/` | **DELETE** |
| compat_chat routes (43) | `subserver.go` lines 84-178 | **DELETE** |
| friend_chat_handlers.go | 370 lines | **DELETE** |
| group_chat_handlers.go | 905 lines | **DELETE** |
| link_preview_handler.go | ~80 lines | **MOVE** to standalone utility |
| conversation subserver | `apps/station/app/subserver/conversation/` | **EXTEND** (new routes + repo methods) |
| conversation service.go | Service + Repository interfaces | **EXTEND** |
| conversation service_impl.go | DefaultService | **EXTEND** |
| conversation repository.go | PostgreSQL impl | **EXTEND** |
| conversation subserver.go | Route registration | **EXTEND** |
| BFF chat_storage.rs | `apps/desktop/src-tauri/src/application/chat_storage.rs` | **REWIRE** all functions |
| BFF http_gateway/mod.rs | Gateway command dispatch | **REWIRE** command handlers |
| BFF friend_chat.rs | Tauri commands | **REWIRE** → conversation API |
| BFF group_chat.rs | Tauri commands | **REWIRE** → conversation API |
| Client socialChat.ts | Store (loadMessages, loadThreadMessages, etc.) | **ADAPT** response parsing |
| Client imRuntime.ts | Realtime polling | Minor: remove compat assumptions |
| DB schema | `conversation_events` table | **EXTEND** (add index, new tables) |

---

## 3. Workstreams & Dependency Graph

```
W1: DB Migrations & Repository
     ↓
W2: Conversation Subserver Routes
     ↓
W3: BFF Rewire (chat_storage.rs + gateway)
     ↓
W4: Client Adaptation (response format)
     ↓
W5: Deletion & Cleanup
```

**Parallelizable**: W1 and W2 can be developed together (same Go module). W4 can begin in parallel with W3 once the new response contract is defined.

---

## 4. Workstream Details

### W1: DB Migrations & Repository Layer

**Scope**: Add tables, indexes, and Repository interface methods.

**Deliverables**:
| # | Deliverable | Files | Gate |
|---|---|---|---|
| W1.1 | Thread index migration | `apps/station/migrations/` (new file) | `EXPLAIN ANALYZE` shows index scan for thread query |
| W1.2 | Read cursors table migration | `apps/station/migrations/` | Table exists, CRUD works |
| W1.3 | Thread counters table migration | `apps/station/migrations/` | Table exists, CRUD works |
| W1.4 | Repository interface additions | `conversation/service.go` | Compiles, interface satisfied |
| W1.5 | Repository PostgreSQL implementation | `conversation/repository.go` | Unit tests pass for all new methods |

**Acceptance command**: `cd apps/station && go test ./app/subserver/conversation/...`

---

### W2: Conversation Subserver — New Routes

**Scope**: Add HTTP handlers that expose the new Repository capabilities.

**Deliverables**:
| # | Route | Method | Replaces |
|---|---|---|---|
| W2.1 | `/conversation/messages` | GET | `/friend-chat/messages`, `/group-chat/messages` |
| W2.2 | `/conversation/thread/messages` | GET | `/group-chat/thread/messages` |
| W2.3 | `/conversation/thread/counts` | POST | `/group-chat/thread/counts` |
| W2.4 | `/conversation/read-cursor` | POST | `/group-chat/mark-read` |
| W2.5 | `/conversation/unread` | GET | `/group-chat/unread-count` |
| W2.6 | `/conversation/member/settings` | GET/PUT | `/group-chat/my-settings`, `/group-chat/member/nickname` |

**Each route gate**: curl produces correct response with real data.

**Thread counter hook**: When `SubmitCommand` processes a `SendMessage` with `thread_root_message_id != ""`, call `repo.UpdateThreadCounter()` atomically in the same transaction.

**Acceptance command**: `cd apps/station && go test ./app/subserver/conversation/...`

---

### W3: BFF Rewire

**Scope**: Change every Rust function in `chat_storage.rs` to call the new `/conversation/*` endpoints instead of legacy `/friend-chat/*` and `/group-chat/*` paths.

**Deliverables**:
| # | BFF function | Current path | New path |
|---|---|---|---|
| W3.1 | `list_friend_sessions` | `GET /friend-chat/sessions` | `GET /conversation/list` |
| W3.2 | `list_friend_messages` | `GET /friend-chat/messages` | `GET /conversation/messages` |
| W3.3 | `send_friend_message` | `POST /friend-chat/message/send` | Already uses `/conversation/command` ✓ |
| W3.4 | `list_groups` | `GET /group-chat/list` | `GET /conversation/list` |
| W3.5 | `list_group_messages` | `GET /group-chat/messages` | `GET /conversation/messages` |
| W3.6 | `send_group_message` | `POST /group-chat/message/send` | Already uses `/conversation/command` ✓ |
| W3.7 | `group_thread_counts` | `POST /group-chat/thread/counts` | `POST /conversation/thread/counts` |
| W3.8 | `list_group_thread_messages` | `GET /group-chat/thread/messages` | `GET /conversation/thread/messages` |
| W3.9 | `group_info` | `GET /group-chat/info` | `GET /conversation/get` + `GET /conversation/members` |
| W3.10 | `group_members` | `GET /group-chat/members` | `GET /conversation/members` |
| W3.11 | `group_unread_count` | `GET /group-chat/unread-count` | `GET /conversation/unread` |
| W3.12 | `mark_group_read` | `POST /group-chat/mark-read` | `POST /conversation/read-cursor` |
| W3.13 | `group_settings` (get/put) | `GET/PUT /group-chat/my-settings` | `GET/PUT /conversation/member/settings` |
| W3.14 | `friend_settings` (get/put) | `GET/PUT /friend-chat/settings` | `GET/PUT /conversation/member/settings` |
| W3.15 | All remaining compat calls | Various recall/edit/delete paths | Already via `/conversation/command` ✓ |

**Gate per function**: Same request produces same response shape as before (diff test).

**Acceptance command**: `cd apps/desktop/src-tauri && cargo check`

---

### W4: Client Adaptation

**Scope**: The new `/conversation/messages` returns `CommittedConversationEvent[]` instead of `FriendChatMessage[]`/`GroupMessage[]`. The client must parse events into the existing projection types.

**Deliverables**:
| # | Deliverable | Files |
|---|---|---|
| W4.1 | Event-to-message projection utility | `apps/desktop/src/store/socialProjection.ts` |
| W4.2 | Update `loadMessages` to consume event response | `apps/desktop/src/store/socialChat.ts` |
| W4.3 | Update `loadThreadMessages` to consume event response | `apps/desktop/src/store/socialChat.ts` |
| W4.4 | Update session list to consume unified `/conversation/list` | `apps/desktop/src/store/socialChat.ts` |
| W4.5 | Wire real unread counts (no more stub) | `apps/desktop/src/store/socialChat.ts` |

**Gate**: Two-worktree E2E — send/receive DM, group create, group message, thread reply, unread badge updates.

---

### W5: Deletion & Cleanup

**Scope**: Remove all legacy code with zero remaining references.

**Deliverables**:
| # | Deliverable | Verification |
|---|---|---|
| W5.1 | Delete `apps/station/app/subserver/compat_chat/` directory | `find . -path "*compat_chat*"` → empty |
| W5.2 | Remove compat_chat registration from Station main | Station builds and starts without compat_chat |
| W5.3 | Move link_preview_handler to standalone utility | `/link-preview/fetch` still works |
| W5.4 | Remove old proto types (`FriendChatMessage`, `GroupMessage`) from client if unused | TypeScript builds clean |
| W5.5 | Delete legacy BFF functions that are no longer called | `cargo check` passes, no dead code warnings for these |
| W5.6 | `grep -r "friend-chat\|group-chat" apps/` → only test fixtures or docs | No live code references legacy paths |
| W5.7 | Migrate or delete acceptance gates that call removed `/friend-chat/*` Station routes | Acceptance gates use `/conversation/*` or the Desktop messaging gateway; tree search finds no executable legacy route calls |
| W5.8 | Normalize Station Go formatting after the cutover | `gofmt -l apps/station` returns no files and `./tooling/scripts/check-go-style.sh` passes |
| W5.9 | Audit dependency vulnerabilities and remove actionable findings within the approved dependency versions | Package-manager audit evidence records zero actionable findings, or each remaining finding is explicitly blocked on an approved version bump |

---

## 5. Atomic Cutover Matrix

| Concern | New source | Old source (deleted) | Cutover condition |
|---------|-----------|---------------------|-------------------|
| Message listing | `/conversation/messages` | `/friend-chat/messages`, `/group-chat/messages` | BFF calls new path; old handler unreachable |
| Session listing | `/conversation/list` | `/friend-chat/sessions`, `/group-chat/list` | Same |
| Thread messages | `/conversation/thread/messages` | `/group-chat/thread/messages` | Same |
| Thread counts | `/conversation/thread/counts` | `/group-chat/thread/counts` | Same |
| Unread | `/conversation/unread` | `/group-chat/unread-count` (stub) | Same |
| Read cursor | `/conversation/read-cursor` | `/group-chat/mark-read` (stub) | Same |
| Member settings | `/conversation/member/settings` | `/group-chat/my-settings`, `/group-chat/member/nickname` | Same |

Each row: once BFF is rewired (W3), the old path has zero callers → safe to delete (W5).

---

## 6. Final Readiness Gate

All must pass before marking the plan complete:

- [ ] `cd apps/station && go build ./app/...` — no compilation errors
- [ ] `cd apps/station && go test ./app/subserver/conversation/...` — all pass
- [ ] `cd apps/desktop/src-tauri && cargo check` — no errors
- [ ] `cd apps/desktop && pnpm run check` — TypeScript clean
- [ ] `find . -path "*compat_chat*"` — returns nothing
- [ ] `grep -r "friend-chat\|group-chat" apps/station/` — no handler code
- [ ] executable acceptance gates contain no `/friend-chat/*` Station route calls
- [ ] `gofmt -l apps/station` — no output
- [ ] `./tooling/scripts/check-go-style.sh` — passes
- [ ] dependency audit records current findings, patched versions, and any version-bump approval blockers
- [ ] Two-worktree E2E: DM send/receive, group create/send/receive, thread reply+count, unread badge
- [ ] `EXPLAIN ANALYZE` on thread query shows index scan, not seq scan

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Proto translation removal breaks client | Messages won't render | W4 builds the event→projection adapter; gate: E2E test |
| DB migration on production | Momentary lock | All migrations are CREATE INDEX CONCURRENTLY / CREATE TABLE (non-blocking) |
| Federation peers call legacy paths | 404 errors | Verified: federation uses `/conversation/*` directly; compat_chat was never federated |
| Thread counter desync | Wrong counts after crash | Counter is also verifiable via indexed COUNT query; reconciliation query available |

---

## Status: PLAN_READY_FOR_EXECUTION

Execution order: W1 → W2 → W3 → W4 → W5 (with W1+W2 parallelizable, W3+W4 partially parallelizable).

Estimated scope: ~15 files modified, ~3 new files, ~1300 lines deleted (compat_chat), ~600 lines added (repository + routes + client adapter).
