# Agent LobeHub Parity - Profile Compact Editor Revision

> **Status**: pending-review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Agent Profile compact editor revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-CD-pre, EVID-011-CL-pre

---

## 1. Purpose

`EVID-011-BU-pre` proved deep Agent Profile interaction states, but the default
Owner-facing Profile view still used a three-card dashboard layout that diverged
from LobeHub live Profile. LobeHub live Profile shows a source-backed editor
flow: Agent navigation rail, compact header, avatar, large agent-name input,
single Model & Tools panel and a large Core Instructions editor.

This revision changes default Profile to that compact editor baseline while
preserving `state=deep-profile` for BU deep inspection.

`EVID-011-CL-pre` promotes that default Profile view from the earlier full-root
CD screenshot into a clean scoped `.pt-profile-shell.is-compact-profile` L2/L3
artifact for the active compact-baseline gate.

## 2. Revision Scope

| Live / Prototype Delta | CD Revision |
| --- | --- |
| Default Profile rendered identity card + editor card + Settings preview dashboard | Default `?surface=profile&check=cd` now renders a compact ProfileEditor-like flow. |
| Agent-specific navigation was not visible in the Profile surface | Added compact agent rail with Custom Agent switcher, Start New Topic, Search, Agent Profile, Topics and Channels. |
| Header did not match LobeHub NavHeader rhythm | Added compact breadcrumb header with `Custom Agent`, `Agent Profile` and `Latest version loaded`. |
| Profile title was a small form input | Added large `Enter agent name` input matching the live default state. |
| Model/tools were split across cards | Added one `Model & Tools` panel with model selector and Add Skill control. |
| Core instructions were embedded in a dense form | Added large Core Instructions section and editor placeholder. |
| BU deep interaction evidence still needed | Preserved `?surface=profile&state=deep-profile&check=bu` for avatar picker, ModelSelect, AgentTool, slash menu, Settings modal and Builder inspection. |
| Active compact artifact gate still used a broad CD screenshot | CL adds a clean scoped `.pt-profile-shell.is-compact-profile` screenshot and DOM artifact so Owner/gate evidence validates the Profile surface itself, not Portal chrome or a full-root capture. |

## 3. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; source anchors `external/lobehub/src/routes/(main)/agent/profile/index.tsx`, `external/lobehub/src/routes/(main)/agent/profile/features/Header/index.tsx`, `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/index.tsx`, `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/AgentHeader.tsx`. |
| L2 Visual | Live integrated-browser screenshot/snapshot from `https://app.lobehub.com/agent/agt_iWCUvmNhYz73/profile`; prototype before screenshot `tmp/agent-lobehub-l2-screenshots/profile-cd-prototype-before.png`; CD screenshot `tmp/agent-lobehub-l2-screenshots/profile-cd-compact-profile-full-root.png`, opened and inspected at 1535x769; CL clean scoped screenshot `tmp/agent-lobehub-l2-screenshots/profile-cl-compact-profile-scoped.png`, opened and inspected at 2524x1100 with the Profile rail, header, avatar, model/tool panel, Add Skill and Core Instructions visible without right-edge truncation. |
| L3 Dynamic / DOM | CD DOM `tmp/agent-lobehub-profile-cd-dom.json`: `compactProfile=true`, `agentRail=true`, `compactHeader=true`, `compactEditor=true`, `titlePlaceholder=true`, `modelTools=true`, `coreInstructions=true`, `settingsPreviewAbsent=true`, `identityCardAbsent=true`, `legacyEditorAbsent=true`, `builderAbsentByDefault=true`, `forbiddenHits=[]`. CL DOM `tmp/agent-lobehub-profile-cl-dom.json`: `compactProfile=true`, `agentRail=true`, `compactHeader=true`, `compactEditor=true`, `avatarVisible=true`, `titlePlaceholder=true`, `modelTools=true`, `addSkillVisible=true`, `coreInstructionTextVisible=true`, `forbiddenHits=[]`; metadata `tmp/agent-lobehub-profile-cl-scoped-screenshot-meta.json` records `portalChromeHit=false`. |

## 4. Remaining Risk

This revision improves default Profile visual parity only. It does not prove
real edit-lock lifecycle, avatar upload/delete side effects, store-backed
ModelSelect / AgentTool mutations, true editor document plugins, AgentBuilder
store updates, import/export/delete advanced flows or product GATE-008 checks.

## 5. Claim Boundary

`EVID-011-CD-pre` proves an Agent Profile compact editor prototype revision with
L2/L3 evidence. `EVID-011-CL-pre` proves the clean scoped Agent Profile artifact
is strong enough for the active compact artifact gate. Neither evidence row
confirms Profile, creates or authorizes `EVID-012`, or allows Desktop / Station
/ Model product migration.
