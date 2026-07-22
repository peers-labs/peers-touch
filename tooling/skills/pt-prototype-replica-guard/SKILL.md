---
name: "pt-prototype-replica-guard"
description: "Enforces bidirectional contract between prototype and production: prototypes use the same component library as production (LobeUI + react-layout-kit + antd tokens), production replicas match prototype pixel-for-pixel."
---

# PT Prototype Replica Guard

This skill establishes a **bidirectional contract** between prototype code and production code.

**Core thesis: Prototypes are NOT Figma mockups.** They are production-intent code written with the same component library as production. The goal is direct reuse, not visual translation. When this contract is followed, moving prototype code to production is mostly copy-paste with data binding — no "translation" needed.

---

## Part 1: Prototype Authoring Contract (原型制作规范)

**All prototypes under `packages/prototypes/desktop/` MUST follow these rules.** If a prototype violates them, the defect is in the prototype, and the replica-guard enforcer must fix the prototype FIRST before copying to production.

### 1.1 Required Component Library

Prototypes MUST use the exact same UI dependencies as the production Desktop app:

| Purpose | Library | Import |
|---|---|---|
| Layout/flex containers | `react-layout-kit` | `import { Flexbox } from 'react-layout-kit'` |
| Icon buttons, SearchBar, Tag, ActionIcon, DraggablePanel, toast | `@lobehub/ui` | `import { ActionIcon, SearchBar, Tag, ... } from '@lobehub/ui'` |
| Model icons | `@lobehub/icons` | `import { ModelIcon } from '@lobehub/icons'` |
| Theme tokens, ConfigProvider, Dropdown, Tooltip | `antd` | `import { theme, ConfigProvider, Dropdown } from 'antd'` |
| Raw icons | `lucide-react` | `import { Plus, Search, ... } from 'lucide-react'` |
| i18n (when needed) | `react-i18next` | `import { useTranslation } from 'react-i18next'` |

**FORBIDDEN in prototypes:**
- ❌ Raw `<button>` for icon buttons — use `<ActionIcon>` from `@lobehub/ui`
- ❌ Raw `<div style={{ display: 'flex' }}>` for layout — use `<Flexbox>` from `react-layout-kit`
- ❌ Hardcoded color objects (`const T = { primary: '#6b5bd6', ... }`) for new/rewritten pages — use `theme.useToken()` from antd, wrapped in `ConfigProvider`. Existing pages (Shell, Settings) that pre-date this contract may keep their `T` import from `theme.ts` until they are rewritten.
- ❌ Custom search input divs — use `<SearchBar>` from `@lobehub/ui`
- ❌ Raw `<span>` for tags/badges that match LobeUI `<Tag>`
- ❌ CSS-in-JS or CSS modules — inline styles only, consistent with production code
- ❌ Tailwind, styled-components, emotion, or any other styling system

### 1.2 When Raw Elements ARE Allowed

Raw HTML elements are permitted ONLY when no production component exists for the purpose:

- ✅ `<textarea>` for the composer input (no LobeUI equivalent for multi-line auto-resize)
- ✅ `<section>` for semantic grouping
- ✅ `<button>` for text-only action buttons (like quick actions, topic actions) where ActionIcon would add unwanted chrome
- ✅ `<div>` for purely structural wrappers, divider lines, scroll containers
- ✅ `<input>` for hidden file inputs

The rule of thumb: **if production code uses a library component for that element, the prototype must use the same library component.**

### 1.3 Theme and Token Usage

Prototypes MUST use antd theme tokens via `ConfigProvider` + `theme.useToken()`, exactly like production:

```tsx
import { ConfigProvider, theme } from 'antd';

// Root of prototype app wraps content in ConfigProvider
<ConfigProvider theme={{ token: { colorPrimary: '#6b5bd6', ... } }}>
  <App />
</ConfigProvider>

// Inside components
const { token } = theme.useToken();
```

The theme config MUST set `colorPrimary: '#6b5bd6'` to match production branding.

