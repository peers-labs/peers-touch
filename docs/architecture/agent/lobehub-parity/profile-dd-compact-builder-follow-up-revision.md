# Agent LobeHub Parity - Profile Builder Follow-Up Revision

> **Status**: pending-review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Agent Profile side-by-side revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-DD-pre

---

## 1. Purpose

`EVID-011-CL-pre` promoted the compact Agent Profile editor into the active
scoped artifact gate, but the live side-by-side inspection found the first
screen still under-modeled the LobeHub Profile right rail. Live LobeHub shows
the `Agent Builder` panel with a welcome prompt, suggestion cards, `Switch`
control and bottom composer in the Profile first screen.

This revision keeps the compact Profile editor baseline and adds the missing
Builder-first-screen structure before Owner confirmation.

## 2. Source And Live Anchors

| Anchor | What It Proves |
| --- | --- |
| `external/lobehub/src/routes/(main)/agent/profile/index.tsx` | Profile first screen composes the editor area with `AgentBuilderSlot`. |
| `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/index.tsx` | Profile editor order: avatar/name header, `Model & Tools`, then `Core Instructions`. |
| `external/lobehub/src/features/AgentBuilder/index.tsx` | Agent Builder is a right-side panel. |
| `external/lobehub/src/features/AgentBuilder/AgentBuilderWelcome.tsx` | Builder welcome text and suggestion stack. |
| `external/lobehub/src/features/AgentBuilder/SuggestionChips/index.tsx` | Suggestion cards and `Switch` affordance. |
| `external/lobehub/src/features/AgentBuilder/AgentBuilderConversation.tsx` | Builder bottom composer uses the chat input pattern. |
| `external/lobehub/locales/en-US/chat.json` | Composer placeholder includes `Ask, create, or start a task. @ to assign tasks to other agents.` |

The `Upgrade your plan` card is retained from the observed live Profile DOM
first screen; the targeted source trace did not find it mounted directly inside
the Profile / AgentBuilder source segment.

## 3. Revision Scope

| Live / Prototype Delta | DD Revision |
| --- | --- |
| Builder was hidden by default in the compact Profile artifact | Compact Profile now opens with the right `Agent Builder` panel visible. |
| Builder text was a thin local placeholder | Added `Tell me your use case.` and the live welcome-copy structure. |
| Builder suggestion cards were absent from the default first screen | Added `Define the agent's system role`, `Enable tools for this agent` and `Write an opening message`. |
| `Switch` control was absent | Added a `Switch` affordance below the suggestion cards. |
| Builder composer was not aligned to live placeholder | Added bottom composer with `Ask, create, or start a task. @ to assign tasks to other agents.` |
| Live rail included upgrade affordance | Added `Upgrade your plan` rail card, marked as live-DOM sourced rather than Profile source-local. |

## 4. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors listed above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/profile-dd-compact-builder-scoped.png`, captured from a rendered Portal session after selecting `Agent LobeHub Parity`, then scoped-isolated to `.pt-profile-shell.is-compact-profile`; opened and inspected at 1720x920. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-profile-dd-dom.json`: `compactProfile=true`, `agentRail=true`, `compactHeader=true`, `compactEditor=true`, `upgradeCardVisible=true`, `builderVisibleByDefault=true`, `builderPromptVisible=true`, `builderSuggestionCount=3`, `builderSwitchVisible=true`, `builderComposer=true`, `builderComposerPlaceholder=Ask, create, or start a task. @ to assign tasks to other agents.`, `forbiddenHits=[]`; metadata `tmp/agent-lobehub-profile-dd-scoped-screenshot-meta.json` records `portalChromeHit=false`. |

## 5. Remaining Risk

This revision improves Profile first-screen visual and interaction parity only.
It does not prove real AgentBuilder store updates, model mutation, tool enable
side effects, avatar upload/delete, edit-lock recovery, streaming builder
conversation, or product GATE-008 behavior.

## 6. Claim Boundary

`EVID-011-DD-pre` promotes the Agent Profile active compact artifact from CL to
the DD Builder-visible first screen. It does not confirm Profile, does not
authorize `EVID-012`, and does not allow Desktop / Station / Model product
migration.
