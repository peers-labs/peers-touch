# Acceptance Framework — 架构设计

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-06-03 | **Updated**: 2026-08-30
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 1. 核心原则

1. **Capability first** — 验收对象是产品能力，不是脚本、页面或测试文件。
2. **Evidence over confidence** — Agent 的判断必须落到可重复 evidence，不能只给主观信心。
3. **Stable gates only** — 临时探针可以帮助诊断，但不能成为完成标准，除非沉淀为 stable gate。
4. **Bounded intelligence** — AI 负责影响分析、解释与风险复盘；流程负责可重复选择、执行和报告。
5. **Truth-source aware** — 验收必须知道能力的事实源，不得把 transport、cache、UI、hint 当成业务真源。
6. **Provision before proof** — 环境、凭据、Fixture 和 source identity 必须先形成机器可验证的 runtime manifest，Gate 才能执行。
7. **No silent gap** — 缺少 Acceptance contract、runtime resource、evidence 或责任边界时必须输出结构化 gap 并保持 `UNPROVEN`，不得临场绕过。

### 1.1 Runtime Provisioning 扩展证据账本

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Gate Catalog 可为 environment 声明 Provisioner | `verified_fact` | `tooling/acceptance/gates.yaml` | high | non-scope environments remain unchanged |
| `acceptance-run.py` 在产品 Gate 前执行 Provisioner | `verified_fact` | `tooling/scripts/acceptance-run.py::main` | high | successful native runtime proof |
| Native runner 只消费 Runtime Manifest 与 CredentialRef | `verified_fact` | `native_visible_runner.py::NativeVisibleJourney` | high | successful native runtime proof |
| Chat Fixture 产出 source-bound actor manifest | `verified_fact` | `tooling/acceptance/fixtures/chat_native_actors.py` | high | authorized live Fixture run |
| Profile activate 校验文件名与 `PT_DEV_PROFILE` | `verified_fact` | `tooling/scripts/local-dev/profile.sh::activate` | high | none |
| Direct receipt source path 自动选择 Native two-client Gate | `verified_fact` | `acceptance-plan-test.py::BehaviorRuleTests` | high | none |
| 新 Agent 可从稳定 Make target 获得结构化 preflight | `verified_fact` | `tooling/acceptance/README.md` + runtime BLOCKED report | high | successful AS-02 live run |
| 独立 Provisioner + immutable manifest 可关闭责任缺口 | `verified_fact` | `core/provisioning.py` + `core/provisioner.py` + runtime BLOCKED evidence | high | successful native runtime proof |
| 独立 Gap Detector 可覆盖普通任务中的 silent pass | `verified_fact` | `acceptance-gap-detect-test.py` + submit pipeline | high | PR submit evidence |

### 1.2 Evidence Store 扩展证据账本

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Runtime reports当前写入source tree | `verified_fact` | `core/_paths.py::REPORTS_DIR` | high | none |
| G15在Native执行后因report write EPERM失败 | `verified_fact` | current-source Native run artifact and incident record | high | product behavior remains unproven |
| 物理reports路径存在广泛writer/reader耦合 | `verified_fact` | repository inventory: 366 references before migration | high | final zero-write scan |
| repository含tracked historical runtime reports | `verified_fact` | `git ls-files tooling/acceptance/reports` | high | classification/deletion |
| repo外immutable run store可解耦权限和并发 | `accepted_decision` | D-11 owner acceptance | high | implementation gates |

### 1.3 Native Desktop Runtime Cell 证据账本

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Embedded WebDriver 插件支持 macOS、Linux 与 Windows 原生 WebView backend | `verified_fact` | `tauri-plugin-wdio-webdriver` 1.3.0 README 与 `src/platform/{macos,linux,windows}.rs` | high | project Linux/Windows build smoke |
| 当前 `TauriDriver` 只启动本机 binary 并连接 `127.0.0.1` | `verified_fact` | `tooling/acceptance/drivers/tauri.py` | high | none |
| 当前 MP-W13 runner 直接依赖 AppKit、Quartz、CoreGraphics 与 `osascript` | `verified_fact` | `tooling/acceptance/gates/chat/native_product_closure_runner.py` | high | none |
| 当前 native environment 未表达 host、display、platform adapter 或远端 source staging | `verified_fact` | `tooling/acceptance/environments/native-tauri-embedded-webdriver.yaml` | high | none |
| Linux 候选机已有 GDM、GNOME、QXL connected virtual output 与 WebKitGTK runtime | `verified_fact` | 2026-08-24 SSH read-only preflight | high | logged-in Acceptance desktop session |
| Linux 候选机 Ubuntu 20.04 标准源缺少当前 Tauri 所需 `libwebkit2gtk-4.1-dev` | `verified_fact` | remote `apt-cache policy`; Tauri v2 Linux prerequisites | high | supported container userland proof |
| 同一业务 Gate 可在不同 Desktop OS cell 复用 | `accepted_decision` | D-13 | high | cross-platform driver contract and live proofs |
| SSH tunnel 可在不暴露 WebDriver 端口的前提下驱动远端 cell | `accepted_decision` | D-14 | high | disconnect/cleanup failure-path proof |
| Linux 最终 Native proof 不需要物理显示器或 Xvfb | `accepted_decision` | D-15; connected QXL evidence | high | Xorg session, native input, focus and screenshot proof |
| Remote cell 通过增量 Git objects 获取 clean source | `accepted_decision` | D-16; `tooling/scripts/deploy/deploy.sh` | high | remote source/build attestation proof |

---

