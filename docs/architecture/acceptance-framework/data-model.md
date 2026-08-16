# Acceptance Framework — Runtime Provisioning 数据模型

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-16 | **Updated**: 2026-08-16
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 1. Document Scope

本文档定义：

- Environment Provisioning Contract 的机器可读字段。
- Runtime Resource Manifest、Station Attestation、Actor Manifest 和 Gap Artifact。
- Provisioning 生命周期状态及转换规则。
- 敏感值与可持久化 evidence 的边界。

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
    "attestationArtifact": "<repo-relative-report-path>"
  },
  "actorManifest": "<repo-relative-report-path>",
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
- Runtime Manifest、Attestation、Actor Manifest 和 Gap Artifact 存放于
  `tooling/acceptance/reports/`，默认不提交。
- 长期 evidence 只有经过脱敏和人工 review 后才能进入
  `tooling/acceptance/evidence/`。
- URL 可以保留 scheme/host/port；query、token 和 credential 必须脱敏。
- cleanup 后 manifest 保留资源 identity 和释放结果，不保留临时 secret。