**Allowed literal hex values** (where antd token doesn't provide the right shade — same rule as production):

| Color | Hex | Usage |
|---|---|---|
| Aside/sidebar background | `#fbfbfb` | Sidebar panels |
| Active roster item | `#eef4ff` | Selected agent background |
| Composer border | `#d1d1d1` | PromptComposer outer border |
| Composer tool button border | `#ececec` | Slash/Image button border |
| Composer tool button shadow | `0 1px 4px rgba(15,23,42,0.04)` | subtle tool button elevation |
| Send button disabled | `#d8d3fb` | disabled primary button bg |
| Toggle hover background | `#f3f1fb` | PanelToggleButton hover |

These hex literals are cross-referenced from production design tokens and are part of the design system, not ad-hoc values.

### 1.4 Component Patterns Prototypes MUST Follow

#### Icon Buttons
```tsx
// ✅ CORRECT
<ActionIcon
  icon={Plus}
  size={{ blockSize: 34, size: 15 }}
  style={{ borderRadius: 999, border: `1px solid ${token.colorBorderSecondary}`, background: '#fff' }}
  title="New Agent"
  onClick={handleCreate}
/>

// ❌ FORBIDDEN (raw button)
<button style={{ width:34, height:34, borderRadius:999, border:'1px solid #e8e8e8', ... }}>
  <Plus size={15} />
</button>
```

#### Layout Containers
```tsx
// ✅ CORRECT
<Flexbox horizontal gap={8} align="center" style={{ height: 40, marginBottom: 10 }}>
  <span>...</span>
</Flexbox>

// ❌ FORBIDDEN
<div style={{ display:'flex', gap:8, alignItems:'center', height:40, marginBottom:10 }}>
  <span>...</span>
</div>
```

#### Search Input
```tsx
// ✅ CORRECT
<SearchBar
  placeholder="Search agents..."
  value={search}
  onChange={(e) => setSearch(e.target.value)}
  allowClear
  size="small"
  style={{ borderRadius: 7, height: 40 }}
/>
```

#### Composer
The shared `PromptComposer` component MUST use ActionIcon for tool buttons and send button, raw `<textarea>` for input (acceptable per §1.2), and Flexbox for layout.

#### Tags/Badges
```tsx
// ✅ CORRECT
<Tag style={{ margin: 0, borderRadius: 999, fontSize: 11, padding: '2px 7px' }}>Label</Tag>
```

### 1.5 Prototype File Structure

```
packages/prototypes/desktop/
├── shell/src/
│   ├── main.tsx              # ConfigProvider wrapper + app mount
│   ├── theme.ts              # Exports shared literal colors NOT in antd token
│   ├── Shell.tsx             # Top-level shell layout
│   ├── AgentChatPage.tsx     # Agent chat page (uses LobeUI + Flexbox)
│   └── Settings.tsx          # Settings page
├── shared/
│   ├── PromptComposer.tsx    # Shared composer (uses ActionIcon + Flexbox)
│   ├── PanelToggleButton.tsx # Toggle button component
│   └── Toast.tsx             # Toast utilities
├── features/<feature>/src/
│   ├── panels/               # Feature panels (follow same rules)
│   └── types.ts
└── <prototype-package>/
    ├── package.json          # MUST depend on @lobehub/ui, react-layout-kit, antd, etc.
    ├── vite.config.ts        # MUST alias react/jsx-runtime/lucide-react to own node_modules
    └── tsconfig.json
```

### 1.6 Prototype package.json Dependencies

Every prototype package under `packages/prototypes/desktop/` MUST include these dependencies (versions match production Desktop):

```json
{
  "dependencies": {
    "@lobehub/icons": "^5.0.1",
    "@lobehub/ui": "^5.3.0",
    "antd": "^6.3.1",
    "lucide-react": "^0.577.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-layout-kit": "^2.0.1"
  }
}
```

(Check `apps/desktop/package.json` for the exact current versions and copy them.)

### 1.7 Vite Config Requirements

Every prototype package MUST configure `resolve.alias` in `vite.config.ts` to avoid duplicate React instances in the pnpm monorepo:

```ts
import { fileURLToPath, URL } from 'node:url';

resolve: {
  alias: [
    { find: /^react$/, replacement: fileURLToPath(new URL('./node_modules/react/index.js', import.meta.url)) },
    { find: /^react\/jsx-runtime$/, replacement: fileURLToPath(new URL('./node_modules/react/jsx-runtime.js', import.meta.url)) },
    { find: /^react\/jsx-dev-runtime$/, replacement: fileURLToPath(new URL('./node_modules/react/jsx-dev-runtime.js', import.meta.url)) },
    { find: /^lucide-react$/, replacement: fileURLToPath(new URL('./node_modules/lucide-react/dist/esm/lucide-react.js', import.meta.url)) },
  ],
},
```

The `main.tsx` MUST wrap the app in antd `ConfigProvider` with the brand theme (see §1.3).

---

## Part 2: Prototype → Production Replica Guard

When production code needs to match a prototype, follow this workflow. The goal is **copy-paste with data binding**, because Part 1 ensures prototypes use the same components.

### Step 0 — Verify Prototype Conformance (BEFORE copying)

Before reading prototype code for replication, verify it follows Part 1 rules:

1. Does the prototype file use `Flexbox` from react-layout-kit? If it uses raw `<div style={{display:'flex'}}>`, **fix the prototype first**.
2. Does the prototype file use `ActionIcon` for icon buttons? If it uses raw `<button>`, **fix the prototype first**.
3. Does the prototype use `theme.useToken()` via antd ConfigProvider? If it uses a hardcoded `T` object, **fix the prototype first**.
4. Does the prototype package.json have all required dependencies? If not, **add them first**.

If you fix the prototype during this step, commit the prototype fix separately before proceeding to production changes.

### Step 1 — Locate the Canonical Prototype File

```bash
find packages/prototypes/desktop -name "*.tsx" | xargs grep -l -i "<page-or-feature>"
```

Priority order:
1. `shell/src/<Page>.tsx` — rendered shell (highest)
2. `shared/<Component>.tsx` — shared components
3. `features/<feature>/src/panels/<Panel>.tsx` — feature panels

Read the COMPLETE file — imports, styles, JSX, state, everything.

### Step 2 — Copy Values Verbatim

Because Part 1 ensures prototypes use the same component library, production code should:

1. **Copy the component structure exactly** — same Flexbox nesting, same ActionIcon usage, same conditional rendering
2. **Copy all style values verbatim** — borderRadius, padding, margin, gap, fontSize, fontWeight, colors, boxShadow
3. **Replace antd token references** — both use `const { token } = theme.useToken()`, so `token.colorBorderSecondary` is the same variable
4. **Copy literal hex values** — `#fbfbfb`, `#eef4ff`, `#d1d1d1`, etc. are identical between prototype and production
5. **Replace mock data with real data** — `AGENTS.map(...)` becomes `agents.map(...)`, `useState` for selection becomes store selectors
6. **Replace hardcoded strings with `t('locale.key')`** — same text node, wrapped in i18n
7. **Replace mock callbacks with real handlers** — same event signature, wired to stores/APIs

### Step 3 — Verification Checklist

Before claiming replica is complete:

#### Structural parity
- [ ] Component hierarchy matches (Flexbox nesting depth, ActionIcon placement)
- [ ] Same components are used (ActionIcon vs raw button, Flexbox vs div, SearchBar vs custom)
- [ ] Conditional rendering matches (expanded/collapsed, empty/loading states)
- [ ] Scroll container assignments match (which Flexbox/div has overflow:auto)
- [ ] Positioned elements have the same parent (position:relative ancestor)

#### Value accuracy
- [ ] Every dimension (width, height, minHeight) matches
- [ ] Every spacing (padding, margin, gap) matches
- [ ] Every borderRadius matches (consult the Radius Table below)
- [ ] Every color matches (token.colorXxx or literal hex)
- [ ] Every fontSize/fontWeight matches (consult Typography Table below)
- [ ] Every icon size and strokeWidth matches (consult Icon Table below)
- [ ] Every boxShadow matches exactly
- [ ] Every border (width, style, color) matches
- [ ] Transitions include ALL properties that change between states

#### Component correctness
- [ ] Same ActionIcon `size={{ blockSize, size }}` props
- [ ] Same SearchBar props (size, style overrides)
- [ ] Same Tag styles (borderRadius, fontSize, padding)
- [ ] Same icon components (ArrowUp not Send, PanelLeftClose not ChevronLeft, etc.)

#### Interaction testing
- [ ] Collapse/expand animations are smooth
- [ ] Hover states work identically
- [ ] Text truncation (ellipsis) works on overflow
- [ ] Active/selected states display correctly in all modes
- [ ] Side-by-side browser comparison shows zero visible difference

---

## Reference Tables

These tables define the design system values used in both prototype and production. They MUST be followed exactly.

### Radius Table

| Element | borderRadius | Component |
|---|---|---|
| Header icon buttons (Plus/Workflow) | `999` | ActionIcon |
| Collapsed sidebar buttons | `12` | ActionIcon |
| Composer outer | `18` (compact) / `22` (comfortable) | `<section>` |
| Composer tool buttons | `8` | ActionIcon |
| Send button | `10` (compact) / `12` (comfortable) | ActionIcon / raw `<button>` |
| Agent roster row (expanded) | `10` | raw `<button>` |
| Agent roster item (collapsed) | `12` | raw `<button>` |
| Search bar | `7` | SearchBar (style override) |
| Chat header bar | `12` | Flexbox |
| Welcome card | `14` | Flexbox |
| Badge/Tag pills | `999` | Tag |
| Topic action button | `7` | raw `<button>` |
| Agent card (topic sidebar) | `10` | Flexbox |
| Panel toggle button | `7` | raw `<button>` (in PanelToggleButton) |
| Overlay close (narrow) | `8` | ActionIcon |
| Quick action buttons | `0` (no border) | raw `<button>` |
| Message artifact panel | `10` | `<pre>` |

### Icon Size Table

| Usage | `size` | `strokeWidth` | Component |
|---|---|---|---|
| Header action icons | `15` | default | ActionIcon |
| Collapsed sidebar icons | `16` | default | ActionIcon |
| Search box magnifier | `14` | default | SearchBar (prefix) |
| Agent row more (⋯) | `14` | default | MoreHorizontal inline |
| Chat header settings | `15` | default | ActionIcon / inline |
| Panel toggle arrows | `15` | `1.85` | PanelLeftClose/Open |
| Composer tool icons | `13` | Slash: `2.1`, Image: `2` | ActionIcon |
| Composer send ArrowUp | `16` (compact) | `2.1` | ActionIcon / button |
| Narrow List icon | `15` | default | ActionIcon |
| Close (X) overlay | `15` | default | ActionIcon |
| Sparkles (gold) | `14` | default | inline |
| Topic action icons | `15` | default | inline |
| ChevronDown group | `13` | default | inline |
| Quick action icons | `13` | default | inline |
| Capability bar check | `13` | default | CheckCircle2 inline |

### Typography Table

| Element | fontSize | fontWeight | Component |
|---|---|---|---|
| Section title ("My Agents") | 14 | 800 | `<span>` |
| Chat header name | 14 | 850 | `<strong>` |
| Welcome card title | 17 | 800 | `<h2>` |
| Agent row name | 12 | 750 | `<span>` |
| Topic card name | 15 | 750 | `<span>` |
| Topic group header | 12 | 700 | `<span>` |
| Badge/Tag text | 11 | 650 | Tag |
| Roster group label | 12 | 650 | `<span>` |
| Agent row description | 11 | normal | `<span>` (marginTop: 2) |
| Card description | 11 | normal | `<span>` (marginTop: 3) |
| Chat header description | 12 | normal | `<span>` |
| Welcome body text | 13 | normal | `<p>` (lineHeight: 1.6) |
| Capability bar | 11 | normal | `<span>` |
| Quick action text | 11 | 600 | `<span>` (no border, no bg) |
| Search placeholder | 12 | normal | SearchBar |
| Topic item text | 12 | normal | `<span>` |
| Group line label | 11 | normal | `<span>` |
| Model selector label | 13 | normal | `<span>` |
| Composer textarea | 14 (compact) | normal | `<textarea>` (lineHeight: 1.5) |

### Container Widths

All content columns in the chat area are constrained to `min(620px, calc(100% - 36px))`, centered with `margin: '0 auto'`:

- Chat header wrapper: `width: 'min(620px, calc(100% - 36px))', margin: '12px auto 0'`
- Welcome card: `width: 'min(620px, calc(100% - 36px))'`
- Quick actions: same as welcome card
- Composer wrapper: `width: 'min(620px, calc(100% - 36px))', margin: '0 auto 18px'`
- Narrow mode (< 900px): all become `width: 'calc(100% - 28px)'`

### Shadow Table

| Element | boxShadow |
|---|---|
| Chat header | `'0 4px 18px rgba(15,23,42,0.04)'` |
| Welcome card | `'0 8px 28px rgba(15,23,42,0.05)'` |
| Composer tool buttons | `'0 1px 4px rgba(15,23,42,0.04)'` |
| All other elements | `'none'` or `undefined` |

**Do NOT use heavy shadows** like `'0 8px 32px rgba(15,23,42,0.06)'` or `'0 12px 35px rgba(15,23,42,0.06)'` — they are not in the design system.

### Transition Rule

When a property changes between states (e.g., width, padding, height on collapse/expand), **every changing visual property MUST be in the transition string**:

```tsx
// Aside collapses width: 230→48 AND padding: '14px 10px 58px'→'14px 0 58px'
transition: 'width 0.18s ease, padding 0.18s ease'
```

Audit which properties change. List ALL of them. Missing a property causes visible jank.

### Structural Contract: Sidebar Layout

Expanded:
```
<aside>
  <Flexbox height={40} gap={8} align="center" marginBottom={10}>  {/* header */}
    <span flex={1}>My Agents</span>
    <ActionIcon icon={Plus} />
    <ActionIcon icon={Workflow} />
  </Flexbox>
  <SearchBar style={{ borderRadius:7, height:40 }} />            {/* search */}
  <Flexbox flex={1} style={{ minHeight:0, overflow:'auto' }}>    {/* scroll area */}
    <RosterGroup label="Pinned" />
    {pinned.map(agent => <AgentRow agent={agent} />)}
    <RosterGroup label="All Agents" />
    {others.map(agent => <AgentRow agent={agent} />)}
  </Flexbox>
  <PanelToggleDock side="left" />                                {/* absolute positioned */}
</aside>
```

Collapsed:
```
<aside>
  <ActionIcon icon={Plus} style={{ margin:'0 auto 10px', borderRadius:12 }} />
  <ActionIcon icon={Search} style={{ margin:'0 auto 2px', borderRadius:12 }} />
  <div style={{ flex:1, minHeight:0, overflow:'auto', display:'flex', flexDirection:'column', alignItems:'center', width:'100%' }}>
    <CollapsedDivider />
    {pinned.map(agent => <CollapsedAgentButton agent={agent} />)}
    <CollapsedDivider />
    {others.map(agent => <CollapsedAgentButton agent={agent} />)}
  </div>
  <PanelToggleDock side="left" />
</aside>
```

### Hover States

Only the following elements have explicit hover styles:
- **PanelToggleButton**: bg → `#f3f1fb`, color → `#6b5bd6` (implemented via onMouseEnter/onMouseLeave)
- **Quick action buttons**: NO hover color change (plain text only)
- **Topic action buttons**: NO explicit hover (transparent buttons, default cursor feedback is sufficient)
- **Agent rows**: NO explicit hover (active state uses `#eef4ff` background)
- **ActionIcon components**: Rely on LobeUI's built-in hover behavior; do not add custom onMouseEnter unless prototype specifies it

Do NOT add hover effects that the prototype doesn't define.

---

## Anti-Patterns (These Will Be Rejected)

### In Prototypes (Part 1 violations)
1. **Raw `<button>` where `ActionIcon` exists** — prototype authoring error, must be fixed
2. **Raw `<div style={{display:'flex'}}>` where `Flexbox` should be used** — prototype authoring error
3. **Hardcoded `T` color object instead of `theme.useToken()`** — prototype authoring error
4. **Custom search div instead of `SearchBar`** — prototype authoring error
5. **Missing dependencies in package.json** — prototype won't run, must be fixed

### In Production (Part 2 violations)
6. **"It looks close enough"** — Read the numbers. 2px difference is visible.
7. **Using screenshots as reference** — Read source code. Screenshots lie about exact values.
8. **Circular send button** — Send is 34x34, borderRadius:10, ArrowUp icon.
9. **Send/PaperPlane icon instead of ArrowUp** — Prototype uses ArrowUp.
10. **Model selector centered with pill background** — Must be right-aligned, transparent.
11. **Centered model selector** — Always right-aligned between spacer and send button.
12. **Heavy shadows** — Use only the shadows defined in Shadow Table.
13. **Wrong border color on composer** — Must be `#d1d1d1`, not an antd token.
14. **Adding hover effects not in prototype** — Don't improve on the design.
15. **ActionIcon without style overrides** — ActionIcon defaults to circular; always override borderRadius/border/background to match design.
16. **Only transitioning `width` on panels** — Include padding (and any other changing property).
17. **Putting collapsed Plus/Search inside scroll container** — They must be fixed at top.
18. **SearchBar without style overrides** — Must be height:40, borderRadius:7.
19. **Incremental patches** — Fix ALL wrong values in one pass.
20. **"Improving" the design during replication** — Translate, don't redesign.

---

## Common Pitfalls (We've Already Paid For These)

### 1. Composer was misread as ComposerBar (feature-level variant)
- **Problem:** Agent read `features/agent/src/panels/ComposerBar.tsx` instead of `shared/PromptComposer.tsx`.
- **Fix:** Follow imports from the shell page. `AgentChatPage.tsx` imports from `../../shared/PromptComposer`.

### 2. Collapse/expand jank from incomplete transition
- **Problem:** `transition: 'width 0.18s ease'` missed padding change.
- **Fix:** Audit ALL changing properties. Include them all in transition string.

### 3. Collapsed icons floating / misaligned
- **Problem:** Plus/Search were inside the same Flexbox as the agent rail, causing even distribution.
- **Fix:** Plus/Search are direct children of aside (separate from scroll rail). Rail is flex:1, overflow:auto, column center.

### 4. Model selector wrong style
- **Problem:** Agent built a centered pill-shaped model selector with filled background.
- **Fix:** Model selector is right-aligned, transparent background, border:0, height:28, fontSize:13, gap:4, with ⌄ chevron.

### 5. Wrong border color
- **Problem:** Used `token.colorBorderSecondary` (#e8e8e8) for composer border.
- **Fix:** Composer uses its own darker border `#d1d1d1` (defined in shared literal colors table).

### 6. Prototype used raw buttons instead of ActionIcon
- **Problem:** Prototype had raw `<button style={...}>` which made production translation a guessing game about ActionIcon overrides.
- **Fix:** Prototype MUST use ActionIcon (per Part 1). When found, fix prototype first, then copy to production.

---

## Running Prototype and Production Side-by-Side

```bash
# Terminal 1: Prototype
cd packages/prototypes/desktop/shell && pnpm install && pnpm dev
# → http://localhost:5173 (or check Vite output for port)

# Terminal 2: Production Desktop Web
cd apps/desktop && pnpm dev
# → http://localhost:3310

# Or use make targets:
make run-prototype   # starts prototype
make desktop-web     # starts desktop web dev
```

Open both in browser windows side-by-side at the same viewport width for pixel comparison.

---

## Non-Goals

- This skill does NOT decide the visual design — the prototype does.
- This skill does NOT cover backend, Station, Model, or Rust code.
- This skill does NOT permit "design improvements" over the prototype. If you think the prototype is wrong, report it to the user.
- This skill does NOT replace `pt-prototype-sync-guardian` (production → prototype direction).
- This skill does NOT apply to Lynx/mobile prototypes — those follow their own platform conventions.
