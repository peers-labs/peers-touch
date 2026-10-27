# EDX-B01: Choose a Station and Continue

## Starting Context

The user opens the Mobile prototype. One saved Station is reachable and already
selected.

## User Goal

Understand which Station will be used and proceed into the next access step.

## Required Sources

- `packages/prototypes/mobile/chat/src/pages/LaunchScreen.tsx:21-47`
- `packages/prototypes/mobile/chat/src/components/StationSelector.tsx:26-126`
- `docs/client/mobile/lifecycle.md:58-85`
- `docs/client/common/ux-design-methodology.md:20-75`

## States To Walk

- no saved Station;
- one saved Station validating;
- one saved Station reachable and selected;
- add Station;
- remove Station confirmation.

## Review Boundary

Review the visible content hierarchy, selection meaning, action meaning, and
state feedback. Do not assess backend Station identity verification from this
prototype alone.

Return the report required by `rubric.md`.
