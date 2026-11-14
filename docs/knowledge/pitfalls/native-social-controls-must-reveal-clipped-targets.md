---
kind: pitfall
title: Native Social controls must reveal clipped targets before visibility waits
status: active
owns:
  - tooling/development/secure_content/social_interaction_ui.py
  - tooling/development/secure_content/test_social_interaction_ui.py
related:
  - docs/client/common/ui-identity/modules/social/desktop.md
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

## How To Detect A Recurrence

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
