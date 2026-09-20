# CHAT-04 Rich Media And Recorded Voice

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "CHAT-LIFECYCLE-20260916",
  "taskId": "CHAT-04-rich-voice",
  "workstreamId": "CHAT-W03",
  "title": "Encrypted attachments and recorded voice messages",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "chat-rich-voice",
  "journeyId": "CHAT-J03",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/chat",
    "apps/station/app/subserver/conversation",
    "apps/desktop",
    "packages/messaging-core",
    "packages/client-chat-core",
    "tooling/acceptance",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform",
    "docs/client/chat"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "chat-rich-voice-source",
      "command": "pnpm --dir apps/desktop exec vitest run src/components/chat/chatComposerInput.test.ts src/components/chat/composer/useChatAttachmentDrafts.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-rich-voice-functional",
      "command": "python3 -m tooling.acceptance.gates.chat.lifecycle_rich_voice",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-rich-voice-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-rich-voice-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Image/file transfer retains byte identity across interruption and restart",
    "CHAT-UR06: screenshot confirmation or cancellation preserves native window bounds and renderer geometry without a visible scale flash",
    "Voice capture supports permission, duration, stop, cancel, preview, and durable send",
    "Receiver playback exposes duration, progress, seek, pause, retry, and terminal state",
    "Voice metadata remains private and recovery restores exact audio"
  ],
  "failureBehavior": [
    "Retain local draft or durable transfer state on failure",
    "Never expose unverified media, resize the app as a screenshot side effect, or describe resumable transfer as live voice"
  ],
  "updatedAt": "2026-09-17T07:00:00Z",
  "durableEvidence": []
}
```

## Objective

Complete rich messaging and make recorded voice a first-class encrypted Chat
message rather than an unproven generic audio attachment.

## Current Snapshot

- Generic attachment transport is substantial and historically proven.
- Desktop capture/playback is partial and drops captured duration.
- Mobile voice capture and inline playback are not part of this Desktop closure.
