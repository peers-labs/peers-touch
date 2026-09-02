# Actor Isolated Environment Plane — 执行计划

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-03 | **Updated**: 2026-07-03
> **Owner**: Peers-Touch Runtime Team
> **Module**: `apps/station/app/subserver/`

---

## 1. 背景与目标

This plan implements the Actor Isolated Environment Plane: a reusable Station-hosted environment per user actor.

Goal:

- one active isolated environment per `actor_id#type=user`
- backend-neutral environment adapter
- Daytona adapter as the first backend
- actor-scoped workspace and credential provisioning
- lifecycle, health, TTL, cleanup, and audit records

---

## 2. 范围与非目标

### 范围

- Actor environment identity and registry.
- Environment lifecycle state machine.
- Adapter interface for sandbox backends.
- Daytona adapter MVP.
- Workspace preparation inside the actor environment.
- Scoped credential injection.
- Health/probe/TTL/cleanup.
- Minimal observability and audit.

### 非目标

- No business command execution.
- No provider routing.
- No tool integration.
- No chat message persistence.
- No outbox projection.

---

## 3. 领域拆分

| Domain | Responsibility | Deliverable |
|---|---|---|
| D1 Actor Environment Model | actor key, environment spec, status, capability | model + validation |
| D2 Environment Registry | durable actor-to-environment mapping | registry repository/service |
| D3 Lifecycle Service | ensure, health, keepalive, suspend, destroy | lifecycle state machine |
| D4 Adapter Boundary | backend-neutral isolated environment interface | interface + fake adapter |
| D5 Daytona Adapter | first backend implementation | Daytona client wrapper |
| D6 Workspace Provisioning | actor-scoped workspace preparation | workspace mount records |
| D7 Credential Provisioning | actor-scoped secret injection | redacted secret handles |
| D8 Operations | TTL cleanup, quota, audit, diagnostics | scheduler + audit events |

---

## 4. 标准生命周期

```text
Station receives need for actor environment
  → build ActorEnvironmentKey(actor_id, actor_type=user)
  → Registry lookup
  → if ready and healthy: KeepAlive + return
  → if missing/expired/unhealthy: Lifecycle Ensure
  → Adapter Ensure backend environment
  → Registry records environment_id + backend_environment_id
  → Health probe
  → PrepareWorkspace(workspace_ref) when requested
  → InjectSecret(secret_ref) when requested
  → return ready ActorEnvironment / WorkspaceMount / SecretHandle
```

This lifecycle ends at a ready environment. It does not execute business commands.

---

## 5. 实施阶段

### Phase 1: Actor Environment Model

- 目标：定义用户隔离环境的领域对象和状态机。
- 涉及模块：
  - `apps/station/app/subserver/`
  - `model/domain/` only if cross-process proto is required.
- 交付：
  - `ActorEnvironmentKey`
  - `ActorEnvironmentSpec`
  - `ActorEnvironment`
  - status machine: `provisioning | ready | unhealthy | suspended | destroying | destroyed`
  - capability set: `shell | filesystem | network | workspace | secret`
- 验收：
  - unit tests for actor key normalization and status transition.
  - no upper-layer business fields in environment model.

### Phase 2: Environment Registry

- 目标：实现 `actor_id#type=user → environment_id` durable mapping.
- 涉及模块：
  - Station repository/persistence layer.
- 交付：
  - `actor_environments` table or equivalent repository object.
  - `GetByActor`, `Create`, `MarkStatus`, `MarkUsed`, `Expire`.
  - uniqueness guarantee: one active environment per actor.
- 验收：
  - same actor reuses active environment.
  - different actors cannot share an active environment.
  - expired environment is not returned as ready.

### Phase 3: Lifecycle Service

- 目标：实现 environment ensure/health/keepalive/destroy orchestration.
- 涉及模块：
  - Station domain service.
- 交付：
  - `ActorEnvironmentService.Ensure`
  - `Health`
  - `KeepAlive`
  - `Suspend`
  - `Destroy`
  - typed errors: unavailable backend, unhealthy environment, quota exceeded.
- 验收：
  - lifecycle works against fake adapter.
  - backend failure does not create a ready registry record.

### Phase 4: Adapter Boundary + Fake Adapter

- 目标：先稳定 adapter contract，避免 Daytona 泄漏到领域层。
- 涉及模块：
  - Station infrastructure layer.
