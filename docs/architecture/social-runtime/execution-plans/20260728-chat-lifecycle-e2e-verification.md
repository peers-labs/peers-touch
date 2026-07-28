# Chat Lifecycle E2E Verification — Execution Plan

> **Status**: approved — executing
> **Created**: 2026-07-28
> **Owner**: Social Runtime / Chat Productization
> **Branch**: `feat/group-detail-history-ux-pr` (peers-chat-high-chat worktree)
> **Scope**: E2E verification of existing chat infrastructure across two Desktop clients
> **Parent**: `20260604-social-chat-product-closure.md`

---

## 1. Situation Assessment

### Finding: No Merge Required

Auditing `peers-group-chat` vs `peers-chat-high-chat` reveals **both worktrees are already code-identical** in all chat-related layers:

| Layer | Diff (lines) | Verdict |
|-------|:---:|---------|
| Station conversation subserver | 0 | Identical |
| Station envelope subserver | 0 | Identical |
| Station events subserver | 0 | Identical |
| Station social subserver | +491 (friend request addition) | peers-chat-high-chat is AHEAD |
| Desktop group_chat.rs | 0 | Identical |
| Desktop friend_chat.rs | -8 (URL rewire) | peers-chat-high-chat is AHEAD |
| Desktop crypto.rs / mls.rs | 0 | Identical |
| Desktop conversation.rs | 0 | Identical |
| Desktop socialChat.ts store | 0 | Identical |
| Desktop desktop_api.ts | 11 (trivial federation line) | Negligible |

### Root Cause of Prior Failure

The only broken feature was **friend request** — caused by commit `82cdb299` deleting the `friend_chat` subserver without porting friend request handlers to `social`. This has been fixed in commit `4394dd30`.

All other features (DM messaging, group creation, group messaging, group admin, block, encryption) have working Station endpoints and Desktop command surfaces. They may have **UI gaps or runtime bugs** but the backend pipeline is intact.

---

## 2. Verification Strategy

### Test Infrastructure

| Resource | Config |
|----------|--------|
| Station Three | 10.37.94.156:18080 (deployed from this worktree) |
| Desktop A | This worktree (`make desktop` profile=three, ports 3230/3410) |
| Desktop B | peers-group-chat worktree (already running, ports 3231/3411 or 3288) |
| User A | Account on Station Three |
| User B | Second account on Station Three |

### Feature Verification Matrix

Each feature below must be tested E2E with evidence (HTTP response code + UI state observed).

#### Feature 1: Friend Request
| Step | Action | Expected | Pass? |
|------|--------|----------|-------|
| 1.1 | User A: Search → Find User B | User B appears in results | |
| 1.2 | User A: Click "Send Request" | Button → "Awaiting approval" | |
| 1.3 | Station: verify `friend_chat_friend_requests` row created | status=1 (pending) | |
| 1.4 | User B: List friend requests | Shows User A's request | |
| 1.5 | User B: Accept | Request marked accepted, mutual follow edges created | |
| 1.6 | Verify follow graph | Both users follow each other | |

#### Feature 2: Friend Chat (DM)
| Step | Action | Expected | Pass? |
|------|--------|----------|-------|
| 2.1 | User A: Create direct conversation with User B | Session created (create_direct gate passes) | |
| 2.2 | User A: Send text message | Message appears in conversation | |
| 2.3 | User B: Receives message via SSE | Message rendered in real-time | |
| 2.4 | User B: Reply | User A receives reply | |
| 2.5 | Message recall | Recalled message shows tombstone | |
| 2.6 | Message edit | Edited content visible to both | |

#### Feature 3: Group Chat
| Step | Action | Expected | Pass? |
|------|--------|----------|-------|
| 3.1 | User A: Create group with User B | Group created, both are members | |
| 3.2 | User A: Send message in group | Message visible to User B | |
| 3.3 | User B: Reply in group | Message visible to User A | |
| 3.4 | Group message recall | Tombstone visible to all members | |
| 3.5 | Group message edit | Edited content visible to all | |

#### Feature 4: Group Admin (leave/remove/block)
| Step | Action | Expected | Pass? |
|------|--------|----------|-------|
| 4.1 | User A (owner): Remove User B | User B removed, member list updated | |
| 4.2 | User A: Re-invite User B | User B added back | |
| 4.3 | User B: Leave group | User B no longer in member list | |
| 4.4 | User A: Block User B | Block graph updated | |
| 4.5 | Verify blocked user cannot send friend request | Returns blocked error | |

#### Feature 5: Profile Updates
| Step | Action | Expected | Pass? |
|------|--------|----------|-------|
| 5.1 | User A: Update group name | New name visible to User B | |
| 5.2 | User A: Update group nickname | Nickname shows in member list | |
| 5.3 | Verify display name in friend request list | Enriched profile data present | |

#### Feature 6: Supporting Features
| Step | Action | Expected | Pass? |
|------|--------|----------|-------|
| 6.1 | Typing indicator | User B sees "typing..." when User A types | |
| 6.2 | Read receipts | Ack updates message status | |
| 6.3 | Unread badge | Badge count reflects unread messages | |
| 6.4 | Offline messages | Messages delivered after reconnect | |
| 6.5 | Conversation settings (mute/pin/background) | Settings persist and sync | |

---

## 3. Execution Steps

### Step 1: Setup Test Accounts
- Ensure two user accounts exist on Station Three
- Both Desktop clients authenticated and connected

### Step 2: Feature 1 (Friend Request) — Verify
- Execute test matrix 1.1–1.6
- This validates the fix from commit `4394dd30`

### Step 3: Feature 2 (Friend Chat) — Verify
- Execute test matrix 2.1–2.6
- Requires Feature 1 to pass (mutual follow unlocks create_direct)

### Step 4: Feature 3 (Group Chat) — Verify
- Execute test matrix 3.1–3.5

### Step 5: Feature 4 (Group Admin) — Verify
- Execute test matrix 4.1–4.5

### Step 6: Feature 5 (Profile Updates) — Verify
- Execute test matrix 5.1–5.3

### Step 7: Feature 6 (Supporting) — Verify
- Execute test matrix 6.1–6.5

### Step 8: Fix any failures found
- For each failure: diagnose root cause → fix → re-verify
- Fixes are surgical (not speculative refactoring)

### Step 9: Final Report
- Fill in all Pass/Fail results
- Document any features that cannot pass with explanation

---

## 4. Exit Criteria

- All Feature 1–3 steps pass (friend request + DM + group chat are the core lifecycle)
- Feature 4–6 steps pass OR have documented blockers with root cause
- Desktop A and Desktop B both demonstrate the same features
- No "station request failed" errors for any wired endpoint

---

## 5. Dependencies

- Station Three deployed with friend request fix (DONE: commit `4394dd30`)
- Desktop app builds successfully with URL rewire (DONE)
- Two user accounts on Station Three (to verify)

---

## 6. Non-Goals

- Mobile client verification (out of scope — Desktop only)
- Double Ratchet / E2EE wire-level verification (encryption is a separate domain closure)
- Federation cross-station testing (single-station only)
- UI polish / pixel-level design review
