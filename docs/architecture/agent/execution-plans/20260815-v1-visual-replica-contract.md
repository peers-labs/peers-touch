# Modern Chat Agent V1 — Visual Replica Contract

> **Status**: deferred
> **Version**: v1.0
> **Created**: 2026-08-15 | **Updated**: 2026-08-15
> **Owner**: Peers-Touch Agent Team
> **Companion Plan**: `20260815-v1-first-useful-answer.md`

---

## 1. Purpose

This contract prevents V1 implementation from satisfying backend and store
requirements while leaving the old Agent UI in place.

Functional parity is the current delivery priority. This contract is retained
as the later pixel-level hardening source and is not a prerequisite for
functional workstreams in `20260815-v1-first-useful-answer.md`.

The First Useful Answer plan defines product behavior and runtime ownership.
This companion contract defines how the visible implementation is derived,
copied, measured, and rejected when it diverges.

No prose-only design interpretation is allowed. Every V1 production surface
must pass this chain:

```text
LobeHub source behavior
  -> Peers UI Identity disposition
  -> production-intent prototype using production components
  -> fixed-view visual and DOM baseline
  -> value-for-value production replica
  -> computed-style and screenshot comparison
  -> native Tauri functional readback
```

## 2. What “Pixel-Level” Means

Pixel-level does not mean manually guessing coordinates from a screenshot.
It means:

1. component hierarchy comes from inspected source;
2. dimensions, spacing, typography, borders, radius, shadows, icons, and
   transitions are copied from a confirmed production-intent prototype;
3. prototype and production use the same component libraries and theme tokens;
4. geometry and computed styles are compared at identical viewports;
5. screenshots are compared after fonts, data, animation, and theme are fixed;
6. any visible difference requires an explicit disposition, not “close enough”.

The benchmark screenshot is evidence of appearance, not the source of numeric
values. Numeric values come from source and computed styles.

## 3. Truth Hierarchy

When sources disagree, use this order:

1. Peers product journey and UI Identity.
2. Confirmed V1 production-intent prototype.
3. LobeHub source behavior and component structure.
4. Live LobeHub computed styles and screenshots.
5. Historical `agent-lobehub-parity` screenshots and DOM evidence.
6. Existing Peers production UI.

The existing production UI is last because V1 replaces it.

## 4. Existing Evidence Audit

### 4.1 Historical parity prototype

Path:

```text
packages/prototypes/desktop/features/agent-lobehub-parity/
```

Audit:

| Fact | Result |
|---|---|
| TSX size | 3,807 lines |
| CSS size | 9,194 lines |
| Raw button count | 382 |
| `react-layout-kit` usage | absent |
| `@lobehub/ui` usage | absent in the main prototype |
| antd `theme.useToken()` usage | absent |
| Verdict | research evidence only; forbidden as replica source |

Its screenshots and DOM JSON may prove that a state was considered. They do
not authorize copying its component structure or CSS.

### 4.2 Desktop Shell Agent Chat

Path:

```text
packages/prototypes/desktop/shell/src/AgentChatPage.tsx
```

Audit:

| Requirement | Result |
|---|---|
| LobeUI | `ActionIcon`, `SearchBar`, `Tag` |
| Layout | `Flexbox` from `react-layout-kit` |
| Tokens | `theme.useToken()` |
| Shared composer | `shared/PromptComposer.tsx` |
| Dependencies | exact production versions |
| Verdict | production-intent candidate; requires V1 state completion and visual capture |

The file's structure and style values are the starting point for V1 Chat. It
must not be translated through the old production `AgentChatPage` styles.

### 4.3 Agent Profile prototype

Path:

```text
packages/prototypes/desktop/features/agent/src/panels/AgentProfile.tsx
```

Audit:

- uses legacy `T` color constants;
- uses raw icon buttons where `ActionIcon` exists;
- persists mock state through `localStorage`;
- does not use `theme.useToken()` or `Flexbox`.

Verdict: must be rewritten inside Desktop Shell before production replication.

### 4.4 Settings prototype

Path:

```text
packages/prototypes/desktop/shell/src/Settings.tsx
```

Audit:

- uses legacy `T` theme constants;
- implements local `Select`, `Toggle`, `Tag`, and button atoms;
- Provider state is mock component state;
- does not implement LobeHub provider-detail state ownership.

Verdict: V1 Provider slice must be rewritten before production replication.

## 5. Required V1 Prototype Surfaces

The V1 prototype stays inside the single Desktop Shell. It must not create a
new Portal card.

### V1-VS01: Provider detail

User-visible state:

- Provider selected.
- Credential empty/editing/saving/checking/ready/invalid.
- Models loading/ready/empty/fetch-error.
- One contextual return-to-Agent action after readiness.

