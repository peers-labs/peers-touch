# Modern Chat Agent — Benchmark Disposition

> **Status**: accepted
> **Version**: v1.1
> **Created**: 2026-07-30 | **Updated**: 2026-10-05
> **Owner**: Peers-Touch Agent Team

---

## 1. Benchmark Roles

- **LobeHub** is the product-completeness and interaction benchmark.
- **Peers-Touch product and architecture contracts** determine runtime
  continuity, coding-Agent behavior, intervention, recovery, diagnostics,
  ownership, privacy, federation, UI Identity, and cross-device semantics.
- Retired predecessor repositories are not evidence sources. A disposition
  remains accepted only when LobeHub or a current Peers-Touch contract cited
  below supports it.

Disposition meanings:

- `adopt`: preserve the user outcome.
- `adapt`: preserve the value with a Peers-specific product contract.
- `reject`: incompatible with the product promise or trust boundary.
- `defer`: useful but outside the first product claim.

## 2. Evidence Ledger

| ID | Benchmark behavior / product outcome | Evidence / governing contract | User value | Disposition | Peers product rationale |
|---|---|---|---|---|---|
| MCA-B01 | Agent combines role, model, skills, integrations, knowledge, and memory | LobeHub `docs/usage/getting-started/agent.mdx` | Configure a reusable teammate | adapt | Keep the composition model, but show Station readiness and capability degradation |
| MCA-B02 | First-use path starts simple and reaches a real answer quickly | LobeHub Agent guide; `experience-contract.md` MCA-J01 | Low activation cost | adopt | Start with Agent + model; advanced capabilities remain progressive |
| MCA-B03 | Empty draft becomes a topic only after the first real message | `product-state-model.md` §3-§4 | No empty-history clutter | adopt | Draft is local UI state until Station accepts the first turn |
| MCA-B04 | Real-time text, reasoning, tools, rich output, and cancellation share one timeline | LobeHub `StreamingHandler.ts`; `design.md` §7/§11 | Understand current progress | adapt | Use one typed Peers event vocabulary and never synthesize provider streaming |
| MCA-B05 | Topics support search, rename, favorite, duplicate, archive/delete | LobeHub `docs/usage/agent/topic.mdx`; `product-definition.md` MCA-P02 and MCA-P08 | Find and organize ongoing work | adapt | Required: search, rename, archive; branching owns alternative exploration; destructive delete stays explicit |
| MCA-B06 | Branch/edit/regenerate preserve alternative paths | LobeHub `docs/usage/getting-started/chat.mdx`, thread/topic actions | Explore without losing the original | adopt | Map to immutable Station message lineage |
| MCA-B07 | Follow-ups submitted during an active turn enter a visible persistent queue | `decisions.md` MCA-D06; `product-state-model.md` §4 | Continue expressing intent without racing the Agent | adopt | Bounded FIFO with edit, delete, promote, and visible position |
| MCA-B08 | Refresh and page switching recover an active run | `decisions.md` MCA-D07; `product-state-model.md` §9 | Work continues without keeping one view open | adopt | Station owns lifecycle; client replay and reconciliation restore projection |
| MCA-B09 | Memory is structured, transparent, searchable, editable, and attributable | LobeHub Memory guide; `product-definition.md` MCA-P04 and memory-consent decision | Personalization remains controllable | adapt | Require source, scope, confidence/status, usage attribution, and deletion controls |
| MCA-B10 | Skills provide procedures; tools perform actions | LobeHub `skills-and-tools.mdx`; `design.md` §8-§10 | Understand why the Agent knows or does something | adopt | Keep skills, knowledge, memory, and tools as separate visible concepts |
| MCA-B11 | Tool policy can require human approval and shows structured activity | LobeHub `GeneralChatAgent.ts`; `product-state-model.md` §6 | Safe action with informed consent | adapt | Peers cards name authority, scope, risk, target, result, and durable decision |
| MCA-B12 | Files/images are admitted by supported type and represented as first-class context | LobeHub `uploadGuard.ts`; `product-state-model.md` §7 | Work from real user material | adapt | Admit against runtime capability before execution; preserve draft and upload state |
| MCA-B13 | Reasoning has an expandable progress surface | LobeHub Chain-of-Thought guide; `product-state-model.md` §5 | Explain that complex work is progressing | adapt | Show provider-authorized reasoning summary/status, duration, and steps; reject a promise of private raw chain-of-thought |
| MCA-B14 | Coding runtimes pin working directory and resume session across turns | LobeHub Codex/Claude guides; `decisions.md` MCA-D03 and MCA-D29 | Long-running project work remains coherent | adapt | Optional-advertised external runtime; Station owns conversation binding and reset semantics |
| MCA-B15 | Coding activity renders file changes, commands, todos, subagents, and ask-user as purpose-built blocks | LobeHub Codex/Claude guides; `experience-contract.md` MCA-J10 | Inspect execution without reading raw JSON | adapt | Required for advertised external runtime; base Direct Model needs generic tool cards only |
| MCA-B16 | Runtime/model/capability controls are visible before first send and constrained after topic creation | `decisions.md` MCA-D05; `product-state-model.md` §2/§8 | Avoid silent runtime changes | adopt | New topic can choose supported intent; pinned facts remain visible and changes explain consequences |
| MCA-B17 | Usage tracks model tokens, tools, time, intervention, and cost | LobeHub `UsageCounter.ts`; `decisions.md` MCA-D10 | Understand resource use | adopt | Provider-reported facts are authoritative; estimates are labeled |
| MCA-B18 | Skill-selection and runtime diagnostics explain why behavior occurred | `decisions.md` MCA-D10; `experience-contract.md` MCA-J09 | Diagnose a weak answer or missing capability | adopt | Present user-safe summaries with redacted export; raw internals remain progressive detail |
| MCA-B19 | Artifacts open substantial generated output in a dedicated preview/export surface | LobeHub Artifacts guide | Iterate on reusable output | defer | Useful optional capability, but not required for core chat readiness |
| MCA-B20 | Cloud/local sandbox runs code and generates files | LobeHub Sandbox guide; `decisions.md` MCA-D13 and MCA-D29 | Produce real results safely | adapt | Execution target and isolation must be explicit; never imply a sandbox when none exists |
| MCA-B21 | Marketplace/community enables one-click Agent and capability installation | LobeHub Agent/Skills guides; `decisions.md` MCA-D20 and MCA-D20A | Faster discovery | defer | Trust and federation governance require separate product design |
| MCA-B22 | Multi-Agent teams and orchestration run inside chat | LobeHub Agent teams; `decisions.md` MCA-D11; `../agent-canvas-orchestration.md` | Delegate complex work | defer | Single-Agent readiness is a prerequisite; Agent Canvas owns this product |
| MCA-B23 | Home combines pinned Agents, scoped recents, Chat/Task input, Brief/Needs You, running tasks, and explicit loading/error/empty/retry states | LobeHub `features/Home/*`, `store/home/*`, `features/HomeInbox/*` | Resume or start consequential work from one place | adapt | Use Station Agent/topic/task/capability truth; exclude promotional portrait, commercial recommendations, Community, and generation modes |
| MCA-B24 | Tool/MCP/Connector inventory is filtered by surface/runtime ownership and connected to governed invocation | LobeHub source `1056cdf32b4e`: `features/ProfileEditor/profileToolVisibility.ts#getVisibleProfileToolIds`, `store/tool/slices/connector/action.ts#mountConnectorToAgent`, `store/tool/slices/mcpStore/action.ts#installMCPPlugin`, `features/Conversation/store/slices/tool/action.ts#approveToolCall` | Know what the Agent can use and why before sending | adapt | Collapse duplicate stores into one Peers capability manifest/binding/policy projection; add authoritative model/runtime compatibility before admission; Station remains authority |
| MCA-B25 | Evaluation Lab exposes benchmark, dataset, test case, run, cancel, retry/resume, result, metrics, and experiment workflows | LobeHub `routes/(main)/eval/*`, `store/eval/*`, `services/agentEval.ts`, database `agentEvals.ts` | Compare Agent quality with durable, inspectable evidence | adapt | Required V2 loop includes benchmark/dataset/test-case/run/result/cancel/retry/restart; experiments and broad import formats do not block the first Peers loop |

