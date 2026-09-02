# Acceptance Framework — Runtime Provisioning 数据模型

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-08-16 | **Updated**: 2026-08-17
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 1. Document Scope

本文档定义：

- Environment Provisioning Contract 的机器可读字段。
- Runtime Resource Manifest、Station Attestation、Actor Manifest 和 Gap Artifact。
- Provisioning 生命周期状态及转换规则。
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
  station:
    required: true
    ready_action: station
    health_action: station-check
    status_action: station-status
    attestation_producer: station-deployment
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
  "station": {
    "url": "<redacted-safe-url>",
    "liveCommit": "<commit>",
    "protoDigest": "<sha256>",
    "attestationArtifact": {
      "artifactKind": "acceptance-artifact-ref",
      "workspaceId": "<workspace-id>",
      "gateId": "<gate-id>",
      "runId": "<run-id>",
      "path": "runtime/station-attestation.json",
      "sha256": "<sha256>",
      "mediaType": "application/json"
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
  "clients": [],
  "cleanup": {
    "registered": true,
    "resources": ["processes", "ports", "storage", "sessions"]
  }
}
```

Manifest identity requirements:

- `runId` 在同一 Acceptance run 内唯一。
- `source.commit` 来自实际客户端 worktree。
- `station.liveCommit` 来自 live endpoint，不由本地推断。
- `station.attestationArtifact` 指向实际 deployment/runtime producer 的输出。
- `profile.requestedName` 与 `resolvedName` 不一致时状态必须为 `BLOCKED`。

## 4. Station Attestation

```json
{
  "artifactKind": "station-deployment-attestation",
  "capturedAt": "<UTC timestamp>",
  "environmentId": "home-station",
  "commit": "<deployed-commit>",
  "workspaceDigest": "clean",
  "protoDigest": "<sha256>",
  "liveMetadata": {
    "buildCommit": "<live-endpoint-commit>"
  },
  "producer": "station-deployment"
}
```

规则：

- Producer 必须是 Station deployment/runtime owner。
- Consumer Gate 必须比较 attested commit、live commit 和 client commit。
- `workspaceDigest != clean` 时 Native source-bound proof fail closed。
- Attestation 不包含部署凭据、SSH target credential 或数据库 secret。

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
else if platform == macOS:
  root = ~/Library/Application Support/PeersTouch/acceptance
else if platform == Linux:
  root = ${XDG_STATE_HOME:-~/.local/state}/peers-touch/acceptance
else if platform == Windows:
  root = %LOCALAPPDATA%\PeersTouch\acceptance
else:
  EvidenceRootUnsupportedPlatform
```

Resolver验证：

- root必须是absolute directory或可安全创建；
- root canonical path不得等于repository root或位于其下；
- existing symlink component、existing non-directory和NUL均拒绝；
- override设置但无效时fail closed，不改用default；
- CI检测到CI environment但没有override时fail closed。

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
        ├── .publish.lock
        └── <run-id>/
            ├── .active.lock
            ├── manifest.json
            ├── reports/
            ├── evidence/
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

## 13. Lifecycle And Locks

```text
ALLOCATED
  -> ACTIVE
  -> FINALIZING
  -> DURABLE
  -> PUBLISHED
  -> CLOSED

ALLOCATED | ACTIVE | FINALIZING
  -> EVIDENCE_FAILED
  -> CLOSED
```

`RunHandle`创建run directory后立即持有`.active.lock`的OS advisory exclusive lock。
Cleanup尝试non-blocking lock：

- lock失败：run active，必须跳过；
- lock成功且无durable manifest：eligible incomplete run；
- lock成功且manifest durable：按explicit retention policy判断；
- latest pointer target：始终保护。

默认retention是retain-all。Cleanup只有在显式提供workspace/gate和age/count policy时
执行；它不得跨workspace扫描后批量删除。

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

## 15. Runtime Matrix Role Policy

> Status: accepted by D-12 on 2026-08-23; schema/version migration is authorized.

每个 matrix row 声明 applicable evidence roles：

```yaml
id: foundation-mobile-contract
gate: agent-v2-kernel-foundation-e2e
platform: mobile_contract
runtime: contract_only
runtime_attestation_profile: contract_only
role_policy:
  always:
    - cell-results
    - runtime-attestation-set
    - cleanup
  required:
    - contract-evidence
  not_applicable:
    - receiver-dom
    - station-readback
    - runtime-events
```

数据约束：

- `always`、`required`、`not_applicable` 两两不相交。
- Gate-level role union 必须等于所有 row 的 `always + required` 并集，加上
  runner-owned roles。
- 每个 tuple 对 `always + required` 中的 role 恰有一条 observation。
- `not_applicable` 中的 role 对该 tuple 必须没有 observation。
- 每个 role artifact 的 `runtimeAttestationRefs` 必须等于它覆盖的 tuple key 集合。
- `sampleCount == observations.length == applicable tuple count`。
- `scenarioIds` 必须等于 applicable tuples 的 cell 集合。
- `contract-evidence` 绑定 contract test ID、contract hash、平台与结果；
  `guard-report` 绑定 guard ID、source inventory hash 与 zero-violation 结果。
- producer 不能自行计算 applicability；只能消费经过 hash/version 校验的 matrix。

`runtime_attestation_profile` payload：

| Profile | Required facts | Forbidden fabrication |
|---|---|---|
| `direct_runtime` | conversation binding, runtime snapshot, TurnAttempt, ToolCall binding, client session | none of these may be inferred from UI |
| `contract_only` | contract ID/hash, platform/toolchain identity, round-trip result | conversation, Turn, ToolCall, DOM |
| `orchestration_guard` | guard ID, source inventory hash, zero-violation result | actor session, Turn, ToolCall, DOM |
| `non_advertised` | capability inventory hash, surface identity, zero-execution result | executable runtime/ToolCall binding |
