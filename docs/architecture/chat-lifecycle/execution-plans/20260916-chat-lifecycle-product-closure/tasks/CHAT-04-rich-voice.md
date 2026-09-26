# CHAT-04 Rich Media And Recorded Voice

## Task Slice

```json
{
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
    "debug-native-file-chooser-focus.md",
    "model/domain/chat",
    "apps/station/app/subserver/conversation",
    "apps/station/frame/touch/model/chat",
    "apps/desktop",
    "apps/mobile/src/gen/proto/domain/chat",
    "apps/mobile/src-tauri/src/messaging/adapter.rs",
    "packages/messaging-core",
    "packages/client-chat-core",
    "packages/secure-content-core",
    "packages/prototypes/desktop/features/social-chat",
    "tooling/acceptance",
    "tooling/scripts/acceptance-gap-detect.py",
    "tooling/scripts/acceptance-gap-detect-test.py",
    "packages/locales",
    "docs/architecture/social/prototype/README.md"
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
      "id": "chat-rich-voice-contract",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.lifecycle_rich_voice_contract_test tooling.acceptance.gates.chat.chat_attachment_fault_proxy_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-rich-voice-prototype",
      "command": "pnpm --filter @peers-touch/prototype-desktop-social-chat build",
      "verificationClass": "UX_REVIEW"
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
  "updatedAt": "2026-09-19T02:20:00Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "git:a9679b3762f490fce2a2f63337f44a66c5215304;desktop:vitest-39-pass;chat-contract:unittest-8-pass;secure-content-core:cargo-test-58-pass;acceptance-infra:gap-detector-24-pass"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "machine-dev://workspaces/a534541b87e49abf/workflow/CHAT-04-rich-voice/artifacts/a534541b87e49abf/development-run/20260919T021316873035Z-5af775a4c249830808de4b35894885bb/reports/run.json"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance://a534541b87e49abf/acceptance-run/20260919T021641070138Z-d4d8eb2fee0e84f2f4d42037b604d412/reports/run.json;gap:acceptance://a534541b87e49abf/acceptance-gap-detect/20260919T021927835626Z-d4be8075d048933af8430a547a4ee0e7/reports/gap-report.json"
    }
  ]
}
```

## Objective

Complete rich messaging and make recorded voice a first-class encrypted Chat
message rather than an unproven generic audio attachment.

## Current Snapshot

- Exact-source Development Functional passed on `a9679b376`.
- Formal `chat-lifecycle-rich-voice-e2e` Acceptance is `DONE/PROVEN`.
- The Acceptance Gap Detector reports `PROVEN` with no gaps.
- Mobile voice capture and inline playback remain outside this Desktop closure.
