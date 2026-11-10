---
name: "pt-prototype-parity"
description: "Aligns a production desktop surface (chat/settings) to its confirmed north-star prototype value-by-value using peers-ui primitives. Invoke when implementing or auditing prototype parity for layout, element usage, color, motion, or dark mode."
stage: "execute"
requires:
  - "confirmed prototype component + CSS (packages/prototypes/shared/ui-system)"
  - "production counterpart under apps/desktop/src"
  - "agreement that real product functions are authoritative over prototype mocks"
produces:
  - "parity edits on the production surface (no feature add/remove)"
  - "source-contract tests locking the aligned values"
  - "objective value-diff evidence across geometry/color/motion/position/dark"
  - "an explicit residual list classified as superset / missing-feature / excluded"
---

# PT Prototype Parity

Deterministic workflow for bringing a production Desktop surface into **value
parity** with its confirmed north-star prototype, while never changing product
behavior. This is the *how* companion to `pt-prototype-replica-guard` and
`pt-prototype-sync-guardian` (which state the rule); this skill is the concrete
replacement, diff, contract, and gate procedure.

## 0. Non-negotiable split

- **Function = production (Desktop) truth.** Real APIs, transfer lifecycles,
  store-backed state, acceptance hooks, and richer controls stay. Do not add a
  function the prototype only mocks unless production already has it.
- **Style / usage / motion = prototype truth.** Every visible element must be a
  peers-ui primitive used the same way, with the same geometry, color token,
  easing, and duration.
- **Agent / social(moments) scope**: menu entry only; do not align their
  content. Call simulators, author/moments/profile-social cards, and agent
  panels stay out of scope.

## 1. Locate the pair

- Prototype: `packages/prototypes/shared/ui-system/{chat,identity,design-directions,settings}`.
- Production: `apps/desktop/src/components/**`, `apps/desktop/src/ui/{chat,northstar}.css`.
- Naming map: prototype prefixes `sk-*`, production ports to `sc-*` with
  `--sk-*` aliased onto `--pt-*` tokens under `.sc-settings` / app theme.
- BEM is renamed freely (`sk-thread-root` → `sc-thread__section`,
  `sk-file-chip` → `sc-attachment-details*`). Match by **role, not literal name**.

## 2. Per-element classification (decide before editing)

For each prototype element, classify exactly one:

1. **Deviation → fix.** Production uses a bespoke element, wrong primitive
   props, or a value that differs from the prototype.
2. **Real superset → keep.** Production adds genuine behavior (portals, real
   transfer, extra columns, richer state). Align its *visual grammar* to the
   prototype but preserve the behavior.
3. **Mock only, production has no feature → do not build.** No placeholder UI.
   (e.g. notifications/appearance/privacy toggles, block list when no API.)
4. **Excluded domain → skip.** agent, moments, call simulators.

Never downgrade a superset to match a simpler mock.

## 3. Primitive replacement rules

- Replace bespoke/antd controls with `@peers-touch/ui`: `Button/IconButton`,
  `Segmented`, `Switch`, `Checkbox/RadioGroup`, `Select`, `TextField/TextArea`,
  `Dialog`, `Popover/Tooltip`, `Toggle`, `Tag`, `Empty`, `Menu`, `Avatar`.
- Canonical prop vocabulary: `actionId`, `emphasis`, `density`,
  `availability={{kind:'disabled',reason}}` + `execution` (never `disabled` on
  IconButton), `iconId`/`iconSize` (no lucide inside peers tiles),
  `onActivate`, `leading`.
- Native raw buttons/inputs are allowed only where the prototype itself uses
  them (reaction emoji cells, call controls, selectable rows, PIN OTP, the
  hidden draft file input).
- Drive paint from classes; delete inline `style` for static geometry/color.
  Keep inline only for measured/runtime values (positions, widths).

## 4. Value parity — make it objective, not eyeballed

