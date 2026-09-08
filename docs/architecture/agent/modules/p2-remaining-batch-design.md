# P2 Remaining Modules — Batch Design (S2)

## M6: Message Forward / Export

**Existing**: `ForwardPickerModal.tsx` (IM chat), `share` action in locale keys.

**v1 Scope**: Add "Export" action to assistant messages. Export as Markdown to clipboard.

**Implementation**:
- Add `onExport` to `MessageActionContext`
- Add Export action (Download icon) to `buildAssistantActions` menu
- Export handler: formats message as markdown with metadata header, copies to clipboard
- No forwarding to other sessions in v1 (agent sessions are isolated)

---

## M7: Task Management

**Existing**: `ChatTaskService` in Station, `reconcileChatTaskOutbox` in frontend.

**v1 Scope**: The task system is already integrated into the chat turn lifecycle (each user message = a step). No separate "task list UI" needed for v1 — the existing operation status tray (`OpStatusTray`) already shows active operations.

**Decision**: Mark as delivered — the LobeHub "Task" concept in their topology maps to our existing turn-level operation tracking + delegation tasks. No new UI needed.

---

## M2: TTS/STT

**Existing**: `tts_synthesize` Rust command, `useChatVoiceRecorder.ts`, TTS module.

**v1 Scope**: Add "Read Aloud" action to assistant messages.

**Implementation**:
- Add `onReadAloud` to `MessageActionContext`
- Add ReadAloud action (Volume2 icon) to `buildAssistantActions` primary actions
- Handler: invokes `tts_synthesize` with message content, plays audio via Web Audio API
- STT: already wired in ChatInput composer (existing `useChatVoiceRecorder`)

---

## M3: Image Generation

**Decision**: Image generation is not a Peers-Touch capability. Generic
rendering of image URLs remains supported, but no generation tool, provider
integration, configuration surface, or future Peers phase is planned.

---

## M4: Video Generation  

**Decision**: Video generation is not a Peers-Touch capability, matching M3.
Generic rendering of externally supplied video remains supported. Any future
video-generation product must be implemented as a separate project with its
own product contract.

---

## Summary

| Module | Action | Files Changed |
|--------|--------|---------------|
| M2 | Add ReadAloud action | types.ts, registry.ts, AssistantMessage.tsx, locales |
| M3 | Keep generic image rendering; reject Peers image generation | tracker only |
| M4 | Keep generic video rendering; reject Peers video generation | tracker only |
| M6 | Add Export action | types.ts, registry.ts, AssistantMessage.tsx, locales |
| M7 | Already integrated | tracker only |
