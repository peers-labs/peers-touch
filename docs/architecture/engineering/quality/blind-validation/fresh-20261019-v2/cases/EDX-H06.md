# EDX-H06: Clear Local Chat Data On Desktop And Mobile

## Starting Context

The same authenticated user has an existing conversation on Desktop and Mobile.
The user wants to remove that conversation's plaintext, search index and
unreferenced media from the current device only.

## User Goal

Understand the scope and consequence, confirm the destructive action, observe
pending and terminal feedback, and preserve other devices and participants.

## Required Sources

- `apps/desktop/src/components/chat/ChatDetailPanel.tsx:843-882`
- `apps/desktop/src/components/chat/ChatDetailPanel.tsx:986-995`
- `apps/desktop/src/components/chat/ChatDetailPanel.tsx:1683-1710`
- `apps/mobile/src/pages/chat/ChatOverlayHost.tsx:329-383`
- `apps/mobile/src/pages/chat/ChatOverlayHost.tsx:386-438`
- `apps/mobile/src/pages/ChatPage.tsx:1203-1241`
- `apps/mobile/src/pages/ChatPage.tsx:1658-1667`
- `docs/architecture/domains/chat/lifecycle/experience-contract.md:81-113`
- `docs/client/mobile/chat-layout-contract.md:112-128`
- `docs/client/chat/chat-ux-contract.md:122-132`
- `packages/locales/en/chat.json:498-502`
- `packages/locales/en/common.json:299-302`

## States To Walk

- conversation action surface open;
- clear action separated from reversible preferences;
- destructive confirmation;
- user cancels;
- clear pending;
- clear succeeds and reports released local storage;
- clear fails and remains recoverable;
- later messages continue to arrive.

## Review Boundary

Review shared intent and state meaning across platform-specific interaction
patterns. Desktop may use a detail panel and modal while Mobile uses action and
confirmation sheets. Runtime durability after restart is not established by
these source excerpts alone.

Return the JSON ReviewResult required by `rubric.md`.
