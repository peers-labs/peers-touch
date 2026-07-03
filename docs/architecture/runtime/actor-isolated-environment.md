# Actor Isolated Environment Plane — 架构设计

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-03 | **Updated**: 2026-07-03
> **Owner**: Peers-Touch Runtime Team
> **Module**: `apps/station/app/subserver/`

---

## 1. 核心原则

1. **环境是一等底座** — 本设计只定义用户隔离环境的创建、复用、生命周期、workspace 和 credential 边界；命令执行、Agent Turn 和工具结果属于上层能力。
2. **Actor 级隔离** — 每个 `actor_id#type=user` 拥有一个长期隔离环境；不同 actor 绝不共享环境、凭证、workspace cache。
3. **Station 编排，Adapter 执行** — Station 只依赖 `IsolatedEnvironmentAdapter`；Daytona 是首个 adapter，不进入领域模型。
4. **上层能力只消费环境** — Provider、Tool、Workflow 等上层域可消费隔离环境，但不能反向定义环境模型。
5. **环境不等于 Agent Turn** — 隔离环境不写 `agent_messages`，不理解 provider，不决定 tool result；它只提供可审计、可隔离、可复用的运行环境原语。

---

## 2. 系统架构

```text
Station Runtime
        │
        ▼
Actor Isolated Environment Plane
        │
        ├─ ActorEnvironmentRegistry
        │    └─ actor_id#type=user → environment_id
        │
        ├─ EnvironmentLifecycleService
        │    ├─ ensure
        │    ├─ health
        │    ├─ keepalive
        │    ├─ suspend
        │    └─ destroy
        │
        ├─ EnvironmentWorkspaceService
        │    └─ workspace_ref → isolated workspace path
        │
        ├─ EnvironmentCredentialService
        │    └─ secret refs → scoped environment injection
        │
        └─ IsolatedEnvironmentAdapter
             ├─ DaytonaEnvironmentAdapter
             ├─ DockerEnvironmentAdapter
             ├─ E2BEnvironmentAdapter
             └─ DesktopDeviceAdapter

Actor environment: actor_id#type=user
        │
        ├─ /home/peers/.peers/
        │    ├─ credentials/
        │    ├─ runtime/
        │    └─ logs/
        ├─ /home/peers/workspaces/{workspace_ref_hash}/
        └─ /home/peers/tmp/
```

能力依赖关系：

```text
Provider / Tool / Workflow
        │
        ▼
Upper Capability Domain
        │
        ▼
Actor Isolated Environment Plane
```

The isolated environment plane is a standalone foundation. It must be useful without depending on any specific provider, tool, or workflow.

---

## 3. 核心接口

### 3.1 Actor Environment Key

```proto
message ActorEnvironmentKey {
  string actor_id = 1;
  string actor_type = 2; // "user"
}
```

### 3.2 Environment Spec

```proto
message ActorEnvironmentSpec {
  ActorEnvironmentKey actor = 1;
  string backend = 2; // daytona | docker | e2b | desktop_device
  repeated string capabilities = 3; // shell | filesystem | network | workspace | secret
  uint32 ttl_minutes = 4;
  string base_image = 5;
  map<string, string> labels = 6;
}
```

### 3.3 Environment Record

```proto
message ActorEnvironment {
  string environment_id = 1;
  ActorEnvironmentKey actor = 2;
  string backend = 3;
  string backend_environment_id = 4;
  string status = 5; // provisioning | ready | unhealthy | suspended | destroying | destroyed
  repeated string capabilities = 6;
  int64 created_at_ms = 7;
  int64 last_used_at_ms = 8;
  int64 expires_at_ms = 9;
}
```

### 3.4 Adapter Interface