LobeHub source anchors:

```text
src/routes/(main)/settings/provider/_layout/Desktop/Container.tsx
src/routes/(main)/settings/provider/ProviderMenu/index.tsx
src/routes/(main)/settings/provider/ProviderMenu/List.tsx
src/routes/(main)/settings/provider/features/ProviderConfig/index.tsx
src/routes/(main)/settings/provider/features/ProviderConfig/Checker.tsx
src/routes/(main)/settings/provider/features/ModelList/index.tsx
src/routes/(main)/settings/provider/features/ModelList/ModelItem.tsx
```

Observed source metrics:

| Element | Value |
|---|---|
| Provider menu width | `280px` |
| Detail container max width | `1024px` |
| Detail container padding | `24px` |
| Provider toolbar height | `48px` |
| Provider toolbar padding | `8px` |
| Provider search height | `32px` |
| Model section gap | `16px` |
| Model row padding | `12px 6px` |
| Model row primary gap | `16px` |
| Enable switch | `44px × 22px` |

Historical evidence inspected:

```text
tmp/agent-lobehub-l2-screenshots/settings-ds-provider-detail-scoped.png
tmp/agent-lobehub-settings-ds-dom.json
tmp/agent-lobehub-settings-ds-scoped-screenshot-meta.json
```

Historical viewport/region:

- viewport: `1900 × 1100`;
- scoped region: `1320 × 1024`;
- historical layout: Settings nav + Provider menu + Provider detail.

The historical screenshot is not the final baseline. It proves required
information density and state coverage.

### V1-VS02: Agent Profile ready configuration

User-visible state:

- compact Agent identity header;
- provider+model control;
- save state `dirty/saving/saved/failed/conflict`;
- Core Instructions editor;
- readiness link back to Provider Settings.

LobeHub source anchors:

```text
src/routes/(main)/agent/profile/index.tsx
src/routes/(main)/agent/profile/features/ProfileEditor/index.tsx
src/routes/(main)/agent/profile/features/ProfileEditor/AgentHeader.tsx
src/routes/(main)/agent/profile/features/EditorCanvas/index.tsx
src/features/ModelSelect/
```

Observed source metrics:

| Element | Value |
|---|---|
| Profile main min width | `0` |
| Runtime config panel padding | `16px` |
| Runtime config panel gap | `10px` |
| Config row gap | `12px` |
| Header vertical padding | `16px` |
| Agent title | `36px`, weight `600` |
| Prompt editor minimum height | `300px` |
| Prompt editor padding | `18px` |
| Prompt editor section gap | `16px` |

Historical evidence inspected:

```text
tmp/agent-lobehub-l2-screenshots/profile-cl-compact-profile-scoped.png
tmp/agent-lobehub-profile-cl-dom.json
tmp/agent-lobehub-profile-cl-scoped-screenshot-meta.json
```

Historical viewport/region:

- viewport: `2600 × 1500`;
- scoped region: `2524 × 1100`;
- visible baseline: compact rail, 54px header, avatar/name, one Model & Tools
  panel, Core Instructions.

### V1-VS03: New Topic

User-visible state:

- Agent rail;
- Topic rail;
- compact conversation header;
- Agent welcome;
- empty composer with ready provider/model;
- no message timeline yet.

LobeHub source anchors:

```text
src/routes/(main)/agent/_layout/
src/routes/(main)/agent/features/Conversation/ConversationArea.tsx
src/routes/(main)/agent/features/Conversation/Header/index.tsx
src/routes/(main)/agent/features/Conversation/MainChatInput/index.tsx
src/features/ChatInput/Desktop/index.tsx
src/features/ChatInput/SendArea/index.tsx
src/features/ModelSwitchPanel/
```

Production-intent source:

```text
packages/prototypes/desktop/shell/src/AgentChatPage.tsx
packages/prototypes/desktop/shared/PromptComposer.tsx
```

Exact production-intent metrics:

| Element | Value |
|---|---|
| Agent rail | `230px` expanded / `48px` collapsed |
| Agent rail padding | `14px 10px 58px` / `14px 0 58px` |
| Rail transition | `width 0.18s ease, padding 0.18s ease` |
| Topic rail | `230px` |
| Topic rail padding | `12px 10px` |
| Agent row | `48px` high, radius `10px`, padding `7px 8px` |
| Agent SearchBar | `40px` high, radius `7px` |
| Center content width | `min(620px, calc(100% - 36px))` |
| Narrow content width | `calc(100% - 28px)` |
| Context header | `66px` high, radius `12px`, padding `0 14px` |
| Welcome surface | min-height `232px`, radius `14px`, padding `24px 32px` |
| Composer wrapper margin | `0 auto 18px` |
| Compact composer min height | `96px` |
| Narrow threshold | `< 900px` |

