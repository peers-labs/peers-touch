# Social / Chat Product Closure Plan

> **Status**: active execution plan  
> **Version**: v0.1  
> **Created**: 2026-06-04  
> **Owner**: Social Runtime / Chat Productization  
> **Scope**: `apps/station/app/subserver/{friend_chat,group_chat,social}`, `apps/desktop/src`, `apps/mobile/src`, `model/domain`

---

## 1. Why This Document Exists

The project needs one executable source that answers three questions:

1. What should Desktop and Mobile social/chat become when the work is done?
2. Which design documents constrain the work?
3. What exact implementation path should an autonomous agent follow without stopping for piecemeal approval?

This document is that execution source. It complements the architecture documents under `docs/architecture/social-runtime/`; it does not replace proto, Station DDD, Desktop runtime projection, or Mobile runtime rules.

---

## 2. Source Documents

Read these before editing:

| Layer | Document | Why it matters |
| --- | --- | --- |
| Architecture | `docs/architecture/social-runtime/README.md` | Social runtime entry and cross-client boundary |
| Architecture | `docs/architecture/social-runtime/design.md` | Shared abstraction: API Gateway -> Wire -> Normalizer -> Projection -> Runtime -> Host Adapter -> UI |
| Architecture | `docs/architecture/social-runtime/integration.md` | Current Desktop/Mobile file mapping and convergence phases |
| Architecture | `docs/architecture/realtime/event-stream.md` | SSE event stream contract |
| Architecture | `docs/architecture/encryption/README.md` | Device-addressed direct encryption, MLS, delivery, and recovery |
| Architecture | `docs/architecture/social/moments.md` | Social audience and visibility rules |
| Desktop platform | `docs/client/desktop/runtime-projections.md` | Page / Runtime / Boot contracts; pages cannot own freshness |
| Station platform | `docs/.agent/station.md` | Station DDD and verification commands |
| Desktop platform | `docs/.agent/desktop.md` | Desktop TS/Rust constraints and verification |
| Mobile platform | `docs/.agent/mobile.md` | Mobile Tauri/Web constraints and verification |

If documents conflict, prefer higher-layer architecture documents. If implementation has already changed, update the source document in the same PR.

---

## 3. Final Product Shape

### 3.1 User-Visible Outcome

Desktop and Mobile must feel like two clients of the same IM/social product:

- A user can manage direct relationships, groups, chat preferences, and encrypted messaging from either client.
- Any state change made on one client converges on the other client through Station truth and realtime invalidation.
- Chat pages, contact pages, settings pages, group detail panels, message composer, unread badges, and notification surfaces all agree.
- There are no fake buttons, no disabled placeholders pretending to be done, no local-only social settings, and no page-refresh-only freshness fixes.
- Mobile follows the Peers-Touch square-rounded visual language used by Desktop, not a separate Telegram-style circular visual system.

### 3.2 System Shape

```text
Proto Contract
  -> Station Domain / Application / Repository
  -> Station HTTP + SSE Event
  -> Desktop Rust Bridge / Desktop Web API
  -> Mobile Tauri/Web API
  -> Normalizer
  -> Projection Reducer
  -> Projection Store
  -> Runtime Supervisor
  -> UI Renderer
```

Rules:

- Station is the business source of truth.
- Client state is a recoverable projection.
- Runtime owns freshness; pages render and dispatch commands only.
- Host-specific behavior is isolated in host adapters.
- Generated proto contracts are the source of transport truth.

---

## 4. Capability Domains

### 4.1 Group Admin

Final behavior:

- Desktop and Mobile support create group, group info, invite, join, leave, member list, remove member, promote admin, demote admin, mute member, unmute member, my group nickname, group settings, and realtime member refresh.
- Role semantics are fixed and must not regress:
  - `GROUP_ROLE_MEMBER = 1`
  - `GROUP_ROLE_ADMIN = 2`
  - `GROUP_ROLE_OWNER = 3`
