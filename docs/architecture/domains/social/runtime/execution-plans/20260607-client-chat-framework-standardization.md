# Client Chat Framework Standardization Execution Tracker

> **Status**: complete; all tracked framework standardization tasks and final regression closed
> **Version**: v0.1
> **Created**: 2026-06-07
> **Owner**: Client Architecture / Social Runtime
> **Scope**: `packages/client-chat-core`, `apps/desktop/src/components/chat`, `apps/desktop/src/runtimes`, `apps/desktop/src/services/socialRealtime.ts`, `apps/mobile/src/pages/ChatPage.tsx`, `apps/mobile/src/runtimes`, `apps/mobile/src/features/social`

---

## 1. Goal

Move chat from local UI patches to a framework-level client capability:

- Desktop and Mobile share chat semantics wherever there is no host dependency.
- Platform differences enter through host adapters, composer/media adapters, and renderers.
- Runtime owns freshness; UI renders projection and dispatches commands only.
- No V2 component forks or compatibility layers that keep old behavior alive as a parallel path.

---

## 2. Architecture Shape

```text
packages/client-chat-core
  pure chat semantics:
    IME enter, message display, attachment kind, reply/thread,
    message/conversation/thread surfaces,
    composer capability profiles,
    media contract helpers,
    host event contract helpers

Desktop host/client
  Desktop adapter/runtime/store/renderer:
    Tauri events, window focus, screenshot, voice, file upload,
    socialRealtime projection freshness, Desktop chat UI

Mobile host/client
  Mobile adapter/runtime/store/renderer:
    WebView visibility, native push/deep-link/resume,
    mobile social/group projection, Mobile chat UI
```

Dependency direction:

- Shared core has no proto, React, DOM, Tauri, store, or i18n dependency.
- Desktop/Mobile may import shared core.
- Shared core must not import Desktop/Mobile code.
- Host events are wakeup/reconcile hints, never business truth.

---

## 3. Completed

| Area | Status | Evidence |
| --- | --- | --- |
| Shared chat core package | Done | `packages/client-chat-core` added as workspace package |
| IME-safe Enter | Done | `shouldSendComposerEnter` used by Desktop and Mobile |
| Attachment/message type helpers | Done | `chatMessageTypeForMime`, visual attachment helper |
| Message semantics | Done | own/recalled/encrypted/display/search/edit/sender helpers |
| Message surface | Done | date separator, timeline gap, clear-history filter, thread reply count |
| Conversation surface | Done | shared filtering, sticky sort, muted unread suppression |
| Thread surface | Done | shared root/replies/display projection and reply target fallback |
| Desktop message renderer split | Done | message timeline/row/content components replace page-local rendering |
| Desktop thread surface | Done | `ChatThreadPanel` uses shared thread helpers |
| Mobile chat semantics | Done | `ChatPage` uses shared display/search/edit/sender/conversation helpers |
| Composer capability model | Done | shared capability profiles for Desktop main/thread and Mobile text-only |
| Desktop composer capability hookup | Done | main/thread composers choose shared profiles |
| Mobile composer capability hookup | Done | Mobile submit guard uses shared text-only profile |
| Social host event contract | Done | shared `SocialHostEvent` helper in `packages/client-chat-core` |
| Mobile host adapter alignment | Done | `mobileNativeEventBridge.ts` uses shared event builder |
| Desktop host adapter entry | Done | `desktopSocialHostAdapter.ts` installed by `socialRuntime.ts` |
| Runtime host event handling | Done | Desktop/Mobile host events enter runtime and trigger targeted refresh/reconcile |
| Media contract helpers | Done | shared media kind, message type, visibility, transfer status, size formatting helpers |
| Desktop media adapter mapping | Done | composer drafts, message attachments, and detail attachments use shared media classification |
| Mobile media boundary | Done | current Mobile composer remains explicit text-only until upload/display adapter lands |
| Reducer list primitives | Done | shared message merge, receipt, mutation, decrypted content, and typing reducers in `packages/client-chat-core` |
| Presence/notification/badge reducers | Done | shared presence map, notification list/read/delete, and unread counter reducers in `packages/client-chat-core` |
| Participant unread/thread reducers | Done | shared participant unread calculation/clear and thread message de-duplication reducers |
| Native host event emit closure | Done | Desktop native Rust emit command/run-event bridge and Mobile native emit bridge are wired into shared host event semantics |
| Visual contract regression | Done | shared `ChatVisualLayoutContract` covers avatar gap/size, bubble radius, hover bridge, composer geometry; `test:chat-visual` guards the contract |
| Mobile/Desktop visual parity | Done | Desktop message rows/composers and Mobile thread CSS consume shared visual layout contract/CSS vars; architecture docs now record the rule |
| E2EE/offline queue parity domain base | Done | shared `ChatE2eeProjection` and `ChatOutboxItem` reducers added to `client-chat-core`; Mobile group E2EE store consumes shared projection status |
| Architecture docs | Done | `design.md`, `integration.md`, `decisions.md`, `phase-1-runtime-alignment.md` updated |