- 交付：
  - `IsolatedEnvironmentAdapter` interface.
  - fake adapter for deterministic tests.
  - adapter factory by backend name.
- 验收：
  - domain/lifecycle tests use fake adapter.
  - grep confirms no Daytona-specific type in domain service.

### Phase 5: Daytona Adapter MVP

- 目标：用 Daytona 跑通 actor environment create/reuse/health/cleanup.
- 涉及模块：
  - Station infra adapter and config.
- 交付：
  - Daytona client wrapper.
  - `Ensure`, `Health`, `KeepAlive`, `Probe`, `Destroy`.
  - config: endpoint, auth, base image, TTL, workspace root.
- 验收：
  - one actor creates one Daytona environment.
  - same actor ensure returns same backend environment.
  - destroy marks registry destroyed and removes backend environment.

### Phase 6: Workspace Provisioning

- 目标：把 workspace 准备成 actor environment 内的稳定路径。
- 涉及模块：
  - Station workspace service / workspace references.
- 交付：
  - `PrepareWorkspace(environment_id, workspace_ref)`.
  - path convention: `<runtime-home>/workspaces/{workspace_ref_hash}`.
  - workspace mount record.
  - initial clone/snapshot strategy.
- 验收：
  - same workspace_ref maps to same path for the actor.
  - actor A and actor B never share workspace path/storage.

### Phase 7: Credential Provisioning

- 目标：向环境注入 actor-scoped secrets without leakage.
- 涉及模块：
  - Station credential/vault integration.
- 交付：
  - `InjectSecret(environment_id, secret_ref)`.
  - redacted audit event.
  - no secret values in request logs, registry records, probe output.
- 验收：
  - tests verify redaction.
  - actor cannot inject another actor's secret.

### Phase 8: Operations and Governance

- 目标：让环境能力可运营。
- 涉及模块：
  - Station scheduler/metrics/audit.
- 交付：
  - idle TTL cleanup.
  - per-actor quota.
  - health diagnostics.
  - audit events for ensure/destroy/workspace/secret.
- 验收：
  - stale environment cleanup works.
  - quota exceeded returns typed error.
  - audit record never contains secret values.

---

## 6. 依赖顺序

```text
D1 Model
  → D2 Registry
  → D3 Lifecycle
  → D4 Adapter boundary + fake
  → D5 Daytona adapter
  → D6 Workspace provisioning
  → D7 Credential provisioning
  → D8 Operations
```

Upper-layer execution domains must not bypass this environment plane to create backend sandboxes directly.

---

## 7. 风险与缓解

| Risk | Mitigation |
|---|---|
| Daytona maintenance uncertainty | adapter boundary; only infra adapter imports Daytona client |
| environment model polluted by upper-layer execution concepts | explicit non-goal; environment model contains no provider/tool/business command fields |
| cross-actor data leakage | uniqueness constraints, actor-scoped path, actor-scoped secret refs |
| workspace sync complexity | use clone/snapshot as the initial sync contract |
| secret leakage | redaction tests, no raw values in logs/records/probes |
| orphaned environments | TTL cleanup and destroy audit |
| cost growth from long-lived environments | per-actor quota and idle timeout |

---

## 8. 验证方式

- Station:
  - `cd apps/station && gofmt -l . && go test ./...`
- Proto, if changed:
  - `./model/build.sh`
- Architecture checks:
  - no business command execution in this plan.
  - no provider/tool/business command fields in environment model.
  - no Daytona-specific types above adapter layer.
- Manual / integration:
  - actor A ensure → one Daytona environment.
  - actor A ensure again → same environment.
  - actor B ensure → different environment.
  - workspace_ref prepared under actor-scoped path.
  - secret injection audit redacts values.

---

## 9. 实施状态

| Phase | 状态 | 完成日期 | 备注 |
|---|---|---|---|
| Phase 1 | pending | — | actor environment model |
| Phase 2 | pending | — | registry |
| Phase 3 | pending | — | lifecycle service |
| Phase 4 | pending | — | adapter boundary + fake |
| Phase 5 | pending | — | Daytona adapter |
| Phase 6 | pending | — | workspace provisioning |
| Phase 7 | pending | — | credential provisioning |
| Phase 8 | pending | — | operations |