- Owner can promote/demote admins.
- Admin can mute/unmute and remove ordinary members.
- Admin cannot manage owner or same-rank admins.
- Owner cannot be removed or demoted.
- Member changes emit realtime membership updates.
- Membership changes trigger group sender-key rotation/distribution where encryption requires it.

Implementation ownership:

| Layer | Owner |
| --- | --- |
| Proto | `model/domain/chat/group_chat.proto`, `model/domain/realtime/event.proto` |
| Station | `apps/station/app/subserver/group_chat/` |
| Desktop Rust | `apps/desktop/src-tauri/src/interface/tauri_commands/group_chat.rs` |
| Desktop Web | `apps/desktop/src/services/desktop_api.ts`, `apps/desktop/src/components/chat/ChatDetailPanel.tsx` |
| Mobile Web | `apps/mobile/src/features/group/`, `apps/mobile/src/pages/ChatPage.tsx` |
| Tests | Station application/handler tests, Desktop check, Mobile check, E2E group admin flow |

Current status:

- Role semantics, `UpdateMember`, promote/demote, mute/unmute, remove member are partially implemented.
- Still required: my group nickname UI parity, join/invite UX closure, sender-key rotation on membership changes, E2E.

### 4.2 Relationship Control

Final behavior:

- Block is a cross-social relationship rule, not a chat-only preference.
- Desktop and Mobile support block, unblock, list blocked users, and friendship status.
- Blocking affects:
  - direct message creation and sending,
  - existing conversation list visibility,
  - friend requests,
  - contact/profile actions,
  - follow/unfollow,
  - followers/following relationship views,
  - Moments/Timeline audience visibility.
- A blocked pair cannot use FOLLOWERS/CUSTOM/GROUP visibility as a backdoor.
- Relationship state is Station-backed and projected to clients.

Implementation ownership:

| Layer | Owner |
| --- | --- |
| Proto | `model/domain/chat/friend_chat.proto`, future relationship proto if block is lifted out of friend chat |
| Station relationship graph | `apps/station/app/subserver/social/application/relationship_service.go` |
| Station block graph | `apps/station/app/subserver/social/infrastructure/block_graph.go` |
| Friend chat block API | `apps/station/app/subserver/friend_chat/` |
| Desktop UI | Chat detail panel and Settings Account relationship section |
| Mobile UI | Contacts page, Chat action drawer, Settings blocked list |
| Tests | Block/follow/audience tests and client command tests |

Current status:

- Friend chat block/unblock/list/status exists.
- Desktop and Mobile have blocked-list management.
- Social follow/followers/following now begins to consume block graph.
- Still required: Moments/Timeline visibility block graph, search/profile action gating, possible relationship repository consolidation.

### 4.3 Conversation Appearance

Final behavior:

- Built-in chat backgrounds and user-selected local image backgrounds are controlled by Station conversation settings.
- Supported IDs:
  - `default`
  - `paper`
  - `mint`
  - `dusk`
  - `calm`
  - `graphite`
- Desktop and Mobile can change background for direct and group conversations.
- Desktop supports local image selection for conversation backgrounds through the real upload/storage chain, not URL entry.
- Changes sync cross-device through realtime invalidation.
- Invalid or unknown IDs normalize to `default`.
- Raw arbitrary background strings are not accepted; uploaded image references must be validated, persisted, and projected as typed conversation settings.

Implementation ownership:

| Layer | Owner |
| --- | --- |
| Proto | `friend_chat.proto`, `group_chat.proto`, `realtime/event.proto` |
| Station | friend/group conversation settings repos and handlers |
| Desktop | `socialChat` projection, `ChatDetailPanel`, `ChatMessageArea` |
| Mobile | `socialStore`, `groupStore`, `ChatPage`, `styles.css` |
| Tests | Settings update tests, realtime invalidation tests, client projection tests |

Current status:

- Basic Station-backed settings and dual-client rendering exist.
- Still required: automated tests proving cross-device sync, invalid value fallback, local image background upload/projection, and context-menu shortcut actions.

### 4.4 Encryption Upgrade

Final behavior:

