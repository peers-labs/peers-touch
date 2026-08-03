# Modern Chat Agent — Benchmark Disposition

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-07-30
> **Owner**: Peers-Touch Agent Team

---

## 1. Benchmark Roles

- **LobeHub** is the product-completeness and interaction benchmark.
- **Peers-Touch** is the runtime continuity, coding-Agent, intervention, recovery,
  and diagnostic benchmark.
- **Peers-Touch** determines final ownership, privacy, federation, UI Identity,
  and cross-device semantics.

Disposition meanings:

- `adopt`: preserve the user outcome.
- `adapt`: preserve the value with a Peers-specific product contract.
- `reject`: incompatible with the product promise or trust boundary.
- `defer`: useful but outside the first product claim.

## 2. Evidence Ledger

| ID | Observed benchmark behavior | Evidence | User value | Disposition | Peers product rationale |
|---|---|---|---|---|---|
| MCA-B01 | Agent combines role, model, skills, integrations, knowledge, and memory | LobeHub `docs/usage/getting-started/agent.mdx` | Configure a reusable teammate | adapt | Keep the composition model, but show Station readiness and capability degradation |
| MCA-B02 | First-use path starts simple and reaches a real answer quickly | LobeHub Agent guide; Peers-Touch `docs/user-guide/00-overview.md` | Low activation cost | adopt | Start with Agent + model; advanced capabilities remain progressive |
| MCA-B03 | Empty draft becomes a topic only after the first real message | Peers-Touch `docs/user-guide/00-overview.md` §1.2/§2.2 | No empty-history clutter | adopt | Draft is local UI state until Station accepts the first turn |
| MCA-B04 | Real-time text, reasoning, tools, rich output, and cancellation share one timeline | LobeHub `StreamingHandler.ts`; Peers-Touch `conversationEntry.ts` | Understand current progress | adapt | Use one typed Peers event vocabulary and never synthesize provider streaming |
| MCA-B05 | Topics support search, rename, favorite, duplicate, archive/delete | LobeHub `docs/usage/agent/topic.mdx`; Peers-Touch topic guide | Find and organize ongoing work | adapt | Required: search, rename, archive; branching owns alternative exploration; destructive delete stays explicit |
| MCA-B06 | Branch/edit/regenerate preserve alternative paths | LobeHub `docs/usage/getting-started/chat.mdx`, thread/topic actions | Explore without losing the original | adopt | Map to immutable Station message lineage |
| MCA-B07 | Follow-ups submitted during an active turn enter a visible persistent queue | Peers-Touch `docs/user-guide/00-overview.md` §2.2; `05-domain-chat.md` queue contract | Continue expressing intent without racing the Agent | adopt | Bounded FIFO with edit, delete, promote, and visible position |
| MCA-B08 | Refresh and page switching recover an active run | Peers-Touch `dialogueStreamRecovery.ts`; dialogue architecture | Work continues without keeping one view open | adopt | Station owns lifecycle; client replay and reconciliation restore projection |
| MCA-B09 | Memory is structured, transparent, searchable, editable, and attributable | LobeHub Memory guide; Peers-Touch Memory guide | Personalization remains controllable | adapt | Require source, scope, confidence/status, usage attribution, and deletion controls |
| MCA-B10 | Skills provide procedures; tools perform actions | LobeHub `skills-and-tools.mdx`; Peers-Touch slash skills and skill trace | Understand why the Agent knows or does something | adopt | Keep skills, knowledge, memory, and tools as separate visible concepts |
| MCA-B11 | Tool policy can require human approval and shows structured activity | LobeHub `GeneralChatAgent.ts`; Peers-Touch tool approval/Ask User guides | Safe action with informed consent | adapt | Peers cards name authority, scope, risk, target, result, and durable decision |
| MCA-B12 | Files/images are admitted by supported type and represented as first-class context | LobeHub `uploadGuard.ts`; Peers-Touch attachment guide | Work from real user material | adapt | Admit against runtime capability before execution; preserve draft and upload state |
| MCA-B13 | Reasoning has an expandable progress surface | LobeHub Chain-of-Thought guide; streaming reasoning events | Explain that complex work is progressing | adapt | Show provider-authorized reasoning summary/status, duration, and steps; reject a promise of private raw chain-of-thought |
| MCA-B14 | Coding runtimes pin working directory and resume session across turns | LobeHub Codex/Claude guides; Peers-Touch thread-owned runtime plan | Long-running project work remains coherent | adapt | Optional-advertised external runtime; Station owns conversation binding and reset semantics |
| MCA-B15 | Coding activity renders file changes, commands, todos, subagents, and ask-user as purpose-built blocks | LobeHub Codex/Claude guides; Peers-Touch user guide | Inspect execution without reading raw JSON | adapt | Required for advertised external runtime; base Direct Model needs generic tool cards only |
| MCA-B16 | Runtime/model/capability controls are visible before first send and constrained after topic creation | Peers-Touch Agent guide and unified architecture | Avoid silent runtime changes | adopt | New topic can choose supported intent; pinned facts remain visible and changes explain consequences |
| MCA-B17 | Usage tracks model tokens, tools, time, intervention, and cost | LobeHub `UsageCounter.ts`; Peers-Touch context/usage UI guide | Understand resource use | adopt | Provider-reported facts are authoritative; estimates are labeled |
| MCA-B18 | Skill-selection and runtime diagnostics explain why behavior occurred | Peers-Touch `skillTrace.ts`, acceptance and user guides | Diagnose a weak answer or missing capability | adopt | Present user-safe summaries with redacted export; raw internals remain progressive detail |
| MCA-B19 | Artifacts open substantial generated output in a dedicated preview/export surface | LobeHub Artifacts guide | Iterate on reusable output | defer | Useful optional capability, but not required for core chat readiness |
| MCA-B20 | Cloud/local sandbox runs code and generates files | LobeHub Sandbox guide; Peers-Touch workspace isolation | Produce real results safely | adapt | Execution target and isolation must be explicit; never imply a sandbox when none exists |
| MCA-B21 | Marketplace/community enables one-click Agent and capability installation | LobeHub Agent/Skills guides; Peers-Touch Capabilities guide | Faster discovery | defer | Trust and federation governance require separate product design |
| MCA-B22 | Multi-Agent teams and orchestration run inside chat | LobeHub Agent teams; Peers-Touch Orchestra/A2A | Delegate complex work | defer | Single-Agent readiness is a prerequisite; Agent Canvas owns this product |

## 3. Rejected Benchmark Behaviors

| Behavior | Reason |
|---|---|
| Copy LobeHub navigation and visual identity | Peers uses Quiet Protocol Minimalism and one Desktop Agent module shell |
| Treat local CLI credentials and filesystem as universal Agent state | Breaks Station truth, remote Station use, and Mobile portability |
| Expose raw private chain-of-thought as a trust promise | Provider policy and safety do not guarantee it |
| Infer runtime/model capability from product names | Capability must be resolved and disclosed before execution |
| Use local optimistic state as proof of durable completion | Product acceptance requires Station readback and runtime evidence |

## 4. Coverage Judgment

The benchmark pass covers the required first-profile concerns:

- Agent configuration and activation.
- Conversation organization and branching.
- Streaming, queueing, recovery, and runtime continuity.
- Memory, skills, knowledge, tools, approvals, and attachments.
- Capability transparency, usage, feedback, and diagnostics.
- Optional external Agent and artifact behavior.

Image generation, voice, marketplaces, sharing, scheduled tasks, channels, and
multi-Agent orchestration remain explicitly deferred rather than silently
omitted.
