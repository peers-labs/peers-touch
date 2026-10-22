---
kind: pitfall
title: Inherited visibility transitions block Chat action focus
status: active
owns:
  - apps/desktop/src/components/chat/message/ChatMessageActionOverlay.tsx
  - tooling/acceptance/gates/chat/native_product_closure_runner.py
referenced-by: []
related:
  - docs/client/desktop/chat-layout-contract.md
  - docs/architecture/engineering/acceptance/execution-budget.md
detected: 2026-10-23
---

# Inherited visibility transitions block Chat action focus

## Symptom

Enter reaches the focused message row and opens a visible toolbar, but focus
stays on the row. Tab then reaches the composer instead of the reaction action.

## Root cause

The Ant Button default `transition: all 0.2s` animates visibility inherited from
the initially hidden measurement surface. In a background macOS WebView the
observed visibility transition remains running at `currentTime: 0`; the button
is hidden while its parent is visible. Moving the focus effect to a layout
effect does not fix this. Ordinary buttons without that transition can focus
in the same WebView.

## Mitigation

The action overlay limits button transitions to color, background color, border
color and box shadow. Visibility changes become immediate while hover feedback
remains animated. Keep pane geometry, focus order and input budgets unchanged.

## How to detect a recurrence

Run the original `chat-native-product-closure-e2e` through
`desktop-macos-native` in semantic nonintrusive mode. Its existing keyboard
sequence must focus Thread, advance to Reaction, open the picker, select an
emoji and restore Reaction focus. Use the retained allowed input names and
actual control visibility/animation observations to diagnose a failure.
An isolated component probe supports attribution; it does not replace the
Gate's dual-client product and receiver assertions.
