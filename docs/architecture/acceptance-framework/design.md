# Acceptance Framework — 架构设计

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-06-03 | **Updated**: 2026-09-13


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
8. **Ephemeral authority stays ephemeral** — process-local capability只通过受控
   child inheritance存在，不进入durable manifest、environment secret、文件或网络。
9. **Impact is not scheduling** — Registry只产生保守影响投影；正式Execution
   Plan的当前closure决定本次执行。Evidence latest pointer不得充当工作状态。

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

### 1.4 多服务客户端绑定证据账本

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Runtime Manifest 已用 typed services map 表达多个同类服务 | `verified_fact` | D-17；`core/provisioning.py::RuntimeManifest.services` | high | none |
| Runtime Manifest 已记录隔离客户端，但客户端没有服务绑定字段 | `verified_fact` | `core/provisioning.py::ClientRuntime` | high | none |
| 通用 Environment Contract parser 不消费 `clients` | `verified_fact` | `core/provisioning.py::EnvironmentContract.from_yaml` | high | none |
| Mobile 通过业务常量维护 client 到 Station 的映射 | `verified_fact` | `gates/mobile/proof_contracts.py::CLIENT_SERVICE` | high | none |
| Federation prerequisite 通过裸 URL 环境变量表达 authority/follower Station | `verified_fact` | `gates/chat/federated_browser_prereq.py::main` | high | none |
| Native Desktop Provisioner 已提供同一 runtime cell 内多客户端隔离 | `verified_fact` | `provisioners/home_station.py::_clients`；Linux NDR-W7 evidence | high | multi-service binding |
| 客户端依赖应成为 Environment Contract 和 Runtime Manifest 的 typed edge | `proposal` | D-18 | high | architecture re-review |

