---
status: active
owner: Client Platform
updated: 2026-11-15
review-cadence: on-change
---

# Desktop window interaction boundary

AppShell owns native window interaction, as defined by
[the frontend component tree](../common/ui-identity/frontend-component-tree.md#41-appshell).
`components/shell/WindowDragRegion.tsx` is its sole renderer adapter.
Modules compose that boundary onto their existing header root; they do not
install document listeners or call `startDragging` themselves. Tauri owns
composed-path hit testing, native movement and platform double-click behavior.
The adapter adds one attribute to one child and creates no DOM container,
Store, effect, subscription or lifetime policy.

## Region contract

| Region | Mode | Behavior |
| --- | --- | --- |
| Window/pane header | `deep` (default) | Title, decorative icon and blank header space drag |
| Frame margins, empty pane background | `self` | Only direct hits on the region root drag |
| Custom interaction, search field chrome, tabs, menu, resize handle | `none` | This subtree blocks dragging through ancestors |
| Page content, cards, messages, composer, applet body, overlays | No region | Original selection, scroll and control behavior |

Tauri automatically excludes native links, buttons, inputs, selects,
textareas, labels, summaries, editable elements, focusable controls and
interactive ARIA roles. A raw `div`/`span` with `onClick` is not recognized:
its interaction owner must consume `mode="none"` or use the appropriate
native control. Do not attach a positive marker to a control itself; an
explicit marker overrides Tauri's automatic exclusion.

A `self` region only drags on a direct hit: Tauri requires the event target
to be the marked element itself (`el === composedPath[0]`). Therefore a
blank pane that must drag cannot also be `pointer-events: none` — a
hit-transparent layer lets the event fall through to whatever is beneath,
which is usually an unmarked root that never satisfies the self test. Give
the draggable blank layer its own `WindowDragRegion` (`self` for an empty
pane background, `deep` when descendants must drag too) and let it receive
pointer events. This is how the closed-work `sc-chat-rest-placeholder`
recovered window dragging on the empty conversation stage.

The single child must forward DOM attributes to its root. Use the real
`header`, `div`, `nav`, `aside` or an attribute-forwarding component.
Fragments and components that discard attributes are invalid boundaries.
Shared components stay host-neutral: `MomentScopeBar` forwards root DOM
attributes and uses a native label for its clickable search frame; it does
not import Tauri or the Desktop adapter.

Keep existing header geometry and the accepted L1/L2/L3 colors.
This boundary does not force all pane heights to match, add a second title
bar, move traffic lights, or change PageHost/SectionHost ownership.

## Surface coverage

| Owner | Header/region consumers |
| --- | --- |
| AppShell | GlobalLayout perimeter, AppSideNav, standalone LoginPage |
| Messaging | Session list/search mode, conversation/open intent, detail, thread |
| Agent | Conversation/search mode, Agent roster, Topic header/action band, collapsed rails, Profile title row, Atelier, Canvas |
| Agent work area | Workbench launcher/tab header and Portal title/navigation |
| Social | Feed/Circles scope bar, detail Back row, profile Back row |
| Settings | Stable group bar for every group and registered section |
| Common pages | Home, Applets, Groups, Tasks, Evaluation, SearchReturnBar |
| Applet host | PageHeader used by AppletContainerShell and runtime preparing/error states |

Settings subsection headings, message/card headers and dialog titles are
content, not window chrome. Applet immersive content remains applet-owned.
The source guard explicitly classifies existing content `header` elements
and rejects a new unclassified header. When adding a header rendered with
another element, add its rendered hit targets to the contract fixtures.

## Verification

`WindowDragRegion.test.tsx` renders real Settings, common PageHeader,
MomentScopeBar, Portal and both Workbench header states. It verifies DOM
shape, native attribute ownership and the source header classification.
The opt-in fixture export supports the browser contract check described in
[the regression runner](../../../tooling/scripts/review/window_chrome_hit_testing.py).
The runner binds fixture source hashes, checks the locked Tauri version, and
executes that version's original `drag.js` with a command recorder in a real
headless browser. It covers title/blank hits, nested SVG controls, custom
tabs, field chrome, resize handles, content, right click, double click and
macOS canceled double click at wide/narrow widths.

These checks prove renderer composition and native command selection.
Physical NSWindow movement must also be exercised in the normal `make
desktop` window under the qualified native-input policy. Screenshots,
Accessibility window frames and recorded commands do not prove physical
dragging. Browser fixtures are isolated component checks, never a Desktop
browser shell or formal product Acceptance.

```sh
PT_WINDOW_CHROME_FIXTURES=/tmp/window-chrome-fixtures.json \
  pnpm --dir apps/desktop exec vitest run src/components/shell/WindowDragRegion.test.tsx
python3 tooling/scripts/review/window_chrome_hit_testing.py \
  --fixtures /tmp/window-chrome-fixtures.json \
  --tauri-script /path/to/tauri-LOCKED_VERSION/src/window/scripts/drag.js \
  --browser /path/to/headless/chromium \
  --output /tmp/window-chrome-contract.json
```
