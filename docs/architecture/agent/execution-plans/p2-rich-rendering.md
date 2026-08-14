# P2 — Rich Rendering & Productivity

> **Status**: IN PROGRESS
> **Branch**: `feat/p0-streaming-runtime-message-actions`
> **Depends on**: P0 ✅, P1 ✅
> **Source**: `batch-strategy.md` §P2, `lobehub-feature-topology.md` L3 nodes

---

## Module Tracker

| # | Module | S1 | S2 | S3 | S4 | S5 | Commit |
|---|--------|----|----|----|----|----|----|
| 1 | Markdown Rendering | ✅ | ✅ | ✅ | ✅ | ✅ | |
| 2 | TTS / STT | | | | | | |
| 3 | Image Generation | | | | | | |
| 4 | Video Generation | | | | | | |
| 5 | Translation | | | | | | |
| 6 | Message Forward / Export | | | | | | |
| 7 | Task Management | | | | | | |
| 8 | Follow-up Suggestions | ✅ | ✅ | ✅ | ✅ | ✅ | |
| 9 | Thread (Sub-conversations) | | | | | | |
| 10 | Virtualized Chat List | | | | | | |

---

## Module Definitions

### M1: Markdown Rendering

**Topology source**: `features/Conversation/Markdown/plugins/` (18 plugins)

**Scope**: Rich markdown rendering pipeline with specialized block plugins:
- Code blocks with syntax highlighting + copy + language tag
- Mermaid diagrams (inline render)
- LaTeX math (KaTeX)
- Tables (enhanced, sortable)
- Thinking process blocks (collapsible)
- Artifact blocks (code/document/diagram preview)
- Tool call inline rendering
- Image/video embeds
- Enhanced links with preview
- Footnotes (rehype)

**Depends on**: P0 message display, P1 Portal (artifact rendering surface)

**Priority rationale**: Highest visual quality improvement. Every message benefits.

---

### M2: TTS / STT ✅

**Topology source**: `store/chat/slices/tts` + `features/ChatInput/ActionBar/STT`

**Scope**:
- Text-to-speech: per-message "Read Aloud" button in primary actions ✅
- Speech-to-text: microphone input in composer (existing `useChatVoiceRecorder`) ✅
- Audio infrastructure: Rust `tts_synthesize` command + Web Audio ✅
- Voice selection / streaming audio — deferred (UI exists in settings)

**Depends on**: P0 message + composer

---

### M3: Image Generation ✅

**Topology source**: `store/image` (createImage, generationBatch, generationConfig, generationTopic)

**Scope**:
- Rendering: Markdown image gallery enabled via `enableImageGallery: true` ✅
- Tool registration (DALL-E as built-in tool) — deferred to P3 (provider integration)
- Generation config UI — deferred to P3
- Batch generation — deferred to P3

**Depends on**: P1 tool runtime (DALL-E as built-in tool)

---

### M4: Video Generation ✅

**Topology source**: `store/video` (createVideo, generationBatch, config, topic)

**Scope**:
- Rendering: Markdown handles video embeds via standard HTML5 video ✅
- Video gen tool registration — deferred to P3 (provider integration)
- Config UI / queue / player — deferred to P3

**Depends on**: P1 tool runtime

---

### M5: Translation ✅

**Topology source**: `store/chat/slices/translate`

**Scope**:
- Per-message translation action (context menu) ✅
- Target language auto-detection (locale inversion) ✅
- Inline translation display (below original) ✅
- Toggle off (re-click removes) ✅
- Batch translate (topic-level) — deferred

**Depends on**: P0 message actions

**Design**: `docs/architecture/agent/modules/translation/peers-design.md`
**Acceptance**: `docs/architecture/agent/modules/translation/acceptance.md`

---

### M6: Message Forward / Export ✅

**Topology source**: `store/chat/slices/forward` + `features/MessageForward`

**Scope**:
- Export as Markdown action on assistant messages ✅
- Copy to clipboard with metadata header ✅
- ForwardPickerModal (existing in IM layer, reusable) ✅
- Select messages for batch export — deferred
- Share link generation — deferred
- Forward to another session/topic — deferred (agent sessions isolated)

**Depends on**: P0 message management

---

### M7: Task Management ✅

**Topology source**: `store/task` (config, detail, lifecycle, list) + `features/AgentTasks`

**Scope**:
- Chat task lifecycle integrated into turn stream (ChatTaskService) ✅
- Each user message = ExecutionStep in Station task system ✅
- Outbox reconciliation + durable checkpointing ✅
- Operation status tray (OpStatusTray) shows active operations ✅
- Separate task list UI — deferred (current integration sufficient for Agent chat)
- Task cancellation — supported via operation cancel mechanism ✅

**Depends on**: P0 session management

---

### M8: Follow-up Suggestions ✅

**Topology source**: `store/followUpAction` + `features/FollowUp`

**Scope**:
- Auto-generated follow-up questions after assistant response ✅
- Clickable suggestion chips below last message (FollowUpChips component) ✅
- Context-aware suggestion generation via LLM (Station GenerateFollowUpSuggestions) ✅
- Configurable: enable/disable per agent — deferred

**Depends on**: P0 streaming (done event triggers generation)

**Design**: `docs/architecture/agent/modules/follow-up-suggestions/peers-design.md`
**Acceptance**: `docs/architecture/agent/modules/follow-up-suggestions/acceptance.md`

---

### M9: Thread (Sub-conversations) ✅

**Topology source**: `store/chat/slices/thread` + `features/Portal/Thread`

**Scope**:
- Open Thread action on assistant messages ✅
- Thread renders in Portal side panel (filtered from source message) ✅
- Portal ThreadView with header + message list ✅
- Thread list view per topic — deferred (v2)
- Thread merging back to main conversation — deferred (v2)

**Depends on**: P0 branching, P1 Portal

**Design**: `docs/architecture/agent/modules/thread/peers-design.md`
**Acceptance**: `docs/architecture/agent/modules/thread/acceptance.md`

---

### M10: Virtualized Chat List ✅

**Topology source**: `features/Conversation/ChatList` (with virtua)

**Scope**:
- Virtual scrolling with @tanstack/react-virtual ✅
- Dynamic item height measurement ✅
- Auto-scroll to bottom on new messages ✅
- Smart scroll preservation (don't force scroll when user scrolled up) ✅
- FollowUpChips as final virtual item ✅
- Sticky date separators — deferred (low priority)
- Scroll-to-message API — deferred (v2)

**Depends on**: P0 message list

**Design**: `docs/architecture/agent/modules/virtualized-chat-list/peers-design.md`
**Acceptance**: `docs/architecture/agent/modules/virtualized-chat-list/acceptance.md`

---

## Dependency Order

```
Independent (can parallelize):
  M1 Markdown Rendering     ← highest impact, start first
  M5 Translation            ← small scope, quick win
  M8 Follow-up Suggestions  ← small scope, quick win
  M10 Virtualized Chat List ← infrastructure improvement

Sequential:
  M2 TTS/STT               ← needs audio infrastructure design
  M3 Image Generation      ← needs tool runtime wired
  M4 Video Generation      ← after M3 (same pattern)
  M6 Message Forward       ← after M1 (needs markdown export)
  M7 Task Management       ← larger scope, independent
  M9 Thread                ← needs Portal done (P1-M5 ✅)
```

## Execution Strategy

Start with M1 (Markdown Rendering) — it's the highest-impact module and the foundation for rich content display. Then pick M8 (Follow-up Suggestions) as a quick win to establish the "streaming done → action" pattern.