### 1.4 Ephemeral Gate Launch Context 证据账本

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| D-18前runner在Provisioner返回可序列化Runtime Manifest后，以独立子进程执行Gate且没有process-local capability handoff | `verified_fact` | D-18 execution plan initial evidence | high | superseded by D-18 landing |
| 当前runner准备、seal、bind并activate `EphemeralGateLaunchContext`后通过受控child launch执行Gate | `verified_fact` | `tooling/scripts/acceptance-run.py`; `tooling/acceptance/core/launch_context.py` | high | none |
| Mobile physical device handle明确不可序列化，correlation secret具有显式zeroization | `verified_fact` | `mobile_resource_lease.py::ResolvedPhysicalDeviceHandle`、`RunScopedCorrelationSecret` | high | generic lifecycle integration |
| Mobile Station Fixture已用anonymous pipe和`pass_fds`把HMAC key限制在一次子进程调用 | `verified_fact` | `mobile_oauth_station.py::_run_command`及其focused tests | high | outer Provisioner-to-Gate handoff |
| Python `subprocess.run`把额外参数转交`Popen`，POSIX `Popen`提供`pass_fds`精确继承集合 | `verified_fact` | [Python subprocess](https://docs.python.org/3.14/library/subprocess.html#popen-constructor) | high | project synthetic process test |
| 一个run-scoped、不可持久化、domain-neutral的capability channel可关闭该边界 | `accepted_decision` | D-18 owner acceptance and closure evidence | high | none |

## 2. 系统架构

```text
                          ┌────────────────────────────┐
                          │        Product Change       │
                          │ code / proto / docs / gates │
                          └──────────────┬─────────────┘
                                         │ changed paths
                                         ▼
┌──────────────────┐      ┌────────────────────────────┐
│ Feature Contract │◄────►│       Impact Registry       │
│ truth/surface/   │      │ path -> feature -> gates    │
│ negative/gates   │      └──────────────┬─────────────┘
└────────┬─────────┘                     │ selected gates
         │                               ▼
         │                 ┌────────────────────────────┐
         │                 │       Gate Execution        │
         │                 │ local / fedp5 / desktop     │
         │                 └──────────────┬─────────────┘
         │                                │ evidence
         ▼                                ▼
┌──────────────────┐      ┌────────────────────────────┐
│ Capability Graph │─────►│       Evidence Report       │
│ domain capability│      │ proven / unproven / risk    │
│ mutual proof     │      └──────────────┬─────────────┘
└──────────────────┘                     │
                                         ▼
                          ┌────────────────────────────┐
                          │        Human Review         │
                          │ review report, not early QA │
                          └────────────────────────────┘
```

Acceptance Framework 由六层组成：

| 层 | 载体 | 职责 |
|----|------|------|
| Capability Graph | `tooling/acceptance/capabilities/*.yaml` | 定义项目级与领域级产品能力、互验证方向、所需 feature/gate/evidence |
| Domain Profile | `tooling/acceptance/domains/*.yaml` | 定义某个产品域如何作为 acceptance validation domain 被验证 |
| Domain Index | `tooling/acceptance/domains/index.yaml` | 管理项目产品域清单、接入状态、覆盖状态和候选域 |
| Onboarding Templates | `tooling/acceptance/templates/*.yaml` | 为新产品域提供 domain / capability / feature contract 模板 |
| Feature Contract | `tooling/acceptance/features/*.yaml` | 定义事实源、可见面、负向约束和 required gates |
| Impact Mapping | `tooling/acceptance/registry.yaml` | 把变更路径映射到 impacted features 和 selected gates |
| Gate Catalog | `tooling/acceptance/gates.yaml` | 定义稳定 gate 的命令、环境、超时和说明 |
| Gate Implementation | `tooling/acceptance/gates/**/*.py` | 产生可重复 evidence，不承载业务真源 |
| Evidence Report | D-11 Evidence Store `ArtifactRef` | 汇总 proven / unproven scope，供人审阅 |

### 2.1 Native Desktop Runtime Cell 拓扑

Native Desktop Gate 的产品断言保持一个 Gate identity；运行平台是独立证据维度，
不得复制三份业务 Gate 或让某个平台 evidence 代替另一个平台。

```text
Local Acceptance Orchestrator
  │
  ├── Gate definition + required runtime cells
  ├── incremental Git object sync + commit attestation
  ├── SSH control channel + localhost port forwards
  └── local Evidence Store writer
          │
          ▼
Remote Runtime Cell Lease
  ├── pinned supported userland
  ├── dedicated graphical session
  ├── exact-source Desktop Acceptance binary
  ├── app-local embedded WebDriver on 127.0.0.1
  ├── platform NativeInput/WindowObservation adapter
  └── reverse-order process/port/storage/session cleanup
          │
          ▼
macOS WKWebView | Linux WebKitGTK | Windows WebView2
```

控制面与数据面边界：

- Orchestrator 负责选择 cell、校验 source identity、建立 tunnel、收集 evidence 和
  发布最终结果。
- Runtime Cell Provisioner 负责目标主机、图形 session、构建、进程、端口和 storage
  生命周期；不得包含 Chat selector、actor 或产品断言。
- Remote source acquisition 复用 `make station` 的 pull-model 语义：Profile 解析目标、
  source lease、Git push/fetch、exact commit checkout、remote build cache 和
  attestation；不得每次复制完整 worktree。
- `TauriDriver` 只负责 W3C WebDriver/DOM 能力，不再假定 app process 必须在本机。
- `NativeDesktopAdapter` 负责平台窗口激活、真实键鼠输入、焦点、窗口栈和屏幕观察。
- Business Gate 只调用稳定的 DOM 与 native action interface；不得导入 AppKit、
  Quartz、X11 或 Win32 API。
- Embedded WebDriver 仅绑定 cell 内 `127.0.0.1`；远端访问必须经过 run-scoped SSH
  tunnel，禁止开放到局域网。

---

### 2.2 Ephemeral Gate Launch Context 拓扑

Runtime Manifest继续承载可持久化、可审计的资源事实；无法安全序列化的run-scoped
capability由独立launch context承载。两者是互补边界，不是两个runtime真源。

```text
Environment Provisioner
  ├── Runtime Manifest ───────────────► Evidence Store
  │     ArtifactRef / service / actor / public runtime identity
  │
  └── Ephemeral capability handlers
          │ parent endpoint + secrets/raw handles stay in orchestrator
          ▼
Acceptance Orchestrator
  ├── seals context to workspaceId/gateId/evidenceRunId/provisioningRunId
  ├── creates one anonymous capability channel
  ├── starts bounded broker loop
  └── launches exact Gate argv with one inherited capability endpoint
          │
          ▼
Gate Process
  ├── reads non-secret descriptor locator
  ├── performs handshake bound to gateId/runId/workspaceId
  ├── invokes allowlisted capability operations
  └── closes endpoint before process exit
          │
          ▼
Orchestrator quiesces channel -> closes descriptors -> joins broker
  -> runtime-cell cleanup -> provisioner cleanup
  -> closes context and verifies zeroization
```

该拓扑不允许Gate获得broker对象、raw device identifier、provider subject或HMAC key。
Gate只持有一次性channel capability；具体业务Provisioner注册哪些操作属于业务注入，
Core只拥有channel、framing、binding、timeout、cancel和cleanup语义。

---

## 3. 核心接口

### 3.1 Capability Contract

```json
{
  "id": "federation-operational-observability",
  "domain": "federation",
  "direction": "acceptance_validates_product",
  "features": ["federation-operational-observability"],
  "required_gates": ["station-dashboard-unit", "federation-dashboard-operational-drilldown"],
  "synthetic_paths": [
    "apps/station/app/subserver/dashboard/application/federation_service.go"
  ],
  "evidence": {
    "truth_sources": ["federation_operational_events"],
    "surfaces": ["/dashboard/#/federation"],
    "proven_by": ["federation-dashboard-operational-drilldown"],
    "unproven": ["dashboard-wide alert center"]
  }
}
```

Capability Contract 的职责：

- 明确一个产品能力的验收语义。
- 连接 feature contracts 和 gates。
- 给 `acceptance-plan` 提供 synthetic paths，用来验证 registry 是否能正确命中能力。
- 给 report 提供 proven / unproven scope。

### 3.2 Domain Profile

```json
{
  "id": "federation",
  "capabilities": [
    "acceptance-framework-self-consistency",
    "federation-ledger-convergence",
    "federation-validates-acceptance-framework"
  ],
  "validation_gate_id": "federation-mutual-validation"
}
```

Domain Profile 的职责：

- 选择一个产品域参与项目级 acceptance 验证。
- 引用 capability graph 中已有能力，不重新定义 acceptance core。
- 指定该 domain 的 validation gate id 和报告输出。
- 让 Federation、Chat、Mobile、Applet 以后能以相同模型接入。

### 3.3 Domain Index

```json
{
  "id": "chat",
  "status": "planned",
  "profile": "",
  "capabilities": "",
  "coverage": "not_onboarded",
  "notes": "Needs feature contracts for chat service and realtime delivery."
}
```

Domain Index 的职责：

- 统一列出项目级 product domains。
- 区分 `active`、`candidate`、`planned`、`deprecated`。
- 告诉 `make acceptance-validate` 在 project-level 模式下验证哪些 active domains。
- 给 `make acceptance-coverage-report` 提供覆盖报告输入。

### 3.4 Feature Contract

```json
{
  "id": "federation-ledger",
  "truth_sources": ["federation_ledger_events"],
  "required_gates": ["proto-build", "station-federation-unit", "federation-three-node-e2e"],
  "acceptance": {
    "service": ["three-node testnet converges to one head"]
  },
  "negative": ["proposals must not advance ledger head"]
}
```

Feature Contract 的职责：

- 绑定业务事实源。
- 列出可验证行为和负向约束。
- 声明 required gates。
- 不做路径匹配；路径匹配属于 registry。

### 3.5 Gate Contract

```json
{
  "command": "python3 tooling/acceptance/gates/dashboard/federation_operational_drilldown.py",
  "timeout_seconds": 600,
  "environment": "fedp5",
  "description": "Validate Federation operations drilldown API and Dashboard visible-surface sections."
}
```

Gate Contract 的职责：

- 提供稳定命令。
- 指明运行环境。
- 输出 log 和结构化 run result。
- 不声明业务完成标准；业务完成标准由 feature/capability contract 解释。

### 3.6 Runtime Provisioning Contract

Runtime Provisioning Contract 是 Gate 运行前的机器可读资源契约。它由
Acceptance runtime orchestration 消费，不由业务 Gate 自行解释。

契约规则：

- `gates.yaml.environment` 必须解析到一个 provisioning contract。
- Profile 文件名与 `PT_DEV_PROFILE` 必须一致；Station label 可以不同，但必须在 manifest 中显式记录。
- 具体凭据值不得写入 contract、manifest、命令、日志或 evidence；只记录变量名或 secret reference。
- Provisioner 输出 runtime manifest；Gate 只读取 manifest 和非敏感输入，不自行部署服务或创建环境。
- Provisioning 失败输出 `BLOCKED/UNPROVEN` 的结构化 artifact，不能退化为 connection refused 文本日志。
- 完整字段定义见 [data-model.md §2](./data-model.md#2-environment-provisioning-contract)。

### 3.7 Runtime Resource Manifest

Provisioner 成功后必须输出一次运行的不可变 manifest。Manifest 是运行资源事实，
不是产品业务真源。它必须：

- 由实际 provisioning 结果生成，禁止手工伪造。
- 绑定当前 worktree commit、workspace digest，以及每个 required service 的
  deployment environment、live commit、protocol digest 和 runtime identity。
- `EnvironmentContract.services` 与 `RuntimeManifest.services` 是唯一服务拓扑真源；
  service ID 表示稳定环境角色，kind 表示服务类型。
- Provisioning readiness 是 required service attestation 的完整闭包，不是单个
  Station 的存在性。
- Gate 必须按稳定 service ID 选择服务并验证 expected kind，禁止按 map 顺序推断
  primary Station。
- 包含 actor role 到 canonical PTID 的解析结果，但不包含密码、token、PIN 或私钥。
- 作为 Gate evidence 的 source artifact，并由 validator 校验 freshness。
- 顶层 singular `station` 已删除；禁止 dual-write、compatibility alias 或 fallback。
- 完整 schema 见 [data-model.md §3](./data-model.md#3-runtime-resource-manifest)。

### 3.8 Acceptance Gap Contract

当 Agent 发现产品承诺存在但 Acceptance 路径不完整时，必须生成结构化 Gap
Artifact，包含 status、claim、gap type、evidence、owner、required closure 和
`UNPROVEN` proof state。完整 schema 见
[data-model.md §6](./data-model.md#6-gap-artifact)。

Gap Detector 与 Acceptance Engineering 职责不同：

- Gap Detector 是跨阶段只读守卫，发现遗漏、禁止 silent pass、输出责任边界。
- Acceptance Engineering 是修复入口，负责 `ADD/COMPLETE/UPGRADE/AUDIT` 和阶段调度。
- Gap Detector 不创建 Gate、不修改产品代码、不生成伪证据，也不替代 completion audit。

### 3.9 Acceptance Evidence Store

Evidence Store是runtime-generated artifact的唯一owner，位于repository之外。它由以下
domain-neutral contracts组成：

| Contract | Responsibility |
|---|---|
| `ArtifactRootResolver` | 解析platform default/override、workspace identity和root containment |
| `RunAllocator` | 验证gate/run identity，创建隔离run directory并持有active lock |
| `EvidenceWriter` | redaction、atomic file write、manifest finalize和typed errors |
| `EvidenceReader` | 从`ArtifactRef`或atomic latest pointer读取并验证identity/hash |
| `EvidenceCleanup` | 在lock与retention policy下删除eligible closed runs |

```text
Repository (code/schema/template/fixture only)
         │ canonical worktree identity
         ▼
ArtifactRootResolver
         │
         ▼
<root>/<workspace-id>/<gate-id>/<run-id>/
         │ active lock + immutable artifacts
         ▼
durable manifest.json ──► atomic latest.json pointer
         │
         ├──► validators / capability reports / quality evidence
         └──► CI artifact collector / human review
```

Writer API：

```text
begin_run(worktree, gate_id, source_identity) -> RunHandle
RunHandle.write_json(relative_path, value, redact=true) -> ArtifactRef
RunHandle.copy_evidence(relative_path, source, redact_policy) -> ArtifactRef
RunHandle.finalize(status, traceability) -> RunManifest
RunHandle.publish_latest() -> LatestPointer
RunHandle.close()
```

Reader API：

```text
resolve(ref: ArtifactRef) -> Path
read_json(ref: ArtifactRef, expected_kind) -> object
latest(worktree, gate_id) -> RunManifest
```

`publish_latest`只能在`finalize`成功后调用。Reader不得通过字符串拼接artifact root；
所有path必须通过resolver，reject absolute child paths、`..`、NUL、symlink escape和
identity mismatch。

### 3.10 Native Runtime Cell Contract

Native Desktop Gate 可声明 `requiredRuntimeCells`。每个 cell 由独立 contract
解析，运行结果按 `(gateId, cellId, sourceCommit)` 隔离：

```yaml
id: desktop-linux-native
platform: linux
architecture: x86_64
isolation:
  kind: container
  image_ref: profile:acceptance-linux-image
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

约束：

- `target_ref` 是 Profile/secret-backed reference，不在仓库中保存 IP、用户名或密钥。
- Cell preflight 必须核验 OS、architecture、WebView backend、display/session、
  compositor/window manager、native input、screen capture、toolchain 和磁盘。
- Host OS 与 cell userland 必须分别取证。容器化 cell 可运行受支持的 Linux
  userland，而不要求宿主发行版升级，但必须记录 image digest、host kernel 与
  container isolation。
- 最终 `PROVEN` 要求 clean commit、remote source digest、binary SHA-256 与运行进程
  identity 一致；dirty source 只允许诊断并保持 `PARTIAL/UNPROVEN`。
- Remote proof 只接受 Git 可寻址 clean commit。未提交修改不进入远端 source sync，
  也不得通过 rsync/tar overlay 绕过 source identity。
- 每个 cell 必须独占 GUI session lease。同一 session 的并发 Gate fail closed。
- SSH 中断、Gate timeout 和 orchestrator cancellation 都必须触发远端 TTL/reaper 与
  本地 reverse-order cleanup。
- 平台专属断言只能由对应 cell 证明；Linux 不能证明 AppKit/Spaces，macOS 不能证明
  WebKitGTK/X11，Windows 不能证明另外两者。

Source traceability：

- `workspaceId`: canonical worktree path SHA-256前16个hex，只负责isolation；
- `source.commit`: exact Git HEAD；
- `source.workspaceDigest`: clean/dirty状态及受控digest，语义保持D-07；
- `gateId`: Gate Catalog identity；
- `runId`: UTC microsecond timestamp加128-bit cryptographic random suffix；
- `runtime`: environment/profile/Station/client identity；
- `artifacts`: typed run-relative references与content SHA-256。

Permissions：

- POSIX root/run directories创建为owner-only，files创建为owner read/write；
- Windows root位于`LOCALAPPDATA`或显式override，依赖current-user ACL；
- override若指向relative path、existing file、repository内路径或symlink escape，
  resolver返回typed invalid-root error；
- CI必须显式设置override，不能依赖runner home default。

Concurrency与durability：

- run directory通过exclusive create分配，identity冲突重新生成run-id；
- active lock在RunHandle lifecycle内持有；
- 同一run内path首次写入成功后immutable；相同path/same hash为idempotent，相同path/
  different hash返回`EvidenceConflict`；
- artifact写入same-directory temporary file，flush/fsync后atomic replace；
- large evidence使用bounded chunk streaming并同步计算hash，不把整文件载入内存；
- environment/run contract可声明byte budget，超额返回`EvidenceQuotaExceeded`；
- manifest durable后才允许在gate-level lock下发布latest；
- concurrent publisher按`completedAt + runId`比较，较旧completion不得覆盖新pointer；
- latest包含manifest `ArtifactRef`和SHA-256，reader必须复验；
- interrupted temporary files不是evidence，cleanup仅在run inactive后回收。
- cancellation/shutdown关闭writer并释放active lock；若manifest未durable，latest保持不变，
  run保留为inactive incomplete并由显式cleanup处理。

Retention：

- 默认retain all，不在Gate结束时自动删除；
- explicit cleanup按workspace/gate、age或run count选择候选；
- active lock、latest target和manifest-referenced artifacts永远受保护；
- cleanup失败是typed operational error，不得损坏已durable evidence。

---

### 3.11 Ephemeral Gate Launch Context

`EphemeralGateLaunchContext`是orchestrator进程内对象，不属于Runtime Manifest、
Evidence Store或Gate Catalog schema。

```python
@dataclass(frozen=True)
class GateLaunchBinding:
    environment: Mapping[str, str]   # non-secret locator metadata only
    pass_fds: tuple[int, ...]        # exact POSIX inheritance allowlist


@dataclass(frozen=True)
class GateLaunchSpec:
    argv: tuple[str, ...]
    timeout_seconds: int
    required_capabilities: tuple[str, ...]


class EphemeralGateLaunchContext:
    def register_capability(
        self,
        capability_id: str,
        handler: EphemeralCapabilityHandler,
    ) -> None: ...

    def seal(
        self,
        *,
        workspace_id: str,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
    ) -> None: ...

    def bind_child(self) -> GateLaunchBinding: ...
    def activate(self) -> None: ...
    def quiesce(self) -> None: ...
    def close(self) -> EphemeralCleanupResult: ...


class EnvironmentProvisioner:
    def create_gate_launch_context(
        self,
        *,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
        required_capabilities: tuple[str, ...],
    ) -> EphemeralGateLaunchContext | None: ...


class EphemeralGateClient:
    @classmethod
    def from_environment(cls) -> EphemeralGateClient | None: ...

    def invoke(
        self,
        capability_id: str,
        operation: str,
        payload: Mapping[str, object],
        *,
        timeout_seconds: float,
    ) -> Mapping[str, object]: ...


class GateProcessLauncher:
    def run(
        self,
        spec: GateLaunchSpec,
        binding: GateLaunchBinding | None,
    ) -> CompletedProcess[str]: ...


class EphemeralCapabilityHandler:
    @property
    def sensitive_values(self) -> tuple[str, ...]: ...

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: Event,
    ) -> Mapping[str, object]: ...
    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]: ...
    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool: ...
    def close(self) -> EphemeralHandlerCleanup: ...
```

通用请求只描述transport envelope，不定义Mobile操作：

```json
{
  "requestId": "<run-unique opaque id>",
  "workspaceId": "<workspace-id>",
  "gateId": "<gate-id>",
  "evidenceRunId": "<Evidence Store run id>",
  "provisioningRunId": "<Runtime Manifest run id>",
  "capability": "<injected capability id>",
  "operation": "<injected allowlisted operation>",
  "payload": {}
}
```

契约：

- launch context、handler、parent endpoint、secret和raw handle均不可pickle、不可
  `repr`泄露、不可写入artifact，也不得进入`RuntimeManifest.to_dict()`。
- Gate Catalog对需要context的Gate声明`argv`和`ephemeralCapabilities`；`argv`与
  legacy `command`二选一，禁止同一Gate保留两套execution truth。
- POSIX backend使用`socket.socketpair()`形成双向anonymous channel；只有Gate child
  endpoint列入
  `pass_fds`，其余descriptor保持close-on-exec。环境变量最多携带descriptor number
  和非敏感contract locator，不携带key、token、subject、raw device identifier或
  endpoint address。
- 携带launch context时runner必须使用明确argv和隔离Python bootstrap；bootstrap以
  `python -I -S`启动，在导入或执行任何Gate代码前恢复descriptor的
  non-inheritable属性，再在同一进程内执行catalog声明的Python module/script。
  parent使用`subprocess.Popen(..., shell=False, close_fds=True, pass_fds=...)`，
  spawn结束后立即关闭其child endpoint副本，再以bounded
  `communicate(timeout=...)`等待。任意可执行文件、shell wrapper、字符串插值和
  bootstrap前grandchild继承都必须在spawn前被拒绝。
- handshake必须精确匹配`workspaceId + gateId + evidenceRunId +
  provisioningRunId`。capability和operation由Provisioner显式注册；未知、重复冲突
  或越权请求fail closed。
- frame有固定byte上限；每次请求有deadline；同一`requestId + requestDigest`
  可返回缓存结果，不同digest复用requestId是protocol conflict。
- raw-handle-bound操作必须完全在parent handler内执行。Gate只能获得opaque session
  reference、脱敏structured result或ArtifactRef，不能获得UDID、serial、provider
  subject、token或correlation key。
- handler返回值和blocked metadata必须先经过其注入的`project_response`策略，再由
  Core对完整response envelope扫描`handler.sensitive_values`；命中任一敏感值时
  channel fail closed，禁止把原值或仅靠日志后置redaction传给child。
- 每个context默认只允许一个in-flight request；超额请求以typed backpressure错误
  拒绝，不创建无界线程、队列或response cache。
- Windows或其它不支持已实现backend的平台在Gate启动前返回typed
  `EPHEMERAL_LAUNCH_TRANSPORT_UNSUPPORTED`；不得回退环境变量、文件、localhost
  service或Gate-side reacquisition。
- `quiesce()`幂等，先停止新请求、关闭两端descriptor并bounded join broker，但不
  提前销毁Provisioner完成资源回收仍需的authority。
- broker或handler无法在deadline内quiesce时，相关resource必须fence/quarantine，
  禁止进入可复用pool；runner记录cleanup failure后继续完成不依赖该authority的
  bounded teardown。Core只调用通用`handler.quarantine(...)`接口，具体fencing由
  业务handler实现。
- 现有runtime-cell与Environment Provisioner完成reverse cleanup后，`close()`释放
  context-owned buffer并验证capability owner已关闭和其mutable secret owner buffer
  已清零。该证据不宣称Python进程内所有历史副本已被物理擦除；任一步失败产生
  cleanup failure，不得把产品proof标记为`PROVEN`。
- Python官方`socket.socketpair()`返回一对connected、默认non-inheritable socket：
  <https://docs.python.org/3.14/library/socket.html#socket.socketpair>。

## 4. 组件关系

### 4.1 Agent 与框架

Agent 允许做：

- 读取当前 diff 和 registry，解释为什么 gates 被选中。
- 读取 capability graph，说明哪些能力被证明。
- 在 gate 失败时做有限 probe。
- 把有价值 probe 沉淀为 stable gate。

Agent 不允许做：

- 用临场判断替代 required gate。
- 把未运行的 gate 说成已证明。
- 把 smoke / screenshot artifact 说成完整 UI E2E。
- 把 discovery hint、event stream、notification、cache 当成治理真源。

### 4.2 Domain 类型

Acceptance Framework 支持两类产品域：

| 类型 | 含义 | 当前实例 |
|------|------|----------|
| `project_validation_domain` | 既被 acceptance 验证，也反向证明 acceptance 能表达复杂产品域 | Federation |
| `managed_domain` | 被 acceptance 统筹管理，但不承担框架自证职责 | Station Dashboard, Chat |

两类 domain 都必须拥有 domain profile、capability file、feature contracts、registry rules、gate catalog entries 和 report；区别在于 `project_validation_domain` 可以有产品域反向证明 capability，而 `managed_domain` 只能证明自身产品能力。

Station Dashboard 是第一个 managed domain。它验证普通产品域能按同一 onboarding 标准接入项目级 acceptance，而不复制 Federation ledger、testnet、Desktop gateway 等特殊语义。Chat 是第三个 active domain，也是第二个 managed domain，用来验证 acceptance 能覆盖更接近用户主路径的消息能力。

### 4.3 Federation 双边互验证

Federation 是 Acceptance Framework 的首个复杂验证域：

| 方向 | 含义 | 证明方式 |
|------|------|----------|
| Acceptance → Federation | 框架证明 Federation 主能力未退化 | registry 选 gate，fedp5 gates 运行，通过 reports 输出 |
| Federation → Acceptance | Federation 作为 validation domain 证明框架足够表达复杂产品域 | `tooling/acceptance/domains/federation.yaml` 选择 capability graph 中的 Federation 能力，通用 validator 检查闭环 |

互验证不是一个单独脚本完成，而是由 capability graph、feature contracts、registry、gates、run results、reports 共同形成。

### 4.4 Station Dashboard managed domain

Station Dashboard managed domain 的边界：

- 事实源来自 Station runtime repositories 和 Dashboard read-only service projections。
- Dashboard 是管理面 projection，不成为业务事实源。
- Auth、layout、overview、system、nodes、storage、security 等核心页面由 `station-dashboard-auth` 与 `station-dashboard-operations` feature contracts 管理。
- 当前 stable gates 是 `station-dashboard-unit` 与 `station-dashboard-web-check`；浏览器级完整 Dashboard visible-surface gate 仍为 unproven scope。

该 domain 的目标不是验证 Federation，而是证明 acceptance 可以管理普通产品域：

```text
apps/station/app/subserver/dashboard/**
          │
          ▼
tooling/acceptance/registry.yaml
          │
          ▼
station-dashboard-auth / station-dashboard-operations
          │
          ▼
station-dashboard-admin-access / station-dashboard-operator-surface
          │
          ▼
station-dashboard-unit + station-dashboard-web-check
          │
          ▼
Evidence Store latest(`station-dashboard-domain-validation`)
```

### 4.5 报告语义

### 4.5 Chat managed domain

Chat managed domain 的边界：

- 事实源来自 `model/domain/chat/*.proto`、Station messaging/conversation/envelope subservers、conversation event log、per-device messaging queue，以及 Desktop messaging engine 对 Station API 的 typed contract。
- Queue / envelope delivery 是 delivery contract，不是 message persistence truth。
- Desktop typed surface 只能证明页面、store、service API 的编译期契约，不能替代 DOM 级可见性或 live realtime DOM event-consumption proof。
- 当前 stable gates 是 `proto-build`、`station-messaging-unit`、`messaging-platform-contract`、`desktop-check` 和 `chat-native-visible-static`；`chat-desktop-gateway-e2e` 是 app-runtime gate，证明 desktop-rust messaging engine 的 E2EE direct-message 闭环；native multi-client gates 负责用户可见双客户端、multi-device、recovery 与 MLS 证据。

该 domain 的目标是反思并验证设计落地：acceptance 不能只覆盖管理面和 Federation，还必须能表达高频用户路径的事实源、传输面、可见面和未证明范围。

```text
model/domain/chat/** + apps/station/app/subserver/{messaging,conversation,envelope}/** + apps/desktop/**messaging**
          │
          ▼
tooling/acceptance/registry.yaml
          │
          ▼
chat-service-contract / chat-desktop-gateway-message-flow / chat-realtime-delivery / desktop-chat-surface / chat-native-visible-clients
          │
          ▼
chat-proto-service-contract / chat-realtime-contract / desktop-chat-typed-surface / chat-native-visible-clients
          │
          ▼
proto-build + station-messaging-unit + messaging-platform-contract + desktop-check + chat-native-visible-static (+ chat-desktop-gateway-e2e / native environment gates)
          │
          ▼
Evidence Store latest(`chat-domain-validation`)
```

### 4.6 报告语义

报告必须区分：

- **Proven**：required gates 已运行并通过。
- **Partially proven**：gateway/smoke 证明了入口或表面，但未证明完整 DOM / 行为闭环。
- **Unproven**：当前无 stable gate 或 gate 未运行。
- **Risk**：能力可能成立但缺少 evidence，必须显式交给人审。

### 4.7 Provisioning 生命周期与所有权

```text
Acceptance Plan
      │ selected gate + environment id
      ▼
Environment Provisioner ──► Runtime Resource Manifest
      │ profile / service / attestation / fixture / credential refs
      ▼
Gate Runner ──► Product Gate ──► Source-bound Evidence
      │
      ▼
Cleanup + release audit
```

| 资源 | Owner | 输出 | 禁止 |
|------|-------|------|------|
| Profile 解析与一致性 | Local Dev Environment | resolved profile identity | 文件名与 `PT_DEV_PROFILE` 静默不一致 |
| Station ready closure | Station deployment/runtime | health + live metadata | Gate 内自行部署 Station |
| Station attestation | Station deployment/runtime | commit/workspace/proto artifact | Gate 或 Agent 手写 attestation |
| Actor/account/PTID | Domain Fixture | actor manifest | 硬编码 PTID 或从聊天历史复制 |
| Credential acquisition | Profile/approved secret source | credential reference | 默认密码、日志输出明文 |
| Client isolation | Environment Provisioner + Driver | ports/profile/storage manifest | 共享 storage 或隐式固定端口 |
| Product assertion | Gate | receiver-visible evidence | 用 preflight、API 200 或 static check 替代 |
| Cleanup | Provisioner + Driver | release audit | Gate 失败后跳过 teardown |

状态机：

```text
DISCOVERED
  -> PREFLIGHTED
  -> PROVISIONED
  -> FIXTURE_READY
  -> GATE_RUNNING
  -> EVIDENCE_JUDGED
  -> CLEANED

Any missing requirement
  -> BLOCKED
  -> structured gap artifact
  -> UNPROVEN
```

运行语义：

- Provisioning action 必须幂等；重复执行不得创建第二套账号、端口租约或服务实例。
- destructive Fixture 不自动重试；授权或 target verification 失败立即 `BLOCKED`。
- 所有 wait/retry 都有 contract timeout；超时进入 cleanup，不允许无限等待。
- cancellation、Gate failure 和进程异常都必须执行同一 reverse-order cleanup。
- 同一 Profile 同时只允许一个 provisioning lease；并行运行必须使用不同 slot/run ID。
- Manifest 一旦进入 `FIXTURE_READY` 不可原地修改；资源变化必须创建新 run。

### 4.8 允许与禁止的关系

允许：

- `acceptance-run` 根据 Gate environment 调用对应 Provisioner。
- Provisioner 调用 profile、deployment、Fixture 和 Driver 的公开入口。
- Gate 读取 runtime manifest 并验证与 live runtime 一致。
- Registry 为一个行为变更选择多个 Feature 和 receiver-proof Gates。

禁止：

- Gate 自行猜测 Profile、Station URL、actor PTID 或 credential。
- Provisioner修改产品断言或降低 Gate 成功条件。
- Profile 名称不一致时继续运行。
- 失败后改用 browser shell、mock、API-only、截图或旧 evidence。
- 将 provisioning 成功报告为产品能力 `PROVEN`。

### 4.9 行为导向的影响映射

Registry 必须按受影响产品断言选择 Gate，而不是只按实现目录选择最便宜的
检查。对于 Direct Chat receipt：

```text
Desktop Rust receipt/decrypt path
  -> chat-realtime-delivery
  -> chat-native-visible-clients
  -> chat-native-two-client-e2e
```

目录级 broad rule 可以保留 cheap gates；receiver-visible 状态转换必须有更窄
的 behavior rule 追加 native Gate。`acceptance-plan` 必须通过 synthetic path
测试证明该规则能被新 Agent 自动发现。

### 4.10 Evidence Store 允许与禁止关系

允许：

- plan/run/gate/validator/report/quality tooling通过canonical Evidence Store API读写；
- intentional test fixture位于source tree专用fixture目录；
- CI通过override root收集完整workspace subtree；
- reviewed long-lived evidence进入明确的repository archive owner，但runtime writer
  不得直接写该owner。

禁止：

- runtime writer写repo root、`tooling/`、`docs/`或`.git/`；
- Core consumer定义第二个artifact-root resolver；
- contract保存`tooling/acceptance/reports/...`物理路径；
- latest pointer充当primary evidence或在manifest durable前发布；
- permission/disk/path错误fallback到repository；
- cleanup删除active run或latest target；
- symlink、dual-write或legacy compatibility owner；
- 迁移旧report作为当前产品proof。

### 4.11 Acceptance Infra 与业务注入责任防火墙

Acceptance Infra 与业务 Domain 使用两个独立责任平面。责任按语义判断，不按目录
判断：

| Acceptance Infra | 业务模块注入 |
|---|---|
| Contract schema、extension interface、typed error | Domain / Feature / Capability 实例 |
| Planner、Validator、Runner、Reporter | 产品 assertion、negative constraint、truth source |
| Evidence Store 与 artifact lifecycle | 产品 evidence 与 proof state |
| Provisioner / Driver / Fixture / Harness 抽象 | 具体 Environment、Provisioner、Fixture、角色与凭据 |
| Registry / Gate / Environment 注册机制与结构校验 | Registry rules、Gate entries 与 Gate implementations |
| 通用 timeout、cancel、cleanup、isolation、concurrency | 产品失败修复与 receiver-visible proof |
| synthetic fixtures 与 framework self-validation | 真实业务 runtime 和数据集 |

Infra 可以验证注入是否符合 contract，但不得替业务模块创建、修复、降级或伪造注入。
缺失注入使用：

```text
BUSINESS_INJECTION_REQUIRED
  owner domain
  missing contract slot
  expected schema/interface
  affected Domain
  Infra impact: non-blocking
```

Readiness 规则：

- `acceptance_core_self_validation` 是 Infra merge readiness 的权威 capability。
- `product_domain_validates_acceptance` 是附加反向证据，默认只报告，不阻塞每次
  Infra PR。
- `acceptance_validates_product` 与具体业务 Gate 的状态只约束对应业务 Domain。
- 业务 `FAILED`、`BLOCKED` 或 `UNPROVEN` 不能转换成 Infra failure。
- 只有通用注入机制、schema、validator、runner 或 evidence lifecycle 本身有缺陷时，
  才能阻塞 Infra readiness。

Agent 对 Acceptance Infra 的优化和审计必须使用
[`pt-acceptance-infra-engineering`](../../../tooling/skills/pt-acceptance-infra-engineering/SKILL.md)。
业务接入与产品证明继续使用
[`pt-acceptance-engineering`](../../../tooling/skills/pt-acceptance-engineering/SKILL.md)。

### 4.12 Runtime Cell 所有权与失败语义

| 组件 | Owner | 允许职责 | 禁止职责 |
|---|---|---|---|
| Cell schema/registry/lease | Acceptance Infra | contract validation、选择、互斥、typed failure | 业务 actor、selector、成功条件 |
| SSH transport | Acceptance Infra | host-key verification、command/tunnel、timeout/cancel | 保存凭据值、解释产品结果 |
| Desktop cell injection | Desktop platform | OS/display/toolchain/build/native adapter 配置 | Chat journey 与断言 |
| Native adapter | Desktop platform | focus/input/window stack/screenshot primitive | DOM selector、消息语义 |
| Chat Gate | Chat business | actor journey、产品动作、receiver-visible assertion | SSH、display setup、平台 API |
| Evidence Store | Acceptance Infra | local durable artifact、remote artifact import validation | 未验证远端输出、跨 cell 冒充 |

失败必须分层：

- Cell/session/toolchain/source/tunnel 失败：
  `ACCEPTANCE_GATE_BLOCKED_BY_ENVIRONMENT`，产品 proof 为 `UNPROVEN`。
- Native adapter 无法证明真实 input/focus/window ownership：
  environment failure，不得退化为 WebDriver-only click。
- 产品断言在 ready cell 中失败：`ACCEPTANCE_GATE_FAILED`。
- Cleanup 未完全释放 remote process、port、storage、session lease：
  `ACCEPTANCE_CLEANUP_FAILED`，已观察行为可保留但 readiness 为 failed。

---

### 4.13 Ephemeral Launch Context 所有权与失败语义

| 组件 | Owner | 允许职责 | 禁止职责 |
|---|---|---|---|
| `EphemeralGateLaunchContext` | Acceptance Infra | identity binding、descriptor lifecycle、framing、deadline、dedupe、cancel、cleanup | 定义Mobile actor、provider、device或产品成功条件 |
| Environment Provisioner | 业务环境注入 | 注册本环境的capability handler并持有secret/raw resource owner | 把secret/raw handle写入manifest、env、argv或artifact |
| Acceptance Orchestrator | Acceptance Infra | seal context、启动broker、精确传递descriptor、统一teardown | 解释业务operation或重建业务resource |
| Gate launch client | Acceptance Infra | handshake、typed request/response、关闭child endpoint | 持久化channel、把descriptor传给grandchild |
| Product Gate | 业务模块 | 通过注入client调用allowlisted capability并执行产品断言 | 读取Provisioner对象、Profile或Gate-side reacquisition |

失败分类：

- context未注册、未seal、任一run identity mismatch、backend unsupported或child
  bind失败：
  Gate不得启动，结果为`BLOCKED/UNPROVEN`；
- handshake、frame validation、deadline、EOF或broker handler transport失败：
  这是Acceptance runtime failure，不是产品断言失败，结果保持`UNPROVEN`；
- capability handler返回明确业务资源冲突时，保留其typed blocked/quarantine语义；
- Gate exit、timeout或cancellation后必须先quiesce launch context，再执行
  runtime-cell和Environment Provisioner reverse cleanup，最后close context；
- context quiesce/close、broker join、descriptor close或secret zeroization任一失败：
  `ACCEPTANCE_CLEANUP_FAILED`，已有观察可保留但readiness失败。

## 5. 端点 / API

Acceptance Framework 不对外提供 HTTP API。它的稳定入口是 Make targets：

```bash
make acceptance-plan
make acceptance-run
make acceptance PLAN=<plan-path>
make acceptance-report
make acceptance-infra-validate
make acceptance-validate
make acceptance-validate DOMAIN=chat
make acceptance-validate DOMAIN=federation
make acceptance-validate DOMAIN=station-dashboard
make acceptance-coverage-report
make acceptance-chat-domain-validation
make acceptance-station-dashboard-domain-validation
make acceptance-federation-report
make acceptance-federation-mutual-validation
```

其中 `acceptance-infra-validate` 只验证
`acceptance_core_self_validation` capability 和通用 Infra closure，不读取业务 Domain
注入作为完成条件。`acceptance-validate` 是项目级业务 domain validation 入口；不传
`DOMAIN` 时验证 `tooling/acceptance/domains/index.yaml` 中所有 active domains。
`acceptance-validate DOMAIN=<domain>` 验证单个 domain profile。默认模式验证结构自洽；
加 `--require-proven` 时要求 latest run results 证明 required gates 已通过。它必须证明：

- capability graph 自洽。
- domain profile 引用的 capabilities 存在。
- feature contracts 引用存在。
- 当前 domain 的 Capability、Feature 和 validation Gate 都在 gate catalog 中存在；
  缺失时以 `STRUCTURAL_GAP` fail closed。
- 当前 domain 的每个非 `local` Gate 都声明
  `provisioner == environment`，对应 environment contract 存在、可解析、ID
  一致且能从 Provisioner registry 解析。
- synthetic paths 能通过 registry 命中期望 gates。
- 在 `--require-proven` 模式下，最近 run results 中该 domain 的 required gates 通过。
- report 能输出 proven / unproven scope。

结构校验以当前 domain 的 Capability / Feature / Gate 闭包为边界，不扫描无关
domain 的业务接入缺口，也不提供 bypass 参数。

`make acceptance PLAN=<plan-path>` 是显式 gate bundle 的稳定入口。环境由调用前已激活的 profile / runtime 决定；plan 只声明要运行哪些 gates，gate 脚本只执行自身检查，不承载环境选择。Phase 型验收应新增或更新 plan 文件，而不是新增 phase-specific Make target。

`acceptance-federation-mutual-validation` 只是 Federation domain 的兼容 alias，不是 acceptance core。

`acceptance-chat-domain-validation` 运行 Chat managed-domain gates，然后要求该 domain 的 latest evidence 通过；它验证 chat service、Station runtime API message flow、Station live realtime stream delivery、realtime typed contract、Desktop typed surface，以及在显式 app-runtime 环境下的 Desktop DOM synced-message visibility；它不宣称 live realtime DOM event consumption、双 Desktop client 或完整消息 UI E2E。

`acceptance-station-dashboard-domain-validation` 运行 Station Dashboard managed-domain gates，然后要求该 domain 的 latest evidence 通过；它不验证 Federation，也不承担 acceptance core 自证。

`acceptance-coverage-report` 输出项目域接入覆盖状态，用来回答哪些 domain 已纳入 acceptance 管理、哪些仍未接入。

## 6. Runtime Provisioning 架构质量门

实现只有在以下证据同时成立时才可声明 Runtime Provisioning ready：

- 任一非 `local` Gate 的 environment id 都能解析到 provisioning contract。
- Profile identity mismatch 在启动服务前 fail closed。
- Chat actor Fixture 可重复产出 canonical PTID manifest，且不泄露凭据。
- Station attestation 由实际 deployment/runtime owner 产出并通过 live commit/proto 校验。
- Direct receipt source path 的 acceptance plan 自动包含 `chat-native-two-client-e2e`。
- 缺少任一资源时产生结构化 `BLOCKED/UNPROVEN` artifact，而非继续运行或静默降级。
- Gateway、Native clients、ports、storage 和 sessions 在成功与失败路径均完成 cleanup audit。
- Gap Detector 在 completion/quality/commit/PR 声明前发现缺失 Acceptance 责任并分派到 Acceptance Engineering。

## 7. Evidence Store 架构质量门

实现只有在以下证据同时成立时才可声明Evidence Store ready：

- macOS/Linux/Windows default和override resolver tests通过；
- workspace/gate/run isolation及traversal/symlink rejection通过；
- 两个concurrent Gates不覆盖artifact或latest；
- repository read-only且artifact root writable时，Gate仍能emit并validate；
- artifact root unwritable/disk-full模拟时，Gate typed fail-closed且repo零写入；
- interrupted manifest/latest write保留上一份valid latest；
- validators、coverage、quality和report tooling从canonical store读取；
- source tree scan对runtime write owner为零；
- tracked reports已分类，stale runtime evidence不再作为proof；
- cleanup在active lock存在时拒绝删除；
- secret redaction与source-bound traceability tests保持通过。

## 8. Native Desktop Runtime Cell 架构质量门

- Gate Catalog 能把同一产品 Gate 展开到声明的 macOS/Linux/Windows cells，结果互不
  覆盖且不能相互替代。
- Cell contract 缺失、host key 不匹配、GUI session 不可用、source/binary identity
  不一致时，在启动产品 Gate 前 fail closed。
- Embedded WebDriver 只监听 cell loopback；本地仅通过 run-scoped tunnel 访问。
- Linux cell 使用受支持的 WebKitGTK 4.1 userland 和 persistent Xorg desktop
  session；允许 digest-pinned container，不要求宿主发行版升级；不混装其它发行版
  软件包，不以 Xvfb 证据冒充最终 Native proof。
- macOS、Linux、Windows adapter 均证明真实 input、document focus、window ownership
  与 screenshot；缺一项时对应 cell 保持 `UNPROVEN`。
- 成功、失败、timeout、SSH disconnect 与 cancellation 都执行同一 reverse-order
  cleanup，并验证 tunnel、process、port、storage 和 lease 无残留。
- Runtime manifest 和 Gate evidence 记录 cell ID、OS/WebView/display identity、
  source commit/digest、binary hash、actor isolation 与 cleanup result。

## 9. Ephemeral Gate Launch Context 架构质量门

- synthetic Provisioner可注册不含业务语义的echo/deny capability，并由独立Gate
  process通过继承channel调用；manifest、environment value、argv、stdout/stderr和
  Evidence Store扫描不到secret canary。
- 仅声明的child descriptor可继承；无context Gate保持当前启动行为；携带context的
  Gate必须使用明确argv和`shell=False`。
- wrong workspace/gate/evidence-run/provisioning-run handshake、unknown
  capability/operation、oversized frame、duplicate request ID with different
  digest、EOF和deadline均产生typed `BLOCKED/UNPROVEN`。
- Gate success、non-zero exit、timeout、cancellation和spawn failure均执行同一
  `context quiesce -> runtime cell -> provisioner -> context close`清理；descriptor
  leak probe为零，broker thread bounded join，secret owner报告zeroized。
- 两个并发Gate的context、descriptor、request namespace和handler完全隔离，不能
  cross-call或复用另一个run的authority。
- unsupported host backend在spawn前fail closed；不得出现env/file/network fallback。
- Mobile E2-5只能在上述Infra self-validation通过并经架构评审接受后，注入自己的
  device/provider/Station Fixture capability；Infra测试不得使用Mobile业务fixture
  证明自身ready。