Historical benchmark evidence inspected:

```text
tmp/agent-lobehub-l2-screenshots/chat-da-compact-new-topic-scoped.png
tmp/agent-lobehub-chat-da-dom.json
tmp/agent-lobehub-chat-da-scoped-screenshot-meta.json
```

Historical region: `1135 × 630`.

### V1-VS04: Active streaming

User-visible state:

- stable user message;
- one assistant turn;
- thinking/progress distinct from response text;
- Stop action;
- no layout movement when chunks arrive;
- composer remains spatially stable.

LobeHub source anchors:

```text
src/features/Conversation/ChatList/index.tsx
src/features/Conversation/ChatList/components/VirtualizedList.tsx
src/features/Conversation/Messages/Assistant/
src/features/Conversation/components/Thinking/
src/features/Conversation/AssistantTurnSettledWatcher.tsx
src/features/Conversation/store/slices/messageState/selectors.ts
```

Required measured assertions:

- first and last message content bounds do not change horizontally during
  streaming;
- composer x/width remain stable within `1px`;
- assistant row identity remains stable across chunks;
- thinking and final text have separate DOM markers;
- Stop is visible only while the turn is cancellable;
- text does not overlap actions or composer.

### V1-VS05: Provider failure and recovery

User-visible state:

- failed assistant turn remains in the timeline;
- provider/model identity is visible;
- error reason and owner are visible;
- Retry and Provider Settings are available;
- user input remains available.

LobeHub source anchors:

```text
src/features/Conversation/Error/index.tsx
src/features/Conversation/Error/ChatInvalidApiKey.tsx
src/features/Conversation/Error/DeprecatedModelError.tsx
src/features/Conversation/Error/TraceIdError.tsx
```

No toast-only error satisfies this surface.

### V1-VS06: Restarted durable topic

User-visible state:

- selected Agent and topic are restored;
- message order and content match Station;
- terminal model identity is visible;
- no loading bubble replaces accepted content;
- stale local cache cannot win.

This surface uses the same geometry as V1-VS03/V1-VS04. The proof is state
readback, not a new visual design.

### V1-VS07: Narrow Agent

Fixed viewport:

```text
760 × 1100
```

Required behavior:

- Agent rail collapses to `48px`;
- Topic rail is closed until explicitly opened;
- center rail remains the only dominant rail;
- composer width is `calc(100% - 28px)`;
- expanded secondary rail never overlays composer or message content;
- opening one narrow rail closes the other.

Historical evidence inspected:

```text
tmp/agent-lobehub-l2-responsive-screenshots/narrow-chat-review.png
```

This historical screenshot includes review chrome and is not a final baseline.
It proves the minimum content/approval/composer stack that must fit.

## 6. Prototype Rebuild Obligations

Before production UI edits:

1. Keep V1 inside `packages/prototypes/desktop/shell/`.
2. Retain the conforming Agent Chat structure where it matches V1.
3. Replace the Profile import with a production-intent Profile implementation
   using LobeUI, Flexbox, and antd tokens.
4. Replace the Provider slice in `Settings.tsx`; do not preserve local `T`,
   hand-written `Select/Toggle/Tag`, or mock-only state ownership.
5. Add deterministic query/state switches for V1-VS01 through V1-VS07.
6. Add stable `data-v1-*` markers for every measured region.
7. Capture light/wide, light/narrow, loading, error, saving, streaming, and
   restart-equivalent states.
8. Inspect every screenshot before it becomes a baseline.

Forbidden:

- copying the historical 13,001-line parity prototype;
- using screenshot coordinates as CSS values;
- implementing production first and adjusting the prototype afterward;
- preserving old production layout because it is already connected to data.

## 7. Required DOM Markers

| Marker | Surface |
|---|---|
| `data-v1-agent-workbench` | root |
| `data-v1-agent-rail` | Agent rail |
| `data-v1-topic-rail` | Topic rail |
| `data-v1-conversation-rail` | center rail |
| `data-v1-provider-menu` | Provider menu |
| `data-v1-provider-detail` | Provider detail |
| `data-v1-provider-readiness` | credential/check state |
| `data-v1-agent-profile` | Profile root |
| `data-v1-agent-model-ref` | provider+model control |
| `data-v1-agent-save-state` | save state |
| `data-v1-message-timeline` | timeline |
| `data-v1-turn-thinking` | thinking/progress |
| `data-v1-turn-text` | assistant text |
| `data-v1-turn-terminal` | done/error/cancelled |
| `data-v1-composer` | composer |
| `data-v1-recovery` | inline recovery |