---

## 4. Final Regression Closure

| Area | Status | Evidence |
| --- | --- | --- |
| Final regression | Closed on 2026-06-07 | Shared core, Desktop TS, Desktop Rust host bridge, Mobile TS/Rust/iOS project, and Desktop/Mobile Vite builds passed |

No remaining framework standardization task is tracked in this plan. Future work should enter a new execution plan only if it introduces new framework ownership, not for product-level scenario coverage already delegated to existing domain plans.

---

## 4.1 Task Sufficiency Review

Current task list is sufficient for framework-level closure because all tracked work now covers the architectural layers:

- `Reducer/normalizer convergence` has covered shared business state machines.
- `Native host event emit closure` covers host adapter completion below Web.
- `Visual regression` and `Mobile/Desktop visual parity` cover the user-visible quality bar that pure semantics cannot prove.
- `E2EE/offline queue parity` covers large domain closures that must not be hidden inside UI patches.

The media contract and reducer/normalizer work now have shared semantic bases. A future Mobile media upload/display adapter may be added under visual/product parity, but it is no longer an untracked framework gap. Proto/json timestamp normalization and enum coercion remain platform adapter responsibilities by design; moving them into shared core would violate the no-proto/no-host dependency rule.

Historical checkpoint after the reducer pass:

- `Visual regression` and `Mobile/Desktop visual parity` were the then-open user-visible quality gates.
- `E2EE/offline queue parity` was intentionally kept as a separate domain stage instead of hidden inside renderer work.

Historical checkpoint after the native host event pass:

- Host wakeup/reconcile hints now have Desktop and Mobile native entry points.
- The then-next framework gap was enforceable visual parity and regression coverage, not runtime ownership.
- E2EE/offline queue parity was intentionally tracked as a domain/runtime stage because completing it inside renderer work would recreate the patch-style problem this plan is eliminating.

Historical checkpoint after the visual contract pass:

- There is no Playwright/Storybook screenshot infrastructure in the Desktop app today, so the executable guardrail is a shared layout contract plus Vitest regression instead of ad hoc screenshot files.
- The same contract became consumable by Desktop and Mobile renderers; the then-open parity task was to ensure both hosts actually used it consistently.
- E2EE/offline queue parity was the only tracked non-visual framework domain left at that checkpoint.

Historical checkpoint after the Mobile/Desktop visual parity pass:

- Desktop and Mobile now share the chat skeleton visual contract while keeping host-specific rendering outside shared core.
- Visual parity is covered by code usage and architecture docs, not only by a one-time CSS adjustment.
- E2EE/offline queue parity was the only open framework/domain closure tracked at that checkpoint.

Historical checkpoint after the E2EE/offline domain-base pass:

- E2EE readiness/error and offline outbox retry/drain are now shared pure state machines.
- Mobile group E2EE continues to own SKDM ledger, repair queue, rotation, encrypted send/edit, and readiness projection outside UI.
- Full cross-device encrypted/offline product scenarios remain covered by the linked domain execution plans; this tracker no longer has an untracked framework standardization gap.

Final sufficiency audit after full regression:

- The current task list is sufficient for this framework-standardization stage because every tracked responsibility has a code owner, adapter boundary, document rule, and verification entry.
- Desktop and Mobile now follow the same shape: pure chat semantics in shared core, runtime-owned freshness, host-specific behavior through adapters, and renderer-only UI composition.
- Remaining product/domain concerns, such as complete encrypted/offline cross-device scenario validation and future Mobile media upload/display parity, are not hidden gaps in this tracker; they require separate domain/product execution plans when scheduled.
- No additional untracked framework task was found during final regression.

### Reducer Case Matrix

