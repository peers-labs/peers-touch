# Acceptance Framework — Runtime Provisioning 数据模型

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-08-16 | **Updated**: 2026-08-24
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 1. Document Scope

本文档定义：

- Environment Provisioning Contract 的机器可读字段。
- Runtime Resource Manifest、Station Attestation、Actor Manifest 和 Gap Artifact。
- Provisioning 生命周期状态及转换规则。
- Native Desktop Runtime Cell、远端 transport、GUI session 与 platform adapter identity。
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
- `source.workspaceDigest` 覆盖所有可执行源码和手写契约，但不包含自动生成的
  `docs/architecture/acceptance-framework/coverage-report.md`；生成覆盖报告不得使
  刚验证的 source-bound evidence 自身失效。
- `station.liveCommit` 来自 live endpoint，不由本地推断。
- `station.attestationArtifact` 指向实际 deployment/runtime producer 的输出。
- `profile.requestedName` 与 `resolvedName` 不一致时状态必须为 `BLOCKED`。
- `env:`、`file:` 和 `auto:` credential references 必须对应已扫描的内存值；
  `fixture:` references 指向仓库中已提交的 disposable 测试数据，不作为 secret
  扫描输入，也不得用于生产运行时。

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
    "desktop-macos-native": {"proofStatus": "PROVEN"},
    "desktop-linux-native": {"proofStatus": "UNPROVEN"},
    "desktop-windows-native": {"proofStatus": "UNPROVEN"}
  },
  "proofStatus": "PARTIAL"
}
```

Aggregation rules:

- `PROVEN` requires every required cell to be `PROVEN` for the same source commit.
- Missing、stale、blocked 或 failed cell 不能由其它平台结果替代。
- Platform-specific subclaims may be reported independently, but the cross-platform
  capability remains `PARTIAL/UNPROVEN` until the full required matrix closes.