### 1.5 Ephemeral Gate Launch Context 证据账本

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| D-18前runner在Provisioner返回可序列化Runtime Manifest后，以独立子进程执行Gate且没有process-local capability handoff | `verified_fact` | D-18 execution plan initial evidence | high | superseded by D-18 landing |
| 当前runner准备、seal、bind并activate `EphemeralGateLaunchContext`后通过受控child launch执行Gate | `verified_fact` | `tooling/scripts/acceptance-run.py`; `tooling/acceptance/core/launch_context.py` | high | none |
| Mobile physical device handle明确不可序列化，correlation secret具有显式zeroization | `verified_fact` | `mobile_resource_lease.py::ResolvedPhysicalDeviceHandle`、`RunScopedCorrelationSecret` | high | generic lifecycle integration |
| Mobile Station Fixture已用anonymous pipe和`pass_fds`把HMAC key限制在一次子进程调用 | `verified_fact` | `mobile_oauth_station.py::_run_command`及其focused tests | high | outer Provisioner-to-Gate handoff |
| Python `subprocess.run`把额外参数转交`Popen`，POSIX `Popen`提供`pass_fds`精确继承集合 | `verified_fact` | [Python subprocess](https://docs.python.org/3.14/library/subprocess.html#popen-constructor) | high | project synthetic process test |
| 一个run-scoped、不可持久化、domain-neutral的capability channel可关闭该边界 | `accepted_decision` | D-18 owner acceptance and closure evidence | high | none |

### 1.6 Post-Cleanup Evidence Finalizer 证据账本

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Runner在Gate退出后依次执行launch-context quiesce、runtime-cell cleanup、Provisioner cleanup和launch-context close | `verified_fact` | `tooling/scripts/acceptance-run.py::main` cleanup block | high | none |
| Runner在上述cleanup后写入cleanup artifact，并在`finalize_gate_result`中finalize/publish Evidence Store run | `verified_fact` | `tooling/scripts/acceptance-run.py::persist_provisioner_cleanup_result`、`finalize_gate_result` | high | none |
| `EnvironmentProvisioner`目前没有post-cleanup evidence-validation extension point | `verified_fact` | `tooling/acceptance/core/provisioner.py::EnvironmentProvisioner` | high | none |
| Mobile parent cleanup才产生lease outcomes、Station post-cleanup proof和correlation-destruction evidence | `verified_fact` | `tooling/acceptance/provisioners/mobile_native.py::_cleanup_parent`、`tooling/acceptance/gates/mobile/proof_contracts.py` | high | final 19-role validation after cleanup |
| Evidence Store run只能finalize一次；publish依赖durable manifest，不能在publish后补写proof artifact | `verified_fact` | `tooling/acceptance/core/evidence_store.py::RunHandle.finalize`、`ArtifactSession.complete` | high | none |
| Gate Catalog声明的detached domain finalizer可以在不转移cleanup authority的前提下关闭最终证据判断缺口 | `accepted_decision` | D-19 Owner acceptance | high | Infra self-proof and landing |

---

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
│ truth/surface/   │      │ path -> feature -> candidates│
│ negative/gates   │      └──────────────┬─────────────┘
└────────┬─────────┘                     │ drift validation
         │                               ▼
         │                 ┌────────────────────────────┐
         │                 │ Formal Plan / current closure│
         │                 └──────────────┬─────────────┘
         │                                │ scheduled gates
         │                                ▼
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
- Provisioner 输出runtime manifest；Gate只读取manifest、非敏感输入，以及D-18明确
  声明的ephemeral capability client，不自行部署服务或创建环境。
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
- Environment Contract 可以声明多个隔离 client；每个需要服务的 client 必须用
  `service_bindings[role]` 指向 `services[service-id]`，并声明 `required_kind`。
  Client 还必须显式声明 `required_service_roles` 作为 binding 的闭包约束；字段
  省略非法，无服务依赖必须显式声明空列表。
- D-18 adds only `id`, `required_service_roles`, and `service_bindings` to the
  existing `ClientRuntime`. Port, profile, storage, session, device, and
  platform isolation remain under D-13 Runtime Cell and existing platform
  Provisioners.
- Environment Contract 与 Runtime Manifest 必须共享稳定、唯一的 client ID；
  actor 不是 client identity，同一 actor 可以拥有多个隔离 client / device.
  Client ID and binding role must match `^[a-z0-9][a-z0-9-]{0,63}$`.
- Runtime Manifest 只复制已验证的 binding edge，不复制 endpoint。Gate 先按 client
  ID 取得 binding，再从 canonical services map 解析 endpoint 和 attestation。
- Binding role 表达客户端依赖，例如 `station` 或 `relay`；它不是
  service ID，也不得编码 `four`、`fiveArm` 等部署名称。
- 同一客户端可以绑定多个 service role；多个客户端可以绑定同一个 service ID。
  缺失引用、悬空引用、kind mismatch、重复 client ID 或未隔离资源都必须在 Gate
  启动前 fail closed，using closed `ClientBindingError` codes with numeric values,
  failure stage, and result mapping (not bare strings).
- Every initial launch and restart uses platform-owned
  `create_bound_session(client_id, launch_options)`.
  Runtime Binding resolves the service from the manifest; business Gate code
  cannot supply topology or launch generation. Each Runtime Binding exposes a
  closed typed launch-options contract; unknown fields, arbitrary environment
  maps, and topology-bearing values are rejected. Runtime Binding allocates the
  generation and reads observed identity from the running client's live
  connection state; the observation cannot come from launch configuration.
  It binds the observation to a platform-neutral runtime-instance identity
  backed by existing D-13 platform identity. Core derives expected runtime
  identity from the ServiceAttestation and persists one verification per
  required role. The session returns only after every required role verifies,
  and Runtime Binding automatically contributes every proof ref to Gate
  evidence.
  See [data-model.md §3](./data-model.md#3-runtime-resource-manifest) for
  proof schema and typed error code table.

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

本机默认root由Machine Dev Control Plane拥有：

```text
~/.peers-touch/dev/acceptance
```

正式产品Application Support namespace不得承载Acceptance evidence。

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
inspect_latest(worktree, gate_id) -> RunManifest  # diagnostic only
resolve_authoritative_latest(worktree, gate_id) -> AuthoritativeLatestResolution
```

`publish_latest`只能在`finalize`成功后调用。Reader不得通过字符串拼接artifact root；
所有path必须通过resolver，reject absolute child paths、`..`、NUL、symlink escape和
identity mismatch。
D-19 reader先按`EvidenceFinalizationRecord.state`分支：
`NOT_INVOKED_PRE_SEAL`要求durable requirement/config及无seal/invocation/outcome，
并按固定merge matrix把primary success降级、保留已有primary failed/blocked tuple、
reason和source trace；`COMPLETED`必须复验requirement/config、
snapshot、primary-result、invocation、runtime/source与outcome digest、strict outcome
shape和§3.12单调merge结果。任何abort authorization/tombstone都拒绝。Direct ref只
提供diagnostic inspection，只有validated latest pointer是权威proof。D-11 repair不得
选择任何带required-finalizer record的run，因为v1无法区分pre-publish crash与历史
pointer丢失。

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

### 3.12 Post-Cleanup Evidence Finalizer (D-19 Accepted Target)

是否需要finalizer由Mobile-owned Capability Graph的受保护required-finalizer mapping独立
声明，Gate Catalog只提供执行配置。两侧必须按Gate ID精确匹配：

```yaml
# tooling/acceptance/capabilities/mobile.yaml
finalizerRegistry:
  path: tooling/acceptance/contracts/mobile/finalizers.yaml
  protectedBaseline: tooling/acceptance/contracts/mobile/native_oauth.protected.json
  protectedBaselineDigest: <sha256>
  protectedBaselineFileSha256: <sha256>
requiredEvidenceFinalizers:
  mobile-native-access-e2e: mobile.native.oauth-final-roles

# Gate Catalog execution config
evidenceFinalizer:
  id: mobile.native.oauth-final-roles
  timeoutSeconds: 30
  inputByteLimit: 1048576
```

Requiredness只由Capability Graph mapping拥有；Gate Catalog schema不接受`required`
字段。Requirement存在但Gate Catalog字段缺失、两侧ID不一致、unknown finalizer
registration entry、
timeout非法或无法启动时，plan validation和runtime preflight均fail closed。Catalog有
配置但requirement缺失同样拒绝。只有requirement与Catalog字段同时缺省，才表示Gate
不需要finalizer。
该mapping与generated finalizer registration catalog由
`tooling/acceptance/contracts/mobile/native_oauth.protected.json`
的digest baseline冻结；删除或修改映射必须
重新经过架构review并在同一变更更新reviewed baseline，不能与Catalog字段一起静默
删除。多个Feature引用同一Gate时均消费同一Gate-level requirement，不在Feature之间
重复定义。
`finalizerRegistry`是generic resolver的唯一registration-catalog discovery入口；其
registration-catalog/baseline paths、semantic baseline digest与raw baseline file SHA
都属于Capability-owned declaration，不能来自CLI、环境变量或Gate输入。
`tooling/acceptance/contracts/mobile/finalizers.yaml`
中的具体entry由
`python3 -m tooling.acceptance.contracts.mobile.native_oauth
--emit-finalizer-registration`从canonical role table机械生成；CI的
`--check-finalizer-registration`在内存中重生成并逐字节比较，protected baseline同时
绑定Gate/finalizer ID、required-finalizer mapping、registration-catalog file、contract/schema、
entrypoint和generator source digests。Immutable requirement record保存完整baseline
object、canonical required-finalizer mapping及每个protected source exact bytes的
immutable ArtifactRef/digest；历史reader只解析这些record/artifact和sealed executable
bundle，不读取mutable current-worktree baseline或source path。

Mobile source cutover前先由Evidence Store安装永久
`publication-interlock.json`。Reader/writer只按该durable marker dispatch：interlock
存在且activation未完成时拒绝authoritative latest与`PROVEN` publication；interlock、
pending、sentinel、current全部缺失时才走legacy D-11。Historical reader不查询
Capability Graph或current worktree。
All project-owned claim admission points consume only the closed
`AuthoritativeLatestResolution` returned by the Evidence Store reader. The D-19
Infra landing cuts artifact CLI, planner/runner aggregation and readiness
reporting to this envelope before interlock installation and freezes their source
inventory digest in the interlock authorization. After an interlock exists,
`authorityMode=LEGACY`, a bare manifest or free-form legacy verifier output is
structurally non-authoritative, even when produced by an already-loaded process.
Every claim sink holds a shared gate-scoped claim-admission lock from read through
external emission. Interlock installation and activation hold the lock
exclusively.
Before first installation, the claim execution environment is restarted under the
sole `ProofAdmissionCoordinator`. Every job registers PID/start identity,
process-group identity, executable hash and source commit through a blocked
pre-exec handshake before claim code executes. Shared claim holders serialize
monotonic sequence allocation through the permanent claim-sequence lock. The
coordinator pauses new jobs, drains/reaps all registered pre-cutover jobs and emits a digest-bound
`ProofAdmissionQuiescence(activeJobs=())`; process-table inference alone is not
proof. Darwin and Linux execution-environment identities are disjoint closed
branches. Every admitted claim job is a trusted
`NO_CHILD_NO_SESSION_CHANGE_V1` leaf emitter: the complete classified source
closure rejects process creation, shell/process wrappers, `setsid`, `setpgid`,
same-PID process-image replacement (`exec*`), `spawn*`/`popen`, dynamic symbol
resolution and native extensions. V1 admits only source-only Python interpreted
claim emitters. A closed `ForbiddenProcessApiScan` persists
the scanner source, exact per-operation symbol registry, complete inspected
source-node set and empty findings so historical validation can reconstruct it.
The scanner starts only at
`proof_admission.py::scan_forbidden_process_apis`; claim source may not import
modules and executes with a fixed restricted builtin mapping plus a narrow
canonical-JSON facade. The digest-bound AST grammar permits `Attribute` only as
the direct call target `canonical_json.encode|decode`; every other attribute
shape is rejected. Filesystem, import, dynamic-code and descriptor-control
builtins are absent. The deny registry explicitly includes `posix.*`,
`exec*`, `spawn*`, `popen`, `pty.fork`, `ProcessPoolExecutor` and browser/process
wrappers through the allowlist boundary.
Runtime handshake binds that scan before source load. The wrapper receives one
typed authoritative input, owns the sole job-lease FD, never passes that FD or
descriptor-control capability into claim code, captures the only output
internally and consumes the leaf wait. The coordinator consumes the wrapper
wait and durability-profile syncs immutable completion before acquiring the
publish lock and re-resolving the exact expected authority. It then durably
publishes an emission intent and calls only the bounded idempotent sink whose
complete non-secret identity, destination namespace, protocol and deadline were
frozen in the immutable job before claim release. Its resolver is the
source-bound `proof_admission.py::emit_authoritative_claim` entrypoint and the
Evidence Store backend; callers cannot select an endpoint or implementation.
Recovery never rereads runtime sink configuration. The sink
receives only the base64-framed exact JCS `ClaimEmitterOutput` bytes and their
raw SHA-256, atomically claims the deterministic key and returns one stable receipt; the
coordinator persists acknowledgement before treating the claim as emitted.
Timeout/lost ACK retries the same key and bytes. Neither child nor wrapper can
emit directly, and raw stdout/file output remains diagnostic.
Linux additionally confines jobs to the epoch PID namespace. POSIX permits a
child to leave a process group with `setsid`, so process-group membership alone
is never used as descendant containment or quiescence proof
(<https://pubs.opengroup.org/onlinepubs/9799919799/functions/setsid.html>,
<https://pubs.opengroup.org/onlinepubs/9799919799/functions/wait.html>).
Because pre-cutover Darwin processes did not yet carry the leaf policy, the
first Darwin D-19 epoch requires a durable kernel boot observation created after
claim-consumer source cutover and before a mandatory reboot, plus a
source/runtime-bound helper attesting that both boot UUID and boot time changed.
This is capability evidence rather than an undocumented UUID guarantee.
Every later Darwin epoch also requires a new durability-profile-bound
before-observation, reboot and after-observation. Its environment stores a typed
ref to the exact prior boot observation; the ref, digest and supervisor
`bootSessionUuid` equal the attestation's prior observation, and the successor
starts only after the distinct current observation. Process absence, lease release
or shutdown intent cannot substitute for that boot boundary.
The first Linux epoch uses the same explicit legacy-environment split and
post-source-cutover mandatory reboot, with durable before/after boot ID and boot
time observations. Later Linux epochs bind PID-namespace device/inode and init
PID/start identity. Before environment allocation, a sacrificial-child probe on
the same host build/kernel must successfully exercise `pidfd_open` and consuming
`waitid(P_PIDFD, WEXITED)`; unsupported hosts fail closed. The probe persists
the raw pre/post poll masks and one pidfd lease identity. Derived readiness is
mechanical: pre-wait `POLLIN` is set, `POLLHUP` is clear and
`POLLERR|POLLNVAL` is zero; post-wait `POLLHUP` is set and
`POLLERR|POLLNVAL` remains zero. Both polls and the consuming wait use that same
still-open pidfd; replacement, reopen, duplication or transfer fails closed.
The epoch supervisor opens the pidfd before releasing jobs,
remains the sole wait-capable parent with default `SIGCHLD` and no
`SA_NOCLDWAIT`, and retains one lease through `POLLIN` and
`waitid(P_PIDFD)`; ownership is never transferred. A supervisor crash requires a
new reboot boundary before replacement. The failed epoch's typed Linux boot
observation must equal the attestation predecessor, and the successor epoch's
typed observation must equal the distinct attestation current boot captured
before successor start. Graceful termination proves an empty
target namespace by consuming the identity-bound namespace-init pidfd wait and
the kernel rule that init termination kills all namespace processes. Procfs
census is not accepted because visibility depends on the namespace that mounted
procfs. This claims zero surviving processes, not destruction of namespace pins.
Missing/stale quiescence or an unproven leaf policy is `NO_MUTATION`.

D-19 interlock installation与generation activation都是不可逆proof-authority变更，
只能由Evidence Store local interactive CLI授权。CLI先做read-only impact inventory，
从kernel effective UID取得operator principal，验证real/effective UID和controlling
TTY，再验证`authoritySourceCommit`中canonical D-19 decision document的
exact hash与`accepted`状态。`authoritySourceCommit`必须等于clean current HEAD；
整个canonical worktree必须没有tracked或untracked drift，authority CLI以isolated
reviewed entrypoint运行且不得加载ignored/untracked/dynamic source。
Power-controller trust enrollment uses a separate two-phase local interactive
protocol with the same kernel-principal, TTY, clean-HEAD and canonical approval
checks. Phase one accepts public material only and writes a non-authoritative
bootstrap candidate using the strongest available OS sync; that candidate may
authorize only its bound `(crashFixtureId, qualificationRunId)`, which is
consumed by one immutable promotion. Qualification boot observations bind that
finite context rather than a not-yet-existing profile. Phase two binds the successful
qualification manifest and backend identity, then uses that backend to publish
one predecessor-keyed immutable transition reservation containing the complete
frozen promotion intent before candidate consumption, active anchor, immutable
generation record and CAS current selector. Revocation uses the same reservation
rule before its intent, revocation, generation and selector CAS. Trust state is a
monotonic generation chain: later
owner-authorized requalification may rotate from the exact ACTIVE or REVOKED
current digest to generation `N+1`, while revocation immutably records the
prior anchor and advances current to a non-authorizing REVOKED generation.
Rollback, stale-current update, sibling successor and in-place anchor mutation
fail closed. Crash recovery may finish only the frozen transition bytes. Normal
expectations accept only the selected ACTIVE anchor; fixtures cannot self-enroll
controller authority.
Active reads must resolve `current -> anchor -> candidate consumed record ->
promotion intent`, including `candidate.json`, and reject any missing or unequal
predecessor.
Proof-admission inventory由fixed `ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES` rule生成：
该commit中`tooling/acceptance/**`与`tooling/scripts/acceptance-*`的全部tracked
regular files、exact `quality-evidence.py`/`_acceptance_artifacts.py`及这些seed的
repository-local transitive imports and statically resolved process/file execution
dependencies，按repo-relative path排序并绑定raw hash/length。
Closure generation then runs the fixed classifier over every tracked file and a
language-neutral reverse fixed-point over every `PARSED_SOURCE`: any direct or indirect
caller/importer/includer of a closure member joins the inventory together with its
own local dependencies. Unsupported grammar, unresolvable dynamic call or any
closure-external latest/manifest/proof-status admission path fails；它不是未来
plan选择的子集。
Each digest input is a `ProofAdmissionSourceNode` binding source/data class,
fixed grammar version, interpreter assignment and sorted edges. Any
interpreter/source/include target inherits that grammar and is recursively parsed
regardless of extension or executable bit; only never-executed data may be opaque.
The classifier has one normative precedence table: recognized suffix, then
Make/workflow location, then exact shebang/incoming assignment for extensionless
executables. Overlaps and multiple incoming assignments must be byte-equal.
Each non-data edge resolves exactly one canonical target node and repeats that
node's exact grammar/interpreter pair; invalid pairs, ambiguous targets or
assignment drift fail closed.
Existing namespace packages are restricted to `tooling` and
`tooling.acceptance`, each with exactly one canonical repository search location;
all other namespace packages are rejected.
Proof-admission digest与全部activation content digest都从该commit重新生成，不能
把旧commit approval与新worktree inputs拼接。Closed authorization绑定action、workspace/Gate/finalizer、
source commit、approval hash及expected authority state；activation另绑定target/current
generation、expected prior latest digest与requirement/config/source/protected-baseline
digests。Authorization还绑定native supervisor、source-only maintenance worker
source tuple、complete preflight runtime measurement与runtime-capture bundle/digest
的`maintenanceRuntimeDigest`；每个maintenance
request和live `SUPERVISOR_READY`必须逐项匹配。Operator必须从同一TTY回输完整domain-separated challenge。任何validation
失败都在durable mutation前返回`NO_MUTATION`；operator identity、approval status或
expected state不能由environment、manifest、Gate或worker补写。
After confirmation, the dedicated `AUTHORITY_RUNTIME_PERSISTER` receives verified
gate and temporary-capture FDs, writes content-addressed authority-runtime blobs
plus identity with file/directory fsync, and reports
`NO_MUTATION | AUTHORITY_RUNTIME_MAY_BE_DURABLE | AUTHORITY_RUNTIME_DURABLE`.
Every nested runtime ref and the persistence request must carry the enclosing
authority/abort authorization ID. Only the durable branch allows the requested
maintenance mutation.
Pre-publication filesystem I/O, timeout or worker-process failures return
`PersistAuthorityRuntimeRejected/NO_MUTATION`; after any final blob/identity
publication attempt, the same failures or lost ACK return
`PersistAuthorityRuntimeFailed/AUTHORITY_RUNTIME_MAY_BE_DURABLE` with
`FINALIZER_AUTHORITY_RUNTIME_IO_FAILED`. Retry validates the complete expected
set and replays the selected durability backend.

Every D-19 authority transition also binds a closed
`ProofAuthorityDurabilityProfile`. Linux uses file and affected-directory
`fsync`; Darwin is limited to local APFS and orders file `F_FULLFSYNC`, directory
`fsync`, then `F_FULLFSYNC` of an identity-bound same-volume sync anchor. Apple
documents that plain `fsync` may not survive power failure and recommends
`F_FULLFSYNC` for the stronger flush
(<https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html>).
Unsupported filesystems, unavailable primitives, cross-device state, profile
drift or failed capability evidence return
`FINALIZER_DURABILITY_PROFILE_UNSUPPORTED` or
`MAINTENANCE_DURABILITY_PROFILE_UNSUPPORTED` with `NO_MUTATION` before allocation
or authority mutation. Equal-byte recovery replays
the complete selected backend, not plain fsync.
The profile embeds closed capability evidence with fixed-path, content-addressed
manifest, power-cut trace, recovery result and probe-runtime refs under
`finalizer-enforcement/durability-capabilities/`. Historical validation resolves
their exact typed bytes, verifies every interruption-point case and reconstructs
the probe runtime before accepting the profile. The profile binds reboot-stable
volume identity; every operation separately derives a live mount binding from
its opened authority FD, so reboot-local mount IDs never enter the stable
profile. Boot observations persist and verify both the profile digest and their
live mount binding. Kernel helper entrypoints/source closures/runtime refs are
fixed and reconstructible from the same capability artifact set.
Each power command has standalone signed receipt, arm receipt, execution receipt
and append-only command-journal artifacts. Evidence Store durably stores the first two before fixture
mutation; the controller atomically consumes a hash-bound one-shot release token
through `ACCEPTED -> ARMED -> EXECUTION_STARTED -> ACTION_DISPATCHED ->
EXECUTED`. Restart never
resumes, cancels or issues power for any nonterminal prior-epoch command; the
case fails and requires a new command ID. A permanent runtime lock, signed epoch,
deterministic current pointer and live lease make that invalidation verifiable
and are revalidated before power action. The external controller's qualified
runtime-lock backend, locality proof, contention proof and epoch lease must
identify the same controller host build, live mount, filesystem
implementation/options, stable-volume digest and opened `.runtime.lock`
device/inode; these are independent of the interrupted target environment.
`core/power_controller.py` exclusively owns that repo-reviewed external runtime,
key custody, journal store and in-process actuator dispatch and must not execute
on the interrupted target. The bootstrap candidate carries only a finite,
OS-tagged Linux or Darwin prequalification store identity. Promotion adds a closed Linux or Darwin
controller-store durability profile, qualified separately with branch-specific
file/directory/anchor operations and a complete power-interruption matrix
performed by a distinct operator/witness that has no production authority.
That witness key must resolve a candidate-local immutable owner authorization
scoped only to controller-store qualification and sign phase-tagged,
case/run-bound before/interruption/after/recovery evidence. Witness credentials
use canonical P-256 keys and low-S P1363 signatures; production controller
authority uses only canonical Ed25519 keys and signatures. Their closed schemas
reject cross-decoding and key conversion, so qualification authority is
structurally ineligible for production use without a mutable deny registry.
Candidate creation, witness authorization and promotion use the Gate publish
lock and their branch-specific durability boundary. Signed recovery is the sole
observed state/hash authority for case PASS.
Target durability evidence cannot substitute for it. Qualification,
epoch publication and the pre-action check each remeasure those live values.
A per-command lock and
singleton deterministic head serialize every
transition; the same still-live controller process and epoch may adopt exactly one valid unheaded
successor and rejects forks. Controller restart invalidates all nonterminal
prior-epoch commands rather than recovering or re-executing them. Equal duplicate command IDs return the
same receipts without re-execution, while conflicts/replays fail closed.
Journal transitions and external power execution are separate closed
operations: transition results carry the exact requested target but always set
`externalActionAllowed=false`, as does every other result. Only an
`EXECUTE_POWER_ACTION` operation resolved against the same current epoch/lease
and exact `EXECUTION_STARTED` head may durably claim `ACTION_DISPATCHED` and
invoke the in-process actuator once while the lock remains held. It first holds
an Acceptance Infra `TrustDispatchLease` from the read-only
`trust_admission.py` mediator, which holds the Gate publish lock shared and
re-resolves the exact ACTIVE trust generation bound into the epoch and command;
rotation/revocation hold that lock exclusively, so a REVOKED or changed current
can never race irreversible dispatch without giving `power_controller.py`
Evidence Store mutation ownership. Its result
records `externalActionDispatchedInline=true` after that call and is not a bearer
authorization. Retry from
`ACTION_DISPATCHED` is typed rejection and the case fails with a fresh command
ID. Invalid current identity/head/edge combinations also return a closed typed
rejection. An observed `ACTION_DISPATCHED` head takes precedence over stale-head
classification for power-action retries. Every success and rejection repeats
the exact request operation/digest/epoch and expected command identity; mismatch
variants separately preserve the observed identity. The
allowed journal edges are fixed rather than caller-selected. Ed25519
keys/signatures use exact lowercase-hex encodings and raw lengths.
Durable dispatch uses the qualified backend under the command lock: sync the
temporary signed transition, no-replace publish it, sync the transitions
directory, sync the temporary head, compare-and-replace the head, sync the
command directory and complete the Darwin anchor when applicable. The actuator
is not called until the entry and head are durable. Recovery before entry
publication may retry; the original still-live call may recover its own
unheaded dispatch only by retaining a Core-generated, non-serializable
process-memory capability whose digest binds the exact
`resolutionRequestDigest`, expected head, command lock and process/epoch, then
adopting the head and continuing through its one actuator call. No caller,
serialized request or later call receives that capability or may adopt/invoke
it. Process
restart creates a new epoch and never adopts a prior unheaded entry. Any durable dispatch head makes the effect uncertain and
forbids redispatch.
Cancellation is a closed journal union with separate
`CANCELLED_FROM_ACCEPTED` and `CANCELLED_FROM_ARMED` variants. Physical and VM
power interruption evidence are separate variants, and each of their three
ArtifactRefs must resolve bytes whose domain digest equals the corresponding
receipt digest carried by the interruption evidence. Bootstrap and active
qualification branches require `QUALIFICATION_BOOT_OBSERVATION` and
`BOOT_OBSERVATION` refs respectively; arm command/epoch/token/predecessor fields
match the initial receipt, execution receipt, journal and interruption evidence.
The arm signature signs the explicitly domain-wrapped RFC 8785 UTF-8 bytes;
the arm digest then covers the resulting signed object.

D-19 activation由Evidence Store `activate_finalizer_enforcement()`拥有。它在启用
required mapping前持有gate cleanup lock、阻止新的D-19-aware run allocation，以
60秒/4096-entry上限确认无active D-19-aware run，再获取publish lock并验证operator
提供的expected current generation/latest。它在仍持有两把锁时捕获prior pointer、
冻结`activatedAt`与`activationSourceCommit`并构造完整candidate enforcement record，
再原子发布包含该record的`activation-pending.json`；pending durable即成为不可逆
authority cutoff。
Pending还冻结canonical `FinalizerEnforcementCurrent`。Activation以atomic replace
发布该不超过16 KiB的pointer；reader验证kind/schema/workspace/Gate/current digest，
再resolve exact immutable generation record并匹配generation/enforcement digest，
任一missing/corrupt/mismatch均fail closed。
首次activation还atomic no-replace发布永久`activated.json` sentinel。它绑定workspace、
Gate、first generation/enforcement digest和activation intent；后续generation只验证
而不改写。Sentinel存在而current缺失时reader必须fail closed，不能回退legacy或扫描
generation目录；sentinel/current不一致同样视为storage corruption。
Interlock install还在publish lock内比较operator确认的exact legacy latest
pointer/digest，并通过closed `INSTALL_PUBLICATION_INTERLOCK` maintenance
request/result执行。`NO_MUTATION`、`INTERLOCK_MAY_BE_DURABLE`与
`INTERLOCK_DURABLE`明确区分validation/conflict、lost-ACK/fsync不确定和完成。
Interlock marker与activation intent都嵌入完整authorization并进入各自digest。
Interlock lost-ACK retry只接受existing bytes与原authorization逐字节相同，且要求同一
kernel principal重新确认原challenge；retry必须重新fsync marker file与enforcement
directory后才能返回`INTERLOCK_DURABLE`，仅byte equality不构成durability。
Activation在pending前失败时无durable authority
mutation，后续调用重新授权；pending durable后只允许从pending恢复原authorization和
frozen intent，由同一principal重新确认原challenge后完成，不得签发替代authorization、
改变approval hash或rebase expected state。
Every retry that reuses an equal existing interlock, pending, generation, sentinel,
current, manifest, abort event or deletion plan must reopen and fsync the file and
its containing directory before advancing to the next durable transition. Visible
equality alone never proves durability.
Directory creation, rename and unlink follow the same rule: every affected parent
directory is fsynced, and retry must revalidate the visible directory identity and
re-fsync all source/destination parents before advancing.
Here `fsync` denotes the operation selected by the bound durability profile,
including Darwin's final same-volume full-flush anchor step.
If pending unlink is visible but its directory fsync was not acknowledged, retry
resolves the requested immutable target generation directly, recovers its
authorization, and verifies the complete monotonic chain to `current >= target`.
It revalidates the operator challenge and all identities, re-fsyncs target and
successor generations, sentinel, current and their directories, then fsyncs the
enforcement directory. It returns `ACTIVATED` for the requested target only while
pending remains absent; if target pending reappears it resumes that pending path.
首个generation记录pending前captured legacy latest pointer/digest或null；后续generation
记录captured current generation-scoped latest或null，生效后均仅供diagnostic。
D-19 publish写`finalizer-enforcement/latest/<generation>.json`，current-generation
reader永远不读取legacy top-level或prior-generation latest，已加载旧runner无法污染
newauthority。Accepted baseline变化创建新record而不改写旧record。Reader与
`begin_run`在pending存在时fail closed；crash retry只能按pending中冻结的intent和
captured prior pointer完成同一generation，不得读取或rebase到pending后写入prior
namespace的latest，也没有abort/supersede路径。D-19-aware `begin_run`短暂持有同一
cleanup lock，完成current generation读取、live supervisor session复验、
run/active-lock创建和requirement record持久化后才释放，因此activation scan不能与
新的D-19-aware allocation竞态。已经加载且不认识该锁的legacy runner仍可能分配和写
legacy namespace，但其run/latest在cutover后永久不具authoritative资格。Marker存在后，
non-legacy run缺失finalization record或使用`NOT_REQUIRED`均fail closed。
Runtime preflight必须先于run allocation、credential resolution、Provisioner创建、
resource acquisition和destructive Fixture操作，并验证required-finalizer mapping、
Gate Catalog execution config、finalizer registration entrypoint/source paths、
timeout、input limit与Mobile protected baseline。Preflight
失败不分配run。通过后，Evidence Store以一个原子operation创建run directory、
durable `.active.lock` file和immutable `finalization-requirement.json`，获取
process-scoped live advisory lock，并在目录与文件durable后才返回`RunHandle`。Lock
file是durable identity material，advisory lock只是live lease且随process crash释放。
因此每个已分配required-finalizer run都可在不依赖未来Catalog的情况下被识别。

Runner固定执行：

```text
Gate exits
  -> launch context quiesce
  -> runtime-cell cleanup
  -> Environment Provisioner cleanup
  -> launch context close
  -> write all cleanup/log/Infra artifacts
  -> redaction and secret audit
  -> Evidence Store seal_for_finalization
  -> detached domain finalizer process
  -> supervisor close/reap
  -> Evidence Store manifest finalize
  -> publish
```

`seal_for_finalization`只在native deadline supervisor完成`READY` handshake后开始。
它在Store-owned跨进程finalization lock内调用bounded Core snapshot-materializer，
完成全部anchored read、payload解析、文件hash和完整
`roleName + discriminator + ArtifactRef + payloadDigest` inventory构造，然后一次写入
带complete-object `sealDigest`的durable sealed marker。所有writer与role registration必须服从同一lock并在marker出现
后返回typed conflict。Seal后snapshot和digest不得再构造或变化；manifest finalize在
同一lock下复验marker、文件集合、hash与sealed role-instance inventory，并消费同一snapshot digest。
Finalization lock只能通过non-blocking try/retry在Core 60秒monotonic ceiling内获取；
不得执行无期限blocking acquire。
Evidence Store只验证generic role-instance语法、reference identity和文件完整性；
每个multi-instance role的discriminator与canonical path/payload identity由detached
Mobile finalizer调用canonical Mobile contract验证，Core不得解释该业务关系。

Finalizer不是Provisioner bound method。Acceptance Infra finalizer-registration
resolver只解析和
结构校验`FinalizerRegistryEntry`；具体
`mobile.native.oauth-final-roles -> fixed entrypoint/source paths` registration由
Mobile protected declaration拥有。其evidence role-name projection由canonical Mobile
contract机械生成，不得手工编辑，projection digest必须与protected baseline及
executable bundle一致。Preflight通过supervised `BUNDLE_PREPARER`一次读取reviewed
sources并在owner-only temporary directory构造process-local source capture；token绑定
capture identity/digest，allocation只消费该capture一次并把exact bytes持久化为
requirement-record ArtifactRefs及canonical executable bundle，不按path重读。
Acceptance Infra固定bootstrap closure只含
`core/finalization_contracts.py`、`core/finalizer_worker.py`和
`core/finalization_supervisor.c`；Mobile generated
registration提供business validator/contract/schema closure。两组path/raw hash及
bootstrap source digest均进入capture、requirement record和executable identity。
Preflight also runs a separate supervised `RUNTIME_CAPTURE` before allocation. It
measures and copies the supervisor binary, Python executable, compiler binary and
FILE stdlib closure into an owner-only temporary directory without creating
run-scoped ArtifactRefs. The preflight token binds that capture; allocation
persists its bytes as runtime ArtifactRefs and only then constructs the
historically verifiable `FinalizerRuntimeIdentity`. Runtime capture uses the
canonical `pt-finalizer-runtime-bundle-v1` framing: fixed magic, big-endian JCS
manifest length, JCS `captureId + measurement + ordered files` manifest, then
big-endian length-prefixed exact file bytes in the runtime identity total order.
Allocation and historical validation reconstruct the same bytes from persisted
runtime ArtifactRefs and must reproduce the raw bundle SHA-256.
The request carries a closed `RuntimePathInput` only for supervisor, Python,
compiler and FILE-stdlib paths. Loaded-image identity is never caller supplied;
the worker-owned loader probe exclusively enumerates standalone/shared-cache
images after loading the fixed bootstrap/import allowlist.
Prepare、manifest parse和expand统一限制为64 files、512-byte path、
256 KiB manifest、8 MiB single entry、64 MiB bundle/expanded bytes、128 MiB
temporary storage和60秒wall time。ArtifactRef hash、bundle digest和逐文件hash必须在
seal前、spawn前和child退出后逐项相等，执行代码不得从运行中的worktree直接import。
独立进程只传递
冻结的`FinalizerInput`。其invocation、context与snapshot全部重复identity必须
逐字节相等并由`finalizerInputDigest`覆盖，child/Core outcome持久化同一digest。
`FinalizerContext`只含child-safe primary status tuple；完整primary
result不进入child input，只由parent merge，并持久化在sealed marker/finalization
record供历史reader重算。
进程使用`shell=False`、bounded timeout与process-group终止。v1
finalizer属于reviewed trusted/no-child纯validator：禁止subprocess、fork、setsid、
network、signal-handler/timer mutation、native extension和product client；bootstrap
在加载业务module后复验`SIGALRM`仍为default disposition，static dependency gate与
runtime syscall/process probe必须证明无descendant且hard timer未被替换。该契约不声称
隔离hostile code。Finalizer不得获得Provisioner实例、credential、raw handle、launch
context或可写RunHandle，也不得调用产品系统、执行cleanup或重新获取资源。
v1使用由reviewed `core/finalization_supervisor.c`构建的native POSIX deadline
supervisor，其source、compiler/build identity和binary hash均进入runtime identity。
Runner必须在run allocation前启动supervisor并完成`READY` handshake。收到worker请求
后，supervisor fork；child在exec Python前建立process group、解除`SIGALRM` mask、
恢复OS default disposition、设置并复验60秒`ITIMER_REAL`，再发送
`WORKER_ARMED(pid, pgid)` ACK后exec；该timer跨exec保留。Supervisor parent同时设置
child PGID并用monotonic deadline监控control-pipe EOF、ACK与worker。ACK前直接kill
child PID；ACK后kill process group并以direct-PID kill处理`ESRCH`/race，最后reap。
Python bootstrap完成runtime/bundle/FD/timer复验后再发送`WORKER_READY`；Runner只有
验证`WORKER_ARMED`和`WORKER_READY`后才接受output。Runner在每次request前及执行期间
监控supervisor PID、reverse EOF和control channel，READY后退出产生typed failure；
seal前释放lock并以`NOT_INVOKED_PRE_SEAL`发布blocked/unproven。Seal后若Runner仍
存活，则合成`ERROR/FINALIZER_SUPERVISOR_FAILED`交给Evidence Store执行降级merge并
publish；只有Runner hard-crash才留下只可显式abort的orphan。
`setitimer(2)`明确说明timer不跨fork继承但跨exec
保留：<https://man7.org/linux/man-pages/man2/setitimer.2.html>。
Runner control pipe EOF触发立即kill/reap，OS timer在parent hard-crash时独立兜底。
Unsupported host在preflight fail closed。Python官方语义见
<https://docs.python.org/3/library/signal.html#execution-of-python-signal-handlers>。
Python worker不能修改supervisor timer。即使runner hard-crash，supervisor也会在
ceiling内终止worker；business child无artifact/root/network/lock FD，不能写run或
publish。Sealed incomplete run只能由显式`abort-sealed`删除；该命令获取active lock
后等待watchdog ceiling加5秒grace，不依赖PID/process matching。
Runner与supervisor使用两个Darwin/Linux anonymous channel：`AF_UNIX SOCK_STREAM`
承载length-prefixed bounded control frames，`AF_UNIX SOCK_DGRAM`仅承载
`SCM_RIGHTS`。Request identity绑定ordered descriptor roles：
maintenance一个gate-directory FD，materializer一个run-directory FD，
bundle preparer依次两个repository-root/temporary-directory FDs，runtime capture一个
temporary-directory FD，finalizer为零。
Receiver要求一个cmsg及与worker kind完全匹配的FD count/order，对全部FD先设置
`FD_CLOEXEC`再验证role/type/identity。每个descriptor claim绑定sender-side
`fstat(device,inode,type)`及logical owner digest：gate/run/repository/temp分别绑定其
workspace/Gate/run/source/temp nonce identity；sender/receiver逐项等值。Sender只在
request-bound acceptance后关闭
duplicates，任一失败双方关闭本次全部duplicates。完整identity另有
`requestIdentityDigest`，因此worker kind和ordered roles不依赖只覆盖payload的digest。
Finalizer request禁止ancillary FD。
`PrepareBundleRequest`、`CaptureRuntimeRequest`、`MaterializeSnapshotRequest`、
`ExecuteFinalizerRequest`和五种maintenance request组成closed worker request union；
每种non-maintenance worker同时拥有exact completed/failed result variant与
`workerResultDigest`。因此每个worker kind的`requestPayloadDigest`和result都可独立
重算，unknown shape直接拒绝。
Stream control channel只接受closed `SupervisorControlFrame` tagged union，覆盖
READY、request acceptance、armed/worker-ready、bounded diagnostics、result、
exit/signal/timeout、runner cancel request/cancel acknowledgement和close/close-ack。
SCM_RIGHTS datagram只接受closed `DescriptorTransferFrame`并与stream request完整
identity/correlate；每个frame有exact keys、frame digest和state-order validation。
Supervisor session正常路径遵循
`STARTING -> READY -> REQUEST_ACTIVE -> READY -> CLOSING -> CLOSED`；协议或process
failure先进入保留typed failure的`FAILED`，再且仅能
`FAILED -> CLOSING -> CLOSED`。所有成功、失败、未分配run和取消路径都执行bounded
CLOSE/CLOSE_ACK、channel close、kill fallback与final reap；只有worker和supervisor
均已reap才可进入`CLOSED`。无法reap时保持`FAILED`，不得构造manifest或publish。

Seal前JSON artifact读取由Evidence Store-owned native setup与generic parser两段完成。
Setup child在self-timer已arm后接收run-directory FD，按ArtifactRef inventory打开
`O_RDONLY | O_NOFOLLOW` regular files；它属于Evidence Store owner，不是低权限business
process。随后它关闭directory FD，只把显式allowlisted regular-file FDs、metadata和
budget传给不加载domain code的parser。Parser在finalization lock内完成完整inventory、
payload和digest构造；超时或失败时释放lock并保持run unsealed/UNPROVEN。Business
finalizer从不接收这些FD。Regular-file `O_NONBLOCK`不提供deadline保证，见Linux
`open(2)`：<https://man7.org/linux/man-pages/man2/open.2.html>。Worker以anchored
open、fstat、bounded chunk和hash验证返回allowlisted payload；Linux使用
`openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS)`，其它POSIX
host逐component `openat(O_DIRECTORY | O_NOFOLLOW)`并验证每层，不能只保护final
component。Runner再通过stdin传给finalizer。Seal后不再读取或materialize artifact。
Binary artifact只传ref/hash。
Finalizer不接收artifact root或绝对路径，使用sanitized environment与isolated
temporary cwd；输入超过Catalog limit时fail closed。
Python worker以`-I -S -E -B`启动，`sys.path`只含verified bundle与hashed stdlib
closure，并以import allowlist拒绝site/user-site、`sitecustomize`、cwd、unbound
site-package、dynamic loader和native extension。
Parent把每个canonical JSON payload digest纳入snapshot digest；child在业务验证前
重算并匹配，不能把未绑定的stdin payload作为proof。
Core hard limit固定为timeout 60秒、stdin 1 MiB、stdout 256 KiB、stderr 256 KiB；
Catalog只能降低timeout/stdin limit。Native setup从verified run directory FD使用
no-follow anchored open，在materialize前检查file/cumulative budget；generic parser只
读取预选regular-file FDs，以bounded chunks验证hash并限制JSON
depth/container/string/duplicate key。Parent同时增量drain worker/finalizer输出，任一
stream超限立即TERM/KILL/reap，不允许先无界缓冲再截断。

Finalizer bundle绑定reviewed module/contract/schema依赖；当前Python interpreter的
canonical path hash、binary SHA-256、implementation/version与required
stdlib/platstdlib module closure digest也进入invocation
identity。Runner在finalizer spawn前和返回后复验bundle/runtime identity；不匹配则
fail closed。该设计不承诺跨runner或跨host恢复执行。
Source tuple只能来自Store-owned immutable `RunHandle.source`。`FinalizerContext`
与`FinalizerInvocationIdentity`逐字段相等并精确绑定
`enforcementGeneration + enforcementDigest + requirementDigest + configDigest +
workspaceId + gateId + evidenceRunId +
provisioningRunId + Runtime Manifest ArtifactRef + sourceCommit + workspaceDigest +
canonicalWorktreeHash + snapshotDigest`。Core必须证明`runtimeManifestRef`属于sealed
snapshot，读取payload并将其中的Gate、provisioning run、source commit、workspace
digest和canonical worktree hash分别与`RunHandle.source`、snapshot和context比较，
不把各字段彼此自洽或ArtifactRef存在本身当作identity proof。
Finalizer只返回`VALIDATED | REJECTED | BLOCKED` child outcome；
`TIMED_OUT | ERROR`由Core根据process/protocol/identity/I/O failure合成。Child只在
`VALIDATED`时返回`validatedRoleInstances`，Core按
verified generated finalizer-registration role projection计算完整required set并要求
逐项相等，再从snapshot投影
ArtifactRef；禁止child回传payload/ref或确认任意子集。只有`VALIDATED`且完整set匹配，
才允许保留primary success。`REJECTED`、`BLOCKED`、`TIMED_OUT`、
`ERROR`、invalid output或missing required finalizer均把primary success单调降级为
`failed/PARTIAL/UNPROVEN`。已有failed/blocked primary result的status、reason和
source trace不可修改，finalizer outcome只作为附加诊断进入最终manifest。

Child和Core outcome是两个strict discriminated union。CHILD variant只包含
`origin=CHILD + childOutcome + outcomeDigest`；CORE variant只允许
`TIMED_OUT | ERROR`、`childOutcome=null`、空roles及匹配的Core failure code。两者分别
包含domain-separated `childOutcomeDigest`和`outcomeDigest`。Seal同时创建
process-local one-shot reservation；Runner只允许
`READY -> INVOCATION_STARTED -> OUTCOME_CACHED`，重复调用返回typed conflict。
Evidence Store首次merge时冻结一次`completedAt`、canonical manifest/latest bytes及
digests，转为`MANIFEST_PREPARED`；同一live Runner只能用这些缓存bytes发布immutable
manifest；existing identical bytes还必须重新fsync manifest file与run directory后
才视为lost-ACK idempotent success，冲突bytes fail closed。Generation-scoped latest仍按D-11 `(completedAt, runId)`在publish lock内atomic
replace；相同candidate、成功替换或被更新pointer超越分别记录
`ALREADY_CURRENT | PUBLISHED | SUPERSEDED`，随后转为`LATEST_RESOLVED`。不得重跑child
或改变输入。每个reservation state是独立closed variant，其required/null cached
fields由结构强制；cross-state fields无效。该状态不用于跨process crash recovery。
Evidence Store reader把resolved manifest包装为closed
`AuthoritativeLatestResolution`，绑定authority mode、interlock/current/generation、
manifest ref/hash与canonical result tuple。所有project-owned readiness consumer只接收
该envelope；D-19 interlock存在后拒绝legacy mode和缺失generation identity。
Runner只验证process envelope与
typed outcome，然后把primary result和outcome提交给Evidence Store
`finalize_with_evidence()`；Evidence Store独占
单调merge、immutable manifest构造和D-11 publish authority。Finalizer只执行
一次，不重试、不跨runner恢复。`REJECTED/BLOCKED/TIMED_OUT/ERROR`等确定性outcome
同样进入`FINALIZING -> DURABLE -> PUBLISHED`，发布failed/partial/unproven manifest。
Runner crash不由后续进程继续本run。只有verified latest pointer是权威proof；
manifest fsync后、latest前崩溃留下的candidate manifest仍为`INCOMPLETE/UNPROVEN`，
D-11 repair不得发布required-finalizer orphan manifest。普通retention/delete不得
删除sealed incomplete run；唯一入口`abort-sealed`必须获取完整锁序列和active lock，
等待Core watchdog ceiling加5秒grace，先create-exclusive持久化identity-bound
`AUTHORIZED` audit，再把run原子rename到同文件系统`aborted-runs/` tombstone并fsync
source/destination parents。所有audit event都经temp write、file fsync、atomic
no-replace publish与directory fsync。Tombstone形成后必须先发布`TOMBSTONED` event。
每个delete batch再先发布绑定exact immutable plan range的
`DELETE_BATCH_STARTED` event，之后才按每次1024 entries、1 GiB或30秒的上限分批
递归删除并写append-only
`DELETED/FAILED` event；crash只允许显式同身份abort继续，reader/repair始终拒绝有
abort authorization或tombstone的run ID。
Equal existing audit/event bytes must be reopened and both the file and event
directory re-fsynced before retry treats the event as durable or performs the next
mutation. Corrupt requirement/seal identity remains a quarantined forensic orphan;
v1 has no corrupt-record deletion authorization.
Abort authorization runs through the same isolated source-only authority bootstrap
as interlock/activation and binds clean HEAD, the complete claim-source closure and
the full maintenance runtime identity into its TTY challenge and every audit event.
If retry observes the tombstone after an uncertain rename, it revalidates the
recorded run-directory identity and re-fsyncs both rename parents before creating
the deletion plan. Each delete batch fsyncs every modified surviving parent
directory before its terminal event; root deletion fsyncs `aborted-runs`.
该命令遵守全局
`cleanup -> active -> finalization -> publish -> abort`顺序；run path不存在的retry
只取`cleanup -> publish -> abort`稳定锁，rename后不再尝试重建run-local locks。
全部适用锁使用non-blocking try/retry和60秒aggregate monotonic ceiling；超时返回
typed failure且不产生任何audit、rename或delete副作用。
Requirement与Catalog均未声明的现有Gate保持当前行为。

---

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

- Conversation `/conversation/*` 是唯一 Chat 入口；Device、Inbox、Recovery、
  Key Exchange 与 Federation 证据分别来自其 resource-owner API。
- 事实源来自 `model/domain/chat/*.proto`、Station Conversation DDD、conversation
  event log、per-device inbox，以及 Desktop/Mobile Device Messaging Engine
  对 resource-owner API 的 typed contract。
- Queue / envelope delivery 是 delivery contract，不是 message persistence truth。
- Desktop typed surface 只能证明页面、store、service API 的编译期契约，不能替代 DOM 级可见性或 live realtime DOM event-consumption proof。
- 当前 stable gates 是 `proto-build`、`station-messaging-unit`、`messaging-platform-contract`、`desktop-check` 和 `chat-native-visible-static`；`chat-desktop-gateway-e2e` 是 app-runtime gate，证明 desktop-rust messaging engine 的 E2EE direct-message 闭环；native multi-client gates 负责用户可见双客户端、multi-device、recovery 与 MLS 证据。

该 domain 的目标是反思并验证设计落地：acceptance 不能只覆盖管理面和 Federation，还必须能表达高频用户路径的事实源、传输面、可见面和未证明范围。

```text
model/domain/chat/** + apps/station/app/subserver/conversation/** + resource-owner services + apps/{desktop,mobile}/**messaging**
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
- Provisioner 从 Environment Contract 解析 client-to-service binding，并在
  Runtime Manifest 中发布同一组已验证 edge。
- 一个 Native Desktop runtime cell 运行多个隔离客户端，各客户端绑定不同 Station。
- Registry 为一个行为变更选择多个 Feature 和 receiver-proof Gates。

禁止：

- Gate 自行猜测 Profile、Station URL、actor PTID 或 credential。
- Gate 使用业务常量、裸 URL 环境变量、client 数组顺序或默认 Station 推断
  client-to-service binding。
- Environment Contract、Runtime Manifest 和 Gate report 分别维护三份客户端服务
  拓扑，或为迁移保留 compatibility alias / dual-read。
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
| Canonical result algebra | Acceptance Infra `core/result_contracts.py` | pure tuple/cell/matrix schema、validation与fold | Evidence Store I/O、finalizer lifecycle、重复实现 |
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

### 4.14 Post-Cleanup Evidence Finalizer所有权与失败语义

| 组件 | Owner | 允许职责 | 禁止职责 |
|---|---|---|---|
| Finalizer requirement | Mobile Capability Graph | 在`capabilities/mobile.yaml`独立声明Gate必须执行的finalizer ID | 依赖Gate Catalog字段存在性推断requirement |
| Gate Catalog finalizer config | 业务Gate contract | 提供与requirement匹配的ID和timeout | 声明optional fallback或动态argv |
| Evidence Store | Acceptance Infra | 跨进程seal role-instance inventory、产生snapshot digest、以同一snapshot finalize | 解释业务Artifact Role |
| Finalizer registration schema/resolver | Acceptance Infra | 解析并结构校验固定registration，不包含具体业务entry | 动态import任意用户输入、解释validator outcome |
| Concrete finalizer registration | Mobile Acceptance business | 在generated `tooling/acceptance/contracts/mobile/finalizers.yaml`中把reviewed ID绑定到fixed entrypoint/source paths；generic resolver构造canonical argv，protected baseline冻结digests | 修改Infra lifecycle、注入动态argv |
| Detached finalizer process | 业务contract owner | 对sealed snapshot执行纯验证并返回typed outcome | 接收Provisioner/secret/raw authority、写artifact、访问产品系统 |
| Acceptance Orchestrator | Acceptance Infra | identity preflight、bounded process lifecycle、output envelope validation、向Evidence Store提交primary result与outcome | import业务validator、自行merge或构造/publish manifest |
| Evidence Store finalization | Acceptance Infra | 验证snapshot/outcome identity、执行固定单调merge、构造immutable manifest并publish latest | 解释Mobile业务语义或接受未验证outcome |
| Mobile canonical contract | Mobile Acceptance business | 定义19-role、relation、cardinality和payload规则 | 执行cleanup、publish run或依赖Gate/Provisioner实例 |

任何required-finalizer mapping缺失、registration mismatch、snapshot identity不一致、process
timeout、malformed output、cross-run ArtifactRef或non-deterministic replay都属于
Acceptance finalization failure。它们可以阻止primary success被发布，但不能重分类或
覆盖已有primary failure。

---

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

## 9. 多服务客户端绑定架构质量门

- Environment Contract 可以声明两个以上同 kind service，且每个 required service
  都产生独立 source-bound attestation。
- 每个需要 Station 的 client 都通过 `service_bindings.station` 引用一个稳定
  service ID，并在 `required_service_roles` 中声明该 role；引用缺失、目标缺失
  或 kind mismatch 在启动客户端前 fail closed, using closed `ClientBindingError`
  codes with numeric values (`DANGLING_SERVICE_REF` 20102,
  `KIND_MISMATCH` 20103, `MISSING_REQUIRED_BINDING` 20104,
  `UNEXPECTED_BINDING_ROLE` 20105, `DUPLICATE_CLIENT_ID` 20101,
  `ENDPOINT_COPY_DETECTED` 20106);
  bare string errors are forbidden.
- Runtime Manifest 的 client binding 只能引用同一 manifest 的 services map，
  不复制 endpoint、deployment environment、commit 或 runtime identity。
- D-18 does not introduce a platform extension or new isolation attestation;
  existing D-13 Runtime Cell gates continue proving port, profile, storage,
  session, actor, and device isolation.
- Every client launch generation uses `create_bound_session`. Platform code
  reads observed identity from live client connection state and cannot echo
  Manifest or launch configuration. Runtime Binding allocates generation,
  binds each observation to a platform-neutral D-13 runtime-instance identity,
  and automatically contributes proof refs to Gate evidence. Core derives
  expected identity from each role's ServiceAttestation and requires exact
  coverage of every `(clientId, launchGeneration, requiredRole)` tuple before
  returning the session. Missing proof produces `BINDING_PROOF_ABSENT` (20201);
  mismatched identity produces `LAUNCH_IDENTITY_MISMATCH` (20202).
- Each Runtime Binding's launch-options schema is closed. Unknown keys,
  arbitrary environment maps, and fields carrying URL, host, port, service ID,
  deployment identity, commit, or runtime identity fail with
  `ENDPOINT_COPY_DETECTED` (20106).
- Domain fault injection may use only an opaque run-scoped
  `TransportOverrideHandle` created and applied by Runtime Binding. The handle
  cannot enter `service_bindings`, cannot expose its routable URL to Gate code,
  and cannot replace canonical binding proof. Run/client/role/service mismatch
  fails with `TRANSPORT_OVERRIDE_MISMATCH` (20107); Domain evidence proves
  proxy upstream identity, behavior, and cleanup.
- Gate 通过 client ID 和 binding role 解析服务，不读取 Mobile `CLIENT_SERVICE`
  常量、Federation authority/follower URL 变量或 Native runner 默认 Station。
- 同一 Linux runtime cell 可以运行多个隔离 Desktop client 并绑定不同 Station；
  现有 D-13 isolation gates 继续证明端口、profile、storage、session、actor 和
  device identity 不共享。
- Acceptance Infra owns the generic parser, validator, lookup helper, proof
  contract, and typed error codes. Each business Domain owns its own migration
  schedule and legacy-constant cleanup; Infra reports unmigrated private
  mappings as an Acceptance Gap but does not execute cross-Domain migration.
- Within each Domain, migration is atomic: contract declaration, producer,
  consumer, proof verifier, and legacy mapping deletion must switch in one
  change. Cross-Domain migration order is independent.
- 任一 service、client 或 binding 的 cleanup / attestation 不完整时，环境结果为
  `BLOCKED/UNPROVEN` 或 cleanup failure，不得降级成部分拓扑 proof。

## 10. Ephemeral Gate Launch Context 架构质量门

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

## 10. Post-Cleanup Evidence Finalizer架构质量门 (D-19 Accepted Target)

该质量门分成两个有序集合。`§10.1`只验证domain-neutral Acceptance Infra，属于独立
D-19 Infra plan的landing gate；不得依赖Mobile role、mapping、baseline或validator
证明Infra ready。`§10.2`只在Infra landing后由Mobile E2-5 amendment注入并验证业务
contract。两组都通过之前，D-19 capability不得宣称产品proof closure。

### 10.1 Generic Acceptance Infra landing gates

- Capability/Catalog validator拒绝缺失或不匹配的requirement/config、`required: false`、
  unknown finalizer ID、非法timeout和动态argv；generic protected-baseline schema、
  component path/digest和generated-registration consistency用domain-neutral fixture验证。
- synthetic run在全部cleanup、log与Infra artifact写入后，由bounded materializer在
  finalization lock内完成全部payload/hash/digest并一次seal；seal后的任意write、
  role-instance registration或inventory recollection，包括其它进程的writer，均返回typed
  conflict。
- sealed snapshot包含排序后的
  `roleName + discriminator + ArtifactRef + payloadDigest`；finalizer与manifest
  finalize观察同一snapshot digest。替换、删除、增加artifact、修改sealed
  role-instance inventory或
  注入cross-run reference都fail closed。
- stdin JSON payload具有snapshot-bound digest，child重算后才能消费。
- Finalizer outcome只含validated role-instance identifiers；payload/ref由Core从sealed
  snapshot投影，返回集合必须等于generated registration role names对应的完整snapshot集合；
  子集、payload mutation与oversized outcome均fail closed。
- detached synthetic finalizer证明输入不含Provisioner、credential、raw handle、
  launch context、artifact root、绝对路径或可写RunHandle；static dependency gate
  禁止Core/Runner导入业务规则。
- preflight失败不分配run；通过后run directory、active lock和immutable requirement
  record必须原子创建，故任一已分配required-finalizer run都可被orphan检测识别。
- finalizer executable artifact由preflight source capture在allocation时产生，包含
  bootstrap、validator、contract和schema；prepare/parse/expand受file count、path、
  manifest、single-entry、expanded-byte、temporary-storage和wall-time hard limits，
  stored bundle、执行副本和逐文件hash必须一致，invocation digest绑定全部bytes。
- source-capture closure必须同时包含固定Infra
  `finalization_contracts.py/finalizer_worker.py/finalization_supervisor.c` raw hashes
  与domain-neutral generated
  fixture source inventory；requirement record持久化capture ID/digest/bundle digest和
  每个component ArtifactRef。Historical reader必须从这些ArtifactRefs按
  `pt-finalizer-bundle-v1`重建exact source bundle并复验raw bundle hash，不能只信任
  recorded digest或重新读取worktree补齐。该Infra gate不得读取Mobile contract。
- `passed/DONE/PROVEN`、`passed/DONE/UNPROVEN`、
  `passed/PARTIAL/UNPROVEN`、failed、blocked primary result与全部finalizer outcome
  的merge matrix逐项验证；`dry-run`不创建reservation，非canonical tuple fail closed。
- hard limits固定为stdin 1 MiB、stdout/stderr各256 KiB；worker child在exec前安装的
  default-action `SIGALRM` self-timer和supervisor monotonic timeout共同覆盖hang、timeout、
  cancellation、malformed/oversized output和non-zero exit均执行
  bounded TERM/KILL/reap，并仍能finalize一个`PARTIAL/UNPROVEN` run；static/runtime
  gate证明trusted finalizer不创建descendant、network、signal override、native
  extension或product client。Parent `SIGKILL`加non-cooperative finalizer fixture必须
  证明已READY native supervisor在Core ceiling内终止并reap child。
- Session-level `SUPERVISOR_READY`只绑定session/runtime identity；每次worker
  `REQUEST_ACCEPTED`、`WORKER_ARMED`、post-exec `WORKER_READY`、payload、diagnostic、
  exit、timeout/cancel全部绑定唯一session/request/sequence/kind/payload digest；stale、duplicate、
  cross-kind和out-of-order frame均fail closed。`WORKER_READY`只使用embedded完整
  `WorkerRequestIdentity`，不携带第二个可漂移的request digest。
- request/result schema coverage test枚举全部worker kind及每个maintenance
  operation-specific matrix row，要求exact request payload、matching operation、
  completed/failed result和domain-separated digest均存在；cross-operation或缺少variant
  时schema gate失败。
- supervisor-frame tests枚举每个control-frame variant及legal sequence；unknown/
  cross-branch fields、wrong worker result、PID/PGID/timer mismatch、result-after-terminal
  stale/cross-request descriptor datagram、cancel mismatch和close-before-reap全部fail
  closed。Cross-language fixtures固定protocol version 1、
  4-byte big-endian length、2 MiB frame ceiling和64 KiB diagnostic chunk，并证明
  oversized declared length在body allocation前关闭channel。
- recursive closed-schema tests向requirement、baseline、source capture、snapshot、
  seal、finalization、enforcement、worker和abort各层注入unknown/duplicate/cross-branch
  field，全部必须在digest计算前fail closed。`CanonicalOpaqueJson`仅把canonical bytes
  视为opaque；其closed envelope和frozen schema仍必须验证。
- Preflight token绑定`supervisorSessionId + supervisorRuntimeDigest`；allocation在
  cleanup lock内通过同一process handle、control channel和liveness probe复验该session，
  supervisor死亡或替换不得使用旧token分配run。
- Maintenance response是按operation关闭的discriminated union；status、durable boundary、
  typed failure、continuation和operation-specific payload必须匹配十四个exhaustive
  concrete variants；`WRITE_ABORT_EVENT`只能写`AUTHORIZED`，tombstone/delete的terminal
  event由各自operation写入。Interlock/activation在durable transition前的invalid
  identity/request/state使用`REJECTED/NO_MUTATION`；`WRITE_ABORT_EVENT`使用
  `FAILED/NONE`或post-publication `FAILED/EVENT_MAY_BE_DURABLE`，后者只能通过fixed
  path exact-byte re-fsync恢复；已有authorization的tombstone failure保持
  `AUTHORIZATION_DURABLE`，rename后的failure保持`RUN_TOMBSTONED`；delete在batch-start
  前可`REJECTED/NO_MUTATION`，batch-start后必须以zero-delete或partial-delete
  `FAILED_EVENT_DURABLE`闭合。Retry先验证已报告的durable bytes/digest，不能依赖
  自由文本恢复进度。
- snapshot materialization在独立bounded worker中完成；regular-file read卡死不能
  无限持有runner active/finalization lock，unsupported hard-timeout host在preflight
  fail closed。
- finalizer timeout具有60秒Core ceiling；JSON materialization/stdin受1 MiB limit，
  binary evidence仅streaming hash并受artifact count、single-file、cumulative-byte和
  wall-time独立上限，不能把截图总量挤入stdin budget。
- strict outcome union拒绝互斥字段与status/code冲突；finalizer只执行一次，不重试。
- runner在Gate、cleanup、seal、finalizer、manifest和publish每个边界的crash fixture
  均不能产生权威success latest；unpointed candidate manifest不可作为proof或被repair
  发布。
- D-19-aware reader adversarial tests mutate requirement/config、snapshot、invocation,
  runtime/source and outcome digests plus published tuple fields; direct reads must mark them
  non-authoritative, latest resolution must reject them, and repair must never select a
  required-finalizer manifest.
- activation crash tests覆盖pending前、pending durable后、generation durable后、
  permanent sentinel durable后和current durable后；pending冻结captured prior pointer并构成authority cutoff，之后的
  legacy/prior-generation latest write不能卡死retry或进入current authority。
- authority-transition tests覆盖interlock install与generation activation的local
  controlling-TTY、real/effective UID、kernel-derived principal、accepted D-19
  document path/hash/source-commit、action-specific nullability、expected-state和
  challenge/authorization digest。Missing approval、non-accepted decision、hash/source
  mismatch、non-interactive call、principal/challenge mismatch及cross-action field
  injection都必须在首个durable write前得到`NO_MUTATION`；pending后retry只能复用原
  authorization bytes与principal。
- maintenance runtime substitution tests改变supervisor digest、worker source、
  Python executable、host/loader/images、stdlib/compiler、runtime capture或protocol
  version；authorization challenge、request digest与live READY任一不匹配都必须在
  mutation前失败。Historical fixture必须从authority-runtime refs重建bundle并重算
  capture/worker/maintenance digests。
- authority-runtime persistence tests cover pre-write rejection, partial/lost-ACK
  publication, exact-byte re-fsync and orphan-blob retention; no interlock,
  activation or abort mutation may start before `AUTHORITY_RUNTIME_DURABLE`.
- durability-profile tests cover Linux file/directory fsync, Darwin APFS
  file-fullfsync/directory-fsync/anchor-fullfsync ordering, unsupported
  filesystem and cross-device rejection, capability/profile drift, power-cut
  recovery and equal-byte full-backend replay.
- interlock installation tests覆盖expected legacy latest并发变化、conflicting existing
  marker、write后lost ACK/fsync ambiguity和exact-byte retry；closed maintenance union
  必须分别返回`NO_MUTATION`、`INTERLOCK_MAY_BE_DURABLE`与`INTERLOCK_DURABLE`。
  Existing equal bytes只有在marker file与directory重新fsync成功后才能返回durable。
- proof admission tests证明artifact CLI、planner/runner aggregate和readiness reporter
  只消费`AuthoritativeLatestResolution`；interlock存在后，legacy mode、bare manifest、
  raw latest和free-form legacy verifier output全部拒绝。
  `ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES`必须从同一clean HEAD确定性覆盖
  `tooling/acceptance/**`、`tooling/scripts/acceptance-*`、exact
  `quality-evidence.py`/`_acceptance_artifacts.py`及全部repository-local transitive
  imports and statically resolved subprocess/shell/Make/CI-local execution helpers；
  再对全部tracked source/configuration files执行language-neutral reverse
  caller/importer/includer fixed-point，间接Node/Rust/Go/Python/shell/Make/CI wrapper
  也必须进入digest。全仓scan发现unsupported grammar、unresolved dynamic edge或
  closure外claim consumer必须失败。Concurrent fixture证明coordinator epoch不是
  source-cutover后的fresh restart、registry非空或job未quiesce时interlock install为
  `NO_MUTATION`，且每个final sink在shared claim lock内emit前复验current authority。
  Crash-after-job-registration fixture proves the paused coordinator can publish
  exactly one `REAPED` completion only after the live lease is absent and exact
  PID/PGID/start identity group is dead through prior execution-environment
  termination; quiescence verifies one registration/completion for every sequence
  through the frozen pause boundary. Concurrent registration uses the permanent
  sequence lock and cannot allocate duplicate sequence values. Epoch/current/job/
  completion/emission-intent/emission-acknowledgement/pause/quiescence records all
  pass the selected durability backend and equal-byte retry re-sync. Sink
  fixtures cover crash before send, sink-accepted/lost ACK, conflicting payload,
  timeout and restart; only one idempotency key/payload side effect is accepted.
  并匹配interlock/current generation中的source digest；任一tracked/untracked
  worktree drift或outside-inventory import都在authorization前失败。Authority command
  必须以`python3 -I -S -E -B`启动fixed bootstrap；bootstrap在加入repo root前验证自身
  与worktree，再以AST解析fixed entrypoint的完整project import closure，拒绝dynamic
  import、`.pth`、native extension、site package及inventory外source；仅允许
  `tooling`和`tooling.acceptance`两个single-location namespace package，且其
  `__path__`必须分别精确等于verified repository中的对应directory。Runtime
  loaded-module probe复验stdlib/project origin和hash。Project modules由source-only
  loader从verified tracked `.py` bytes加载；任何repository `__pycache__`、`.pyc`或
  `.pyo`（包括ignored files）在import前使authorization失败。
- classifier fixtures覆盖extensionless interpreter target、conflicting incoming
  grammar assignments、opaque binary data和multi-level process wrappers；每个
  `ProofAdmissionSourceNode`的class/grammar/interpreter/sorted typed edges及digest必须
  精确一致。Fixtures exhaust the valid-pair/precedence table and reject a non-data
  edge whose assignment differs from its unique target node.
- claim-admission lifecycle fixtures reject every non-Python emitter and
  forbidden process API, reconstruct the closed scanner/rule/node artifact,
  bind the leaf-policy scan in the handshake, and prove that
  normal completion cannot be emitted until both waits are consumed, completion
  is durable and the idempotent sink acknowledgement is durable. An
  unscannable/dynamic process path requires full
  execution-environment termination rather than group-only proof. First-epoch
  Darwin fixtures require a durable prior observation and changed boot UUID/time;
  every later Darwin fixture requires another before/after reboot boundary. Linux
  fixtures bind namespace device/inode plus init PID/start/pidfd, init
  termination and the kernel kill-on-init-exit rule; no procfs census is
  accepted. Pre-allocation
  capability fixtures assert Linux host identity, flags zero, child PID/start,
  one pidfd lease, exact pre/post raw-mask projections, `POLLIN`, post-wait
  `POLLHUP`, zero error bits, `P_PIDFD/WEXITED`, exact `siPid`, closed status
  and consuming wait;
  mutation of any field fails. Positive Darwin/Linux job fixtures and
  cross-OS mutations cover epoch environment, job `hostOsFamily`, claim/wrapper
  process identities, scanner interpreter and wrapper runtime projections.
  Separate same-OS/different-host and same-host/different-boot mutations cover
  stable host identity across environment/job/scanner/wrapper projections and
  boot identity across the resolved epoch observation plus every process-start
  projection.
- trust-bootstrap fixtures prove the candidate cannot authorize normal evidence,
  witness authorization accepts only canonical P-256 and rejects Ed25519,
  malformed SEC1, high-S and cross-decoded credentials, promotion binds the
  exact qualification/backend, receipt and arm receipt are durable before
  mutation, raw release tokens are never persisted, and duplicate command IDs
  cannot execute twice. Production-signature fixtures independently reject
  malformed length, uppercase hex, non-canonical or small-order public keys/R,
  `S >= L`, wrong algorithm and witness-credential substitution for receipt,
  arm, execution, journal and runtime-epoch objects.
- trust-generation fixtures interrupt initial promotion, ACTIVE-to-ACTIVE
  rotation, REVOKED-to-ACTIVE rotation and ACTIVE-to-REVOKED revocation after
  reservation and every subsequent immutable publication and before/after
  current CAS. They require exact-byte reservation recovery and reject stale
  CAS, skipped/reused generation, predecessor mismatch, sibling successors,
  rollback, missing/corrupt/substituted reservation and incomplete history.
  A concurrent live-epoch dispatch fixture proves shared trust admission blocks
  exclusive revocation and that dispatch fails once current becomes REVOKED.
- controller-epoch fixtures cover lifetime ownership of the permanent
  close-on-exec lock, forbidden fork/dup inheritance, predecessor-current CAS,
  every signed-field mutation, old-process/new-epoch race, same-epoch lost ACK,
  exact qualified host/mount/lock-object equality, transition-versus-power-action
  separation, crash/lost-response before and after durable `ACTION_DISPATCHED`,
  typed rejection for every invalid current head/edge, prior terminal read-only
  lookup, and prior nonterminal rejection. Target durability and controller-store
  qualification each include same-OS/same-build/same-volume but different-host
  mutations, plus same-host/different-boot positive recovery cases.
- emission recovery fixtures mutate the frozen sink resolver source/backend,
  destination namespace, protocol, deadline and timestamp order; each mutation
  fails before delivery and restart never consults mutable runtime sink config.
- input-integrity fixtures mutate every duplicated invocation/context/snapshot
  field, `finalizerInputDigest`, `sealDigest` and child/Core outcome binding; each
  mutation fails closed.
- runtime-capture request schema tests覆盖每个`RuntimePathInput` kind的exact nullability，
  canonical absolute path、path hash、exact singleton/FILE-stdlib cardinality，并拒绝
  caller-supplied `LOADED_RUNTIME_IMAGE`、cross-kind fields和duplicate identity；
  loaded images只可来自worker loader enumeration。
- activation result-matrix test覆盖pre-pending active-run/limit/timeout/I/O
  `NO_MUTATION` rejection与每个post-pending durable failure boundary。
- `current.json` schema/digest/identity mutation及dangling generation tests全部fail
  closed；永久`activated.json` sentinel证明首次cutover已经发生，current丢失时不允许
  reader回退legacy或扫描generation目录猜测authority。
- required finalizer ID substitution tests必须覆盖interlock、intent、generation、
  sentinel和current；任一不一致fail closed。
- reader从finalization record（以及COMPLETED时的sealed marker）持久化的canonical
  pre-merge primary result重算digest和merge；不得从published merged result反推。
- historical protected-source verification只resolve immutable requirement-record
  ArtifactRefs和sealed executable bundle；current-worktree paths只允许activation/
  preflight读取。
- historical runtime verification从requirement record重算preflight/runtime capture
  digests，并resolve supervisor/Python/compiler/FILE-stdlib ArtifactRefs；不得构造
  pre-allocation run ref或借用host当前runtime。Loaded-image probe在preflight、
  business import后和exit前一致；standalone images持久化bytes，Darwin shared-cache
  images绑定cache/image/code-sign identity。Round-trip fixture从durable identity移除
  refs后必须逐字段还原preflight measurement和两个preflight digests。
- runtime-capture bundle round-trip fixture按
  `pt-finalizer-runtime-bundle-v1`重建magic、JCS manifest、ordered length-prefixed
  file bytes并复验raw bundle hash；不同serialization、ordering、length或file bytes
  必须fail closed。
- JCS gates拒绝unsafe JSON integers；native 64-bit device/inode使用canonical unsigned
  decimal strings。Snapshot使用`roleName + null/string tag + discriminator` total key，
  duplicate role-instance identity在digest前拒绝。
- latest publication tests覆盖first publish、identical lost-ACK、newer replacement和
  older superseded retry，证明immutable manifest使用no-replace而generation latest保持
  D-11有序atomic replace语义。Equal existing manifest、pending、generation、sentinel、
  current或其它durable predecessor必须重新fsync file与containing directory后才能推进。
- directory durability fixtures crash after tombstone-directory creation, rename, each
  rename-parent fsync, child unlink, root unlink and parent fsync. Retry must
  revalidate identity and re-fsync every affected surviving parent before creating
  a plan, advancing a batch or writing its terminal event.
- lock-order tests覆盖active owner、writer/seal/finalize、publish与retention/delete，
  证明无lock inversion；active run不得删除，普通retention/delete不得删除sealed
  incomplete run。`abort-sealed`是唯一删除入口，并验证active-lock后完整watchdog
  ceiling加5秒grace等待、append-only audit、atomic tombstone rename及每个删除crash
  边界。
- abort event publication必须通过temp write、file fsync、atomic no-replace publish
  和directory fsync；partial temp、rename后缺TOMBSTONED、partial recursive delete与
  malformed event均有fail-closed retry fixture；existing equal event也必须重新fsync
  file与directory后才允许后续mutation。
- `abort-sealed`只允许Evidence Store CLI在local controlling TTY完成影响面展示和
  exact challenge确认后授权；operator principal来自kernel effective UID，reason code
  是closed enum，retry必须匹配durable authorization identity。CLI通过同一
  source-only authority bootstrap执行，且authorization/request同时绑定clean source
  closure与full maintenance runtime。
- 每个delete batch必须在首个`unlinkat`前durably发布
  `DELETE_BATCH_STARTED`并绑定exact immutable plan range。Crash retry只有在该event
  仍是未闭合chain head时，才可把range内missing entry视为先前已授权删除；event缺失、
  range外missing或present identity mismatch都必须zero-mutation拒绝。
- abort-chain mutation tests要求每个event携带与`authorized.json`逐字节相等的
  `AbortEventAuthorizationProjection`和tombstone identity；只保持authorization ID/
  previous digest而替换operator、reason、workspace/run、snapshot、requirement或
  challenge必须fail closed。
- delete batch达到上限时，durable FAILED event必须保存domain-separated canonical
  continuation digest；
  下一request携带event digest/token恢复。Tombstone前在gate-scoped abort control
  namespace冻结bounded immutable deletion plan，使用专用`AbortControlArtifactRef`
  解析固定path；event以sequence/previous digest形成唯一线性chain，continuation使用plan index
  而非mutable directory offset。Response丢失从event恢复；
  `DELETE_BATCH_STARTED` durable后、terminal event前的crash重放该event绑定的range，
  并只在该range内幂等跳过已删除entry。
- 每个delete batch在mutation前通过validated gate-directory FD、anchored
  `openat2/openat`和`fstatat`验证整个batch的plan type/device/inode；fresh batch
  mismatch返回zero-delta `NO_MUTATION`。`DELETE_BATCH_STARTED` durable后的retry
  mismatch写zero-delete `FAILED_EVENT_DURABLE`，通过后只用retained parent FDs执行
  `unlinkat`；regular file额外比较byteLength并计入byte budget，directory
  `byteLength=null`且不比较会随child deletion变化的size。Traversal遇到symlink、
  socket、FIFO、device或其它类型整体fail closed，不得忽略或跟随。
  V1 destructive delete只支持Linux `RESOLVE_NO_XDEV`；Darwin/其它POSIX在
  authorization/rename/delete前由CLI返回
  `AbortSealedPreflightRejected(NO_MUTATION,
  ABORT_SEALED_DELETE_UNSUPPORTED)`，不得启动maintenance worker或用same-device
  heuristic替代mount identity。
  Explicit root entry必须作为plan最后一项并通过validated
  `aborted-runs` parent FD删除，不能作为隐式未授权步骤。
- root unlink后若terminal event失败，retry接受两种closed状态：outstanding
  `DELETE_BATCH_STARTED`仍覆盖root，或FAILED head的next index等于plan length且其
  previous started range覆盖root。前者以started event完成；后者使用
  `completionSource=TERMINAL_FAILED`、new attempt ID并直接引用FAILED head，不创建空
  batch。两者都先re-fsync `aborted-runs`再发布`DELETED`。
- corrupt requirement或seal无法建立abort identity时必须保留为quarantined forensic
  orphan；v1没有corrupt-record disposal reason，普通retention/delete不能接管。
- Runtime Manifest payload的workspace、Gate、provisioning run、source commit和
  workspace digest逐项匹配Store-owned `RunHandle.source`、sealed snapshot与
  FinalizerContext，且manifest ref属于snapshot。
- immutable finalizer executable ArtifactRef、entrypoint和reviewed
  module/contract/schema source digest及Python runtime identity进入invocation；
  finalizer不从运行中的worktree import。
- supervisor source、stdlib closure、compiler flags、descriptor owner/claim、
  worker request/result和role projection的nested digest均有独立domain与exact preimage。
- requirement与Catalog均未声明的existing Gate回归保持不变；任一侧单独缺失时不能
  发布`PROVEN`。

### 10.2 Downstream Mobile business-injection gates

- Real Mobile source-capture inventory必须包含generated registration中的business
  validator/contract/schema，并与fixed Infra bootstrap closure合并；每个raw hash、
  executable-inclusion bit和durable ArtifactRef逐项匹配。
- Generated finalizer registration role names必须由canonical Mobile contract机械生成并以projection digest
  同时绑定protected baseline与executable bundle；手工编辑或任一digest漂移fail closed。
- multi-instance role discriminator mutation测试覆盖每种role，证明discriminator、
  canonical path与payload identity必须一致。
- time-based validation只使用sealed `evaluationTime`，不读取current wall clock；
  全部19个role各有closed payload schema、semantic relation和空/mismatch负例。
- D-19 protected-source gate拒绝删除或修改
  `mobile-native-access-e2e -> mobile.native.oauth-final-roles` mapping，除非架构决策
  与baseline在同一变更更新。
- Mobile finalizer对sealed snapshot执行完整19-role、relation、cardinality和payload
  validation；删除旧`gates/mobile/proof_contracts.py`后，tree-wide import scan只指向
  neutral Mobile contract source.
