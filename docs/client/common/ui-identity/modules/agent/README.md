---
status: active
owner: Client Platform Team
updated: 2026-10-27
review-cadence: semiannual
next-review: 2027-04-27
---

# Agent UI Identity

## Product Identity

Agent is one Desktop product module with two sibling task surfaces:

- **Chat**: select an execution unit, converse, and configure its profile.
- **Atelier**: operate goals and tasks, compose multiple Agents, and inspect execution progress.

These surfaces share identity, navigation, panel behavior, density, and interaction primitives. A child surface must not introduce another global navigation system.

## Shell Contract

```text
Desktop Shell
  Agent Module Navigation
    Chat
    Atelier
  Active Surface
```

- The Agent module navigation is owned by Desktop Shell and remains visually stable across Chat and Atelier.
- Surface-local navigation may switch tabs, tasks, topics, or panels, but must not duplicate the module navigation.
- Agent Profile is a route within Chat, not a third sibling module.
- Orchestration is an Atelier-owned work mode, not a global or Agent sibling destination.

## Panel Contract

- All collapsible left and right panels use the shared `PanelToggleDock`; it owns the canonical `PanelToggleButton` and its anchor.
- A panel toggle keeps one stable anchor across states: left-panel toggles stay at the lower-left panel corner; right-panel toggles stay at the upper-right panel corner.
- Bottom-anchored left toggles share the Desktop Shell bottom-action baseline. Top-anchored right toggles use the same top inset in expanded and collapsed states.
- Expanding or collapsing a panel must not move its toggle anchor.
- Canonical anchors are `left: 10px; bottom: 14px` and `right: 10px; top: 14px`.
- Closed desktop panels may retain a compact rail only when it contains meaningful navigation.
- In a narrow container, secondary panels remain layout columns when expanded and collapse into canonical slim rails; they must never cover the content rail.
- Narrow left and right panels are mutually exclusive: opening one collapses the other before the layout transition.
- Collapsed rails keep only the shared toggle and meaningful rail navigation; no backdrop or drawer overlay is used.
- The Agent roster is module-owned and remains mounted beside both chat and Profile editing. Selecting, creating, editing, searching, or deleting an Agent must not remove the roster.
- Expanded and collapsed roster states share the same creation header, search slot, group spacing, row heights, and scroll container. Every Agent avatar keeps the same vertical center; the `+` creation entry remains visible in both states.
- Agent operations preserve the user's expanded/collapsed choice. Width changes are owned by the shared toggle or a genuine viewport breakpoint crossing, not a content-route change.
- Selecting an Agent row opens that Agent's Chat. Agent Profile is entered only through the explicit identity/Profile action; the row overflow menu contains Agent Profile and, when allowed, Delete, and stays anchored to its source row.
- The expanded Topic rail owns one selected-Agent name projection without an avatar. The conversation header must not repeat Agent avatar/name/description; it shows the current Topic title on the left and conversation-content Search on the right.
- Agent Chat owns a sibling Topic rail between the persistent Agent roster and the dominant conversation rail. It is present only in Chat; Profile keeps the Agent roster and uses the remaining work surface without mounting Topic history.
- The expanded Topic rail is 238px. Start new topic, Agent Profile, and Search use three equal icon slots. `Topics <count>` sits immediately above the grouped rows; batch selection and destructive delete stay on that label's right edge.
  Search replaces those three slots in place with one full-width query field and Cancel action; closing search clears the query and restores the actions without adding height or shifting the Topic list.
  Grouped rows retain status, Pin/Unpin, Edit, single Delete, and explicit selection checkboxes in batch mode.
  Its 48px compact form keeps Start new topic and a
  count-bearing Topics entry; selecting a Topic does not unmount the rail.
- Below the compact breakpoint, Agent and Topic rails may both remain visibly
  collapsed. Expanding one collapses the other. Below the ultra-narrow
  breakpoint, both desktop rails leave the conversation: the chat owns the
  full module content, Back opens the full-width Topic list, and Switch Agent
  opens a transient left-side full-height drawer. Mobile/ultra-narrow must not preserve a
  48px desktop rail beside the reading path.
