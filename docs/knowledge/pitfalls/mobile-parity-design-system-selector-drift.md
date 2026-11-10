---
kind: pitfall
title: Mobile parity harness must follow design-system DOM, not Ant classes
status: active
owns:
  - tooling/acceptance/gates/mobile/simulator_social_e2e.py
  - tooling/acceptance/gates/mobile/simulator_social_e2e_test.py
  - packages/ui/web/src/actions.tsx
  - packages/ui/web/src/selection.tsx
  - apps/mobile/src/pages/moments/SocialSearchPage.tsx
  - apps/mobile/src/pages/moments/SocialCircleMemberPickerPage.tsx
referenced-by: []
related:
  - docs/architecture/engineering/acceptance/design.md
detected: 2026-11-10
---

# Mobile parity harness must follow design-system DOM, not Ant classes

## Symptom

The `mobile-social-ios-native` parity Gate failed inside the search-profile
scenario with an Appium element-not-found, then with a Federation selection
that "did not converge", even though the Station had an active seeded
Federation and every runtime reported ready.

## Root cause

The peers-ui landing replaced Ant Design controls with the in-house
`@peers-touch/ui` design system, but the parity harness still targeted Ant
markup and native control semantics that no longer exist:

- Radios moved from `label.ant-radio-wrapper > input` to
  `label.pt-check-label > input` inside a `.pt-choice-group`.
- Selects moved from `.ant-select` / `.ant-select-item-option` to a
  `.pt-select-trigger` button opening a `.pt-select-options[role="listbox"]`
  of `.pt-select-option[role="option"]` buttons.
- Submit affordances moved from an Ant `.ant-input-search-btn` to design-system
  Buttons/IconButtons carrying `data-action-id`.
- TextField spreads `data-acceptance-id` onto the input itself, so a
  descendant `... input` selector never matched.
- Design-system Buttons intentionally omit the native `disabled` attribute
  (B19) and signal unavailability through `aria-disabled`; a check on
  `element.disabled === false` therefore never converged.
- One-shot native `find_element`/`click_element` calls do not reliably drive
  controlled React inputs inside the WKWebView; in-page polling JS clicks do.

## Mitigation

Selectors target stable design-system hooks: acceptance ids,
`data-action-id`, `.pt-*` classes, and ARIA roles. Availability is read from
`aria-disabled`, never the native disabled attribute. Radio and Select
operations poll through in-page JS that clicks the actual input/option and
only converge once the controlled state (`checked`, selected index, enabled
affordance) is observed. Each structural change is asserted in the gate unit
tests so a future component migration fails fast without a device run.
Federation radios are waited for before selection so an empty directory is
distinguished from a failed click, and convergence failures emit the live
radio/fieldset/button state instead of a generic timeout.

## How to detect a recurrence

Run `python3 -m unittest tooling.acceptance.gates.mobile.simulator_social_e2e_test`.
A selector or control-semantics regression fails the radio, Select and
Federation-before-submit tests. On a real run, a "radios absent" or
"did not converge" GateError now carries the observed DOM, including radio
values/checked state, fieldset count and visible page text, so the drift can
be classified without attaching a debugger.