## 3. Rejected Benchmark Behaviors

| Behavior | Reason |
|---|---|
| Copy LobeHub navigation and visual identity | Peers uses Quiet Protocol Minimalism and one Desktop Agent module shell |
| Treat local CLI credentials and filesystem as universal Agent state | Breaks Station truth, remote Station use, and Mobile portability |
| Expose raw private chain-of-thought as a trust promise | Provider policy and safety do not guarantee it |
| Infer runtime/model capability from product names | Capability must be resolved and disclosed before execution |
| Use local optimistic state as proof of durable completion | Product acceptance requires Station readback and runtime evidence |
| Add image or video generation to Peers-Touch Agent | These are not Peers-Touch product capabilities; a future video product must be a separate project with its own product contract |

## 4. Coverage Judgment

The disposition ledger covers the required first-profile concerns:

- Agent configuration and activation.
- Conversation organization and branching.
- Streaming, queueing, recovery, and runtime continuity.
- Memory, skills, knowledge, tools, approvals, and attachments.
- Capability transparency, usage, feedback, and diagnostics.
- Optional external Agent and artifact behavior.

Home Command Center, unified capability governance, and Evaluation Lab are V2
required scope. Image and video generation are unsupported in Peers-Touch.
Server-side audio generation, Mobile UI, commercial marketplace/community
behavior, and multi-Agent collaboration remain explicitly deferred rather than
silently omitted.