- Double Ratchet is real, wired into message send/receive/edit, not a status label.
- Key exchange advertises device capabilities and supported encryption versions.
- Desktop and Mobile can establish DR sessions and recover state across restarts.
- Station accepts encrypted payloads only if version and required fields are sane.
- Legacy payloads are clearly versioned; data reset is allowed, history migration is not required.
- Group membership changes trigger sender key rotation/distribution.

Implementation ownership:

| Layer | Owner |
| --- | --- |
| Proto | `model/domain/key_exchange/key_exchange.proto`, chat encrypted message fields |
| Desktop Rust | `apps/desktop/src-tauri/src/domain/crypto/double_ratchet.rs` and send/receive bridges |
| Mobile Rust | `apps/mobile/src-tauri/src/domain/crypto/` new Double Ratchet module |
| Station | key exchange capability, payload sanity validation |
| Client UI | encryption state indicators only after real capability exists |
| Tests | Desktop/Mobile cross-device encrypted send/receive/edit/restart |

Current status:

- Desktop has Double Ratchet skeleton.
- Mobile does not yet have a DR module.
- Send/receive/edit are not fully wired.
- This is the largest remaining block and must be implemented as a domain closure, not as UI polish.

---

## 5. Execution Path

### Phase 0: Stabilize The Working Tree

Tasks:

- Run `git status --short`.
- Identify files already changed by prior work.
- Do not revert unrelated or user changes.
- Run targeted checks to get a known baseline.

Exit criteria:

- Current modified file list is understood.
- No destructive git commands have been used.

### Phase 1: Relationship Control Closure

Tasks:

1. Finish Station block graph integration for Moments/Timeline visibility.
2. Ensure FOLLOWERS/CUSTOM/GROUP audience checks reject blocked pairs.
3. Ensure search/profile/contact actions do not expose normal interactive actions for blocked pairs.
4. Add tests:
   - blocked viewer cannot read followers-only post,
   - blocked pair cannot follow,
   - blocked pair does not show as following/followed_by,
   - blocked pair is filtered from followers/following.
5. Decide and document whether block auto-unfollows or only hides/suppresses edges.

Exit criteria:

- Block semantics are consistent across chat, social relationship, and content visibility.
- Station tests cover the privacy boundary.
- Desktop/Mobile expose true blocked-list management.

### Phase 2: Group Admin Closure

Tasks:

1. Finish my group nickname parity on Desktop/Mobile.
2. Finish invite/join UX closure.
3. Add sender key rotation/distribution trigger after member add/remove and security-relevant role changes.
4. Add Station API-level tests for member update permissions.
5. Add client checks for group member action visibility.

Additional tasks from the Desktop group ownership / kick-out prototype:

6. Proto / Station command closure:
   - Ensure the proto contract explicitly supports owner/admin/member role projection, remove member, mute/unmute member, promote admin, demote admin, transfer ownership, leave group, dissolve group, and group profile update.
   - Enforce role policy in Station application services: owner can manage admins and members; admin can manage ordinary members only; members are read-only except leave/self settings.
   - Persist membership mutation audit data needed for reconciliation and debugging.
7. Station realtime and encryption side effects:
   - Emit membership/profile events after kick, mute, role change, ownership transfer, leave, dissolve, invite, and join.
   - Trigger sender-key rotation/distribution after member removal, member addition, ownership transfer, and role changes that affect management capability.
   - Define the dissolved-group tombstone behavior so clients stop sending and hide/mark conversations consistently.
   - Add an explicit `/app-meta/version` metadata probe so remote gates can fail fast when the Station deployment is not built from the expected commit or build label.
8. Desktop Rust / Web API bridge:
   - Add typed Tauri commands and `desktop_api.ts` methods for kick, mute/unmute, promote/demote admin, transfer ownership, leave, dissolve, invite/join, group profile/avatar update, and member refresh.
   - Keep all commands Station-backed; no UI-only member mutation.
   - Normalize Station errors into user-safe client errors such as permission denied, group dissolved, member not found, and stale role.
