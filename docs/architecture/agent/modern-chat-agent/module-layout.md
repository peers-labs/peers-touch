# Modern Chat Agent — Module Layout

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-08-17
> **Owner**: Peers-Touch Agent Team

---

## 1. Target Layout

```text
model/domain/agent/
├── agent.proto                 # Agent, conversation, message, turn commands
├── turn_event.proto            # Sequenced runtime event contract
├── runtime.proto               # Runtime kind, capability snapshot, budget
├── client_capability.proto      # Platform-neutral local capability lease
├── context.proto               # ContextLedger and source attribution
├── tool.proto                  # Tool request/result/approval/audit
├── capability.proto            # Manifest, binding, readiness, operation
├── evaluation.proto            # Benchmark, dataset, case, run, result
├── home.proto                  # Revisioned Home work projection
├── memory.proto                # Existing memory contracts
├── skill.proto                 # Existing skill contracts
└── orchestration.proto         # Multi-Agent, downstream of turn kernel

apps/station/app/subserver/agent/
├── domain/
│   ├── agent.go
│   ├── conversation.go
│   ├── turn.go
│   ├── runtime.go
│   ├── context.go
│   └── tool.go
├── handler/
│   ├── agent_config_handler.go
│   ├── conversation_handler.go
│   ├── turn_handler.go
│   ├── tool_handler.go
│   ├── capability_handler.go
│   ├── evaluation_handler.go
│   ├── home_handler.go
│   └── trace_handler.go
├── service/
│   ├── turn_admission_service.go
│   ├── turn_service.go
│   ├── prompt_assembly_service.go
│   ├── runtime_resolver_service.go
│   ├── provider_service.go
│   ├── external_runtime_service.go
│   ├── tool_registry_service.go
│   ├── capability_binding_service.go
│   ├── capability_operation_service.go
│   ├── connector_manifest_service.go
│   ├── home_projection_service.go
│   ├── local_tool_broker.go
│   ├── memory_service.go
│   ├── skill_service.go
│   ├── knowledge_retrieval_service.go
│   ├── compression_service.go
│   ├── trace_service.go
│   └── evaluation_service.go
├── runtime/
│   ├── direct/
│   └── external/
├── infrastructure/persistence/
└── catalog/

apps/desktop/src-tauri/src/application/
├── agent_turn/                 # Station command/SSE bridge only
├── agent_local_capability/     # Client capability session implementation
├── capability_operation/      # Leased operation execution/reporting
├── mcp/                        # Local MCP transport/execution
├── tools/                      # Local builtin execution
├── workspace/                  # Device-local workspace/file policy
└── audit/                      # Local execution audit projection

apps/desktop/src/
├── runtimes/
│   ├── agentRuntime.ts
│   ├── chatRuntime.ts
│   ├── agentTopicRuntime.ts
│   ├── toolRuntime.ts
│   ├── homeRuntime.ts
│   ├── capabilityRuntime.ts
│   ├── evaluationRuntime.ts
│   ├── skillRuntime.ts
│   └── knowledgeRuntime.ts
├── services/agent/
├── services/chat/
├── services/tools/
├── store/
│   ├── agent.ts
│   ├── chat.ts
│   ├── agentTopics.ts
│   ├── tool.ts
│   ├── skill.ts
│   └── knowledge.ts
└── diagnostics/

apps/mobile/
├── src/
│   ├── runtimes/agentRuntime.ts
│   ├── services/agent/
│   └── pages/
└── src-tauri/
    ├── agent_turn/              # Shared Station command/SSE semantics
    └── client_capability/       # Mobile Rust/native plugin capabilities
```

Names express target responsibilities. Existing files may be retained when
they already satisfy the responsibility; the architecture does not require
mechanical file creation.

## 2. Registration And Source Rules

| Concern | Single registration/source |
|---|---|
| Shared contracts | `model/domain/agent/*.proto` |
| Provider/model/runtime capabilities | Station catalog/runtime resolver |
| Turn state machine | Station TurnService |
| Tool schemas and execution owner | Station ToolRegistryService |
| Capability manifest/binding/readiness | Station Capability Manifest/Binding services |
| Capability operation lifecycle | Station operation service; selected executor reports progress |
| Connector resource manifests | Station Connector Manifest service; OAuth owner supplies scoped resources |
| Home work projection | Station Home Projection service |
| Evaluation run/result | Station Evaluation service |
| Direct model adapters | Station runtime registry |
| External Agent adapters | Station external runtime registry |
| Client-local capabilities | Shared capability contract; platform registry projected to Station |
| Desktop runtime projections | `services/appRuntime.ts` runtime registration |
| Page dependencies | Agent `PageDescriptor.runtimes` |