Run these scripts from repo root; treat every hit as a decision
(fix / justify as superset / excluded). They are the completion evidence.

Geometry (radius/font/height/width/padding/gap), color mapping, durations +
easings, positioning, and margins are each diffed. Reusable one-shot pattern:

```js
// node -e '…' : read prototype CSS + app CSS, regex out rules, compare values.
// Geometry:   concrete props radius/font-size/height/width/padding/gap
// Position:   top/left/right/bottom/inset (skip auto/0/%/calc/var)
// Motion:     all transition/animation ms durations + cubic-bezier curves
//              (normalize ".22" === "0.22" before comparing easings)
// Margins:    margin / margin-top px
```

Color parity is structural, not literal: map `--sk-* → --pt-*`
(text→text, text-2→secondary, text-3→muted, tile→subtle, card-bg/overlay→
surface, canvas→canvas, card-border→border, primary-ink→onPrimary,
danger/warning/success/info same-name) and assert every mapped token is used.
Then audit residual hard-coded colors; allowed fixed materials only:
video black `#000`, white-on-own-bubble overlays, wallpaper preset gradients,
avatar dark scrim, and the fixed telecom constants `#b0413a`,
`#3f9142 accept`, `#e4e7ec pressed`. Dark mode is safe only because all
semantic surfaces are tokens — verify `UIProvider` injects
`tokenVariables(mode)` and there are no hard-coded light surfaces.

## 5. Source-contract tests (lock every fix)

Add a co-located `*Alignment.test.ts` that reads the `.tsx`/`.css` as text and
asserts the exact aligned declaration/primitive/hook. Helper:

```ts
const css  = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const src  = readFileSync(new URL('./X.tsx', import.meta.url), 'utf8');
const rule = (sel) => css.match(new RegExp(sel + '\\s*\\{([^}]*)\\}'))?.[1] ?? '';
expect(rule('\\.sc-foo')).toContain('border-radius: 999px');
expect(src).toContain('iconId="close"');
```

Also assert negatives that prevent regression (e.g. a rhythm element must stay
mounted: `expect(src).not.toContain('{!open && <h2')`).

## 6. Guard sequence (must be green before claiming parity)

```
node tooling/scripts/review/primitive-layer-guard.mjs          # zero new
node tooling/scripts/review/pt-token-reference-guard.mjs       # 66 tokens
cd apps/desktop
pnpm exec tsc --noEmit
pnpm exec vitest run          # 0 real failures (6 known Playwright *.spec.ts
                              #   collection errors are pre-existing baseline)
pnpm run check                # locale parity + social wires + boundaries
pnpm run build
```

## 7. Pitfalls already paid for

- **Preserve acceptance data hooks.** When moving an action into a header or
  restyling, grep `tooling/acceptance/gates` for its selector
  (`data-chat-*`, `data-*-action`, `data-*-draft-*`, `data-*-thread-*`) and
  keep the hook on a reachable element.
- **Constant rhythm prevents jump.** Band headers are a fixed 52px; labels
  that reserve vertical space must stay mounted while a sibling toggles (the
  rail Recent-title bug).
- **Do not invent determinate progress** for staging with no percent channel;
  render an indeterminate overlay track instead.
- **Remove debug residue** (`fetch http://127.0.0.1:7778`, `debug-point`,
  `console.*`) found in the surface; do not extend such cleanup into excluded
  agent/kernel files in the same change.
- **Real facts over fixtures**: version/PTID/avatar/platform come from host
  APIs (`@tauri-apps/api/app`, UA), never hard-coded demo numbers.
- `.sk-settings-section` intentionally hides its heading icon via CSS; mirror
  that, do not "fix" it by showing the icon.

## 8. Completion boundary

Source parity is provable (scripts + contracts + gates). Final pixel/input/
portal/motion confirmation on a **real-device WKWebView** is environmental and
must be explicitly done by the operator; do not mark the work complete from
source evidence alone.