9. Desktop UI implementation:
   - Port the approved prototype into `ChatDetailPanel`: permission summary, owner/admin/member visibility, member management overlay, kick confirmation, transfer confirmation, dissolve/leave confirmation, locked member controls, local avatar picker, and local background picker.
   - Wire group name/avatar updates to real APIs and refresh group projection after success.
   - Use locales for all user-facing strings and remove no-op/stub actions.
10. Mobile parity:
   - Implement the same owner/admin/member policy and available actions in Mobile group detail.
   - Keep Mobile visual shape consistent with the shared social UI identity while adapting the interaction surface to mobile.
   - Confirm Mobile receives the same realtime member/profile refresh events as Desktop.
11. Verification / E2E:
   - Add Station permission matrix tests for owner/admin/member actions.
   - Add Station handler tests proving create-with-initial-members projects the creator as owner and de-dupes ordinary initial members.
   - Add client visibility tests for owner/admin/member action surfaces.
   - Add E2E/manual acceptance script covering owner kick, admin kick ordinary member, admin cannot manage admin/owner, member read-only, ownership transfer, leave group, dissolve group, and realtime refresh on another client.
   - Keep `tooling/acceptance/gates/chat/group_admin_e2e.py` local-current-worktree by default; remote runs must set `CHAT_GROUP_ADMIN_STATION_URL` explicitly so stale deployments are not mistaken for current evidence.
   - Add regression for sender-key rotation after kick/transfer so removed members cannot decrypt new group messages.
   - Keep the executable Desktop acceptance script at `docs/architecture/social-runtime/execution-plans/20260624-group-admin-desktop-e2e.md` and update it whenever the P2 flow changes.
   - Add Desktop runtime automation or a semi-automated harness for the owner/admin/member UI flow; the current HTTP gate is necessary but not sufficient.
   - Capture real Desktop multi-client evidence for realtime refresh and sender-key rotation/decryption behavior after kick and ownership transfer.

Exit criteria:

- Desktop/Mobile have the same real group admin actions.
- Role policy is enforced by Station, not by UI only.
- Current-worktree Station HTTP gate passes before Desktop manual E2E is reported complete.
- Group membership events refresh both clients.
- Remote Station gates either pass against a verified current deployment or are explicitly blocked with version/deployment evidence.
- The approved Desktop prototype behavior is represented by real Station-backed actions, not only local UI state.

### Phase 3: Conversation Appearance Closure

Tasks:

1. Add Station tests for friend and group background normalization.
2. Add realtime invalidation tests for `ConversationSettingsChanged`.
3. Add Desktop/Mobile projection tests if test harness exists; otherwise add documented manual E2E script.
4. Implement/verify local image background upload for Desktop group/direct conversations through the real storage chain, with preview, persistence, cross-device projection, and failure rollback.
5. Implement/verify conversation right-click shortcut actions (`pin`, `mute`, `delete`/clear) against real Station-backed settings or mutation APIs.
6. Add visual alignment regression or acceptance evidence for chat header/detail header alignment, avatar/name editing, and detail panel layout.

Exit criteria:

- Background changes persist in Station.
- Both clients refresh through projection.
- Invalid background IDs cannot leak into UI.
- Local image backgrounds are selected from disk, stored through the sanctioned upload chain, and never entered as raw URLs.
- Conversation shortcut actions mutate real settings/state and are not UI-only toggles.

### Phase 4: Encryption Upgrade Closure

Tasks:

1. Extend key exchange proto for capability negotiation.
2. Generate proto for Station/Desktop/Mobile.
3. Implement Station capability storage and fetch.
4. Wire Desktop Double Ratchet into friend send/receive/edit.
5. Implement Mobile Double Ratchet module with equivalent state machine.
6. Add secure local state persistence for DR state on both clients.
7. Add Station encrypted payload sanity checks.
8. Add E2E:
   - Desktop -> Mobile encrypted message,
   - Mobile -> Desktop encrypted message,
   - edit under DR uses fresh key,
   - restart restores ratchet state,
   - offline catch-up decrypts.