Markers are test anchors, not visual wrappers.

## 8. Computed-Style Manifest

Each prototype baseline and production capture must emit JSON for every marker:

```json
{
  "selector": "[data-v1-composer]",
  "rect": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "style": {
    "display": "",
    "position": "",
    "overflow": "",
    "padding": "",
    "margin": "",
    "gap": "",
    "border": "",
    "borderRadius": "",
    "backgroundColor": "",
    "boxShadow": "",
    "fontFamily": "",
    "fontSize": "",
    "fontWeight": "",
    "lineHeight": "",
    "color": ""
  }
}
```

Rules:

- geometry tolerance is `1px`;
- font size, weight, line height, border radius, and icon dimensions must match
  exactly;
- token-derived colors must resolve to the same computed value;
- text content, loading data, caret, timestamps, and animations must be
  normalized before screenshot comparison;
- missing markers fail closed.

## 9. Screenshot Matrix

| ID | Viewport | Theme | State |
|---|---:|---|---|
| V1-L2-01 | `1440 × 1000` | light | Provider empty |
| V1-L2-02 | `1440 × 1000` | light | Provider saving/checking |
| V1-L2-03 | `1440 × 1000` | light | Provider ready |
| V1-L2-04 | `1440 × 1000` | light | Profile ready/saved |
| V1-L2-05 | `1440 × 1000` | light | New Topic |
| V1-L2-06 | `1440 × 1000` | light | Streaming |
| V1-L2-07 | `1440 × 1000` | light | Provider failure |
| V1-L2-08 | `1440 × 1000` | dark | New Topic |
| V1-L2-09 | `760 × 1100` | light | New Topic narrow |
| V1-L2-10 | `760 × 1100` | light | Streaming narrow |

Each row requires:

- prototype PNG;
- production native WebView PNG;
- prototype computed-style manifest;
- production computed-style manifest;
- DOM state manifest;
- a human-readable delta report.

## 10. Visual Difference Gate

A surface passes only when:

1. required DOM markers all exist;
2. structural component inventory matches;
3. geometry and exact-style assertions pass;
4. screenshot comparison contains no unexplained region;
5. text fits at wide and narrow viewports;
6. interaction states transition without layout shift;
7. the native Tauri capture shows the same surface;
8. runtime behavior for that state is real, not mock.

Screenshot difference alone cannot pass or fail a surface. Anti-aliasing may
produce pixel noise, so geometry/computed-style assertions are authoritative.
Any larger visual region difference must be classified:

- intended Peers UI Identity adaptation;
- dynamic content normalization;
- defect.

Only the first two may remain, and both must be recorded.

## 11. Interaction Scripts

### V1-L3-01: Provider readiness

```text
open Settings -> Provider -> Ark
  -> type key
  -> observe dirty/saving/checking
  -> observe ready
  -> inspect model rows
  -> follow Return to Agent
```

Assertions:

- focus remains in the edited field while saving;
- switching providers does not leak field values;
- invalid key renders inline recovery;
- ready transition enables SeedPro 2.1 in Agent model picker.

### V1-L3-02: Agent config

```text
open Agent Profile
  -> open model picker
  -> search SeedPro 2.1
  -> choose Ark
  -> observe saving/saved
  -> leave and reopen
```

Assertions:

- provider and model change atomically;
- picker closes without flash;
- saved state is read back from Station;
- failed save retains exact selection.

### V1-L3-03: First useful answer

```text
click New Topic
  -> focus composer
  -> type prompt
  -> send
  -> observe draft promotion
  -> observe thinking/text/done
  -> switch topic and return
  -> restart Desktop and reopen
```

Assertions:

- one conversation is created;
- no duplicate user/assistant rows;
- stream updates one stable assistant row;
- content does not shift horizontally;
- restart restores the Station-backed result.

## 12. Production Replica Rules

For every production component:

1. copy the confirmed prototype hierarchy first;
2. copy style values verbatim;
3. replace mock data with runtime selectors without changing hierarchy;
4. replace mock callbacks with commands without changing affordances;
5. replace strings with i18n keys without changing measured text container;
6. do not add wrappers unless required by a documented runtime boundary;
7. if a wrapper changes layout, update prototype and baseline first;
8. do not “improve” the confirmed design during binding.

## 13. Completion Claim

Before this contract passes, the implementation may claim:

> V1 behavior is under implementation; visual parity is unproven.

After all V1-L2 and V1-L3 cells pass in native Tauri:

> V1 First Useful Answer production surfaces match the confirmed Peers
> production-intent prototype at the declared viewports and states, with all
> recorded benchmark adaptations explicit.

It still may not claim full LobeHub parity.
