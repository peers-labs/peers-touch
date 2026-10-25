---
kind: pitfall
title: Mobile history reconciliation must not submit read cursors
status: active
owns:
  - apps/mobile/src/features/social/socialStore.ts
  - apps/mobile/src/features/chat/useChatReadCursor.ts
  - apps/mobile/src/runtimes/messagingRuntime.ts
related:
  - docs/client/mobile/lifecycle.md
  - docs/client/mobile/chat-layout-contract.md
referenced-by: []
detected: 2026-10-23
---

# Mobile history reconciliation must not submit read cursors

## Symptom

The native Mobile Search Journey opened a historical message and thread,
returned to Search, then suspended and resumed. Messaging resume failed with
`MOBILE_WRITE_ADMISSION_CLOSED`; its dependent Search, Social, command and
recovery runtimes remained suspended.

## Root cause

`loadMessages` hydrated history and submitted the selected conversation's read
cursor. Resume reconciled Messaging before Social ingress reopened writes.
The read operation therefore depended on the write admission that successful
reconciliation was supposed to restore. Selection also cleared unread counts
before the authority accepted a read cursor.

## Mitigation

History and summary hydration only publish read projections. The mounted Chat
detail owns read intent through `useChatReadCursor`, after active lifecycle and
Session/Recovery admission converge. The existing guarded Messaging command
submits the cursor; account-fenced unread updates follow successful submission.
An admission fence closing before dispatch preserves unread state and waits for
the normal recovery transition. Other failures remain visible in Chat.

## How to detect a recurrence

- Review every `markActiveSessionRead` caller: history/reconciliation must not
  call it, and selected conversation identity alone is not read intent.
- Review `loadMessages` and `refreshSessions`: neither may zero unread counts
  solely from `activeSessionUlid`.
- Run `chat-mobile-device-search-native-e2e` on current source. Its historical/
  thread open → Search return → suspend → resume sequence must restore private
  results on iOS and Android, with the original write fence intact.
- Inspect failure runtime diagnostics and both Gate/Suite cleanup outcomes;
  a dependency-failed Search state cannot replace the originating error.
