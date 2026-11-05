---
kind: pitfall
title: UA-default scrollbars paint thick admin chrome inside the quiet frame
status: active
owns:
  - packages/prototypes/shared/ui-system/design-directions.css
  - packages/prototypes/shared/ui-system/chat/chat.css
  - packages/prototypes/portal/src/App.tsx
  - packages/prototypes/portal/src/responsive.css
  - tooling/scripts/ui-system/craft-battery.mjs
  - tooling/scripts/ui-system/suites/north-star.suite.json
related:
  - docs/architecture/platform/client/ui-system/prototype/north-star-frame.md
detected: 2026-11-03
owner: Client Platform / UI System
review-cadence: on-change
---

# UA-default scrollbars paint thick admin chrome inside the quiet frame

## Symptom

The contacts pane (and every other scrolling surface) rendered the browser's
classic scrollbar: a thick, solid, near-opaque gray gutter with a full-height
track, reported as "这滚动条，可以跑火车了". It visually overwhelmed the
hairline list rows and broke Quiet Protocol Minimalism.

## Root cause

The frame had no scrollbar grammar at all — no `scrollbar-width`, no
`::-webkit-scrollbar` rules. Every `overflow: auto` surface fell back to the
UA default, which on systems configured to always show scrollbars is the
classic thick bar. Fixing it per container would have left every new
scrollable surface to rediscover the same defect.

## Mitigation

One grammar, two scopes (they MUST stay geometrically identical — a thick
harness bar beside a thin product bar reads as two competing languages):

1. `.sk-theme` in `design-directions.css` — the frame and portaled overlays.
2. `.prototype-portal-preview-body` in `packages/prototypes/portal/src/responsive.css`
   — the harness scroll host is an ANCESTOR of `.sk-shell`, so scope 1 cannot
   reach it; this was the 2026-11-05 recurrence (the "粗的粗，细的细" report).

Both scopes:

- `scrollbar-width: thin` + `scrollbar-color` for the Firefox channel.
- WebKit channel: 10px transparent gutter, transparent track/corner,
  thumb painted as a 4px neutral pill inside the gutter
  (`border: 3px solid transparent; background-clip: padding-box`),
  resting alpha .16, hover .30, full pill radius. No arrows, no track fill.

Horizontal: lists own their minimum width (e.g. `.sk-chat-feature`
`min-width: 640px`) and the preview host is `overflow-x: hidden` — under
squeeze the surface clips instead of growing a horizontal UA bar; a list
crushed below its readable minimum has no meaning.

## What guards against regression

Craft battery rule C16 iterates every scrollable element inside `.sk-theme`
AND every `.prototype-portal-preview-body`, and fails when the webkit gutter
exceeds 10px, the track alpha exceeds .05, or the resting thumb alpha exceeds
.4. The full north-star suite runs it across every surface state.

Implementation caveat: the battery body is a template literal that is
`eval`'d in the page. Regex backslashes must be doubled (`/\\/\\s*…/`); a
single `\s` collapses to a literal `s`, turning `/\/\s*/` into a `//` line
comment and producing a non-obvious `SyntaxError: Unexpected token 'if'` at
eval time. Computed colors also serialize as `color(srgb r g b / a)`, so the
alpha parser must handle the slash syntax in addition to `rgba()`.

## How to detect a recurrence

```sh
node tooling/scripts/ui-system/evaluate-specimens.mjs \
  --suite tooling/scripts/ui-system/suites/north-star.suite.json \
  --base http://localhost:3291
```

rollup must be `OBSERVED`; offenders `loud-scrollbar-gutter`,
`painted-scrollbar-track`, and `loud-scrollbar-thumb` must be absent.

## Crosswalks

- Frame grammar and gate:
  `docs/architecture/platform/client/ui-system/prototype/north-star-frame.md`
- Related control-chrome leak:
  `docs/knowledge/pitfalls/prototype-embedded-control-chrome-leak.md`
