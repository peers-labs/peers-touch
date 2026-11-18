---
kind: pitfall
title: Native Social controls must reveal clipped targets before visibility waits
status: active
owns:
  - tooling/development/secure_content/social_interaction_ui.py
  - tooling/development/secure_content/test_social_interaction_ui.py
  - tooling/acceptance/gates/social/public_feed_native.py
  - tooling/acceptance/gates/social/public_comment_revalidation.py
related:
  - docs/client/common/ui-identity/modules/social/desktop.md
  - docs/client/common/ui-identity/components.md
  - docs/architecture/engineering/acceptance/decisions.md
referenced-by: []
detected: 2026-11-13
---

# Reveal Native Social Controls Before Visibility

## Symptom

CSS-09 reached its final same-Station regression, then timed out waiting for
Alice's private parent card. Native logs confirmed publication reached
`PUBLISHED`. Alice's preceding painted feed evidence showed the viewport at
older poll cards; the page remained the feed, not a detail view.

## Root Cause

`SocialCommentUI.open_thread` waited for Selenium `is_displayed()` before
scrolling the comment control. The feed clips content through its scrolling
container. A newly inserted head can remain outside that retained viewport,
so a present control cannot satisfy the visibility wait that precedes its
reveal. The original poll entry already handled this ordering.

## Mitigation

The comment entry locates the exact Post's real control, scrolls that element
into view once per element identity, then performs its original visibility
and thread-expansion checks. A replaced element receives its own reveal.
Missing and CSS-hidden controls remain failures; scrolling does not change
visibility styles, product projections, authentication or native focus.
The original 120-second wait and one-shot expansion action remain unchanged.

## Canonical geometry instead of a stale observer value

After the shared comment control adopted the accepted compact token, CSS-09
passed AS17–AS19 and both acquired-empty comment phases, then waited 120 seconds
for an otherwise correct LIKE control. Its actual height was 28px while the
Native predicate still required the removed 22px local size.
`components.md` owns the canonical size scale and `packages/ui/tokens` owns its
values. The original LIKE predicate now requires compact density and exact
equality to the resolved `--pt-control-compact` token. Missing, invalid or
nonpositive tokens fail. Its failure diagnostic evaluates the same geometry.
Do not restore bespoke product sizing or remove the geometry check to make
the observer pass.

## Native navigation uses the current action control

The original public Suite prepared all three clients, then waited 120 seconds
for `[data-pt-primary-nav="moments"] [role="button"]` before its first scenario.
`AppSideNav` now renders the shared `IconButton`, whose original `Button` emits
a native `<button>` and a stable `data-action-id`; its implicit accessibility
role is not a literal DOM `role` attribute. The stale attribute selector cannot
find the real control.

Public Suite entry, Circle/account return, restart navigation and alive-page
return select the original navigation anchor's native button with its exact
`primary-nav.*` action ID. The inherited Search entry consumes the same current
control contract at its existing Search owner. Do not add redundant roles to
the product or replace navigation with a Harness page switch. Preserve the
original real click, visibility checks, receiver assertions and deadlines.

## Complete transient interaction before the next scenario

The public Suite's single-choice poll converged to the expected option counts,
viewer choice and two voters, but its centre hit-test remained outside the
poll. The immutable Native screenshot and DOM showed the prior post's
controlled reaction picker still expanded and covering that point.
Selecting a reaction does not close this picker; its original trigger owns
the open/close transition.

The reaction scenario must close that same original trigger after selecting
the reaction and wait for the real picker to disappear before proceeding.
Do not hide the layer, invoke an internal picker state setter, remove the
poll's occlusion check or change expected ballot data to pass. The same
Native Journey must retain comment/reaction convergence, late-read,
alive-return and all poll assertions.

## An expanded offscreen thread still needs a reveal

The public Suite completed its comment/revalidation, poll and edit scenarios,
then restarted Bob. The original post remained below three newer poll cards.
`open_comments` accepted its already-expanded control without scrolling.
`MomentCommentsSection` acquires the original Runtime interest only when the
thread intersects the viewport, so a fresh receiver had no acquired comment
rows and waited 120 seconds for paint. Earlier cached rows had hidden this
omission. The captured edit DOM retained the same original post ID and correct
root/reply LIKE states; the replacement log made no new read of that offscreen
thread.

The original comment entry reveals its real control whether collapsed or
already expanded, then retains the original conditional expansion and waits.
It never collapses an open thread or invokes a Harness comment read to supply
convergence. Missing rows attempt Native screenshot/DOM capture before cleanup,
and a failed capture preserves the original timeout. Receiver comments and
LIKE state after restart remain required by the same complete Native Journey.

The subsequent public run completed restart readback, then timed out in the
normal publication's passive paint check. The original receiver had retained
its lower feed viewport after poll verification, and the passive card oracle
checked intersection and centre hit ownership without revealing a present
target. Like the original poll oracle, it now scrolls the real existing card
before requiring two visible paint frames. Missing cards still fail; it never
calls `findPublicMoment`, forces a refresh or initiates a repair read. Failure
attempts screenshot/DOM capture while preserving the original timeout. Separate
projection-verification rejection in the runtime log remains unproven until
the same current-source Journey actually converges; viewport repair does not
waive that rejection.

## How To Detect A Recurrence

The Public Suite saved 22 real Circle members and qualified the last row in
the existing editor, then failed the same paint predicate immediately after
reopening that editor. The original measurement had no shared Dialog entrance
settlement check. It now observes the real ancestor animation lifecycle before
scrolling the member, then retains both original painted-frame checks.
It does not remove animations, force styles or relax clipping/hit ownership.
Failure independently records original geometry and Native screenshot/DOM,
preserving the first exception. Run the original public Gate tests to require
motion settlement before reveal and to reject permanent motion even when
diagnostics fail; the complete Native Suite must still prove reopened
membership, cancellation, partial-save retry, block and account isolation.

```bash
python3 -m unittest \
  tooling.development.secure_content.test_social_interaction_ui \
  tooling.development.secure_content.test_runtime_owner
```

The synthetic clipped-parent and repaint cases must fail without the reveal;
missing and hidden parents must still fail. Then run the same selected
`social-cross-station-native-e2e` Journey on current source and inspect its
final same-Station root/reply actions, painted assertions and owned cleanup.
Source tests and partial scenario observations cannot establish Suite proof.
Execute the actual emitted LIKE predicate and diagnostic with canonical 28px,
obsolete 22px, oversized, wrong-density and missing/invalid-token inputs.
Only canonical geometry may pass; the same Native Journey and its original
deadline remain required.
Run the original public Suite entry regressions for collapsed and already-open
offscreen threads. Both must acquire rows after reveal, and an open thread must
stay open. Missing rows retain the original timeout even if rendering capture
fails. Then run `social-public-feed-native-e2e` on current source; source tests
and the old receiver's cached comments do not prove fresh receiver acquisition.
The passive public card regression must reject missing cards, occlusion and
fewer than two paint frames, retain the original deadline and first failure,
and issue no Harness repair/read action. The complete public Suite must prove
normal, lost-notification, lost-ACK and integrity-recovery receiver paint.
