# Acceptance Framework — Runtime Provisioning 数据模型

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-08-16 | **Updated**: 2026-09-13
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 1. Document Scope

本文档定义：

- Environment Provisioning Contract 的机器可读字段。
- Runtime Resource Manifest、Station Attestation、Actor Manifest 和 Gap Artifact。
- 多服务环境中的 client-to-service binding 与校验规则。
- Provisioning 生命周期状态及转换规则。
- Native Desktop Runtime Cell、远端 transport、GUI session 与 platform adapter identity。
- Ephemeral Gate Launch Context、anonymous capability channel与typed failure。
- 敏感值与可持久化 evidence 的边界。
- Evidence Store root、identity、ArtifactRef、run manifest和latest pointer。

本文档不定义：

- Chat 产品消息或 Receipt 的业务模型。
- Profile、deployment、Fixture 和 Driver 的具体实现步骤。
- 具体账号、密码、主机、端口或 PTID。

## 2. Environment Provisioning Contract

Contract 是仓库内长期定义，描述一个 Gate environment 需要什么，不记录某次运行
实际获得了什么。

```yaml
id: home-station
profile:
  required: true
  identity_match: true
services:
  station-primary:
    kind: station
    required: true
    runtime_identity_required: true
    ready_action: station
    health_action: station-check
    status_action: station-status
    attestation_producer: station-deployment
  station-secondary:
    kind: station
    required: true
    runtime_identity_required: true
    ready_action: station
    health_action: station-check
    status_action: station-status
    attestation_producer: station-deployment
clients:
  - id: alice-primary
    actor: alice
    runtime: native-tauri
    required_service_roles: [station]
    service_bindings:
      station:
        service_id: station-primary
        required_kind: station
  - id: bob-secondary
    actor: bob
    runtime: native-tauri
    required_service_roles: [station]
    service_bindings:
      station:
        service_id: station-secondary
        required_kind: station
fixtures:
  - id: chat-native-actors
credentials:
  - id: chat-password
    source_ref: env:CHAT_NATIVE_DEMO_PASSWORD
    required: true
cleanup:
  resources: [processes, ports, storage, sessions]
```

约束：

- `id` 必须与 `gates.yaml.environment` 一致。
- 每个 service 必须声明 `kind`；需要稳定 peer/runtime identity 的环境必须设置
  `runtime_identity_required: true`。
- client ID 在一个 Environment Contract 内必须唯一；`service_bindings` 的 role、
  `service_id` 和 `required_kind` 必须是非空稳定标识。
- `required_service_roles` declares the closed set of binding roles the client
  depends on. The validator requires `service_bindings.keys()` to equal
  `required_service_roles` exactly; a missing role produces
  `MISSING_REQUIRED_BINDING`, an extra role produces `UNEXPECTED_BINDING_ROLE`.
  The field is mandatory. A service-independent client must explicitly declare
  `required_service_roles: []`; omission is invalid and must not default to an
  empty list. Empty `service_bindings` is valid only for that explicit case.
- Client ID and binding role must match `^[a-z0-9][a-z0-9-]{0,63}$`
  (same grammar as `SERVICE_ID_PATTERN`).
- 每个 binding 的 `service_id` 必须引用同一 contract 的 service，且
  `required_kind` 必须等于被引用 service 的 `kind`。
- client binding 不得包含 endpoint、deployment environment、commit、credential
  或 runtime identity；这些值只从 service attestation 解析。
- `source_ref` 只允许引用，不允许写具体 secret value。
- destructive Fixture 必须声明 authorization 和 target verification。
- Contract 缺失或字段不完整时，plan 可以生成，但 environment Gate 不得执行。

## 3. Runtime Resource Manifest

Manifest 是一次 provisioning 运行的不可变输出。

```json
{
  "artifactKind": "acceptance-runtime-manifest",
  "environmentId": "home-station",
  "gateId": "chat-native-two-client-e2e",
  "runId": "<opaque-run-id>",
  "createdAt": "<UTC timestamp>",
  "state": "FIXTURE_READY",
  "source": {
    "worktree": "<absolute-path>",
    "commit": "<git-commit>",
    "workspaceDigest": "<sha256>"
  },
  "profile": {
    "requestedName": "three",
    "resolvedName": "three",
    "slot": 2
  },
  "services": {
    "station-primary": {
      "kind": "station",
      "deploymentEnvironment": "station-two",
      "endpoint": "<redacted-safe-url>",
      "runtimeIdentity": "<station-peer-id>",
      "liveCommit": "<commit>",
      "protocolDigest": "<sha256>",
      "workspaceDigest": "clean",
      "attestationArtifact": {
        "artifactKind": "acceptance-artifact-ref",
        "workspaceId": "<workspace-id>",
        "gateId": "<gate-id>",
        "runId": "<run-id>",
        "path": "runtime/services/station-primary/attestation.json",
        "sha256": "<sha256>",
        "mediaType": "application/json"
      }
    },
    "station-secondary": {
      "kind": "station",
      "deploymentEnvironment": "station-three",
      "endpoint": "<redacted-safe-url>",
      "runtimeIdentity": "<station-peer-id>",
      "liveCommit": "<commit>",
      "protocolDigest": "<sha256>",
      "workspaceDigest": "clean",
      "attestationArtifact": {
        "artifactKind": "acceptance-artifact-ref"
      }
    },
    "relay": {
      "kind": "relay",
      "deploymentEnvironment": "relay-1",
      "endpoint": "<redacted-safe-url>",
      "runtimeIdentity": "<relay-peer-id>",
      "liveCommit": "<commit>",
      "protocolDigest": "<sha256>",
      "workspaceDigest": "clean",
      "attestationArtifact": {
        "artifactKind": "acceptance-artifact-ref"
      }
    }
  },
  "actorManifest": {
    "artifactKind": "acceptance-artifact-ref",
    "workspaceId": "<workspace-id>",
    "gateId": "<gate-id>",
    "runId": "<run-id>",
    "path": "runtime/actor-manifest.json",
    "sha256": "<sha256>",
    "mediaType": "application/json"
  },
  "credentialRefs": ["env:CHAT_NATIVE_DEMO_PASSWORD"],
  "clients": [
    {
      "id": "alice-primary",
      "actor": "alice",
      "runtime": "native-tauri",
      "required_service_roles": ["station"],
      "service_bindings": {
        "station": {
          "service_id": "station-primary",
          "required_kind": "station"
        }
      },
      "worktree": "<workspace-root>",
      "gateway_port": 4540,
      "renderer_port": 4610,
      "webdriver_port": 4645,
      "profile": "chat-native-alice-primary",
      "storage_root": "<runtime-home>/acceptance/<run-id>/alice-primary"
    }
  ],
  "cleanup": {
    "registered": true,
    "resources": ["processes", "ports", "storage", "sessions"]
  }
}
```

`source.worktree`保留现有schema。D-19不新增第二个persisted worktree identity字段；
Core按Evidence Store的canonical path算法从`source.worktree`派生
`canonicalWorktreeHash`，并要求它等于Store-owned `RunHandle.source`中的同名字段。
`source.commit`和`source.workspaceDigest`也必须逐项相等。

Manifest identity requirements:

- `runId` 在同一 Acceptance run 内唯一。
- `source.commit` 来自实际客户端 worktree。
- `services` 始终存在；provisioning 前可为空对象，ready manifest 必须覆盖所有
  required Environment services。
- service map key 必须等于 attestation `serviceId`，并且 kind 必须匹配
  Environment Contract。
- `services.*.liveCommit` 来自对应 live endpoint，不由本地推断。
- `services.*.attestationArtifact` 指向实际 deployment/runtime producer 的输出。
- `clients[].id` 是一次 Environment Contract 内的稳定 client identity，必须与
  contract declaration 一致且唯一；`actor` 不能替代 client ID，因为同一 actor
  可以拥有多个隔离 client / device。
- `clients[].service_bindings` 必须与 Environment Contract 的 client binding
  完全一致，并且只引用当前 manifest 的 `services`。
- D-18 adds only `id`, `required_service_roles`, and `service_bindings` to the
  existing `ClientRuntime` allocation record. It does not redefine port,
  profile, storage, session, device, or platform isolation contracts; those
  remain owned and validated by D-13 Runtime Cell and the existing platform
  Provisioners.
- Consumer 必须先按 client identity 取得 binding，再按 service ID 解析 endpoint；
  禁止从 client 顺序、service map 顺序、Profile 默认值或业务常量推断。
- 多个 client 可以共享一个 service；同一 client 可以声明多个不同 role。role
  重复、悬空 service、kind mismatch 或 endpoint 副本都会使 manifest 无效。

**Binding proof obligation**:

Every call that starts or restarts a client must go through the platform-owned
`create_bound_session(client_id, launch_options)` operation.
The Runtime Binding resolves the service through the immutable Runtime Manifest,
allocates the next monotonic `launchGeneration` for that client, launches the
client, collects one platform observation for every
`required_service_roles` entry, and asks the Core binding verifier to persist
one `BindingProofRecord` per role before returning the session to the business
Gate.

`launch_options` is a closed typed contract owned by the selected Runtime
Binding. Unknown fields are rejected. It may contain only non-topology
operations such as window placement, restore mode, or wait policy; arbitrary
environment maps and fields carrying endpoint, URL, host, port, service ID,
deployment identity, commit, or runtime identity are forbidden.

Run-scoped network-fault injection uses a separate opaque
`TransportOverrideHandle`, not `launch_options` or `service_bindings`.
Runtime Binding creates the handle from a Domain-owned local fault endpoint,
keeps the routable endpoint private, and exposes only
`apply_transport_override(client_id, binding_role, handle)` /
`clear_transport_override(...)` to the Gate. The handle is bound to the current
run, client, binding role, and declared service ID. It cannot replace the
canonical binding or satisfy `BindingProofRecord`; Domain fault evidence owns
proxy upstream identity, behavior, and cleanup.

```json
{
  "artifactKind": "client-binding-proof",
  "evidenceRunId": "<evidence-store-run-id>",
  "provisioningRunId": "<runtime-manifest-run-id>",
  "environmentId": "home-station",
  "gateId": "chat-native-two-client-e2e",
  "clientId": "alice-primary",
  "bindingRole": "station",
  "declaredServiceId": "station-primary",
  "launchGeneration": 1,
  "serviceAttestationRef": {
    "artifactKind": "acceptance-artifact-ref",
    "workspaceId": "<workspace-id>",
    "gateId": "chat-native-two-client-e2e",
    "runId": "<evidence-store-run-id>",
    "path": "runtime/services/station-primary/attestation.json",
    "sha256": "<attestation-sha256>",
    "mediaType": "application/json"
  },
  "serviceAttestationDigest": "<sha256-of-station-primary-attestation>",
  "clientRuntimeIdentity": {
    "runtime": "native-tauri",
    "instanceId": "<runtime-binding-owned-run-local-id>",
    "identityDigest": "<sha256-of-d13-runtime-instance-identity>"
  },
  "observedRuntimeIdentity": "<station-peer-id>",
  "capturedAt": "<UTC timestamp>",
  "proofMechanism": "native-tauri-peer-id-check",
  "verifierId": "core-client-binding",
  "verifierSourceDigest": "<sha256>",
  "verificationStatus": "VERIFIED"
}
```

- `evidenceRunId` and `provisioningRunId` are distinct and mandatory. The
  former identifies the Evidence Store run; the latter equals the final Runtime
  Manifest `runId`. Neither may be inferred from the other.
- `environmentId`, `gateId`, `clientId`, `bindingRole`, and
  `declaredServiceId` must equal the immutable manifest projection.
- `serviceAttestationRef` resolves the exact service attestation in the same
  Evidence Store run; `serviceAttestationDigest` must equal its SHA-256.
- `clientRuntimeIdentity` is platform-neutral. `runtime` must equal the
  manifest client's runtime; `instanceId` is unique within the run and is
  minted by Runtime Binding for the launch generation; `identityDigest` covers
  the existing D-13 platform runtime identity. Desktop may derive that digest
  from process identity, Mobile from device/session identity, and Federation
  from browser-session identity. D-18 does not define or duplicate those
  platform payloads.
- The registered platform observer must read
  `observedRuntimeIdentity` from the running client's live connection state
  after launch and bind the observation to `clientRuntimeIdentity`. It
  must not derive or copy the observed value from Runtime Manifest bindings,
  launch options, environment variables, or ServiceAttestation. The observer
  cannot supply expected identity or a `match` boolean.
- Core resolves `expectedRuntimeIdentity` directly from the referenced
  ServiceAttestation and derives `verificationStatus`; `VERIFIED` is emitted
  only when observed and expected identities are equal.
- `proofMechanism` is platform-specific and must be registered with Core.
  Unregistered mechanisms are rejected.
- The proof body contains neither its own ArtifactRef nor a Runtime Manifest
  ArtifactRef. Evidence Store returns the proof ArtifactRef after persistence;
  Runtime Binding appends it to its run-local binding-proof collection, and
  Core harness finalization records that collection in the Gate result without
  business-Gate participation.
- Runtime Binding, not its caller, owns `launchGeneration`. It starts at 1 per
  client and increases for every restart. Core harness finalization requires
  exact proof closure:
  `proof keys == {(clientId, launchGeneration, role) for every allocated
  generation and every role in required_service_roles}`. A session is never
  returned to business Gate code before every required role in its generation
  has a `VERIFIED` proof.
- Proof artifacts use existing Evidence Store atomic-write, cleanup, and
  retention semantics. An unreferenced proof left by a crash is diagnostic
  only and cannot satisfy Gate evidence.

**ClientBindingError typed codes**:

All binding validation failures use typed error codes. Each code belongs to the
`20000s` protocol error range and maps to a specific failure stage and result:

| Code | Numeric | Stage | Trigger | Result |
|------|---------|-------|---------|--------|
| `DUPLICATE_CLIENT_ID` | 20101 | pre-launch | Two clients share an `id` | `BLOCKED` |
| `DANGLING_SERVICE_REF` | 20102 | pre-launch | `service_id` not found in `services` | `BLOCKED` |
| `KIND_MISMATCH` | 20103 | pre-launch | `required_kind` differs from service `kind` | `BLOCKED` |
| `MISSING_REQUIRED_BINDING` | 20104 | pre-launch | Role in `required_service_roles` has no matching `service_bindings` entry | `BLOCKED` |
| `UNEXPECTED_BINDING_ROLE` | 20105 | pre-launch | Binding role not declared in `required_service_roles` | `BLOCKED` |
| `ENDPOINT_COPY_DETECTED` | 20106 | pre-launch | Binding or launch options contains topology, arbitrary environment map, endpoint, commit, or runtime identity | `BLOCKED` |
| `TRANSPORT_OVERRIDE_MISMATCH` | 20107 | runtime | Override handle does not match the current run, client, role, or declared service | `BLOCKED` |
| `BINDING_PROOF_ABSENT` | 20201 | post-launch | No `BindingProofRecord` emitted for a required role | `UNPROVEN` |
| `LAUNCH_IDENTITY_MISMATCH` | 20202 | post-launch | Observed identity differs from ServiceAttestation runtime identity | `BLOCKED` |
| `UNREGISTERED_PROOF_MECHANISM` | 20203 | post-launch | `proofMechanism` not registered with Core | `BLOCKED` |

The error object structure is:

```json
{
  "code": "DANGLING_SERVICE_REF",
  "numericCode": 20102,
  "stage": "pre-launch",
  "clientId": "alice-primary",
  "bindingRole": "station",
  "detail": "<redacted context>",
  "result": "BLOCKED"
}
```

Core or Runtime Binding must emit the structured error before propagating
failure.
`BINDING_PROOF_ABSENT` and `LAUNCH_IDENTITY_MISMATCH` are distinct failure
modes: the former means no evidence exists, the latter means contradictory
evidence exists. They must never be conflated. `BUSINESS_MIGRATION_REQUIRED`
is an Acceptance Gap classification, not a `ClientBindingError`.
- `profile.requestedName` 与 `resolvedName` 不一致时状态必须为 `BLOCKED`。
- 顶层 `station` 字段已删除；reader 遇到旧字段必须 fail closed。
- `source.workspaceDigest` 覆盖所有可执行源码和手写契约，但不包含自动生成的
  `docs/architecture/acceptance-framework/coverage-report.md`；生成覆盖报告不得使
  刚验证的 source-bound evidence 自身失效。
- `services.*.protocolDigest` 只覆盖 Git 跟踪的 proto source 与生成绑定；本地 codegen
  产生但未进入 commit 的派生文件不得改变同一 source commit 的 attestation。
- `env:`、`file:` 和 `auto:` credential references 必须对应已扫描的内存值；
  `fixture:` references 指向仓库中已提交的 disposable 测试数据，不作为 secret
  扫描输入，也不得用于生产运行时。

## 4. Service Attestation

```json
{
  "artifactKind": "service-deployment-attestation",
  "capturedAt": "<UTC timestamp>",
  "serviceId": "station-primary",
  "serviceKind": "station",
  "environmentId": "home-station",
  "deploymentEnvironment": "station-two",
  "endpoint": "<redacted-safe-url>",
  "commit": "<deployed-commit>",
  "workspaceDigest": "clean",
  "protocolDigest": "<sha256>",
  "runtimeIdentity": "<station-peer-id>",
  "liveMetadata": {
    "buildCommit": "<live-endpoint-commit>"
  },
  "producer": "station-deployment"
}
```

通用规则：

- Producer 必须是该 service 的 deployment/runtime owner。
- service ID 必须是 Environment Contract 中的稳定角色，service kind 必须匹配。
- artifact 必须写入
  `runtime/services/<service-id>/attestation.json`，同一 run 内禁止覆盖。
- Consumer Gate 按稳定 service ID 选择服务并验证 kind，不得按 map 顺序推断。
- Consumer Gate 必须比较 attested commit、live commit 和 client commit。
- `workspaceDigest != clean` 时 Native source-bound proof fail closed。
- Attestation 不包含部署凭据、SSH target credential 或数据库 secret。

Station-specific 规则：

- Station producer 必须是 Station deployment/runtime owner。
- `runtimeIdentity` 来自签名 Station identity，不得从 URL 推断。

Relay-specific 规则：

- Relay producer 必须是 Relay deployment/runtime owner。
- Relay runtime identity、commit 和 protocol digest 必须来自 live runtime 与部署事实。

## 5. Actor Manifest

```json
{
  "artifactKind": "acceptance-actor-manifest",
  "fixtureId": "chat-native-actors",
  "environmentId": "home-station",
  "initialState": "ready",
  "actors": [
    {
      "role": "alice",
      "accountRef": "fixture:alice",
      "ptid": "ptid:...",
      "devicePolicy": "fresh"
    },
    {
      "role": "bob",
      "accountRef": "fixture:bob",
      "ptid": "ptid:...",
      "devicePolicy": "fresh"
    }
  ],
  "credentialRefs": ["env:CHAT_NATIVE_DEMO_PASSWORD"],
  "reset": {
    "authorized": true,
    "targetVerified": true
  }
}
```

规则：

- Fixture 负责账号存在性、canonical PTID 发现和初始状态断言。
- `accountRef` 是逻辑引用，不要求暴露邮箱。
- Manifest 禁止包含 password、PIN、token、private key 或 recovery phrase。
- Gate 不允许覆盖 Actor Manifest 中的 PTID。
- destructive Chat Fixture 的 `targetVerified=true` 仅在 deployment env 显式声明
  disposable，且 live Station URL、Compose project、Station/PostgreSQL container
  labels 与独立 PostgreSQL volume 全部精确匹配后成立；服务持久 Desktop 的 Station
  不得作为 reset target。

## 6. Gap Artifact

```json
{
  "artifactKind": "acceptance-gap",
  "status": "BLOCKING",
  "claim": "Direct Chat DELIVERED is proven in native two-client runtime",
  "gapType": "ATTESTATION_PIPELINE_MISSING",
  "proofState": "UNPROVEN",
  "ownerStage": "DESIGN",
  "evidence": [
    {
      "path": "tooling/acceptance/gates/chat/native_visible_runner.py",
      "line": 674
    }
  ],
  "requiredClosure": "Produce Station attestation from deployment runtime"
}
```

Gap Artifact 只能描述缺口，不得包含 workaround 命令或降低后的成功标准。

## 7. Provisioning 状态机

```text
DISCOVERED
  -> PREFLIGHTED
  -> PROVISIONED
  -> FIXTURE_READY
  -> GATE_RUNNING
  -> EVIDENCE_JUDGED
  -> CLEANING
  -> CLEANED

DISCOVERED | PREFLIGHTED | PROVISIONED | FIXTURE_READY
  -> BLOCKED

GATE_RUNNING
  -> GATE_FAILED
  -> CLEANING

CLEANING
  -> CLEANUP_FAILED
```

| 状态 | 含义 | 允许执行产品 Gate |
|---|---|---|
| `DISCOVERED` | 已解析 Gate environment | 否 |
| `PREFLIGHTED` | Profile、依赖和授权检查完成 | 否 |
| `PROVISIONED` | 服务 ready 且 source identity 已记录 | 否 |
| `FIXTURE_READY` | Actor、凭据引用、初始状态已确认 | 是 |
| `GATE_RUNNING` | 产品 Gate 正在执行 | 已执行 |
| `EVIDENCE_JUDGED` | Gate evidence 已验证 | 否 |
| `CLEANED` | 资源释放已验证 | 否 |
| `BLOCKED` | 运行前置缺失 | 否，proof 保持 `UNPROVEN` |
| `GATE_FAILED` | 产品断言失败 | 否，进入 cleanup |
| `CLEANUP_FAILED` | 证据可保留，但 readiness 失败 | 否 |

## 8. 持久化与脱敏

- Contract 存放在仓库内，必须可 review。
- Runtime Manifest、Attestation、Actor Manifest 和 Gap Artifact存放于D-11
  Evidence Store，禁止写入source tree。
- 长期 evidence 只有经过脱敏和人工 review 后才能进入
  `tooling/acceptance/evidence/`。
- URL 可以保留 scheme/host/port；query、token 和 credential 必须脱敏。
- cleanup 后 manifest 保留资源 identity 和释放结果，不保留临时 secret。

## 9. Artifact Root And Identity

Root resolution：

```text
override = trim(PT_ACCEPTANCE_ARTIFACT_ROOT)
if override != "":
  root = canonical_absolute(override)
else if platform == macOS or platform == Linux or platform == other Unix:
  root = ~/.peers-touch/dev/acceptance
else if platform == Windows:
  root = %USERPROFILE%\.peers-touch\dev\acceptance
else:
  EvidenceRootUnsupportedPlatform
```

Resolver验证：

- root必须是absolute directory或可安全创建；
- root canonical path不得等于repository root或位于其下；
- existing symlink component、existing non-directory和NUL均拒绝；
- override设置但无效时fail closed，不改用default；
- CI检测到CI environment但没有override时fail closed。
- root不得位于正式产品Application Support namespace；
- legacy root只参与显式migration，不参与normal resolver fallback。

Identity：

```text
canonical_workspace_path =
  normcase(realpath(abspath(worktree_path)))
workspace_id =
  lower_hex(sha256(utf8(canonical_workspace_path)))[0:16]
gate_id =
  slug matching [A-Za-z0-9][A-Za-z0-9._-]{0,127}
run_id =
  <UTC YYYYMMDDTHHMMSSffffffZ>-<32 lowercase random hex>
```

Layout：

```text
<root>/
└── <workspace-id>/
    └── <gate-id>/
        ├── latest.json
        ├── finalizer-enforcement/
        │   ├── publication-interlock.json
        │   ├── activation-pending.json
        │   ├── activated.json
        │   ├── current.json
        │   ├── durability-capabilities/
        │   │   └── <crash-fixture-id>/
        │   │       ├── MANIFEST
        │   │       └── <artifact-name>-<content-sha256>
        │   ├── controller-trust/
        │   │   ├── controller-store-qualifications/
        │   │   │   └── <qualification-id>/
        │   │   │       └── <case-id>-<artifact-name>-<content-sha256>
        │   │   ├── bootstrap-candidates/
        │   │   │   └── <bootstrap-candidate-digest>/
        │   │   │       ├── candidate.json
        │   │   │       ├── witness-authorizations/
        │   │   │       │   └── <authorization-id>.json
        │   │   │       └── consumed.json
        │   │   ├── promotions/
        │   │   │   └── <authorization-id>/
        │   │   │       └── intent.json
        │   │   ├── transition-reservations/
        │   │   │   └── <absent-or-expected-current-digest>.json
        │   │   ├── generations/
        │   │   │   └── <trust-generation>-<generation-digest>.json
        │   │   ├── revocation-intents/
        │   │   │   └── <authorization-id>/
        │   │   │       └── intent.json
        │   │   ├── revocations/
        │   │   │   └── <trust-generation>-<revocation-digest>.json
        │   │   ├── current.json
        │   │   └── <trust-anchor-digest>.json
        │   ├── latest/
        │   │   └── <generation>.json
        │   ├── runtime/
        │   │   └── <authorization-id>/
        │   │       ├── identity.json
        │   │       └── <content-sha256>.blob
        │   └── generations/
        │       └── <generation>.json
        ├── claim-admission/
        │   ├── current-epoch.json
        │   ├── boot-boundaries/
        │   │   └── <observation-id>.json
        │   ├── epochs/
        │   │   └── <coordinator-epoch-id>.json
        │   ├── pauses/
        │   │   └── <coordinator-epoch-id>.json
        │   ├── jobs/
        │   │   └── <coordinator-epoch-id>/
        │   │       ├── <job-sequence>-<job-id>.json
        │   │       └── <job-sequence>-<job-id>.lock
        │   ├── completions/
        │   │   └── <coordinator-epoch-id>/
        │   │       └── <job-sequence>-<job-id>.json
        │   ├── emissions/
        │   │   └── <coordinator-epoch-id>/
        │   │       └── <job-sequence>-<job-id>/
        │   │           ├── intent.json
        │   │           └── acknowledged.json
        │   └── quiescence/
        │       └── <coordinator-epoch-id>.json
        ├── .claim-admission.lock
        ├── .claim-sequence.lock
        ├── .publish.lock
        ├── .cleanup.lock
        ├── .abort.lock
        ├── .durability-sync-anchor
        ├── aborts/
        │   └── <run-id>/
        │       ├── authorized.json
        │       ├── deletion-plan.json
        │       ├── tombstoned.json
        │       ├── delete-started-<attempt-id>.json
        │       ├── deleted.json
        │       └── failed-<attempt-id>.json
        ├── aborted-runs/
        │   └── <run-id>/
        └── <run-id>/
            ├── .active.lock
            ├── .finalization.lock
            ├── finalization-requirement.json
            ├── sealed.json
            ├── manifest.json
            ├── reports/
            ├── evidence/
            │   └── finalization/
            │       └── executable.bundle
            ├── logs/
            └── runtime/
```

## 10. Artifact Reference

```json
{
  "artifactKind": "acceptance-artifact-ref",
  "workspaceId": "0123456789abcdef",
  "gateId": "chat-native-two-client-e2e",
  "runId": "20260817T120102123456Z-0123456789abcdef0123456789abcdef",
  "path": "reports/run.json",
  "sha256": "<64-lowercase-hex>",
  "mediaType": "application/json"
}
```

Rules：

- `path`必须是normalized POSIX-style run-relative path；
- empty segment、`.`、`..`、absolute prefix、drive prefix和backslash traversal拒绝；
- reader canonicalize后再次验证目标位于exact run directory；
- symlink leaf/component拒绝；
- `sha256`在read和latest resolution时复验；
- contracts、profiles、plans和run manifests只保存`ArtifactRef`或logical
  artifact role，不保存artifact root absolute path。

## 11. Run Manifest

```json
{
  "artifactKind": "acceptance-run-manifest",
  "schemaVersion": 1,
  "workspaceId": "0123456789abcdef",
  "gateId": "chat-native-two-client-e2e",
  "runId": "20260817T120102123456Z-...",
  "state": "DURABLE",
  "createdAt": "<UTC timestamp>",
  "completedAt": "<UTC timestamp>",
  "source": {
    "commit": "<git-commit>",
    "workspaceDigest": "<existing D-07 digest>",
    "canonicalWorktreeHash": "0123456789abcdef"
  },
  "runtime": {
    "environmentId": "home-station",
    "profile": "three",
    "stationCommit": "<commit>"
  },
  "result": {
    "status": "failed",
    "completionStatus": "DONE",
    "proofStatus": "UNPROVEN"
  },
  "artifacts": {
    "report": {"artifactKind": "acceptance-artifact-ref"}
  },
  "redaction": {
    "status": "passed"
  }
}
```

Manifest写入前所有referenced artifacts必须durable。Manifest写入成功后内容immutable；
补充数据必须创建新run，不得原地修改。

## 12. Latest Pointer

```json
{
  "artifactKind": "acceptance-latest-pointer",
  "schemaVersion": 1,
  "workspaceId": "0123456789abcdef",
  "gateId": "chat-native-two-client-e2e",
  "runId": "20260817T120102123456Z-...",
  "completedAt": "<UTC timestamp>",
  "manifest": {"artifactKind": "acceptance-artifact-ref"},
  "manifestSha256": "<64-lowercase-hex>"
}
```

Publish algorithm：

1. acquire gate `.publish.lock`；
2. load and validate existing pointer when present；
3. compare `(completedAt, runId)`，older candidate returns without overwrite；
4. write same-directory temporary pointer；
5. flush + fsync file；
6. atomic replace `latest.json`；
7. fsync gate directory；
8. release lock。

Missing/corrupt latest不得使reader扫描并猜测primary evidence；reader返回typed error，
operator可运行显式repair命令从valid manifests重建pointer。

D-19对所有file或directory namespace durable transition采用同一lost-ACK规则：
retry发现final path存在且bytes相等时，必须以no-follow方式重新open并fsync该file，
再fsync其containing directory；两步成功前不得把该artifact视为durable predecessor、
删除pending、发布pointer或执行delete。该规则适用于interlock、pending、generation、
activation sentinel、current、manifest、abort event、deletion plan，以及
claim-admission epoch/current/job/completion/pause/quiescence records。任一re-fsync
失败保持上一个已证明durable boundary并fail closed。Directory create/rename/unlink
还必须fsync全部受影响parent directories；retry观察到目标directory已出现或消失时，
必须重新验证identity并重新fsync这些parents，不能从可见namespace推断durability。
上述“fsync”是对`ProofAuthorityDurabilityProfile`所选platform backend的简称，不是
跨平台把plain `fsync(2)`等同于power-loss durability。Linux profile执行file
`fsync`及每个受影响directory `fsync`；Linux man page明确说明file fsync不保证
directory entry已落盘：<https://man7.org/linux/man-pages/man2/fsync.2.html>。
Darwin profile只允许local APFS，并按每个transition执行file `F_FULLFSYNC`、directory
`fsync`，再对同一volume内预创建且identity-bound的regular sync-anchor执行
`F_FULLFSYNC`；Apple明确指出plain `fsync`不能保证power-failure durability并要求
`F_FULLFSYNC`完成更强flush：
<https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html>。
Profile在任何authority/run allocation mutation前绑定OS、filesystem、mount/device、
sync-anchor identity和backend version。Darwin anchor以create-exclusive建立、
完成自身file/directory/full-sync后才可进入profile，并永久保留；missing、replaced
或cross-device anchor属于storage corruption。Unsupported filesystem、primitive failure、
cross-device transition或profile drift均返回`FINALIZER_DURABILITY_PROFILE_UNSUPPORTED`
（run/preflight）或`MAINTENANCE_DURABILITY_PROFILE_UNSUPPORTED`
（authority/abort maintenance）及`NO_MUTATION`。所有requirement、authority/abort authorization和maintenance request
必须携带同一profile digest。Crash/power-cut fixtures是该profile进入allowlist的
必要证据；可见equal bytes仍须重放完整platform backend，不能只重放plain fsync。

D-19 landing通过Evidence Store-owned target-state command/API
`activate_finalizer_enforcement()`安装immutable generation。Mobile source cutover前，
Evidence Store先atomic no-replace安装永久
`finalizer-enforcement/publication-interlock.json`；该marker绑定workspace/Gate/
required finalizer ID且永不删除。Writer/reader只从durable Evidence Store state判断
authority，不读取Capability Graph或current worktree。Interlock存在而activation尚未
完成时，任何`PROVEN` publication和authoritative latest resolution都fail closed。
All project-owned readiness/report/aggregate consumers accept only a closed
`AuthoritativeLatestResolution`; a raw manifest, legacy `latest.json` result or
free-form verifier output is diagnostic. Before interlock installation, the D-19
Infra landing must atomically cut every such consumer to this envelope and pass a
tree-wide forbidden-call scan. Every final claim sink holds a shared gate-scoped
`.claim-admission.lock` from its authoritative read through its final exit/status/
report emission and revalidates interlock/current generation immediately before
emission. Interlock installation and generation activation take the exclusive
lock. Before first installation, the D-19 Infra migration restarts the sole
project-owned claim execution environment under `ProofAdmissionCoordinator`.
Every job is registered by PID plus process-start identity, executable hash and
source commit before execution; direct/unregistered output is diagnostic.
Coordinator enters `PAUSED`, blocks new jobs, kills/reaps or waits for every
registered pre-cutover job, and emits `ProofAdmissionQuiescence` only when the
new execution-environment epoch started after source cutover and `activeJobs=()`.
Epoch, job registrations and quiescence are durable under gate-scoped
`claim-admission/`; each job holds a live advisory lease on its immutable
registration from before source execution through internal output capture and
the consuming claim wait. Stale registry entries are never cleared; they close
only through one immutable completion. An unreadable or ambiguous lease blocks
quiescence.
Coordinator restart atomically no-replace publishes an immutable epoch record,
fsyncs `epochs/`, then atomically replaces and fsyncs `current-epoch.json` plus
`claim-admission/`; all visible-equal retries obey the global re-fsync rule.
Every new epoch embeds termination evidence for its predecessor execution
environment. For the first D-19 epoch, that predecessor is the explicitly
identified pre-cutover claim environment; later epochs require identity equality
with the previous immutable epoch. Later epoch construction and decoding resolve
the exact typed previous epoch and require its workspace, Gate, coordinator epoch
ID, epoch digest and execution-environment identity to match the predecessor ref
and termination evidence. Termination must occur after the predecessor epoch
started and before the successor epoch starts. The current pointer cannot advance
until the predecessor termination proves zero survivors.
While holding shared claim lock, registration takes the permanent
`.claim-sequence.lock` exclusively to allocate one epoch-local monotonic sequence,
starting at 1 for each `coordinatorEpochId` and choosing
`max(existing sequence in that epoch)+1`. The
coordinator starts a fixed blocked lease-wrapper, captures its PID/start identity,
and makes that wrapper create-exclusive open the sibling job lock and acquire
`flock(LOCK_EX|LOCK_NB)`. The wrapper then starts the claim child in a separate
blocked process group without passing the lease FD or any descriptor-control FD.
After capturing exact child PID/PGID/start identity, Core publishes/fsyncs the
immutable job record and `jobs/<epoch>/` directory. The wrapper ACK proves it
still owns the same open-file-description lock and that the claim child cannot
access it; only then is claim source loaded. The wrapper passes the exact typed
`ClaimEmitterInput`, captures the sole output internally, consumes the child
wait, releases the lease and exits without external emission. The coordinator
then consumes the wrapper wait and durability-profile syncs one immutable
completion. Claim code cannot call `close`, `closerange` or `flock` on a
capability it never receives. A claim job is a trusted leaf
emitter under `NO_CHILD_NO_SESSION_CHANGE_V1`: its complete source closure may not
call or dynamically resolve process creation, `fork`/`vfork`/`posix_spawn`,
`subprocess`, shell execution, `system`, `setsid` or `setpgid`; native jobs and
native extensions are rejected. The blocked child installs the
platform policy before source load and reports its digest in the handshake.
Linux additionally runs each job in the epoch PID namespace. Darwin admits only
source-only interpreted jobs that pass the closed forbidden-call scan. This is a
trusted project policy, not process-group containment: POSIX permits descendants
to leave a group with `setsid`, so a process-group reap without this policy is
never termination proof. The sequence lock is released only
after this handoff or a durable terminal completion; concurrent registrations
cannot choose the same sequence.
Completion is immutable and published with the bound durability profile only
after internal output capture, both consuming waits, and an empty exact group
enumeration. Job registration precedes completion; group enumeration precedes
leaf completion; environment termination precedes `REAPED` completion. Only
after that completion is durable may the coordinator acquire
the gate `.publish.lock`, re-resolve `AuthoritativeLatestResolution` from the
Evidence Store, require byte-for-byte equality with the job's expected
resolution and emitter input/output, and durability-profile sync one immutable
`ProofAdmissionEmissionIntent`. The sink contract atomically claims the
intent's deterministic idempotency key before applying its side effect and
returns the same receipt for an equal retry; a conflicting payload is rejected.
The coordinator uses the intent's bounded deadline, persists one matching
`ProofAdmissionEmissionAcknowledgement`, and only that acknowledged state counts
as external emission. Timeout, lost ACK or coordinator crash leaves the intent
retryable with the same key and bytes, never with a new side effect identity.
Completion precedes intent creation, sink acceptance precedes acknowledgement,
and every referenced record precedes quiescence capture.
The shared claim-admission and publish locks remain held for at most the bounded
sink attempt; retry reacquires both and revalidates authority. A mismatch or
resolution failure emits nothing. Raw stdout/file sinks without
`IDEMPOTENT_CLAIM_SINK_V1` acknowledgement are diagnostic only; neither wrapper
nor claim code can emit directly. If coordinator crashes after job
registration, orphan recovery runs only after the replacement execution
environment has terminated the prior environment, while holding exclusive claim
lock, and after proving the job-record lease absent plus the exact PID/PGID/start
identity group dead. It then publishes exactly one `REAPED` completion with
`EXECUTION_ENVIRONMENT_TERMINATED` proof and never deletes the job record.
If a durable `COMPLETED` record exists, replacement never rewrites completion or
reruns claim code. After proving predecessor environment termination, it
reconstructs the one canonical intent from job/completion/output and the
immutable job's `ProofAdmissionSinkIdentity`. Runtime configuration is not
consulted. If intent is missing it publishes that exact intent atomic
no-replace; if present it requires equal bytes and re-syncs. It may then
reacquire the two locks, re-resolve the same authority and retry the same
idempotency key/payload until the bounded sink returns the matching receipt or
the epoch remains non-quiescent.
Pause takes exclusive claim lock, publishes and fsyncs a pause record freezing
`lastAcceptedJobSequence`, validates every sequence `1..N` has exactly one matching
registration and terminal completion plus no live lease, then publishes
and fsyncs quiescence with the complete sequence-ordered registration/completion/
acknowledgement digest sets. Every `COMPLETED` job must have exactly one
acknowledgement and no pending intent; `CANCELLED/REAPED` jobs must have neither.
Epoch/current/job/completion/emission/pause/quiescence lost-ACK retry re-fsyncs
the existing equal file and containing directory. Missing/duplicate sequence, stale current-epoch pointer, lock identity
mismatch, live/ambiguous lease or any crash-uncertain predecessor blocks
quiescence. Interlock installation keeps the exclusive lock and accepts only this
same workspace/Gate/epoch/source/lock-bound quiescence.
The installer verifies and binds that record while holding the exclusive lock.
Missing/stale epoch, any live job or failed restart returns `NO_MUTATION`; process
table inference is not accepted as quiescence proof. The interlock authorization binds the reviewed
proof-admission source digest. Once an interlock exists, the envelope requires its
digest plus the active generation/enforcement identity; a legacy reader cannot
produce a structurally valid claim even if it was already loaded and later reads
or rewrites legacy latest.
安装interlock与激活generation都会不可逆地改变proof authority，因此两者都必须先由
Evidence Store local interactive CLI构造并验证closed
`FinalizerAuthorityAuthorization`。Authorization绑定kernel-derived operator、
accepted D-19 approval document exact bytes、source commit、目标Gate/finalizer、
expected authority state与action-specific digests；任何durable write前必须完成TTY
challenge、approval/source验证和closed-schema/digest验证。
Activation先获取exclusive claim-admission lock并验证matching interlock，再以bounded方式获取
gate cleanup lock，阻止所有D-19-aware `begin_run`，在60秒/4096-entry上限内扫描并
non-blocking probe现有D-19-aware run active locks；任一active D-19-aware run、limit或
I/O failure都无副作用失败。首个generation不能阻止已经加载且不认识cleanup lock的
legacy runner继续分配或写legacy run；该事实不属于activation的隔离承诺。安全边界是
authority cutover：pending/current一旦存在，legacy run、legacy latest及其后续写入均
只能作为diagnostic，永不进入D-19 authoritative reader。确认无active D-19-aware run后
获取gate publish lock，验证operator给出的expected current generation/latest，并捕获
此刻的current authoritative pointer。随后在仍持有cleanup+publish locks时原子发布不
超过16 KiB的`activation-pending.json`，绑定target generation、digests、expected
current generation及captured prior pointer/digest。Pending durable时即成为不可逆的
authority cutoff：Reader与D-19-aware `begin_run`必须fail closed，任何之后写入prior
namespace的legacy/old-generation latest都只属diagnostic。随后把pending中已经冻结的
最多一个exact `priorLatestPointer`及其digest写入不超过16 KiB的
`finalizer-enforcement/generations/<generation>.json` temporary file并fsync，但暂不
publish。Activation atomic no-replace publishes generation record、fsyncs directory,
first activation还以atomic no-replace发布pending中冻结的
`finalizer-enforcement/activated.json`永久sentinel并fsync directory；后续generation
必须验证sentinel逐字节不变。Generation 1要求`candidateActivated`非null；后续
generation要求其为null并要求既有sentinel valid，
then publishes pending中冻结的canonical `FinalizerEnforcementCurrent` through
same-directory temp + file fsync + atomic replace + directory fsync。`current.json`
不得超过16 KiB；`currentDigest`按§20.3覆盖除自身外的完整current object。Reader先
验证artifact kind/schema/workspace/Gate/current digest，再resolve exact
`generations/<generation>.json`并要求其`enforcementDigest`逐项相等。Current pointer
或generation record任一missing/corrupt/mismatch都fail closed，不扫描猜测。Activation
最后移除pending并fsync。D-19-aware publish
never writes legacy `<gate-id>/latest.json`; it writes
`finalizer-enforcement/latest/<generation>.json`. Once pending or current exists,
D-19-aware readers ignore the legacy top-level latest even if an already-loaded old
runner later rewrites it. Crash after pending publication therefore remains fail closed.
Generation 1的prior pointer是pending前捕获的legacy latest或null；后续generation的prior
pointer是切换前current generation-scoped latest或null。所有prior pointer在新generation
生效后都仅供diagnostic。全流程顺序是`cleanup -> D-19-aware active probes -> publish`，
不在持有publish时等待active。
Directory scan、generation/current publication及其fsync
均由已READY supervisor下的Evidence Store-owned `MAINTENANCE` worker执行；Runner只
持有locks并验证request-bound result。Blocking filesystem call由worker 60秒deadline
中断，timeout释放locks并按上述durable边界重试。

Generation从1开始严格递增。相同generation与完整digest重试幂等；任何字段冲突拒绝。
未来accepted baseline/registration-catalog变化必须在无active D-19-aware run时创建下一immutable generation，
旧generation永不改写。`begin_run`短暂持有cleanup lock，读取并验证current generation，
并拒绝pending，再把current generation/digest及live supervisor session identity与
`FinalizerPreflightToken`精确比较。Store还必须通过Runner持有的process handle、
session-bound control channel与non-blocking liveness probe证明同一supervisor仍处于
`READY`；token本身不构成liveness证据。不匹配或session已死亡分别返回typed
`FINALIZER_ENFORCEMENT_CHANGED`或`FINALIZER_SUPERVISOR_FAILED`且不分配run，调用方
必须重跑完整preflight。匹配时才创建run/active lock/requirement record；每个run持久化
generation与enforcement digest。
Marker temporary file按D-11规则忽略/清理，不能被reader当作active generation。

Target-state interlock/activation commands（D-19 landing前不可用）：

```bash
python3 -I -S -E -B tooling/acceptance/core/authority_cli_bootstrap.py \
  create-power-controller-bootstrap-candidate \
  --gate <gate-id> \
  --controller-identity-file <tty-reviewed-canonical-input> \
  --controller-public-key-file <tty-reviewed-ed25519-public-key> \
  --approval-document-sha256 <sha256>

python3 -I -S -E -B tooling/acceptance/core/authority_cli_bootstrap.py \
  authorize-controller-store-witness \
  --gate <gate-id> \
  --bootstrap-candidate-digest <sha256> \
  --qualification-id <qualification-id> \
  --witness-public-key-file <tty-reviewed-canonical-p256-sec1-public-key> \
  --approval-document-sha256 <sha256>

python3 -I -S -E -B tooling/acceptance/core/authority_cli_bootstrap.py \
  promote-power-controller-trust-anchor \
  --gate <gate-id> \
  --bootstrap-candidate-digest <sha256> \
  --qualification-manifest-digest <sha256> \
  --qualified-backend-identity-digest <sha256> \
  --approval-document-sha256 <sha256>

python3 -I -S -E -B tooling/acceptance/core/authority_cli_bootstrap.py \
  rotate-power-controller-trust-anchor \
  --gate <gate-id> \
  --bootstrap-candidate-digest <sha256> \
  --qualification-manifest-digest <sha256> \
  --qualified-backend-identity-digest <sha256> \
  --expected-current-trust-digest <sha256> \
  --target-trust-generation <positive-integer> \
  --approval-document-sha256 <sha256>

python3 -I -S -E -B tooling/acceptance/core/authority_cli_bootstrap.py \
  revoke-power-controller-trust-anchor \
  --gate <gate-id> \
  --expected-current-trust-digest <sha256> \
  --target-trust-generation <positive-integer> \
  --reason <key-compromise|controller-retired|environment-drift> \
  --approval-document-sha256 <sha256>

python3 -I -S -E -B tooling/acceptance/core/authority_cli_bootstrap.py \
  install-finalizer-interlock \
  --gate <gate-id> \
  --required-finalizer-id <finalizer-id> \
  --expected-prior-latest <latest-pointer-or-none> \
  --expected-proof-admission-source-digest <sha256> \
  --installation-source-commit <full-git-commit> \
  --approval-document-sha256 <sha256>

python3 -I -S -E -B tooling/acceptance/core/authority_cli_bootstrap.py \
  activate-finalizer \
  --gate <gate-id> \
  --target-generation <positive-integer> \
  --expected-current-generation <generation-or-none> \
  --expected-prior-latest <latest-pointer-or-none> \
  --activation-source-commit <full-git-commit> \
  --prior-disposition diagnostic-only \
  --expected-requirement-digest <sha256> \
  --expected-config-digest <sha256> \
  --expected-source-digest <sha256> \
  --expected-protected-baseline-digest <sha256> \
  --expected-interlock-digest <sha256> \
  --expected-proof-admission-source-digest <sha256> \
  --approval-document-sha256 <sha256>
```

Power-controller enrollment is an independent two-phase authority protocol with
a qualification-only witness-authorization substep.
The first command creates an owner-approved bootstrap candidate using
`OS_STRONGEST_AVAILABLE_SYNC_V1`; that record is not an active proof authority
and may authorize only its named durability-qualification fixture. If it is lost
or corrupt after a crash, qualification fails closed and the owner starts a new
candidate. Before qualification, the witness command binds an owner-approved
P-256 key to that candidate/run and immutable qualification-only scope.
Production controller authority is exclusively Ed25519. The witness key is a
canonical SEC1 uncompressed P-256 point and its signatures are canonical
fixed-width low-S P1363 values; neither can parse as the exact 32-byte Ed25519
public key or 64-byte Ed25519 signature required by production controller
schemas. This type-level disjointness is the authority boundary; no mutable
deny registry or global exclusion lock may substitute for it.
The witness command acquires the Gate publish lock and atomic no-replace
publishes
`bootstrap-candidates/<bootstrap-candidate-digest>/witness-authorizations/<authorization-id>.json`
using the candidate's bootstrap sync contract. If absent, it freezes
`authorizedAt` and both digests once. Retry derives the same authorization ID
and path, loads those frozen bytes, requires every non-time input equal and the
same principal to reconfirm the stored challenge, then reapplies file/directory
sync. Conflicting bytes or any non-canonical P-256 credential fails closed.
After every crash case passes, the promotion command binds the exact
candidate, qualification manifest and resulting durability profile, then uses
that newly qualified backend to atomic no-replace publish the active trust
anchor. Normal expectations accept only an active anchor. Controller and
witness public-key input files
are read-only CLI inputs, are never copied into the repository or Evidence Store
as paths, and their canonical typed bytes and hashes are embedded in the
authorization/candidate. The five enrollment commands publish only public keys
and hashed non-secret identities; private key material is never accepted.
Interlock command先于Mobile required mapping/Catalog source cutover执行，并使用
temporary write + file fsync + atomic no-replace + directory fsync；existing bytes只有
逐字节相等才幂等成功。Activation command是
`activate_finalizer_enforcement()`的唯一CLI入口，Evidence Store是mutation
owner。七条命令都先执行read-only impact inventory，再要求stdin/stdout属于同一
controlling TTY、real/effective UID相等，并从`geteuid()`构造operator principal；
operator identity不能由参数提供。`approvalDocumentPath`固定为
`docs/architecture/acceptance-framework/decisions.md`，不得由caller选择其它path。
Python官方分别定义了Unix effective UID与TTY descriptor检查：
<https://docs.python.org/3/library/os.html#os.geteuid>、
<https://docs.python.org/3/library/os.html#os.isatty>。
`authoritySourceCommit`必须等于canonical repository当前checked-out HEAD，且
`git status --porcelain=v1 --untracked-files=all`必须为空；不是只检查选定input。
CLI以isolated reviewed entrypoint启动，禁止从ignored/untracked path或dynamic import
加载authority code。`authority_cli_bootstrap.py`在把repository root加入`sys.path`
前只使用stdlib，先验证自身raw hash、HEAD和full-worktree cleanliness；随后对fixed
authority entrypoint执行AST import-closure解析。所有project import必须静态解析为
`ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES` inventory中的exact tracked file；dynamic import、
`.pth`、native extension和inventory外project source全部拒绝。唯一namespace-package
例外是现有`tooling`与`tooling.acceptance`：两者的`__path__`必须分别恰好只有
canonical `<repo>/tooling`与`<repo>/tooling/acceptance`一个directory，目录identity
必须来自verified repository root，且不得合并其它search location；其它namespace
package全部拒绝。
非project import只允许Python `-I -S -E -B` runtime identity中验证的
BUILTIN/FROZEN/stdlib FILE allowlist，禁止site package。Import完成后runtime probe枚举
loaded modules并逐项复验origin/hash与该closed closure；不一致时不得获取mutation lock。
Bootstrap installs a source-only project finder/loader that opens only the exact
tracked `.py` bytes in the verified closure and never delegates project modules to
the default bytecode loader. Repository `__pycache__`, `.pyc` and `.pyo` entries are
rejected before project import, including ignored files; `-B` is only the
no-write guard and is not treated as a no-read guarantee. Python documents `-B`
as disabling bytecode writes and separately defines unchecked-hash bytecode:
<https://docs.python.org/3/using/cmdline.html#cmdoption-B>,
<https://docs.python.org/3/library/py_compile.html#py_compile.PycInvalidationMode.UNCHECKED_HASH>.
CLI从该exact commit读取approval document，验证raw SHA-256与参数一致、D-19 status为
`accepted`且存在明确Accepted日期，并从同一commit重新生成
proof-admission及activation content digests；caller只提供expected values，不能成为
digest source。随后CLI显示完整action/identity/expected-state和
`confirmationChallengeDigest`，要求operator从TTY回输完整lowercase hex。Approval
document missing、非canonical path、hash/status不匹配、HEAD/source不一致、dirty
authority input、detached/unresolvable source commit、
non-interactive invocation、UID mismatch或challenge mismatch均在lock acquisition和
durable mutation前fail closed。

首次authorization先生成32-byte cryptographic random lowercase hex
`authorizationId`与单一`authorizedAt`。Interlock branch要求全部generation/content/
activation字段为null，但必须绑定install前expected legacy latest pointer/digest和
proof-admission source digest，并投影
`installedAt=authorization.authorizedAt`、
`installationSourceCommit=authorization.authoritySourceCommit`。Activation branch
要求target generation、requirement/config/source/protected-baseline digests非null，
expected current generation与expected prior pointer digest按首个/后续generation规则
允许null，并投影`activatedAt=authorization.authorizedAt`、
`activationSourceCommit=authorization.authoritySourceCommit`。Activation在获取
publish lock并验证authorization中expected state后写入intent；candidate enforcement
record除prior pointer
外完全由该intent投影，prior pointer则来自同一lock内的capture。完整candidate record
及其`enforcementDigest`、由它确定性派生的candidate current pointer进入pending，
retry只能逐字节重放。Fresh workspace创建
generation 1且`priorLatestPointer=null`。Pending publish前
crash无状态变化；pending后crash保持全Gate fail closed。Retry验证pending、recorded
captured prior pointer、generation record和current pointer，且不得重新读取或rebase到
pending之后写入的prior-namespace latest；每个已存在且equal的pending/generation/
sentinel/current都必须先按上述lost-ACK规则重新fsync，全部predecessor durability
确认后才移除pending。Pending没有
abort/supersede路径，只有相同intent的completion retry，因其已经定义authority cutoff。
Future accepted baseline创建下一generation；旧generation latest保留为diagnostic但
不再由current-generation reader选择，既有record不可修改。

Operator确认challenge后、任何proof-authority mutation前，Runner先发送
`AUTHORITY_RUNTIME_PERSISTER` request，传verified gate-directory和runtime-capture
temporary-directory FDs。Worker只按authorization ID与content hashes写
`finalizer-enforcement/runtime/<authorization-id>/` blobs和canonical runtime identity，
逐file/directory fsync后返回`AUTHORITY_RUNTIME_DURABLE`。Pre-write validation返回
`NO_MUTATION`；post-write uncertainty返回`AUTHORITY_RUNTIME_MAY_BE_DURABLE`，retry只
接受exact bytes并按global rule re-fsync。只有完整runtime identity可由这些refs重建、
其digest匹配authorization且live worker仍匹配时，才允许后续interlock/activation/
abort mutation。Orphan runtime blobs没有proof authority，可由独立content-addressed
retention清理，但不能被另一个authorization引用。

若generation/sentinel/current均已durable，而pending unlink已可见但其directory fsync
失败或ACK丢失，retry进入terminal recovery branch。它按requested target generation
直接resolve immutable generation record并恢复embedded authorization/intent，不从
mutable current反推原authorization；随后要求current generation大于或等于target，
验证从target到current的完整strictly-incrementing generation chain和最终current
binding，并要求同一kernel principal重新确认原challenge。Retry重新fsync target及
后续chain generation、sentinel、current files和各自containing directory，再fsync
`finalizer-enforcement/` directory。若target pending重新出现则回到pending recovery；
若仍缺失才对该target返回`ACTIVATED`，即使它已被later generation supersede。该branch
不得生成新authorization、重建candidate或改变current。

Interlock install在authorization及legacy-job quiescence后获取exclusive
claim-admission lock，再获取publish lock，捕获exact legacy latest或null并
与authorization中的expected pointer/digest逐项比较，再通过
`INSTALL_PUBLICATION_INTERLOCK` maintenance request执行atomic no-replace publication。
State mismatch/conflicting marker为`NO_MUTATION`；write已发生但ACK/fsync outcome不确定
时返回`INTERLOCK_MAY_BE_DURABLE`，显式retry只检查fixed path，不猜测或重写。
Interlock retry先读取existing marker并验证完整authorization bytes/digest、当前kernel
principal和operator重新回输的同一challenge；只有marker逐字节等于由该authorization
投影的candidate bytes，且retry重新open/fsync marker file并fsync
`finalizer-enforcement/` directory成功后，才返回
`INTERLOCK_DURABLE`；仅可见或byte-equal不等于durable，不创建新authorization。
任一re-fsync failure保持`INTERLOCK_MAY_BE_DURABLE`并禁止source cutover。
Activation在pending前失败
没有durable authority mutation，后续显式调用必须重新盘点并重新授权；pending durable
后，retry必须从pending恢复原authorization ID/timestamp/principal/approval hash/
challenge及intent，要求当前kernel principal相同并重新确认原challenge，禁止创建新
authorization或改变任一expected field。Authorization validation、current-state
comparison或challenge确认失败只返回typed `NO_MUTATION` rejection；不得安装marker、
写pending、generation、sentinel/current或改写latest。

Reader只按durable Evidence Store state处理cutover：

1. `publication-interlock.json` missing，且pending/sentinel/current全不存在：按legacy
   D-11 schema-v1读取；它不查询Capability Graph；
2. interlock missing但pending/sentinel/current任一存在：storage corruption，fail closed；
3. interlock存在但invalid：fail closed；valid interlock存在且
   `activation-pending.json`存在：拒绝任何authoritative latest；
4. valid interlock存在但immutable `activated.json`缺失：activation required，fail closed；
5. immutable `activated.json`存在：验证其schema/digest/workspace/Gate/finalizer ID和
   first-generation
   binding；`current.json`缺失、损坏或不匹配一律fail closed，禁止回退legacy；
6. current generation存在时，`priorLatestPointer`和top-level legacy latest只可用于
   diagnostic trace，不能作为authoritative proof；reader只解析
   `finalizer-enforcement/latest/<generation>.json`；
7. current generation latest指向的manifest缺少
   `EvidenceFinalizationRecord`、generation或enforcement digest均拒绝；
8. enforced record只能是`NOT_INVOKED_PRE_SEAL`或`COMPLETED`，并进入下述D-19
   state validation；`NOT_REQUIRED`拒绝。

Reader返回closed `AuthoritativeLatestResolution`，而不是bare manifest。Legacy mode只
允许interlock/pending/sentinel/current全不存在；enforced mode必须携带并复验
interlock/current/generation/manifest identity。Acceptance planner、runner aggregate、
readiness reporter和`verify-latest --require-authoritative`只接受该envelope及其digest；
interlock存在后，缺少envelope、`authorityMode=LEGACY`或缺少generation identity均
返回typed non-authoritative error。Infra landing的protected source check必须证明所有
project-owned proof admission points只消费该API；兼容reader或raw latest consumer禁止
保留。

D-19-aware `begin_run`必须短暂获取gate-scoped cleanup lock，并在该lock内读取
enforcement marker、确定required语义、复验live supervisor session、创建run目录、
获取active lock并写requirement record，然后释放cleanup lock。Activation持有同一
cleanup lock完成D-19-aware active-run scan和marker publication，因此不存在scan与新
D-19-aware allocation并发的窗口。Legacy runner不受该锁约束；它只能写已被current
generation reader永久忽略的legacy namespace。

D-19-aware validation按`EvidenceFinalizationRecord.state`分支：

1. `NOT_REQUIRED`：只允许enforcement current pointer不存在时按legacy D-11处理；
2. `NOT_INVOKED_PRE_SEAL`：要求durable requirement record存在、三个digest可由其中
   保存的canonical preimage重算并与record相等，且必须不存在sealed marker、invocation
   和outcome。Reader按§20.4的missing-finalizer分支重算published tuple：primary success
   降级为`failed/PARTIAL/UNPROVEN`；已有failed或blocked primary tuple、reason和source
   trace保持不变；
3. `COMPLETED`：resolve and validate enforcement generation、requirement record、`sealed.json`、
   `manifest.json` and latest pointer identity/hash；重算requirement/config、snapshot、
   sealed marker中完整canonical primary result、invocation、runtime/source与outcome
   digests；要求manifest record
   digests等于requirement record和sealed context，且source digest等于bundle/registry；
   验证strict outcome并重算§20.4
   monotonic merge，要求与published canonical tuple精确相等；
4. 所有分支都拒绝任何带abort authorization/tombstone的run ID。

Direct manifest/ArtifactRef inspection may expose a validated non-authoritative
record for diagnostics, but only a valid latest pointer makes it proof.
`repair` never selects a run with a required-finalizer record because a
pre-publish crash and a lost historical pointer are intentionally
indistinguishable in v1. Non-D-19 repair behavior remains unchanged.

## 13. Lifecycle And Locks

```text
ALLOCATED
  -> ACTIVE
       ├──> FINALIZING -> DURABLE -> PUBLISHED -> CLOSED
       │     # no required finalizer or pre-seal blocked run
       └──> ARTIFACTS_SEALED
               -> FINALIZER_RUNNING
               -> FINALIZING -> DURABLE -> PUBLISHED -> CLOSED
                  # validated or downgraded typed finalizer outcome

ALLOCATED | ACTIVE | FINALIZING
  -> EVIDENCE_FAILED
  -> CLOSED
```

`RunHandle`创建run directory后立即持有`.active.lock`的OS advisory exclusive lock。
Cleanup尝试non-blocking lock：

- lock失败：run active，必须跳过；
- lock成功且无durable manifest：eligible incomplete run；存在sealed marker时只能由
  显式operator abort流程删除，不能自动恢复、finalize或publish；
- lock成功且manifest durable：按explicit retention policy判断；
- latest pointer target：始终保护。

默认retention是retain-all。Cleanup只有在显式提供workspace/gate和age/count policy时
执行；它不得跨workspace扫描后批量删除。

完整lock协议使用一个全局顺序：

```text
claim-admission(gate) -> cleanup(gate) -> active(run) -> finalization(run) -> publish(gate) -> abort(gate)
```

- authoritative claim sinks hold only shared claim-admission lock through final
  emission; interlock/activation hold it exclusive before any later lock；
- `.claim-admission.lock`在claim-consumer source cutover时通过verified gate-directory
  FD、same-directory create-exclusive和directory fsync创建，记录的device/inode/type
  成为永久lock identity且never delete。所有owner通过anchored no-follow open复验同一
  regular-file identity；missing/replaced/symlink lock返回storage corruption，禁止
  创建第二lock domain；
- `.claim-sequence.lock`按同一协议创建并never delete；registration只能在持有shared
  claim-admission lock时短暂exclusive获取它，pause/install持有exclusive
  claim-admission lock时不得再等待sequence lock；
- lifecycle owner从`ALLOCATED`到`CLOSED`持续持有`.active.lock`；
- artifact write、role registration、seal和manifest finalize按
  `active lease -> finalization lock -> run mutex`执行；
- publish在释放finalization lock后按`active lease -> publish lock`执行；
- retention/delete按`cleanup lock -> active lock (non-blocking) -> finalization lock ->
  publish lock`执行，失败时立即逆序释放；
- `abort-sealed`在live run path存在时按
  `cleanup -> active -> finalization -> publish -> abort`执行；tombstone retry没有
  run-local lock，只取`cleanup -> publish -> abort`；
- 所有cross-process lock acquisition使用non-blocking try/retry并共享调用方声明的
  monotonic ceiling；超时逆序释放且无副作用；
- 任何路径不得在持有后序lock时等待前序lock。

## 14. Typed Evidence Errors

| Error | Trigger | Gate result |
|---|---|---|
| `EvidenceRootInvalid` | malformed/relative/file root | failed / unproven |
| `EvidenceRootForbidden` | root在repository内 | failed / unproven |
| `EvidencePermissionDenied` | mkdir/open/chmod/replace denied | failed / unproven |
| `EvidenceNoSpace` | ENOSPC/quota exceeded | failed / unproven |
| `EvidenceQuotaExceeded` | artifact/run byte budget exceeded | failed / unproven |
| `EvidencePathTraversal` | child escapes run/root | failed / unproven |
| `EvidenceSymlinkRejected` | path component/leaf is symlink | failed / unproven |
| `EvidenceConflict` | identity/hash conflict | failed / unproven |
| `EvidenceWriteInterrupted` | partial/failed durable write | failed / unproven |
| `EvidenceManifestInvalid` | malformed identity/schema/hash | failed / unproven |
| `EvidenceRunActive` | cleanup targets locked run | cleanup skip, not delete |

Typed errors保留safe path role、errno class和remediation，不包含secret value。任何error
都不得触发source-tree fallback。

## 15. Native Desktop Runtime Cell Contract

Runtime Cell Contract 是 repository 内的非敏感平台能力声明。具体 host、username、
credential value 和远端绝对路径由 Profile/secret source 解析。

```yaml
id: desktop-linux-native
platform: linux
architecture: x86_64
isolation:
  kind: container
  image_ref: local-profile:acceptance-linux-image
  image_digest_required: true
transport:
  kind: ssh
  target_ref: profile:acceptance-linux
  webdriver_forward: local-loopback
display:
  session_type: x11
  physical_monitor_required: false
  connected_output_required: true
  fixed_geometry: 1920x1080
webdriver:
  kind: tauri-embedded
  bind: 127.0.0.1
native_adapter:
  input: x11-xtest
  window: x11-ewmh
  screenshot: webkitgtk-and-desktop
source:
  mode: git-object-sync
  clean_commit_required_for_proof: true
  binary_sha256_required: true
lease:
  scope: gui-session
  ttl_seconds: 5400
cleanup:
  resources:
    - ssh-tunnel
    - processes
    - ports
    - storage
    - source-workspace
    - gui-session-lease
```

Validation rules:

- `id`、`platform`、`architecture`、display、WebDriver、native adapter、source 和
  cleanup fields 必须完整。
- 容器化 cell 必须使用 digest-pinned image；tag-only image 不得产生最终 proof。
- `transport.target_ref` 只允许逻辑引用；literal IP、username、password 或 private
  key path 被 schema 拒绝。
- `webdriver.bind` 对远端 cell 必须为 loopback。
- `physical_monitor_required: false` 仍要求 connected virtual output 和 compositor。
- Native proof 不接受 `session_type: xvfb`。
- Cell contract 描述能力，不声明产品 actor、Fixture、selector 或 assertion。

## 16. Runtime Cell Manifest

每次 cell acquisition 产生不可变 manifest，并嵌入该 Gate 的 Runtime Resource
Manifest：

```json
{
  "artifactKind": "acceptance-runtime-cell-manifest",
  "cellId": "desktop-linux-native",
  "gateId": "chat-native-product-closure-e2e",
  "runId": "<run-id>",
  "state": "LEASED",
  "platform": {
    "os": "linux",
    "hostDistribution": "<name/version>",
    "hostKernel": "<version>",
    "isolationKind": "container",
    "imageDigest": "<sha256>",
    "distribution": "<name/version>",
    "architecture": "x86_64",
    "webviewBackend": "WebKitGTK",
    "webviewVersion": "<version>"
  },
  "transport": {
    "kind": "ssh",
    "hostIdentitySha256": "<sha256>",
    "hostKeySha256": "<sha256>",
    "webdriverLocalPort": 0,
    "webdriverRemotePort": 0
  },
  "display": {
    "sessionType": "x11",
    "displayId": "<redacted-logical-id>",
    "seat": "<seat>",
    "geometry": {"width": 1920, "height": 1080},
    "connectedOutput": true,
    "desktopUserIdentitySha256": "<sha256>"
  },
  "source": {
    "mode": "git-object-sync",
    "commit": "<git-commit>",
    "workspaceDigest": "clean",
    "remoteSourceDigest": "<sha256>",
    "remoteCheckoutClean": true,
    "binarySha256": "<sha256>"
  },
  "nativeAdapter": {
    "inputBackend": "x11-xtest",
    "windowBackend": "x11-ewmh",
    "screenshotBackend": "webkitgtk-and-desktop",
    "inputProbe": true,
    "focusProbe": true,
    "pointOwnershipProbe": true,
    "screenshotProbe": true
  },
  "lease": {
    "ownerRunId": "<run-id>",
    "expiresAt": "<UTC timestamp>"
  },
  "cleanup": {
    "registered": true,
    "resources": []
  }
}
```

Identity and proof rules:

- `hostIdentitySha256` 与 `hostKeySha256` 用于身份核验，不持久化 literal SSH target。
- local source、remote source 与 binary 三者 identity 不一致时不得进入
  `FIXTURE_READY`。
- `source.mode: git-object-sync` 要求 exact commit 可在远端 bare repository 中解析，
  checkout 无 dirty/untracked build input；cache volumes 不参与 source digest。
- 容器化 cell 必须同时记录 host kernel 与 userland image digest；宿主发行版不需要
  提供 cell 内 Tauri build dependencies。
- Gate result 必须记录 `cellId`。Reader/validator 只接受与 requested cell 完全一致
  的 evidence。
- Cell manifest 不能由业务 Gate 创建或修改。
- `inputProbe`、`focusProbe`、`pointOwnershipProbe` 与 `screenshotProbe`
  必须全部来自实际 platform adapter 操作并为 `true`；仅声明 backend 或查询
  XTest extension 不构成 input proof。

### 16.1 Native Adapter Diagnostic

Native adapter observation 使用跨平台 typed fields；业务 Gate 不解析 AX、EWMH
或 Win32 原生字段来决定成功条件：

```json
{
  "platform": "macos",
  "expectedProcessId": 1234,
  "documentFocused": true,
  "point": {"x": 320.0, "y": 24.0},
  "pointOwned": true,
  "focusedControl": {
    "kind": "text-field",
    "title": "",
    "value": "",
    "windowCount": 1,
    "dialogCount": 0,
    "frontmost": true,
    "mainWindow": true,
    "focusedWindow": true,
    "actualFrontmostPid": 1234,
    "platformRole": "AXTextField",
    "platformSubrole": "",
    "error": ""
  },
  "windowStack": {
    "windows": [
      {
        "index": 0,
        "ownerPid": 1234,
        "ownerName": "Peers Touch",
        "windowName": "",
        "layer": 0,
        "alpha": 1.0,
        "bounds": {
          "left": 0.0,
          "top": 0.0,
          "width": 1200.0,
          "height": 800.0
        }
      }
    ],
    "error": ""
  }
}
```

Rules:

- `kind`、window/dialog counts、focus booleans、PID、point ownership 和 bounds
  是跨平台稳定字段。
- `platformRole` 与 `platformSubrole` 仅保留底层诊断值，不得成为业务 Gate
  的平台分支条件。
- `pointOwned` 只由 point 上最上层的可见窗口决定；目标窗口被其他窗口遮挡时
  必须为 `false`。
- probe timeout、解析错误或平台调用失败必须进入 typed `error` 或抛出 typed
  Driver error，不得降级为成功。
- Desktop screenshot 是 adapter primitive；WebDriver viewport screenshot
  不能替代 desktop ownership evidence。

## 17. Runtime Cell Lifecycle

```text
DISCOVERED
  -> HOST_VERIFIED
  -> SESSION_READY
  -> SOURCE_ALIGNED
  -> BUILD_READY
  -> DRIVER_READY
  -> LEASED
  -> GATE_RUNNING
  -> EVIDENCE_JUDGED
  -> CLEANING
  -> CLEANED

Any pre-Gate failure -> BLOCKED
Gate failure          -> GATE_FAILED -> CLEANING
Cleanup failure       -> CLEANUP_FAILED
Lease timeout         -> REAPING -> CLEANED | CLEANUP_FAILED
```

同一 `cellId + displayId` 同时只能存在一个 active lease。远端 reaper 必须独立于
发起 SSH connection 存活，确保 orchestrator crash 或网络中断后仍能按 TTL 回收。

## 18. Platform Matrix Result

同一产品 Gate 的跨平台状态由 cell results 聚合：

```json
{
  "gateId": "chat-native-product-closure-e2e",
  "sourceCommit": "<git-commit>",
  "requiredRuntimeCells": [
    "desktop-macos-native",
    "desktop-linux-native",
    "desktop-windows-native"
  ],
  "cells": {
    "desktop-macos-native": {"cellId": "desktop-macos-native", "sourceCommit": "<git-commit>", "resultTuple": {"status": "passed", "completionStatus": "DONE", "proofStatus": "PROVEN"}},
    "desktop-linux-native": {"cellId": "desktop-linux-native", "sourceCommit": "<git-commit>", "resultTuple": {"status": "blocked", "completionStatus": "BLOCKED", "proofStatus": "UNPROVEN"}},
    "desktop-windows-native": {"cellId": "desktop-windows-native", "sourceCommit": "<git-commit>", "resultTuple": {"status": "blocked", "completionStatus": "BLOCKED", "proofStatus": "UNPROVEN"}}
  },
  "resultTuple": {"status": "blocked", "completionStatus": "BLOCKED", "proofStatus": "UNPROVEN"},
  "matrixResultDigest": "<sha256>"
}
```

Aggregation rules:

- `PROVEN` requires every required cell to be `PROVEN` for the same source commit.
- Missing、stale、blocked 或 failed cell 不能由其它平台结果替代。
- Platform-specific subclaims may be reported independently, but the cross-platform
  capability remains `PARTIAL/UNPROVEN` until the full required matrix closes.
- `PlatformMatrixResult` is closed: `cells.keys` equals
  `requiredRuntimeCells` exactly, every key equals its nested `cellId`, and every
  nested `sourceCommit` equals the matrix source commit.
- Aggregate tuple is a deterministic fold over the non-empty required set.
  Any blocked cell yields `BlockedBlockedUnproven`. Otherwise any failed cell
  yields `FailedDoneUnproven` when every required cell has
  `completionStatus=DONE`, and `FailedPartialUnproven` otherwise. If every cell
  passed, all-proven/all-done yields `PassedDoneProven`; all-done with any
  unproven cell yields `PassedDoneUnproven`; all remaining passed mixtures yield
  `PassedPartialUnproven`. Aggregate completion therefore preserves `DONE`
  independently from proof.

## 19. Ephemeral Gate Launch Context

Launch Context是进程内生命周期对象，不是artifact。下列结构是typed内存模型，
不得直接或间接进入JSON、YAML、Runtime Manifest、Evidence Store、日志或异常文本。

```text
EphemeralGateLaunchContext
  identity:
    workspace_id
    gate_id
    evidence_run_id
    provisioning_run_id
  state:
    CREATED | SEALED | CHILD_BOUND | ACTIVE | QUIESCING | QUIESCED | CLOSED
  capabilities:
    capability_id -> parent-owned handler
  transport:
    backend
    parent_endpoint
    child_endpoint
  cleanup:
    descriptors_closed
    broker_stopped
    quarantined_capabilities
    handlers_closed
    secrets_zeroized
```

`GateLaunchBinding`是唯一允许进入spawn调用的projection：

```text
GateLaunchBinding
  environment:
    PT_ACCEPTANCE_EPHEMERAL_CONTEXT_FD -> decimal descriptor locator
  pass_fds:
    exactly one child endpoint descriptor
```

locator不是credential，只能在同一次spawn中解释；不得写入manifest或evidence。
没有对应继承descriptor时，locator无authority且client必须fail closed。

需要ephemeral capability的Gate以以下catalog fragment声明启动契约：

```yaml
argv:
  - python3
  - -m
  - tooling.acceptance.gates.mobile.native_e2e
ephemeralCapabilities:
  - mobile.appium-session
  - mobile.provider-authorization
  - mobile.station-fixture
```

规则：

- `argv`与legacy `command`必须且只能出现一个。
- `ephemeralCapabilities`缺省或为空时不得创建launch context。
- 声明`ephemeralCapabilities`时必须使用`argv`；字符串command和`shell=True`
  均被validator拒绝。
- v1 POSIX backend只接受由隔离Python bootstrap执行的module、script或`-c`
  argv；bootstrap必须在加载Gate代码前恢复channel descriptor的
  close-on-exec属性。Portable `python3`由runner解析为当前Acceptance runner的
  exact executable，禁止child再次经`PATH`选解释器；显式路径保持原值。若解析结果
  为virtual-environment解释器，bootstrap只可直接追加经venv根目录containment校验
  且匹配当前Python版本的`site-packages`，不得启用`site`、`.pth`、user site、
  `sitecustomize`或`usercustomize`。其它可执行形式返回typed unsupported错误。
- capability ID只是business injection的稳定名称，不授予authority；Provisioner必须
  为当前run注册完全相同的handler集合，缺失或多余均在spawn前fail closed。
- argv不得包含descriptor、secret、raw handle或动态shell表达式。

### 19.1 状态机

```text
CREATED
  -> SEALED
  -> CHILD_BOUND
  -> ACTIVE
  -> QUIESCING
  -> QUIESCED
  -> CLOSED

CREATED | SEALED | CHILD_BOUND
  -> BIND_FAILED
  -> CLOSED

ACTIVE
  -> CHANNEL_FAILED
  -> QUIESCING
  -> QUIESCED
  -> CLOSED

QUIESCING
  -> CLEANUP_FAILED

QUIESCED
  -> CLEANUP_FAILED
```

规则：

- `register_capability`只允许在`CREATED`。
- `seal`只执行一次，并冻结identity和capability集合。
- `bind_child`只允许一次；重复绑定、跨run绑定或descriptor缺失均失败。
- `activate`必须发生在spawn前，确保parent broker已经ready；spawn失败仍进入
  `QUIESCING`。
- Gate退出、timeout、cancellation、EOF和protocol error都进入同一`QUIESCING`。
- `quiesce`幂等，关闭transport并bounded join broker；完成后不再接受请求，但保留
  Provisioner cleanup仍需的handler authority。
- quiesce deadline超时时，相关resource必须fence/quarantine并禁止复用；不得在
  handler仍可能执行时把resource释放回pool。Core调用通用handler quarantine接口并
  在cleanup result记录`quarantinedCapabilities`；具体resource fencing属于业务owner。
- runtime-cell和Provisioner cleanup完成后才允许`close`；只有context-owned buffer
  清理且capability owner报告closed、受控mutable secret owner buffer已清零才进入
  `CLOSED`。该状态不声称解释器内所有历史副本均已物理擦除。

### 19.2 Request / Response Envelope

```json
{
  "requestId": "<opaque run-unique id>",
  "gateId": "<gate-id>",
  "evidenceRunId": "<Evidence Store run id>",
  "provisioningRunId": "<Runtime Manifest run id>",
  "capability": "<injected capability id>",
  "operation": "<allowlisted operation>",
  "payload": {}
}
```

```json
{
  "requestId": "<same request id>",
  "status": "OK | BLOCKED | ERROR",
  "result": {},
  "error": {
    "code": "<typed safe code>",
    "message": "<redacted safe detail>"
  }
}
```

Framing与调用规则：

- 每个frame使用固定宽度length prefix加UTF-8结构化payload，并受固定byte budget约束。
  已完成handshake的broker可在两个frame之间stop-aware等待；首个frame byte到达后，
  length prefix与payload必须在同一个固定deadline内完整接收。
- 首个frame必须完成`workspaceId + gateId + evidenceRunId +
  provisioningRunId`握手；Evidence Store与Runtime Manifest的run identity必须分别
  取自各自owner，不匹配时关闭channel。
- `capability`和`operation`必须命中parent注册表，不允许dynamic import或任意callable
  name。
- 任何依赖raw handle的动作都在parent handler内完成。Gate只能收到opaque session
  reference、脱敏structured result或ArtifactRef，不能收到UDID、serial、provider
  subject、token或correlation key。
- handler必须声明`sensitiveValues`并对OK/BLOCKED payload执行
  `projectResponse`；Core在frame编码前扫描完整response，命中敏感值即关闭channel。
- 同一`requestId + requestDigest`重放返回同一bounded cached response；相同
  `requestId`搭配不同digest返回protocol conflict。
- response只能包含contract允许的脱敏值或ArtifactRef；raw handle、secret和provider
  subject不得离开parent handler。
- large payload必须由parent写入Evidence Store并返回ArtifactRef，不能绕过frame
  budget在channel内传输。

### 19.3 Typed Failures

| Error | Trigger | Result |
|---|---|---|
| `EphemeralLaunchContextInvalid` | unsealed、wrong identity、duplicate bind | pre-Gate `BLOCKED/UNPROVEN` |
| `EphemeralLaunchTransportUnsupported` | host没有已实现的安全backend | pre-Gate `BLOCKED/UNPROVEN` |
| `EphemeralLaunchBindFailed` | channel或descriptor绑定失败 | pre-Gate `BLOCKED/UNPROVEN` |
| `EphemeralLaunchHandshakeFailed` | child identity不匹配 | runtime `BLOCKED/UNPROVEN` |
| `EphemeralLaunchProtocolError` | malformed/oversized/unauthorized/conflicting replay | runtime `BLOCKED/UNPROVEN` |
| `EphemeralLaunchTimeout` | request或broker deadline超时 | runtime `BLOCKED/UNPROVEN` |
| `EphemeralLaunchCleanupFailed` | descriptor、broker、handler或zeroization未闭合 | `ACCEPTANCE_CLEANUP_FAILED` |

这些错误属于Acceptance runtime，不得改写为产品断言失败，也不得触发env/file/network
fallback。


## 20. Post-Cleanup Evidence Finalization (D-19 Accepted Target)

Mobile-owned Capability Graph的protected required-finalizer mapping独立声明需求，Gate Catalog提供
执行配置：

```yaml
# tooling/acceptance/capabilities/mobile.yaml
finalizerRegistry:
  path: tooling/acceptance/contracts/mobile/finalizers.yaml
  protectedBaseline: tooling/acceptance/contracts/mobile/native_oauth.protected.json
  protectedBaselineDigest: <sha256>
  protectedBaselineFileSha256: <sha256>
requiredEvidenceFinalizers:
  mobile-native-access-e2e: mobile.native.oauth-final-roles

# Gate Catalog
evidenceFinalizer:
  id: mobile.native.oauth-final-roles
  timeoutSeconds: 30
  inputByteLimit: 1048576

# tooling/acceptance/contracts/mobile/finalizers.yaml
entries:
  - finalizerId: mobile.native.oauth-final-roles
    entrypoint: tooling.acceptance.finalizers.mobile_native
    sourcePaths:
      - tooling/acceptance/contracts/mobile/native_oauth.py
      - tooling/acceptance/contracts/mobile/native_oauth.schema.json
      - tooling/acceptance/finalizers/mobile_native.py
    sourceDigest: <sha256>
    evidenceRoleNames: [] # generator emits the complete lexically sorted set
    contractRoleProjectionDigest: <sha256>
```

Requiredness只由Capability Graph mapping拥有；Gate Catalog schema不接受`required`
字段。只有requirement与Catalog字段同时缺省才表示不需要finalizer；任一侧单独缺失、
ID不匹配、finalizer registration entry缺失或timeout非法时，plan validation和runtime
preflight都必须拒绝。
Requirement按Gate ID唯一，不按Feature复制。该mapping由
`tooling/acceptance/contracts/mobile/native_oauth.protected.json`冻结；删除或修改必须与新的架构决策和
reviewed baseline更新同一变更完成。
`finalizerRegistry`是generic resolver唯一允许的registration-catalog discovery入口；`path`和
`protectedBaseline`必须是经过Capability Graph schema校验的repository-relative paths，
且解析后的canonical baseline object必须匹配semantic `protectedBaselineDigest`；
tracked file exact bytes另匹配`protectedBaselineFileSha256`。CLI、environment、Gate
result和runtime manifest都不能覆盖。Concrete entry存于
`tooling/acceptance/contracts/mobile/finalizers.yaml`，由canonical Mobile contract的
`--emit-finalizer-registration`确定性生成。`--check-finalizer-registration`必须在
内存重生成并与tracked bytes逐字节比较。Generator固定UTF-8、LF、key order和lexically
sorted `sourcePaths`/`evidenceRoleNames`；projection digest按§20.3 JCS规则覆盖完整role
name array。生成文件禁止手工维护。

上述runtime preflight必须在run allocation、credential resolution、Provisioner创建、
resource acquisition和任何destructive Fixture操作之前完成，并验证requirement、
Gate Catalog execution config、finalizer registration entrypoint/source paths、
timeout、input limit与protected baseline。
Preflight失败不分配run；成功返回绑定current enforcement generation/digest、live
supervisor session identity、`PreflightSourceCapture`和`PreflightRuntimeCapture`
identity及全部requirement/config/source/runtime measurement digests的
`FinalizerPreflightToken`。Source capture
由preflight期间的supervised `BUNDLE_PREPARER`一次读取validated worktree paths，
写入owner-only temporary directory并返回bounded manifest/digest；Runner把该directory
FD与matching `DescriptorClaim`保存在process-local capture中，不再按path读取。
Capture inventory是两个owner集合的并集：Acceptance Infra固定
`FinalizerBootstrapBaseline`必须且只能列出
`tooling/acceptance/core/finalization_contracts.py`与
`tooling/acceptance/core/finalizer_worker.py`及
`tooling/acceptance/core/finalization_supervisor.c`；generated finalizer registration
catalog列出Mobile business validator/contract/schema paths。Protected baseline、
required-finalizer mapping和registration catalog作为non-executable components捕获。
所有path/raw hash、bootstrap source digest、`executableIncluded`与complete capture
digest都进入token/requirement record。
Preflight随后通过supervised `RUNTIME_CAPTURE` worker一次测量并复制supervisor binary、
Python executable、compiler binary、FILE stdlib closure和全部standalone loaded images
到第二个owner-only temporary directory；request中的absolute paths仅存在于ephemeral
control frame，不持久化。Worker通过平台loader API在bootstrap/import allowlist全部
加载后枚举完整image closure；Darwin shared-cache image以cache UUID + Mach-O UUID +
CodeDirectory hash绑定，独立文件以raw hash+captured bytes绑定。Finalizer加载business
module后及退出前重枚举，出现新增/替换image即fail closed。OS kernel、dynamic loader
和shared cache属于明确的trusted-host boundary，不宣称hermetic virtualization。
Result返回无ArtifactRef的`PreflightRuntimeMeasurement`、captured file inventory及
capture digest。
通过后，Runner用一个Store operation在cleanup lock内复验token、两个未消费capture及同一
session的实时liveness并创建run directory、
durable `.active.lock` file和`finalization-requirement.json`，获取live advisory lock，
从source capture复制exact bytes为`ProtectedSourceArtifact`并产生
`FinalizerExecutableArtifact`，从runtime capture复制exact bytes为
`RuntimeEvidenceArtifact`，再由preflight measurement加run-scoped refs构造
`FinalizerRuntimeIdentity`。只有这些文件、目录和requirement record durable、
live lock已持有后才把两个capture标记consumed并返回`RunHandle`；任一hash/claim/capture
mismatch或重复消费都回滚未发布run并fail closed，不得进入credential/resource阶段。

```text
SnapshotArtifact
  roleName
  discriminator: string | null
  ref: ArtifactRef
  payload: CanonicalOpaqueJson | null  # bounded schema-bound JSON bytes
  payloadDigest: string | null

CanonicalOpaqueJson
  schemaId
  schemaDigest
  byteLength
  canonicalUtf8Base64
  contentDigest

CanonicalPrimaryResult
  document: CanonicalOpaqueJson
  document.schemaId: acceptance-primary-result-v1
  resultTuple: CanonicalResultTuple
  reasonCode: string | null
  sourceTrace: PrimaryResultSourceTrace

PrimaryResultSourceTrace
  producerId
  sourceCommit
  invocationId
  evidenceRefs: UTF-8 lexical sorted tuple[ArtifactRef, ...]
  sourceTraceDigest

CanonicalResultTuple =
  PassedDoneProven
  | PassedDoneUnproven
  | PassedPartialUnproven
  | FailedPartialUnproven
  | FailedDoneUnproven
  | BlockedBlockedUnproven

PassedDoneProven = {status: passed, completionStatus: DONE, proofStatus: PROVEN}
PassedDoneUnproven = {status: passed, completionStatus: DONE, proofStatus: UNPROVEN}
PassedPartialUnproven = {status: passed, completionStatus: PARTIAL, proofStatus: UNPROVEN}
FailedPartialUnproven = {status: failed, completionStatus: PARTIAL, proofStatus: UNPROVEN}
FailedDoneUnproven = {status: failed, completionStatus: DONE, proofStatus: UNPROVEN}
BlockedBlockedUnproven = {status: blocked, completionStatus: BLOCKED, proofStatus: UNPROVEN}

PlatformCellResult
  cellId
  sourceCommit
  resultTuple: CanonicalResultTuple

PlatformMatrixResult
  gateId
  sourceCommit
  requiredRuntimeCells: non-empty unique UTF-8 lexical sorted tuple[cellId, ...]
  cells: map[cellId, PlatformCellResult]
  resultTuple: CanonicalResultTuple
  matrixResultDigest

FinalizerRegistryEntry
  finalizerId
  entrypoint
  sourcePaths: tuple[str, ...]
  sourceDigest
  contractRoleProjectionDigest
  evidenceRoleNames: tuple[str, ...]  # generated projection, not editable truth

FinalizerExecutableArtifact
  ref: ArtifactRef
  bundleFormat
  bundleDigest
  files: tuple[(repoRelativePath, fileSha256), ...]
  sourceDigest  # business registration source inventory only
  coreBootstrapSourceDigest
  entrypoint

SupervisorBuildIdentity
  compilerExecutablePathHash
  compilerBinarySha256
  compilerBinaryRef: ArtifactRef
  compilerVersion
  targetTriple
  compilerFlags: tuple[str, ...]
  compilerFlagsDigest

StdlibModuleIdentity
  moduleName
  originKind: FILE | BUILTIN | FROZEN
  fileSha256: string | null
  artifactRef: ArtifactRef | null

LoadedRuntimeImage
  logicalName
  originKind: STANDALONE_FILE | DARWIN_SHARED_CACHE
  pathHash
  fileSha256: string | null
  artifactRef: ArtifactRef | null
  machoUuid: string | null
  codeDirectoryHash: string | null
  sharedCacheUuid: string | null

PreflightLoadedRuntimeImage
  logicalName
  originKind: STANDALONE_FILE | DARWIN_SHARED_CACHE
  pathHash
  fileSha256: string | null
  machoUuid: string | null
  codeDirectoryHash: string | null
  sharedCacheUuid: string | null

DarwinRuntimeHostBuild
  osFamily: DARWIN
  productVersion: non-empty string
  productBuildVersion: non-empty string
  kernelRelease: non-empty string
  kernelVersion: non-empty string

LinuxRuntimeHostBuild
  osFamily: LINUX
  osReleaseFileSha256: lowercase sha256
  kernelRelease: non-empty string
  kernelVersion: non-empty string
  machine: non-empty string

RuntimeHostBuild = DarwinRuntimeHostBuild | LinuxRuntimeHostBuild

DarwinRuntimeHostIdentity
  osFamily: DARWIN
  hostBuild: DarwinRuntimeHostBuild
  hardwareIdentityHash: lowercase sha256
  runtimeHostIdentityDigest

LinuxRuntimeHostIdentity
  osFamily: LINUX
  hostBuild: LinuxRuntimeHostBuild
  machineIdHash: lowercase sha256
  runtimeHostIdentityDigest

RuntimeHostIdentity =
  DarwinRuntimeHostIdentity
  | LinuxRuntimeHostIdentity

`hardwareIdentityHash` is SHA-256 of the canonical `IOPlatformUUID` bytes and
`machineIdHash` is SHA-256 of the canonical machine-id bytes; raw identifiers
are never persisted. Boot identity remains a separate field in process and
boot-observation schemas. Host-build, stable-host hash and current-boot equality
are all mandatory; matching OS/build alone is insufficient.

PreflightRuntimePlatformAttestation
  osFamily: DARWIN | LINUX
  hostBuild: RuntimeHostBuild
  dynamicLoaderIdentity: PreflightLoadedRuntimeImage
  sharedCacheUuid: string | null
  loadedImages: tuple[PreflightLoadedRuntimeImage, ...]
  preflightPlatformRuntimeDigest

RuntimePlatformAttestation
  osFamily: DARWIN | LINUX
  hostBuild: RuntimeHostBuild
  dynamicLoaderIdentity: LoadedRuntimeImage
  sharedCacheUuid: string | null
  loadedImages: tuple[LoadedRuntimeImage, ...]
  platformRuntimeDigest

Platform branch constraints:
  DARWIN:
    hostBuild: DarwinRuntimeHostBuild
    sharedCacheUuid: non-empty string
    dynamicLoaderIdentity.originKind: STANDALONE_FILE | DARWIN_SHARED_CACHE
  LINUX:
    hostBuild: LinuxRuntimeHostBuild
    sharedCacheUuid: null
    dynamicLoaderIdentity.originKind: STANDALONE_FILE

`dynamicLoaderIdentity.logicalName` is exactly `dynamic-loader` and is also one
identity-equal member of `loadedImages`; it does not form a parallel inventory.
`STANDALONE_FILE` requires path hash/file SHA and, after allocation, ArtifactRef,
while all Mach-O/shared-cache fields are null. `DARWIN_SHARED_CACHE` requires
path hash/Mach-O UUID/CodeDirectory hash/shared-cache UUID and forbids file SHA
or ArtifactRef. `osFamily`, `hostBuild.osFamily`, dynamic-loader branch and
top-level shared-cache field must agree exactly.

FinalizerRuntimeIdentity
  finalizerRuntimeDigest
  supervisorRuntimeDigest
  supervisorSourcePath
  supervisorSourceFileSha256
  supervisorSourceArtifact: ArtifactRef
  supervisorSourceDigest
  supervisorBinaryRef: ArtifactRef
  supervisorBinarySha256
  supervisorBuildIdentity: SupervisorBuildIdentity
  protocolVersion
  executablePathHash
  executableRef: ArtifactRef
  executableSha256
  implementation
  version
  stdlibModules: tuple[StdlibModuleIdentity, ...]
  stdlibDigest
  platformRuntime: RuntimePlatformAttestation
  coreBootstrapSourceDigest

ReadOnlyEvidenceSnapshot
  workspaceId
  gateId
  evidenceRunId
  snapshotDigest
  evaluationTime
  artifacts: tuple[SnapshotArtifact, ...]  # canonical total key defined below
  runtimeManifestRef: ArtifactRef
  sourceCommit
  workspaceDigest
  canonicalWorktreeHash

FinalizerContext
  finalizerId
  enforcementGeneration
  enforcementDigest
  requirementDigest
  configDigest
  workspaceId
  gateId
  evidenceRunId
  provisioningRunId
  runtimeManifestRef
  sourceCommit
  workspaceDigest
  canonicalWorktreeHash
  snapshotDigest
  finalizerSourceDigest
  finalizerExecutable: FinalizerExecutableArtifact
  finalizerRuntime: FinalizerRuntimeIdentity
  supervisorSessionId
  supervisorRuntimeDigest
  requiredRoleIdentities: tuple[(roleName, discriminator), ...]
  primaryStatus: CanonicalResultTuple
  primaryResultDigest

FinalizerInput
  invocation: FinalizerInvocationIdentity
  context: FinalizerContext
  snapshot: ReadOnlyEvidenceSnapshot
  finalizerInputDigest

SealedEvidenceMarker
  artifactKind: acceptance-finalizer-seal
  schemaVersion: 1
  snapshot: ReadOnlyEvidenceSnapshot
  finalizerContext: FinalizerContext
  primaryResult: CanonicalPrimaryResult
  primaryResultDigest
  sealedAt
  sealDigest

FinalizerRequirement
  gateId
  finalizerId
  finalizerRegistryPath
  protectedBaselinePath
  protectedBaselineDigest
  protectedBaselineFileSha256

FinalizerExecutionConfig
  gateId
  finalizerId
  timeoutSeconds
  inputByteLimit

FinalizerProtectedBaseline
  gateId
  finalizerId
  requirementMappingDigest
  registryFilePath
  registryFileDigest
  contractSchemaPath
  contractSchemaDigest
  entrypointSourcePath
  entrypointSourceDigest
  generatorSourcePath
  generatorSourceDigest

FinalizerBootstrapBaseline
  schemaVersion: 1
  sourceFiles:
    - (tooling/acceptance/core/finalization_contracts.py, fileSha256)
    - (tooling/acceptance/core/finalizer_worker.py, fileSha256)
    - (tooling/acceptance/core/finalization_supervisor.c, fileSha256)
  coreBootstrapSourceDigest

ProtectedSourceArtifact
  component: PROTECTED_BASELINE | REQUIRED_MAPPING | REGISTRATION_CATALOG | CONTRACT_SCHEMA | ENTRYPOINT_SOURCE | GENERATOR_SOURCE | CORE_CONTRACTS | CORE_WORKER_BOOTSTRAP | SUPERVISOR_SOURCE
  repoRelativePath
  ref: ArtifactRef
  fileSha256
  byteLength
  executableIncluded: boolean

FinalizerRequirementRecord
  artifactKind: acceptance-finalizer-requirement
  schemaVersion: 1
  enforcementGeneration
  enforcementDigest
  workspaceId
  sourceCommit
  workspaceDigest
  canonicalWorktreeHash
  requirement: FinalizerRequirement
  config: FinalizerExecutionConfig
  protectedBaseline: FinalizerProtectedBaseline
  bootstrapBaseline: FinalizerBootstrapBaseline
  requirementMapping: RequiredFinalizerMapping
  capturedSources: tuple[CapturedProtectedSource, ...]
  protectedSourceArtifacts: tuple[ProtectedSourceArtifact, ...]
  registryEntry: FinalizerRegistryEntry
  sourceFiles: tuple[(repoRelativePath, fileSha256), ...]
  sourceCaptureId
  sourceCaptureDigest
  sourceCaptureBundleDigest
  runtimeCaptureId
  runtimeCaptureDigest
  runtimeMeasurement: PreflightRuntimeMeasurement
  capturedRuntimeFiles: tuple[CapturedRuntimeFile, ...]
  runtimeCaptureBundleDigest
  runtimeEvidenceArtifacts: tuple[RuntimeEvidenceArtifact, ...]
  finalizerRuntime: FinalizerRuntimeIdentity
  durabilityProfile: ProofAuthorityDurabilityProfile
  requirementDigest
  configDigest
  sourceDigest
  createdAt

FinalizerPreflightToken
  enforcementGeneration
  enforcementDigest
  requirementDigest
  configDigest
  sourceDigest
  supervisorSessionId
  supervisorRuntimeDigest
  preflightRuntimeDigest
  sourceCaptureId
  sourceCaptureDigest
  runtimeCaptureId
  runtimeCaptureDigest
  durabilityProfileDigest

RequiredFinalizerMapping
  gateId
  finalizerId

CapturedProtectedSource
  component: PROTECTED_BASELINE | REQUIRED_MAPPING | REGISTRATION_CATALOG | CONTRACT_SCHEMA | ENTRYPOINT_SOURCE | GENERATOR_SOURCE | CORE_CONTRACTS | CORE_WORKER_BOOTSTRAP | SUPERVISOR_SOURCE
  repoRelativePath
  fileSha256
  byteLength
  executableIncluded: boolean

PreflightSourceCapture
  captureId
  workspaceId
  sourceCommit
  workspaceDigest
  canonicalWorktreeHash
  sourceFiles: tuple[CapturedProtectedSource, ...]
  sourceCaptureBundleDigest
  temporaryDirectoryClaim: DescriptorClaim
  sourceCaptureDigest
  consumed: boolean  # process-local state, excluded from digest

PreflightRuntimeMeasurement
  supervisorSourcePath
  supervisorSourceFileSha256
  supervisorBinarySha256
  supervisorBuildIdentity: PreflightSupervisorBuildIdentity
  protocolVersion
  executablePathHash
  executableSha256
  implementation
  version
  stdlibModules: tuple[PreflightStdlibModuleIdentity, ...]
  stdlibDigest
  platformRuntime: PreflightRuntimePlatformAttestation
  coreBootstrapSourceDigest
  preflightRuntimeDigest

PreflightSupervisorBuildIdentity
  compilerExecutablePathHash
  compilerBinarySha256
  compilerVersion
  targetTriple
  compilerFlags: tuple[str, ...]
  compilerFlagsDigest

PreflightStdlibModuleIdentity
  moduleName
  originKind: FILE | BUILTIN | FROZEN
  fileSha256: string | null

RuntimePathInput
  kind: SUPERVISOR_BINARY | PYTHON_EXECUTABLE | COMPILER_BINARY | STDLIB_MODULE
  moduleName: string | null
  absolutePath: canonical absolute UTF-8 path  # ephemeral request only; never persisted
  expectedPathHash: lowercase sha256

RuntimePathInput branch constraints:
  SUPERVISOR_BINARY | PYTHON_EXECUTABLE | COMPILER_BINARY:
    moduleName: null
  STDLIB_MODULE:
    moduleName: non-empty string

`runtimePaths` is sorted by
`(kind, null/string moduleName tag+value, expectedPathHash)` and rejects duplicate
identity. It contains exactly one `SUPERVISOR_BINARY`, one `PYTHON_EXECUTABLE`,
one `COMPILER_BINARY`, and exactly one `STDLIB_MODULE` for every FILE-origin
module in the preflight stdlib closure; BUILTIN/FROZEN modules have no path input.
`absolutePath` must be normalized, NUL-free, absolute, and its
`sha256(utf8(normcase(realpath(path))))` must equal `expectedPathHash`.

CapturedRuntimeFile
  kind: SUPERVISOR_BINARY | PYTHON_EXECUTABLE | STDLIB_MODULE | COMPILER_BINARY | LOADED_RUNTIME_IMAGE
  moduleName: string | null
  logicalName: string | null
  originKind: STANDALONE_FILE | null
  pathHash
  fileSha256
  byteLength

PreflightRuntimeCapture
  captureId
  measurement: PreflightRuntimeMeasurement
  files: tuple[CapturedRuntimeFile, ...]
  runtimeCaptureBundleDigest
  temporaryDirectoryClaim: DescriptorClaim
  runtimeCaptureDigest
  consumed: boolean  # process-local state, excluded from digest

RuntimeEvidenceArtifact
  kind: SUPERVISOR_BINARY | PYTHON_EXECUTABLE | STDLIB_MODULE | COMPILER_BINARY | LOADED_RUNTIME_IMAGE
  moduleName: string | null
  logicalName: string | null
  originKind: STANDALONE_FILE | null
  pathHash
  ref: ArtifactRef
  fileSha256
  byteLength

`CapturedRuntimeFile` and `RuntimeEvidenceArtifact` use the same closed per-kind
field matrix:

| `kind` | `moduleName` | `logicalName` | `originKind` |
|---|---|---|---|
| `SUPERVISOR_BINARY` | null | null | null |
| `PYTHON_EXECUTABLE` | null | null | null |
| `COMPILER_BINARY` | null | null | null |
| `STDLIB_MODULE` | non-empty string | null | null |
| `LOADED_RUNTIME_IMAGE` | null | non-empty string | `STANDALONE_FILE` |

All branches require non-empty `pathHash`, lowercase raw `fileSha256`, and
non-negative `byteLength`. Cross-kind fields, duplicate kind-specific identity,
or a shared-cache image in this file-backed inventory are rejected before bundle
or capture digest calculation.

FinalizerInvocationIdentity
  finalizerId
  finalizerExecutable: FinalizerExecutableArtifact
  finalizerSourceDigest
  finalizerRuntime: FinalizerRuntimeIdentity
  supervisorSessionId
  supervisorRuntimeDigest
  enforcementGeneration
  enforcementDigest
  requirementDigest
  configDigest
  workspaceId
  gateId
  evidenceRunId
  provisioningRunId
  runtimeManifestRef
  sourceCommit
  workspaceDigest
  canonicalWorktreeHash
  snapshotDigest
  requiredRoleIdentities: tuple[(roleName, discriminator), ...]
  primaryStatus: CanonicalResultTuple
  primaryResultDigest
  invocationDigest

FinalizerChildOutcome
  status: VALIDATED | REJECTED | BLOCKED
  finalizerId
  invocationDigest
  finalizerInputDigest
  snapshotDigest
  primaryResultDigest
  childOutcomeDigest
  validatedRoleInstances: tuple[(roleName, discriminator), ...]  # VALIDATED only
  failureCode: typed code                           # non-VALIDATED only
  diagnostic: redacted bounded text                 # non-VALIDATED only

ChildGateEvidenceFinalization
  origin: CHILD
  childOutcome: FinalizerChildOutcome
  outcomeDigest

CoreGateEvidenceFinalization
  origin: CORE
  status: TIMED_OUT | ERROR
  childOutcome: null
  finalizerId
  invocationDigest
  finalizerInputDigest
  snapshotDigest
  primaryResultDigest
  outcomeDigest
  validatedRoleInstances: ()
  failureCode: typed Core failure code
  diagnostic: redacted bounded text

GateEvidenceFinalization =
  ChildGateEvidenceFinalization
  | CoreGateEvidenceFinalization

EvidenceFinalizationRecord
  artifactKind: acceptance-evidence-finalization
  schemaVersion: 1
  state: NOT_REQUIRED | NOT_INVOKED_PRE_SEAL | COMPLETED
  enforcementGeneration: integer | null
  enforcementDigest: string | null
  requirementDigest: string | null
  configDigest: string | null
  sourceDigest: string | null
  sealDigest: string | null
  primaryResult: CanonicalPrimaryResult | null
  primaryResultDigest: string | null
  failureCode: typed code | null
  outcome: GateEvidenceFinalization | null

AuthoritativeLatestResolution
  artifactKind: acceptance-authoritative-latest-resolution
  schemaVersion: 1
  authorityMode: LEGACY | FINALIZER_ENFORCED
  workspaceId
  gateId
  interlockDigest: string | null
  generation: integer | null
  enforcementDigest: string | null
  manifestRef: ArtifactRef
  manifestSha256
  resultTuple: CanonicalResultTuple
  resolutionDigest

FinalizerEnforcementRecord
  artifactKind: acceptance-finalizer-enforcement-generation
  schemaVersion: 1
  generation
  workspaceId
  gateId
  requiredFinalizerId
  activationIntent: FinalizerActivationIntent
  activatedAt
  activationSourceCommit
  priorLatestPointer: LatestPointer | null  # diagnostic only, never authoritative after activation
  priorLatestPointerDigest: string | null
  requirementDigest
  configDigest
  sourceDigest
  protectedBaselineDigest
  enforcementDigest

FinalizerPublicationInterlock
  artifactKind: acceptance-finalizer-publication-interlock
  schemaVersion: 1
  workspaceId
  gateId
  requiredFinalizerId
  installedAt
  installationSourceCommit
  proofAdmissionSourceDigest
  authorization: FinalizerAuthorityAuthorization
  interlockDigest

FinalizerEnforcementActivated
  artifactKind: acceptance-finalizer-enforcement-activated
  schemaVersion: 1
  workspaceId
  gateId
  requiredFinalizerId
  firstGeneration
  firstEnforcementDigest
  activatedAt
  activationSourceCommit
  activationIntentDigest
  activatedDigest

FinalizerEnforcementCurrent
  artifactKind: acceptance-finalizer-enforcement-current
  schemaVersion: 1
  workspaceId
  gateId
  requiredFinalizerId
  generation
  enforcementDigest
  currentDigest

FinalizerActivationIntent
  artifactKind: acceptance-finalizer-activation-intent
  schemaVersion: 1
  workspaceId
  gateId
  requiredFinalizerId
  targetGeneration
  expectedCurrentGeneration: integer | null
  activatedAt
  activationSourceCommit
  expectedPriorLatestPointer: LatestPointer | null
  expectedPriorLatestPointerDigest: string | null
  requirementDigest
  configDigest
  sourceDigest
  protectedBaselineDigest
  authorization: FinalizerAuthorityAuthorization
  intentDigest

FinalizerActivationPending
  artifactKind: acceptance-finalizer-activation-pending
  schemaVersion: 1
  intent: FinalizerActivationIntent
  candidateEnforcementRecord: FinalizerEnforcementRecord
  candidateActivated: FinalizerEnforcementActivated | null
  candidateCurrent: FinalizerEnforcementCurrent
  pendingDigest

AuthorityRuntimeArtifactRef
  artifactKind: acceptance-finalizer-authority-runtime-ref
  schemaVersion: 1
  workspaceId
  gateId
  authorizationId
  kind: SUPERVISOR_BINARY | PYTHON_EXECUTABLE | STDLIB_MODULE | COMPILER_BINARY | LOADED_RUNTIME_IMAGE
  moduleName: string | null
  logicalName: string | null
  originKind: STANDALONE_FILE | null
  contentSha256
  byteLength
  authorityRuntimeRefDigest

FinalizerMaintenanceRuntimeIdentity
  protocolVersion: 1
  workerSourceRule: MAINTENANCE_WORKER_SOURCE_V1
  workerSourceFiles: tuple[(repoRelativePath, fileSha256, byteLength), ...]
  workerSourceDigest
  runtimeCaptureId
  runtimeMeasurement: PreflightRuntimeMeasurement
  capturedRuntimeFiles: tuple[CapturedRuntimeFile, ...]
  runtimeArtifacts: tuple[AuthorityRuntimeArtifactRef, ...]
  runtimeCaptureBundleDigest
  runtimeCaptureDigest
  maintenanceRuntimeDigest

`AuthorityRuntimeArtifactRef` uses the same per-kind module/logical/origin
nullability as `RuntimeEvidenceArtifact`. Its resolver derives only
`finalizer-enforcement/runtime/<authorizationId>/<contentSha256>.blob` from the
closed identity; no caller path is accepted. `runtimeArtifacts` must match
`capturedRuntimeFiles` one-to-one in canonical runtime-file order. Historical
validation resolves every ref, reconstructs `pt-finalizer-runtime-bundle-v1`, and
recomputes both runtime capture and maintenance runtime digests.

ProofAuthorityDurabilityCapabilityEvidence
  evidenceRule: DURABILITY_CAPABILITY_EVIDENCE_V1
  osFamily: DARWIN | LINUX
  backend: LINUX_FILE_AND_DIRECTORY_FSYNC_V1 | DARWIN_APFS_FULLFSYNC_V1
  stableVolumeIdentity: StableVolumeIdentity
  qualifiedHostBuild: RuntimeHostBuild
  qualifiedHostIdentity: RuntimeHostIdentity
  filesystemImplementationVersion
  requiredMountOptions: UTF-8 lexical sorted tuple[string, ...]
  probeSourceFiles: tuple[(repoRelativePath, fileSha256, byteLength), ...]
  probeSourceDigest
  probeRuntimeDigest
  successfulOperations: tuple[DurabilitySyncOperation, ...]
  crashFixtureId
  qualificationRunId
  crashFixtureManifestRef: DurabilityCapabilityArtifactRef
  crashFixtureArtifacts: non-empty tuple[DurabilityCapabilityArtifactRef, ...]
  bootstrapQualificationManifestDigest
  controllerTrustAnchorRef: PowerControllerTrustAnchorRef
  controllerTrustAnchorDigest
  controllerRuntimeDigest
  controllerRuntimeLockBackendDigest
  result: SUPPORTED
  observedAt
  capabilityEvidenceDigest

DurabilityCapabilityArtifactRef
  artifactKind: acceptance-durability-capability-ref
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  artifactName: EXPECTATION | EXECUTION_START | MANIFEST | POWER_CUT_TRACE | RECOVERY_RESULT | BOOT_OBSERVATION | QUALIFICATION_BOOT_OBSERVATION | CONTROLLER_RUNTIME_EPOCH | CONTROLLER_RUNTIME_CURRENT | CONTROLLER_LOCK_CONTENTION | CONTROLLER_RECEIPT | CONTROLLER_ARM_RECEIPT | CONTROLLER_EXECUTION_RECEIPT | CONTROLLER_COMMAND_JOURNAL | CONTROLLER_COMMAND_JOURNAL_HEAD | PROBE_RUNTIME_MANIFEST | PROBE_RUNTIME_BLOB
  objectDigest: string | null
  contentSha256
  byteLength
  durabilityCapabilityRefDigest

DurabilityProbeRuntimeManifest
  artifactKind: acceptance-durability-probe-runtime
  schemaVersion: 1
  probeSourceDigest
  runtimeMeasurement: PreflightRuntimeMeasurement
  capturedRuntimeFiles: tuple[CapturedRuntimeFile, ...]
  runtimeArtifacts: tuple[DurabilityCapabilityArtifactRef, ...]
  runtimeCaptureBundleDigest
  runtimeCaptureId
  runtimeCaptureDigest
  probeRuntimeDigest

DurabilityCrashFixtureManifest
  artifactKind: acceptance-durability-crash-fixture
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  backend: LINUX_FILE_AND_DIRECTORY_FSYNC_V1 | DARWIN_APFS_FULLFSYNC_V1
  stableVolumeIdentity: StableVolumeIdentity
  qualifiedEnvironment: DurabilityQualifiedEnvironment
  controllerRuntimeDigest
  controllerRuntimeLockBackendDigest
  expectationRef: DurabilityCapabilityArtifactRef
  expectationDigest
  probeRuntimeManifestRef: DurabilityCapabilityArtifactRef
  operationSequence: tuple[DurabilitySyncOperation, ...]
  oldContentSha256
  newContentSha256
  cases: non-empty tuple[DurabilityCrashCase, ...]
  result: SUPPORTED
  crashFixtureManifestDigest

DurabilityCrashCase
  caseId
  interruptionPoint: BEFORE_FILE_SYNC | AFTER_FILE_SYNC | AFTER_RENAME | AFTER_DIRECTORY_SYNC | AFTER_ANCHOR_SYNC
  expectedRecoveredState: ABSENT | OLD_BYTES | NEW_BYTES
  traceRef: DurabilityCapabilityArtifactRef
  recoveryResultRef: DurabilityCapabilityArtifactRef
  caseDigest

DurabilityExpectationRecord
  artifactKind: acceptance-durability-expectation
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  backend
  operationSequence
  cases: tuple[(caseId, interruptionPoint, expectedRecoveredState, expectedContentSha256), ...]
  trustMode: BOOTSTRAP_CANDIDATE | ACTIVE_ANCHOR
  controllerTrustRef: PowerControllerTrustAuthorityRef
  controllerTrustDigest
  committedAt
  expectationDigest

DurabilityExecutionStartRecord
  artifactKind: acceptance-durability-execution-start
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  caseId
  interruptionPoint
  qualifiedEnvironmentDigest
  expectationRef: DurabilityCapabilityArtifactRef
  expectationDigest
  durableSequence: positive integer
  previousExecutionDigest: string | null
  startedAt
  executionStartDigest

DurabilityQualifiedEnvironment
  hostBuild: RuntimeHostBuild
  hostIdentity: RuntimeHostIdentity
  filesystemImplementationVersion
  requiredMountOptions: UTF-8 lexical sorted tuple[string, ...]
  stableVolumeIdentity: StableVolumeIdentity
  probeRuntimeDigest
  qualifiedEnvironmentDigest

QualificationDurabilityEnvironmentObservation
  observationMode: QUALIFICATION_BOOTSTRAP
  qualifiedEnvironmentDigest
  hostBuild: RuntimeHostBuild
  hostIdentity: RuntimeHostIdentity
  filesystemImplementationVersion
  mountOptions: UTF-8 lexical sorted tuple[string, ...]
  stableVolumeIdentity: StableVolumeIdentity
  liveMountBinding: LiveAuthorityMountBinding
  bootObservationRef: DurabilityCapabilityArtifactRef
  bootObservationRef.artifactName: QUALIFICATION_BOOT_OBSERVATION
  observedAt
  environmentObservationDigest

ActiveDurabilityEnvironmentObservation
  observationMode: ACTIVE_PROFILE
  qualifiedEnvironmentDigest
  hostBuild: RuntimeHostBuild
  hostIdentity: RuntimeHostIdentity
  filesystemImplementationVersion
  mountOptions: UTF-8 lexical sorted tuple[string, ...]
  stableVolumeIdentity: StableVolumeIdentity
  liveMountBinding: LiveAuthorityMountBinding
  bootObservationRef: DurabilityCapabilityArtifactRef
  bootObservationRef.artifactName: BOOT_OBSERVATION
  observedAt
  environmentObservationDigest

DurabilityEnvironmentObservation =
  QualificationDurabilityEnvironmentObservation
  | ActiveDurabilityEnvironmentObservation

DarwinDurabilityQualificationBootObservation
  artifactKind: acceptance-durability-qualification-darwin-boot-observation
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  bootstrapCandidateDigest
  sourceCommit
  hostIdentity: DarwinRuntimeHostIdentity
  helperSourceDigest
  helperRuntimeDigest
  bootSessionUuid
  bootTimeSeconds: UInt64String
  bootTimeMicroseconds: UInt64String
  observedAt
  qualificationBootObservationDigest

LinuxDurabilityQualificationBootObservation
  artifactKind: acceptance-durability-qualification-linux-boot-observation
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  bootstrapCandidateDigest
  sourceCommit
  hostIdentity: LinuxRuntimeHostIdentity
  helperSourceDigest
  helperRuntimeDigest
  bootId
  bootTimeSeconds: UInt64String
  bootTimeNanoseconds: UInt64String
  observedAt
  qualificationBootObservationDigest

DurabilityQualificationBootObservation =
  DarwinDurabilityQualificationBootObservation
  | LinuxDurabilityQualificationBootObservation

DarwinDurabilityProfileBootObservation
  artifactKind: acceptance-durability-profile-darwin-boot-observation
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  durabilityProfileDigest
  sourceCommit
  hostIdentity: DarwinRuntimeHostIdentity
  helperSourceDigest
  helperRuntimeDigest
  bootSessionUuid
  bootTimeSeconds: UInt64String
  bootTimeMicroseconds: UInt64String
  observedAt
  profileBootObservationDigest

LinuxDurabilityProfileBootObservation
  artifactKind: acceptance-durability-profile-linux-boot-observation
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  durabilityProfileDigest
  sourceCommit
  hostIdentity: LinuxRuntimeHostIdentity
  helperSourceDigest
  helperRuntimeDigest
  bootId
  bootTimeSeconds: UInt64String
  bootTimeNanoseconds: UInt64String
  observedAt
  profileBootObservationDigest

DurabilityProfileBootObservation =
  DarwinDurabilityProfileBootObservation
  | LinuxDurabilityProfileBootObservation

DurabilitySyncOperation =
  WRITE_TEMP | SYNC_FILE | RENAME_FINAL | SYNC_DIRECTORY | SYNC_ANCHOR

PowerInterruptionEvidenceCommon
  targetHostBuild: RuntimeHostBuild
  targetHostIdentity: RuntimeHostIdentity
  qualificationRunId
  executionStartRef: DurabilityCapabilityArtifactRef
  executionStartDigest
  expectationRef: DurabilityCapabilityArtifactRef
  expectationDigest
  durableSequence: positive integer
  beforeBootObservationRef: DurabilityCapabilityArtifactRef
  afterBootObservationRef: DurabilityCapabilityArtifactRef
  controllerReceiptRef: DurabilityCapabilityArtifactRef
  controllerReceiptDigest
  controllerArmReceiptRef: DurabilityCapabilityArtifactRef
  controllerArmReceiptDigest
  controllerExecutionReceiptRef: DurabilityCapabilityArtifactRef
  controllerExecutionReceiptDigest
  issuedAt
  restartObservedAt

PhysicalPowerInterruptionEvidence
  interruptionKind: PHYSICAL_POWER_CUT
  controllerIdentity: PhysicalPowerControllerIdentity
  evidence: PowerInterruptionEvidenceCommon
  interruptionEvidenceDigest

VmPowerInterruptionEvidence
  interruptionKind: VM_HARD_POWER_OFF
  controllerIdentity: VmPowerControllerIdentity
  evidence: PowerInterruptionEvidenceCommon
  interruptionEvidenceDigest

PowerInterruptionEvidence =
  PhysicalPowerInterruptionEvidence
  | VmPowerInterruptionEvidence

PowerControllerRuntimeEpoch
  artifactKind: acceptance-power-controller-runtime-epoch
  schemaVersion: 1
  osFamily: DARWIN | LINUX
  controllerHostIdentity: RuntimeHostIdentity
  controllerIdentityDigest
  trustMode: BOOTSTRAP_CANDIDATE | ACTIVE_ANCHOR
  controllerTrustDigest
  selectedTrustGenerationRef: PowerControllerTrustGenerationRef | null
  selectedCurrentTrustDigest: string | null
  controllerRuntimeEpochId
  controllerPid: positive integer
  controllerProcessStartIdentity: ProcessStartIdentity
  runtimeIdentity: PowerControllerRuntimeIdentity
  runtimeLockBackend: PowerControllerRuntimeLockBackendIdentity
  runtimeLockIdentity: PowerControllerRuntimeEpochLeaseIdentity
  previousEpochRef: PowerControllerRuntimeEpochRef | null
  startedAt
  signatureAlgorithm: ED25519
  signatureHex: exactly 128 lowercase hex characters
  controllerRuntimeEpochDigest

PowerControllerRuntimeIdentity
  sourceFiles: non-empty UTF-8 lexical sorted tuple[(repoRelativePath, fileSha256, byteLength), ...]
  controllerRuntimeSourceDigest
  executableSha256
  implementation
  version
  noForkNoExecNoDescriptorTransfer: true
  controllerRuntimeDigest

LinuxPowerControllerRuntimeStoreBootstrapIdentity
  osFamily: LINUX
  controllerHostBuild: LinuxRuntimeHostBuild
  controllerHostIdentity: LinuxRuntimeHostIdentity
  controllerStableVolumeIdentity: LinuxStableVolumeIdentity
  filesystemType
  productionLockDeviceId: UInt64String
  productionLockInode: UInt64String
  productionLockMountIdentity: PowerControllerRuntimeLockMountIdentity
  productionLockMountIdentity.osFamily: LINUX
  localityEvidence: PowerControllerRuntimeLockLocalityEvidence
  localityEvidence.osFamily: LINUX
  lockPrimitive: FLOCK_EX_NB
  bootstrapStoreIdentityDigest

DarwinPowerControllerRuntimeStoreBootstrapIdentity
  osFamily: DARWIN
  controllerHostBuild: DarwinRuntimeHostBuild
  controllerHostIdentity: DarwinRuntimeHostIdentity
  controllerStableVolumeIdentity: DarwinStableVolumeIdentity
  filesystemType
  productionLockDeviceId: UInt64String
  productionLockInode: UInt64String
  productionLockMountIdentity: PowerControllerRuntimeLockMountIdentity
  productionLockMountIdentity.osFamily: DARWIN
  localityEvidence: PowerControllerRuntimeLockLocalityEvidence
  localityEvidence.osFamily: DARWIN
  lockPrimitive: FLOCK_EX_NB
  bootstrapStoreIdentityDigest

PowerControllerRuntimeStoreBootstrapIdentity =
  LinuxPowerControllerRuntimeStoreBootstrapIdentity
  | DarwinPowerControllerRuntimeStoreBootstrapIdentity

Bootstrap store branch constraints:
  LINUX:
    controllerHostBuild.osFamily: LINUX
    controllerHostIdentity.osFamily: LINUX
    controllerHostIdentity.hostBuild: controllerHostBuild
    controllerStableVolumeIdentity.osFamily: LINUX
    productionLockMountIdentity.osFamily: LINUX
    productionLockMountIdentity.hostBuild: controllerHostBuild
    productionLockMountIdentity.hostIdentity: controllerHostIdentity
    productionLockMountIdentity.stableVolumeIdentityDigest:
      controllerStableVolumeIdentity.volumeIdentityDigest
    productionLockMountIdentity.deviceId: productionLockDeviceId
    localityEvidence.osFamily: LINUX
    localityEvidence.hostBuild: controllerHostBuild
    localityEvidence.hostIdentity: controllerHostIdentity
    localityEvidence.kernelProbe: LINUX_FSTATFS_MOUNTINFO_V1
    localityEvidence.filesystemType: filesystemType
    localityEvidence.productionLockDeviceId: productionLockDeviceId
    localityEvidence.productionLockInode: productionLockInode
    localityEvidence.productionLockMountIdentity: productionLockMountIdentity
  DARWIN:
    controllerHostBuild.osFamily: DARWIN
    controllerHostIdentity.osFamily: DARWIN
    controllerHostIdentity.hostBuild: controllerHostBuild
    controllerStableVolumeIdentity.osFamily: DARWIN
    productionLockMountIdentity.osFamily: DARWIN
    productionLockMountIdentity.hostBuild: controllerHostBuild
    productionLockMountIdentity.hostIdentity: controllerHostIdentity
    productionLockMountIdentity.stableVolumeIdentityDigest:
      controllerStableVolumeIdentity.volumeIdentityDigest
    productionLockMountIdentity.deviceId: productionLockDeviceId
    localityEvidence.osFamily: DARWIN
    localityEvidence.hostBuild: controllerHostBuild
    localityEvidence.hostIdentity: controllerHostIdentity
    localityEvidence.kernelProbe: DARWIN_FSTATFS_MNT_LOCAL_V1
    localityEvidence.filesystemType: filesystemType
    localityEvidence.productionLockDeviceId: productionLockDeviceId
    localityEvidence.productionLockInode: productionLockInode
    localityEvidence.productionLockMountIdentity: productionLockMountIdentity

PowerControllerRuntimeLockBackendIdentity
  osFamily: DARWIN | LINUX
  controllerHostBuild: RuntimeHostBuild
  controllerHostIdentity: RuntimeHostIdentity
  controllerStableVolumeIdentity: StableVolumeIdentity
  controllerStoreDurabilityProfile: PowerControllerStoreDurabilityProfile
  filesystemType
  localFilesystem: true
  networkFilesystem: false
  productionLockDeviceId: UInt64String
  productionLockInode: UInt64String
  productionLockMountIdentity: PowerControllerRuntimeLockMountIdentity
  localityEvidence: PowerControllerRuntimeLockLocalityEvidence
  lockPrimitive: FLOCK_EX_NB
  contentionEvidenceRef: DurabilityCapabilityArtifactRef
  contentionEvidenceDigest
  controllerRuntimeLockBackendDigest

LinuxPowerControllerStoreDurabilityProfile
  artifactKind: acceptance-power-controller-store-durability-profile
  schemaVersion: 1
  osFamily: LINUX
  backend: LINUX_FILE_AND_DIRECTORY_FSYNC_V1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  controllerIdentityDigest
  qualifiedControllerHostBuild: LinuxRuntimeHostBuild
  qualifiedControllerHostIdentity: LinuxRuntimeHostIdentity
  stableVolumeIdentity: LinuxStableVolumeIdentity
  filesystemImplementationVersion
  requiredMountOptions: UTF-8 lexical sorted tuple[string, ...]
  operationSequence: (WRITE_TEMP, SYNC_FILE, RENAME_FINAL, SYNC_DIRECTORY)
  darwinSyncAnchorIdentity: null
  qualificationEvidence: PowerControllerStoreDurabilityQualificationEvidence
  controllerStoreDurabilityProfileDigest

DarwinPowerControllerStoreDurabilityProfile
  artifactKind: acceptance-power-controller-store-durability-profile
  schemaVersion: 1
  osFamily: DARWIN
  backend: DARWIN_APFS_FULLFSYNC_V1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  controllerIdentityDigest
  qualifiedControllerHostBuild: DarwinRuntimeHostBuild
  qualifiedControllerHostIdentity: DarwinRuntimeHostIdentity
  stableVolumeIdentity: DarwinStableVolumeIdentity
  filesystemImplementationVersion
  requiredMountOptions: UTF-8 lexical sorted tuple[string, ...]
  operationSequence: (WRITE_TEMP, SYNC_FILE, RENAME_FINAL, SYNC_DIRECTORY, SYNC_ANCHOR)
  darwinSyncAnchorIdentity: DurabilitySyncAnchorIdentity
  qualificationEvidence: PowerControllerStoreDurabilityQualificationEvidence
  controllerStoreDurabilityProfileDigest

PowerControllerStoreDurabilityProfile =
  LinuxPowerControllerStoreDurabilityProfile
  | DarwinPowerControllerStoreDurabilityProfile

PowerControllerStoreDurabilityQualificationEvidence
  artifactKind: acceptance-power-controller-store-durability-qualification
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  qualificationId
  controllerIdentityDigest
  bootstrapCandidateDigest
  enrollmentAuthorizationDigest
  sourceCommit
  probeSourceFiles: non-empty UTF-8 lexical sorted tuple[(repoRelativePath, fileSha256, byteLength), ...]
  probeSourceDigest
  probeRuntimeDigest
  qualifiedEnvironment: DurabilityQualifiedEnvironment
  operationSequence: tuple[DurabilitySyncOperation, ...]
  darwinSyncAnchorIdentity: DurabilitySyncAnchorIdentity | null
  expectationRef: ControllerStoreDurabilityArtifactRef
  expectationDigest
  interruptionCases: non-empty tuple[ControllerStoreDurabilityCase, ...]
  result: SUPPORTED
  observedAt
  controllerStoreDurabilityQualificationDigest

ControllerStoreDurabilityArtifactRef
  artifactKind: acceptance-power-controller-store-durability-ref
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  qualificationId
  caseId: string | null
  controllerIdentityDigest
  qualifiedEnvironmentDigest
  artifactName: EXPECTATION | BEFORE_BOOT_OBSERVATION | AFTER_BOOT_OBSERVATION | INTERRUPTION_EVIDENCE | RECOVERY_EVIDENCE
  objectDigest
  contentSha256
  byteLength
  controllerStoreDurabilityArtifactRefDigest

ArtifactRef integrity:
  DurabilityCapabilityArtifactRef and ControllerStoreDurabilityArtifactRef
    first require byteLength == len(exact stored bytes)
    then require contentSha256 == raw SHA256(exact stored bytes)
    for every typed artifact, parse the one closed schema selected by artifactName,
      recompute that schema's domain-separated self digest, and require
      objectDigest == recomputed domain-object digest
    PROBE_RUNTIME_BLOB alone requires objectDigest == null; every other
      DurabilityCapabilityArtifactRef and every
      ControllerStoreDurabilityArtifactRef requires a non-null objectDigest
  raw byte integrity and parsed object integrity are distinct checks
  an unknown field, non-canonical encoding, wrong artifactName/schema pair,
    raw-hash mismatch or object-digest mismatch fails closed

ControllerStoreQualificationInterruptionEvidence
  interruptionKind: OPERATOR_PHYSICAL_POWER_CUT | EXTERNAL_VM_HARD_POWER_OFF
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  qualificationId
  caseId
  qualifiedEnvironmentDigest
  expectationDigest
  subjectControllerIdentityDigest
  operatorIdentity: AbortOperatorIdentity
  witnessIdentity: ControllerStoreQualificationWitnessIdentity
  ownerApprovalDocumentPath
  ownerApprovalDocumentSha256
  targetControllerHostBuild: RuntimeHostBuild
  targetControllerHostIdentity: RuntimeHostIdentity
  interruptionPoint
  beforeBootObservationDigest
  afterBootObservationDigest
  interruptedAt
  signatureAlgorithm: ECDSA_P256_SHA256_P1363_LOW_S
  signatureHex: exactly 128 lowercase hex characters
  qualificationInterruptionDigest

DarwinControllerStoreBootObservation
  artifactKind: acceptance-power-controller-store-boot-observation
  schemaVersion: 1
  osFamily: DARWIN
  observationPhase: BEFORE | AFTER
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  qualificationId
  caseId
  controllerIdentityDigest
  controllerHostIdentity: DarwinRuntimeHostIdentity
  qualifiedEnvironmentDigest
  bootSessionUuid
  bootTimeSeconds: UInt64String
  bootTimeMicroseconds: UInt64String
  observedAt
  controllerStoreBootObservationDigest

LinuxControllerStoreBootObservation
  artifactKind: acceptance-power-controller-store-boot-observation
  schemaVersion: 1
  osFamily: LINUX
  observationPhase: BEFORE | AFTER
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  qualificationId
  caseId
  controllerIdentityDigest
  controllerHostIdentity: LinuxRuntimeHostIdentity
  qualifiedEnvironmentDigest
  bootId
  bootTimeSeconds: UInt64String
  bootTimeNanoseconds: UInt64String
  observedAt
  controllerStoreBootObservationDigest

ControllerStoreBootObservation =
  DarwinControllerStoreBootObservation
  | LinuxControllerStoreBootObservation

ControllerStoreQualificationRecoveryEvidence
  artifactKind: acceptance-power-controller-store-recovery
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  qualificationId
  caseId
  controllerIdentityDigest
  qualifiedEnvironmentDigest
  expectationDigest
  witnessIdentityDigest
  witnessAuthorizationDigest
  interruptionPoint
  observedRecoveredState: ABSENT | OLD_BYTES | NEW_BYTES | OTHER
  observedContentSha256: string | null
  interruptionEvidenceRef: ControllerStoreDurabilityArtifactRef
  qualificationInterruptionDigest
  afterBootObservationRef: ControllerStoreDurabilityArtifactRef
  recoveredAt
  signatureAlgorithm: ECDSA_P256_SHA256_P1363_LOW_S
  signatureHex: exactly 128 lowercase hex characters
  controllerStoreRecoveryDigest

ControllerStoreDurabilityExpectationRecord
  artifactKind: acceptance-power-controller-store-expectation
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  qualificationId
  controllerIdentityDigest
  bootstrapCandidateDigest
  qualifiedEnvironmentDigest
  oldContentSha256
  newContentSha256
  cases: non-empty tuple[(caseId, interruptionPoint, expectedRecoveredState, expectedContentSha256), ...]
  committedAt
  controllerStoreExpectationDigest

ControllerStoreQualificationWitnessIdentity
  witnessRole: CONTROLLER_STORE_QUALIFICATION_ONLY
  witnessId
  witnessSignatureAlgorithm: ECDSA_P256_SHA256_P1363_LOW_S
  witnessPublicKeyHex: exactly 130 lowercase hex characters encoding one valid
    SEC1 uncompressed P-256 point with prefix 04
  witnessPublicKeySha256: exactly 64 lowercase hex characters
  subjectControllerIdentityDigest
  productionAuthorityEligible: false
  authorization: ControllerStoreQualificationWitnessAuthorization
  witnessAuthorizationDigest
  ownerApprovalDocumentPath
  ownerApprovalDocumentSha256
  witnessIdentityDigest

ControllerStoreQualificationWitnessAuthorization
  artifactKind: acceptance-power-controller-store-witness-authorization
  schemaVersion: 1
  action: AUTHORIZE_CONTROLLER_STORE_QUALIFICATION_WITNESS
  authorizationId
  operatorIdentity: AbortOperatorIdentity
  workspaceId
  gateId
  bootstrapCandidateDigest
  crashFixtureId
  qualificationRunId
  qualificationId
  subjectControllerIdentityDigest
  witnessId
  witnessSignatureAlgorithm: ECDSA_P256_SHA256_P1363_LOW_S
  witnessPublicKeyHex: exactly 130 lowercase hex characters encoding one valid
    SEC1 uncompressed P-256 point with prefix 04
  witnessPublicKeySha256: exactly 64 lowercase hex characters
  witnessScope: CONTROLLER_STORE_QUALIFICATION_ONLY
  productionAuthorityEligible: false
  ownerApprovalDocumentPath
  ownerApprovalDocumentSha256
  authoritySourceCommit
  expectedTargetAbsent: true
  authorizationPathId: CANDIDATE_WITNESS_AUTHORIZATION_V1
  authorizedAt
  witnessConfirmationChallengeDigest
  witnessAuthorizationDigest

ControllerStoreDurabilityCase
  caseId
  interruptionPoint: BEFORE_FILE_SYNC | AFTER_FILE_SYNC | AFTER_RENAME | AFTER_DIRECTORY_SYNC | AFTER_ANCHOR_SYNC
  expectedRecoveredState: ABSENT | OLD_BYTES | NEW_BYTES
  observedRecoveredState: ABSENT | OLD_BYTES | NEW_BYTES | OTHER
  expectedContentSha256: string | null
  observedContentSha256: string | null
  beforeBootObservationRef: ControllerStoreDurabilityArtifactRef
  beforeBootObservationRef.artifactName: BEFORE_BOOT_OBSERVATION
  afterBootObservationRef: ControllerStoreDurabilityArtifactRef
  afterBootObservationRef.artifactName: AFTER_BOOT_OBSERVATION
  interruptionEvidenceRef: ControllerStoreDurabilityArtifactRef
  recoveryEvidenceRef: ControllerStoreDurabilityArtifactRef
  result: PASS
  controllerStoreDurabilityCaseDigest

PowerControllerRuntimeLockLocalityEvidence
  osFamily: DARWIN | LINUX
  hostBuild: RuntimeHostBuild
  hostIdentity: RuntimeHostIdentity
  filesystemType
  productionLockDeviceId: UInt64String
  productionLockInode: UInt64String
  productionLockMountIdentity: PowerControllerRuntimeLockMountIdentity
  kernelProbe: LINUX_FSTATFS_MOUNTINFO_V1 | DARWIN_FSTATFS_MNT_LOCAL_V1
  localFilesystem: true
  networkFilesystem: false
  observedAt
  localityEvidenceDigest

PowerControllerRuntimeLockContentionEvidence
  artifactKind: acceptance-power-controller-runtime-lock-contention
  schemaVersion: 1
  controllerIdentityDigest
  hostBuild: RuntimeHostBuild
  hostIdentity: RuntimeHostIdentity
  filesystemType
  localFilesystem: true
  networkFilesystem: false
  productionLockMountIdentity: PowerControllerRuntimeLockMountIdentity
  lockDeviceId: UInt64String
  lockInode: UInt64String
  contenderProcessIdentities: exactly two distinct ProcessStartIdentity
  acquiredCount: 1
  blockedCount: 1
  observedAt
  contentionEvidenceDigest

PowerControllerRuntimeEpochRef
  controllerIdentityDigest
  controllerRuntimeEpochId
  controllerRuntimeEpochDigest
  controllerRuntimeEpochRefDigest

PowerControllerRuntimeCurrent
  artifactKind: acceptance-power-controller-runtime-current
  schemaVersion: 1
  runtimeLockIdentity: PowerControllerRuntimeEpochLeaseIdentity
  epochRef: PowerControllerRuntimeEpochRef
  currentRuntimeDigest

PowerControllerRuntimeEpochLeaseIdentity
  osFamily: DARWIN | LINUX
  controllerIdentityDigest
  controllerTrustDigest
  controllerRuntimeEpochId
  controllerPid
  controllerProcessStartIdentity: ProcessStartIdentity
  hostBuild: RuntimeHostBuild
  hostIdentity: RuntimeHostIdentity
  lockPathId: CONTROLLER_RUNTIME_LOCK_V1
  filesystemType
  productionLockMountIdentity: PowerControllerRuntimeLockMountIdentity
  lockDeviceId: UInt64String
  lockInode: UInt64String
  lockApi: FLOCK_EX_NB
  closeOnExec: true
  descriptorDuplicated: false
  descriptorInheritedByChild: false
  soleDescriptorOwnerPid: controllerPid
  leaseId
  epochLeaseIdentityDigest

Power controller epoch branch constraints:
  DARWIN:
    controllerProcessStartIdentity: DarwinProcessStartIdentity
    runtimeLockBackend.osFamily: DARWIN
    runtimeLockBackend.controllerHostBuild: DarwinRuntimeHostBuild
    runtimeLockBackend.controllerHostIdentity: DarwinRuntimeHostIdentity
    runtimeLockBackend.controllerStableVolumeIdentity: DarwinStableVolumeIdentity
    runtimeLockBackend.controllerStoreDurabilityProfile:
      DarwinPowerControllerStoreDurabilityProfile
    runtimeLockBackend.productionLockMountIdentity.osFamily: DARWIN
    runtimeLockBackend.localityEvidence.osFamily: DARWIN
    resolved runtimeLockBackend.contentionEvidenceRef payload
      contenderProcessIdentities: exactly two DarwinProcessStartIdentity
    runtimeLockIdentity.osFamily: DARWIN
    runtimeLockIdentity.controllerProcessStartIdentity:
      controllerProcessStartIdentity
    runtimeLockIdentity.hostBuild: runtimeLockBackend.controllerHostBuild
    controllerHostIdentity: runtimeLockBackend.controllerHostIdentity
    runtimeLockIdentity.hostIdentity: controllerHostIdentity
    runtimeLockIdentity.productionLockMountIdentity:
      runtimeLockBackend.productionLockMountIdentity
  LINUX:
    controllerProcessStartIdentity: LinuxProcessStartIdentity
    runtimeLockBackend.osFamily: LINUX
    runtimeLockBackend.controllerHostBuild: LinuxRuntimeHostBuild
    runtimeLockBackend.controllerHostIdentity: LinuxRuntimeHostIdentity
    runtimeLockBackend.controllerStableVolumeIdentity: LinuxStableVolumeIdentity
    runtimeLockBackend.controllerStoreDurabilityProfile:
      LinuxPowerControllerStoreDurabilityProfile
    runtimeLockBackend.productionLockMountIdentity.osFamily: LINUX
    runtimeLockBackend.localityEvidence.osFamily: LINUX
    resolved runtimeLockBackend.contentionEvidenceRef payload
      contenderProcessIdentities: exactly two LinuxProcessStartIdentity
    runtimeLockIdentity.osFamily: LINUX
    runtimeLockIdentity.controllerProcessStartIdentity:
      controllerProcessStartIdentity
    runtimeLockIdentity.hostBuild: runtimeLockBackend.controllerHostBuild
    controllerHostIdentity: runtimeLockBackend.controllerHostIdentity
    runtimeLockIdentity.hostIdentity: controllerHostIdentity
    runtimeLockIdentity.productionLockMountIdentity:
      runtimeLockBackend.productionLockMountIdentity
  both:
    runtimeLockBackend.localityEvidence.hostBuild:
      runtimeLockBackend.controllerHostBuild
    runtimeLockBackend.localityEvidence.hostIdentity:
      runtimeLockBackend.controllerHostIdentity
    resolved runtimeLockBackend.contentionEvidenceRef payload hostBuild:
      runtimeLockBackend.controllerHostBuild
    resolved runtimeLockBackend.contentionEvidenceRef payload hostIdentity:
      runtimeLockBackend.controllerHostIdentity
    runtimeLockBackend.controllerStoreDurabilityProfile.qualifiedControllerHostBuild:
      runtimeLockBackend.controllerHostBuild
    runtimeLockBackend.controllerStoreDurabilityProfile.qualifiedControllerHostIdentity:
      runtimeLockBackend.controllerHostIdentity
    runtimeLockIdentity.controllerIdentityDigest: controllerIdentityDigest
    runtimeLockIdentity.controllerTrustDigest: controllerTrustDigest
    runtimeLockIdentity.controllerRuntimeEpochId: controllerRuntimeEpochId
    runtimeLockIdentity.controllerPid: controllerPid

PowerControllerRuntimeLockMountIdentity
  osFamily: DARWIN | LINUX
  stableVolumeIdentityDigest
  mountNamespaceId: string | null
  mountId: UInt64String | null
  darwinFsid: string | null
  deviceId: UInt64String
  hostBuild: RuntimeHostBuild
  hostIdentity: RuntimeHostIdentity
  filesystemImplementationVersion
  mountOptions: UTF-8 lexical sorted tuple[string, ...]
  productionLockMountIdentityDigest

Power-controller lock mount branch constraints:
  DARWIN:
    mountNamespaceId: null
    mountId: null
    darwinFsid: non-empty
  LINUX:
    mountNamespaceId: non-empty
    mountId: UInt64String
    darwinFsid: null

PowerControllerReceipt
  artifactKind: acceptance-power-controller-receipt
  schemaVersion: 1
  commandId
  controllerRuntimeEpochId
  controllerRuntimeEpochDigest
  controllerIdentityDigest
  trustMode: BOOTSTRAP_CANDIDATE | ACTIVE_ANCHOR
  controllerTrustDigest
  selectedTrustGenerationRef: PowerControllerTrustGenerationRef | null
  selectedCurrentTrustDigest: string | null
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  caseId
  targetHostBuild: RuntimeHostBuild
  qualifiedEnvironmentDigest
  interruptionPoint
  executionStartDigest
  expectationDigest
  durableSequence
  beforeBootObservationDigest
  releaseTokenSha256: exactly 64 lowercase hex characters
  acceptedBeforeFirstMutation: true
  issuedAt
  signatureAlgorithm: ED25519
  signatureHex: exactly 128 lowercase hex characters
  controllerReceiptDigest

PowerControllerArmReceipt
  artifactKind: acceptance-power-controller-arm-receipt
  schemaVersion: 1
  commandId
  controllerRuntimeEpochId
  controllerRuntimeEpochDigest
  controllerReceiptDigest
  releaseTokenSha256: exactly 64 lowercase hex characters
  commandState: ARMED
  armedAt
  signatureAlgorithm: ED25519
  signatureHex: exactly 128 lowercase hex characters
  controllerArmReceiptDigest

PowerControllerExecutionReceipt
  artifactKind: acceptance-power-controller-execution-receipt
  schemaVersion: 1
  commandId
  controllerRuntimeEpochId
  controllerRuntimeEpochDigest
  controllerReceiptDigest
  controllerArmReceiptDigest
  releaseTokenSha256: exactly 64 lowercase hex characters
  controllerIdentityDigest
  trustMode: BOOTSTRAP_CANDIDATE | ACTIVE_ANCHOR
  controllerTrustDigest
  selectedTrustGenerationRef: PowerControllerTrustGenerationRef | null
  selectedCurrentTrustDigest: string | null
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  caseId
  executionStartDigest
  expectationDigest
  interruptionPoint
  executionResult: POWER_INTERRUPTED
  afterBootObservationDigest
  executedAt
  signatureAlgorithm: ED25519
  signatureHex: exactly 128 lowercase hex characters
  executionReceiptDigest

PowerControllerCommandJournalCommon
  artifactKind: acceptance-power-controller-command-journal
  schemaVersion: 1
  commandId
  controllerRuntimeEpochId
  controllerRuntimeEpochDigest
  commandLockIdentity: PowerControllerCommandJournalLockIdentity
  commandIdentityDigest
  controllerIdentityDigest
  trustMode: BOOTSTRAP_CANDIDATE | ACTIVE_ANCHOR
  controllerTrustDigest
  selectedTrustGenerationRef: PowerControllerTrustGenerationRef | null
  selectedCurrentTrustDigest: string | null
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  caseId
  expectationDigest
  executionStartDigest
  releaseTokenSha256: exactly 64 lowercase hex characters
  controllerReceiptDigest
  transitionedAt
  signatureAlgorithm: ED25519
  signatureHex: exactly 128 lowercase hex characters

AcceptedPowerControllerCommandJournalEntry
  common: PowerControllerCommandJournalCommon
  transitionSequence: 1
  commandState: ACCEPTED
  controllerArmReceiptDigest: null
  executionReceiptDigest: null
  previousJournalDigest: null
  expectedHeadDigest: null
  commandJournalDigest

ArmedPowerControllerCommandJournalEntry
  common: PowerControllerCommandJournalCommon
  transitionSequence: 2
  commandState: ARMED
  controllerArmReceiptDigest: string
  executionReceiptDigest: null
  previousJournalDigest: string
  expectedHeadDigest: string
  commandJournalDigest

ExecutionStartedPowerControllerCommandJournalEntry
  common: PowerControllerCommandJournalCommon
  transitionSequence: 3
  commandState: EXECUTION_STARTED
  controllerArmReceiptDigest: string
  executionReceiptDigest: null
  previousJournalDigest: string
  expectedHeadDigest: string
  commandJournalDigest

ActionDispatchedPowerControllerCommandJournalEntry
  common: PowerControllerCommandJournalCommon
  dispatchInvocationDigest
  transitionSequence: 4
  commandState: ACTION_DISPATCHED
  controllerArmReceiptDigest: string
  executionReceiptDigest: null
  previousJournalDigest: string
  expectedHeadDigest: string
  commandJournalDigest

ExecutedPowerControllerCommandJournalEntry
  common: PowerControllerCommandJournalCommon
  transitionSequence: 5
  commandState: EXECUTED
  controllerArmReceiptDigest: string
  executionReceiptDigest: string
  previousJournalDigest: string
  expectedHeadDigest: string
  commandJournalDigest

CancelledFromAcceptedPowerControllerCommandJournalEntry
  common: PowerControllerCommandJournalCommon
  transitionSequence: 2
  commandState: CANCELLED
  cancellationOrigin: ACCEPTED
  controllerArmReceiptDigest: null
  executionReceiptDigest: null
  previousJournalDigest: string
  expectedHeadDigest: string
  commandJournalDigest

CancelledFromArmedPowerControllerCommandJournalEntry
  common: PowerControllerCommandJournalCommon
  transitionSequence: 3
  commandState: CANCELLED
  cancellationOrigin: ARMED
  controllerArmReceiptDigest: string
  executionReceiptDigest: null
  previousJournalDigest: string
  expectedHeadDigest: string
  commandJournalDigest

PowerControllerCommandJournalEntry =
  AcceptedPowerControllerCommandJournalEntry
  | ArmedPowerControllerCommandJournalEntry
  | ExecutionStartedPowerControllerCommandJournalEntry
  | ActionDispatchedPowerControllerCommandJournalEntry
  | ExecutedPowerControllerCommandJournalEntry
  | CancelledFromAcceptedPowerControllerCommandJournalEntry
  | CancelledFromArmedPowerControllerCommandJournalEntry

PowerControllerCommandJournalHead
  artifactKind: acceptance-power-controller-command-journal-head
  schemaVersion: 1
  commandId
  controllerRuntimeEpochId
  controllerRuntimeEpochDigest
  commandLockIdentity: PowerControllerCommandJournalLockIdentity
  commandIdentityDigest
  transitionSequence: positive integer
  commandState: ACCEPTED | ARMED | EXECUTION_STARTED | ACTION_DISPATCHED | EXECUTED | CANCELLED
  commandJournalDigest
  commandJournalHeadDigest

PowerControllerCommandJournalLockIdentity
  controllerIdentityDigest
  controllerRuntimeEpochId
  controllerRuntimeEpochDigest
  epochLeaseIdentity: PowerControllerRuntimeEpochLeaseIdentity
  commandId
  lockPathId: COMMAND_JOURNAL_LOCK_V1
  commandJournalLockIdentityDigest

Command journal branch constraints:
  All branches:
    commandIdentityDigest: domain digest of
      {commandId,controllerRuntimeEpochId,controllerRuntimeEpochDigest,
       controllerIdentityDigest,controllerTrustDigest,workspaceId,
       gateId,crashFixtureId,qualificationRunId,caseId,expectationDigest,
       executionStartDigest,releaseTokenSha256,controllerReceiptDigest}
    immutable fields: byte-equal to ACCEPTED entry
  ACCEPTED:
    type: AcceptedPowerControllerCommandJournalEntry
    transitionSequence: 1
    previousJournalDigest: null
    expectedHeadDigest: null
    controllerArmReceiptDigest: null
    executionReceiptDigest: null
  ARMED:
    type: ArmedPowerControllerCommandJournalEntry
    transitionSequence: 2
    previousJournalDigest: ACCEPTED commandJournalDigest
    expectedHeadDigest: ACCEPTED commandJournalHeadDigest
    controllerArmReceiptDigest: non-null
    executionReceiptDigest: null
  EXECUTION_STARTED:
    type: ExecutionStartedPowerControllerCommandJournalEntry
    transitionSequence: 3
    previousJournalDigest: ARMED commandJournalDigest
    expectedHeadDigest: ARMED commandJournalHeadDigest
    controllerArmReceiptDigest: same non-null digest
    executionReceiptDigest: null
  ACTION_DISPATCHED:
    type: ActionDispatchedPowerControllerCommandJournalEntry
    transitionSequence: 4
    previousJournalDigest: EXECUTION_STARTED commandJournalDigest
    expectedHeadDigest: EXECUTION_STARTED commandJournalHeadDigest
    controllerArmReceiptDigest: same non-null digest
    executionReceiptDigest: null
  EXECUTED:
    type: ExecutedPowerControllerCommandJournalEntry
    transitionSequence: 5
    previousJournalDigest: ACTION_DISPATCHED commandJournalDigest
    expectedHeadDigest: ACTION_DISPATCHED commandJournalHeadDigest
    controllerArmReceiptDigest: same non-null digest
    executionReceiptDigest: non-null
  CANCELLED_FROM_ACCEPTED:
    type: CancelledFromAcceptedPowerControllerCommandJournalEntry
    commandState: CANCELLED
    transitionSequence: 2
    previousJournalDigest: ACCEPTED commandJournalDigest
    expectedHeadDigest: ACCEPTED commandJournalHeadDigest
    controllerArmReceiptDigest: null
    executionReceiptDigest: null
  CANCELLED_FROM_ARMED:
    type: CancelledFromArmedPowerControllerCommandJournalEntry
    commandState: CANCELLED
    transitionSequence: 3
    previousJournalDigest: ARMED commandJournalDigest
    expectedHeadDigest: ARMED commandJournalHeadDigest
    controllerArmReceiptDigest: same non-null digest
    executionReceiptDigest: null

InitialCommandTransitionRequest
  commandId
  requestedOperation: INITIAL_TRANSITION
  currentEpochRef: PowerControllerRuntimeEpochRef
  expectedCommandIdentityDigest
  expectedHeadAbsent: true
  resolutionRequestDigest

ExistingCommandTransitionRequest
  commandId
  requestedOperation: TRANSITION
  currentEpochRef: PowerControllerRuntimeEpochRef
  expectedCommandIdentityDigest
  expectedHeadDigest
  targetState: ARMED | EXECUTION_STARTED | EXECUTED | CANCELLED
  resolutionRequestDigest

RetryCommandResponseRequest
  commandId
  requestedOperation: RETRY_RESPONSE
  currentEpochRef: PowerControllerRuntimeEpochRef
  expectedCommandIdentityDigest
  resolutionRequestDigest

ExecutePowerActionRequest
  commandId
  requestedOperation: EXECUTE_POWER_ACTION
  currentEpochRef: PowerControllerRuntimeEpochRef
  expectedCommandIdentityDigest
  expectedHeadDigest
  resolutionRequestDigest

LookupCommandRequest
  commandId
  requestedOperation: LOOKUP
  currentEpochRef: PowerControllerRuntimeEpochRef
  expectedCommandIdentityDigest
  resolutionRequestDigest

PowerControllerCommandResolutionRequest =
  InitialCommandTransitionRequest
  | ExistingCommandTransitionRequest
  | RetryCommandResponseRequest
  | ExecutePowerActionRequest
  | LookupCommandRequest

InitialCurrentEpochCommandResolution
  mode: CURRENT_EPOCH_INITIAL_TRANSITION
  requestedOperation: INITIAL_TRANSITION
  requestDigest
  commandIdentityDigest
  currentEpochRef: PowerControllerRuntimeEpochRef
  liveEpochLeaseIdentity: PowerControllerRuntimeEpochLeaseIdentity
  journalHead: null
  transitionAllowed: true
  externalActionAllowed: false
  commandResolutionDigest

ExistingCurrentEpochCommandResolution
  mode: CURRENT_EPOCH_TRANSITION
  requestedOperation: TRANSITION
  requestDigest
  commandIdentityDigest
  currentEpochRef: PowerControllerRuntimeEpochRef
  liveEpochLeaseIdentity: PowerControllerRuntimeEpochLeaseIdentity
  journalHead: PowerControllerCommandJournalHead
  targetState: ARMED | EXECUTION_STARTED | EXECUTED | CANCELLED
  transitionAllowed: true
  externalActionAllowed: false
  commandResolutionDigest

CurrentEpochPowerActionResolution
  mode: CURRENT_EPOCH_POWER_ACTION
  requestedOperation: EXECUTE_POWER_ACTION
  dispatchInvocationDigest
  requestDigest
  commandIdentityDigest
  currentEpochRef: PowerControllerRuntimeEpochRef
  liveEpochLeaseIdentity: PowerControllerRuntimeEpochLeaseIdentity
  preDispatchJournalHead: PowerControllerCommandJournalHead
  preDispatchJournalHead.commandState: EXECUTION_STARTED
  dispatchJournalHead: PowerControllerCommandJournalHead
  dispatchJournalHead.commandState: ACTION_DISPATCHED
  transitionAllowed: true
  externalActionAllowed: false
  externalActionDispatchedInline: true
  commandResolutionDigest

CurrentEpochMissingHeadRejection
  mode: CURRENT_EPOCH_MISSING_HEAD_REJECTED
  requestedOperation: TRANSITION | RETRY_RESPONSE | EXECUTE_POWER_ACTION | LOOKUP
  requestDigest
  expectedCommandIdentityDigest
  currentEpochRef: PowerControllerRuntimeEpochRef
  liveEpochLeaseIdentity: PowerControllerRuntimeEpochLeaseIdentity
  journalHead: null
  transitionAllowed: false
  externalActionAllowed: false
  failureCode: CURRENT_COMMAND_HEAD_REQUIRED
  commandResolutionDigest

CurrentEpochUnexpectedHeadRejection
  mode: CURRENT_EPOCH_UNEXPECTED_HEAD_REJECTED
  requestedOperation: INITIAL_TRANSITION
  requestDigest
  expectedCommandIdentityDigest
  observedCommandIdentityDigest
  currentEpochRef: PowerControllerRuntimeEpochRef
  liveEpochLeaseIdentity: PowerControllerRuntimeEpochLeaseIdentity
  journalHead: PowerControllerCommandJournalHead
  transitionAllowed: false
  externalActionAllowed: false
  failureCode: CURRENT_COMMAND_HEAD_MUST_BE_ABSENT
  commandResolutionDigest

CurrentEpochIdentityMismatchRejection
  mode: CURRENT_EPOCH_IDENTITY_MISMATCH_REJECTED
  requestedOperation: INITIAL_TRANSITION | TRANSITION | RETRY_RESPONSE | EXECUTE_POWER_ACTION | LOOKUP
  requestDigest
  expectedCommandIdentityDigest
  observedCommandIdentityDigest
  currentEpochRef: PowerControllerRuntimeEpochRef
  liveEpochLeaseIdentity: PowerControllerRuntimeEpochLeaseIdentity
  journalHead: PowerControllerCommandJournalHead
  transitionAllowed: false
  externalActionAllowed: false
  failureCode: CURRENT_COMMAND_IDENTITY_MISMATCH
  commandResolutionDigest

CurrentEpochStaleHeadRejection
  mode: CURRENT_EPOCH_STALE_HEAD_REJECTED
  requestedOperation: TRANSITION | EXECUTE_POWER_ACTION
  requestDigest
  expectedCommandIdentityDigest
  observedCommandIdentityDigest
  expectedHeadDigest
  currentEpochRef: PowerControllerRuntimeEpochRef
  liveEpochLeaseIdentity: PowerControllerRuntimeEpochLeaseIdentity
  journalHead: PowerControllerCommandJournalHead
  transitionAllowed: false
  externalActionAllowed: false
  failureCode: CURRENT_COMMAND_HEAD_STALE
  commandResolutionDigest

CurrentEpochInvalidTransitionRejection
  mode: CURRENT_EPOCH_TRANSITION_REJECTED
  requestedOperation: TRANSITION
  requestDigest
  expectedCommandIdentityDigest
  observedCommandIdentityDigest
  expectedHeadDigest
  targetState: ARMED | EXECUTION_STARTED | EXECUTED | CANCELLED
  currentEpochRef: PowerControllerRuntimeEpochRef
  liveEpochLeaseIdentity: PowerControllerRuntimeEpochLeaseIdentity
  journalHead: PowerControllerCommandJournalHead
  transitionAllowed: false
  externalActionAllowed: false
  failureCode: CURRENT_COMMAND_TRANSITION_INVALID
  commandResolutionDigest

CurrentEpochPowerActionIneligibleRejection
  mode: CURRENT_EPOCH_POWER_ACTION_REJECTED
  requestedOperation: EXECUTE_POWER_ACTION
  requestDigest
  expectedCommandIdentityDigest
  observedCommandIdentityDigest
  expectedHeadDigest
  currentEpochRef: PowerControllerRuntimeEpochRef
  liveEpochLeaseIdentity: PowerControllerRuntimeEpochLeaseIdentity
  journalHead: PowerControllerCommandJournalHead
  transitionAllowed: false
  externalActionAllowed: false
  failureCode: CURRENT_POWER_ACTION_INELIGIBLE
  commandResolutionDigest

CurrentEpochPowerActionAlreadyDispatchedRejection
  mode: CURRENT_EPOCH_POWER_ACTION_ALREADY_DISPATCHED
  requestedOperation: EXECUTE_POWER_ACTION
  requestDigest
  expectedCommandIdentityDigest
  observedCommandIdentityDigest
  expectedHeadDigest
  currentEpochRef: PowerControllerRuntimeEpochRef
  liveEpochLeaseIdentity: PowerControllerRuntimeEpochLeaseIdentity
  dispatchJournalHead: PowerControllerCommandJournalHead
  dispatchJournalHead.commandState: ACTION_DISPATCHED
  dispatchJournalEntry: ActionDispatchedPowerControllerCommandJournalEntry
  dispatchJournalEntry.expectedHeadDigest: expectedHeadDigest
  transitionAllowed: false
  externalActionAllowed: false
  failureCode: CURRENT_POWER_ACTION_ALREADY_DISPATCHED_OR_UNCERTAIN
  commandResolutionDigest

PowerActionInvocationCapability  # process-local, never serialized
  controllerPid
  controllerProcessStartIdentity: ProcessStartIdentity
  controllerRuntimeEpochId
  commandId
  resolutionRequestDigest
  expectedHeadDigest
  commandLockIdentityDigest
  randomCapabilityBytes: exactly 32 secret process-memory bytes
  dispatchInvocationDigest

TrustDispatchLease  # process-local, never serialized
  workspaceId
  gateId
  selectedTrustGenerationRef: PowerControllerTrustGenerationRef
  selectedCurrentTrustDigest
  controllerRuntimeEpochId
  controllerRuntimeEpochDigest
  commandId
  commandIdentityDigest
  resolutionRequestDigest
  expectedHeadDigest
  commandLockIdentityDigest
  holderPid: positive integer
  holderProcessStartIdentity: ProcessStartIdentity
  publishLockIdentity: GatePublishLockIdentity
  lockMode: SHARED
  lockHeld: true
  randomLeaseBytesHex: exactly 64 lowercase hex characters encoding 32 secret
    process-memory bytes
  trustDispatchLeaseDigest

Trust dispatch lease constraints:
  selectedTrustGenerationRef: byte-equal to resolved ACTIVE current generationRef
  selectedCurrentTrustDigest: equal to resolved current currentTrustDigest
  controllerRuntimeEpochId/controllerRuntimeEpochDigest:
    equal to the live epoch and every command/receipt/journal copy
  commandId/commandIdentityDigest/resolutionRequestDigest/expectedHeadDigest:
    equal to the one EXECUTE_POWER_ACTION request and current
      EXECUTION_STARTED command head
  commandLockIdentityDigest:
    equal to the command lock acquired after this lease
  workspaceId/gateId:
    equal to the resolved current selector, generation ref, epoch and command
  holderPid/holderProcessStartIdentity:
    equal to the in-process controller call holding the lease
  publishLockIdentity:
    equal to the fstat-verified Gate publish lock held in SHARED mode by
      trust_admission.py
  acquisition order: Gate publish lock before controller command lock
  release: only after actuator returns or the operation exits without dispatch
  serialization, transfer, duplication, persistence and use by any other
    command/request/head: forbidden

CurrentEpochCommandRejection =
  CurrentEpochMissingHeadRejection
  | CurrentEpochUnexpectedHeadRejection
  | CurrentEpochIdentityMismatchRejection
  | CurrentEpochStaleHeadRejection
  | CurrentEpochInvalidTransitionRejection
  | CurrentEpochPowerActionIneligibleRejection
  | CurrentEpochPowerActionAlreadyDispatchedRejection

CurrentEpochRetryResolution
  mode: CURRENT_EPOCH_RETRY_RESPONSE
  requestedOperation: RETRY_RESPONSE
  requestDigest
  commandIdentityDigest
  currentEpochRef: PowerControllerRuntimeEpochRef
  liveEpochLeaseIdentity: PowerControllerRuntimeEpochLeaseIdentity
  journalHead: PowerControllerCommandJournalHead
  transitionAllowed: false
  externalActionAllowed: false
  commandResolutionDigest

CurrentEpochLookupResolution
  mode: CURRENT_EPOCH_LOOKUP
  requestedOperation: LOOKUP
  requestDigest
  commandIdentityDigest
  currentEpochRef: PowerControllerRuntimeEpochRef
  journalHead: PowerControllerCommandJournalHead
  transitionAllowed: false
  externalActionAllowed: false
  commandResolutionDigest

PriorTerminalCommandResolution
  mode: PRIOR_TERMINAL_LOOKUP
  requestedOperation: LOOKUP | RETRY_RESPONSE
  requestDigest
  commandIdentityDigest
  historicalEpochRef: PowerControllerRuntimeEpochRef
  terminalJournalHead: PowerControllerCommandJournalHead
  receiptRefs: non-empty tuple[DurabilityCapabilityArtifactRef, ...]
  transitionAllowed: false
  externalActionAllowed: false
  commandResolutionDigest

PriorEpochMutationWithHeadRejection
  mode: PRIOR_EPOCH_MUTATION_REJECTED
  requestedOperation: INITIAL_TRANSITION | TRANSITION | EXECUTE_POWER_ACTION
  requestDigest
  commandIdentityDigest
  historicalEpochRef: PowerControllerRuntimeEpochRef
  journalHead: PowerControllerCommandJournalHead
  transitionAllowed: false
  externalActionAllowed: false
  failureCode: PRIOR_CONTROLLER_EPOCH_MUTATION_FORBIDDEN
  commandResolutionDigest

PriorEpochMutationMissingHeadRejection
  mode: PRIOR_EPOCH_MUTATION_MISSING_HEAD_REJECTED
  requestedOperation: INITIAL_TRANSITION | TRANSITION | EXECUTE_POWER_ACTION
  requestDigest
  expectedCommandIdentityDigest
  historicalEpochRef: PowerControllerRuntimeEpochRef
  journalHead: null
  transitionAllowed: false
  externalActionAllowed: false
  failureCode: PRIOR_CONTROLLER_EPOCH_MUTATION_FORBIDDEN
  commandResolutionDigest

PriorEpochMutationRejection =
  PriorEpochMutationWithHeadRejection
  | PriorEpochMutationMissingHeadRejection

PriorNonterminalCommandRejection
  mode: PRIOR_NONTERMINAL_REJECTED
  requestedOperation: TRANSITION | RETRY_RESPONSE | LOOKUP
  requestDigest
  commandIdentityDigest
  historicalEpochRef: PowerControllerRuntimeEpochRef
  journalHead: PowerControllerCommandJournalHead
  transitionAllowed: false
  externalActionAllowed: false
  failureCode: PRIOR_CONTROLLER_EPOCH_NONTERMINAL
  commandResolutionDigest

PriorEpochIdentityMismatchRejection
  mode: PRIOR_EPOCH_IDENTITY_MISMATCH_REJECTED
  requestedOperation: INITIAL_TRANSITION | TRANSITION | RETRY_RESPONSE | EXECUTE_POWER_ACTION | LOOKUP
  requestDigest
  expectedCommandIdentityDigest
  observedCommandIdentityDigest
  historicalEpochRef: PowerControllerRuntimeEpochRef
  journalHead: PowerControllerCommandJournalHead
  transitionAllowed: false
  externalActionAllowed: false
  failureCode: PRIOR_CONTROLLER_EPOCH_COMMAND_IDENTITY_MISMATCH
  commandResolutionDigest

PriorEpochMissingHeadRejection
  mode: PRIOR_EPOCH_MISSING_HEAD_REJECTED
  requestedOperation: RETRY_RESPONSE | LOOKUP
  requestDigest
  expectedCommandIdentityDigest
  historicalEpochRef: PowerControllerRuntimeEpochRef
  journalHead: null
  transitionAllowed: false
  externalActionAllowed: false
  failureCode: PRIOR_CONTROLLER_EPOCH_COMMAND_NOT_FOUND
  commandResolutionDigest

PowerControllerCommandResolution =
  InitialCurrentEpochCommandResolution
  | ExistingCurrentEpochCommandResolution
  | CurrentEpochPowerActionResolution
  | CurrentEpochCommandRejection
  | CurrentEpochRetryResolution
  | CurrentEpochLookupResolution
  | PriorTerminalCommandResolution
  | PriorEpochMutationRejection
  | PriorNonterminalCommandRejection
  | PriorEpochIdentityMismatchRejection
  | PriorEpochMissingHeadRejection

PowerControllerTrustEnrollmentAuthorization
  artifactKind: acceptance-power-controller-trust-enrollment-authorization
  schemaVersion: 1
  action: CREATE_BOOTSTRAP_CANDIDATE | PROMOTE_ACTIVE_ANCHOR |
    ROTATE_ACTIVE_ANCHOR | REVOKE_ACTIVE_ANCHOR
  authorizationId
  operatorIdentity: AbortOperatorIdentity
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  controllerIdentity: PhysicalPowerControllerIdentity | VmPowerControllerIdentity
  controllerSignatureAlgorithm: ED25519
  controllerPublicKeyHex: exactly 64 lowercase hex characters
  controllerPublicKeySha256: exactly 64 lowercase hex characters
  ownerApprovalDocumentPath
  ownerApprovalDocumentSha256
  authoritySourceCommit
  expectedBootstrapCandidateDigest: string | null
  qualificationManifestDigest: string | null
  qualifiedBackendIdentityDigest: string | null
  targetTrustGeneration: positive integer | null
  expectedCurrentTrustDigest: string | null
  expectedCurrentState: ABSENT | ACTIVE | REVOKED
  expectedTrustAnchorDigest: string | null
  revocationReasonCode: KEY_COMPROMISE | CONTROLLER_RETIRED |
    ENVIRONMENT_DRIFT | null
  authorizedAt
  confirmationChallengeDigest
  authorizationDigest

PowerControllerBootstrapTrustCandidate
  artifactKind: acceptance-power-controller-bootstrap-trust-candidate
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  controllerIdentity: PhysicalPowerControllerIdentity | VmPowerControllerIdentity
  controllerSignatureAlgorithm: ED25519
  controllerPublicKeyHex: exactly 64 lowercase hex characters
  controllerPublicKeySha256: exactly 64 lowercase hex characters
  controllerRuntime: PowerControllerRuntimeIdentity
  controllerRuntimeStoreBootstrapIdentity: PowerControllerRuntimeStoreBootstrapIdentity
  bootstrapWriteProtocol: OS_STRONGEST_AVAILABLE_SYNC_V1
  ownerApprovalDocumentPath
  ownerApprovalDocumentSha256
  sourceCommit
  createdAt
  enrollmentAuthorization: PowerControllerTrustEnrollmentAuthorization
  bootstrapCandidateDigest

PowerControllerBootstrapCandidateConsumption
  artifactKind: acceptance-power-controller-bootstrap-candidate-consumption
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  bootstrapCandidateDigest
  promotionAuthorizationId
  promotionAuthorizationDigest
  promotionIntentRef: PowerControllerTrustPromotionIntentRef
  promotionIntentDigest
  qualifiedBackendIdentityDigest
  candidateTrustAnchorDigest
  candidateTrustGenerationDigest
  candidateCurrentTrustDigest
  qualificationManifestDigest
  consumedAt
  consumptionDigest

PowerControllerTrustPromotionIntent
  artifactKind: acceptance-power-controller-trust-promotion-intent
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  bootstrapCandidateDigest
  qualificationManifestDigest
  qualifiedBackendIdentityDigest
  targetTrustGeneration: positive integer
  predecessorGenerationRef: PowerControllerTrustGenerationRef | null
  promotionAuthorization: PowerControllerTrustEnrollmentAuthorization
  candidateTrustAnchor: PowerControllerTrustAnchor
  candidateGeneration: ActivePowerControllerTrustGeneration
  candidateCurrent: PowerControllerTrustCurrent
  createdAt
  promotionIntentDigest

PowerControllerTrustPromotionIntentRef
  workspaceId
  gateId
  promotionAuthorizationId
  promotionIntentDigest
  promotionIntentRefDigest

PowerControllerTrustTransitionReservation
  artifactKind: acceptance-power-controller-trust-transition-reservation
  schemaVersion: 1
  workspaceId
  gateId
  predecessorKey: ABSENT | expected currentTrustDigest
  expectedCurrentTrustDigest: string | null
  targetTrustGeneration: positive integer
  transitionKind: PROMOTE | ROTATE | REVOKE
  authorizationDigest
  transitionIntent: PowerControllerTrustPromotionIntent |
    PowerControllerTrustRevocationIntent
  transitionIntentDigest
  createdAt
  transitionReservationDigest

PowerControllerTrustAnchor
  artifactKind: acceptance-power-controller-trust-anchor
  schemaVersion: 1
  workspaceId
  gateId
  trustGeneration: positive integer
  predecessorGenerationRef: PowerControllerTrustGenerationRef | null
  controllerIdentity: PhysicalPowerControllerIdentity | VmPowerControllerIdentity
  controllerSignatureAlgorithm: ED25519
  controllerPublicKeyHex: exactly 64 lowercase hex characters
  controllerPublicKeySha256: exactly 64 lowercase hex characters
  controllerRuntime: PowerControllerRuntimeIdentity
  controllerRuntimeLockBackend: PowerControllerRuntimeLockBackendIdentity
  bootstrapCandidateDigest
  qualificationManifestDigest
  qualifiedBackendIdentityDigest
  ownerApprovalDocumentPath
  ownerApprovalDocumentSha256
  sourceCommit
  enrolledAt
  enrollmentAuthorization: PowerControllerTrustEnrollmentAuthorization
  trustAnchorDigest

ActivePowerControllerTrustGeneration
  artifactKind: acceptance-power-controller-trust-generation
  schemaVersion: 1
  state: ACTIVE
  workspaceId
  gateId
  trustGeneration: positive integer
  predecessorGenerationRef: PowerControllerTrustGenerationRef | null
  trustAnchorDigest
  trustGenerationDigest

PowerControllerTrustRevocation
  artifactKind: acceptance-power-controller-trust-revocation
  schemaVersion: 1
  workspaceId
  gateId
  trustGeneration: positive integer
  predecessorGenerationRef: PowerControllerTrustGenerationRef
  revokedTrustAnchorDigest
  reasonCode: KEY_COMPROMISE | CONTROLLER_RETIRED | ENVIRONMENT_DRIFT
  authorization: PowerControllerTrustEnrollmentAuthorization
  revokedAt
  revocationDigest

PowerControllerTrustRevocationIntent
  artifactKind: acceptance-power-controller-trust-revocation-intent
  schemaVersion: 1
  workspaceId
  gateId
  targetTrustGeneration: positive integer
  predecessorGenerationRef: PowerControllerTrustGenerationRef
  revocationAuthorization: PowerControllerTrustEnrollmentAuthorization
  candidateRevocation: PowerControllerTrustRevocation
  candidateGeneration: RevokedPowerControllerTrustGeneration
  candidateCurrent: PowerControllerTrustCurrent
  createdAt
  revocationIntentDigest

RevokedPowerControllerTrustGeneration
  artifactKind: acceptance-power-controller-trust-generation
  schemaVersion: 1
  state: REVOKED
  workspaceId
  gateId
  trustGeneration: positive integer
  predecessorGenerationRef: PowerControllerTrustGenerationRef
  revocationRef: PowerControllerTrustRevocationRef
  revocationDigest
  trustGenerationDigest

PowerControllerTrustGeneration =
  ActivePowerControllerTrustGeneration
  | RevokedPowerControllerTrustGeneration

PowerControllerTrustGenerationRef
  artifactKind: acceptance-power-controller-trust-generation-ref
  schemaVersion: 1
  workspaceId
  gateId
  trustGeneration: positive integer
  trustGenerationDigest
  trustGenerationRefDigest

PowerControllerTrustCurrent
  artifactKind: acceptance-power-controller-trust-current
  schemaVersion: 1
  workspaceId
  gateId
  generationRef: PowerControllerTrustGenerationRef
  currentTrustDigest

PowerControllerTrustRevocationRef
  artifactKind: acceptance-power-controller-trust-revocation-ref
  schemaVersion: 1
  workspaceId
  gateId
  trustGeneration: positive integer
  revocationDigest
  revocationRefDigest

Trust enrollment branch constraints:
  CREATE_BOOTSTRAP_CANDIDATE:
    targetTrustGeneration: null
    expectedCurrentState: ABSENT | ACTIVE | REVOKED
    expectedCurrentTrustDigest: null iff expectedCurrentState == ABSENT
    expectedBootstrapCandidateDigest: null
    qualificationManifestDigest: null
    qualifiedBackendIdentityDigest: null
    expectedTrustAnchorDigest: null
    revocationReasonCode: null
  PROMOTE_ACTIVE_ANCHOR:
    targetTrustGeneration: 1
    expectedCurrentState: ABSENT
    expectedCurrentTrustDigest: null
    expectedBootstrapCandidateDigest: non-null
    qualificationManifestDigest: non-null
    qualifiedBackendIdentityDigest: non-null
    expectedTrustAnchorDigest: null
    revocationReasonCode: null
  ROTATE_ACTIVE_ANCHOR:
    targetTrustGeneration: resolved current generation trustGeneration + 1
    expectedCurrentState: ACTIVE | REVOKED
    expectedCurrentTrustDigest: resolved current currentTrustDigest
    expectedBootstrapCandidateDigest: non-null
    qualificationManifestDigest: non-null
    qualifiedBackendIdentityDigest: non-null
    expectedTrustAnchorDigest: null
    revocationReasonCode: null
  REVOKE_ACTIVE_ANCHOR:
    targetTrustGeneration: resolved current generation trustGeneration + 1
    expectedCurrentState: ACTIVE
    expectedCurrentTrustDigest: resolved current currentTrustDigest
    expectedBootstrapCandidateDigest: null
    qualificationManifestDigest: null
    qualifiedBackendIdentityDigest: null
    expectedTrustAnchorDigest: resolved ACTIVE current generation trustAnchorDigest
    revocationReasonCode: KEY_COMPROMISE | CONTROLLER_RETIRED |
      ENVIRONMENT_DRIFT

Trust generation equality:
  initial promotion:
    reservation.predecessorKey == ABSENT
    reservation.expectedCurrentTrustDigest == null
    reservation.transitionKind == PROMOTE
    reservation.transitionIntent == intent
    authorization.targetTrustGeneration == intent.targetTrustGeneration ==
      anchor.trustGeneration == candidateGeneration.trustGeneration ==
      candidateCurrent.generationRef.trustGeneration == 1
    intent.predecessorGenerationRef == anchor.predecessorGenerationRef ==
      candidateGeneration.predecessorGenerationRef == null
  rotation:
    reservation.predecessorKey == authorization.expectedCurrentTrustDigest
    reservation.expectedCurrentTrustDigest ==
      authorization.expectedCurrentTrustDigest
    reservation.transitionKind == ROTATE
    reservation.transitionIntent == intent
    authorization.expectedCurrentTrustDigest == resolved current.currentTrustDigest
    intent.predecessorGenerationRef == anchor.predecessorGenerationRef ==
      candidateGeneration.predecessorGenerationRef ==
      resolved current.generationRef
    authorization.targetTrustGeneration == intent.targetTrustGeneration ==
      anchor.trustGeneration == candidateGeneration.trustGeneration ==
      candidateCurrent.generationRef.trustGeneration ==
      resolved predecessor generation.trustGeneration + 1
  promotion or rotation:
    candidateGeneration.trustAnchorDigest == anchor.trustAnchorDigest ==
      consumption.candidateTrustAnchorDigest
    candidateGeneration.trustGenerationDigest ==
      consumption.candidateTrustGenerationDigest ==
      candidateCurrent.generationRef.trustGenerationDigest
    candidateCurrent.generationRef resolves the exact candidateGeneration
    candidateCurrent.currentTrustDigest ==
      consumption.candidateCurrentTrustDigest
  revocation:
    reservation.predecessorKey == authorization.expectedCurrentTrustDigest
    reservation.expectedCurrentTrustDigest ==
      authorization.expectedCurrentTrustDigest
    reservation.transitionKind == REVOKE
    reservation.transitionIntent == revocationIntent
    authorization.expectedCurrentTrustDigest == resolved current.currentTrustDigest
    revocationIntent.predecessorGenerationRef ==
      revocation.predecessorGenerationRef == revokedGeneration.predecessorGenerationRef ==
      resolved current.generationRef
    authorization.targetTrustGeneration == revocationIntent.targetTrustGeneration ==
      revocation.trustGeneration ==
      revokedGeneration.trustGeneration == candidateCurrent.generationRef.trustGeneration ==
      resolved predecessor generation.trustGeneration + 1
    authorization.expectedTrustAnchorDigest ==
      revocation.revokedTrustAnchorDigest ==
      resolved ACTIVE predecessor generation.trustAnchorDigest
    authorization.controllerIdentity/controllerSignatureAlgorithm/
      controllerPublicKeyHex/controllerPublicKeySha256 ==
      resolved predecessor anchor corresponding fields
    authorization.crashFixtureId/qualificationRunId ==
      resolved predecessor anchor bootstrap candidate corresponding fields
    authorization.ownerApprovalDocumentPath/ownerApprovalDocumentSha256/
      authoritySourceCommit ==
      resolved predecessor anchor ownerApprovalDocumentPath/
      ownerApprovalDocumentSha256/sourceCommit
    authorization.revocationReasonCode == revocation.reasonCode
    revocationIntent.revocationAuthorization == authorization
    revocationIntent.candidateRevocation == revocation
    revocationIntent.candidateGeneration == revokedGeneration
    revocationIntent.candidateCurrent == candidateCurrent
    revokedGeneration.revocationDigest == revocation.revocationDigest
    revokedGeneration.revocationRef resolves the exact revocation
    candidateCurrent.generationRef resolves the exact revokedGeneration
  all transitions:
    reservation.workspaceId/gateId: authorization.workspaceId/gateId
    reservation.authorizationDigest: authorization.authorizationDigest
    reservation.targetTrustGeneration: authorization.targetTrustGeneration
    reservation.transitionIntentDigest: embedded transitionIntent self digest
    reservation path key: predecessorKey

PowerControllerBootstrapTrustCandidateRef
  artifactKind: acceptance-power-controller-bootstrap-trust-candidate-ref
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  controllerIdentityDigest
  bootstrapCandidateDigest
  bootstrapCandidateRefDigest

PowerControllerTrustAnchorRef
  artifactKind: acceptance-power-controller-trust-anchor-ref
  schemaVersion: 1
  workspaceId
  gateId
  trustGeneration: positive integer
  controllerIdentityDigest
  trustAnchorDigest
  trustAnchorRefDigest

PowerControllerTrustAuthorityRef =
  PowerControllerBootstrapTrustCandidateRef
  | PowerControllerTrustAnchorRef

PhysicalPowerControllerIdentity
  controllerKind: PHYSICAL_POWER_CONTROLLER
  controllerHardwareIdHash
  controllerFirmwareVersion
  publicKeyAlgorithm: ED25519
  publicKeySha256
  controllerIdentityDigest

VmPowerControllerIdentity
  controllerKind: VM_HYPERVISOR
  hypervisorName
  hypervisorVersion
  vmInstanceIdHash
  publicKeyAlgorithm: ED25519
  publicKeySha256
  controllerIdentityDigest

DurabilityPowerCutTrace
  artifactKind: acceptance-durability-power-cut-trace
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  caseId
  backend
  preInterruptionEnvironment: DurabilityEnvironmentObservation
  qualifiedEnvironmentDigest
  operationSequence
  completedOperations
  interruptionPoint
  probeRuntimeDigest
  powerInterruption: PowerInterruptionEvidence
  traceDigest

DurabilityRecoveryResult
  artifactKind: acceptance-durability-recovery-result
  schemaVersion: 1
  workspaceId
  gateId
  crashFixtureId
  qualificationRunId
  caseId
  backend
  qualifiedEnvironmentDigest
  observedEnvironment: DurabilityEnvironmentObservation
  operationSequence
  interruptionPoint
  probeRuntimeDigest
  powerInterruptionDigest
  postRestartEnvironmentObservationRef: DurabilityCapabilityArtifactRef
  postRestartEnvironmentObservationDigest
  expectedRecoveredState
  observedRecoveredState: ABSENT | OLD_BYTES | NEW_BYTES | OTHER
  observedContentSha256: string | null
  result: PASS | FAIL
  recoveredAt
  recoveryResultDigest

Durability fixture branch constraints:

- Linux manifest operation sequence is exactly
  `(WRITE_TEMP,SYNC_FILE,RENAME_FINAL,SYNC_DIRECTORY)` and has one case for each
  listed interruption boundary.
- Darwin manifest operation sequence appends `SYNC_ANCHOR` and has one case for
  every five boundaries.
- `ABSENT` requires null observed hash, `OLD_BYTES` requires
  `oldContentSha256`, `NEW_BYTES` requires `newContentSha256`, and `OTHER` is
  always `FAIL`. `PASS` requires observed state/hash to equal the expected
  state/hash. Each trace's `completedOperations` is exactly the strict prefix
  before its interruption point and carries non-simulated
  `PowerInterruptionEvidence`; manifest, trace and recovery host build, stable
  host identity, filesystem implementation/options, stable volume and probe
  runtime are equal.
  `expectationRef` resolves a `DurabilityExpectationRecord` durably published
  before a create-exclusive `DurabilityExecutionStartRecord`. The start record
  is appended under a permanent sequence lock and synced with the expectation
  branch's bootstrap or active protocol before the first fixture filesystem
  mutation. The external controller resolves
  both refs and issues `PowerControllerReceipt` carrying their digests/sequence
  before accepting the interruption command; trace `issuedAt` and all completed
  operations follow that receipt. Every manifest case exactly equals its
  precommitted expectation tuple. Each start record's workspace/Gate/fixture/
  case/interruption/environment equals that tuple and manifest; sequence 1 has
  null predecessor and each later sequence references the immediately previous
  durable execution-start digest.
  `trustMode=BOOTSTRAP_CANDIDATE` is valid only for the one qualification run
  named by a fixed `PowerControllerBootstrapTrustCandidateRef`; it cannot enter
  an operational authority profile or support any later expectation.
  Authorization, candidate, ref, expectation, execution starts, receipts,
  traces, recoveries and manifest must have identical workspace/Gate/
  `crashFixtureId/qualificationRunId`. Promotion first publishes the
  predecessor-keyed immutable `PowerControllerTrustTransitionReservation`,
  then its byte-equal embedded `PowerControllerTrustPromotionIntent`, then
  atomic no-replace writes the matching
  `PowerControllerBootstrapCandidateConsumption`; a candidate with an existing
  unequal reservation, intent, consumption or any second qualification identity
  is rejected.
  `trustMode=ACTIVE_ANCHOR` resolves only fixed
  `finalizer-enforcement/controller-trust/<trust-anchor-digest>.json`, and all
  operational expectations require this branch and must equal
  an `ACTIVE` `controller-trust/current.json`. The initial promotion publishes
  immutable generation 1 from an absent selector. Rotation publishes a new
  immutable, predecessor-linked anchor and generation record at exactly
  `resolved current generation + 1`, then
  compare-and-replace advances the selector from the exact expected current
  digest. Revocation publishes an immutable predecessor-linked revocation at
  the same monotonic next generation, then CAS advances the selector to
  `REVOKED`; a revoked generation authorizes no expectation, epoch, receipt,
  journal or actuator action. Rollback, generation reuse, skipped generation,
  stale-current CAS, mutation of an old anchor and more than one successor from
  a current digest are rejected. The active anchor must have
  been independently promoted before the expectation by the two-phase local
  interactive protocol above. Both phases derive the operator from the kernel
  principal, require one controlling TTY, verify real/effective UID equality,
  clean current HEAD and canonical accepted D-19 approval bytes, then require
  the full domain-separated challenge to be re-entered. Existing equal bytes are
  accepted only after the relevant sync protocol is replayed; conflicting bytes
  fail closed. Neither an expectation nor a fixture can supply, replace or
  enroll key authority. Active-anchor workspace/Gate, controller identity,
  public-key hash, approval path/hash, source commit, profile and qualification
  manifest equal its promotion authorization and bootstrap candidate.
  For `QUALIFICATION_BOOTSTRAP`, every environment boot ref resolves a
  `DarwinDurabilityQualificationBootObservation` or
  `LinuxDurabilityQualificationBootObservation` whose
  workspace/Gate/fixture/run/candidate/source/helper identity matches the
  expectation. It contains no durability profile or capability-evidence digest,
  so the qualification graph is finite. Before/after refs and raw hashes must be
  distinct; Darwin requires both boot-session UUID and boot time to change,
  Linux requires both boot ID and boot time to change, and
  `before.observedAt < receipt.issuedAt < after.observedAt`.
  For `ACTIVE_PROFILE`, every environment boot ref resolves a
  `DarwinDurabilityProfileBootObservation` or
  `LinuxDurabilityProfileBootObservation` with the same OS as the profile.
  Its workspace/Gate/fixture/run/profile/source/helper identity equals the
  expectation and capability evidence. The before/after refs use
  `BOOT_OBSERVATION`, resolve distinct bytes, and require the same Darwin
  boot-session/time or Linux boot-id/time transition and temporal ordering as
  the bootstrap branch. A profile observation cannot parse as a qualification
  observation, or vice versa.
  Receipt controller identity and public-key hash equal the selected trust
  authority and expectation; its
  Ed25519 signature verifies domain
  `pt.acceptance.finalization.durability-power-controller-receipt-signature.v1`
  over the
  complete receipt excluding `signatureHex` and `controllerReceiptDigest`.
  The Ed25519 public key is exactly 32 raw bytes encoded as 64 lowercase hex
  characters; each signature is exactly 64 raw bytes encoded as 128 lowercase
  hex characters. RFC 8032 specifies 32-byte public keys and 64-byte signatures
  for Ed25519: <https://www.rfc-editor.org/rfc/rfc8032#section-1>.
  Every production signature below signs UTF-8 RFC 8785 bytes of exactly
  `{"domain":"<registered-signature-domain>","payload":<complete signed object
  excluding signatureHex and its object digest>}`. Verification requires strict
  RFC 8032 decoding: canonical compressed Edwards-Y public key and R encoding,
  on-curve non-small-order points, and canonical scalar `S < L`; unknown,
  malleable or non-canonical encodings fail closed before object-digest
  validation.
  Receipt/start/expectation refs and digests, case, environment
  and sequence are byte-equal. The controller generates a random 32-byte release
  token but persists and signs only its lowercase SHA-256. Evidence Store uses
  the expectation branch's bootstrap or active sync contract to persist the
  standalone receipt before the fixture receives the raw token; a missing
  bootstrap record after restart invalidates qualification rather than being
  reconstructed. The fixture acknowledges possession over the private control
  channel; the controller atomically changes its durable command journal from
  `ACCEPTED` to `ARMED`, consumes that token once and signs a standalone
  `PowerControllerArmReceipt`. Evidence Store syncs the arm receipt before the
  first fixture mutation. `PowerInterruptionEvidence` resolves all three receipt
  refs from the same capability namespace. Each
  `DurabilityCapabilityArtifactRef.contentSha256` equals raw SHA-256 of the exact
  stored JCS receipt bytes; separately, parsing those bytes and recomputing the
  receipt's domain-separated digest must equal its named receipt digest.
  `controllerReceiptDigest`, `controllerArmReceiptDigest` and
  `controllerExecutionReceiptDigest` must respectively equal the resolved
  `PowerControllerReceipt.controllerReceiptDigest`,
  `PowerControllerArmReceipt.controllerArmReceiptDigest` and
  `PowerControllerExecutionReceipt.executionReceiptDigest`; all three resolved
  receipts must also satisfy their nested predecessor-digest equalities.
  The execution/start and receipt refs have exact artifact names
  `EXECUTION_START`, `EXPECTATION`, `CONTROLLER_RECEIPT`,
  `CONTROLLER_ARM_RECEIPT` and `CONTROLLER_EXECUTION_RECEIPT`.
  The two boot refs are branch-specific: `BOOTSTRAP_CANDIDATE` requires
  `QUALIFICATION_BOOT_OBSERVATION`; `ACTIVE_ANCHOR` requires
  `BOOT_OBSERVATION`. Their
  workspace/Gate/fixture identity equals the enclosing trace. The selected
  concrete controller identity digest equals the initial and execution
  receipts. The arm receipt's `commandId`, runtime epoch ID/digest,
  `controllerReceiptDigest` and `releaseTokenSha256` must be byte-equal to the
  initial receipt, execution receipt, every journal entry/head and enclosing
  interruption evidence; its predecessor digest resolves that same initial
  receipt and cannot substitute identity from another command.
  `PHYSICAL_POWER_CUT` accepts only `PhysicalPowerControllerIdentity`, and
  `VM_HARD_POWER_OFF` accepts only `VmPowerControllerIdentity`.
  Receipt/arm timestamps precede every completed operation.
  `PowerControllerArmReceipt.signatureHex` is the lowercase hex encoding of
  Ed25519 over the UTF-8 RFC 8785 bytes of
  `{"domain":"pt.acceptance.finalization.durability-power-controller-arm-receipt-signature.v1",
  "payload":<complete arm receipt excluding signatureHex and
  controllerArmReceiptDigest>}`. After executing the command, the same controller signs
  `PowerControllerExecutionReceipt` over all fields except `signatureHex` and
  `executionReceiptDigest` under
  `pt.acceptance.finalization.durability-power-controller-execution-receipt-signature.v1`.
  Its receipt/arm digests and `releaseTokenSha256` equal the pre-command records,
  and its command/case/start/expectation/interruption identity and trust authority
  equal those records and the trace. The controller first atomic no-replace
  appends signed journal state `EXECUTION_STARTED`. An
  For `trustMode=ACTIVE_ANCHOR`, the Acceptance Infra-owned
  `trust_admission.py` mediator acquires the Gate publish lock shared,
  re-resolves `controller-trust/current.json`, requires its ACTIVE generation
  ref/digest to equal the epoch, receipt and journal common fields, and returns
  one non-serializable `TrustDispatchLease`. `EXECUTE_POWER_ACTION` validates
  that lease before taking the command lock and holds it through the inline
  actuator call; `power_controller.py` never imports or invokes Evidence Store
  APIs directly. For
  `trustMode=BOOTSTRAP_CANDIDATE`, those two fields are null and the command is
  restricted to the candidate's one qualification run. Both branches then
  revalidate the live epoch/lease/head and durably append the
  one-shot `ACTION_DISPATCHED` claim
  and, without releasing the lock or returning a bearer authorization, invokes
  the in-process actuator exactly once. After reboot it appends `EXECUTED` plus
  the execution receipt. A crash or lost response after `ACTION_DISPATCHED`
  permanently rejects action retry as uncertain; the qualification case fails
  and requires a fresh command ID. Its
  controller-local fixed paths are
  `controllerPersistentStore/commands/<commandId>/transitions/<sequence>-<state>.json`
  and per-command singleton `head.json`; every transition/head binds
  `commands/<commandId>/.lock`. Under that
  exclusive controller-owned lock, each
  transition writes the signed entry to a same-directory temporary file,
  applies the qualified backend's file durability operation, atomic no-replace
  publishes the final entry and applies the transitions-directory durability
  operation. It then writes the candidate head to a same-directory temporary
  file, applies file durability, compare-and-replace advances the head from the
  exact predecessor digest, and applies command-directory durability. On Darwin
  the qualified backend additionally completes its same-volume full-sync anchor.
  Only after both the `ACTION_DISPATCHED` entry and selected head pass those
  barriers may the same lock-owning stack frame invoke the actuator. A crash
  before final entry publication leaves no successor and permits retry. If the
  same still-live process/epoch loses an I/O acknowledgement after entry
  publication but before durable head, it re-syncs and adopts the sole valid
  successor only when the original stack still holds the non-serializable
  `PowerActionInvocationCapability` and recomputes its persisted
  `dispatchInvocationDigest`, then continues that original lock-owning operation
  through the one actuator invocation. Core generates the random capability
  bytes only after acquiring the command lock; no request, frame, result,
  artifact or log may contain them. A later request can observe only the digest
  and cannot adopt or invoke the action.
  Rotation and revocation acquire that Gate publish lock exclusively and never
  acquire a command lock, so current-state CAS cannot race the final dispatch
  check and the global lock order is fixed. A controller process crash never
  uses this adoption path: restart creates a new epoch and the prior
  nonterminal command fails closed. A
  crash or lost ACK after durable `ACTION_DISPATCHED` never permits redispatch.
  A non-head predecessor,
  sibling successor or second terminal state is rejected. Every transition
  preserves the exact `commandIdentityDigest` and all controller/trust/workspace/
  Gate/fixture/run/case/expectation/start/token fields, including the selected
  trust-generation ref and current digest copied from the epoch and initial
  receipt. The journal signature
  uses Ed25519 domain
  `pt.acceptance.finalization.durability-power-controller-command-journal-signature.v1`
  with the common domain/payload framing over the complete entry except
  `signatureHex` and `commandJournalDigest`;
  `commandJournalDigest` covers that signed entry and
  `commandJournalHeadDigest` covers the unsigned deterministic projection of the
  selected signed entry. Every `expectedHeadDigest` is therefore reconstructible
  from its predecessor entry; intermediate mutable head files need not survive.
  Controller startup first opens the permanent
  `controllerPersistentStore/.runtime.lock`, verifies its device/inode identity,
  acquires one exclusive open-file-description lock and holds it until process
  exit. While holding it, startup reads `current-runtime.json`: bootstrap permits
  null predecessor only when no epoch/current exists; otherwise the new
  `previousEpochRef` must equal current exactly and the prior lease/process must
  be absent. It then atomic no-replace publishes signed
  `runtime-epochs/<controllerRuntimeEpochId>.json` and atomically replaces the
  deterministic unsigned `current-runtime.json`. The epoch signature uses
  `pt.acceptance.finalization.durability-power-controller-runtime-epoch-signature.v1`;
  its exact message is UTF-8 RFC 8785 bytes of
  `{"domain":"pt.acceptance.finalization.durability-power-controller-runtime-epoch-signature.v1",
  "payload":<complete epoch excluding signatureHex and controllerRuntimeEpochDigest>}`,
  while
  `controllerRuntimeEpochDigest` hashes that same unsigned projection under its
  distinct digest domain. `controllerTrustDigest` resolves the expectation's
  bootstrap candidate or active anchor and its Ed25519 public key verifies the
  signature. For an operational ACTIVE anchor, startup holds the Gate publish
  lock shared, resolves `controller-trust/current.json` and its generation, and
  copies that exact generation ref and current digest into the epoch. A
  bootstrap-qualification epoch instead binds the exact candidate and requires
  both selected-current fields null; it cannot authorize any non-qualification
  command. The typed predecessor ref
  resolves the prior immutable epoch.
  `currentRuntimeDigest` covers its complete unsigned pointer except itself.
  Epoch ID/digest/controller identity/trust/PID/start and complete
  `runtimeLockIdentity` must be byte-equal across the epoch, resolved epoch ref,
  current selector, command lock's nested epoch lease and every
  receipt/journal entry.
  Runtime lock acquisition sets close-on-exec atomically. The controller may not
  fork, duplicate, transfer or inherit the descriptor into a child; it is the
  sole descriptor owner and uses an in-process controller driver. Takeover can
  publish a successor only after acquiring that exact lock identity, which proves
  the prior open-file description is gone.
  Every
  receipt/journal/lock must resolve the current epoch and match its ID/digest,
  controller PID/start/source and live lease before transition and immediately
  before the irreversible power action.
  While the same `controllerRuntimeEpochId` remains live, recovery that finds the
  old head and exactly one fully valid unheaded successor whose predecessor and
  expected head equal it re-syncs that entry and advances the head to it.
  Zero successors leaves the old head; more than one, an invalid signature or
  any unequal identity is a permanent fork error. Exact entry/head
  copies are persisted as `CONTROLLER_COMMAND_JOURNAL` and
  `CONTROLLER_COMMAND_JOURNAL_HEAD` capability artifacts. Controller process
  restart creates a new signed runtime epoch and invalidates every nonterminal
  command from the prior epoch; no transition, cancellation or execution is
  resumed, and the case fails with a fresh command ID required.
  General current-epoch journal-transition branches require current
  epoch/ref/lease equality and only `INITIAL_TRANSITION` or `TRANSITION`; they
  never authorize an external action. `InitialCurrentEpochCommandResolution` requires an absent head and
  creates `ACCEPTED`. `ExistingCurrentEpochCommandResolution.targetState` must
  equal the request target and the only valid predecessor/target pairs are
  `ACCEPTED -> ARMED`, `ACCEPTED -> CANCELLED`, `ARMED ->
  EXECUTION_STARTED`, `ARMED -> CANCELLED` and `ACTION_DISPATCHED ->
  EXECUTED`. `EXECUTION_STARTED -> ACTION_DISPATCHED` is reserved exclusively
  for the lock-owning `EXECUTE_POWER_ACTION` operation. A same-state response is
  a retry, not a transition.
  No command resolution is a bearer authorization:
  `externalActionAllowed=false` in every branch.
  `CurrentEpochPowerActionResolution` instead records
  `externalActionDispatchedInline=true` only after its request
  `expectedHeadDigest` matched the pre-dispatch `EXECUTION_STARTED` head, the
  unique `ACTION_DISPATCHED` successor became durable and the same lock-owning
  operation invoked the in-process actuator once. The live epoch/lease is
  revalidated immediately before that dispatch. Any current-epoch identity/head/edge mismatch, absent
  required head, unexpected existing head or ineligible/already-dispatched
  action returns `CurrentEpochCommandRejection`. `PRIOR_TERMINAL_LOOKUP` resolves the
  historical signed epoch plus complete terminal journal/receipt chain, requires
  no live lease and performs no transition or external action.
  `PRIOR_NONTERMINAL_REJECTED` permits neither lookup success nor mutation.
  Request and result variants are closed unions with complete-object digests.
  The exhaustive matrix is: current+initial+absent head -> initial transition;
  current+transition+existing head -> existing transition; current+retry ->
  current retry; current+`EXECUTE_POWER_ACTION`+`EXECUTION_STARTED` head ->
  durable `ACTION_DISPATCHED` then one in-process power action; current+lookup
  -> current lookup; any otherwise validly shaped current request that fails
  its identity/head/edge precondition -> current rejection;
  prior request with a non-null unequal observed command identity -> prior
  identity-mismatch rejection before state classification;
  prior+lookup/retry+absent head -> prior missing-head rejection;
  prior+transition/initial/power ->
  mutation rejection; prior+lookup/retry+terminal -> prior-terminal lookup; and
  prior+lookup/retry+nonterminal -> prior-nonterminal rejection. Current
  rejection selection is ordered and exclusive: missing required head;
  initial request with an existing unequal identity; initial request with an
  existing equal identity; non-initial unequal identity; stale expected head;
  except that an `EXECUTE_POWER_ACTION` observing `ACTION_DISPATCHED` is
  classified `CURRENT_POWER_ACTION_ALREADY_DISPATCHED_OR_UNCERTAIN` before the
  stale-head check; then stale expected head, invalid transition edge and
  remaining ineligible power action.
  Missing-head rejection has no observed identity. Unexpected-head rejection
  requires expected identity equal to the head. Identity-mismatch rejection
  requires expected and observed identities unequal. Stale-head rejection
  requires identity equality and expected head unequal to the observed head.
  The already-dispatched branch requires identity equality, resolves the
  `ACTION_DISPATCHED` entry selected by the observed head and requires that
  entry's predecessor `expectedHeadDigest` to equal the request's original
  `EXECUTION_STARTED` head digest; it does not require request/current-head
  equality. Invalid-transition and remaining ineligible power-action rejection require both identity and
  expected-head equality, then reject only the state/operation relation.
  Every rejection's `requestedOperation`, `requestDigest`, current/historical
  epoch ref and `expectedCommandIdentityDigest` (or prior
  `commandIdentityDigest` for equal-identity prior branches) equal the exact
  originating request. Its observed
  identity is absent only for missing head; every non-null observed identity
  equals the resolved head. Every successful or historical result
  `requestDigest` equals its complete request's `resolutionRequestDigest`;
  its `commandIdentityDigest` equals the request
  `expectedCommandIdentityDigest` and the resolved head identity. Every result
  repeats the request operation and epoch ref with compatible head nullability;
  unknown, mismatched or cross-branch fields fail.
  Conflicting or consumed-token replay is always rejected. Exactly one execution
  receipt is valid for a command ID.
  `executionResult=POWER_INTERRUPTED` and `afterBootObservationDigest` equals the
  resolved after-boot observation.
  Trace and recovery `qualifiedEnvironmentDigest` both equal the manifest stable
  qualification. Trace embeds the pre-interruption live observation. Its
  before/after boot refs resolve typed observation payloads and match the signed
  receipt. Recovery's post-restart ref resolves bytes whose digest equals both
  `postRestartEnvironmentObservationDigest` and
  `observedEnvironment.environmentObservationDigest`; that observation's boot
  ref equals the interruption after-boot ref and its timestamp follows
  `restartObservedAt`. Recovery `powerInterruptionDigest` equals its trace
  interruption evidence.

DarwinStableVolumeIdentity
  osFamily: DARWIN
  filesystemType: APFS
  volumeUuid
  containerUuid
  volumeIdentityDigest

LinuxStableVolumeIdentity
  osFamily: LINUX
  filesystemType
  filesystemUuid
  volumeIdentityDigest

StableVolumeIdentity =
  DarwinStableVolumeIdentity
  | LinuxStableVolumeIdentity

LiveAuthorityMountBinding
  osFamily: DARWIN | LINUX
  stableVolumeIdentityDigest
  mountNamespaceId: string | null
  mountId: UInt64String | null
  darwinFsid: string | null
  deviceId: UInt64String
  hostBuild: RuntimeHostBuild
  filesystemImplementationVersion
  mountOptions: UTF-8 lexical sorted tuple[string, ...]
  observedAt
  mountBindingDigest

Live mount branch constraints:
  DARWIN:
    mountNamespaceId: null
    mountId: null
    darwinFsid: non-empty
  LINUX:
    mountNamespaceId: non-empty
    mountId: UInt64String
    darwinFsid: null

The Evidence Store derives this binding from the already opened authority-root
FD and OS mount tables; callers cannot supply it. Its stable-volume digest and
device must match the profile and every opened transition target.

LinuxProofAuthorityDurabilityProfile
  osFamily: LINUX
  backend: LINUX_FILE_AND_DIRECTORY_FSYNC_V1
  stableVolumeIdentity: LinuxStableVolumeIdentity
  syncAnchorIdentity: null
  capabilityEvidence: ProofAuthorityDurabilityCapabilityEvidence
  durabilityProfileDigest

DarwinProofAuthorityDurabilityProfile
  osFamily: DARWIN
  backend: DARWIN_APFS_FULLFSYNC_V1
  stableVolumeIdentity: DarwinStableVolumeIdentity
  syncAnchorIdentity: DurabilitySyncAnchorIdentity
  capabilityEvidence: ProofAuthorityDurabilityCapabilityEvidence
  durabilityProfileDigest

DurabilitySyncAnchorIdentity
  deviceId: UInt64String
  inode: UInt64String
  fileType: REGULAR_FILE
  contentSha256
  byteLength
  anchorIdentityDigest

ProofAuthorityDurabilityProfile =
  LinuxProofAuthorityDurabilityProfile
  | DarwinProofAuthorityDurabilityProfile

Durability profile branch constraints:

- Linux capability evidence matches profile OS/backend/stable volume,
  has `successfulOperations=(SYNC_FILE,SYNC_DIRECTORY)`, and its probe source is
  an exact subset of the enclosing authority maintenance worker source.
- Darwin capability evidence matches the profile stable volume and sync-anchor device, has
  `successfulOperations=(SYNC_FILE,SYNC_DIRECTORY,SYNC_ANCHOR)`, and
  binds a reviewed crash/power-cut fixture manifest. Its probe source is an exact
  subset of the enclosing authority maintenance worker source.
- Capability evidence includes exactly one EXPECTATION, MANIFEST and
  PROBE_RUNTIME_MANIFEST, one CONTROLLER_RUNTIME_EPOCH and
  CONTROLLER_RUNTIME_CURRENT selecting it, plus the manifest-declared runtime blobs. Every
  manifest case has exactly one EXECUTION_START, POWER_CUT_TRACE,
  RECOVERY_RESULT, CONTROLLER_RECEIPT, CONTROLLER_ARM_RECEIPT and
  CONTROLLER_EXECUTION_RECEIPT, plus exactly five CONTROLLER_COMMAND_JOURNAL
  states `ACCEPTED, ARMED, EXECUTION_STARTED, ACTION_DISPATCHED, EXECUTED` and one
  CONTROLLER_COMMAND_JOURNAL_HEAD selecting `EXECUTED`. A
  `BOOTSTRAP_CANDIDATE` case has exactly two
  QUALIFICATION_BOOT_OBSERVATION refs and zero BOOT_OBSERVATION refs; an
  `ACTIVE_ANCHOR` case has exactly two BOOT_OBSERVATION refs and zero
  QUALIFICATION_BOOT_OBSERVATION refs. Bootstrap refs resolve only the matching
  OS branch of `DurabilityQualificationBootObservation`; active refs resolve
  only the matching OS branch of `DurabilityProfileBootObservation`. Their
  object digest is respectively `qualificationBootObservationDigest` or
  `profileBootObservationDigest`, while `contentSha256` and `byteLength`
  independently authenticate the exact stored bytes. No extra artifact is
  valid. The
  PROBE_RUNTIME_MANIFEST payload must parse as
  `DurabilityProbeRuntimeManifest`; its runtime refs match captured files
  one-to-one in canonical order and reconstruct `probeRuntimeDigest`. All refs resolve only
  under fixed
  `finalizer-enforcement/durability-capabilities/<crash-fixture-id>/`.
  The MANIFEST payload is `DurabilityCrashFixtureManifest`; each
  POWER_CUT_TRACE and RECOVERY_RESULT ref resolves the exact typed object named by
  one manifest case. Workspace/Gate/fixture/backend/stable-volume/case IDs,
  operation sequence, interruption point, expected state and probe runtime
  digest must be equal across manifest, trace and recovery result. `SUPPORTED`
  requires every declared case to be `PASS`, no extra/missing refs, and coverage
  of every operation-sequence interruption point applicable to the backend.
  Interlock, activation, abort and boot-observation operations each carry and
  verify the complete profile digest. Each operation derives a fresh
  `LiveAuthorityMountBinding` from its opened authority FD and requires its
  stable-volume digest/device, current host build, filesystem implementation and
  required mount options to match the qualified evidence; Linux mount namespace/id are
  operation-local and never enter the reboot-stable profile. A requirement record copies the exact
  generation-authorized profile; profile/evidence field mismatch, missing/extra
  artifact, unknown operation or non-`SUPPORTED` result is invalid.

ProofAdmissionLockIdentity
  deviceId: UInt64String
  inode: UInt64String
  fileType: REGULAR_FILE
  lockIdentityDigest

GatePublishLockIdentity
  workspaceId
  gateId
  lockPathId: GATE_FINALIZER_PUBLISH_LOCK_V1
  deviceId: UInt64String
  inode: UInt64String
  fileType: REGULAR_FILE
  openedNoFollow: true
  lockIdentityDigest

ProofAdmissionSourceEdge
  edgeKind: IMPORT | INCLUDE | EXECUTE | SOURCE | MAKE_RECIPE | CI_STEP | DATA_READ
  targetPath
  assignedGrammarId: PYTHON_AST_V1 | POSIX_SHELL_V1 | ECMASCRIPT_V1 | TYPESCRIPT_V1 | RUST_V1 | GO_V1 | C_V1 | MAKE_V1 | YAML_V1 | TOML_V1 | JSON_V1 | null
  assignedInterpreter: PYTHON3 | POSIX_SH | NODE | NATIVE | null

ProofAdmissionSourceNode
  repoRelativePath
  rawFileSha256
  byteLength
  classification: PARSED_SOURCE | OPAQUE_DATA
  grammarId: PYTHON_AST_V1 | POSIX_SHELL_V1 | ECMASCRIPT_V1 | TYPESCRIPT_V1 | RUST_V1 | GO_V1 | C_V1 | MAKE_V1 | YAML_V1 | TOML_V1 | JSON_V1 | null
  interpreterAssignment: PYTHON3 | POSIX_SH | NODE | NATIVE | null
  forwardEdges: tuple[ProofAdmissionSourceEdge, ...]
  sourceNodeDigest

Proof-admission classifier is total and ordered:

1. All incoming non-`DATA_READ` edge assignments for a target must be byte-equal.
   A disagreement is a closure error; no precedence may hide it.
2. A recognized suffix assigns grammar before basename/location rules:
   `.py|.pyi -> PYTHON_AST_V1/PYTHON3`,
   `.sh|.bash|.zsh -> POSIX_SHELL_V1/POSIX_SH`,
   `.js|.jsx|.mjs|.cjs -> ECMASCRIPT_V1/NODE`,
   `.ts|.tsx -> TYPESCRIPT_V1/NODE`,
   `.rs -> RUST_V1/NATIVE`, `.go -> GO_V1/NATIVE`,
   `.c|.h -> C_V1/NATIVE`, `.mk -> MAKE_V1/POSIX_SH`,
   `.toml -> TOML_V1/null`, `.json -> JSON_V1/null`, and
   `.yaml|.yml -> YAML_V1/null`.
3. With no recognized suffix, basename `Makefile|GNUmakefile` assigns
   `MAKE_V1/POSIX_SH`; a path under `.github/workflows/` assigns
   `YAML_V1/null`.
4. Remaining extensionless executable files require one recognized exact shebang
   assignment or one incoming non-data assignment. If both exist they must be
   byte-equal. Executable mode alone never selects a grammar.
5. An incoming non-data assignment must equal the path/shebang assignment when
   one exists. Every non-data edge resolves exactly one canonical target node,
   and its `(assignedGrammarId, assignedInterpreter)` must equal that node's
   `(grammarId, interpreterAssignment)`.
6. The valid pair set is exactly the pairs listed in steps 2-3. `OPAQUE_DATA` is
   exactly `(null,null,())`, may be reached only by `DATA_READ`, and executable
   mode or any non-data edge forbids that classification. Every `DATA_READ` edge
   has `(assignedGrammarId,assignedInterpreter)=(null,null)`.

DarwinProcessStartIdentity
  osFamily: DARWIN
  bootSessionUuid
  startSeconds: UInt64String
  startMicroseconds: UInt64String

LinuxProcessStartIdentity
  osFamily: LINUX
  bootId
  startClockTicks: UInt64String

ProcessStartIdentity = DarwinProcessStartIdentity | LinuxProcessStartIdentity

PosixWaitStatus =
  PosixExitedStatus
  | PosixSignaledStatus

PosixExitedStatus
  terminalKind: EXITED
  exitCode: integer 0..255
  termSignal: null
  coreDumped: false

PosixSignaledStatus
  terminalKind: SIGNALED
  exitCode: null
  termSignal: positive integer
  coreDumped: boolean

ConsumingChildWaitEvidence
  waiterPid: positive integer
  waiterProcessStartIdentity: ProcessStartIdentity
  childPid: positive integer
  childProcessStartIdentity: ProcessStartIdentity
  waitApi: WAITPID
  waitOptions: 0
  returnedPid: positive integer
  status: PosixWaitStatus
  statusConsumed: true
  waitedAt
  waitEvidenceDigest

DarwinProofAdmissionExecutionEnvironmentIdentity
  osFamily: DARWIN
  hostBuild: DarwinRuntimeHostBuild
  hostIdentity: DarwinRuntimeHostIdentity
  environmentKind: TRUSTED_LEAF_COORDINATOR
  environmentId
  supervisorPid: positive integer
  supervisorProcessStartIdentity: DarwinProcessStartIdentity
  epochBootObservationRef: DarwinBootBoundaryObservationRef
  epochBootObservationDigest
  processPolicy: NO_CHILD_NO_SESSION_CHANGE_V1
  environmentIdentityDigest

LinuxProofAdmissionExecutionEnvironmentIdentity
  osFamily: LINUX
  hostBuild: LinuxRuntimeHostBuild
  hostIdentity: LinuxRuntimeHostIdentity
  environmentKind: LINUX_PID_NAMESPACE
  environmentId
  supervisorPid: positive integer
  supervisorProcessStartIdentity: LinuxProcessStartIdentity
  epochBootObservationRef: LinuxBootBoundaryObservationRef
  epochBootObservationDigest
  pidNamespaceDeviceId: UInt64String
  pidNamespaceInode: UInt64String
  namespaceInitPid: positive integer
  namespaceInitProcessStartIdentity: LinuxProcessStartIdentity
  namespaceInitPidfdOpenedBeforeJobRelease: true
  namespaceInitPidfdOwnerPid: positive integer
  namespaceInitPidfdOwnerProcessStartIdentity: LinuxProcessStartIdentity
  namespaceInitPidfdLeaseId
  pidfdOwnerSigchldDisposition: DEFAULT
  pidfdOwnerSaNoCldWait: false
  pidfdSoleWaiter: true
  pidfdWaitCapability: LinuxPidfdWaitCapabilityEvidence
  processPolicy: NO_CHILD_NO_SESSION_CHANGE_V1
  environmentIdentityDigest

LinuxPidfdWaitCapabilityEvidence
  hostBuild: LinuxRuntimeHostBuild
  hostIdentity: LinuxRuntimeHostIdentity
  kernelRelease
  probeChildPid: positive integer
  probeChildProcessStartIdentity: LinuxProcessStartIdentity
  probePidfdLeaseId
  pidfdOpenFlags: 0
  pidfdOpenSupported: true
  pidfdPollReventsRaw: UInt32String
  pidfdPollInSet: true
  pidfdPollErrorBits: 0
  pidfdPollHupBeforeWait: false
  waitIdType: P_PIDFD
  waitIdOptions: WEXITED
  waitIdStatus: LinuxWaitIdStatus
  waitIdStatus.siPid: probeChildPid
  waitConsumedProbeChild: true
  postWaitPidfdPollReventsRaw: UInt32String
  postWaitPidfdPollHupSet: true
  postWaitPidfdPollErrorBits: 0
  probedBeforeEnvironmentAllocation: true
  probedAt
  pidfdWaitCapabilityDigest

ProofAdmissionExecutionEnvironmentIdentity =
  DarwinProofAdmissionExecutionEnvironmentIdentity
  | LinuxProofAdmissionExecutionEnvironmentIdentity

DarwinBootBoundaryObservation
  artifactKind: acceptance-proof-admission-darwin-boot-observation
  schemaVersion: 1
  workspaceId
  gateId
  observationId
  sourceCommit
  hostIdentity: DarwinRuntimeHostIdentity
  durabilityProfileDigest
  liveMountBinding: LiveAuthorityMountBinding
  helperIdentity: KernelEvidenceHelperIdentity
  bootSessionUuid
  bootTimeSeconds: UInt64String
  bootTimeMicroseconds: UInt64String
  observedAt
  observationDigest

DarwinBootBoundaryObservationRef
  artifactKind: acceptance-proof-admission-darwin-boot-observation-ref
  schemaVersion: 1
  workspaceId
  gateId
  observationId
  observationDigest
  observationRefDigest

LinuxBootBoundaryObservation
  artifactKind: acceptance-proof-admission-linux-boot-observation
  schemaVersion: 1
  workspaceId
  gateId
  observationId
  sourceCommit
  hostIdentity: LinuxRuntimeHostIdentity
  durabilityProfileDigest
  liveMountBinding: LiveAuthorityMountBinding
  helperIdentity: KernelEvidenceHelperIdentity
  bootId
  bootTimeSeconds: UInt64String
  bootTimeNanoseconds: UInt64String
  observedAt
  observationDigest

LinuxBootBoundaryObservationRef
  artifactKind: acceptance-proof-admission-linux-boot-observation-ref
  schemaVersion: 1
  workspaceId
  gateId
  observationId
  observationDigest
  observationRefDigest

DarwinBootBoundaryAttestation
  source: KERNEL_BOOT_BOUNDARY_HELPER_V1
  priorObservation: DarwinBootBoundaryObservation
  currentObservation: DarwinBootBoundaryObservation
  bootBoundaryAttestationDigest

LinuxBootBoundaryAttestation
  source: KERNEL_BOOT_BOUNDARY_HELPER_V1
  priorObservation: LinuxBootBoundaryObservation
  currentObservation: LinuxBootBoundaryObservation
  bootBoundaryAttestationDigest

DarwinLegacyClaimEnvironmentIdentity
  osFamily: DARWIN
  environmentKind: LEGACY_BOOT_SESSION
  hostIdentity: DarwinRuntimeHostIdentity
  bootObservationDigest
  environmentIdentityDigest

LinuxLegacyClaimEnvironmentIdentity
  osFamily: LINUX
  environmentKind: LEGACY_BOOT_SESSION
  hostIdentity: LinuxRuntimeHostIdentity
  bootObservationDigest
  environmentIdentityDigest

LegacyClaimEnvironmentIdentity =
  DarwinLegacyClaimEnvironmentIdentity
  | LinuxLegacyClaimEnvironmentIdentity

DarwinLegacyEnvironmentTermination
  executionEnvironmentIdentity: DarwinLegacyClaimEnvironmentIdentity
  terminationMethod: BOOT_BOUNDARY_ATTESTED
  bootBoundaryAttestation: DarwinBootBoundaryAttestation
  terminatedAt
  survivingProcessIdentities: ()
  executionEnvironmentTerminationDigest

LinuxLegacyEnvironmentTermination
  executionEnvironmentIdentity: LinuxLegacyClaimEnvironmentIdentity
  terminationMethod: BOOT_BOUNDARY_ATTESTED
  bootBoundaryAttestation: LinuxBootBoundaryAttestation
  terminatedAt
  survivingProcessIdentities: ()
  executionEnvironmentTerminationDigest

LegacyClaimEnvironmentTermination =
  DarwinLegacyEnvironmentTermination
  | LinuxLegacyEnvironmentTermination

DarwinExecutionEnvironmentTermination
  executionEnvironmentIdentity: DarwinProofAdmissionExecutionEnvironmentIdentity
  terminationMethod: BOOT_BOUNDARY_ATTESTED
  bootBoundaryAttestation: DarwinBootBoundaryAttestation
  terminatedAt
  survivingProcessIdentities: ()
  executionEnvironmentTerminationDigest

LinuxExecutionEnvironmentTermination
  executionEnvironmentIdentity: LinuxProofAdmissionExecutionEnvironmentIdentity
  terminationMethod: PID_NAMESPACE_INIT_TERMINATED | BOOT_BOUNDARY_ATTESTED
  namespaceTerminationEvidence: LinuxPidNamespaceTerminationEvidence | null
  bootBoundaryAttestation: LinuxBootBoundaryAttestation | null
  survivingProcessIdentities: ()
  terminatedAt
  executionEnvironmentTerminationDigest

ExecutionEnvironmentTermination =
  DarwinExecutionEnvironmentTermination
  | LinuxExecutionEnvironmentTermination

LinuxPidNamespaceTerminationEvidence
  helperIdentity: KernelEvidenceHelperIdentity
  pidfdOwnerPid: positive integer
  pidfdOwnerProcessStartIdentity: LinuxProcessStartIdentity
  pidNamespaceDeviceId: UInt64String
  pidNamespaceInode: UInt64String
  namespaceInitPid: positive integer
  namespaceInitProcessStartIdentity: LinuxProcessStartIdentity
  namespaceInitPidfdOpenedBeforeJobRelease: true
  namespaceInitPidfdLeaseId
  pidfdOwnerSigchldDisposition: DEFAULT
  pidfdOwnerSaNoCldWait: false
  pidfdSoleWaiter: true
  namespaceInitPidfdPollReventsRaw: UInt32String
  namespaceInitPidfdPollInSet: true
  namespaceInitPidfdPollErrorBits: 0
  namespaceInitPidfdPollHupBeforeWait: false
  namespaceInitWaitIdType: P_PIDFD
  namespaceInitWaitIdOptions: WEXITED
  namespaceInitWaitConsumed: true
  namespaceInitWaitStatus: LinuxWaitIdStatus
  postWaitPidfdPollReventsRaw: UInt32String
  postWaitPidfdPollHupSet: true
  postWaitPidfdPollErrorBits: 0
  observedAt
  namespaceTerminationEvidenceDigest

LinuxWaitIdStatus
  = LinuxWaitIdExitedStatus
  | LinuxWaitIdKilledStatus
  | LinuxWaitIdDumpedStatus

LinuxWaitIdExitedStatus
  siPid: positive integer
  siUid: UInt64String
  siCode: CLD_EXITED
  siStatus: integer 0..255
  waitIdStatusDigest

LinuxWaitIdKilledStatus
  siPid: positive integer
  siUid: UInt64String
  siCode: CLD_KILLED
  siStatus: positive signal integer
  waitIdStatusDigest

LinuxWaitIdDumpedStatus
  siPid: positive integer
  siUid: UInt64String
  siCode: CLD_DUMPED
  siStatus: positive signal integer
  waitIdStatusDigest

KernelEvidenceHelperIdentity
  helperKind: BOOT_BOUNDARY | LINUX_PID_NAMESPACE_TERMINATION
  entrypointPath: tooling/acceptance/core/proof_admission.py
  entrypointFunction: capture_boot_boundary | terminate_linux_pid_namespace
  sourceRule: KERNEL_EVIDENCE_HELPER_SOURCE_V1
  sourceFiles: tuple[(repoRelativePath, fileSha256, byteLength), ...]
  sourceDigest
  runtimeManifestRef: DurabilityCapabilityArtifactRef
  runtimeDigest
  helperIdentityDigest

Kernel helper branch constraints:
  BOOT_BOUNDARY:
    entrypointFunction: capture_boot_boundary
  LINUX_PID_NAMESPACE_TERMINATION:
    entrypointFunction: terminate_linux_pid_namespace

`sourceFiles` is the deterministic complete source-only project closure from the
fixed entrypoint/function under `KERNEL_EVIDENCE_HELPER_SOURCE_V1`.
`runtimeManifestRef.artifactName` is `PROBE_RUNTIME_MANIFEST`; resolving it
reconstructs `runtimeDigest`. Caller-selected source files, entrypoints, runtime
refs or function names are invalid.

Termination branch constraints:
  Darwin first D-19 epoch predecessor:
    terminationMethod: BOOT_BOUNDARY_ATTESTED
    type: DarwinLegacyEnvironmentTermination
    legacy hostIdentity: equals attestation priorObservation.hostIdentity
    successor execution environment hostIdentity:
      equals attestation currentObservation.hostIdentity
    successor execution environment epochBootObservationRef:
      resolves exact attestation currentObservation
    successor execution environment epochBootObservationDigest:
      equals attestation currentObservation.observationDigest
    successor supervisorProcessStartIdentity.bootSessionUuid:
      equals attestation currentObservation.bootSessionUuid
    priorObservation.hostIdentity: equals currentObservation.hostIdentity
  Darwin later epoch:
    terminationMethod: BOOT_BOUNDARY_ATTESTED
    bootBoundaryAttestation: DarwinBootBoundaryAttestation
    execution environment epochBootObservationRef: resolves exact attestation priorObservation
    execution environment epochBootObservationDigest: equals priorObservation.observationDigest
    execution environment hostIdentity: equals priorObservation.hostIdentity
    successor execution environment hostIdentity: equals currentObservation.hostIdentity
    priorObservation.hostIdentity: equals currentObservation.hostIdentity
    supervisorProcessStartIdentity.bootSessionUuid: equals priorObservation.bootSessionUuid
  Linux first D-19 epoch predecessor:
    terminationMethod: BOOT_BOUNDARY_ATTESTED
    type: LinuxLegacyEnvironmentTermination
    legacy hostIdentity: equals attestation priorObservation.hostIdentity
    successor execution environment hostIdentity:
      equals attestation currentObservation.hostIdentity
    successor execution environment epochBootObservationRef:
      resolves exact attestation currentObservation
    successor execution environment epochBootObservationDigest:
      equals attestation currentObservation.observationDigest
    successor supervisorProcessStartIdentity.bootId:
      equals attestation currentObservation.bootId
    priorObservation.hostIdentity: equals currentObservation.hostIdentity
  Linux later epoch:
    terminationMethod: PID_NAMESPACE_INIT_TERMINATED
    namespaceTerminationEvidence namespace/init identity: exact prior environment values
    bootBoundaryAttestation: null
  Linux crashed pidfd owner:
    terminationMethod: BOOT_BOUNDARY_ATTESTED
    namespaceTerminationEvidence: null
    bootBoundaryAttestation: LinuxBootBoundaryAttestation
    execution environment epochBootObservationRef: resolves exact attestation priorObservation
    execution environment epochBootObservationDigest: equals priorObservation.observationDigest
    execution environment hostIdentity: equals priorObservation.hostIdentity
    successor execution environment hostIdentity: equals currentObservation.hostIdentity
    priorObservation.hostIdentity: equals currentObservation.hostIdentity
    supervisorProcessStartIdentity.bootId: equals priorObservation.bootId
    attestation currentObservation.bootId: equals successor epoch
      executionEnvironmentIdentity.epochBootObservationRef resolved bootId
    attestation currentObservation.observationDigest: equals successor epoch
      executionEnvironmentIdentity.epochBootObservationDigest
    predecessor epoch startedAt < currentObservation.observedAt <=
      termination.terminatedAt < successor epoch startedAt

ForbiddenProcessApiRule
  grammarId: PYTHON_AST_V1
  operationId: CREATE_PROCESS | REPLACE_PROCESS_IMAGE | EXEC_SHELL | CREATE_SESSION | CHANGE_PROCESS_GROUP | DYNAMIC_SYMBOL_RESOLUTION | LOAD_NATIVE_EXTENSION
  canonicalSymbols: non-empty UTF-8 lexical sorted tuple[string, ...]
  ruleDigest

CLAIM_EMITTER_PRELOADED_FACADES_V1 =
  (canonical_json)

CLAIM_EMITTER_BUILTIN_ALLOWLIST_V1 =
  (None, True, False, bool, dict, int, len, list, range, str, tuple)

CLAIM_EMITTER_AST_ALLOWLIST_V1 =
  (Module, Expr, Assign, Name, Load, Store, Constant, Dict, List, Tuple,
   If, Compare, BoolOp, UnaryOp, Call, Attribute)

Claim-emitter `Attribute` branch constraint:
  value: Name(id=canonical_json, ctx=Load)
  attr: encode | decode
  ctx: Load
  parent: Call.func
  nestedAttribute: forbidden

No other `Attribute` shape is in `CLAIM_EMITTER_AST_ALLOWLIST_V1`; the
allowlisted node name does not authorize general attribute access.

ClaimEmitterInput
  bindingName: authoritative_input
  resolution: AuthoritativeLatestResolution
  encodedUtf8Base64
  inputDigest

ClaimEmitterOutput
  bindingName: authoritative_result
  resolution: AuthoritativeLatestResolution
  encodedUtf8Base64
  outputDigest

ForbiddenProcessApiScan
  policy: NO_CHILD_NO_SESSION_CHANGE_V1
  scannerRule: FORBIDDEN_PROCESS_API_SCANNER_V1
  scannerSourceRule: FORBIDDEN_PROCESS_API_SCANNER_SOURCE_V1
  scannerEntrypointPath: tooling/acceptance/core/proof_admission.py
  scannerEntrypointFunction: scan_forbidden_process_apis
  scannerSourceFiles: tuple[(repoRelativePath, fileSha256, byteLength), ...]
  scannerSourceDigest
  scannerInterpreter: PythonScannerInterpreterIdentity
  scannerRuntimeDigest
  allowedPreloadedFacades: CLAIM_EMITTER_PRELOADED_FACADES_V1
  allowedBuiltins: CLAIM_EMITTER_BUILTIN_ALLOWLIST_V1
  allowedAstNodes: CLAIM_EMITTER_AST_ALLOWLIST_V1
  inputContract: AUTHORITATIVE_RESOLUTION_INPUT_V1
  outputContract: AUTHORITATIVE_RESULT_BINDING_V1
  proofAdmissionSourceDigest
  inspectedNodes: tuple[(repoRelativePath, sourceNodeDigest), ...]
  ruleRegistry: tuple[ForbiddenProcessApiRule, ...]
  ruleRegistryDigest
  findings: ()
  forbiddenProcessApiScanDigest

PythonScannerInterpreterIdentity
  hostOsFamily: DARWIN | LINUX
  hostBuild: RuntimeHostBuild
  hostIdentity: RuntimeHostIdentity
  executablePathHash
  executableSha256
  implementation
  version
  astGrammarFeatureVersion
  stdlibDigest
  scannerRuntimeDigest

ProofAdmissionJobRuntimeIdentity
  processPolicy: NO_CHILD_NO_SESSION_CHANGE_V1
  hostOsFamily: DARWIN | LINUX
  hostBuild: RuntimeHostBuild
  hostIdentity: RuntimeHostIdentity
  executionKind: INTERPRETED_SOURCE
  interpreterKind: PYTHON3
  argv: tuple[string, ...]
  argvDigest
  executablePathHash
  executableSha256
  entrypointPath: string | null
  entrypointFileSha256: string | null
  entrypointSourceNodeDigest: string | null
  interpreterExecutablePathHash: string | null
  interpreterExecutableSha256: string | null
  interpreterImplementation
  interpreterVersion
  astGrammarFeatureVersion
  stdlibDigest
  forbiddenProcessApiScan: ForbiddenProcessApiScan
  jobRuntimeDigest

Job runtime branch constraints:
  INTERPRETED_SOURCE:
    hostOsFamily: DARWIN | LINUX
    interpreterKind: PYTHON3
    argv[0]: verified Python executable
    argv[1]: normalized repo-relative `.py` entrypoint
    entrypointPath: normalized repo-relative path
    entrypointFileSha256: lowercase sha256
    entrypointSourceNodeDigest: string
    interpreterExecutablePathHash: lowercase sha256
    interpreterExecutableSha256: lowercase sha256

ClaimLeaseWrapperIdentity
  hostOsFamily: DARWIN | LINUX
  hostBuild: RuntimeHostBuild
  hostIdentity: RuntimeHostIdentity
  wrapperSourceRule: CLAIM_LEASE_WRAPPER_SOURCE_V1
  wrapperEntrypointPath: tooling/acceptance/core/proof_admission.py
  wrapperEntrypointFunction: run_claim_with_lease
  wrapperSourceFiles: tuple[(repoRelativePath, fileSha256, byteLength), ...]
  wrapperSourceDigest
  wrapperRuntimeDigest
  wrapperPid: positive integer
  wrapperProcessStartIdentity: ProcessStartIdentity
  claimProcessPid: positive integer
  claimProcessStartIdentity: ProcessStartIdentity
  leaseFdPassedToClaim: false
  wrapperIdentityDigest

ClaimLeaseWrapperWaitEvidence
  wrapperPid: positive integer
  wrapperProcessStartIdentity: ProcessStartIdentity
  claimProcessPid: positive integer
  claimProcessStartIdentity: ProcessStartIdentity
  claimWaitStatus: ConsumingChildWaitEvidence
  outputCapturedInternally: true
  leaseReleasedAfterOutputCapture: true
  wrapperWaitStatus: ConsumingChildWaitEvidence
  wrapperWaitEvidenceDigest

ProofAdmissionEpochRecord
  artifactKind: acceptance-proof-admission-epoch
  schemaVersion: 1
  workspaceId
  gateId
  coordinatorEpochId
  executionEnvironmentIdentity: ProofAdmissionExecutionEnvironmentIdentity
  coordinatorPid: positive integer
  coordinatorProcessStartIdentity: ProcessStartIdentity
  sourceCommit
  proofAdmissionSourceDigest
  claimAdmissionLockIdentity: ProofAdmissionLockIdentity
  claimSequenceLockIdentity: ProofAdmissionLockIdentity
  previousEpochRef: ProofAdmissionEpochRef | null
  predecessorEnvironmentTermination: LegacyClaimEnvironmentTermination | ExecutionEnvironmentTermination
  startedAt
  epochDigest

ProofAdmissionEpochRef
  workspaceId
  gateId
  coordinatorEpochId
  epochDigest
  epochRefDigest

ProofAdmissionCurrentEpoch
  artifactKind: acceptance-proof-admission-current-epoch
  schemaVersion: 1
  workspaceId
  gateId
  coordinatorEpochId
  epochDigest
  currentEpochDigest

ProofAdmissionJobRecord
  artifactKind: acceptance-proof-admission-job
  schemaVersion: 1
  workspaceId
  gateId
  coordinatorEpochId
  epochDigest
  claimAdmissionLockIdentity: ProofAdmissionLockIdentity
  claimSequenceLockIdentity: ProofAdmissionLockIdentity
  jobLeaseLockIdentity: ProofAdmissionLockIdentity
  jobSequence: positive integer
  jobId
  claimProcessPid: positive integer
  claimProcessGroupId: positive integer
  claimProcessStartIdentity: ProcessStartIdentity
  runtimeIdentity: ProofAdmissionJobRuntimeIdentity
  leaseWrapperIdentity: ClaimLeaseWrapperIdentity
  emitterInput: ClaimEmitterInput
  expectedResolution: AuthoritativeLatestResolution
  expectedResolutionDigest
  sinkIdentity: ProofAdmissionSinkIdentity
  sourceCommit
  proofAdmissionSourceDigest
  registeredAt
  jobRecordDigest

ProofAdmissionJobCompletion
  artifactKind: acceptance-proof-admission-job-completion
  schemaVersion: 1
  workspaceId
  gateId
  coordinatorEpochId
  jobSequence
  jobRecordDigest
  sinkIdentityDigest
  claimProcessPid
  claimProcessGroupId
  claimProcessStartIdentity
  terminalState: COMPLETED | CANCELLED | REAPED
  terminationProofKind: LEAF_PROCESS_REAPED | EXECUTION_ENVIRONMENT_TERMINATED
  processPolicy: NO_CHILD_NO_SESSION_CHANGE_V1
  processGroupEnumeration: ProofAdmissionProcessGroupEnumeration | null
  output: ClaimEmitterOutput | null
  wrapperWaitStatus: ClaimLeaseWrapperWaitEvidence | null
  executionEnvironmentTermination: ExecutionEnvironmentTermination | null
  orphanRecoveryEvidence: ProofAdmissionOrphanRecoveryEvidence | null
  completedAt
  completionDigest

ProofAdmissionProcessGroupEnumeration
  artifactKind: acceptance-proof-admission-process-group-enumeration
  schemaVersion: 1
  claimProcessGroupId
  claimProcessPid
  claimProcessStartIdentity: ProcessStartIdentity
  observerPid
  observerProcessStartIdentity: ProcessStartIdentity
  observedProcessIdentities: ()
  observedAt
  enumerationDigest

ProofAdmissionOrphanRecoveryEvidence
  artifactKind: acceptance-proof-admission-orphan-recovery
  schemaVersion: 1
  workspaceId
  gateId
  coordinatorEpochId
  epochDigest
  pauseDigest
  claimAdmissionLockIdentity: ProofAdmissionLockIdentity
  exclusiveLockOwnerPid
  exclusiveLockOwnerProcessStartIdentity: ProcessStartIdentity
  jobRecordDigest
  jobLeaseLockIdentity: ProofAdmissionLockIdentity
  jobLeaseProbeResult: ABSENT_EXCLUSIVE_PROBE_ACQUIRED
  processGroupEnumeration: ProofAdmissionProcessGroupEnumeration
  executionEnvironmentTerminationDigest
  observedAt
  recoveryEvidenceDigest

Completion branch constraints:
  create/decode validation:
    requires the exact typed ProofAdmissionEpochRecord resolved by epochDigest
    job source, permanent locks and coordinator epoch: exact epoch values
    wrapper waiter and process-group observer identity: exact epoch coordinator
  COMPLETED:
    terminationProofKind: LEAF_PROCESS_REAPED
    processGroupEnumeration: ProofAdmissionProcessGroupEnumeration
    processGroupEnumeration.claimProcessGroupId: exact job claimProcessGroupId
    processGroupEnumeration claim process identity: exact job claim process
    processGroupEnumeration observer identity: exact coordinator waiter identity
    processGroupEnumeration.observedProcessIdentities: ()
    output: ClaimEmitterOutput
    wrapperWaitStatus: ClaimLeaseWrapperWaitEvidence
    wrapperWaitStatus.claimWaitStatus.status: PosixExitedStatus(exitCode=0)
    wrapperWaitStatus.wrapperWaitStatus.status: PosixExitedStatus(exitCode=0)
    registeredAt <= claimWaitStatus.waitedAt <=
      wrapperWaitStatus.waitedAt <= processGroupEnumeration.observedAt <=
      completedAt
    executionEnvironmentTermination: null
    orphanRecoveryEvidence: null
  CANCELLED:
    terminationProofKind: LEAF_PROCESS_REAPED
    processGroupEnumeration: same exact constraints as COMPLETED
    output: null
    wrapperWaitStatus: ClaimLeaseWrapperWaitEvidence
    wrapperWaitStatus claim/wrapper status: non-zero EXITED or SIGNALED
    executionEnvironmentTermination: null
    orphanRecoveryEvidence: null
  REAPED:
    terminationProofKind: EXECUTION_ENVIRONMENT_TERMINATED
    processGroupEnumeration: null
    output: null
    wrapperWaitStatus: null
    executionEnvironmentTermination: ExecutionEnvironmentTermination
    executionEnvironmentTermination.executionEnvironmentIdentity: byte-equal
      to the exact epoch resolved by the job epochDigest
    orphanRecoveryEvidence: ProofAdmissionOrphanRecoveryEvidence
    orphanRecoveryEvidence resolves the exact pause, exclusive claim lock,
      absent job lease probe, job process identity, empty group enumeration,
      and environment termination
    registeredAt <= terminatedAt <= pausedAt <= group observedAt <=
      orphan recovery observedAt <= completedAt

ProofAdmissionSinkIdentity
  sinkKind: EVIDENCE_STORE_AUTHORITATIVE_CLAIM
  sinkId
  sinkProtocolVersion: IDEMPOTENT_CLAIM_SINK_V1
  destinationNamespaceId: AUTHORITATIVE_CLAIM_RESULTS_V1
  workspaceId
  gateId
  resolverIdentity: ProofAdmissionSinkResolverIdentity
  deadlineMilliseconds: integer 1..10000
  containsCredentialOrEndpoint: false
  sinkIdentityDigest

ProofAdmissionSinkResolverIdentity
  owner: ACCEPTANCE_INFRA
  entrypointPath: tooling/acceptance/core/proof_admission.py
  entrypointFunction: emit_authoritative_claim
  sourceRule: PROOF_ADMISSION_SINK_SOURCE_V1
  sourceFiles: non-empty UTF-8 lexical sorted tuple[(repoRelativePath, fileSha256, byteLength), ...]
  sourceDigest
  backendKind: EVIDENCE_STORE
  backendProtocolVersion: IDEMPOTENT_CLAIM_SINK_V1
  resolverIdentityDigest

ProofAdmissionEmissionIntent
  artifactKind: acceptance-proof-admission-emission-intent
  schemaVersion: 1
  workspaceId
  gateId
  coordinatorEpochId
  jobSequence
  jobRecordDigest
  completionDigest
  expectedResolutionDigest
  outputDigest
  payloadEncoding: JCS_CLAIM_EMITTER_OUTPUT_V1
  payloadBase64
  payloadSha256
  sinkIdentity: ProofAdmissionSinkIdentity
  idempotencyKey
  createdAt
  emissionIntentDigest

ProofAdmissionEmissionAcknowledgement
  artifactKind: acceptance-proof-admission-emission-acknowledgement
  schemaVersion: 1
  workspaceId
  gateId
  coordinatorEpochId
  jobSequence
  jobRecordDigest
  completionDigest
  emissionIntentDigest
  sinkIdentityDigest
  sinkId
  idempotencyKey
  acceptedPayloadSha256
  sinkReceipt: IdempotentClaimSinkReceipt
  acknowledgedAt
  emissionAcknowledgementDigest

Acknowledgement creation and decoding require the exact typed
`ProofAdmissionEmissionIntent`. Intent digest, sink identity, idempotency key,
payload digest and chronology must close over that reference.

IdempotentClaimSinkReceipt
  sinkId
  sinkProtocolVersion: IDEMPOTENT_CLAIM_SINK_V1
  idempotencyKey
  acceptedPayloadSha256
  acceptedAt
  sinkReceiptDigest

ProofAdmissionPauseRecord
  artifactKind: acceptance-proof-admission-pause
  schemaVersion: 1
  workspaceId
  gateId
  coordinatorEpochId
  epochDigest
  claimAdmissionLockIdentity: ProofAdmissionLockIdentity
  claimSequenceLockIdentity: ProofAdmissionLockIdentity
  lastAcceptedJobSequence
  pausedAt
  pauseDigest

ProofAdmissionQuiescence
  artifactKind: acceptance-proof-admission-quiescence
  schemaVersion: 1
  workspaceId
  gateId
  coordinatorEpochId
  epochDigest
  currentEpochDigest
  coordinatorState: PAUSED
  sourceCommit
  proofAdmissionSourceDigest
  claimAdmissionLockIdentity: ProofAdmissionLockIdentity
  claimSequenceLockIdentity: ProofAdmissionLockIdentity
  pauseDigest
  registeredJobs: tuple[(jobSequence, jobRecordDigest), ...]
  terminalJobCompletions: tuple[(jobSequence, completionDigest), ...]
  acknowledgedEmissions: tuple[(jobSequence, emissionAcknowledgementDigest), ...]
  pendingEmissions: ()
  activeJobs: ()
  capturedAt
  quiescenceDigest

Quiescence validation resolves the exact typed epoch, current-epoch selector,
pause, job, completion, emission intent and acknowledgement records named by
these digest tuples. The selector and pause must identify the same epoch; the
pause locks and digest must match, its frozen last sequence must equal the
complete contiguous job set, and it must precede capture. Validation requires
one completion for every job, exactly one intent and acknowledgement for every
`COMPLETED` job, and neither an intent nor acknowledgement for `CANCELLED` or
`REAPED`.

FinalizerAuthorityAuthorization
  artifactKind: acceptance-finalizer-authority-authorization
  schemaVersion: 1
  action: INSTALL_INTERLOCK | ACTIVATE_GENERATION
  authorizationId
  operatorIdentity: AbortOperatorIdentity
  workspaceId
  gateId
  requiredFinalizerId
  targetGeneration: integer | null
  expectedCurrentGeneration: integer | null
  expectedPriorLatestPointer: LatestPointer | null
  expectedPriorLatestPointerDigest: string | null
  requirementDigest: string | null
  configDigest: string | null
  sourceDigest: string | null
  protectedBaselineDigest: string | null
  expectedInterlockDigest: string | null
  proofAdmissionInventoryRule: ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES
  proofAdmissionSourceDigest
  proofAdmissionQuiescence: ProofAdmissionQuiescence | null
  maintenanceRuntime: FinalizerMaintenanceRuntimeIdentity
  durabilityProfile: ProofAuthorityDurabilityProfile
  authoritySourceCommit
  approvalDocumentPath: docs/architecture/acceptance-framework/decisions.md
  approvalDocumentSha256
  decisionId: D-19
  decisionStatus: accepted
  authorizedAt
  confirmationChallengeDigest
  authorizationDigest

Branch constraints:
  INSTALL_INTERLOCK:
    targetGeneration: null
    expectedCurrentGeneration: null
    expectedPriorLatestPointer: LatestPointer | null
    expectedPriorLatestPointerDigest: string | null  # null iff pointer is null
    requirementDigest: null
    configDigest: null
    sourceDigest: null
    protectedBaselineDigest: null
    expectedInterlockDigest: null
    proofAdmissionInventoryRule: ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES
    proofAdmissionSourceDigest: string
    proofAdmissionQuiescence: ProofAdmissionQuiescence
  ACTIVATE_GENERATION:
    targetGeneration: positive integer
    expectedCurrentGeneration: integer | null
    expectedPriorLatestPointer: LatestPointer | null
    expectedPriorLatestPointerDigest: string | null  # null iff pointer is null
    requirementDigest: string
    configDigest: string
    sourceDigest: string
    protectedBaselineDigest: string
    expectedInterlockDigest: string
    proofAdmissionInventoryRule: ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES
    proofAdmissionSourceDigest: string
    proofAdmissionQuiescence: null

For `ACTIVATE_GENERATION`, `targetGeneration=1` requires
`expectedCurrentGeneration=null`; every later activation requires
`expectedCurrentGeneration=targetGeneration-1`. The expected prior pointer is
legacy latest for generation 1 and current-generation latest thereafter; its
digest is null if and only if the pointer is null.
Both actions require the complete `maintenanceRuntime`. The CLI compares its
supervisor digest with `SUPERVISOR_READY`, its Python/stdlib identity with the
launched worker, and its worker source digest with the source-only loaded bytes.
Each maintenance request repeats `expectedMaintenanceRuntimeDigest`; supervisor
and worker reject before mutation unless it equals both the authorization and the
live runtime identity. Every
`FinalizerAuthorityAuthorization.maintenanceRuntime.runtimeArtifacts[*].authorizationId`
must equal the enclosing authorization ID. `PersistAuthorityRuntimeRequest.authorizationId`
must equal that same ID, and its candidate runtime must contain no ref for any
other authorization. Abort applies the identical equality against
`AbortAuthorization.authorizationId`. Each request also repeats
`expectedDurabilityProfileDigest`; worker mutation is forbidden unless it equals
the authorization profile, the opened authority-root profile, and the live
platform backend.

DescriptorClaim
  role: GATE_DIRECTORY | RUN_DIRECTORY | REPOSITORY_ROOT | TEMPORARY_DIRECTORY
  deviceId: UInt64String
  inode: UInt64String
  fileType: DIRECTORY
  ownerBinding: DescriptorOwnerBinding
  ownerBindingDigest
  descriptorClaimDigest

GateDirectoryOwnerBinding
  role: GATE_DIRECTORY
  workspaceId
  gateId

RunDirectoryOwnerBinding
  role: RUN_DIRECTORY
  workspaceId
  gateId
  evidenceRunId

RepositoryRootOwnerBinding
  role: REPOSITORY_ROOT
  workspaceId
  sourceCommit
  workspaceDigest
  canonicalWorktreeHash

TemporaryDirectoryOwnerBinding
  role: TEMPORARY_DIRECTORY
  supervisorSessionId
  requestId
  tempNonce

DescriptorOwnerBinding =
  GateDirectoryOwnerBinding
  | RunDirectoryOwnerBinding
  | RepositoryRootOwnerBinding
  | TemporaryDirectoryOwnerBinding

WorkerRequestIdentity
  supervisorSessionId
  requestId
  sequence
  workerKind: AUTHORITY_RUNTIME_PERSISTER | MAINTENANCE | BUNDLE_PREPARER | RUNTIME_CAPTURE | MATERIALIZER | FINALIZER
  descriptorClaims: tuple[DescriptorClaim, ...]
  requestPayloadDigest
  requestIdentityDigest

PrepareBundleRequest
  identity: WorkerRequestIdentity
  sourceInventory: tuple[(repoRelativePath, expectedSha256), ...]
  entrypoint
  fileLimit: 64
  pathByteLimit: 512
  manifestByteLimit: 256 KiB
  entryByteLimit: 8 MiB
  bundleByteLimit: 64 MiB
  expandedByteLimit: 64 MiB
  temporaryStorageByteLimit: 128 MiB
  timeoutSeconds: 60

BundlePreparationCompleted
  identity: WorkerRequestIdentity
  status: COMPLETED
  captureId
  sourceCaptureBundleDigest
  expandedInventory: tuple[(repoRelativePath, fileSha256, byteLength), ...]
  workerResultDigest
  failureCode: null
  diagnostic: null

BundlePreparationFailed
  identity: WorkerRequestIdentity
  status: FAILED
  captureId: null
  sourceCaptureBundleDigest: null
  expandedInventory: ()
  workerResultDigest
  failureCode: FINALIZER_BUNDLE_INVALID | FINALIZER_TIMED_OUT | FINALIZER_PROCESS_FAILED
  diagnostic: redacted bounded text

CaptureRuntimeRequest
  identity: WorkerRequestIdentity
  runtimePaths: tuple[RuntimePathInput, ...]
  fileLimit: 1024
  singleFileByteLimit: 256 MiB
  cumulativeByteLimit: 512 MiB
  timeoutSeconds: 60

`runtimePaths` contains only caller-selected executable/compiler/FILE-stdlib
inputs. `LOADED_RUNTIME_IMAGE` is forbidden in `RuntimePathInput`; after loading
the fixed bootstrap/import allowlist, the worker-owned platform loader probe is
the sole source of loaded-image identities and emits file-backed standalone
images into `CapturedRuntimeFile` plus shared-cache identities into
`PreflightRuntimePlatformAttestation`.

CaptureRuntimeCompleted
  identity: WorkerRequestIdentity
  status: COMPLETED
  captureId
  measurement: PreflightRuntimeMeasurement
  files: tuple[CapturedRuntimeFile, ...]
  runtimeCaptureBundleDigest
  runtimeCaptureDigest
  workerResultDigest
  failureCode: null
  diagnostic: null

CaptureRuntimeFailed
  identity: WorkerRequestIdentity
  status: FAILED
  captureId: null
  measurement: null
  files: ()
  runtimeCaptureBundleDigest: null
  runtimeCaptureDigest: null
  workerResultDigest
  failureCode: FINALIZER_RUNTIME_MISMATCH | FINALIZER_TIMED_OUT | FINALIZER_PROCESS_FAILED
  diagnostic: redacted bounded text

MaterializeSnapshotRequest
  identity: WorkerRequestIdentity
  workspaceId
  gateId
  evidenceRunId
  evaluationTime
  artifactInventory: tuple[(roleName, discriminator, ArtifactRef), ...]
  runtimeManifestRef: ArtifactRef
  sourceCommit
  workspaceDigest
  canonicalWorktreeHash
  inputByteLimit
  artifactCountLimit: 4096
  singleArtifactByteLimit: 1 GiB
  cumulativeHashByteLimit: 8 GiB
  timeoutSeconds: 60

MaterializeSnapshotCompleted
  identity: WorkerRequestIdentity
  status: COMPLETED
  snapshot: ReadOnlyEvidenceSnapshot
  workerResultDigest
  failureCode: null
  diagnostic: null

MaterializeSnapshotFailed
  identity: WorkerRequestIdentity
  status: FAILED
  snapshot: null
  workerResultDigest
  failureCode: FINALIZER_MATERIALIZATION_FAILED | FINALIZER_TIMED_OUT | FINALIZER_PROCESS_FAILED
  diagnostic: redacted bounded text

ExecuteFinalizerRequest
  identity: WorkerRequestIdentity
  input: FinalizerInput
  timeoutSeconds
  inputByteLimit

ExecuteFinalizerCompleted
  identity: WorkerRequestIdentity
  status: COMPLETED
  childOutcome: FinalizerChildOutcome
  workerResultDigest
  failureCode: null
  diagnostic: null

ExecuteFinalizerFailed
  identity: WorkerRequestIdentity
  status: FAILED
  childOutcome: null
  workerResultDigest
  failureCode: FINALIZER_RUNTIME_MISMATCH | FINALIZER_INPUT_TOO_LARGE | FINALIZER_OUTPUT_TOO_LARGE | FINALIZER_TIMED_OUT | FINALIZER_CANCELLED | FINALIZER_PROCESS_FAILED | FINALIZER_OUTPUT_INVALID
  diagnostic: redacted bounded text

PersistAuthorityRuntimeRequest
  identity: WorkerRequestIdentity
  workspaceId
  gateId
  authorizationId
  candidateRuntime: FinalizerMaintenanceRuntimeIdentity
  expectedDurabilityProfileDigest
  fileLimit: 1024
  singleFileByteLimit: 256 MiB
  cumulativeByteLimit: 512 MiB
  timeoutSeconds: 60

InstallPublicationInterlockRequest
  identity: WorkerRequestIdentity
  operation: INSTALL_PUBLICATION_INTERLOCK
  workspaceId
  gateId
  candidateInterlock: FinalizerPublicationInterlock
  expectedPriorLatestPointer: LatestPointer | null
  expectedPriorLatestPointerDigest: string | null
  expectedMaintenanceRuntimeDigest
  expectedDurabilityProfileDigest
  byteLimit: 16 KiB
  timeoutSeconds: 60

ActivateEnforcementRequest
  identity: WorkerRequestIdentity
  operation: ACTIVATE_ENFORCEMENT
  workspaceId
  gateId
  intent: FinalizerActivationIntent
  expectedMaintenanceRuntimeDigest
  expectedDurabilityProfileDigest
  entryLimit: 4096
  byteLimit: 16 KiB
  timeoutSeconds: 60

WriteAbortEventRequest
  identity: WorkerRequestIdentity
  operation: WRITE_ABORT_EVENT
  workspaceId
  gateId
  evidenceRunId
  authorizationId
  attemptId
  authorization: AbortAuthorization
  expectedMaintenanceRuntimeDigest
  expectedDurabilityProfileDigest

TombstoneRunRequest
  identity: WorkerRequestIdentity
  operation: TOMBSTONE_RUN
  workspaceId
  gateId
  evidenceRunId
  authorizationId
  attemptId
  expectedSnapshotDigest
  expectedMaintenanceRuntimeDigest
  expectedDurabilityProfileDigest
  deletionPlanEntryLimit: 16384
  deletionPlanByteLimit: 4 MiB
  timeoutSeconds: 60

DeleteTombstoneBatchRequest
  identity: WorkerRequestIdentity
  operation: DELETE_TOMBSTONE_BATCH
  workspaceId
  gateId
  evidenceRunId
  authorizationId
  attemptId
  expectedTombstoneIdentityDigest
  deletionPlanRef: AbortControlArtifactRef
  deletionPlanDigest
  continuationEventDigest: string
  continuationToken: string
  expectedMaintenanceRuntimeDigest
  expectedDurabilityProfileDigest
  entryLimit: 1024
  byteLimit: 1 GiB
  timeoutSeconds: 30

MaintenanceRequest =
  InstallPublicationInterlockRequest
  | ActivateEnforcementRequest
  | WriteAbortEventRequest
  | TombstoneRunRequest
  | DeleteTombstoneBatchRequest

WorkerRequest =
  PrepareBundleRequest
  | CaptureRuntimeRequest
  | MaterializeSnapshotRequest
  | ExecuteFinalizerRequest
  | PersistAuthorityRuntimeRequest
  | MaintenanceRequest

PersistAuthorityRuntimeCompleted
  identity: WorkerRequestIdentity
  status: COMPLETED
  durableBoundary: AUTHORITY_RUNTIME_DURABLE
  maintenanceRuntimeDigest
  failureCode: null
  workerResultDigest
  diagnostic: null

PersistAuthorityRuntimeFailed
  identity: WorkerRequestIdentity
  status: FAILED
  durableBoundary: AUTHORITY_RUNTIME_MAY_BE_DURABLE
  maintenanceRuntimeDigest
  failureCode: FINALIZER_AUTHORITY_RUNTIME_IO_FAILED
  workerResultDigest
  diagnostic: redacted bounded text

PersistAuthorityRuntimeRejected
  identity: WorkerRequestIdentity
  status: REJECTED
  durableBoundary: NO_MUTATION
  maintenanceRuntimeDigest: null
  failureCode: FINALIZER_RUNTIME_MISMATCH | FINALIZER_DURABILITY_PROFILE_UNSUPPORTED | FINALIZER_AUTHORITY_RUNTIME_IO_FAILED | FINALIZER_INPUT_TOO_LARGE | FINALIZER_TIMED_OUT | FINALIZER_PROCESS_FAILED
  workerResultDigest
  diagnostic: redacted bounded text

Authority-runtime persistence branch constraints:

- `PersistAuthorityRuntimeRejected/NO_MUTATION` may carry
  `FINALIZER_AUTHORITY_RUNTIME_IO_FAILED | FINALIZER_TIMED_OUT |
  FINALIZER_PROCESS_FAILED` only when no final
  `runtime/<authorization-id>/identity.json` or blob path was published. Temporary
  or unreferenced content-addressed files may remain diagnostic and have no proof
  authority.
- Once any final blob or identity publication is attempted, every write,
  rename, file sync, directory sync, Darwin anchor full-sync, ACK loss or
  timeout/I/O failure returns
  `PersistAuthorityRuntimeFailed/AUTHORITY_RUNTIME_MAY_BE_DURABLE` with
  `FINALIZER_AUTHORITY_RUNTIME_IO_FAILED`; timeout/process/I/O distinctions remain
  redacted diagnostic detail because the only authoritative fact is uncertain
  publication.
  Retry resolves the complete expected set, validates exact bytes and replays
  the bound durability backend before it may return
  `AUTHORITY_RUNTIME_DURABLE`.
  Completed and failed results require
  `maintenanceRuntimeDigest ==
  PersistAuthorityRuntimeRequest.candidateRuntime.maintenanceRuntimeDigest`;
  rejected results require null. Request identity equality alone cannot replace
  this cross-field check.

InstallPublicationInterlockCompleted
  identity: WorkerRequestIdentity
  operation: INSTALL_PUBLICATION_INTERLOCK
  status: COMPLETED
  durableBoundary: INTERLOCK_DURABLE
  interlockDigest: string
  failureCode: null
  resultDigest
  diagnostic: null

InstallPublicationInterlockFailed
  identity: WorkerRequestIdentity
  operation: INSTALL_PUBLICATION_INTERLOCK
  status: FAILED
  durableBoundary: INTERLOCK_MAY_BE_DURABLE
  interlockDigest: string
  failureCode: MAINTENANCE_TIMED_OUT | MAINTENANCE_IO_FAILED
  resultDigest
  diagnostic: redacted bounded text

InstallPublicationInterlockRejected
  identity: WorkerRequestIdentity
  operation: INSTALL_PUBLICATION_INTERLOCK
  status: REJECTED
  durableBoundary: NO_MUTATION
  interlockDigest: null
  failureCode: MAINTENANCE_IDENTITY_MISMATCH | MAINTENANCE_REQUEST_INVALID | MAINTENANCE_DURABILITY_PROFILE_UNSUPPORTED | MAINTENANCE_DURABLE_STATE_CONFLICT | MAINTENANCE_TIMED_OUT | MAINTENANCE_IO_FAILED
  resultDigest
  diagnostic: redacted bounded text

ActivateEnforcementCompleted
  identity: WorkerRequestIdentity
  operation: ACTIVATE_ENFORCEMENT
  status: COMPLETED
  durableBoundary: ACTIVATED
  generation: integer
  enforcementDigest: string
  failureCode: null
  resultDigest
  diagnostic: null

ActivateEnforcementFailed
  identity: WorkerRequestIdentity
  operation: ACTIVATE_ENFORCEMENT
  status: FAILED
  durableBoundary: PENDING_DURABLE | GENERATION_DURABLE | ACTIVATION_SENTINEL_DURABLE | CURRENT_DURABLE
  generation: integer
  enforcementDigest: string
  failureCode: MAINTENANCE_TIMED_OUT | MAINTENANCE_IO_FAILED
  resultDigest
  diagnostic: redacted bounded text

ActivateEnforcementRejected
  identity: WorkerRequestIdentity
  operation: ACTIVATE_ENFORCEMENT
  status: REJECTED
  durableBoundary: NO_MUTATION
  generation: integer | null
  enforcementDigest: null
  failureCode: MAINTENANCE_ACTIVE_RUN | MAINTENANCE_IDENTITY_MISMATCH | MAINTENANCE_REQUEST_INVALID | MAINTENANCE_DURABILITY_PROFILE_UNSUPPORTED | MAINTENANCE_DURABLE_STATE_CONFLICT | MAINTENANCE_LIMIT_EXCEEDED | MAINTENANCE_TIMED_OUT | MAINTENANCE_IO_FAILED
  resultDigest
  diagnostic: redacted bounded text

MaintenanceFailureCode =
  MAINTENANCE_IDENTITY_MISMATCH
  | MAINTENANCE_REQUEST_INVALID
  | MAINTENANCE_DURABILITY_PROFILE_UNSUPPORTED
  | MAINTENANCE_DURABLE_STATE_CONFLICT
  | MAINTENANCE_ACTIVE_RUN
  | MAINTENANCE_LIMIT_EXCEEDED
  | MAINTENANCE_TIMED_OUT
  | MAINTENANCE_IO_FAILED

WriteAuthorizationCompleted
  identity: WorkerRequestIdentity
  operation: WRITE_ABORT_EVENT
  status: COMPLETED
  durableBoundary: EVENT_DURABLE
  authorizationId
  attemptId
  eventType: AUTHORIZED
  eventDigest: string
  failureCode: null
  resultDigest
  diagnostic: null

WriteAuthorizationFailed
  identity: WorkerRequestIdentity
  operation: WRITE_ABORT_EVENT
  status: FAILED
  durableBoundary: NONE | EVENT_MAY_BE_DURABLE
  authorizationId
  attemptId
  eventType: AUTHORIZED
  eventDigest: string | null
  failureCode: MaintenanceFailureCode
  resultDigest
  diagnostic: redacted bounded text

`WriteAuthorizationFailed` branch constraints:

- Both branches require `authorizationId` and `attemptId` to equal
  `WriteAbortEventRequest.authorizationId/attemptId` and the embedded
  `AbortAuthorization`; a mismatch is not a structurally valid result.
- `NONE`: `eventDigest=null`; failure is proven before final-path publication and
  code is `MAINTENANCE_IDENTITY_MISMATCH | MAINTENANCE_REQUEST_INVALID |
  MAINTENANCE_DURABILITY_PROFILE_UNSUPPORTED | MAINTENANCE_DURABLE_STATE_CONFLICT | MAINTENANCE_LIMIT_EXCEEDED |
  MAINTENANCE_TIMED_OUT | MAINTENANCE_IO_FAILED`.
- `EVENT_MAY_BE_DURABLE`: `eventDigest` is the candidate AUTHORIZED digest and
  code is `MAINTENANCE_TIMED_OUT | MAINTENANCE_IO_FAILED` for post-publication uncertainty. Retry resolves
  only fixed `authorized.json`, validates exact bytes, and applies the global
  file/directory re-fsync rule before returning `EVENT_DURABLE` or advancing.

TombstoneRunCompleted
  identity: WorkerRequestIdentity
  operation: TOMBSTONE_RUN
  status: COMPLETED
  durableBoundary: TOMBSTONED_EVENT_DURABLE
  authorizationId
  attemptId
  deletionPlanRef: AbortControlArtifactRef
  deletionPlanDigest
  continuationToken
  tombstonedEventDigest: string
  failureCode: null
  resultDigest
  diagnostic: null

TombstoneRunFailed
  identity: WorkerRequestIdentity
  operation: TOMBSTONE_RUN
  status: FAILED
  durableBoundary: AUTHORIZATION_DURABLE | RUN_TOMBSTONED
  authorizationId
  attemptId
  deletionPlanRef: AbortControlArtifactRef | null
  deletionPlanDigest: string | null
  continuationToken: null
  tombstonedEventDigest: null
  failureCode: MaintenanceFailureCode
  resultDigest
  diagnostic: redacted bounded text

`TombstoneRunFailed` branch constraints:

- `AUTHORIZATION_DURABLE`: `deletionPlanRef=null`,
  `deletionPlanDigest=null`, `continuationToken=null`,
  `tombstonedEventDigest=null`; code is
  `MAINTENANCE_IDENTITY_MISMATCH | MAINTENANCE_REQUEST_INVALID |
  MAINTENANCE_DURABILITY_PROFILE_UNSUPPORTED | MAINTENANCE_DURABLE_STATE_CONFLICT | MAINTENANCE_LIMIT_EXCEEDED |
  MAINTENANCE_TIMED_OUT | MAINTENANCE_IO_FAILED`;
- `RUN_TOMBSTONED`: `deletionPlanRef` and `deletionPlanDigest` are either both
  null or both non-null; `continuationToken=null` and
  `tombstonedEventDigest=null`; code is `MAINTENANCE_LIMIT_EXCEEDED |
  MAINTENANCE_TIMED_OUT | MAINTENANCE_IO_FAILED`. A non-null pair means the deletion plan may be
  visible and must pass the global equal-bytes re-fsync rule before retry may
  publish `TOMBSTONED`.

DeleteTombstoneBatchCompleted
  identity: WorkerRequestIdentity
  operation: DELETE_TOMBSTONE_BATCH
  status: COMPLETED
  durableBoundary: DELETED_EVENT_DURABLE
  authorizationId
  attemptId
  deletedEntries: integer
  deletedBytes: integer
  continuationToken: null
  terminalEventDigest: string
  failureCode: null
  resultDigest
  diagnostic: null

DeleteTombstoneBatchIncomplete
  identity: WorkerRequestIdentity
  operation: DELETE_TOMBSTONE_BATCH
  status: INCOMPLETE
  durableBoundary: FAILED_EVENT_DURABLE
  authorizationId
  attemptId
  deletedEntries: integer
  deletedBytes: integer
  continuationToken: string
  terminalEventDigest: string
  failureCode: MAINTENANCE_LIMIT_EXCEEDED
  resultDigest
  diagnostic: redacted bounded text

DeleteTombstoneBatchFailed
  identity: WorkerRequestIdentity
  operation: DELETE_TOMBSTONE_BATCH
  status: FAILED
  durableBoundary: FAILED_EVENT_DURABLE
  authorizationId
  attemptId
  deletedEntries: integer
  deletedBytes: integer
  continuationToken: string
  terminalEventDigest: string
  failureCode: MaintenanceFailureCode
  resultDigest
  diagnostic: redacted bounded text

DeleteTombstoneBatchRejected
  identity: WorkerRequestIdentity
  operation: DELETE_TOMBSTONE_BATCH
  status: REJECTED
  durableBoundary: NO_MUTATION
  authorizationId
  attemptId
  deletedEntries: 0
  deletedBytes: 0
  continuationToken: null
  terminalEventDigest: null
  failureCode: MAINTENANCE_IDENTITY_MISMATCH | MAINTENANCE_REQUEST_INVALID | MAINTENANCE_DURABILITY_PROFILE_UNSUPPORTED | MAINTENANCE_DURABLE_STATE_CONFLICT | MAINTENANCE_TIMED_OUT | MAINTENANCE_IO_FAILED
  resultDigest
  diagnostic: redacted bounded text

`DeleteTombstoneBatchRejected/NO_MUTATION` permits timeout or I/O failure only
when Core proves no `DELETE_BATCH_STARTED` final-path publication was attempted
and no unlink was attempted.
After that boundary, timeout/I/O/identity failure must use
`DeleteTombstoneBatchFailed/FAILED_EVENT_DURABLE` with the exact started attempt
and a non-null continuation token; it may never be relabeled `NO_MUTATION`.

InstallPublicationInterlockResult =
  InstallPublicationInterlockCompleted
  | InstallPublicationInterlockFailed
  | InstallPublicationInterlockRejected

ActivateEnforcementResult =
  ActivateEnforcementCompleted
  | ActivateEnforcementFailed
  | ActivateEnforcementRejected

WriteAbortEventResult =
  WriteAuthorizationCompleted
  | WriteAuthorizationFailed

TombstoneRunResult =
  TombstoneRunCompleted
  | TombstoneRunFailed

DeleteTombstoneBatchResult =
  DeleteTombstoneBatchCompleted
  | DeleteTombstoneBatchIncomplete
  | DeleteTombstoneBatchFailed
  | DeleteTombstoneBatchRejected

MaintenanceResult =
  InstallPublicationInterlockResult
  | ActivateEnforcementResult
  | WriteAbortEventResult
  | TombstoneRunResult
  | DeleteTombstoneBatchResult

MaintenanceRequestResultMatrix
  INSTALL_PUBLICATION_INTERLOCK:
    request: InstallPublicationInterlockRequest
    results: InstallPublicationInterlockResult
  ACTIVATE_ENFORCEMENT:
    request: ActivateEnforcementRequest
    results: ActivateEnforcementResult
  WRITE_ABORT_EVENT:
    request: WriteAbortEventRequest
    results: WriteAbortEventResult
  TOMBSTONE_RUN:
    request: TombstoneRunRequest
    results: TombstoneRunResult
  DELETE_TOMBSTONE_BATCH:
    request: DeleteTombstoneBatchRequest
    results: DeleteTombstoneBatchResult

The decoder selects exactly one matrix row from the request's closed
`operation`. The result must belong to that row, repeat the same operation and
carry the byte-equal `WorkerRequestIdentity`; a cross-row result is invalid
before its status, durable boundary or payload is interpreted.

WorkerResult =
  BundlePreparationCompleted
  | BundlePreparationFailed
  | CaptureRuntimeCompleted
  | CaptureRuntimeFailed
  | MaterializeSnapshotCompleted
  | MaterializeSnapshotFailed
  | ExecuteFinalizerCompleted
  | ExecuteFinalizerFailed
  | PersistAuthorityRuntimeCompleted
  | PersistAuthorityRuntimeFailed
  | PersistAuthorityRuntimeRejected
  | MaintenanceResult

WorkerContractMatrix
  AUTHORITY_RUNTIME_PERSISTER:
    request: PersistAuthorityRuntimeRequest
    results: PersistAuthorityRuntimeCompleted | PersistAuthorityRuntimeFailed | PersistAuthorityRuntimeRejected
    descriptorRoles: (GATE_DIRECTORY, TEMPORARY_DIRECTORY)
  BUNDLE_PREPARER:
    request: PrepareBundleRequest
    results: BundlePreparationCompleted | BundlePreparationFailed
    descriptorRoles: (REPOSITORY_ROOT, TEMPORARY_DIRECTORY)
  RUNTIME_CAPTURE:
    request: CaptureRuntimeRequest
    results: CaptureRuntimeCompleted | CaptureRuntimeFailed
    descriptorRoles: (TEMPORARY_DIRECTORY)
  MATERIALIZER:
    request: MaterializeSnapshotRequest
    results: MaterializeSnapshotCompleted | MaterializeSnapshotFailed
    descriptorRoles: (RUN_DIRECTORY)
  FINALIZER:
    request: ExecuteFinalizerRequest
    results: ExecuteFinalizerCompleted | ExecuteFinalizerFailed
    descriptorRoles: ()
  MAINTENANCE:
    request: MaintenanceRequest
    results: MaintenanceResult
    operationMatrix: MaintenanceRequestResultMatrix
    descriptorRoles: (GATE_DIRECTORY)

SupervisorReadyFrame
  frameType: SUPERVISOR_READY
  supervisorSessionId
  supervisorRuntimeDigest
  protocolVersion
  frameDigest

WorkerRequestFrame
  frameType: WORKER_REQUEST
  identity: WorkerRequestIdentity
  request: WorkerRequest
  frameDigest

DescriptorTransferFrame
  frameType: DESCRIPTOR_TRANSFER
  identity: WorkerRequestIdentity
  descriptorClaimDigests: tuple[string, ...]
  frameDigest

RequestAcceptedFrame
  frameType: REQUEST_ACCEPTED
  identity: WorkerRequestIdentity
  acceptedDescriptorClaimDigests: tuple[string, ...]
  frameDigest

WorkerArmedFrame
  frameType: WORKER_ARMED
  identity: WorkerRequestIdentity
  pid
  pgid
  timerKind: ITIMER_REAL
  timerSeconds
  frameDigest

WorkerReadyFrame
  frameType: WORKER_READY
  identity: WorkerRequestIdentity
  validatedDescriptorClaimDigests: tuple[string, ...]
  timerRemainingMicros
  frameDigest

WorkerDiagnosticFrame
  frameType: WORKER_DIAGNOSTIC
  identity: WorkerRequestIdentity
  stream: STDOUT | STDERR
  chunkSequence
  chunkBase64
  finalChunk: boolean
  frameDigest

WorkerResultFrame
  frameType: WORKER_RESULT
  identity: WorkerRequestIdentity
  result: WorkerResult
  frameDigest

WorkerExitedFrame
  frameType: WORKER_EXITED
  identity: WorkerRequestIdentity
  exitCode: integer
  frameDigest

WorkerSignaledFrame
  frameType: WORKER_SIGNALED
  identity: WorkerRequestIdentity
  signalNumber: positive integer
  frameDigest

WorkerTimeoutFrame
  frameType: WORKER_TIMEOUT
  identity: WorkerRequestIdentity
  deadlineOwner: CHILD_ITIMER_REAL | SUPERVISOR_MONOTONIC
  frameDigest

WorkerCancelledFrame
  frameType: WORKER_CANCELLED
  identity: WorkerRequestIdentity
  reason: ORCHESTRATOR_CANCEL | SESSION_CLOSE
  frameDigest

WorkerCancelRequestFrame
  frameType: WORKER_CANCEL_REQUEST
  identity: WorkerRequestIdentity
  reason: ORCHESTRATOR_CANCEL | SESSION_CLOSE
  frameDigest

SupervisorCloseFrame
  frameType: SUPERVISOR_CLOSE
  supervisorSessionId
  lastSequence
  frameDigest

SupervisorCloseAckFrame
  frameType: SUPERVISOR_CLOSE_ACK
  supervisorSessionId
  lastSequence
  allWorkersReaped: true
  frameDigest

SupervisorControlFrame =
  SupervisorReadyFrame
  | WorkerRequestFrame
  | RequestAcceptedFrame
  | WorkerArmedFrame
  | WorkerReadyFrame
  | WorkerDiagnosticFrame
  | WorkerResultFrame
  | WorkerExitedFrame
  | WorkerSignaledFrame
  | WorkerTimeoutFrame
  | WorkerCancelledFrame
  | WorkerCancelRequestFrame
  | SupervisorCloseFrame
  | SupervisorCloseAckFrame

SupervisorAncillaryFrame = DescriptorTransferFrame

SupervisorSession
  state: STARTING | READY | REQUEST_ACTIVE | CLOSING | CLOSED | FAILED
  supervisorSessionId
  nextSequence
  failureCode: typed code | null
  closedAfterFailure: boolean

FinalizationReadyReservation  # process-local, owned by live RunHandle
  state: READY
  invocationDigest: null
  cachedOutcome: null
  completedAt: null
  manifestBytes: null
  manifestDigest: null
  latestPointerBytes: null
  latestPointerDigest: null
  latestDisposition: null

FinalizationInvocationStartedReservation
  state: INVOCATION_STARTED
  invocationDigest: string
  cachedOutcome: null
  completedAt: null
  manifestBytes: null
  manifestDigest: null
  latestPointerBytes: null
  latestPointerDigest: null
  latestDisposition: null

FinalizationOutcomeCachedReservation
  state: OUTCOME_CACHED
  invocationDigest: string
  cachedOutcome: GateEvidenceFinalization
  completedAt: null
  manifestBytes: null
  manifestDigest: null
  latestPointerBytes: null
  latestPointerDigest: null
  latestDisposition: null

FinalizationManifestPreparedReservation
  state: MANIFEST_PREPARED
  invocationDigest: string
  cachedOutcome: GateEvidenceFinalization
  completedAt: string
  manifestBytes: bytes
  manifestDigest: string
  latestPointerBytes: bytes
  latestPointerDigest: string
  latestDisposition: null

FinalizationManifestDurableReservation
  state: MANIFEST_DURABLE
  invocationDigest: string
  cachedOutcome: GateEvidenceFinalization
  completedAt: string
  manifestBytes: bytes
  manifestDigest: string
  latestPointerBytes: bytes
  latestPointerDigest: string
  latestDisposition: null

FinalizationLatestResolvedReservation
  state: LATEST_RESOLVED
  invocationDigest: string
  cachedOutcome: GateEvidenceFinalization
  completedAt: string
  manifestBytes: bytes
  manifestDigest: string
  latestPointerBytes: bytes
  latestPointerDigest: string
  latestDisposition: PUBLISHED | ALREADY_CURRENT | SUPERSEDED

FinalizationInvocationReservation =
  FinalizationReadyReservation
  | FinalizationInvocationStartedReservation
  | FinalizationOutcomeCachedReservation
  | FinalizationManifestPreparedReservation
  | FinalizationManifestDurableReservation
  | FinalizationLatestResolvedReservation

AbortEventAuthorizationProjection
  authorizationId
  authorizedAt
  workspaceId
  gateId
  evidenceRunId
  runDirectoryClaim: DescriptorClaim  # role=RUN_DIRECTORY
  snapshotDigest
  requirementDigest
  reasonCode: AbortReasonCode
  operatorIdentity: AbortOperatorIdentity
  authoritySourceCommit
  proofAdmissionInventoryRule: ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES
  proofAdmissionSourceDigest
  maintenanceRuntime: FinalizerMaintenanceRuntimeIdentity
  durabilityProfile: ProofAuthorityDurabilityProfile
  confirmationChallengeDigest

AbortSealedAuditEvent
  eventType: AUTHORIZED | TOMBSTONED | DELETE_BATCH_STARTED | DELETED | FAILED
  eventSequence: positive integer
  previousEventDigest: string | null
  authorization: AbortEventAuthorizationProjection
  attemptId
  tombstoneIdentityDigest
  deletionPlanRef: AbortControlArtifactRef | null
  deletionPlanDigest: string | null
  completionSource: DELETE_BATCH_STARTED | TERMINAL_FAILED | null
  batchEndIndexExclusive: integer | null
  nextTraversalIndex: integer | null
  continuationToken: string | null
  recordedAt
  diagnostic: redacted bounded text | null
  eventDigest

Abort event branch constraints:
  AUTHORIZED:
    eventSequence: 1
    previousEventDigest: null
    attemptId: AbortAuthorization.attemptId
    deletionPlanRef: null
    deletionPlanDigest: null
    completionSource: null
    batchEndIndexExclusive: null
    nextTraversalIndex: null
    continuationToken: null
    diagnostic: null
  TOMBSTONED:
    eventSequence: 2
    previousEventDigest: AUTHORIZED.eventDigest
    attemptId: AUTHORIZED.attemptId
    deletionPlanRef: AbortControlArtifactRef
    deletionPlanDigest: string
    completionSource: null
    batchEndIndexExclusive: null
    nextTraversalIndex: 0
    continuationToken: string
    diagnostic: null
  DELETE_BATCH_STARTED:
    eventSequence: previous.eventSequence + 1
    previousEventDigest: TOMBSTONED.eventDigest | FAILED.eventDigest
    deletionPlanRef: AbortControlArtifactRef
    deletionPlanDigest: string
    completionSource: null
    batchEndIndexExclusive: positive integer
    nextTraversalIndex: non-negative integer
    continuationToken: string  # exact input chain-head token
    diagnostic: null
  FAILED:
    eventSequence: DELETE_BATCH_STARTED.eventSequence + 1
    previousEventDigest: DELETE_BATCH_STARTED.eventDigest
    attemptId: DELETE_BATCH_STARTED.attemptId
    deletionPlanRef: AbortControlArtifactRef
    deletionPlanDigest: string
    completionSource: null
    batchEndIndexExclusive: null
    nextTraversalIndex: non-negative integer
    continuationToken: string
    diagnostic: redacted bounded text
  DELETED:
    deletionPlanRef: AbortControlArtifactRef
    deletionPlanDigest: string
    completionSource: DELETE_BATCH_STARTED | TERMINAL_FAILED
    batchEndIndexExclusive: null
    nextTraversalIndex: null
    continuationToken: null
    diagnostic: null

`DELETED` with `completionSource=DELETE_BATCH_STARTED` requires
`eventSequence=started.sequence+1`, `previousEventDigest=started.eventDigest`, and
the same attempt ID. `completionSource=TERMINAL_FAILED` requires a new explicit
retry attempt ID, `eventSequence=failed.sequence+1`,
`previousEventDigest=failed.eventDigest`, `failed.nextTraversalIndex ==
deletionPlan.entries.length`, and the failed event's preceding started range to
contain the explicit `TOMBSTONE_ROOT`.

`AUTHORIZED.authorization` is the exact projection of `AbortAuthorization`.
`project_abort_authorization(authorization)` copies exactly
`authorizationId/authorizedAt/operatorIdentity/reasonCode/workspaceId/gateId/
evidenceRunId/runDirectoryClaim/snapshotDigest/requirementDigest/authoritySourceCommit/
proofAdmissionInventoryRule/proofAdmissionSourceDigest/maintenanceRuntime/durabilityProfile/
confirmationChallengeDigest` and excludes only the command-scoped `attemptId`.
Every later event must copy that projection byte-for-byte from
`authorized.json`; authorization ID equality alone is insufficient. It must also
copy the same `tombstoneIdentityDigest`. Any workspace/Gate/run, snapshot,
requirement, reason, operator or challenge substitution invalidates the entire
event chain before mutation.

AbortOperatorIdentity
  identityKind: POSIX_EFFECTIVE_UID
  principalId: "posix-euid:<decimal>"

AbortReasonCode =
  OPERATOR_REQUESTED_DISCARD
  | STORAGE_RECLAMATION
  | SUPERSEDED_UNPUBLISHED_RUN

AbortSealedPreflightRequest
  workspaceId
  gateId
  evidenceRunId
  authorizationId
  attemptId
  sourceCommit
  durabilityProfileDigest
  abortPreflightRequestDigest

AbortSealedPreflightRejected
  request: AbortSealedPreflightRequest
  status: REJECTED
  durableBoundary: NO_MUTATION
  failureCode: ABORT_SEALED_DELETE_UNSUPPORTED
  hostOsFamily: DARWIN | LINUX
  diagnostic: redacted bounded text
  abortPreflightResultDigest

AbortAuthorization
  authorizationId
  attemptId
  authorizedAt
  operatorIdentity: AbortOperatorIdentity
  reasonCode: AbortReasonCode
  workspaceId
  gateId
  evidenceRunId
  runDirectoryClaim: DescriptorClaim  # role=RUN_DIRECTORY
  snapshotDigest
  requirementDigest
  authoritySourceCommit
  proofAdmissionInventoryRule: ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES
  proofAdmissionSourceDigest
  maintenanceRuntime: FinalizerMaintenanceRuntimeIdentity
  durabilityProfile: ProofAuthorityDurabilityProfile
  confirmationChallengeDigest

AbortControlArtifactRef
  artifactKind: acceptance-abort-control-ref
  schemaVersion: 1
  workspaceId
  gateId
  evidenceRunId
  controlName: deletion-plan
  contentSha256
  controlRefDigest

AbortDeletionPlanEntry
  entryKind: CONTENT | TOMBSTONE_ROOT
  tombstoneRelativePath: string | null
  fileType: REGULAR_FILE | DIRECTORY
  deviceId: UInt64String
  inode: UInt64String
  byteLength: integer | null

Entry constraints:
  CONTENT:
    tombstoneRelativePath: non-empty normalized relative path
    fileType: REGULAR_FILE | DIRECTORY
    byteLength: non-negative integer for REGULAR_FILE; null for DIRECTORY
  TOMBSTONE_ROOT:
    tombstoneRelativePath: null
    fileType: DIRECTORY
    byteLength: null

AbortDeletionPlan
  artifactKind: acceptance-abort-deletion-plan
  schemaVersion: 1
  workspaceId
  gateId
  evidenceRunId
  authorizationId
  tombstoneIdentityDigest
  entries: tuple[AbortDeletionPlanEntry, ...]
  deletionPlanDigest
```

All D-19 wire and persisted objects above are closed schemas recursively.
Decoders must reject duplicate keys, unknown members, missing required members,
wrong nullability, and values outside the declared tagged-union branch before
computing or comparing any digest. A tagged union's discriminator selects one
exact key set; fields from another branch are forbidden even when ignored by
the current implementation. This rule applies to requirement/config/baseline
records, source captures, snapshots, seals, invocation/outcome/finalization
records, authoritative latest resolutions, enforcement authority authorization
and interlock/pending/sentinel/current/generation records, worker
requests/results, abort authorization/events/control refs, and deletion plans.

All JSON integer values in a digest preimage must be within the I-JSON safe
integer range `[-9007199254740991, 9007199254740991]`; counters and byte limits
are additionally non-negative and bounded by their schema. Native unsigned
64-bit values use `UInt64String`, matching `0|[1-9][0-9]*` with numeric value at
most `18446744073709551615`; leading zeros and signs are forbidden. In
particular, `deviceId` and `inode` are never JSON numbers.

`CanonicalOpaqueJson` is the sole recursive-closure exception: its envelope is
closed, but `canonicalUtf8Base64` is an opaque byte string, not a mapping that
generic D-19 decoders may partially interpret. The bytes must decode to UTF-8
JCS JSON, match `byteLength/contentDigest`, and validate against the immutable
`schemaId/schemaDigest`; that schema owns unknown-field policy inside the
document. `SnapshotArtifact.payload` uses the Artifact Role's frozen business
schema. `CanonicalPrimaryResult.document` uses the frozen
`acceptance-primary-result-v1` schema, while its fixed status/reason/source-trace
projection must equal the corresponding fields parsed from the document.
`RequiredFinalizerMapping` is not opaque and accepts exactly `gateId/finalizerId`.

Snapshot artifacts use the total key
`(UTF8(roleName), discriminatorTag, UTF8(discriminatorValue))`, where
`discriminatorTag=0` and value is empty for `null`, otherwise tag is `1` and
the value is the non-empty discriminator string. Duplicate
`(roleName, discriminator)` identities are rejected before sorting/digesting;
singleton-role entries require `null`, while multi-instance entries require a
non-empty discriminator according to the frozen role projection.

### 20.1 D-19 lifecycle transitions

D-19只扩展§13的canonical `RunHandle` lifecycle，不定义自动恢复状态机。未声明
required finalizer或在sealed snapshot形成前失败的run继续走既有
`ACTIVE -> FINALIZING -> DURABLE`；pre-seal failure按§20.4 missing-finalizer分支处理：
primary success降级，已有primary failed/blocked tuple保持。Required-finalizer runtime
preflight先于run allocation；
通过后，Store原子创建durable run directory与lock file、获取live advisory lock并
写入durable `finalization-requirement.json`，再返回`RunHandle`。因此任何已分配
required-finalizer run都有durable requirement record；OS advisory lock本身只代表
live process lease，crash后自动释放，不被描述为durable state。Manifest/latest crash
orphan仍可被repair可靠拒绝。Preflight失败不产生run。

Required-finalizer run仅在live runner持有`.active.lock`期间执行：

```text
Gate exit
  -> all cleanup and Infra artifact writes
  -> bounded redaction/secret audit
  -> ARTIFACTS_SEALED
  -> FINALIZER_RUNNING
  -> SUPERVISOR_CLOSED
  -> FINALIZING
  -> DURABLE
  -> LATEST_RESOLVED
```

`RunHandle`在seal时创建process-local
`FinalizationReadyReservation`。`invoke_finalizer_once()`在同一
run mutex下只允许`READY -> INVOCATION_STARTED`，并在任何finalizer/process outcome后
转为`OUTCOME_CACHED`；其它状态不得再次启动进程。Evidence Store
`finalize_with_evidence()`首次调用时只计算一次`completedAt`、canonical manifest bytes/
digest和latest pointer bytes/digest并缓存，转为`MANIFEST_PREPARED`。Manifest通过
temp+file fsync+atomic no-replace publish+directory fsync写入；若final path已存在，
只有bytes/digest逐项相等且重新fsync manifest file和run directory成功，才视为
丢失ACK后的幂等成功并转为`MANIFEST_DURABLE`。同一
live Runner只能重放缓存bytes，任一输入或时间变化返回typed `EvidenceConflict`。
Latest pointer不是immutable artifact。Evidence Store在gate publish lock内重新读取
generation-scoped latest，并沿用D-11 `(completedAt, runId)`顺序：相同candidate bytes
必须重新fsync pointer file与generation latest directory成功后才是
`ALREADY_CURRENT`；现有pointer更新时以same-directory temp + file fsync + atomic
replace + directory fsync发布并记为`PUBLISHED`；现有pointer更新于candidate时不覆盖并
记为`SUPERSEDED`。三种结果都转为`LATEST_RESOLVED`，但只有latest最终指向该manifest时
该run才是authoritative proof。这样旧run的lost-ACK retry不会覆盖较新的publication。
Each state is represented only by its named closed reservation variant above;
the state-specific nullability and required cached bytes are structural, and
unknown or cross-state fields are rejected before any retry decision.
该reservation不用于跨process crash recovery：runner crash后整个run只能保持
orphan/UNPROVEN并进入显式abort流程。

Finalizer outcome（包括Runner合成的typed failure）产生后，Runner必须先完成
`close_supervisor()`并证明session `CLOSED`，再调用`finalize_with_evidence()`冻结
manifest bytes。若close通过kill fallback成功reap，Core把原outcome替换为
`ERROR/FINALIZER_SUPERVISOR_FAILED`后继续降级发布；若无法reap并进入`CLOSED`，不得
构造manifest或publish latest，run保持sealed orphan。

Runner在任意边界崩溃时不得由下一进程重跑finalizer、补写manifest或恢复publish。
没有latest pointer指向的run保持`INCOMPLETE/UNPROVEN`，即使candidate
`manifest.json`已经durable且其result字段为`PROVEN`。D-11 reader只通过已验证latest
pointer接受权威proof；repair命令不得为required-finalizer orphan manifest重建latest。
Sealed incomplete run绝不能被恢复为proof，普通retention/delete也必须拒绝。唯一
删除入口是显式operator命令：

```bash
# Target-state command; unavailable until D-19 lands.
python3 -I -S -E -B tooling/acceptance/core/authority_cli_bootstrap.py \
  abort-sealed \
  --gate <gate-id> --run <run-id> --reason-code <approved-code>
```

Evidence Store CLI是v1唯一authorization owner，且只支持local interactive invocation。
Abort使用与interlock/activation相同的source-only authority bootstrap、clean current
HEAD、`ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES` closure和maintenance runtime capture；
这些identity进入`AbortAuthorization`及TTY challenge，但abort不要求重新批准已accepted
D-19 decision。
它先只读盘点run/manifest/latest/lock/tombstone影响面并显示exact
workspace/Gate/run/snapshot/reason，再要求控制TTY输入由这些字段JCS digest派生的
confirmation challenge。CLI不接受caller提供的operator identity；它从host kernel
`geteuid()`取得`principalId=posix-euid:<decimal>`，要求stdin/stdout为同一controlling
TTY且real/effective UID一致。该边界依赖既有same-user trusted-host假设，不声称抵抗
已控制该OS账号的攻击者。Non-interactive、sudo identity mismatch或TTY缺失均在写
`AUTHORIZED`前fail closed。

`reasonCode`是closed `AbortReasonCode`，其它字符串拒绝。首次确认后CLI创建完整
`AbortAuthorization`和random `authorizationId`，再交给Evidence Store写
`AUTHORIZED` event。Retry不得重新授权或替换identity：必须从durable
`authorized.json`恢复相同authorization ID、operator principal、reason、
snapshot/requirement digests，并要求当前kernel principal与原principal精确相等；
任一不一致无mutation拒绝。

`WriteAbortEventRequest`只携带closed `AbortAuthorization`，不能携带caller-built
event。Maintenance worker确定性构造唯一AUTHORIZED event：
`eventType=AUTHORIZED`、`eventSequence=1`、`previousEventDigest=null`，
authorization/run/snapshot/requirement/reason/operator/challenge/recordedAt字段逐项来自
authorization（`recordedAt=authorizedAt`），`tombstoneIdentityDigest`按§20.3计算，
`deletionPlanRef/deletionPlanDigest/batchEndIndexExclusive/nextTraversalIndex/
continuationToken/diagnostic`全部为null，再由worker计算event digest并durably
publish。任一existing conflicting
AUTHORIZED bytes拒绝，调用方不能选择sequence、timestamp、tombstone identity或
nullable branch fields。

该命令始终先获取gate-scoped `cleanup`锁；当live run path仍存在时，按全局顺序继续
获取`active(non-blocking) -> finalization -> publish -> abort`并验证requirement
record、sealed marker和manifest/latest状态。Tombstone或audit-only retry没有run-local
lock，按`cleanup -> publish -> abort`获取稳定锁。成功获取active lock后继续持有全部
已获取锁，等待Core 60秒
hard-watchdog ceiling加5秒grace period。这个等待覆盖
任何可能在原runner存活期间启动、随后因parent crash成为orphan的worker；命令不依赖
PID复用不安全的process matching。
全部适用锁都必须使用non-blocking try/retry并共享60秒monotonic acquisition ceiling；
任一锁在ceiling内不可得时，命令返回typed `ABORT_SEALED_LOCK_TIMEOUT`且不写audit、
不rename、不删除。它不会绕过或强制破解仍由live/wedged owner持有的lock。
Audit write/fsync、tombstone rename和每个deletion batch由已READY supervisor下的
Evidence Store-owned `MAINTENANCE` worker执行；blocking filesystem call受对应
60秒/30秒worker deadline约束，timeout后Runner释放locks并根据durable状态显式重试。

Abort audit使用run目录外的append-only event目录
`<workspace-id>/<gate-id>/aborts/<run-id>/`。创建该目录后必须先fsync自身与parent
`aborts/` directory。每个event通过同目录temporary file完整
写入、flush/fsync、atomic no-replace publish（`linkat`或平台等价primitive）并fsync
event directory；已存在final name时必须逐字节相等才视为idempotent。Crash留下的
temporary file不是event，显式重试在校验其不被任何final event引用后删除并重建。
对逐字节相等的existing final event，worker仍必须重新open/fsync event file并fsync
event directory；两次fsync都成功后才能把它当作durable前置条件并继续rename/delete。
任一re-fsync失败保持当前durable boundary、返回typed failure且不得执行后续mutation。
Malformed final event不可能由该publish协议的普通crash产生，按storage corruption
fail closed并停止删除。命令先发布
`authorized.json`，再把run目录原子rename到同文件系统
`<workspace-id>/<gate-id>/aborted-runs/<run-id>/`并fsync source gate directory与
destination `aborted-runs/` directory，随后
在abort event目录以same-directory temporary write、file fsync、atomic no-replace
publish和directory fsync写immutable `deletion-plan.json`；已有final name只有
bytes/digest逐项相等且重新fsync plan file和event directory成功才算幂等成功；
partial temporary file按event temporary规则清理。
Rename lost-ACK retry若观察到run absent且tombstone present，必须先用recorded
run-directory identity验证tombstone，再重新fsync source gate directory和destination
`aborted-runs/` directory；两者成功前不得创建deletion plan或开始delete。
Plan在任何delete
前以`lstat`/no-follow遍历冻结最多16384个、4 MiB metadata的run-relative entries，
记录type/device/inode，并且只为regular file记录byteLength；directory的
`byteLength=null`，因为删除descendant会合法改变ancestor directory size。Entries按
`(path depth descending, UTF-8 path ascending)`排序。Tombstone root不是隐式步骤；
plan必须追加exactly one `TOMBSTONE_ROOT` entry作为最后一项，绑定root
device/inode/type且relative path/byteLength均为null。16384-entry上限包含该root entry；
全部entry的`deviceId`必须等于tombstone root device；发现nested mount/bind mount时
plan creation fail closed，超限不开始删除。Plan使用`AbortControlArtifactRef`而非run-scoped `ArtifactRef`：
resolver只接受已验证`workspaceId/gateId/evidenceRunId`与fixed
`controlName=deletion-plan`，并固定解析到
`aborts/<run-id>/deletion-plan.json`；absolute/path input不存在。随后create-exclusive
写`TOMBSTONED`事件，绑定plan ref/digest
并签发index 0 continuation。只有该event durable后才进入delete protocol。每个batch
在删除前先create-exclusive持久化
`delete-started-<attempt-id>.json`，其`DELETE_BATCH_STARTED` event绑定input
chain-head/token、exact `[nextTraversalIndex, batchEndIndexExclusive)` plan range及
同一attempt ID。只有该event durable后才能对该range执行`unlinkat`。每次显式调用
最多删除1024 entries、1 GiB或30秒，以先到者为准；达到上限时写
`failed-<attempt-id>.json`并使用typed `ABORT_SEALED_INCOMPLETE`，释放全部锁，后续显式
调用读取该durable FAILED event并携带其digest/token从tombstone继续。成功后写
`deleted.json`，其它失败同样写`failed-<attempt-id>.json`并持久化下一cursor。
每个event都绑定
`eventSequence + previousEventDigest + authorization projection + attemptId +
tombstoneIdentityDigest + deletionPlanRef/digest +
completionSource + batchEndIndexExclusive + nextTraversalIndex +
continuationToken`。
`AUTHORIZED`固定sequence 1且previous为null；`TOMBSTONED`固定sequence 2、previous指向
AUTHORIZED并携带index 0 token。每个新batch先写
`delete-started-<attempt-id>.json`中的
`DELETE_BATCH_STARTED(previous=<TOMBSTONED-or-FAILED digest>)`；其
`nextTraversalIndex`是range start、`batchEndIndexExclusive`是range end，
且必须满足`0 <= start < end <= deletionPlan.entries.length`。
`continuationToken`逐字节等于input chain-head token。对应FAILED/DELETED使用
started-event的sequence+1和digest。FAILED event绑定下一immutable plan index和新
continuation token；DELETED的index/token为null。其它event的
`batchEndIndexExclusive`必须为null。Abort lock内必须验证唯一线性chain；同sequence分叉、stale previous
或多个head均按storage corruption fail closed。显式重试只能
继续同一identity-bound abort，不得把
tombstone恢复为run。Reader、repair和retention必须忽略`aborted-runs/`，并拒绝任何有
`aborts/<run-id>/authorized.json`的run ID。这样任意crash只留下可审计、不可发布且只能
由显式abort继续删除的状态。普通retention/delete永远不得删除sealed incomplete run。
该v1选择以删除延迟换取简单且可证明的fail-closed语义。
`abort-sealed`要求requirement与seal identity可验证。若任一记录损坏，run保持
quarantined forensic orphan；v1不提供“corrupt orphan”删除reason，也不允许用raw path、
目录名或部分可解析字段降级授权。处置该状态需要独立架构决策和恢复工具，不能借
normal abort绕过identity proof。
`authorizationId`由首次AUTHORIZED操作生成32-byte cryptographic random lowercase
hex并在所有后续event复用。首次authorization生成initial `attemptId`，该ID由
AUTHORIZED、rename/TOMBSTONED及其lost-ACK retries复用。只有一个durable FAILED
terminal event已闭合前一delete batch时，下一显式delete batch才生成新的attempt ID；
outstanding AUTHORIZED/TOMBSTONED/DELETE_BATCH_STARTED transition retry必须复用其
durable attempt ID。`completionSource=TERMINAL_FAILED`的DELETED使用新explicit retry
attempt ID。Fixed-name event保留首次成功publish它的attempt ID，`FAILED` filename
必须等于其payload `attemptId`。

Abort retry state table：

| Durable state under gate-scoped lock set | Additional run-local locks | Allowed transition |
|---|---|---|
| no authorization; sealed run exists; no latest points to run | active + finalization | write `AUTHORIZED`, then rename to tombstone while keeping opened lock FDs |
| authorization exists and identity matches; run exists; tombstone absent | active + finalization | rename run to tombstone while keeping opened lock FDs |
| authorization exists and identity matches; tombstone exists; run absent; `TOMBSTONED` absent | none | revalidate tombstone identity and re-fsync source/destination rename parents; then freeze immutable deletion plan, atomically publish `TOMBSTONED` with index-0 continuation, and continue bounded deletion |
| authorization and `TOMBSTONED` exist and identities match; tombstone exists; run absent; no open batch | none | validate event-chain head, publish `DELETE_BATCH_STARTED` for the exact next plan range, then delete |
| valid `DELETE_BATCH_STARTED` is the chain head and its terminal event is absent | none | reuse its attempt ID and exact range; present entries must match the plan, missing entries inside that range are treated as prior authorized progress; absent tombstone root is valid only when this range contains the explicit `TOMBSTONE_ROOT` entry |
| valid `FAILED` is the chain head with `nextTraversalIndex == entries.length`; its previous `DELETE_BATCH_STARTED` range contains `TOMBSTONE_ROOT`; run and tombstone are absent | none | re-fsync `aborted-runs`, then publish `DELETED` using a new explicit retry attempt linked to the FAILED head |
| `DELETED` exists with matching identity | none | idempotent success |
| any latest pointer targets run | active + finalization when run exists | reject before authorization and preserve run |
| authorization identity/reason mismatch | none | reject |
| run and tombstone both exist, or both are absent without either an outstanding `DELETE_BATCH_STARTED` covering root or the valid terminal `FAILED` state above | none | storage-corruption failure；不写event、不rename、不删除 |
| only unpublished event temporary file exists | state-dependent | validate no final event references it, delete temp, then retry current transition |
| any final event is malformed or fails digest/identity validation | none | storage-corruption failure; preserve all state and stop |

Every row holds bounded gate-scoped `cleanup -> publish -> abort` locks.
Run-local lock FDs are required only while the live run path exists; after
atomic rename, the current invocation may retain its open FDs, while retries use
the stable gate-scoped abort lock plus immutable audit/tombstone identity.
`FAILED` is append-only diagnostic evidence and does not prevent a later
explicit retry with the same authorization identity.

`seal_for_finalization()`必须：

- 只允许在`ACTIVE`调用一次；
- 在所有cleanup、log、Infra artifact写入和secret audit后执行；
- 先启动并验证native deadline supervisor的`READY` handshake，再获取Store-owned
  跨进程exclusive finalization lock；
- finalization lock必须以non-blocking try/retry和Core 60秒monotonic ceiling获取，
  timeout返回typed failure，不得执行无期限blocking acquire；
- 在该lock内调用受supervisor约束的Core snapshot-materializer，读取、解析并hash完整
  artifact inventory；worker timeout或异常释放lock并保持unsealed/UNPROVEN；
- 在同一lock内检查worker结果与sealed role-instance inventory，然后一次写入durable sealed marker；
- marker原子持久化完整snapshot、finalizer context和primary result digest；
- 收集并验证完整`roleName + discriminator + ArtifactRef` inventory，以
  `(roleName, discriminator)` canonical sort生成snapshot digest；
- 只验证generic role-instance语法、ArtifactRef run identity和文件hash，不解释
  discriminator与业务path/payload的关系；
- 要求所有artifact writer和role registration在同一lock下检查sealed marker，seal后
  返回typed `EvidenceConflict`；
- 让`finalize()`在同一lock下复验marker、精确文件集合、hash和sealed role-instance
  inventory，并只
  消费该sealed snapshot。

`ARTIFACTS_SEALED`后只有Evidence Store owner可以写control-plane
最终manifest；它不是artifact inventory成员。其它写入路径全部关闭，snapshot、
payload和所有digest均不得再构造或变化。Finalizer只接收ArtifactRef中的inert
run-relative path字符串供business identity validation；它不接收artifact root、绝对
path、directory/file FD或任何可把该字符串解析为filesystem object的resolver。
Preflight通过已READY supervisor的`BUNDLE_PREPARER` worker从reviewed source
paths构造canonical length-prefixed source-capture bundle。Native setup只接收verified
repository-root directory FD与validated source inventory，以与artifact materializer
相同的anchored no-follow规则打开source FDs，随后关闭directory FD；generic builder只
接收这些regular-file FDs和owner-only temporary-directory FD，不接收路径解析authority。
Capture bundle包含protected baseline/mapping/registration和Core bootstrap、business
validator、contract、schema。Allocation只从该process-local capture复制exact bytes；
其中`executableIncluded=true`的canonical subset写为
`FinalizerExecutableArtifact.ref`并展开到owner-only temporary directory。
`bundleDigest`覆盖完整bundle bytes，`files`覆盖展开后的每个repo-relative文件，Core在
seal前、spawn前和child退出后逐项复验bundle、展开文件与ArtifactRef hash。任一差异
fail closed。
`bundleFormat`固定为`pt-finalizer-bundle-v1`：ASCII magic后依次写8-byte big-endian
manifest length、JCS manifest bytes，再按manifest lexicographic path顺序写每个
8-byte big-endian content length与原始file bytes。Manifest只含
`repoRelativePath + fileSha256 + byteLength`，拒绝absolute/`..`/duplicate path。
`bundleDigest`是该完整byte stream的SHA-256，必须等于ArtifactRef content hash。
Bundle prepare/parse/expand统一受Core hard limits约束：最多64 files、每个UTF-8
repo-relative path最多512 bytes、manifest最多256 KiB、单entry最多8 MiB、bundle及
expanded regular-file总bytes各最多64 MiB、owner-only temporary storage最多128 MiB、
wall time最多60秒。长度加法必须checked；declared length、实际bytes、file hash、
manifest sort和expanded inventory任一不一致即
`FINALIZER_BUNDLE_INVALID`。Builder/parser输出受同一256 KiB stdout与stderr上限；
timeout、storage exhaustion或上限命中由supervisor kill/reap并保持run未分配。

Seal前的snapshot materialization分成native setup与generic parser两段。由Evidence
Store拥有的native setup child在已arm self-timer后接收verified run-directory FD和
内存中的ArtifactRef inventory，用anchored `openat`逐个打开
`O_RDONLY | O_NOFOLLOW | O_CLOEXEC` regular-file FD；它属于Evidence Store mutation
authority，不被描述为低权限业务进程。完成open/fstat后关闭directory FD，只把预先
选择的regular-file FDs复制到显式allowlisted descriptor table，仅对这些FD清除
`CLOEXEC`，然后exec generic parser。Parser启动后通过
`WORKER_READY(workerKind=MATERIALIZER)` ACK证明没有directory/path capability。Parser不加载domain code，
不接收artifact root、directory FD或路径，不能选择或重开artifact。它在finalization
lock内执行bounded read、hash复验和JSON解析，并只向parent返回allowlisted payload；
Parent在写sealed marker前据此构造完整`SnapshotArtifact.payload`和全部digest。Seal后
Runner只把marker中已有的完整context和snapshot通过stdin传给finalizer，不再读取或
materialize artifact。总输入不得超过Catalog `inputByteLimit`；超限为typed
`FINALIZER_INPUT_TOO_LARGE`。Binary/large artifacts只传ArtifactRef metadata与hash，
不传内容。Child使用sanitized environment和isolated temporary cwd，明确移除
`PT_ACCEPTANCE_ARTIFACT_ROOT`及其它runtime/credential变量。
Parent对每个传入payload计算canonical `payloadDigest`并纳入snapshot digest；child在
业务验证前重算并逐项比较。`payload: null`时`payloadDigest`也必须为null。

Infra hard limits固定为timeout 60秒、stdin 1 MiB、stdout 256 KiB、stderr 256 KiB；
Catalog只能设置不超过60秒的正timeout，并把`inputByteLimit`设为不超过1 MiB的更小
正整数，不能放宽Core ceiling。`inputByteLimit`只限制materialized JSON和finalizer
stdin，不限制只做streaming hash的binary evidence。Seal另有Core固定上限：
artifact count 4096、single artifact 1 GiB、cumulative hashed bytes 8 GiB和总
materialization wall time 60秒；single/cumulative byte判断使用post-open `fstat`
结果，任一上限不满足即
`FINALIZER_MATERIALIZATION_FAILED`。Parent使用
incremental bounded readers同时drain stdout/stderr；任一stream超限立即
TERM/KILL/reap，并返回`FINALIZER_OUTPUT_TOO_LARGE`，不得先无界缓冲再截断。
Snapshot-materializer必须从已验证run directory FD使用anchored `openat`或平台等价
API读取JSON artifact。Linux优先使用
`openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS)`；其它POSIX host
必须逐component使用`openat(O_DIRECTORY | O_NOFOLLOW)`遍历，并对final component使用
`openat(O_RDONLY | O_NOFOLLOW)`，每步`fstat`验证类型与containment。单次
`O_NOFOLLOW`只保护最后一个component，不满足该契约。不能把`O_NONBLOCK`当作regular-file deadline，
因为Linux `open(2)`明确说明它对regular file无效：
<https://man7.org/linux/man-pages/man2/open.2.html>。Worker由OS hard-timeout强制终止。
Open前检查metadata，open后用`fstat`确认regular file和identity，再以64 KiB chunk
bounded read并复验ArtifactRef hash。累计原始bytes服从8 GiB hash budget；只有
materialized JSON/canonical stdin服从Catalog `inputByteLimit`。
JSON decoder限制nesting depth 32、单object member 4096、单array item 4096、单string
256 KiB并拒绝duplicate key；任一超限在完整materialize前停止。

### 20.2 Invocation与identity

- Acceptance Infra finalizer-registration resolver只解析并结构校验entry；具体finalizer ID、
  reviewed source paths、entrypoint和canonical Mobile contract生成的business
  role-name projection由Mobile protected declaration拥有，generated registration
  fields不得手工编辑。
  Preflight重算projection并验证`contractRoleProjectionDigest`、protected baseline和
  executable bundle三者一致；
  Core、Runner和Evidence Store不得导入业务Artifact Role或validator。
- Pre-provision validation绑定reviewed source paths、entrypoint和Python runtime
  identity。Runner在Gate spawn、bundle creation、seal、finalizer spawn和immutable
  manifest finalize前重算完整workspace/finalizer/runtime identity；任一漂移返回
  typed failure并保持`UNPROVEN`。执行副本必须逐字节来自已登记
  `FinalizerExecutableArtifact` bundle，且bootstrap也属于其`files`与
  `bundleDigest`；仅验证“临时副本前后相等”不足以建立执行身份。该contract假设同用户
  host进程可信，不声称抵抗恶意本地filesystem mutation。
- Finalizer使用独立进程、`shell=False`、bounded stdout/stderr、monotonic timeout和
  process-group TERM/KILL/reap，且`close_fds=True, pass_fds=()`，仅保留标准管道。
- Runner与supervisor使用两个Darwin/Linux anonymous POSIX channel：
  `AF_UNIX SOCK_STREAM`只承载length-prefixed bounded control frames；
  `AF_UNIX SOCK_DGRAM`只承载`SCM_RIGHTS` FD transfer。V1 `protocolVersion`固定为
  integer `1`。每个stream frame是`4-byte unsigned big-endian length + UTF-8 JCS JSON`；
  length必须在`1..2097152`，decoder先读入fixed 4-byte prefix并在任何body allocation
  前检查上限。Zero/oversized length、invalid UTF-8/JCS、partial prefix/body或EOF均
  立即关闭channel并fail closed，不drain或resynchronize。Diagnostic frame的decoded
  chunk最多65536 bytes，且每个request的STDOUT/STDERR各自累计不超过262144 bytes。
  Control decoder使用exact-length loop处理partial/coalesced reads。
  SCM_RIGHTS datagram payload必须是closed `DescriptorTransferFrame` JCS bytes且最多
  4096 bytes；frame携带完整request identity和ordered descriptor claim digests。
  Oversized/truncated、stale/cross-request/duplicate datagram，或identity/digest与
  stream `WorkerRequestFrame`不相等时，在FD使用前关闭全部received descriptors。
  每个需要FD的request在对应stream request之后只发送一个datagram和恰好一个
  `SOL_SOCKET/SCM_RIGHTS` cmsg；其FD数量与顺序必须精确等于
  `WorkerRequestIdentity.descriptorClaims`中的roles：
  `AUTHORITY_RUNTIME_PERSISTER=(GATE_DIRECTORY, TEMPORARY_DIRECTORY)`、
  `MAINTENANCE=(GATE_DIRECTORY)`、`MATERIALIZER=(RUN_DIRECTORY)`、
  `BUNDLE_PREPARER=(REPOSITORY_ROOT, TEMPORARY_DIRECTORY)`、
  `RUNTIME_CAPTURE=(TEMPORARY_DIRECTORY)`、
  `FINALIZER=()`。每个claim在sender复制FD前从owner FD的`fstat`构造，绑定
  device/inode/type和logical owner：
  gate dir绑定`workspaceId/gateId`，run dir绑定
  `workspaceId/gateId/evidenceRunId`，repository root绑定
  `workspaceId/sourceCommit/workspaceDigest/canonicalWorktreeHash`，temporary dir绑定
  `supervisorSessionId/requestId/tempNonce`。`ownerBindingDigest`和
  `descriptorClaimDigest`分别按§20.3 exact preimage计算，
  ordered claims进入`requestIdentityDigest`；receiver通过一次`recvmsg`
  拒绝`MSG_TRUNC/MSG_CTRUNC`、错误cmsg count/type、错误FD count/order或worker-kind
  mismatch，并在任何进一步验证前对收到的每个FD设置`FD_CLOEXEC`，再逐claim执行
  `fstat`等值、owner binding和permission检查。Finalizer禁止ancillary FD。Runner发送的全部FD
  都是owner descriptor的duplicates；只有收到request-bound `REQUEST_ACCEPTED`后才
  关闭sender duplicates，原始owner FDs仍归Runner。任一parse/reject/timeout/cancel
  路径都关闭本次发送和接收的全部duplicates。所有ACK必须回显相同request identity。
- `WorkerContractMatrix`是worker-kind dispatch唯一真源；request的concrete type、
  completed/failed result types和descriptor claims必须与同一row精确匹配。
  `SupervisorControlFrame`是stream control channel唯一允许的frame union，
  `SupervisorAncillaryFrame`是datagram channel唯一允许的payload。Legal order是：
  session `SUPERVISOR_READY`后处于READY；每个request严格
  `WORKER_REQUEST -> optional DESCRIPTOR_TRANSFER -> REQUEST_ACCEPTED ->
  WORKER_ARMED -> WORKER_READY ->
  zero-or-more WORKER_DIAGNOSTIC -> WORKER_RESULT -> WORKER_EXITED(exitCode=0)`。
  `WORKER_EXITED(nonzero) | WORKER_SIGNALED | WORKER_TIMEOUT`
  可在request accepted后的任一点终止该request，此后禁止result/diagnostic frame。
  Runner取消active request必须发送identity-bound `WORKER_CANCEL_REQUEST`；supervisor
  验证当前identity后kill/reap，再回`WORKER_CANCELLED`并返回READY/FAILED。Stale or
  cross-request cancel不得影响当前worker。
  `SUPERVISOR_CLOSE`只允许无unreaped worker的READY/FAILED session，随后exactly one
  `SUPERVISOR_CLOSE_ACK(allWorkersReaped=true)`并EOF。Sequence、identity、frame type、
  digest、PID/PGID/timer proof、result-kind或state transition任一不匹配都kill/reap并
  fail closed。`WorkerRequestFrame.identity == request.identity`且
  `WorkerResultFrame.identity == result.identity`必须逐字段相等，不接受内外双重
  authority。
- `MAINTENANCE` request由Evidence Store构造，只允许
  `INSTALL_PUBLICATION_INTERLOCK | ACTIVATE_ENFORCEMENT | WRITE_ABORT_EVENT | TOMBSTONE_RUN |
  DELETE_TOMBSTONE_BATCH`。它通过同一datagram protocol传一个verified gate-directory
  FD，payload只含typed workspace/gate/run/generation、expected digests与hard limits；
  child names由operation常量和validated slug派生，不接受任意path。Worker是Evidence
  Store mutation authority，不加载domain code；每个operation完成、失败或timeout都
  关闭gate FD并回传request-bound closed-union result。Decoder只接受上文列出的十四个
  concrete result variants并拒绝任何其它field/status/boundary组合：
  interlock worker在任何write前验证authorization、candidate projection、expected
  legacy latest及fixed path absence/equality；validation/conflict返回
  `InstallPublicationInterlockRejected/NO_MUTATION`，durable success返回
  `INTERLOCK_DURABLE`，write后ACK/fsync不确定只返回
  `INTERLOCK_MAY_BE_DURABLE`并要求显式fixed-path retry；
  activation在candidate构造前的identity/request/durable-state/active-run/limit/
  timeout/I/O failure只能返回`ActivateEnforcementRejected/NO_MUTATION`且digest为null；
  active run使用`MAINTENANCE_ACTIVE_RUN`，其它failure使用对应closed code。Pending之后的operational
  failure才可返回带non-null digest的`ActivateEnforcementFailed`，完成只能是
  `ACTIVATED`；authorization writer只
  能写`AUTHORIZED`；tombstone完成必须同时durable `TOMBSTONED` event；delete完成必须
  durable `DELETED` event，`INCOMPLETE/FAILED`必须durable本attempt的`FAILED` event及
  non-null continuation token；`DeleteTombstoneBatchRejected`只允许identity/request/
  durable-state validation或first unlink与`DELETE_BATCH_STARTED` publication前的
  timeout/I/O failure，必须`NO_MUTATION`、zero deltas且无event/token。若worker
  无法持久化规定的terminal event，它不得返回
  structurally valid result，Core按process/protocol failure处理并在retry时检查durable
  state。Continuation token是对
  `{authorizationId, eventSequence, nextDeletionPlanIndex, deletionPlanDigest,
  tombstoneIdentityDigest}`的domain-separated canonical digest，不是path、secret
  authenticator或可变authority，且不能改变root或
  inventory。每个delete request都必须携带current chain-head event digest及其中的
  exact token：新batch首次使用`TOMBSTONED` index-0 token，后续使用上一durable
  `FAILED` event token；若chain head是没有terminal event的
  `DELETE_BATCH_STARTED`，retry必须复用其attempt ID、input token和exact range。
  Worker先验证linear event chain、immutable deletion plan、token和
  tombstone identity，再从plan index继续。Worker从validated gate-directory FD按fixed
  `aborted-runs/<run-id>`定位root。V1 destructive abort deletion只支持Linux
  `openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS |
  RESOLVE_NO_XDEV)`。Darwin和其它没有等价atomic no-mount-crossing primitive的host在
  authorization、rename和delete前返回`ABORT_SEALED_DELETE_UNSUPPORTED`并保留sealed
  orphan；该结果是CLI-owned `AbortSealedPreflightRejected/NO_MUTATION`，发生在
  supervisor/maintenance request之前，因此不扩展十四个worker result variants。
  不得以`st_dev`近似替代mount identity。Worker先对本batch全部remaining
  entries执行`fstatat(AT_SYMLINK_NOFOLLOW)`并与plan type/device/inode逐项相等。
  Traversal遇到symlink、socket、FIFO、device或其它非regular/non-directory entry时，
  整个plan creation或batch validation fail closed；不得跳过或跟随。
  Fresh batch要求range内每个entry存在且精确匹配，完整prevalidation通过后才durably
  publish `DELETE_BATCH_STARTED`。Outstanding
  `DELETE_BATCH_STARTED` retry只允许其已授权range内的entry缺失，并把缺失视为prior
  authorized progress。Present entry必须匹配type/device/inode；regular file还必须
  匹配byteLength，directory不得比较mutable size。Batch byte budget只累加已验证
  regular-file byteLength。
  Fresh prevalidation中的range外
  missing、任一identity mismatch或无valid started event的missing使用
  `DeleteTombstoneBatchRejected/NO_MUTATION`。Started event durable后的identity
  mismatch不得声称`NO_MUTATION`；worker写zero-delete
  `DeleteTombstoneBatchFailed/FAILED_EVENT_DURABLE`并停止。
  Started event durable且retry prevalidation通过后，只使用保留的anchored parent FDs与`unlinkat`按plan顺序
  删除；CONTENT directory使用`AT_REMOVEDIR`。Explicit `TOMBSTONE_ROOT` entry只允许
  作为plan最后一项，由已验证的`aborted-runs` parent FD对fixed validated run ID执行
  `unlinkat(..., AT_REMOVEDIR)`；worker不得把null path交给generic child-path resolver，
  也不重新解析absolute或caller path。完成一个batch的unlink后，worker在写
  FAILED/DELETED terminal event前必须fsync所有仍存在且被修改的parent directories，
  deepest-first去重；若explicit root已删除，还必须fsync`aborted-runs` parent。
Crash retry根据durable started range与plan identity，对每个missing entry定位并fsync
其nearest surviving planned ancestor；root missing时fsync`aborted-runs`。所有required
directory fsync完成前不得写terminal event。若worker在
  部分删除后、terminal event durable前崩溃，下一显式调用从durable
  `DELETE_BATCH_STARTED`重放同一plan range并按上述规则处理缺失entry；没有started
  event时绝不把missing推断为先前删除。它不从mutable directory offsets或未持久化
  response恢复。
  Durable boundary只可单调前进：
  activation `NONE -> PENDING_DURABLE -> GENERATION_DURABLE ->
  ACTIVATION_SENTINEL_DURABLE -> CURRENT_DURABLE -> ACTIVATED`；abort event
  `NONE -> EVENT_DURABLE`；tombstone
  `NONE -> AUTHORIZATION_DURABLE -> RUN_TOMBSTONED -> TOMBSTONED_EVENT_DURABLE`；
  delete batch从`TOMBSTONED_EVENT_DURABLE`开始，每次先进入
  `DELETE_BATCH_STARTED_DURABLE`，再进入`DELETED_EVENT_DURABLE`或
  `FAILED_EVENT_DURABLE`。Retry必须先验证已报告boundary的
  durable bytes/digests，再继续下一transition。
- `BUNDLE_PREPARER` request由Evidence Store构造并绑定reviewed source inventory和上述
  hard limits；它只能接收一个verified repository directory FD和一个owner-only
  temporary-directory FD。Request/ACK/result均绑定完整`WorkerRequestIdentity`；
  prepare、manifest parse和expand全部发生在同一supervised deadline内。
- v1 hard-timeout backend是由reviewed
  `core/finalization_supervisor.c`构建的native POSIX deadline supervisor；其source、
  compiler/build identity和binary hash都进入`FinalizerRuntimeIdentity`。Runner必须在
  run allocation前启动supervisor并在10秒内完成`SUPERVISOR_READY` handshake；startup
  timeout、malformed READY或early exit会direct-kill/reap supervisor且不分配run。READY
  表示control-pipe EOF handling和timer primitives已经验证。收到worker request后，
  supervisor fork一次：
  child分支在`execve` Python前先建立独立process group、解除`SIGALRM` mask、恢复OS
  default disposition、设置并用`getitimer`复验不超过Core 60秒ceiling的
  `ITIMER_REAL`，然后发送`WORKER_ARMED(pid, pgid)` setup acknowledgement、关闭未授权
  FD并exec；timer跨`execve`保留。Supervisor parent在fork后也调用
  `setpgid(childPid, childPid)`，并同时用monotonic deadline轮询control pipe、setup ACK
  与`waitpid(WNOHANG)`。ACK前的EOF/deadline始终直接`kill(childPid, SIGKILL)`并reap；
  ACK后先`killpg`再以direct-PID kill作为`ESRCH`/race fallback，最后reap。Runner只有在
  验证ACK中的PID/PGID和child timer状态后才接受worker output。`setitimer(2)`明确说明timer不跨
  `fork`继承但跨`execve`保留，因此禁止在supervisor parent中预先arm：
  <https://man7.org/linux/man-pages/man2/setitimer.2.html>。Child setup任一步失败都
  `_exit`并由supervisor报告typed failure；不存在已exec worker没有self-timer且没有
  supervisor deadline的窗口。
  Session-level `SUPERVISOR_READY`只携带
  `supervisorSessionId + supervisorRuntimeDigest`，发生在run allocation前。每次request
  创建唯一`WorkerRequestIdentity`；`REQUEST_ACCEPTED`、`WORKER_ARMED`、
  `WORKER_READY`、payload channel envelope、stdout/stderr diagnostic envelope、exit
  status、timeout和cancellation都携带并验证完整request identity。
  Sequence必须严格递增，stale、duplicate、cross-kind或out-of-order frame立即kill/reap
  当前worker并返回typed protocol failure。
  Python bootstrap完成executable/runtime digest复验、allowlisted FD检查和timer
  `getitimer`复验后发送`WORKER_READY`；`WORKER_ARMED`只证明pre-exec setup，不能授权
  parent接受业务output。Runner在每次request前检查supervisor PID/control channel，
  request期间同时监控reverse EOF与process exit；supervisor在READY后任意退出都返回
  typed `FINALIZER_SUPERVISOR_FAILED`。Seal前失败释放finalization lock并保持unsealed；
  seal后若Runner仍存活，则合成`ERROR/FINALIZER_SUPERVISOR_FAILED`并交给Evidence Store
  发布`failed/PARTIAL/UNPROVEN`；只有Runner hard-crash才留下不可发布orphan并进入
  `abort-sealed`。
  Python官方说明Python handler可能被长时间C调用无限延后，而`ITIMER_REAL`会发送
  `SIGALRM`：<https://docs.python.org/3/library/signal.html#execution-of-python-signal-handlers>。
  不支持该native supervisor、无法解除signal mask或无法验证default disposition的host
  在preflight返回typed
  `FINALIZER_HARD_TIMEOUT_UNSUPPORTED`，不得fallback。Parent timeout仍负责正常
  TERM/KILL/reap。Finalizer没有artifact/root/network/lock FD，因此orphan不能写run、
  publish或阻塞Evidence Store lock。Snapshot-materializer也由同一已READY supervisor
  执行；run-directory FD只通过上述SCM_RIGHTS请求传给native setup child，不传给
  parser或business finalizer。
- Supervisor session正常状态是
  `STARTING -> READY -> REQUEST_ACTIVE -> READY -> CLOSING -> CLOSED`。任一
  protocol/process failure先进入`FAILED`并保存typed failure；`FAILED`不是terminal，
  只允许`FAILED -> CLOSING -> CLOSED`。Successful completion、
  preflight-after-start failure、run allocation failure、worker/session failure、
  cancellation-before-request和normal runner shutdown都必须调用
  `close_supervisor()`：发送session-bound `CLOSE`（channel仍可用时），active worker
  存在时先cancel/kill/reap，等待bounded `CLOSE_ACK`，关闭channel，再bounded wait
  supervisor；timeout时direct `SIGKILL`并`waitpid`。只有所有worker和supervisor均已
  reap才进入`CLOSED`；此前failure code保留且`closedAfterFailure=true`。若无法reap，
  session保持`FAILED`，不得构造manifest、publish latest或报告cleanup success。
- v1 finalizer是reviewed trusted/no-child纯validator，禁止subprocess、fork、setsid、
  network、signal-handler/timer mutation、native extension和product client；bootstrap
  在加载业务module后复验`SIGALRM`仍为default disposition。Static dependency scan和
  runtime probes必须证明无descendant且hard timer未被替换。该边界不声称隔离hostile
  finalizer code。
- Python worker固定使用isolated `-I -S -E -B`启动，不加载user site、`sitecustomize`、
  `PYTHONPATH`或cwd modules。Bootstrap把`sys.path`收敛为verified bundle root和
  `FinalizerRuntimeIdentity.stdlibDigest`覆盖的stdlib closure，并安装import allowlist；
  bundle/stdlib列表之外的import、dynamic loader和native extension均fail closed。
  Python命令行隔离语义见
  <https://docs.python.org/3/using/cmdline.html#cmdoption-I>与
  <https://docs.python.org/3/using/cmdline.html#cmdoption-S>。
- Child输入只包含`FinalizerInput`。`FinalizerContext.primaryStatus`只有canonical
  status tuple；完整primary result不进入child input，只在parent完成merge，并以
  canonical mapping持久化到sealed marker及最终`EvidenceFinalizationRecord`供历史
  reader重算。输入不
  包含Runtime Manifest payload、Provisioner对象、credential、
  raw handle、launch context、可写RunHandle、产品endpoint或绝对worktree path。
- `workspaceId + gateId + evidenceRunId + provisioningRunId +
  runtimeManifestRef + sourceCommit + workspaceDigest + canonicalWorktreeHash +
  snapshotDigest`必须由Core逐项验证。Source tuple必须来自Store-owned immutable
  `RunHandle.source`。Core还必须证明Runtime Manifest ArtifactRef属于snapshot，读取
  payload并将其Gate、provisioning run、source commit、workspace digest和canonical
  worktree hash分别与RunHandle、snapshot和context交叉比较；Runtime Manifest的
  canonical worktree hash由其现有`source.worktree`字段派生，不新增平行真源。
- Core按已验证的generated finalizer registration catalog
  `evidenceRoleNames`从snapshot计算canonical sorted
  `requiredRoleIdentities`。`validatedRoleInstances`必须与其逐项完全相等；Core从
  snapshot投影validated ArtifactRef，child不能回传payload/ref或只确认子集。
- Detached business validator必须验证每个multi-instance role的discriminator与
  canonical path/payload identity一致。
- `evaluationTime`只验证artifact时间不晚于seal。Lease是否有效不得用seal时wall
  clock比较原始`expiresAt`；必须由同一snapshot中的heartbeat history、monotonic
  fence和terminal `RELEASED/QUARANTINED` outcome证明。Finalizer禁止读取当前wall
  clock，同一snapshot判断必须确定。
- Child只能返回`FinalizerChildOutcome`的
  `VALIDATED | REJECTED | BLOCKED`。`TIMED_OUT | ERROR`只能由Core根据supervisor、
  process、protocol、identity或I/O failure合成，child返回这些值按invalid output拒绝。
  `ChildGateEvidenceFinalization`必须且只能包含一个validated child outcome；
  `CoreGateEvidenceFinalization`必须是`TIMED_OUT | ERROR`且`childOutcome=null`。
- `VALIDATED`必须包含非空`validatedRoleInstances`且禁止`failureCode/diagnostic`；
  其它status必须包含typed `failureCode`且禁止`validatedRoleInstances`。
- Finalizer只执行一次，不重试、不跨runner恢复。timeout、cancellation、process
  failure、invalid output或runner crash都不能产生durable success manifest/latest。

### 20.3 Canonical digest

`payloadDigest`、`snapshotDigest`、
`primaryResultDigest`、`requirementDigest`、`requirementMappingDigest`、
`sourceTraceDigest`、
`configDigest`、`invocationDigest`、`sourceDigest`、`coreBootstrapSourceDigest`、
`finalizerSourceDigest`、`supervisorSourceDigest`、`workerSourceDigest`、`stdlibDigest`、
`compilerFlagsDigest`、`supervisorRuntimeDigest`、`finalizerRuntimeDigest`、
`childOutcomeDigest`、`outcomeDigest`和abort
`eventDigest`、`deletionPlanDigest`、`protectedBaselineDigest`、
`enforcementDigest`、`activatedDigest`、`currentDigest`、`descriptorClaimDigest`、
`ownerBindingDigest`、`requestIdentityDigest`、`workerResultDigest`、
`contractRoleProjectionDigest`、`tombstoneIdentityDigest`、`continuationToken`、
`controlRefDigest`、`sourceCaptureDigest`、`confirmationChallengeDigest`、
`authorizationDigest`、
`interlockDigest`、`preflightRuntimeDigest`、`runtimeCaptureDigest`、
`preflightPlatformRuntimeDigest`、`platformRuntimeDigest`、`intentDigest`、
`pendingDigest`、`priorLatestPointerDigest`、`requestPayloadDigest`、
`proofAdmissionSourceDigest`、`resolutionDigest`、maintenance `resultDigest`、
`maintenanceRuntimeDigest`、`durabilityProfileDigest`、`anchorIdentityDigest`、
`qualifiedBackendIdentityDigest`、
`capabilityEvidenceDigest`、`durabilityCapabilityRefDigest`、`probeSourceDigest`、
`probeRuntimeDigest`、`scannerSourceDigest`、
`crashFixtureManifestDigest`、`caseDigest`、`traceDigest`、`recoveryResultDigest`、
`expectationDigest`、`qualifiedEnvironmentDigest`、`controllerIdentityDigest`、
`environmentObservationDigest`、`matrixResultDigest`、`finalizerInputDigest`、
`sealDigest`、`inputDigest`、`outputDigest`、
`ruleDigest`、`ruleRegistryDigest`、`forbiddenProcessApiScanDigest`、
`observationDigest`、`observationRefDigest`、`bootBoundaryAttestationDigest`、
`namespaceTerminationEvidenceDigest`、
`pidfdWaitCapabilityDigest`、
`helperIdentityDigest`、`volumeIdentityDigest`、`mountBindingDigest`、
`wrapperSourceDigest`、`wrapperIdentityDigest`、`wrapperWaitEvidenceDigest`、
`wrapperRuntimeDigest`、`scannerRuntimeDigest`、`argvDigest`、`waitEvidenceDigest`、
`waitIdStatusDigest`、`interruptionEvidenceDigest`、
`controllerReceiptDigest`、`controllerArmReceiptDigest`、`executionStartDigest`、
`executionReceiptDigest`、`trustAnchorDigest`、`trustAnchorRefDigest`、
`trustGenerationDigest`、`trustGenerationRefDigest`、
`revocationDigest`、`revocationRefDigest`、`revocationIntentDigest`、
`transitionReservationDigest`、
`bootstrapCandidateDigest`、`bootstrapCandidateRefDigest`、`consumptionDigest`、
`promotionIntentDigest`、`currentTrustDigest`、`qualificationBootObservationDigest`、
`profileBootObservationDigest`、`commandJournalDigest`、
`commandIdentityDigest`、`commandJournalHeadDigest`、`commandJournalLockIdentityDigest`、
`controllerRuntimeEpochDigest`、`controllerRuntimeEpochRefDigest`、
`currentRuntimeDigest`、`epochLeaseIdentityDigest`、
`controllerRuntimeSourceDigest`、`controllerRuntimeDigest`、
`bootstrapStoreIdentityDigest`、`controllerRuntimeLockBackendDigest`、
`productionLockMountIdentityDigest`、
`controllerStoreDurabilityProfileDigest`、
`controllerStoreDurabilityQualificationDigest`、`controllerStoreDurabilityCaseDigest`、
`controllerStoreExpectationDigest`、
`controllerStoreDurabilityArtifactRefDigest`、`qualificationInterruptionDigest`、
`witnessIdentityDigest`、`witnessConfirmationChallengeDigest`、
`witnessAuthorizationDigest`、
`controllerStoreBootObservationDigest`、
`controllerStoreRecoveryDigest`、
`localityEvidenceDigest`、`contentionEvidenceDigest`、
`resolutionRequestDigest`、`commandResolutionDigest`、`dispatchInvocationDigest`、
`trustDispatchLeaseDigest`、
trust-enrollment `confirmationChallengeDigest`、trust-enrollment `authorizationDigest`、
`abortPreflightRequestDigest`、`abortPreflightResultDigest`、
`lockIdentityDigest`、`epochDigest`、
`currentEpochDigest`、`jobRecordDigest`、`completionDigest`、`sinkIdentityDigest`、
`resolverIdentityDigest`、`pauseDigest`、
`quiescenceDigest`、`environmentIdentityDigest`、
`runtimeHostIdentityDigest`、
`emissionIntentDigest`、`emissionAcknowledgementDigest`、`sinkReceiptDigest`、
`executionEnvironmentTerminationDigest`、`jobRuntimeDigest`、`sourceNodeDigest`、
`epochRefDigest`、`promotionIntentRefDigest`、`authorityRuntimeRefDigest`、`frameDigest`均对
`{"domain": "<separator>", "payload": <value>}`执行RFC 8785 JSON Canonicalization
Scheme后取SHA-256 lowercase hex。JCS固定UTF-8、Unicode escaping、IEEE-754有限数字、
key order和whitespace；非JCS类型与NaN/Infinity拒绝。规范：
<https://www.rfc-editor.org/rfc/rfc8785>。每类digest使用固定domain separator：

```text
pt.acceptance.finalization.payload.v1
pt.acceptance.finalization.snapshot.v1
pt.acceptance.finalization.primary-result.v1
pt.acceptance.finalization.primary-result-source-trace.v1
pt.acceptance.finalization.requirement.v1
pt.acceptance.finalization.requirement-mapping.v1
pt.acceptance.finalization.config.v1
pt.acceptance.finalization.protected-baseline.v1
pt.acceptance.finalization.invocation.v1
pt.acceptance.finalization.finalizer-input.v1
pt.acceptance.finalization.seal.v1
pt.acceptance.finalization.source.v1
pt.acceptance.finalization.core-bootstrap-source.v1
pt.acceptance.finalization.source-capture.v1
pt.acceptance.finalization.preflight-runtime.v1
pt.acceptance.finalization.runtime-capture.v1
pt.acceptance.finalization.supervisor-source.v1
pt.acceptance.finalization.stdlib-closure.v1
pt.acceptance.finalization.compiler-flags.v1
pt.acceptance.finalization.preflight-platform-runtime.v1
pt.acceptance.finalization.platform-runtime.v1
pt.acceptance.finalization.runtime-host-identity.v1
pt.acceptance.finalization.supervisor-runtime.v1
pt.acceptance.finalization.runtime.v1
pt.acceptance.finalization.child-outcome.v1
pt.acceptance.finalization.outcome.v1
pt.acceptance.finalization.abort-event.v1
pt.acceptance.finalization.abort-deletion-plan.v1
pt.acceptance.finalization.abort-control-ref.v1
pt.acceptance.finalization.abort-tombstone-identity.v1
pt.acceptance.finalization.abort-continuation.v1
pt.acceptance.finalization.abort-confirmation.v1
pt.acceptance.finalization.abort-preflight-request.v1
pt.acceptance.finalization.abort-preflight-result.v1
pt.acceptance.finalization.authority-confirmation.v1
pt.acceptance.finalization.authority-authorization.v1
pt.acceptance.finalization.proof-admission-source.v1
pt.acceptance.finalization.authoritative-resolution.v1
pt.acceptance.finalization.maintenance-runtime.v1
pt.acceptance.finalization.maintenance-worker-source.v1
pt.acceptance.finalization.authority-runtime-ref.v1
pt.acceptance.finalization.durability-profile.linux.v1
pt.acceptance.finalization.durability-profile.darwin.v1
pt.acceptance.finalization.durability-sync-anchor.v1
pt.acceptance.finalization.durability-qualified-backend-identity.v1
pt.acceptance.finalization.durability-capability-evidence.v1
pt.acceptance.finalization.durability-capability-ref.v1
pt.acceptance.finalization.durability-probe-source.v1
pt.acceptance.finalization.durability-probe-runtime.v1
pt.acceptance.finalization.durability-crash-fixture-manifest.v1
pt.acceptance.finalization.durability-crash-case.v1
pt.acceptance.finalization.durability-power-cut-trace.v1
pt.acceptance.finalization.durability-expectation.v1
pt.acceptance.finalization.durability-qualified-environment.v1
pt.acceptance.finalization.durability-controller-identity.v1
pt.acceptance.finalization.durability-environment-observation.v1
pt.acceptance.finalization.platform-matrix-result.v1
pt.acceptance.finalization.claim-emitter-input.v1
pt.acceptance.finalization.claim-emitter-output.v1
pt.acceptance.finalization.durability-recovery-result.v1
pt.acceptance.finalization.durability-volume-identity.v1
pt.acceptance.finalization.durability-live-mount-binding.v1
pt.acceptance.finalization.proof-admission-source-node.v1
pt.acceptance.finalization.proof-admission-job-runtime.v1
pt.acceptance.finalization.proof-admission-argv.v1
pt.acceptance.finalization.proof-admission-scanner-runtime.v1
pt.acceptance.finalization.proof-admission-claim-wrapper-source.v1
pt.acceptance.finalization.proof-admission-claim-wrapper.v1
pt.acceptance.finalization.proof-admission-claim-wrapper-wait.v1
pt.acceptance.finalization.proof-admission-claim-wrapper-runtime.v1
pt.acceptance.finalization.proof-admission-consuming-wait.v1
pt.acceptance.finalization.proof-admission-scanner-source.v1
pt.acceptance.finalization.proof-admission-forbidden-process-api-rule.v1
pt.acceptance.finalization.proof-admission-forbidden-process-api-registry.v1
pt.acceptance.finalization.proof-admission-forbidden-process-api-scan.v1
pt.acceptance.finalization.proof-admission-darwin-boot-observation.v1
pt.acceptance.finalization.proof-admission-darwin-boot-observation-ref.v1
pt.acceptance.finalization.proof-admission-darwin-boot-boundary.v1
pt.acceptance.finalization.proof-admission-linux-boot-observation.v1
pt.acceptance.finalization.proof-admission-linux-boot-boundary.v1
pt.acceptance.finalization.proof-admission-linux-namespace-termination.v1
pt.acceptance.finalization.proof-admission-linux-waitid-status.v1
pt.acceptance.finalization.proof-admission-linux-pidfd-wait-capability.v1
pt.acceptance.finalization.durability-power-interruption.v1
pt.acceptance.finalization.durability-power-controller-receipt.v1
pt.acceptance.finalization.durability-power-controller-receipt-signature.v1
pt.acceptance.finalization.durability-power-controller-arm-receipt.v1
pt.acceptance.finalization.durability-power-controller-arm-receipt-signature.v1
pt.acceptance.finalization.durability-power-controller-execution-receipt.v1
pt.acceptance.finalization.durability-power-controller-execution-receipt-signature.v1
pt.acceptance.finalization.durability-power-controller-trust-enrollment-authorization.v1
pt.acceptance.finalization.durability-power-controller-trust-enrollment-confirmation.v1
pt.acceptance.finalization.durability-power-controller-bootstrap-candidate.v1
pt.acceptance.finalization.durability-power-controller-bootstrap-candidate-ref.v1
pt.acceptance.finalization.durability-power-controller-bootstrap-consumption.v1
pt.acceptance.finalization.durability-power-controller-trust-promotion-intent.v1
pt.acceptance.finalization.durability-power-controller-trust-promotion-intent-ref.v1
pt.acceptance.finalization.durability-power-controller-trust-current.v1
pt.acceptance.finalization.durability-power-controller-trust-anchor.v1
pt.acceptance.finalization.durability-power-controller-trust-anchor-ref.v1
pt.acceptance.finalization.durability-power-controller-trust-generation.v1
pt.acceptance.finalization.durability-power-controller-trust-generation-ref.v1
pt.acceptance.finalization.durability-power-controller-trust-revocation.v1
pt.acceptance.finalization.durability-power-controller-trust-revocation-ref.v1
pt.acceptance.finalization.durability-power-controller-trust-revocation-intent.v1
pt.acceptance.finalization.durability-power-controller-trust-transition-reservation.v1
pt.acceptance.finalization.durability-qualification-boot-observation.v1
pt.acceptance.finalization.durability-profile-boot-observation.v1
pt.acceptance.finalization.durability-power-controller-command-journal.v1
pt.acceptance.finalization.durability-power-controller-command-identity.v1
pt.acceptance.finalization.durability-power-controller-command-journal-head.v1
pt.acceptance.finalization.durability-power-controller-command-journal-lock.v1
pt.acceptance.finalization.durability-power-controller-command-journal-signature.v1
pt.acceptance.finalization.durability-power-controller-runtime-epoch.v1
pt.acceptance.finalization.durability-power-controller-runtime-epoch-signature.v1
pt.acceptance.finalization.durability-power-controller-runtime-epoch-ref.v1
pt.acceptance.finalization.durability-power-controller-runtime-current.v1
pt.acceptance.finalization.durability-power-controller-runtime-epoch-lease.v1
pt.acceptance.finalization.durability-power-controller-runtime-source.v1
pt.acceptance.finalization.durability-power-controller-runtime.v1
pt.acceptance.finalization.durability-power-controller-store-bootstrap-identity.v1
pt.acceptance.finalization.durability-power-controller-runtime-lock-backend.v1
pt.acceptance.finalization.durability-power-controller-runtime-lock-mount-identity.v1
pt.acceptance.finalization.durability-power-controller-store-profile.v1
pt.acceptance.finalization.durability-power-controller-store-qualification.v1
pt.acceptance.finalization.durability-power-controller-store-case.v1
pt.acceptance.finalization.durability-power-controller-store-expectation.v1
pt.acceptance.finalization.durability-power-controller-store-artifact-ref.v1
pt.acceptance.finalization.durability-power-controller-store-interruption.v1
pt.acceptance.finalization.durability-power-controller-store-interruption-signature.v1
pt.acceptance.finalization.durability-power-controller-store-witness.v1
pt.acceptance.finalization.durability-power-controller-store-witness-confirmation.v1
pt.acceptance.finalization.durability-power-controller-store-witness-authorization-id.v1
pt.acceptance.finalization.durability-power-controller-store-witness-authorization.v1
pt.acceptance.finalization.durability-power-controller-store-boot-observation.v1
pt.acceptance.finalization.durability-power-controller-store-recovery.v1
pt.acceptance.finalization.durability-power-controller-store-recovery-signature.v1
pt.acceptance.finalization.durability-power-controller-runtime-lock-locality.v1
pt.acceptance.finalization.durability-power-controller-runtime-lock-contention.v1
pt.acceptance.finalization.durability-power-controller-command-resolution-request.v1
pt.acceptance.finalization.durability-power-controller-command-resolution.v1
pt.acceptance.finalization.durability-power-controller-dispatch-invocation.v1
pt.acceptance.finalization.durability-power-controller-trust-dispatch-lease.v1
pt.acceptance.finalization.durability-execution-start.v1
pt.acceptance.finalization.proof-admission-kernel-helper.v1
pt.acceptance.finalization.proof-admission-lock.v1
pt.acceptance.finalization.proof-admission-environment.v1
pt.acceptance.finalization.proof-admission-environment-termination.v1
pt.acceptance.finalization.proof-admission-epoch.v1
pt.acceptance.finalization.proof-admission-epoch-ref.v1
pt.acceptance.finalization.proof-admission-current-epoch.v1
pt.acceptance.finalization.proof-admission-job-record.v1
pt.acceptance.finalization.proof-admission-job-completion.v1
pt.acceptance.finalization.proof-admission-sink-source.v1
pt.acceptance.finalization.proof-admission-sink-identity.v1
pt.acceptance.finalization.proof-admission-sink-resolver-identity.v1
pt.acceptance.finalization.proof-admission-sink-id.v1
pt.acceptance.finalization.proof-admission-emission-intent.v1
pt.acceptance.finalization.proof-admission-emission-acknowledgement.v1
pt.acceptance.finalization.proof-admission-sink-receipt.v1
pt.acceptance.finalization.proof-admission-pause.v1
pt.acceptance.finalization.proof-admission-quiescence.v1
pt.acceptance.finalization.enforcement.v1
pt.acceptance.finalization.publication-interlock.v1
pt.acceptance.finalization.enforcement-activated.v1
pt.acceptance.finalization.enforcement-current.v1
pt.acceptance.finalization.activation-intent.v1
pt.acceptance.finalization.activation-pending.v1
pt.acceptance.finalization.prior-latest-pointer.v1
pt.acceptance.finalization.worker-request.v1
pt.acceptance.finalization.descriptor-owner-binding.v1
pt.acceptance.finalization.descriptor-claim.v1
pt.acceptance.finalization.worker-request-identity.v1
pt.acceptance.finalization.worker-result.v1
pt.acceptance.finalization.supervisor-control-frame.v1
pt.acceptance.finalization.role-projection.v1
pt.acceptance.finalization.maintenance-result.v1
```

digest字段本身不进入同类digest自己的preimage；`payloadDigest`作为普通字段进入
snapshot preimage。Snapshot preimage是除`snapshotDigest`外的完整canonical
`ReadOnlyEvidenceSnapshot`，因此覆盖top-level identity、`evaluationTime`、完整排序的
`roleName + discriminator + ArtifactRef + payloadDigest`、Runtime Manifest reference
与Store-owned source tuple。`CanonicalOpaqueJson.contentDigest`是decoded canonical
UTF-8 bytes的raw SHA-256；payload digest的preimage是这些bytes解析得到的canonical
JSON value，child必须从stdin重算并同时验证schema ID/digest；
`argvDigest` covers the exact ordered argv array without shell normalization.
`sourceTraceDigest` covers the complete `PrimaryResultSourceTrace` except itself;
its evidence refs must resolve inside the same workspace/Gate/run source tuple.
`inputDigest` and `outputDigest` cover `ClaimEmitterInput` and
`ClaimEmitterOutput` respectively except their self digest; each
`encodedUtf8Base64` decodes to the RFC 8785 bytes of its `resolution`.
`ProofAdmissionJobRecord.emitterInput.resolution` and `expectedResolution` are
byte-for-byte equal, while `expectedResolutionDigest`,
`emitterInput.resolution.resolutionDigest` and the recomputed resolution digest
are equal.
Completed claim execution has exactly one preloaded `authoritative_input`
binding, exactly one final `authoritative_result` binding and no other
assignment/output.
`matrixResultDigest` and `environmentObservationDigest` cover their complete
closed objects except themselves.
`scannerRuntimeDigest` covers `PythonScannerInterpreterIdentity` except itself.
`wrapperRuntimeDigest` covers
`{wrapperSourceDigest, executablePathHash, executableSha256, implementation,
version, stdlibDigest}` projected from the exact job interpreter.
`scannerSourceDigest`, `wrapperSourceDigest` and each kernel helper
`sourceDigest` cover their complete UTF-8 lexical sorted
`(repoRelativePath,fileSha256,byteLength)` source tuple under their distinct
scanner, wrapper and kernel-helper domains; each tuple is derived from the fixed
entrypoint/function named by its schema and is never caller-selected.
`waitEvidenceDigest`, `wrapperWaitEvidenceDigest`, `expectationDigest`,
`qualifiedEnvironmentDigest`, `controllerIdentityDigest`,
`controllerReceiptDigest`, `controllerArmReceiptDigest`, `executionReceiptDigest`, `trustAnchorDigest`,
`interruptionEvidenceDigest`, `crashFixtureManifestDigest`, `caseDigest`,
`traceDigest` and `recoveryResultDigest` each cover their complete closed object
except the named self digest. Trust-enrollment `confirmationChallengeDigest`
and `authorizationDigest` use their distinct listed domains over the complete
authorization excluding respectively both digest fields and only
`authorizationDigest`; the latter therefore includes the confirmed challenge.
`PowerControllerArmReceipt.signatureHex` is computed first over the complete
unsigned arm receipt using the exact UTF-8 RFC 8785 domain/payload framing
defined above, excluding `signatureHex` and `controllerArmReceiptDigest`;
`controllerArmReceiptDigest` is then computed
over the complete signed arm receipt excluding only
`controllerArmReceiptDigest`, so the digest includes `signatureHex`.
`dispatchInvocationDigest` is the dedicated-domain digest of
`{controllerPid,controllerProcessStartIdentity,controllerRuntimeEpochId,
commandId,resolutionRequestDigest,expectedHeadDigest,commandLockIdentityDigest,
randomCapabilityBytes}`. Only the digest is persisted in
`ActionDispatchedPowerControllerCommandJournalEntry`; the complete
`PowerActionInvocationCapability` is process-local, non-copyable and destroyed
when the original call returns or the process exits.
Before head adoption or actuator invocation,
`PowerActionInvocationCapability.dispatchInvocationDigest ==
ActionDispatchedPowerControllerCommandJournalEntry.dispatchInvocationDigest ==
CurrentEpochPowerActionResolution.dispatchInvocationDigest`; each value must
recompute from the same exact request digest, expected head, command lock and
process/epoch identity.
`ControllerStoreQualificationInterruptionEvidence.signatureHex` is the
canonical 64-byte P1363 `r || s` encoding of ECDSA P-256 with SHA-256 over the
UTF-8 RFC 8785 bytes of
`{"domain":"pt.acceptance.finalization.durability-power-controller-store-interruption-signature.v1",
"payload":<complete interruption evidence excluding signatureHex and
qualificationInterruptionDigest>}` using the embedded witness public key.
Verification rejects a non-low-S signature, an out-of-range scalar, a
non-canonical SEC1 point or any algorithm other than
`ECDSA_P256_SHA256_P1363_LOW_S`.
`qualificationInterruptionDigest` then covers the complete signed object except
itself.
`ControllerStoreQualificationRecoveryEvidence.signatureHex` is likewise
canonical low-S ECDSA P-256/SHA-256 P1363 over UTF-8 RFC 8785
`{"domain":"pt.acceptance.finalization.durability-power-controller-store-recovery-signature.v1",
"payload":<complete recovery evidence excluding signatureHex and
controllerStoreRecoveryDigest>}`. Its witness identity/authorization digests
equal the signed interruption, and `controllerStoreRecoveryDigest` covers the
complete signed recovery object except itself.
The witness identity resolves the candidate-local immutable
`bootstrap-candidates/<bootstrapCandidateDigest>/witness-authorizations/<authorizationId>.json`
record and requires its embedded authorization digest to equal
`witnessAuthorizationDigest`. Authorization uses the same kernel-principal,
controlling-TTY, clean-HEAD and canonical owner-approval checks as trust
enrollment, but its fixed scope is qualification-only. Its
`bootstrapCandidateDigest` equals the command input and resolved candidate.
`authorizationId` is the lowercase SHA-256 of UTF-8 RFC 8785 bytes
`{"domain":"pt.acceptance.finalization.durability-power-controller-store-witness-authorization-id.v1",
"payload":{workspaceId,gateId,bootstrapCandidateDigest,qualificationId,
witnessId,witnessPublicKeySha256,ownerApprovalDocumentSha256,authoritySourceCommit}}`,
where `witnessId = "p256-sha256:" + witnessPublicKeySha256`. The CLI derives
both fields only after strict SEC1 decoding and never accepts a caller-supplied
witness ID, so an equal retry addresses the same immutable record. One no-replace publication
creates that canonical authorization record; there is no second authorization
or exclusion path to coordinate. The witness public-key hash equals raw SHA-256
of the decoded canonical 65-byte SEC1 point. Production enrollment, candidates,
anchors, epochs and receipts require `ED25519` plus an exact 32-byte public key;
witness authorization and signed qualification evidence require
`ECDSA_P256_SHA256_P1363_LOW_S` plus an exact 65-byte uncompressed P-256 point.
Unknown algorithms, cross-decoding, converted keys and omitted algorithm tags
fail closed, making qualification credentials structurally ineligible for
production authority without any mutable deny registry. All identity fields
equal the authorization. The witness challenge and authorization digests use
their dedicated listed domains over, respectively, the complete authorization
excluding both digest fields and the complete authorization excluding only
`witnessAuthorizationDigest`.
requirement preimage精确为
`{gateId, finalizerId, finalizerRegistryPath, protectedBaselinePath,
protectedBaselineDigest, protectedBaselineFileSha256}`，其中paths是经过schema验证的
完整repo-relative POSIX path；
config preimage精确为
`{gateId, finalizerId, timeoutSeconds, inputByteLimit}`，整数不得字符串化或携带未知
字段；
protected-baseline preimage是除外部`protectedBaselineDigest`外的完整
`FinalizerProtectedBaseline`。其中component digest定义为：
`requirementMappingDigest`对canonical
`{gateId, finalizerId, finalizerRegistryPath, protectedBaselinePath}`使用
`pt.acceptance.finalization.requirement-mapping.v1`计算JCS digest；
`protectedBaselineFileSha256`、`registryFileDigest`、`contractSchemaDigest`、
`entrypointSourceDigest`和
`generatorSourceDigest`分别对对应tracked file的exact bytes执行
raw `SHA-256`，不做换行、Unicode或YAML/JSON normalization。
`protectedBaselineDigest`则只表示解析后的完整`FinalizerProtectedBaseline`使用
domain-separated JCS得到的semantic digest；两者禁止互换。Activation/preflight只从
current worktree读取一次这些validated repo-relative paths；run allocation把exact
bytes复制为`ProtectedSourceArtifact`并将ArtifactRef、path、hash和length写入immutable
requirement record。Historical reader只解析record中的canonical requirement mapping，
并resolve这些immutable ArtifactRefs及后续sealed executable artifact重算component、
baseline和source digests；它不得重开current-worktree path。
`sourceCaptureBundleDigest`是source-capture bundle exact bytes的raw SHA-256；
其format就是本节前述`pt-finalizer-bundle-v1`：fixed magic、big-endian JCS manifest
length、JCS path/hash/length manifest和lexically ordered length-prefixed exact source
bytes。Historical reader必须resolve每个`ProtectedSourceArtifact`，按
`capturedSources`的canonical path order重建同一bundle bytes，并要求raw hash等于
`sourceCaptureBundleDigest`；只把recorded bundle digest代入下层digest不构成验证。
`sourceCaptureDigest` exact preimage为
`{captureId, workspaceId, sourceCommit, workspaceDigest, canonicalWorktreeHash,
sourceFiles, sourceCaptureBundleDigest}`；它明确排除process-local
`temporaryDirectoryClaim`与`consumed`。Allocation把该完整canonical preimage持久化为
requirement record的`sourceCaptureId + capturedSources + sourceCaptureBundleDigest`及source
identity，并要求每个`ProtectedSourceArtifact`的component/path/hash/length/
`executableIncluded`逐项相等。Historical reader由这些durable字段重算capture digest。
Preflight token必须携带matching capture ID/digest；allocation只接受同一live object的
`consumed=false`状态并在durable copy后原子改为true。
`runtimeCaptureBundleDigest`是canonical runtime-capture bundle exact bytes的raw
SHA-256。`bundleFormat`固定为`pt-finalizer-runtime-bundle-v1`：ASCII magic后写
8-byte unsigned big-endian JCS manifest length、JCS manifest bytes，再按下述runtime
file total key顺序为每个entry写8-byte unsigned big-endian content length与exact file
bytes。Manifest精确包含`captureId + measurement + files`；`files`只含
`kind/moduleName/logicalName/originKind/pathHash/fileSha256/byteLength`，禁止ArtifactRef、
absolute path和unknown field。Declared/actual length、ordering、identity或file hash任一
不一致即`FINALIZER_RUNTIME_MISMATCH`。Allocation从persisted
`RuntimeEvidenceArtifact` bytes按同一format重建bundle并要求raw hash等于recorded
`runtimeCaptureBundleDigest`，因此historical reader不把该digest视为opaque。
`preflightRuntimeDigest`覆盖除自身外的完整`PreflightRuntimeMeasurement`；
`runtimeCaptureDigest` exact preimage为
`{captureId, measurement, files, runtimeCaptureBundleDigest}`，排除process-local
temporary-directory claim与consumed state。Requirement record持久化该完整preimage，
每个`RuntimeEvidenceArtifact`必须与captured file的kind/moduleName/logicalName/
originKind/pathHash/fileSha256/byteLength逐项相等，数量和canonical order也完全相等；
runtime file order使用
`(kind, null/string moduleName tag+value, null/string logicalName tag+value, pathHash)`
total key并拒绝duplicate identity；
插入run-scoped ArtifactRef是唯一允许的转换。`preflightPlatformRuntimeDigest`覆盖除
自身外的完整`PreflightRuntimePlatformAttestation`。Allocation构造post-allocation
`RuntimePlatformAttestation`时必须保留os/kernel/loader/shared-cache字段及完整image
cardinality/order：每个`STANDALONE_FILE` image按
`logicalName/originKind/pathHash/fileSha256`精确匹配一个runtime artifact并只插入其
ArtifactRef；每个`DARWIN_SHARED_CACHE` image逐项保留UUID/CDHash且ArtifactRef保持null。
除此之外的增删、重排或field变化都fail closed。
Post-allocation `FinalizerRuntimeIdentity`中的ArtifactRefs只能来自这些artifacts。
Pure
`materialize_runtime_identity(measurement, captured_files, runtime_artifacts,
supervisor_source_artifact)`是唯一preflight-to-durable projection。It requires exact
one-to-one cardinality and preserves every non-ref field:

- supervisor source path/hash/digest, supervisor binary hash, protocol version and
  Core bootstrap digest are byte-equal to the measurement;
- build compiler path hash/binary hash/version/target/ordered flags/flags digest
  are byte-equal; only `compilerBinaryRef` is inserted from the matching
  `COMPILER_BINARY` artifact;
- Python executable path hash/hash/implementation/version are byte-equal; only
  `executableRef` is inserted from the matching `PYTHON_EXECUTABLE` artifact;
- stdlib modules preserve exact count/order/name/origin/hash; FILE inserts the
  one matching `STDLIB_MODULE` ref, BUILTIN/FROZEN retain null;
- platform fields and loaded images follow the exact standalone/shared-cache
  projection above; supervisor source/binary refs come only from their matching
  persisted artifacts.

Before computing `finalizerRuntimeDigest`, Core projects the durable identity
back to ref-free forms and requires recomputed `preflightRuntimeDigest`,
`preflightPlatformRuntimeDigest`, `stdlibDigest`, `compilerFlagsDigest`,
`supervisorRuntimeDigest` and both capture digests to equal the token/record.
Any missing, extra, reordered or changed field fails closed.
Invocation preimage精确为
`{finalizerId, finalizerExecutable, finalizerSourceDigest, finalizerRuntime,
supervisorSessionId, supervisorRuntimeDigest, enforcementGeneration,
enforcementDigest, requirementDigest, configDigest,
workspaceId, gateId, evidenceRunId, provisioningRunId, runtimeManifestRef,
sourceCommit, workspaceDigest, canonicalWorktreeHash, snapshotDigest,
requiredRoleIdentities, primaryStatus, primaryResultDigest}`；其中
`finalizerExecutable`是完整`FinalizerExecutableArtifact`，`finalizerRuntime`是除
`finalizerRuntimeDigest`外的完整runtime identity，所有tuple按schema规定顺序编码，
不得携带unknown field；
`sourceDigest`只表示business source：使用`pt.acceptance.finalization.source.v1`
覆盖`FinalizerRegistryEntry.sourcePaths`投影出的UTF-8 lexical sorted
`(repoRelativePath, fileSha256)` inventory；该inventory持久化在requirement record的
`sourceFiles`中，并与executable artifact中的business subset逐项相等。
`coreBootstrapSourceDigest`使用独立
`pt.acceptance.finalization.core-bootstrap-source.v1`覆盖
`FinalizerBootstrapBaseline.sourceFiles`的exact three-entry ordered inventory；
`FinalizerExecutableArtifact`和`FinalizerRuntimeIdentity`必须携带相同值。
`FinalizerInput.finalizerInputDigest` covers the complete input except itself.
`context` is the one canonical projection of `invocation`: every duplicated
field, including finalizer/runtime/session, enforcement generation/digest,
requirement/config, workspace/Gate/run/provisioning, runtime manifest, source,
snapshot, roles and primary result, must be byte-for-byte equal. `snapshot`
workspace/Gate/run/source/runtime-manifest/workspace/worktree/snapshot fields
must equal both context and invocation. Unknown or unequal fields invalidate the
input before child launch. Child/Core outcomes persist this exact
`finalizerInputDigest`;
their invocation/snapshot/primary fields must equal that input and the sealed
marker, so no component may select a different duplicate authority.
Child outcome preimage是除`childOutcomeDigest`外的完整
`FinalizerChildOutcome`。`ChildGateEvidenceFinalization` preimage精确为
`{origin: CHILD, childOutcome}`，且先复验child digest；
`CoreGateEvidenceFinalization` preimage是除`outcomeDigest`外的完整Core variant。
CHILD variant不得出现wrapper status/identity/roles/failure/diagnostic字段，CORE
variant必须`childOutcome=null`、空roles且具有与status匹配的Core failure code。
两种digest使用不同domain且不要求相等。Primary result使用closed
`CanonicalPrimaryResult`：完整pre-merge JSON作为schema-bound
`CanonicalOpaqueJson.document`保存，Core只读取固定status/reason/source-trace
projection并要求与document解析结果相等。`primaryResultDigest`覆盖完整
`CanonicalPrimaryResult`而不是可扩展mapping的字段子集。该record在seal前计算一次；
`COMPLETED`时sealed marker与finalization record逐字节JCS相等，
`NOT_INVOKED_PRE_SEAL`时由finalization record独立持久化。Reader从该record重算digest
和§20.4 published tuple，不尝试从已merge结果反推。
`sealDigest` covers the complete `SealedEvidenceMarker` except itself, including
`sealedAt`; `EvidenceFinalizationRecord.sealDigest` is equal for `COMPLETED` and
null for `NOT_REQUIRED | NOT_INVOKED_PRE_SEAL`.
Abort event preimage是除`eventDigest`外的完整`AbortSealedAuditEvent`。Event filename
必须与type匹配：`authorized.json`、`tombstoned.json`、
`delete-started-<attemptId>.json`、`failed-<attemptId>.json`或`deleted.json`。
`executablePathHash`只保存
`sha256(utf8(normcase(realpath(sys.executable))))`，不持久化home absolute path；
`compilerExecutablePathHash`使用同一raw-path算法。`supervisorSourceDigest`使用
`pt.acceptance.finalization.supervisor-source.v1`覆盖
`{repoRelativePath: tooling/acceptance/core/finalization_supervisor.c,
fileSha256: <raw-file-sha256>}`；historical reader resolve
`supervisorSourceArtifact`并要求path/raw hash相等。`stdlibDigest`使用
`pt.acceptance.finalization.stdlib-closure.v1`覆盖按`moduleName` UTF-8 lexical sort的
完整`StdlibModuleIdentity`数组；FILE要求raw file SHA，BUILTIN/FROZEN要求
`fileSha256=null`。`compilerFlagsDigest`使用
`pt.acceptance.finalization.compiler-flags.v1`覆盖原始ordered compiler-argument
string array，不排序、不shell-normalize；完整array与digest都持久化在
`SupervisorBuildIdentity`。`supervisorBuildIdentity`精确包含compiler
executable path hash、compiler binary raw SHA-256、compiler version、target triple和
compiler flags array/digest；其除`compilerBinaryRef`外的projection必须与
preflight measurement逐项相等。`supervisorRuntimeDigest`
preimage精确为`{supervisorSourceDigest, supervisorBinarySha256,
supervisorBuildIdentityWithoutArtifactRef, protocolVersion}`，因此可在allocation前由
`SupervisorReadyFrame`携带；post-allocation ArtifactRef只用于验证已记录raw hashes，
不改变该digest。
Historical reader还必须resolve `supervisorBinaryRef`并重算
`supervisorBinarySha256`；`stdlibModules`完整数组用于重算stdlib digest。
`platformRuntimeDigest`覆盖除自身外的完整`RuntimePlatformAttestation`；
`loadedImages`按`(originKind, logicalName, pathHash)`排序且identity唯一。
`STANDALONE_FILE`要求file SHA与ArtifactRef且禁止shared-cache fields；
`DARWIN_SHARED_CACHE`要求Mach-O UUID、CodeDirectory hash、shared-cache UUID且禁止
file SHA/ArtifactRef。Preflight probe、post-business-import probe和worker-exit probe
必须得到相同closure；unsupported/unmaterializable non-system image fail closed。
`finalizerRuntimeDigest` preimage是除自身外的完整`FinalizerRuntimeIdentity`。
`enforcementDigest` preimage是除自身外的完整`FinalizerEnforcementRecord`。Record
必须嵌入完整`activationIntent`并复验其digest；record的workspace/Gate/generation、
required finalizer ID、activatedAt/source commit、expected-current generation和
content digests必须与intent、permanent publication interlock、sentinel及candidate
current逐项一致。
`activatedDigest` preimage是除自身外的完整`FinalizerEnforcementActivated`；该
fixed-path sentinel只在first activation atomic no-replace创建且永不删除。
`activationIntentDigest`必须逐字节等于embedded
`FinalizerActivationIntent.intentDigest`；pending、sentinel和generation record都
复验该相等关系。
`interlockDigest` preimage是除自身外的完整`FinalizerPublicationInterlock`；fixed-path
interlock只可atomic no-replace安装且永不删除。Interlock的workspace/Gate/finalizer、
installedAt、installation source commit与proof-admission source digest必须逐项等于
其authorization projection。`proofAdmissionSourceDigest`使用
`pt.acceptance.finalization.proof-admission-source.v1`覆盖从
`authoritySourceCommit`按fixed
`ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES` rule生成的完整inventory：Git tree中
`tooling/acceptance/**`与`tooling/scripts/acceptance-*`全部tracked regular files，
plus exact `tooling/scripts/quality-evidence.py` and
`tooling/scripts/_acceptance_artifacts.py`, plus every repository-local transitive
import and statically resolved repository-local process/file execution dependency
from those seeds. The resolver follows literal `subprocess`/`exec` argv, shell
`source`/direct execution, Make include/recipe targets and CI-local script
references recursively; a dynamic repository-local executable/path expression
fails closed. It then computes a language-neutral reverse fixed point across every
tracked file classified by this fixed rule: Git executable mode, basename
`Makefile|GNUmakefile`, path under `.github/workflows/`, or lowercase extension
`.py|.pyi|.sh|.bash|.zsh|.js|.jsx|.ts|.tsx|.mjs|.cjs|.rs|.go|.c|.h|.mk|.toml|.yaml|.yml|.json`.
These files are parsed with the registered language/tool grammar; every
importer/includer/caller/process launcher that can reach a closure member joins
the inventory together with its forward dependencies, repeated until no node is
added. Other tracked regular files are deterministically `OPAQUE_DATA`:
they are ignored by reverse scanning unless a parsed edge names them, in which
case their exact bytes join the digest as a leaf. Unsupported classified grammar,
unparseable tracked automation, dynamic edge or unresolved local target fails
closed。每项编码为完整`ProofAdmissionSourceNode`，按path UTF-8 lexical sort；
`PARSED_SOURCE`必须携带fixed grammar ID/version、interpreter assignment或null及sorted
forward edges，`OPAQUE_DATA`要求grammar/interpreter为null且edges为空。
Only `DATA_READ` may target an `OPAQUE_DATA` node; IMPORT/INCLUDE/EXECUTE/SOURCE/
MAKE_RECIPE/CI_STEP must resolve exactly one `PARSED_SOURCE` node with non-null
grammar and the exact valid grammar/interpreter pair from the ordered classifier
table above. Suffix, basename/location, shebang and incoming-edge assignment are
applied only in that stated order; overlapping assignments must be byte-equal,
never winner-selected. Each non-data edge's assigned pair must equal its resolved
target node pair. Any missing target, duplicate canonical target, invalid pair or
assignment mismatch fails closure generation.
`sourceNodeDigest`使用
`pt.acceptance.finalization.proof-admission-source-node.v1`覆盖除自身外的完整node；
edges按`(edgeKind,targetPath,assignedGrammarId null/string tag,
assignedInterpreter null/string tag)`排序并拒绝duplicates。同一target收到多个
non-null grammar或interpreter assignment时，除非完整pair逐字节相等，否则整个
closure冲突fail closed。由interpreter
执行或被source/include的extensionless file必须继承invoking grammar并递归解析，不能
降级为opaque leaf。Rule ID、
seed set、forward/reverse resolver和ordering不可由CLI或plan覆盖。Generator还扫描全部
tracked source对Evidence Store latest、manifest proof status、`verify-latest`与
`AuthoritativeLatestResolution` API的直接或indirect reachability；任一matching
claim-admission source不在fixed-point closure即fail closed。Dynamic project import、
empty inventory、submodule/symlink entry或任一无法读取的blob都fail closed。
`lockIdentityDigest`、`epochDigest`、`currentEpochDigest`、`jobRecordDigest`、
`completionDigest`、`pauseDigest`和`quiescenceDigest`分别使用上述对应domain覆盖
各自除self-digest外的完整closed object。Current epoch必须resolve exact immutable
epoch record；job/completion的workspace/Gate/epoch/sequence/job digest逐项相等。
Every job requires
`runtimeIdentity.hostOsFamily == epoch.executionEnvironmentIdentity.osFamily`.
The environment, job runtime, scanner interpreter and wrapper identity carry
the same byte-equal OS-specific `hostBuild` and `RuntimeHostIdentity`; the
resolved epoch boot observation and every coordinator/claim/wrapper
process-start identity must repeat the same `bootSessionUuid` or `bootId`.
`RuntimeHostIdentity` carries only stable host identity and is never treated as
a boot identity. The job's claim/wrapper process-start identities use that same
Darwin or Linux branch. Its interpreter
executable/implementation/version/stdlib projection must equal both
`forbiddenProcessApiScan.scannerInterpreter` and the wrapper runtime projection.
A cross-OS, cross-host or cross-boot tuple fails before job registration.
`leaseWrapperIdentity` source tuple is deterministically derived from fixed
`proof_admission.py::run_claim_with_lease`; its runtime digest and OS-tagged
wrapper/claim process identities must equal the epoch and job record. The
wrapper owns the only lease FD, the claim receives none, captures output only in
its private channel, and completion requires `ClaimLeaseWrapperWaitEvidence`
with exact wrapper/claim PID/start equality, internal output capture before
lease release, consuming claim wait, and coordinator consuming wait of the
wrapper. Neither child nor wrapper has an external output descriptor. The claim
wait uses wrapper as waiter and claim as child; wrapper wait uses epoch
coordinator as waiter and wrapper as child. Each returned PID equals the declared
child, uses `waitpid(..., options=0)`, has exactly one EXITED or SIGNALED status
branch, and is consuming. `COMPLETED` requires both branches to be
`PosixExitedStatus(exitCode=0)`; any signal or non-zero exit is `CANCELLED`.
`wrapperRuntimeDigest` uses the same executable/implementation/version/stdlib
identity as the job interpreter plus the fixed wrapper source digest.
For `COMPLETED`, input resolution, expected resolution and output resolution are
byte-for-byte equal, `outputDigest` is included in `completionDigest`, and their
workspace/Gate/source/manifest identity equals the exact job target.
After that completion is durable, the coordinator acquires `.publish.lock`,
re-resolves the latest authority and requires the resulting complete
`AuthoritativeLatestResolution` and digest to equal the job input/output before
external emission. A mismatch emits nothing. Cross-workspace/Gate output
substitution is invalid.
`emissionIntentDigest` and `emissionAcknowledgementDigest` cover their complete
closed objects except themselves. `idempotencyKey` is the
`pt.acceptance.finalization.proof-admission-emission-idempotency.v1` digest of
`{workspaceId,gateId,coordinatorEpochId,jobSequence,jobRecordDigest,
completionDigest,expectedResolutionDigest,outputDigest,payloadSha256,
sinkIdentityDigest}`. `sinkIdentityDigest` covers the complete closed
`ProofAdmissionSinkIdentity` except itself. The job freezes that complete
identity before claim release; completion repeats its digest, intent embeds the
byte-equal identity, and acknowledgement/receipt sink and protocol fields equal
the embedded identity. `sinkId` is the
`pt.acceptance.finalization.proof-admission-sink-id.v1` digest of
`{sinkKind,workspaceId,gateId,destinationNamespaceId,resolverIdentityDigest}`.
The resolver identity is reconstructed only from the fixed
`proof_admission.py::emit_authoritative_claim` source closure and requires the
Evidence Store backend plus the exact protocol version. `sourceDigest` uses
`pt.acceptance.finalization.proof-admission-sink-source.v1` over the exact
lexically sorted source tuple. Caller-selected source, entrypoint, backend,
destination or endpoint is invalid. Original and recovery
coordinators must not read runtime configuration to reconstruct the destination
or deadline. Intent fields equal the job/completion/output exactly.
`payloadBase64` decodes to the exact RFC 8785 bytes of the complete
`ClaimEmitterOutput`; `payloadSha256` is raw SHA-256 of those bytes. Original and
recovery coordinators reconstruct only this representation. Acknowledgement
identity, intent and idempotency key equal the intent;
`acceptedPayloadSha256=payloadSha256`, and `sinkReceiptDigest` covers the
complete sink-owned atomic key-claim receipt except itself. Acknowledgement is published only after the
sink confirms the key is durably associated with those exact payload bytes.
The nested receipt's `sinkId`, `sinkProtocolVersion`, `idempotencyKey` and
`acceptedPayloadSha256` must equal the acknowledgement/intent;
`intent.createdAt <= sinkReceipt.acceptedAt <= acknowledgement.acknowledgedAt`.
Equal retries return the same receipt; a key/payload conflict or deadline expiry
cannot produce acknowledgement.
`environmentIdentityDigest`、`bootBoundaryAttestationDigest`与
`executionEnvironmentTerminationDigest`分别覆盖对应完整closed object；completion
中的PID/PGID/start identity必须与job record相等。Darwin environment只允许
`DARWIN/TRUSTED_LEAF_COORDINATOR/DarwinProcessStartIdentity`，且每个predecessor
termination只允许`BOOT_BOUNDARY_ATTESTED`；Linux只允许
`LINUX/LINUX_PID_NAMESPACE/LinuxProcessStartIdentity/
PID_NAMESPACE_INIT_TERMINATED`或pidfd-owner crash后的
`BOOT_BOUNDARY_ATTESTED`；epoch、
job、completion和termination中的所有OS-tagged process identity必须与environment
branch相同，任何cross-branch组合均拒绝。
`jobRuntimeDigest`覆盖除自身外的完整`ProofAdmissionJobRuntimeIdentity`；
INTERPRETED_SOURCE的entrypoint path/hash/source-node digest必须匹配proof-admission
inventory，且blocked pre-exec child在release前复验executable/interpreter bytes；
v1 claim emitter只允许source-only Python interpreted entrypoint，不允许native、
shell或Node emitter。Runtime identity、epoch和completion必须逐项携带
`NO_CHILD_NO_SESSION_CHANGE_V1`。`ForbiddenProcessApiScan`覆盖entrypoint的完整
proof-admission source-node closure；`inspectedNodes`必须与该closure逐项相等，
scanner source/rule registry都来自同一authority source commit，`findings`必须为空。
`scannerSourceFiles` is not caller-selected:
`FORBIDDEN_PROCESS_API_SCANNER_SOURCE_V1` starts at fixed
`tooling/acceptance/core/proof_admission.py::scan_forbidden_process_apis` and
includes its complete source-only transitive project import closure. V1 claim
source may contain no `Import` or `ImportFrom` node. The wrapper preloads only a
facade exposing canonical JSON encode/decode, not the module object. It executes
claim source with `__builtins__` replaced by the exact
`CLAIM_EMITTER_BUILTIN_ALLOWLIST_V1`; `open`, `__import__`, `eval`, `exec`,
`compile`, `input`, globals/locals access and attribute mutation are absent.
Only `CLAIM_EMITTER_AST_ALLOWLIST_V1` nodes are accepted; `Attribute` is accepted
only in the exact direct `canonical_json.encode|decode` call shape declared
above, and no callable object is
exposed as a value. Bootstrap-owned modules, raw FDs and module globals are not
injected. This is a fixed declarative emitter subset, not Python sandboxing.
The exact `FORBIDDEN_PROCESS_API_SCANNER_V1` registry is:
`CREATE_PROCESS={subprocess, multiprocessing, os.fork, os.forkpty, os.vfork,
os.posix_spawn, os.posix_spawnp, asyncio.create_subprocess_exec,
asyncio.create_subprocess_shell, pty.fork, os.spawnl, os.spawnle, os.spawnlp,
os.spawnlpe, os.spawnv, os.spawnve, os.spawnvp, os.spawnvpe, posix.fork,
posix.forkpty, posix.posix_spawn, posix.posix_spawnp}`；
`REPLACE_PROCESS_IMAGE={os.execl, os.execle, os.execlp, os.execlpe, os.execv,
os.execve, os.execvp, os.execvpe, posix.execv, posix.execve}`；
`EXEC_SHELL={os.system, os.popen, pty.spawn, subprocess shell=True, posix.system}`；
`CREATE_SESSION={os.setsid, posix.setsid}`；
`CHANGE_PROCESS_GROUP={os.setpgid, posix.setpgid}`；
`DYNAMIC_SYMBOL_RESOLUTION={importlib, __import__, eval, exec, ctypes, cffi}`；
`LOAD_NATIVE_EXTENSION={any non-source module loader or extension-module origin}`。
AST alias resolution is transitive; star import, computed attribute/call target,
dynamic import, unresolved call target or scanner-unsupported syntax fails closed.
`ruleDigest` covers each complete sorted rule, `ruleRegistryDigest` covers the
grammar/operation-sorted complete registry, and `forbiddenProcessApiScanDigest`
covers the complete scan object except itself. Historical validation reloads
the inspected node bytes and `scannerSourceFiles` from the bound source commit,
requires `scannerSourceDigest` to cover that exact sorted source tuple, requires
`scannerInterpreter` executable path/hash, implementation, version,
`astGrammarFeatureVersion` and stdlib digest to equal the
`ProofAdmissionJobRuntimeIdentity` interpreter fields, and reruns the same scanner
under that exact interpreter. `scannerRuntimeDigest` covers the complete
`PythonScannerInterpreterIdentity` except itself, and the enclosing
`ForbiddenProcessApiScan.scannerRuntimeDigest` must equal the nested value. Job
`executablePathHash/executableSha256` and
`interpreterExecutablePathHash/interpreterExecutableSha256` must be pairwise
equal and equal the scanner interpreter executable; argv[0] resolves to those
exact bytes.
Runtime handshake在source load前绑定scan digest，completion只在leaf PID被wait、
lease释放且exact process-group enumeration
为空后使用`LEAF_PROCESS_REAPED`。POSIX `setsid()`可创建新process group：
<https://pubs.opengroup.org/onlinepubs/9799919799/functions/setsid.html>；
`waitpid()`只等待caller child：
<https://pubs.opengroup.org/onlinepubs/9799919799/functions/wait.html>。
因此group membership本身不声明descendant containment；任何无法证明leaf policy的
job或环境只能由exact `ExecutionEnvironmentTermination`关闭。Job record的
`epochDigest`必须resolve并等于
immutable epoch；job的workspace/Gate/coordinator epoch/source commit/
proof-admission source digest和两类lock identity必须与该epoch逐项相等。
`ProofAdmissionEpochRecord.coordinatorPid`与
`executionEnvironmentIdentity.supervisorPid`及
`coordinatorProcessStartIdentity`必须构成同一process identity。
Epoch的predecessor termination必须在first epoch绑定pre-cutover
environment，后续epoch则绑定previous epoch的exact environment identity/digest。
First epoch requires `previousEpochRef=null`; every later epoch requires a
non-null `ProofAdmissionEpochRef` whose coordinator epoch ID derives the fixed
`epochs/<id>.json` path and whose resolved bytes/digest equal the predecessor
used by termination evidence.
The first epoch requires the matching
`DarwinLegacyClaimEnvironmentIdentity/DarwinLegacyEnvironmentTermination` or
`LinuxLegacyClaimEnvironmentIdentity/LinuxLegacyEnvironmentTermination`;
policy-governed environment identity types are invalid in that slot.
Darwin first epoch cannot retroactively prove that arbitrary pre-cutover
processes obeyed the leaf policy, so it requires
`DarwinBootBoundaryAttestation` from the fixed source/runtime-bound kernel helper.
Both `kern.bootsessionuuid` and `kern.boottime` must differ from the durable
pre-restart observation; missing/unsupported sysctl or helper drift returns
`NO_MUTATION`. This is a capability-attested project boundary, not a claim that
UUID inequality alone is an Apple API guarantee. The prior
`DarwinBootBoundaryObservation` is atomically published and durability-profile
synced under fixed
`claim-admission/boot-boundaries/<observation-id>.json` after claim-consumer
source cutover and before the mandatory reboot; the attestation embeds its exact
bytes/digest plus a fresh observation.
Both observations bind helper source/runtime and source commit. The helper reads
the two read-only kernel sysctls directly and is part of the proof-admission
source closure; historical validation resolves the prior fixed-path record and
reruns all digest/equality checks. Linux first epoch follows the same
source-cutover/observation/reboot sequence with a durable
`LinuxBootBoundaryObservation`; both `/proc/sys/kernel/random/boot_id` and
kernel boot time must differ in the source/runtime/profile-bound
`LinuxBootBoundaryAttestation`. Every later Darwin epoch uses the same
durability-profile-bound before-observation, reboot and after-observation
protocol. Process absence, lease release, a shutdown-intent file or PID reuse
cannot replace the boot boundary and cannot select another termination branch.
Linux binds `/proc/<init>/ns/pid`
device/inode plus namespace-init PID/start identity and a pidfd opened before any
claim job is released. Parse each `UInt32String` as an unsigned 32-bit mask.
Before the consuming wait,
`pidfdPollInSet == ((pidfdPollReventsRaw & POLLIN) != 0) == true`,
`pidfdPollErrorBits ==
(pidfdPollReventsRaw & (POLLERR | POLLNVAL)) == 0`, and
`pidfdPollHupBeforeWait ==
((pidfdPollReventsRaw & POLLHUP) != 0) == false`. After the wait,
`postWaitPidfdPollHupSet ==
((postWaitPidfdPollReventsRaw & POLLHUP) != 0) == true` and
`postWaitPidfdPollErrorBits ==
(postWaitPidfdPollReventsRaw & (POLLERR | POLLNVAL)) == 0`.
Additional non-error bits are preserved in the raw masks rather than normalized
away. Both polls and the consuming wait must use the same still-open pidfd
open-file description identified by `probePidfdLeaseId`; descriptor replacement,
reopen, duplication or transfer invalidates the evidence. The same live pidfd must supply
`waitid(P_PIDFD, ...)` termination status; inode metadata is not treated as pidfd
identity. The termination helper must match the exact prior environment, then
consume the namespace-init wait. No procfs census is accepted as proof because
its visibility depends on the PID namespace that mounted procfs. D-19 derives
zero surviving target processes only from the kernel rule that terminating a
PID namespace init kills every process in that namespace, combined with the
identity-bound consuming pidfd wait. Pidfd polling/wait is documented at
<https://man7.org/linux/man-pages/man2/pidfd_open.2.html>; terminating a PID
namespace init sends SIGKILL to its processes:
<https://man7.org/linux/man-pages/man7/pid_namespaces.7.html>. Open namespace
FDs or bind mounts may retain the namespace object, so D-19 claims zero surviving
processes, not destruction of all namespace pins.
For either legacy branch,
`executionEnvironmentIdentity.bootObservationDigest ==
bootBoundaryAttestation.priorObservation.observationDigest`; prior/current
observations must have equal workspace, Gate, source commit, durability profile
helper identity and stable `hostIdentity`, while their observation IDs and boot
identities differ. For policy-governed epochs that stable identity also equals
both predecessor and successor execution environments.
Every `KernelEvidenceHelperIdentity` uses its helper-kind-specific fixed function in
`proof_admission.py`; `KERNEL_EVIDENCE_HELPER_SOURCE_V1` deterministically expands
that function's complete source-only project closure, and its runtime manifest
ref/digest resolve through the durability capability artifact set.
For later Linux, pidfd owner PID/start identity equals the epoch supervisor,
and `LinuxPidfdWaitCapabilityEvidence` must have been captured before environment
allocation with `LinuxRuntimeHostBuild` exactly equal to the allocation host and
`hostIdentity` byte-equal to the enclosing Linux execution environment; a
same-build probe from another host is invalid. Its sacrificial child probe must
successfully open a pidfd and consume status with
`waitid(P_PIDFD, WEXITED)`; absence of either kernel capability rejects
allocation rather than deferring failure to termination. Its child PID/start
identity and `probePidfdLeaseId` are identical across the pre-wait poll,
consuming wait and post-wait poll, and every derived readiness field satisfies
the exact raw-mask equations above.
The supervisor
opens the pidfd before releasing any job, remains namespace init's wait-capable
parent with default `SIGCHLD`, `SA_NOCLDWAIT=false` and no other waiter, and
retains the same `namespaceInitPidfdLeaseId` through `POLLIN` and the consuming
`waitid(P_PIDFD, WEXITED)` call. `LinuxWaitIdStatus.siPid` must equal
`namespaceInitPid`, and `ECHILD`, `WNOWAIT`, identity mismatch or non-child
status invalidates the proof. Pidfd ownership is never transferred. A graceful successor
epoch is forbidden until that owner durably records termination; owner crash
requires a new Linux boot-boundary attestation before any replacement epoch.
For every sequence `1..lastAcceptedJobSequence`, quiescence requires exactly one
job record and exactly one completion, with no gaps/duplicates/extra sequence;
its registration/completion digest tuples按sequence ascending完整列出。Every
`COMPLETED` sequence additionally requires exactly one matching acknowledged
emission and no pending intent; other terminal states require no emission.
`COMPLETED` and `CANCELLED`
require the exact leaf-process wait status, matching policy/scan digest and an
empty exact group enumeration; they do not claim generic descendant containment.
`REAPED` is allowed only through orphan recovery while paused and
holding the exclusive claim lock plus verified prior
`ExecutionEnvironmentTermination`. A job record durable before lease acquisition
or completion is recovered only by proving its advisory lease absent and exact
PID/PGID/start identity group terminated by that environment boundary, then
publishing/fsyncing one `REAPED` completion; PID-only or process-name checks are
insufficient.
Initial interlock
authorization要求quiescence source/digest与自身proof-admission source相等，
coordinator epoch来自source cutover后的fresh execution-environment restart，且
`activeJobs`必须是exact empty tuple。Both permanent claim/sequence lock identities
must match epoch, pause, jobs and quiescence. Job registry、pause与exclusive claim lock
共同关闭start/quiesce race。
Interlock authorization和每个activation
authorization都绑定该digest；`AuthoritativeLatestResolution`必须逐层验证current
generation authorization的rule/digest，并要求running claim-admission source从同一
commit/rule重算相等。Interlock install前的tree-wide scan不得存在绕过
`AuthoritativeLatestResolution`的project-owned claim consumer。
`resolutionDigest`覆盖除自身外的完整`AuthoritativeLatestResolution`。LEGACY branch
要求interlock/generation/enforcement fields全为null且Store中四类enforcement marker
全部不存在；FINALIZER_ENFORCED branch要求valid interlock/current/generation并逐项填入
matching digests。两种branch都绑定resolved immutable manifest ref/hash与其canonical
result tuple；raw manifest或free-form output不是该类型。
`currentDigest` preimage是除自身外的完整`FinalizerEnforcementCurrent`；current的
workspace/Gate/generation/enforcement digest必须与resolved immutable generation
record逐项相等。
`intentDigest` preimage是除自身外的完整`FinalizerActivationIntent`，因此绑定
workspace、Gate、target/expected generation、expected prior pointer及全部D-19
digests、`activatedAt`、`activationSourceCommit`和完整authorization。Intent的
workspace/Gate/finalizer、target/expected generation、expected prior pointer digest、
content digests、activatedAt/source commit必须逐项等于authorization；publish-lock内
captured pointer必须匹配authorization的expected pointer digest。Candidate enforcement record的
`generation/gateId/activatedAt/activationSourceCommit/requirementDigest/configDigest/
sourceDigest/protectedBaselineDigest`逐项来自intent，prior pointer/digest逐项来自
publish-lock内capture；计算`enforcementDigest`后完整record进入pending。
`pendingDigest` preimage是除自身外的完整`FinalizerActivationPending`，
使用独立domain并绑定pending生效时捕获的prior pointer；`priorLatestPointerDigest`
覆盖完整`LatestPointer`。
`requestPayloadDigest`覆盖除`WorkerRequestIdentity`外的完整typed request payload；
`ownerBindingDigest`按role使用exact tagged-union preimage：
`GATE_DIRECTORY={role,workspaceId,gateId}`、
`RUN_DIRECTORY={role,workspaceId,gateId,evidenceRunId}`、
`REPOSITORY_ROOT={role,workspaceId,sourceCommit,workspaceDigest,canonicalWorktreeHash}`、
`TEMPORARY_DIRECTORY={role,supervisorSessionId,requestId,tempNonce}`；
`descriptorClaimDigest`覆盖除自身外的完整`DescriptorClaim`；
`requestIdentityDigest`使用独立domain覆盖除自身外的完整
`WorkerRequestIdentity`，因此绑定session/request/sequence/worker kind、ordered
descriptor roles和payload digest；所有control/FD frames都携带并复验完整identity。
`frameDigest`覆盖除自身外的完整`SupervisorControlFrame`或
`SupervisorAncillaryFrame` concrete variant；decoder先按channel和`frameType`选择
exact key set，再验证digest和上述state transition/correlation。
`workerResultDigest`覆盖除自身外的完整non-maintenance `WorkerResult` concrete
variant；decoder按worker kind只接受对应completed/failed shape且拒绝unknown fields。
`contractRoleProjectionDigest` exact preimage为
`{finalizerId, evidenceRoleNames}`，其中role names必须UTF-8 lexical sort、non-empty、
unique且无unknown field；该值即`contractRoleProjectionDigest`。
`deletionPlanDigest`覆盖除自身外的完整`AbortDeletionPlan`；entries来自delete前
冻结的bounded no-follow inventory并按`(depth descending, UTF-8 path ascending)`排序。
`controlRefDigest`覆盖除自身外的完整`AbortControlArtifactRef`，resolver只能从其中
identity派生fixed gate-scoped control path。
`abortPreflightRequestDigest` and `abortPreflightResultDigest` cover their
respective complete objects except their self digest. Rejection request identity
must equal the target `AbortAuthorization` workspace/Gate/run/authorization/
attempt/source/profile fields, and `hostOsFamily` must equal the profile OS.
`tombstoneIdentityDigest` exact preimage为
`{workspaceId, gateId, evidenceRunId, authorizationId,
runDirectoryClaim.descriptorClaimDigest, snapshotDigest, requirementDigest}`。
Pre-rename authorization captures the claim from the opened live run-directory FD;
post-rename retry reopens the tombstone from the gate FD and requires exact
device/inode/type/owner-binding equality before planning or deletion.
`continuationToken`不是secret MAC；它是
`pt.acceptance.finalization.abort-continuation.v1`对
`{authorizationId, eventSequence, nextDeletionPlanIndex, deletionPlanDigest,
tombstoneIdentityDigest}`的JCS digest，并必须与referenced durable chain-head event
逐项重算相等。
Abort `confirmationChallengeDigest` exact preimage为
the complete `AbortAuthorization` except `confirmationChallengeDigest`, including
its command-scoped `attemptId`, timestamp, source closure and maintenance runtime；
CLI显示并要求从控制TTY回输其完整lowercase
hex。每个abort maintenance request的`expectedMaintenanceRuntimeDigest`必须与该
authorization、live `SUPERVISOR_READY`和worker runtime逐项相等。
Authority `confirmationChallengeDigest`使用
`pt.acceptance.finalization.authority-confirmation.v1`覆盖
`FinalizerAuthorityAuthorization`除
`confirmationChallengeDigest/authorizationDigest`外的完整closed object；
`authorizationDigest`使用
`pt.acceptance.finalization.authority-authorization.v1`覆盖除自身外的完整object，
因此同时绑定challenge、maintenance runtime与durability profile。
`durabilityProfileDigest`分别使用
`pt.acceptance.finalization.durability-profile.linux.v1`或
`pt.acceptance.finalization.durability-profile.darwin.v1`覆盖除自身外的完整
tagged branch；Darwin `anchorIdentityDigest`使用独立domain覆盖完整sync-anchor
identity。Requirement、preflight token、authority/abort authorization、request和
opened authority root的profile digest必须逐项相等。
`probeSourceDigest` covers the exact sorted
`ProofAuthorityDurabilityCapabilityEvidence.probeSourceFiles` tuple, and
`capabilityEvidenceDigest` covers the complete capability object except itself.
Its OS/backend/stable-volume and qualified environment must equal the profile.
Its bootstrap qualification manifest resolves and equals both
`bootstrapQualificationManifestDigest` and the active anchor's
`qualificationManifestDigest`; its controller trust ref resolves that active
anchor and equals `controllerTrustAnchorDigest`. The
`qualifiedBackendIdentityDigest` is the dedicated-domain digest of
`{backend,stableVolumeIdentity,qualifiedEnvironment,operationSequence,
probeRuntimeDigest,controllerRuntimeDigest,controllerRuntimeLockBackendDigest}`
from the successful qualification manifest and equals the
promotion authorization plus active anchor. These equalities make the final
capability evidence post-promotion and remove the bootstrap cycle.
The candidate and anchor contain the same reconstructible
`PowerControllerRuntimeIdentity`. The bootstrap candidate contains only
`PowerControllerRuntimeStoreBootstrapIdentity`, never a qualified profile.
After controller-store qualification, the promotion intent and active anchor
contain the full `PowerControllerRuntimeLockBackendIdentity`; its projection
`{osFamily,controllerHostBuild,controllerStableVolumeIdentity,filesystemType,
productionLockDeviceId,productionLockInode,productionLockMountIdentity,
localityEvidence,lockPrimitive}` must be byte-equal to the candidate bootstrap
store identity excluding `bootstrapStoreIdentityDigest`, and its profile must
bind that same identity. The qualification manifest and capability evidence carry the full
runtime/backend digests. Every epoch's complete runtime and qualified lock
objects must be byte-equal to the active-anchor objects, and the live process remeasures source/executable
bytes before epoch publication and before power action. Lock locality is
kernel-derived: Linux uses `fstatfs` plus the exact `/proc/self/mountinfo` mount
record and rejects NFS/CIFS/SMB/FUSE network types; Darwin requires `fstatfs`
`MNT_LOCAL` and rejects network mounts. The target-under-test environment and
external controller environment are independent and may be different hosts and
volumes. The target is identified by
`qualificationManifest.qualifiedEnvironment`; the controller journal store is
independently qualified by the complete
`PowerControllerRuntimeLockBackendIdentity`. The lock backend's
`controllerHostBuild` must equal `localityEvidence.hostBuild`,
`contentionEvidence.hostBuild` and every epoch lease `hostBuild`, but must not be
equated to the target `qualifiedEnvironment.hostBuild`. Its
`controllerHostIdentity` must likewise equal locality, contention, profile,
epoch and lease host identity and must remain different from the interrupted
target identity when they are different machines.
`controllerStableVolumeIdentity` is controller-local and its digest must equal
the `productionLockMountIdentity.stableVolumeIdentityDigest`. Its complete
`productionLockMountIdentity` must be
byte-equal to the locality and contention mount identities and every epoch lease
`productionLockMountIdentity`; that identity's host build, filesystem implementation,
required mount options and stable-volume digest must equal the independently
qualified controller-store environment, never the interrupted target
environment. The backend/locality/contention/lease filesystem type and
device/inode fields must all equal the opened
`controllerPersistentStore/.runtime.lock` object measured with `fstat`.
Contention and lease controller identities must equal the
candidate/anchor/epoch controller. Every command separately binds
`PowerControllerReceipt.targetHostBuild` and `qualifiedEnvironmentDigest` to
the interrupted target while its epoch/lease bind the external controller.
The nested `PowerControllerStoreDurabilityProfile` is the only durability
authority for controller runtime epochs, current pointers, command entries and
heads. Its backend/host/stable-volume/filesystem/options/operation sequence and
Darwin anchor are byte-equal to its qualification evidence and the enclosing
lock backend. Its workspace/Gate/fixture/run/controller identity is byte-equal
to the bootstrap candidate, trust anchor and enclosing command qualification.
Before the first store mutation, the candidate bootstrap sync contract atomic
no-replace publishes the qualification-wide
`ControllerStoreDurabilityExpectationRecord`. The qualification evidence
`expectationRef` has `artifactName=EXPECTATION`, `caseId=null` and
`objectDigest=controllerStoreExpectationDigest`; all other controller-store refs
have non-null case IDs. The record's candidate/run/qualification/controller/
environment identity equals the qualification, and its complete ordered case
tuple is fixed before interruption. Every case expected state/hash and
interruption point equals exactly one tuple entry; every signed interruption
and recovery `expectationDigest` equals that record.
Each case ref has the exact workspace/Gate/fixture/run/qualification/controller/
qualified-environment identity and its `caseId` equals the enclosing case.
Its artifact name is
`BEFORE_BOOT_OBSERVATION`, `AFTER_BOOT_OBSERVATION`,
`INTERRUPTION_EVIDENCE`, `RECOVERY_EVIDENCE`
in field order; each resolved object repeats those identities, its digest
matches the ref bytes and its interruption point, when present, equals the
case. Boot refs resolve the OS-matching
`DarwinControllerStoreBootObservation` or
`LinuxControllerStoreBootObservation`; interruption and recovery refs resolve
`ControllerStoreQualificationInterruptionEvidence` and
`ControllerStoreQualificationRecoveryEvidence`. The before ref resolves
`observationPhase=BEFORE` and
`objectDigest=controllerStoreBootObservationDigest`; the after ref resolves
`observationPhase=AFTER` with the same equation. The interruption ref
`objectDigest` equals `qualificationInterruptionDigest`, whose
`beforeBootObservationDigest/afterBootObservationDigest` equal the two resolved
observation digests. The recovery ref `objectDigest` equals
`controllerStoreRecoveryDigest`, and its nested `afterBootObservationRef` is
byte-equal to the case after ref. Its nested `interruptionEvidenceRef` is
byte-equal to the case interruption ref, and its
`qualificationInterruptionDigest` equals both that ref's `objectDigest` and the
resolved signed interruption digest. The case
`observedRecoveredState/observedContentSha256` must be byte-equal to the signed
recovery fields. `PASS` is valid only when those signed values equal the case
expected state/hash and are not `OTHER`; the signed recovery is the sole
authority for the observed result. Linux requires
`(WRITE_TEMP,SYNC_FILE,RENAME_FINAL,SYNC_DIRECTORY)`; Darwin additionally
requires `SYNC_ANCHOR`; Linux requires a null anchor and Darwin requires a
same-volume non-null anchor. The qualification uses the owner-authorized bootstrap
candidate's same controller identity and reviewed runtime, but targets the
controller store itself. A distinct qualification-only witness performs and
signs the controller-host interruption at every declared boundary. Its identity,
public key, approval path/hash and `productionAuthorityEligible=false` are
digest-bound; its subject identity equals the controller under test.
Qualification verification accepts only the canonical P-256 witness credential,
while bootstrap candidates, active anchors, receipts, epochs, journals and
actuator dispatch accept only the canonical Ed25519 production credential.
Neither parser accepts converted or untagged keys. The witness is an evidence
producer only and cannot mutate production authority. Its signature
must verify with the qualification-only witness key over the exact
domain-wrapped payload defined in §20.3. The restarted
controller resolves immutable before/after observations and recovered bytes.
The signed interruption `targetControllerHostBuild` is byte-equal to
`qualificationEvidence.qualifiedEnvironment.hostBuild` and therefore to the
enclosing Linux or Darwin profile's typed `qualifiedControllerHostBuild`;
its `targetControllerHostIdentity` is byte-equal to the qualified environment,
profile and both boot observations. Cross-OS or cross-host combinations are
invalid.
For each case, before/after refs, content hashes and observation phases are
distinct; both observations use the same OS and host identity, their boot
identity and boot time differ, and
`before.observedAt < interruption.interruptedAt < after.observedAt <=
recovery.recoveredAt`. Every case
must be `PASS`, cover the complete branch-specific interruption matrix and
satisfy the same expected/observed state/hash rules as the target durability
fixture. The profile is established before trust promotion; its complete digest
is embedded in the promotion intent, active anchor, every runtime epoch and
therefore every command identity, but never in the bootstrap candidate. Target
qualification never substitutes for this profile.
Contention uses two distinct local processes opening that exact object with
exactly one `FLOCK_EX_NB` success. Qualification, epoch publication and every
pre-action revalidation remeasure the live host, mount and opened lock object;
missing, stale, self-declared or mismatched runtime/lock evidence rejects
authority.
Every authority use derives a current qualified environment and requires exact
host-build/filesystem-implementation/options/stable-volume equality; live mount
identity may differ only where the profile permits remount and must still resolve
the same stable volume and required options. Otherwise requalification is
mandatory. The
`durabilityCapabilityRefDigest` covers each complete ref except itself; the
resolver derives only
`finalizer-enforcement/durability-capabilities/<crashFixtureId>/` paths from the
closed identity. Historical validation resolves every ref, requires the
MANIFEST ref to equal `crashFixtureManifestRef`, reconstructs the declared probe
runtime and verifies `probeRuntimeDigest` over the complete
`DurabilityProbeRuntimeManifest` except itself, then verifies trace/recovery result
bytes and the complete ref set. `scannerSourceDigest` likewise covers
the exact sorted `ForbiddenProcessApiScan.scannerSourceFiles` tuple.
`observationDigest`、`observationRefDigest`、`bootBoundaryAttestationDigest`和
`namespaceTerminationEvidenceDigest`分别覆盖对应
完整closed object（除自身digest）。Prior boot observation必须resolve fixed durable
record；current observation不得冒充prior record。A
`DarwinBootBoundaryObservationRef` resolves only the fixed
`claim-admission/boot-boundaries/<observation-id>.json` path and its
workspace/Gate/observation ID/digest must equal the resolved complete
observation. `LinuxBootBoundaryObservationRef` has the identical fixed-path,
identity and digest rules and resolves only `LinuxBootBoundaryObservation`.
Every Darwin or Linux execution environment's epoch ref resolves exact
bytes whose digest equals `epochBootObservationDigest`; the supervisor process
start boot identity equals that observation's `bootSessionUuid` or `bootId`.
A later Darwin termination
requires those resolved bytes to equal the attestation's `priorObservation`,
while its `currentObservation` has a different boot identity and is captured
before the successor supervisor starts. A Linux pidfd-owner-crash termination
applies the same predecessor/successor equality to its Linux attestation; the
new observation is captured after the boot change and before the successor
epoch starts. Darwin helper source/runtime digests
以及Linux boot/termination helper source/runtime digests必须等于profile capability
evidence中的`probeSourceDigest/probeRuntimeDigest`。Interlock、activation与abort
另外逐项验证各自authorization的maintenance runtime；first boot observation不依赖
尚不存在的active generation。
`maintenanceRuntimeDigest`使用
`pt.acceptance.finalization.maintenance-runtime.v1`覆盖除自身外的完整
`FinalizerMaintenanceRuntimeIdentity`。`workerSourceDigest`使用
`pt.acceptance.finalization.maintenance-worker-source.v1`覆盖
`MAINTENANCE_WORKER_SOURCE_V1`从fixed `core/finalizer_worker.py` MAINTENANCE
entrypoint经source-only resolver得到的完整lexically sorted
`(repoRelativePath,fileSha256,byteLength)` closure；完整tuple持久化在
`workerSourceFiles`。`authorityRuntimeRefDigest`覆盖除自身外的完整
`AuthorityRuntimeArtifactRef`；resolver只接受其fixed content-addressed authority
runtime namespace。`runtimeCaptureId + runtimeMeasurement + capturedRuntimeFiles +
runtimeCaptureBundleDigest`构成完整capture preimage，`runtimeArtifacts`与captured
files逐项一一对应。Historical reader resolve refs、重建canonical runtime bundle并
重算capture/maintenance digests；每个ref的workspace/Gate/authorization ID必须分别
等于其runtime与外层authority/abort authorization，persist request也必须使用同一
authorization ID；digest相等不能替代这些cross-field equality checks。其中
`supervisorRuntimeDigest`必须等于live
`SUPERVISOR_READY`，Python implementation/version、host build、dynamic loader、
loaded images、executable、stdlib和compiler identity全部进入authorization。
`approvalDocumentSha256`是
`authoritySourceCommit:approvalDocumentPath` exact bytes的raw SHA-256；path必须是
固定canonical decisions path。Authorization owner还必须证明
`authoritySourceCommit == current HEAD`、authority-bearing worktree inputs clean，并
从该commit重算proof-admission与activation content digests；禁止把stale/superseded
commit中的accepted文本与其它commit的candidate digests组合。Path禁止absolute、`..`、
symlink escape或worktree-external resolution。
Power-controller trust enrollment applies the same principal, TTY, canonical
approval path/hash, clean-HEAD and isolated-source checks independently of any
durability fixture. `CREATE_BOOTSTRAP_CANDIDATE` requires null candidate,
qualification and backend digests; it writes only the non-authoritative
candidate with `OS_STRONGEST_AVAILABLE_SYNC_V1`. Every production controller
identity, authorization, candidate and anchor repeats
`controllerSignatureAlgorithm=ED25519`; their 32-byte public-key bytes and raw
SHA-256 must be equal. Every qualification witness identity, authorization,
interruption and recovery carries the matching
`ECDSA_P256_SHA256_P1363_LOW_S` algorithm tag; its canonical 65-byte SEC1 public
key and raw SHA-256 must be equal. No parser may coerce, convert or compare an
untagged key across those two closed credential types.
`PROMOTE_ACTIVE_ANCHOR`
requires all three digests non-null and equal to the resolved candidate,
successful qualification manifest and canonical
`{backend,stableVolumeIdentity,qualifiedEnvironment,operationSequence,
probeRuntimeDigest,controllerRuntimeDigest,controllerRuntimeLockBackendDigest}`
backend projection. The active anchor's workspace/Gate,
controller identity, public key/hash, approval path/hash, source commit and
`enrolledAt` equal its promotion authorization; the identity's
`publicKeySha256` also equals `controllerPublicKeySha256`.
Initial promotion requires `expectedCurrentState=ABSENT`; rotation requires the
exact resolved ACTIVE or REVOKED current digest; revocation requires the exact
resolved ACTIVE current digest. All are checked while holding `.publish.lock`.
Every transition first atomic no-replace publishes one
`PowerControllerTrustTransitionReservation` at
`controller-trust/transition-reservations/<predecessor-key>.json`, where the
key is `ABSENT` for initial promotion and otherwise the exact expected current
digest. The reservation embeds the complete frozen promotion or revocation
intent. An existing equal reservation is retryable; unequal bytes permanently
reject a sibling successor without directory scanning.
Promotion or rotation then uses the newly qualified backend to publish the
embedded `PowerControllerTrustPromotionIntent`, candidate consumption, active
anchor, immutable generation and CAS current selector, in that order.
Revocation uses the current qualified backend to publish the embedded
`PowerControllerTrustRevocationIntent`, immutable revocation, immutable revoked
generation and CAS current selector, in that order; it never deletes the old
anchor. A crash retry first resolves the predecessor-keyed reservation and may
only finish those exact embedded bytes; it cannot replace authorization,
qualification, backend, anchor, generation or current.
The revocation's generation, predecessor generation ref, revoked anchor digest
and reason code equal its authorization and resolved ACTIVE predecessor; its
typed ref and REVOKED current selector repeat the same generation and digest.
Promotion uses the newly qualified backend to atomic no-replace publish and sync
the anchor, generation and other immutable paths and CAS-replace the selector
with directory durability. An
active-authority read starts from `controller-trust/current.json`, rejects the
REVOKED generation branch, resolves the exact immutable generation and its
generation-matched anchor, then derives and resolves its bootstrap
`candidate.json`, that candidate's `consumed.json`, and the consumption's
typed promotion-intent ref at
`controller-trust/promotions/<promotionAuthorizationId>/intent.json`.
The ref ID/digest must equal the consumption and intent's embedded promotion
authorization. Current-to-generation-to-anchor digest, both candidate authorizations,
consumption/intent digests, candidate/fixture/run, qualification/backend and
frozen anchor/generation/current bytes must all match. Historical validation
resolves each `PowerControllerTrustGenerationRef` only at
`controller-trust/generations/<trustGeneration>-<trustGenerationDigest>.json`,
derives `ABSENT` for generation 1 or reconstructs the canonical predecessor
current selector and digest from the predecessor generation ref for every later
edge, resolves the exact
`transition-reservations/<predecessor-key>.json`, and requires its embedded
intent/candidate bytes and digest to equal the selected generation,
anchor-or-revocation and current-selector transition. It then follows every
typed predecessor-generation ref to generation 1 and rejects a
missing record, digest/generation mismatch, repeated generation, cycle, sibling
successor or non-monotonic edge; it never scans directories or infers history
from the mutable selector. Missing/corrupt predecessor state fails closed. The final
`ProofAuthorityDurabilityCapabilityEvidence` is created only afterward and binds
the same bootstrap manifest plus active anchor; only that evidence may enter a
`ProofAuthorityDurabilityProfile`. Enrollment is invalid if the approval
document did not already accept D-19 at `authoritySourceCommit`; a
fixture-generated key or self-signed enrollment is never authority.
每个closed `MaintenanceResult` variant的`resultDigest`覆盖除自身外的完整variant，
并必须携带同一request identity；operation、status、durableBoundary、operation-specific
payload、failureCode和diagnostic均进入preimage。
`InstallPublicationInterlockCompleted/Failed.interlockDigest` must equal
`InstallPublicationInterlockRequest.candidateInterlock.interlockDigest`.
`ActivateEnforcementCompleted/Failed.generation` must equal
`ActivateEnforcementRequest.intent.targetGeneration`, and its
`enforcementDigest` must equal the digest of the candidate enforcement record
deterministically derived from that exact intent. Rejected branches retain their
specified nullability. Request-identity equality alone cannot substitute these
operation-specific equalities.
For every maintenance request, top-level workspace/Gate equals the
`GATE_DIRECTORY` owner binding and every nested interlock/intent/authorization
identity. Abort request workspace/Gate/run/authorization/attempt fields equal
the embedded or durably resolved authorization and chain head.
`ActivateEnforcementRejected.generation` is null before a valid intent is
established; otherwise it equals `intent.targetGeneration`.
`WriteAuthorizationCompleted/Failed` event type/digest must equal the exact
AUTHORIZED event derived from `WriteAbortEventRequest.authorization`, except the
documented `NONE` branch where `eventDigest` remains null.
Every `TombstoneRun*` authorization/attempt/workspace/Gate/run/snapshot field
must equal its request; non-null plan/ref/token/event fields must equal the
durable tombstone event derived from that authorization.
Every `DeleteTombstoneBatch*` authorization/attempt/plan/ref/input
continuation identity must equal its request and durable chain head; output
continuation/event digest and deletion counters are derived only from the exact
authorized plan range. Any mismatch makes the response invalid before state
advancement.

### 20.4 单调结果合并

| Primary canonical tuple | Finalizer outcome | Published canonical tuple |
|---|---|---|
| `passed/DONE/PROVEN` | `VALIDATED` | `passed/DONE/PROVEN` |
| `passed/DONE/PROVEN` | `REJECTED/BLOCKED/TIMED_OUT/ERROR` | `failed/PARTIAL/UNPROVEN` |
| `passed/DONE/PROVEN` | missing、invalid或identity mismatch | `failed/PARTIAL/UNPROVEN` |
| `passed/DONE/UNPROVEN` | `VALIDATED` | 保持`passed/DONE/UNPROVEN` |
| `passed/DONE/UNPROVEN` | 其它、missing或invalid | `failed/PARTIAL/UNPROVEN` |
| `passed/PARTIAL/UNPROVEN` | `VALIDATED` | 保持`passed/PARTIAL/UNPROVEN` |
| `passed/PARTIAL/UNPROVEN` | 其它、missing或invalid | `failed/PARTIAL/UNPROVEN` |
| `failed/PARTIAL/UNPROVEN` | 任意outcome | 保持primary tuple、reason与source trace |
| `failed/DONE/UNPROVEN` | 任意outcome | 保持primary tuple、reason与source trace |
| `blocked/BLOCKED/UNPROVEN` | 任意outcome | 保持primary tuple、reason与source trace |
| 任意 | requirement与Catalog均未声明 | 保持现有Gate行为 |

`dry-run`不分配可发布的finalization reservation，也不能产生`PROVEN`。上述集合之外的
primary tuple在reservation前以typed result-contract error拒绝，并归一为
`failed/PARTIAL/UNPROVEN`。

Finalizer不能写artifact、执行cleanup、重新获取资源、调用产品系统、修改primary result
或publish run。Runner只把validated process envelope、primary result和outcome提交给
Evidence Store `finalize_with_evidence()`；Evidence Store验证snapshot/outcome identity、
执行§20.4固定单调merge，并直接构造immutable manifest
`result.evidenceFinalization`，不创建post-seal artifact。未声明finalizer或
pre-seal failed/blocked run分别写`NOT_REQUIRED`或`NOT_INVOKED_PRE_SEAL` record；
required-finalizer run缺少该字段时，reader和validator必须拒绝其`PROVEN`声明。

`EvidenceFinalizationRecord`三个digest进入最终manifest并按字段对应：
`requirementDigest == FinalizerContext.requirementDigest ==
FinalizerRequirementRecord.requirementDigest`；
`configDigest == FinalizerContext.configDigest ==
FinalizerRequirementRecord.configDigest`；
`sourceDigest == FinalizerContext.finalizerSourceDigest ==
FinalizerRequirementRecord.sourceDigest == FinalizerExecutableArtifact.sourceDigest ==
finalizer registration entry.sourceDigest`。不同domain的digest不得互相比较。

Record shape：

- `NOT_REQUIRED`：enforcement generation/digest、三个content digests、
  `primaryResult`、`primaryResultDigest`、`failureCode`和`outcome`均为null；
- `NOT_INVOKED_PRE_SEAL`：
  enforcement generation/digest与三个content digests必填、
  canonical `primaryResult`及其digest必填，
  `failureCode=FINALIZER_NOT_INVOKED_PRE_SEAL`、`outcome=null`。Published tuple按
  §20.4 missing-finalizer规则计算：primary success降级，已有primary failed/blocked
  tuple、reason和source trace保持不变；
- `COMPLETED`：enforcement generation/digest与三个content digests必填、
  canonical `primaryResult`及其digest必须与sealed marker逐字节JCS相等，
  `failureCode=null`、`outcome`必填。

### 20.5 Typed failure codes

Finalizer failure code是closed enum：

```text
FINALIZER_REQUIRED_MISSING
FINALIZER_CONFIG_MISMATCH
FINALIZER_ENFORCEMENT_CHANGED
FINALIZER_NOT_INVOKED_PRE_SEAL
FINALIZER_PRIMARY_RESULT_INVALID
FINALIZER_SNAPSHOT_INVALID
FINALIZER_IDENTITY_MISMATCH
FINALIZER_SOURCE_MISMATCH
FINALIZER_RUNTIME_MISMATCH
FINALIZER_DURABILITY_PROFILE_UNSUPPORTED
FINALIZER_AUTHORITY_RUNTIME_IO_FAILED
FINALIZER_BUNDLE_INVALID
FINALIZER_HARD_TIMEOUT_UNSUPPORTED
FINALIZER_SUPERVISOR_FAILED
FINALIZER_MATERIALIZATION_FAILED
FINALIZER_INPUT_TOO_LARGE
FINALIZER_OUTPUT_TOO_LARGE
FINALIZER_REJECTED
FINALIZER_BLOCKED
FINALIZER_TIMED_OUT
FINALIZER_CANCELLED
FINALIZER_PROCESS_FAILED
FINALIZER_OUTPUT_INVALID
ABORT_SEALED_LOCK_TIMEOUT
ABORT_SEALED_INCOMPLETE
ABORT_SEALED_DELETE_UNSUPPORTED
```

未知failure code等同`FINALIZER_OUTPUT_INVALID`并fail closed。

Maintenance failure code也是closed enum：

```text
MAINTENANCE_IDENTITY_MISMATCH
MAINTENANCE_REQUEST_INVALID
MAINTENANCE_DURABILITY_PROFILE_UNSUPPORTED
MAINTENANCE_DURABLE_STATE_CONFLICT
MAINTENANCE_ACTIVE_RUN
MAINTENANCE_LIMIT_EXCEEDED
MAINTENANCE_TIMED_OUT
MAINTENANCE_IO_FAILED
```

未知maintenance failure code使整个response invalid；Core不得从`diagnostic`推断
operation结果或恢复位置。

| Code | Trigger |
|---|---|
| `FINALIZER_REQUIRED_MISSING` | protected required-finalizer mapping存在但Gate Catalog execution config或finalizer registration entry缺失 |
| `FINALIZER_CONFIG_MISMATCH` | ID、entrypoint、timeout或input limit不匹配 |
| `FINALIZER_ENFORCEMENT_CHANGED` | preflight token的generation/current/enforcement identity与allocation时authoritative state不一致 |
| `FINALIZER_NOT_INVOKED_PRE_SEAL` | required-finalizer Gate在sealed snapshot形成前blocked |
| `FINALIZER_PRIMARY_RESULT_INVALID` | primary result不是§20.4允许的canonical tuple/mapping |
| `FINALIZER_SNAPSHOT_INVALID` | seal、role-instance、payload digest、file set或hash无效 |
| `FINALIZER_IDENTITY_MISMATCH` | workspace/Gate/run/source/manifest binding不一致 |
| `FINALIZER_SOURCE_MISMATCH` | immutable bundle或reviewed dependency source digest不匹配 |
| `FINALIZER_RUNTIME_MISMATCH` | interpreter path/binary/implementation/version/stdlib identity不匹配 |
| `FINALIZER_DURABILITY_PROFILE_UNSUPPORTED` | authority root filesystem/backend/profile无法满足并证明v1 durable transition |
| `FINALIZER_AUTHORITY_RUNTIME_IO_FAILED` | authority-runtime blob/identity write、rename或platform durability backend I/O失败 |
| `FINALIZER_HARD_TIMEOUT_UNSUPPORTED` | host无法提供并验证v1 POSIX default-action hard timer |
| `FINALIZER_SUPERVISOR_FAILED` | READY后supervisor process/control channel退出或worker handshake不完整 |
| `FINALIZER_MATERIALIZATION_FAILED` | bounded snapshot worker无法安全读取、验证或解析sealed artifact |
| `FINALIZER_INPUT_TOO_LARGE` | canonical stdin超过Catalog limit |
| `FINALIZER_OUTPUT_TOO_LARGE` | stdout或stderr超过Core hard limit |
| `FINALIZER_REJECTED` | business evidence validator拒绝snapshot |
| `FINALIZER_BLOCKED` | validator缺少声明的业务evidence |
| `FINALIZER_TIMED_OUT` | bounded finalizer超过deadline |
| `ABORT_SEALED_LOCK_TIMEOUT` | explicit abort无法在aggregate ceiling内按全局顺序取得适用锁 |
| `ABORT_SEALED_INCOMPLETE` | explicit abort达到单次entry/byte/time删除上限，tombstone保留待后续显式重试 |
| `ABORT_SEALED_DELETE_UNSUPPORTED` | host缺少v1 required atomic no-mount-crossing primitive；在authorization/rename/delete前fail closed |
| `FINALIZER_CANCELLED` | orchestrator cancellation终止finalizer |
| `FINALIZER_PROCESS_FAILED` | spawn、exit、signal或reap失败 |
| `FINALIZER_OUTPUT_INVALID` | stdout schema、enum、互斥字段或unknown code无效 |
| `MAINTENANCE_DURABILITY_PROFILE_UNSUPPORTED` | maintenance request profile与authorization/opened authority root/live backend不一致或backend不可用 |

Status/code mapping：

- `VALIDATED`：不得携带failure code；
- `REJECTED`：只能携带`FINALIZER_REJECTED`；
- `BLOCKED`：只能携带`FINALIZER_BLOCKED`；
- `TIMED_OUT`：只能由Core生成并携带`FINALIZER_TIMED_OUT`；
- `ERROR`：只能由Core生成并携带其余`FINALIZER_*` code，包括
  `FINALIZER_CANCELLED`。

Child只能输出`VALIDATED | REJECTED | BLOCKED`。任何child-originated
`TIMED_OUT/ERROR`或status/code冲突均转为Core-owned
`ERROR/FINALIZER_OUTPUT_INVALID`。

---

## 21. Reusable Suite Runtime

### 21.1 Task Contract

A multi-scenario functional Task may declare:

```json
{
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "social-desktop-suite",
    "scenarioIds": ["publish", "comment", "delete"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 3,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  }
}
```

The object is closed. `scenarioIds` are unique and contain at least two
entries. `entryCheckId` references one `FUNCTIONAL_CHECK`. Reuse rates are
finite values in `[0, 1]`; counts are positive integers.

### 21.2 Lifecycle Events

The domain-neutral event set is:

```text
provision
account-provision
client-launch
login
scenario-start
fixture-reset
ui-action
receiver-assertion
supporting-observation
client-replacement
scenario-end
cleanup-complete
```

`provision`, `account-provision`, `client-launch`, and `login` are expensive
Suite actions. When `requireAttachOnlyScenarios=true`, none may occur after the
first `scenario-start`. `client-replacement` is legal only when explicitly
declared and remains a separately visible event.

### 21.3 Suite Runtime Report

One immutable report contains:

- `suiteRuntimeId`, `sourceDigest`, and `fixtureEpoch`;
- the exact `runtimeReuse` contract;
- monotonic lifecycle events;
- provisioning, launch, completion, warm-reuse, and duration metrics;
- typed findings;
- `result`, `proofState`, and canonical `reportDigest`.

`PASS/SUPPORTING` means the lifecycle conforms. It is not
`FUNCTIONAL_PASS/PROVEN`. Missing scenarios, UI action, receiver assertion, or
terminal cleanup keep the report `FAIL/UNPROVEN`.
