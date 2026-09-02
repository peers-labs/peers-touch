# LobeHub V2 Capability Reference Analysis

> **Status**: active evidence
> **Created**: 2026-08-17 | **Updated**: 2026-08-17
> **Owner**: Peers-Touch Agent Team
> **Reference source**: local LobeHub commit `1056cdf32b4e`

---

## 1. Scope

This document records source-backed LobeHub behavior relevant to:

- Home work entry.
- Tool/MCP/Connector inventory and invocation.
- Evaluation Lab.

It is architecture evidence, not the Peers target design. Peers retains Station
authority, proto-first contracts, platform capability sessions, and
actor/device isolation.

Evidence classification:

- Paths and function behavior under reference commit `1056cdf32b4e` are
  `verified_fact`.
- Summarized state flows are `inference` derived from those source actions.
- Every “Peers divergence” and contract responsibility is a `proposal` until
  accepted through D14-D18 review.

## 2. Home Data Flow

```text
Home route
  -> features/Home
  -> store/home
       -> agentList action/selectors
       -> recent action/selectors
       -> homeInput action
  -> services/recent + Agent/Task services
  -> Home/Recents, InputArea, HomeInbox, Brief/Task surfaces
```

Verified anchors:

- `src/store/home/store.ts`: combines agent list, recent, input, and sidebar
  slices.
- `src/store/` + `home/slices/recent/action.ts`: scoped recent fetch and
  refresh.
- `src/store/` + `home/slices/homeInput/action.ts`: Chat/Group/Write
  submission.
- `src/features/Home/InputArea/useSend.ts`: Chat/Task creation, run, and
  handoff.
- `src/features/Home/homeChatContentState.ts`: loading/error/empty/populated
  resolution.
- `src/features/HomeInbox/*`: Needs You, Brief, task status and actions.

Home state:

```text
loading -> empty | populated | error
populated -> chat submit | task create/run | open recent | resolve brief
error -> retry
```

Peers divergence:

- Home must consume Station Agent/topic/task/capability projections.
- Home must not own durable recents, task, or Brief truth.
- Promotion, Community, portrait/persona, and generation entry points are not
  part of the Peers claim.

## 3. Capability Plane Data Flow

```text
Agent profile / Tool surfaces
  -> store/tool
       -> builtin slice
       -> MCP store slice
       -> Connector slice
  -> service / lambdaClient operations
  -> Agent-owned configuration and Connector/MCP records
  -> Conversation intervention store
  -> ChatStore tool approval/execution
```

Verified anchors:

- `src/features/ProfileEditor/profileToolVisibility.ts#getVisibleProfileToolIds`:
  filters tools by surface ownership.
- `src/store/tool/slices/connector/action.ts#mountConnectorToAgent`: mounts and
  refreshes Agent Connector state.
- `src/store/tool/slices/connector/action.ts#syncConnectorTools`: refreshes
  Connector tool resources.
- `src/store/tool/slices/mcpStore/action.ts#installMCPPlugin`: bounded,
  cancellable MCP installation lifecycle.
- `src/features/Conversation/store/slices/tool/action.ts#approveToolCall`:
  waits for arguments, runs hooks, and delegates one approval.

Reference states:

```text
inventory -> install/connect -> configured
configured -> mounted/bound
bound -> tool proposal -> approval/deny -> execution -> result/failure
```

Peers divergence:

- Station owns versioned capability manifest, Agent binding/policy, admission,
  ToolCall lineage, and terminal result.
- Desktop Rust owns local MCP process, device permissions, and secret
  resolution.
- Connector OAuth connection and resource discovery are separate from Agent
  binding.
- Model/runtime compatibility is authoritative and evaluated before
  invocation.

## 4. Evaluation Lab Data Flow

```text
routes/(main)/eval
  -> store/eval
       -> benchmark
       -> dataset
       -> test case
       -> run
       -> experiment
  -> services/agentEval.ts
  -> lambdaClient.agentEval
  -> database agentEvals schemas/models
  -> workflow per-case execution/finalization
```

Verified anchors:

- `src/store/eval/slices/run/action.ts`: create/start/abort/retry/resume and
  result refresh.
- `src/services/agentEval.ts`: benchmark/dataset/test-case/run/experiment API.
- `packages/database/src/schemas/agentEvals.ts`: durable benchmark, experiment,
  dataset, test-case, run, and run-topic entities.
- `src/app/(backend)/api/workflows/agent-eval-run/finalize-run/route.ts`:
  terminal metrics finalization.

Reference run states:

```text
idle/draft -> pending -> running
running -> completed | failed | aborted
failed/partial -> retry case | resume case | batch resume
```

Peers divergence:

- Station owns benchmark, dataset, test case, run, case attempt/result, metrics,
  cancellation, and restart readback.
- Evaluation executes through the canonical Agent Turn kernel, not
  `quickCompletion`.
- Desktop is a projection/command surface and cannot infer terminal state.
- First Peers closure excludes experiments and broad import formats.

## 5. Architecture Mapping

| Reference behavior | Peers owner | Divergence rationale |
|---|---|---|
| Home store aggregates work entry | Station projection + Desktop runtime | Durable work state remains Station truth |
| Tool store combines sources | Station manifest catalog | One versioned source prevents split inventories |
| MCP install/execution | Desktop capability manager + Station operation | Process/secrets stay local; operation/turn truth stays Station |
| Connector mount/sync | OAuth owner + Station manifest/binding | Connection, resources, and Agent policy are distinct |
| Tool approval | Station policy/decision lineage | Exactly-once decision and execution survive replay |
| Evaluation run store/service | Station Evaluation aggregate | Cross-device recovery and actor isolation require durable authority |

## 6. Key Contract Responsibilities

| Contract | Responsibility |
|---|---|
| `CapabilityManifest` | Versioned source, schema, owner, requirements, risk |
| `AgentCapabilityBinding` | Agent-scoped enabled state and policy version |
| `CapabilityReadinessSnapshot` | Runtime/model/device compatibility at admission |
| `CapabilityOperation` | Install/test/connect/reconnect/cancel progress |
| `ToolCall` | Proposal, decision, execution, result, retry lineage |
| `ConnectorResourceManifest` | OAuth resource projected as a tool manifest |
| `EvaluationRun` | Target snapshot, lifecycle, progress, terminal metrics |
| `EvaluationCaseAttempt` | Per-case attempt/result/error and retry lineage |
