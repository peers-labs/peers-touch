---
kind: pitfall
title: Modal command feedback must escape inert background content
status: active
owns:
  - apps/desktop/src/App.tsx
  - apps/desktop/src/main.tsx
  - apps/desktop/src/hooks/useAppFeedback.tsx
  - packages/ui/web/src/provider.tsx
  - packages/ui/web/src/index.ts
related:
  - docs/client/common/ui-identity/modules/social/desktop.md
  - docs/architecture/platform/client/ui-system/integration.md
referenced-by: []
detected: 2026-11-16
owner: Client Platform / UI System
review-cadence: on-change
---

# Modal command feedback must escape inert background content

## Symptom

The Public Native Suite received the correct second-device writer denial and
retained the composer, but the notice failed two-frame `elementFromPoint`
verification. The notice's text and CSS alone did not establish an interactive
painted feedback surface.

## Root cause

App and legacy shell FeedbackHosts were children of UIProvider's content area.
Opening a real modal makes that area inert. A failed publication leaves its
composer open, so the notice inherited the background's interaction exclusion.
A higher z-index or child pointer-events setting cannot escape inherited inert.

## Mitigation

The App keeps its original window-local, identity-bound channel and renders its
host through the existing `useOverlayHost().element`. Legacy shell feedback uses
`UIProvider.feedback`. The governing integration contract owns this boundary;
neither path creates another modal stack or changes the background isolation.

## How to detect a recurrence

Run `pnpm --dir apps/desktop exec vitest run src/hooks/useAppFeedback.test.ts`
for account/session lifetime checks. Run the source-bound
`social-public-feed-native-e2e` Journey for real modal failure feedback.
Its second-device scenario must pass the original two-frame hit test, typed
writer rejection, retained draft and absent published card checks. The Native
writer-denial screenshot must show the notice while the editor remains open.
