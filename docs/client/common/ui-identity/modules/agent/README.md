# Agent UI Identity

> Status: active module refinement.
> Inherits: `docs/client/common/ui-identity/`.
> Applies to: Agent Chat, Agent Profile, Atelier, Orchestration, and shared Agent rails.

## Product Identity

Agent is one Desktop product module with three sibling task surfaces:

- **Agent**: select an execution unit, converse, and configure its profile.
- **Atelier**: operate tasks through a conversation stream and contextual work panels.
- **Orchestration**: compose multiple Agents and inspect execution progress.

These surfaces share identity, navigation, panel behavior, density, and interaction primitives. A child surface must not introduce another global navigation system.

## Shell Contract

```text
Desktop Shell
  Agent Module Navigation
    Agent
    Atelier
    Orchestration
  Active Surface
```

- The Agent module navigation is owned by Desktop Shell and remains visually stable across all three surfaces.
- Surface-local navigation may switch tabs, tasks, topics, or panels, but must not duplicate the module navigation.
- Agent Profile is a route within Agent, not a fourth sibling module.

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

Canonical widths:

| Surface | Expanded | Collapsed |
| --- | ---: | ---: |
| Agent roster | 230px | 48px |
| Atelier task rail | 230px | 48px |
| Atelier context rail | 230px | 48px |
| Profile Builder | 320px | closed; overlay on narrow containers |
| Orchestration Agent library | 230px | 48px |
| Orchestration context rail | 230px | 48px |

## Continuous Workspace Contract

- Agent, Atelier, and Orchestration use the same continuous split-workspace anatomy: left rail, dominant center rail, and optional right rail.
- Adjacent rails are separated by `border.hairline`; they are not arranged as independent rounded cards with page gutters between them.
- Surface-local headers are compact rows inside their owning rail. They must not duplicate the Desktop Shell module navigation.
- The center work surface owns its own scroll boundary. Its composer or prompt input remains fixed at the bottom of that center rail.
- Left and right rail content scroll independently from the center work surface.
- Empty states use compact item-title and helper-text typography; browser-default heading margins and sizes are forbidden.

## Surface Lifetime Contract

- `Agent`, `Atelier`, and `Orchestration` mount on first visit and remain mounted while the Desktop Shell is alive.
- Module-tab switching changes frame visibility; it must not conditionally replace the active surface tree.
- Local drafts, selected inner tabs, panel state, scroll position, and canvas state survive sibling surface switches.
- A hidden alive surface must ignore zero-width `ResizeObserver` samples.
- Responsive collapse runs only when crossing from wide to narrow, not whenever a hidden surface becomes visible again at the same width.

## Content Rail Contract

- The central conversation, editor, or canvas is always the dominant reading and action rail.
- Chat and Atelier composers align to the central content rail and remain fully usable at narrow widths.
- SOUL / AGENTS cards stack vertically when two columns would make editing cramped.
- Orchestration collapses secondary rails before the execution graph becomes cramped; opening one narrow rail closes the other.
- No surface may preserve fixed side columns that leave the central rail clipped or narrower than its primary controls.

## Orchestration Surface Contract

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
| Narrow container | One dominant content rail; secondary panels are closed or drawers |
| Panel open | Shared toggle at the stable anchor; layout column; no backdrop or content overlap |
| Empty | Explains the surface and next available action |
| Awaiting human | Blocking stage, evidence, impact, recommendation, and recoverable choices remain in one reading path |
| Replan / Resume | Retained work and accepted checkpoint are explicit; accepted nodes do not appear to rerun |
| Partial result | Missing acceptance evidence remains visible and completion is not implied |
| Long labels/content | Truncates metadata without hiding the primary action |
| Keyboard/focus | Icon controls are labeled; closing a drawer restores task context |

## AI Agent Checklist

- [ ] Desktop Shell owns `Agent / Atelier / Orchestration`.
- [ ] No nested global navigation exists inside a child surface.
- [ ] Every collapse/expand control uses `PanelToggleDock`.
- [ ] All three sibling surfaces preserve drafts, inner tabs, and panel state across switching.
- [ ] Narrow panels are drawers, not fixed columns.
- [ ] The center rail remains usable after every panel transition.
- [ ] Agent tiles are square and rounded.
- [ ] L2 evidence covers Agent, Profile, Atelier, and Orchestration at desktop and narrow widths.
- [ ] L3 evidence covers module switching and every panel open/close path.