No second catalog, registry, or durable store may be introduced for these
concerns.

## 3. Dependency Direction

```text
Client page
  -> client runtime/store
  -> client service adapter
  -> client Rust capability kernel
  -> Station handler
  -> Station service
  -> Station domain/persistence/runtime adapter

Agent Canvas
  -> Station orchestration
  -> canonical TurnService
```

Allowed reverse communication is typed event projection only:

```text
Station turn event -> client bridge/gateway -> client runtime -> page
```

## 4. Module Responsibilities

| Module | Responsibility | Must not |
|---|---|---|
| `turn_admission_service` | Idempotency, active turn, bounded queue | Call providers |
| `turn_service` | Canonical turn transitions and Agent loop | Own UI projection |
| `prompt_assembly_service` | Build ContextLedger and provider context | Select client-local files directly |
| `runtime_resolver_service` | Resolve runtime/capabilities/budget | Trust client capability claims |
| `runtime/direct` | Stateless model execution | Retain conversation state |
| `runtime/external` | Conversation-bound external runtime lifecycle | Share writable homes |
| `tool_registry_service` | Tool schema, owner, policy, audit contract | Execute device APIs |
| `capability_binding_service` | Versioned Agent capability bindings/policy | Store credentials or infer readiness |
| `capability_operation_service` | Durable install/test/connect/cancel/reconnect lifecycle | Spawn local processes |
| `connector_manifest_service` | Scope-bound Connector resource→tool manifests | Own OAuth tokens |
| `home_projection_service` | Revisioned Agent/topic/task/capability projection | Become a write model |
| `evaluation_service` | Benchmark/case/run/result/metrics aggregate | Use a parallel model execution path |
| `local_tool_broker` | Await typed client result | Decide turn completion |
| Client `agent_turn` | Bridge commands/events/cancel | Execute AI providers |
| Client `capability_operation` | Execute leased local operation and report progress/cleanup | Decide Station terminal truth |
| Client local capability | Enforce local permissions/approval and execute | Persist Station turn truth |
| `chatRuntime` | Stream/replay/reconcile message projection | Mutate durable truth locally |
| `agentTopicRuntime` | Conversation and branch projection | Own messages or provider runtime |
| diagnostics | Redacted export/view | Become a second trace store |

## 5. Forbidden Imports And Calls

- Client provider/chat modules must not import AI CLI process execution.
- Client pages must not call Station/Tauri APIs for projection freshness.
- Station domain and service layers must not import platform-specific contracts.
- Provider adapters must not import conversation persistence.
- External runtime adapters must not derive ownership from Agent name alone.
- Agent Canvas must not call provider adapters directly.
- Tool executors must not mutate turn state outside TurnService.
- Home pages/stores must not aggregate durable truth outside `homeRuntime`.
- Source-specific Tool/MCP/Connector stores must not claim global readiness.
- Evaluation client code must not execute `quickCompletion` or infer terminal run state.
- Generated contract files must not be edited manually.

## 6. Lifecycle Ownership

| Resource | Lifecycle owner |
|---|---|
| Agent definition | Station Agent config service |
| Conversation and branches | Station conversation service |
| Active/queued turn | Station admission/turn services |
| Direct provider request | Station Direct Runtime |
| External runtime home/session/process | Station External Runtime Manager |
| Local MCP/tool/native process | Owning client capability manager |
| Capability operation | Station lifecycle; selected client executor owns local resources |
| Connector OAuth credential | OAuth subsystem |
| Connector resource manifest | Station Connector Manifest service |
| Home work projection | Station projection service; client runtime owns cached projection only |
| Evaluation run/case result | Station Evaluation service |
| Web subscriptions/timers | Owning client runtime descriptor |
| Trace and feedback | Station trace/evaluation services |

Shutdown and deletion flow from the owning module. Callers request lifecycle
changes; they do not clean another module's resources directly.
