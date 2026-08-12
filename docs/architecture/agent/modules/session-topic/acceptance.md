# Module 6: Session & Topic — Acceptance Scenarios

> Paired with `peers-design.md`. Defines verifiable acceptance criteria for the P0 scope.
>
> Last updated: 2026-08-12

---

## Scope

These scenarios cover the P0 deliverables:
1. Existing session/topic lifecycle (must not regress)
2. Topic pinning and favorites
3. Topic sidebar search (title + content)
4. Auto-rename display and undo
5. Optimistic topic creation (existing, verify)
6. Context menu completeness

---

## A1: New Topic Creation (Draft → Real)

**Given** user is on an agent chat page with an active agent  
**When** user clicks "Start New Topic" in the sidebar  
**Then** a draft session appears at the top of the topic list with the fallback title  
**And** the chat area clears to an empty state  

**When** user sends a message in the draft session  
**Then** the message appears immediately (optimistic user message + loading assistant)  
**And** the stream emits `conversation_created` with a real conversation ID  
**And** the draft key is replaced with the real ID in sessions, operations, and buffers atomically  
**And** the sidebar topic item remains selected without flicker  

**When** the stream completes  
**Then** `reconcileTopicsAfterTurn` fires  
**And** because `titleState === 'untitled'`, `smartRenameTopic` is called  
**And** the topic title transitions from fallback to the generated title  

---

## A2: Auto-Rename Display States

**Given** a topic with `titleState: 'untitled'` exists in the sidebar  
**When** `smartRenameTopic` is invoked (after first exchange)  
**Then** the topic shows the "generating" indicator text beside the title  

**When** the LLM returns a generated title  
**Then** the title updates to the generated text  
**And** an "undo" button appears next to the title  
**And** `titleState` becomes `'generated'`  

**When** user clicks the undo button  
**Then** the title reverts to the previous value  
**And** the undo button disappears  
**And** `titleState` becomes `'manual'`  

---

## A3: Topic Pinning

**Given** a topic exists in the sidebar  
**When** user right-clicks and selects "Pin"  
**Then** the topic immediately moves to the "Pinned" section at the top  
**And** a pin icon appears on the topic item  
**And** the backend receives `pin_session(key, true)`  

**When** user right-clicks a pinned topic and selects "Unpin"  
**Then** the topic moves back to its date group position  
**And** the pin icon disappears  

**Failure scenario:**  
**When** the backend call fails  
**Then** the optimistic pin is rolled back  
**And** a toast error is displayed  

---

## A4: Topic Favorites

**Given** a topic exists in the sidebar  
**When** user right-clicks and selects "Favorite"  
**Then** the topic appears in the "Pinned & Favorites" section (if not already pinned there)  
**And** a star icon (filled) appears on the topic item  

**When** user right-clicks a favorited topic and selects "Unfavorite"  
**Then** the star icon disappears  
**And** if the topic is not also pinned, it moves back to its date group  

---

## A5: Topic Sidebar Search — Title Mode

**Given** the agent has 10+ topics with various titles  
**When** user clicks the Search nav item  
**Then** a search input appears below the nav actions  

**When** user types "architecture" into the search input  
**Then** only topics whose title contains "architecture" (case-insensitive) are shown  
**And** the filtering is instant (no network call)  
**And** date grouping still applies to filtered results  

**When** user clears the search input  
**Then** all topics reappear in their original date groups  

---

## A6: Topic Sidebar Search — Content Mode

**Given** the search bar is visible and user has typed at least 2 characters  
**When** the search triggers content search (after 250ms debounce)  
**Then** the message search results section appears below  
**And** shows matching message snippets with topic titles  
**And** a loading indicator appears while searching  

**When** user clicks a message search result  
**Then** the corresponding topic is selected  
**And** the chat area loads that topic's messages  

---

## A7: Topic Delete with Active Session Fallback

**Given** the currently active topic is the only topic for this agent  
**When** user deletes it via context menu → confirm modal  
**Then** the topic is removed from the list  
**And** a new draft topic is created automatically  
**And** the chat area clears  

**Given** the currently active topic has sibling topics  
**When** user deletes it  
**Then** the next available topic becomes active  
**And** its messages load  

---

## A8: Topic Duplicate

**Given** a topic with messages exists  
**When** user selects "Duplicate" from the context menu  
**Then** a new topic appears in the list with the same title  
**And** `loadTopicsForAgent` is called to refresh from Station  
**And** the duplicated topic's messages match the original  

---

## A9: Context Menu Completeness

**Given** user hovers over a topic item  
**Then** a "..." button appears on the right  

**When** user clicks "..." or right-clicks the topic  
**Then** a context menu appears with these items in order:
1. Pin / Unpin
2. Favorite / Unfavorite
3. ---
4. Smart Rename
5. Rename
6. Duplicate
7. ---
8. Delete (danger)

**And** all items are functional (no disabled items except in error states)  

---

## A10: Topic Sort by Date Groups

**Given** multiple topics exist with various `updated_at` timestamps  
**Then** the sidebar groups them into: Today, Yesterday, This Week, This Month, and older months  
**And** within each group, topics are sorted by `updated_at` descending (most recent first)  
**And** pinned/favorite topics always appear in the dedicated section regardless of date  

---

## A11: Agent Switch Preserves Topic State

**Given** user is on Agent A with topics loaded and one topic pinned  
**When** user switches to Agent B  
**Then** Agent B's topics load (separate `topicsByAgentId` key)  
**And** Agent B's pinned/favorite state is independent  

**When** user switches back to Agent A  
**Then** Agent A's topics display with the pin still in place  
**And** no re-fetch if data is fresh (already in `topicsByAgentId[agentA.id]`)  

---

## A12: Optimistic Rename Rollback

**Given** a topic with title "Old Title"  
**When** user renames it to "New Title" and the backend fails  
**Then** the title reverts to "Old Title"  
**And** a toast error is shown  
**And** the topic's `titleState` remains unchanged from before the attempt  

---

## Verification Commands

```bash
# Desktop build + type check (catches interface mismatches)
cd apps/desktop && pnpm run check

# Desktop tests (unit tests for store logic)
cd apps/desktop && pnpm run test

# Full build
cd apps/desktop && pnpm run build
```

---

## P2 Scenarios (Deferred — Not in Scope)

- Topic status lifecycle (running/completed indicators)
- Batch delete/move operations
- Paginated topic loading with "Load More"
- Multi-mode grouping toggle (byTime / byStatus / byProject)
- All-topics drawer
- Epoch-guarded rapid topic switching
- Stale-running-topic watchdog cleanup