- Each Agent restores its last selected topic, composer draft, and pending attachments after Agent/Profile navigation.
- Every actionable element is verified as a causal chain: trigger → emitted menu/dialog/state → decision or mutation → return/focus/draft consequence. Rendering an affordance alone is not completion evidence.
- A running turn may block sends elsewhere, but the blocked composer must explain why and provide a direct return to the running topic. Silent global locks are forbidden.
- A running turn keeps Stop reachable and preserves any text entered in its
  composer. Queue is outside the current Agent Chat scope: a second Enter must
  not create parallel execution, a hidden queue, or discard the draft.
- Structured user input and tool approval remain in the conversation reading
  path. A decision produces a terminal card, a system receipt, and Agent
  continuation; cancellation must not be presented as success.
- Attachments remain bound to the owning Agent/topic before send and become readable message metadata after send; they must not disappear merely because the file chooser closed.
- Profile follows the measured reference identity grid: a 64px left track, 12px column gap, and one right content track. The 36px Back button and 64px avatar share the same left edge; the avatar has no nested button frame and shares its top edge with the 64px description field. Name and description share the same left edge. SOUL/AGENTS editors fill the remaining desktop height and stack on narrow containers.
- Autosave feedback is transient Shell toast feedback, never a persistent line that changes the identity row height. Successful and failed identity, document, avatar, extension, and Provider saves use the same LobeUI notification owner at the Chat-standard bottom-right placement.
- Agent avatar is one persisted identity value (`initial | emoji | image`) projected consistently into roster and Profile. Upload validates image type and 2 MB size, previews before Save, and preserves the old value on Cancel. An immediate preview with progress on production media uploads follows [../../patterns/optimistic-commit.md](../../patterns/optimistic-commit.md).
- Profile does not own model configuration. Provider→Models is the model directory source of truth; Settings owns the global default and a new Topic inherits it. The composer exposes the same searchable, collapsible Provider tree for an optional Topic-local override.
- Provider Settings keeps Direct and CLI profiles in one mixed list. Type is chosen only inside Add Provider; there are no persistent Direct/CLI tabs. `Show usable only` defaults on, persists the user's choice, and limits the list to enabled, configured providers. Selecting a row mounts exactly one schema: Direct owns API key/base URL/models, while CLI owns a Station-registered adapter, default model, startup args, environment, check/restore/save, and an on-demand Advanced subtree. Both kinds can be disabled. Provider and model availability has one shared owner consumed by Settings and the composer, so disabled entries leave the composer tree immediately and an invalid current selection projects to an available model. AI / Models owns only the default-model selector and does not duplicate the Provider model tree. Registered commands and isolated workspace policy are read-only, and arbitrary binary paths or shell templates are not client inputs.
- Profile Extensions shows only capabilities already bound to that Agent. Each Skills/MCP group exposes one icon-only `+` action with tooltip/ARIA; the Settings-owned catalog opens only after that action, selection adds one bound row, and that row owns enable/disable and remove.
- Conversation Search matches message text and attached content labels within the current Topic, provides previous/next navigation, scrolls the active match into view, and restores focus to its right-aligned trigger on close. Agent/Skill AI shortcuts do not occupy the header.
- A large capability catalog is a lazy picker, not Profile content. It must provide search and bounded/incremental results; 100 available skills must not mount or display as 100 Profile rows.

Canonical widths:

| Surface | Expanded | Collapsed |
| --- | ---: | ---: |
| Agent roster | 230px | 48px |
| Agent Chat Topic rail | 238px | 48px |
| Atelier task rail | 230px | 48px |
| Atelier context rail | 230px | 48px |
| Profile Builder | remaining center work surface | remains beside the collapsed roster |
| Atelier orchestration Agent library | 230px | 48px |
| Atelier orchestration context rail | 230px | 48px |

## Continuous Workspace Contract

- Chat and Atelier use the same continuous split-workspace anatomy: left rail, dominant center rail, and optional right rail.
- Adjacent rails are separated by `border.hairline`; they are not arranged as independent rounded cards with page gutters between them.
- Surface-local headers are compact rows inside their owning rail. They must not duplicate the Desktop Shell module navigation.
- The center work surface owns its own scroll boundary. Its composer or prompt input remains fixed at the bottom of that center rail.
- Left and right rail content scroll independently from the center work surface.
- Empty states use compact item-title and helper-text typography; browser-default heading margins and sizes are forbidden.

