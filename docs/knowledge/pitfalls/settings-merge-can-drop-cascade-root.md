---
kind: pitfall
title: Settings merge can restore legacy composition while its CSS guards pass
status: active
owns:
  - apps/desktop/src/pages/SettingsPage.tsx
  - apps/desktop/src/pages/settingsSurface.test.tsx
  - apps/desktop/src/components/settings/
  - apps/desktop/src/ui/northstar.css
related:
  - docs/architecture/platform/client/ui-system/prototype/north-star-frame.md
  - docs/architecture/domains/agent/provider-control-plane.md
detected: 2026-11-15
owner: Client Platform
review-cadence: on-change
---

# Symptom

Settings regains a large page heading and legacy underline tabs. Its cards
crowd the window edge and migrated sections lose their shared appearance,
although the CSS token tests still pass.

# Cause

Merge `78f349a89` selected the incoming legacy `SettingsPage.tsx` file after
the UI accepted in PR #186. The old Flexbox root omitted `.sc-settings`,
so the gutter and `--sk-*` aliases no longer inherited into section content.
The merge also restored the old internal presentation components. Checking
CSS declarations alone did not exercise this missing composition boundary.

# Mitigation

Compare the entire accepted page, not only conflicted lines. Restore its
root, compact navigation, internal peers-ui composition, and `SectionHost`
boundary together. Keep subsequent intentional domain changes: Provider and
Federation administration remain in Dashboard.

# How to detect a recurrence

```sh
pnpm --dir apps/desktop exec vitest run \
  src/pages/settingsSurface.test.tsx \
  src/components/settings/tokenReferenceAlignment.test.ts \
  src/components/settings/settingsGovernanceAlignment.test.ts
```

The rendered surface test must put the actual active panel inside
`.sc-settings` and its single scroll layer, preserve the compact group island
and section rail, omit empty groups, and avoid mounting unrelated panels.
Inspect the real native Settings window at wide and narrow sizes, including
Account, General/PIN dialog, AI, Channels, Advanced storage, and Help.
Treat screenshots as UX evidence, not formal functional Acceptance.
