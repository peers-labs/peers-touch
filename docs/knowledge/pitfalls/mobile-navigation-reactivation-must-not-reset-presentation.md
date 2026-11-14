---
kind: pitfall
title: Mobile view reactivation must not reset presentation
status: active
owns:
  - apps/mobile/src/components/MobileShell.tsx
  - apps/mobile/src/components/MobileNavigationHost.tsx
  - apps/mobile/src/components/mobilePageLifetime.tsx
  - apps/mobile/src/components/MobileRouteBoundary.tsx
  - apps/mobile/src/app/navigation/
  - apps/mobile/src/pages/
related:
  - docs/client/common/ui-identity/frontend-component-tree.md
  - docs/architecture/platform/client/mobile/northstar-realignment/decisions.md
detected: 2026-11-14
owner: Mobile / Client Platform
review-cadence: on-change
---

# Mobile view reactivation must not reset presentation

The active-only shell rebuilt the Messages header and page controllers on
navigation. Settings replaced its whole layout while reading native metadata;
scroll restoration ran after paint. The user observed webpage-like refresh
and jitter and prohibited this throughout the app.

`MobileNavigationHost` is the sole bounded view owner. Retain visited roots
and only four last current-stack details, using Activity to suspend hidden
Effects. Before-paint restoration resolves the visible leaf frame, never the
first matching retained DOM node.

A compound frame delegates scroll/focus restoration to its leaf host. Running
restoration in both layers overwrites a pane's saved position during the parent
location-key change: Chats at 287px returned at 0 after visiting Contacts.
Verify two independently scrolled panes, including the first painted return.

Activity re-runs Effects on reveal. Initialization effects must distinguish
first initialization from reactivation: never clear a ready draft/result/form
before asynchronously reloading it. Ordinary cleanup still stops capture,
typing, subscriptions, observers and pending reads. A displayed preview/grant
uses `useMobilePageDisposal` so hiding does not revoke the retained asset;
actual removal/eviction disposes it. Nested visibility inherits the parent,
including a failed runtime boundary.

Search picker results are retained presentation too. Circle member and custom
audience pickers must clear their search owner through page disposal, not normal
Effect cleanup. A settled audience query must not be automatically reissued on
reveal; cancel only an undispatched debounce timer. The component browser
fixture exercises both actual pages, preserving results and selection in the
first return frame and clearing them once on a hidden exit.

Verify on the native Journey that page/header nodes remain identical on
return, scroll does not jump on the first frame, frame count remains bounded,
hidden work/capture stops, assets survive suspension but release on eviction,
and an identity replacement clears the old tree. Generic CSS DOM selectors
in drivers/audits must choose a visible match; hidden duplicate controls are
never an interaction target.
Focus oracles inspect the actual focused, visible control. The first matching
composer may belong to a hidden retained frame and is not a valid focus oracle.

Input focus is not retained navigation state: restoring an input after return
or overlay dismissal reopens the software keyboard without user activation.
Mobile selects `UIProvider inputFocus="explicit"` and navigation saves/restores
only non-editable targets. Reply/edit, emoji selection and send callbacks retain
draft/selection without calling input.focus(). Verify no editing focus on
entry/return/dismissal, then a real input tap and native keyboard appearance.
The original whole-product Journey keeps all 174 surfaces and three cells.
