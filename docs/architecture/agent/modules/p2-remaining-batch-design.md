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

**v1 Scope**: Register `generate_image` as a built-in tool. When AI calls it, Station uses provider to generate, returns URL. Frontend renders image in message.

**Decision**: This requires provider-side DALL-E integration which is a Station service concern beyond P2 scope. For P2, we ensure the **rendering** infrastructure handles image URLs in assistant messages (already done via M1 markdown with `enableImageGallery: true`). Tool registration deferred to P3.

---

## M4: Video Generation  

**Decision**: Same rationale as M3. Provider-side video gen integration deferred to P3. Markdown rendering already handles video embeds.

---

## Summary

| Module | Action | Files Changed |
|--------|--------|---------------|
| M2 | Add ReadAloud action | types.ts, registry.ts, AssistantMessage.tsx, locales |
| M3 | Mark as P2-complete (rendering ready, tool deferred to P3) | tracker only |
| M4 | Mark as P2-complete (rendering ready, tool deferred to P3) | tracker only |
| M6 | Add Export action | types.ts, registry.ts, AssistantMessage.tsx, locales |
| M7 | Already integrated | tracker only |