| Case | Shared Owner | Platform Adapter Boundary | Status |
| --- | --- | --- | --- |
| Message list merge | `mergeChatMessages` | timestamp resolver, visibility predicate, merge strategy | Done |
| Message receipt | `resolveChatMessageReceiptStatus`, `applyChatMessageReceiptToList` | proto/numeric delivered/read constants | Done |
| Message mutation | `applyChatMessageMutationToList` | timestamp object factory | Done |
| Decrypted content fill | `applyChatDecryptedContentToList` | none | Done |
| Typing state | `applyChatTypingStateToMap`, `pruneChatTypingPeers` | timer input from runtime | Done |
| Presence projection | `seedChatPresenceFromParticipants`, `applyChatPresenceToMap` | session participant shape and actor identity | Done |
| Notification unread/badge | notification list/read/delete reducers, unread counters | notification status/category enums and badge store ownership | Done |
| Participant unread and thread merge | `chatUnreadForParticipant`, `clearChatUnreadForParticipant`, `mergeUniqueChatMessages` | session participant shape only | Done |
| Normalizer edge audit | platform-owned | proto/json timestamp and enum boundary remain in platform adapters | Done |

---

## 5. Verification Log

Last known passing commands for the current framework work:

- `pnpm --dir packages/client-chat-core run check`
- `pnpm --dir packages/client-chat-core run build`
- `pnpm --dir apps/desktop run check`
- `pnpm --dir apps/desktop run test`
- `pnpm --dir apps/desktop run build`
- `pnpm --dir apps/mobile run check:web`
- `pnpm --dir apps/mobile run build`
- `pnpm --dir apps/mobile run check`

Latest stage checkpoint:

- 2026-06-07: Mobile full check passed after shared media contract hookup; the next slice at that checkpoint was reducer/normalizer convergence.
- 2026-06-07: Reducer list primitives passed `pnpm --dir packages/client-chat-core run check`, `pnpm --dir apps/desktop run test -- chatComposerInput.test.ts`, and `pnpm --dir apps/mobile run check:web`.
- 2026-06-07: Presence/notification/badge reducers passed `pnpm --dir packages/client-chat-core run check`, `pnpm --dir apps/desktop run check`, `pnpm --dir apps/desktop run test -- chatComposerInput.test.ts`, and `pnpm --dir apps/mobile run check:web`.
- 2026-06-07: Participant unread/thread reducers passed `pnpm --dir packages/client-chat-core run check`, `pnpm --dir apps/desktop run check`, `pnpm --dir apps/desktop run test -- chatComposerInput.test.ts`, and `pnpm --dir apps/mobile run check:web`.
- 2026-06-07: Reducer/normalizer convergence full regression passed `pnpm --dir packages/client-chat-core run build`, `pnpm --dir apps/desktop run test`, `pnpm --dir apps/desktop run build`, `pnpm --dir apps/mobile run check`, and `pnpm --dir apps/mobile run build`.
- 2026-06-07: Native host event emit closure passed `cd apps/desktop/src-tauri && cargo check --offline -q` and `pnpm --dir apps/desktop run check`. Full `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check` remains blocked by pre-existing formatting drift in unrelated Rust files; the files touched by this stage no longer appear in the format diff filter.
- 2026-06-07: Visual contract regression passed `pnpm --dir packages/client-chat-core run build`, `pnpm --dir apps/desktop run test:chat-visual`, `pnpm --dir apps/desktop run check`, and `pnpm --dir apps/mobile run check:web`.
- 2026-06-07: Mobile/Desktop visual parity used the same verification as visual contract regression and additionally updated `docs/architecture/domains/social/runtime/design.md` and `integration.md` to make shared chat geometry a framework rule.
- 2026-06-07: E2EE/offline queue domain base passed `pnpm --dir packages/client-chat-core run build`, `pnpm --dir apps/desktop run test:chat-visual`, `pnpm --dir apps/desktop run check`, and `pnpm --dir apps/mobile run check:web`.
- 2026-06-07: Final regression passed `pnpm --dir packages/client-chat-core run build`, `pnpm --dir apps/desktop run check`, `pnpm --dir apps/desktop run test`, `cd apps/desktop/src-tauri && cargo check --offline -q`, `pnpm --dir apps/mobile run check`, `pnpm --dir apps/desktop run build`, and `pnpm --dir apps/mobile run build`.

Known non-blocking warnings:

- Rollup pure annotation warnings from `@lynx-js/web-core`.
- Large Vite chunk warnings.
- Desktop Rust `cargo check` emits existing unused/deprecated-code warnings while succeeding.
- `xcodebuild -list` DVT build number warning; the command still succeeds.

---

## 6. Acceptance Criteria

- No `ChatComposerV2` or parallel V2 chat components.
- No page-local long-lived freshness owner.
- No host adapter directly mutates chat/contact/notification projection.
- No shared core dependency on proto, React, DOM, Tauri, stores, or i18n.
- Desktop and Mobile use the same pure semantics for the same business concept.
- Any future work is tracked here or in a linked architecture execution plan, not only in chat history.