## Surface Lifetime Contract

- `Chat` and `Atelier` mount on first visit and remain mounted while the Desktop Shell is alive.
- Module-tab switching changes frame visibility; it must not conditionally replace the active surface tree.
- Local drafts, selected inner tabs, panel state, scroll position, and canvas state survive sibling surface switches.
- A hidden alive surface must ignore zero-width `ResizeObserver` samples.
- Responsive collapse runs only when crossing from wide to narrow, not whenever a hidden surface becomes visible again at the same width.

## Content Rail Contract

- The central conversation, editor, or canvas is always the dominant reading and action rail.
- Chat and Atelier composers align to the central content rail and remain fully usable at narrow widths.
- SOUL / AGENTS cards stack vertically when two columns would make editing cramped.
- Atelier orchestration mode collapses secondary rails before the execution graph becomes cramped; opening one narrow rail closes the other.
- No surface may preserve fixed side columns that leave the central rail clipped or narrower than its primary controls.

## Atelier Orchestration Contract

- The left rail owns recent runs and participant selection. It must not become a separate template marketplace or duplicate Agent administration.
- The center rail is lifecycle-owned: participant composition in `draft`, generated read-only execution graph from `plan_ready` through execution, and acceptance coverage in terminal states.
- The generated graph is inspectable but not a generic manual workflow editor.
- Runtime stages expose participant attribution, state, exit criteria, and evidence without showing long Agent transcripts by default.
- `awaiting_human` appears inline at the blocked stage with reason, evidence, cost, rollback impact, recommendation, and explicit choices.
- `replanning` shows a bounded graph patch that distinguishes retained, reset, and added work.
- `resuming` identifies the accepted checkpoint and reused work; accepted nodes must not look as if they are executing again.
- `completed`, `partially_completed`, `failed`, and `cancelled` replace the center work surface. A detached result dashboard must not be appended below the three-rail workspace.
- The right rail is a contextual inspector for the selected run, stage, participant, evidence, decision, or coverage item.
- Human-readable collaboration method and selection rationale may be shown. Internal engine ids, policy names, reducer configuration, and convergence rules are progressive technical detail, never the primary product model.

## Identity And Components

- Agent identity uses square rounded tiles, never circular avatars.
- One purple action role is used for selection and the primary action; metadata remains neutral.
- Tabs, segmented controls, panel toggles, cards, and composers must reuse shared anatomy across Agent surfaces.
- Borders are hairline boundaries; shadows are reserved for drawers and floating layers.

## State Matrix

Each Agent surface must verify:

| State | Required behavior |
| --- | --- |
| Default desktop | Parallel rails remain readable without excess gutters |
| Narrow container | Collapsed secondary rails remain addressable; expanding one makes it the active rail surface without overlay or horizontal overflow |
| Panel open | Shared toggle at the stable anchor; layout column; no backdrop or content overlap |
| Empty | Explains the surface and next available action |
| Awaiting human | Blocking stage, evidence, impact, recommendation, and recoverable choices remain in one reading path |
| Replan / Resume | Retained work and accepted checkpoint are explicit; accepted nodes do not appear to rerun |
| Partial result | Missing acceptance evidence remains visible and completion is not implied |
| Long labels/content | Truncates metadata without hiding the primary action |
| Keyboard/focus | Icon controls are labeled; closing a drawer restores task context |

## AI Agent Checklist

- [ ] Desktop Shell owns `Chat / Atelier` inside the Agent module.
- [ ] No nested global navigation exists inside a child surface.
- [ ] Every collapse/expand control uses `PanelToggleDock`.
- [ ] Chat and Atelier preserve drafts, inner modes, and panel state across switching.
- [ ] Compact desktop rails remain layout-owned and mutually exclusive when expanded; ultra-narrow uses chat → Topic list → left-side full-height Agent drawer navigation with no retained desktop rail.
- [ ] The center rail remains usable after every panel transition.
- [ ] Agent tiles are square and rounded.
- [ ] L2 evidence covers Chat, Profile, and Atelier orchestration mode at desktop and narrow widths.
- [ ] L3 evidence covers module switching and every panel open/close path.