Exit criteria:

- Encryption upgrade is functional and testable.
- No fake encryption UI remains.

### Phase 5: Full Verification

Tasks:

- Run all verification commands in Section 8.
- Fix failures.
- Review UI for no-op/stub actions.
- Review locales for hardcoded user-facing strings.
- Add a one-command release gate that runs proto generation checks, Station Go tests, Station HTTP gates, Desktop checks/focused tests, Mobile checks, and Rust bridge checks where available.
- Add repeatable performance profiling or benchmark scripts for conversation switching latency.
- Generate a verification evidence bundle with command output, screenshots/log references, known blocked items, and residual risks.
- Produce final delivery report.

Exit criteria:

- All checks pass or failures are explicitly documented as pre-existing with evidence.
- User receives one complete acceptance report, not piecemeal validation requests.

---

## 6. Non-Negotiable Implementation Rules

- No mock APIs unless the user explicitly asks for mock.
- No fake button, no no-op action, no local-only business truth.
- No hardcoded user-facing strings; use `packages/locales`.
- No debug prints: no `console.log`, `fmt.Println`, `println!`, `print`.
- No manual parallel models when proto is the source of truth.
- No generated-file source edits; change proto source then regenerate.
- No page-owned freshness for Desktop/Mobile social runtime.
- Do not reintroduce Flutter / Dart as an active implementation path.
- Do not ask the user to validate every small step; self-verify and deliver a complete report.

---

## 7. Definition Of Done

The work is done only when all of the following are true:

- Group admin, relationship control, conversation appearance, and encryption upgrade have real Desktop and Mobile entry points.
- Station/proto is the source of truth for all four domains.
- Realtime or targeted reconcile closes cross-device freshness.
- Desktop and Mobile represent the same state for chat list, contacts, settings, group detail, unread badges, message composer, and notification surfaces.
- Station tests cover relationship/block, group admin, conversation settings, and encryption validation.
- Desktop and Mobile checks pass.
- No no-op/stub/fake UI remains.
- No user-facing hardcoded strings remain.
- Final report includes:
  - what changed,
  - what tests ran,
  - what risks remain,
  - how to perform acceptance.

---

## 8. Required Verification Commands

Run from repository root unless noted.

```bash
/usr/bin/env PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ./model/build.sh
/usr/bin/env PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ./tooling/scripts/proto-gen-mobile.sh web
cd apps/station/app && /usr/bin/env PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin go test ./...
/usr/bin/env PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin pnpm --dir apps/desktop run check
/usr/bin/env PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin pnpm --dir apps/desktop run test
/usr/bin/env PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin pnpm --dir apps/mobile run check:web
source "$HOME/.cargo/env" && /usr/bin/env PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
/usr/bin/env PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin git diff --check
```

If a command cannot run because of local environment, record the exact command, output, and substitute evidence.

---

## 9. Handoff Prompt For A Long-Running AI

Use this prompt when delegating:

```text
You are continuing Peers-Touch social/chat product closure.

Read first:
- docs/architecture/social-runtime/README.md
- docs/architecture/social-runtime/design.md
- docs/architecture/social-runtime/integration.md
- docs/architecture/social-runtime/execution-plans/20260604-social-chat-product-closure.md
- docs/architecture/encryption/README.md
- docs/client/desktop/runtime-projections.md
- docs/.agent/station.md
- docs/.agent/desktop.md
- docs/.agent/mobile.md

Goal:
Deliver Desktop/Mobile social and chat parity as a Station-backed product closure, not piecemeal UI patches.

Required domains:
1. Group Admin
2. Relationship Control
3. Conversation Appearance
4. Encryption Upgrade

Rules:
- Station/proto is truth.
- Desktop/Mobile are projections.
- Runtime owns freshness.
- No mock, no no-op, no fake button, no hardcoded user-facing strings.
- Do not ask the user to validate each small step.
- Implement, test, self-review, and provide one final acceptance report.

Start with Phase 1 in the execution plan unless current code shows it is already complete.
```