```go
type IsolatedEnvironmentAdapter interface {
    Ensure(ctx context.Context, key ActorEnvironmentKey, spec ActorEnvironmentSpec) (EnvironmentHandle, error)
    Health(ctx context.Context, env EnvironmentHandle) (EnvironmentHealth, error)
    KeepAlive(ctx context.Context, env EnvironmentHandle) error
    PrepareWorkspace(ctx context.Context, env EnvironmentHandle, workspace WorkspaceRef) (WorkspaceMount, error)
    InjectSecret(ctx context.Context, env EnvironmentHandle, secret SecretRef) (SecretHandle, error)
    Probe(ctx context.Context, env EnvironmentHandle, probe EnvironmentProbe) (ProbeResult, error)
    Suspend(ctx context.Context, env EnvironmentHandle) error
    Destroy(ctx context.Context, env EnvironmentHandle) error
}
```

`Probe` is for environment validation only, such as checking working directory, mounted workspace, and injected environment variables. Business command execution belongs to upper layers.

---

## 4. 组件关系

### 4.1 ActorEnvironmentRegistry

Registry owns durable actor-to-environment mapping:

```text
actor_key = "{actor_id}#type=user"
actor_key → environment_id → backend_environment_id
```

Responsibilities:

- create or reuse one ready environment per user actor
- record backend identity as opaque data
- track status, capability, TTL, last used time
- prevent cross-actor reuse

### 4.2 EnvironmentLifecycleService

Lifecycle service owns state transitions:

```text
missing → provisioning → ready
ready → unhealthy
ready → suspended
ready|unhealthy|suspended → destroying → destroyed
```

It does not know why the environment is used. It only ensures the environment exists and is safe to hand to dependent domains.

### 4.3 Workspace Service

Workspace service prepares actor-scoped workspace paths:

```text
/home/peers/workspaces/{workspace_ref_hash}/
```

Initial scope:

- git clone or snapshot restore
- fixed path convention
- workspace metadata record
- no incremental bidirectional sync yet

### 4.4 Credential Service

Credential service injects secret references into an actor environment with strict redaction:

- no secret values in logs
- no secret values in environment records
- no secret values in probe results
- scope by actor and capability

### 4.5 Daytona Adapter

Daytona adapter maps environment operations to Daytona API. It must stay below the adapter boundary:

| Environment operation | Daytona adapter behavior |
|---|---|
| `Ensure` | find existing actor sandbox or create one |
| `Health` | inspect backend sandbox status |
| `PrepareWorkspace` | clone or restore workspace |
| `InjectSecret` | inject scoped env/secret |
| `Probe` | run safe validation probe |
| `KeepAlive` | refresh TTL |
| `Destroy` | destroy backend sandbox and mark record destroyed |

---

## 5. API

Station internal service:

```text
ActorEnvironmentService.Ensure(actor, spec) -> ActorEnvironment
ActorEnvironmentService.Get(actor) -> ActorEnvironment
ActorEnvironmentService.Health(environment_id) -> EnvironmentHealth
ActorEnvironmentService.PrepareWorkspace(environment_id, workspace_ref) -> WorkspaceMount
ActorEnvironmentService.InjectSecret(environment_id, secret_ref) -> SecretHandle
ActorEnvironmentService.Probe(environment_id, probe) -> ProbeResult
ActorEnvironmentService.KeepAlive(environment_id)
ActorEnvironmentService.Destroy(environment_id)
```

External client endpoints are not required for the environment foundation. Clients should not directly control environment lifecycle unless Station exposes an explicit governance surface for quotas and permissions.

---

## 6. 非目标

This plan explicitly does not implement:

- business command execution
- provider routing
- tool result conversion
- chat message persistence
- outbox projection

Those concerns belong to upper-layer domains that consume the environment foundation.

---

## 7. Evaluation System

| Layer | Success signal | Regression signal |
|---|---|---|
| Asset | every user actor has at most one active environment record | environment created without actor mapping |
| Behavior | same actor reuses environment; different actors never share | actor A can access actor B environment/workspace/secret |
| Comparison | Daytona can be replaced behind adapter without domain rewrite | Daytona-specific fields leak into lifecycle/domain service |
| Long-term | upper-layer execution domains depend on environment APIs | upper-layer domains create backend sandboxes directly |

Governance rule: upper-layer domains may depend on this plane, but must not redefine actor environment identity, lifecycle, workspace layout, or credential isolation.
