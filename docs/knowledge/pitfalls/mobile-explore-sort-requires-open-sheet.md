---
kind: pitfall
title: Mobile Explore sorting requires opening its sheet
status: active
owns:
  - tooling/acceptance/gates/mobile/simulator_social_e2e.py
  - apps/mobile/src/pages/moments/ExploreSortSheet.tsx
  - apps/mobile/src/pages/moments/MomentsScopeHeader.tsx
related:
  - docs/client/mobile/acceptance-setup.md
referenced-by: []
detected: 2026-10-19
---

# Mobile Explore Sorting Requires Opening Its Sheet

## Symptom

The current-source iOS Social Gate timed out at `Explore hot sort did not
converge` after switching to Explore.

## Root Cause

The Gate selected the Hot option while the sort sheet was closed. That option
is rendered only after the visible sort control opens the sheet.

## Mitigation

The Home/Explore journey opens `social-explore-sort-open` before selecting
`social-explore-sort-hot`. Both operations use the existing real UI path;
the Gate does not inject sort state or bypass the sheet.

## How To Detect A Recurrence

```bash
python3 -m unittest tooling.acceptance.gates.mobile.simulator_social_e2e_test
```

`test_explore_sort_requires_the_visible_sheet_before_selection` rejects a
selection made while the sheet is closed. Current-source
`mobile-social-ios-native` must additionally operate the visible Explore
control, select Hot, return Home, and observe the receiver's Post.

## Crosswalks

- Mobile acceptance setup defines the source-bound Simulator proof path.
