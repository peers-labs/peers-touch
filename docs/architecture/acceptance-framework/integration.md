# Acceptance Framework Core Runtime — 集成与迁移

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-08-15 | **Updated**: 2026-09-02

> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/core/`

---

## 1. 与现有模块的映射

### 1.1 现有代码迁移路径

| 当前位置 | 目标位置 | 迁移内容 |
|---------|---------|---------|
| `tooling/acceptance/drivers/tauri_webdriver.py` | `tooling/acceptance/drivers/tauri.py` | 重构 TauriDriver 继承 DomDriver；消费者迁移后删除旧入口 |
| `tooling/acceptance/drivers/__init__.py` | `tooling/acceptance/drivers/__init__.py` | 更新导出，保留旧 import 路径别名以兼容 |
| `tooling/acceptance/gates/chat/desktop_dom_message_visible.py` (L40-L41) `GateError` | `tooling/acceptance/core/errors.py` | GateError 统一到 core，各 Gate 导入使用 |
| `tooling/acceptance/gates/chat/desktop_dom_message_visible.py` (L93-L114) `async_harness` | `tooling/acceptance/core/harness.py` | 抽取通用 JS harness 桥接，支持命名空间 |
| `tooling/acceptance/gates/chat/desktop_dom_message_visible.py` (L193-L204) `copy_app_log/save_dom` | `tooling/acceptance/core/gate.py` AcceptanceGate 基类方法 | 证据保存统一到基类 |
| `tooling/acceptance/gates/dashboard/federation_visible_surface.py` (L51-L154) `CDPSession` | `tooling/acceptance/drivers/chrome.py` | WS5 将 Dashboard 消费者迁移到 Selenium ChromeDriver；完成前保留为未完成项，不声称已抽取 |
| `tooling/acceptance/gates/chat/desktop_dom_message_visible.py` (L44-L68) `gateway_command` | `tooling/acceptance/drivers/station.py` | 抽取 Station HTTP API 客户端 |
| `apps/desktop/src/acceptance/chatAcceptanceHarness.ts` | `apps/desktop/src/acceptance/chat/harness.ts` | Chat Harness 改为注册模式，迁移到子目录 |
| `apps/desktop/src/main.tsx` (L44-L48) 硬编码导入 | `apps/desktop/src/acceptance/registry.ts` 自动注册 | 通用 Harness 注册机制 |
| `tooling/scripts/applet-desktop-lifecycle-smoothness-gate.mjs` 等 | `tooling/acceptance/gates/applet/*.py` wrapper | Applet MJS 脚本通过 Python wrapper 接入 |

### 1.2 保持不变的部分

以下内容在本次重构中**完全保持不变**：
- `capabilities/*.yaml`、`domains/*.yaml`、`features/*.yaml` — YAML 契约层
- `registry.yaml`、`gates.yaml` — 路径映射和 Gate 目录
- `tooling/scripts/acceptance-*.py` — plan/run/validate/report 核心脚本
- Chat/Dashboard/Federation Gates 的业务逻辑
- 前端业务代码（runtime、service、store、components）
- 所有 Make targets 和对外命令行接口

### 1.3 Runtime Provisioning 目标映射

> 本节与后续 Runtime Provisioning 影响面由已接受的 D-07 ~ D-10 约束。

| 当前输入或行为 | 当前问题 | 目标 Owner | 目标 artifact |
|---|---|---|---|
| `gates.yaml.environment` | 只有标签，没有 acquisition contract | Acceptance Provisioning Registry | environment contract |
| active `.local` Profile | 文件名与内部 identity 可漂移 | Local Dev Environment | validated profile identity |
| `make station` / `station-status` | 能 ready/check，但不产出 Gate 可消费的完整 attestation | Station deployment/runtime | station attestation |
| `CHAT_NATIVE_*_PTID` | 由调用方手工提供 | Chat Fixture | actor manifest |
| `CHAT_NATIVE_DEMO_PASSWORD` | 来源未声明且 runner 有默认值 | approved credential source | credential reference |
| `CHAT_NATIVE_STATION_ATTESTATION` | runner 只消费，没有生产者 | Station deployment/runtime | source-bound attestation artifact |
| `CHAT_NATIVE_STATION_URL` | Profile 与 Gate 使用不同变量 | Environment Provisioner | runtime manifest station URL |
| Gateway/Native ports | runner 局部计算，缺少统一 preflight record | Environment Provisioner + Driver | client isolation manifest |
| Gate failure text log | 缺少 source-bound preflight identity | Provisioner/Gate Runner | structured blocked artifact |

目标集成入口：

```text
gates.yaml
  -> environment contract
  -> profile validation
  -> service ready + attestation
  -> fixture actor manifest + credential references
  -> runtime resource manifest
  -> existing Gate command
  -> existing evidence validation
  -> cleanup audit
```

现有 Gate command 和产品断言保持稳定；变更的是 Gate 之前和之后的 runtime
orchestration。业务 Gate 不获得部署权限，也不读取 `.local` 的实现细节。

### 1.4 Evidence Store 目标映射

> 本节由D-11约束。

| Current owner/path | Target owner/contract | Migration rule |
|---|---|---|
| `core/_paths.py::REPORTS_DIR` | `ArtifactRootResolver` | hard replace；禁止repo fallback |
| `core/evidence.py` direct write/copy | `EvidenceWriter` + `RunHandle` | atomic run-relative writes |
| `AcceptanceGate.report_path` | logical report role | allocator决定physical path |
| `acceptance-plan.py` latest plan | dedicated plan Gate run + latest pointer | self-check不得覆盖normal plan |
| `acceptance-run.py` logs/manifests/run | one orchestrator run manifest | child Gate refs normalized |
| `acceptance-validate.py` domain report | reader/writer API | Domain profile不保存physical path |
| coverage/report/quality scripts | `EvidenceReader.latest(...)` | CLI explicit input仍可用于fixtures |
| Native runners | run-scoped writer | no process-local repo paths |
| Make targets / review scripts | resolver CLI/API | output位置不硬编码 |
| Domain profiles/capabilities | logical report/gate identity | remove source-tree report values |
| `tooling/acceptance/reports/` | deleted runtime owner | tracked stale reports removed |
| intentional test data | `tooling/acceptance/tests/fixtures/` | only reviewed deterministic fixtures |

Source-artifact traceability迁移：

```text
old: "tooling/acceptance/reports/gate.json"
new: {
  "workspaceId": "...",
  "gateId": "...",
  "runId": "...",
  "path": "reports/gate.json",
  "sha256": "..."
}
```

Runtime report中对其它artifact的引用必须normalize为`ArtifactRef`。用于测试的CLI
`--input/--output`可接受explicit filesystem path，但default必须来自Evidence Store；
test-only path不能成为production fallback。

---

## 2. 影响面分析

### 2.1 受影响的现有代码

| 模块 | 改动程度 | 说明 |
|------|---------|------|
| `tooling/acceptance/gates/chat/*.py` | 中度重构 | 继承 AcceptanceGate，删除重复样板代码，业务逻辑不变 |
| `tooling/acceptance/gates/dashboard/*.py` | 中度重构 | 使用 ChromeDriver，删除自建 CDPSession，业务逻辑不变 |
| `tooling/acceptance/gates/desktop/gateway_smoke.py` | 中度重构 | 使用 StationDriver + ChromeDriver，删除手写 gateway_command 和 Tauri mock |
| `tooling/acceptance/drivers/tauri_webdriver.py` | 重命名+重构 | 已移动到 tauri.py 并删除旧入口 |
| `apps/desktop/src/acceptance/` | 重构 | 新增 registry.ts，chatAcceptanceHarness.ts 移动并改为注册模式 |
| `apps/desktop/src/main.tsx` | 小改 | 改为动态 import registry 而非硬编码 chat harness |
| `tooling/scripts/applet-*.mjs` | 小改 | 增加 `--json` 输出 flag，核心逻辑不变 |
| `tooling/scripts/acceptance-run.py` | 架构扩展 | 按 environment contract 调用 Provisioner，区分 blocked 与 product failure |
| `tooling/scripts/local-dev/profile.sh` | 小改 | 激活前校验文件名与 `PT_DEV_PROFILE`，输出 resolved identity |
| `tooling/scripts/local-dev/station-status.sh` / deployment tooling | 架构扩展 | 由实际运行时生产 Station attestation |
| `tooling/acceptance/fixtures/chat_native_reset.py` | 重构 | 产出 actor manifest，声明 reset target、初始状态和 teardown |
| `tooling/acceptance/registry.yaml` | 契约修正 | receipt 等 receiver-visible 路径选择 Native two-client Gate |
| `tooling/skills/pt-acceptance-gap-detector/` | 新增只读守卫 | 检测遗漏并分派，不实施修复 |
| `tooling/acceptance/core/_paths.py` | hard replace | 只保留repo/config paths；runtime artifact path迁入Evidence Store |
| `tooling/acceptance/core/evidence_store.py` | 新增唯一owner | root/run/ref/manifest/latest/cleanup |
| `tooling/scripts/acceptance-*.py` | 原子迁移 | defaults通过Evidence Store，explicit fixture paths保留 |
| Domain/capability/feature contracts | schema migration | physical report paths改为logical identities |
| Make/review/quality/skills/docs | consumer migration | 输出与读取命令解析canonical root |
| `tooling/acceptance/core/provisioning.py` | 架构扩展 | Runtime Cell contract、manifest、matrix identity、Environment client declaration、`ClientRuntime.service_bindings` 与 service reference validation |
| `tooling/acceptance/core/provisioner.py` | 架构扩展 | cell lease、transport lifecycle、disconnect/cancel cleanup |
| `tooling/acceptance/provisioners/mobile_native.py` | 去私有化迁移 | 使用通用 client contract，不再自行解析 raw `clients` |
| `tooling/acceptance/gates/mobile/proof_contracts.py` | 删除重复拓扑 | 删除 `CLIENT_SERVICE`，从 Runtime Manifest binding 解析 Station |
| `tooling/acceptance/gates/chat/federated_browser_prereq.py` | 删除重复拓扑 | authority/follower client 通过 service binding 解析，不再用裸 URL 表达拓扑 |
| Native Desktop Runtime Binding 与 Chat runner | 多服务扩展 | Runtime Binding 按 client ID 与 binding role 启动并验证 session；Chat runner 不再注入 Station URL |
| `tooling/acceptance/core/drivers/launcher.py` | 新增通用契约 | launcher metadata 与 start/stop/alive 资源所有权 |
| `tooling/acceptance/drivers/tauri.py` | 职责拆分 | 纯 W3C client 与 local/provisioned launcher 解耦，由 TauriSession 组合并支持 forwarded loopback endpoint |
| `tooling/acceptance/drivers/native/` | 新增平台注入 | macOS/Linux/Windows input、focus、window observation adapters |
| `tooling/acceptance/transports/ssh.py` | 新增通用 Infra | host verification、bounded command、port forwarding、cancel |
| `tooling/scripts/deploy/source-sync.sh` | 从现有 deploy 提取 | role-neutral Git object push/fetch、exact checkout 与 source lease |
| `tooling/acceptance/runtime-cells/*.yaml` | 新增平台注入 | 非敏感 cell capability contracts |
| `tooling/acceptance/provisioners/native_desktop_*.py` | 新增平台注入 | 各 Desktop OS 的 session/build/process/cleanup lifecycle |
| `tooling/scripts/acceptance-run.py` | 架构扩展 | Gate × cell expansion、per-cell result 与 aggregate proof |
| Native business runners | 依赖反转 | 删除平台 API，改为消费 `NativeDesktopAdapter` |


### 2.2 不受影响的代码

- Station Go 代码（`apps/station/`）
- Desktop Rust 代码（`apps/desktop/src-tauri/`）
- 所有 proto 定义和生成代码（`model/`）
- Applet 业务代码
- Chat 产品业务逻辑；本设计不修复 `DELIVERED` receipt
- Gate 产品成功标准；不得因 provisioning 改造而降低
- CI/CD 调用的 Make target 名称

### 2.3 必须删除或禁止保留的旧路径

- Native runner 的默认密码。
- Agent 手工拼接 PTID、Station attestation 和 Station URL 的操作惯例。
- Profile identity mismatch 仍可激活的 silent path。
- 失败后仅输出 connection refused 且没有 runtime identity 的 preflight path。
- Receipt 变更只选择 Gateway Gate、依赖 Agent 手工追加 Native Gate 的 path。
- `tooling/acceptance/reports/` runtime owner及其gitignore-only假设。
- `_paths.py`中`REPORTS_DIR`、`EVIDENCE_DIR`、`MANIFESTS_DIR` repo constants。
- Domain profiles和Capability truth source里的source-tree report paths。
- tracked historical runtime reports；不得迁为current product proof。

不得以兼容为名保留“旧环境变量直传”和“runtime manifest”两套并行真源。
Native Chat 目标态只认 provisioning artifact；credential value 仅按 manifest
中的 CredentialRef 在进程环境中解析。

Evidence Store迁移同样禁止dual-write、symlink compatibility、legacy resolver或
write failure后的source-tree fallback。

Native runtime cell 迁移禁止：

- 保留 Chat runner 内的 AppKit/CoreGraphics 分支并旁挂 Linux 分支；
- 把 Linux WebDriver DOM click 当成 X11 Native input；
- 将远端 embedded WebDriver 绑定到非 loopback address；
- 在 repository contract 中硬编码 host、username、password 或 key path；
- 使用其它平台 evidence 填充缺失 cell；
- SSH disconnect 后遗留 app、tunnel、port、storage 或 GUI lease。
- 通过 rsync/tar overlay 把 dirty 或 untracked source 注入最终 proof。
- Mobile `CLIENT_SERVICE`、Federation authority/follower URL map 与 Native runner
  default-Station 推断并存。
- client record 复制 Station endpoint、deployment、commit 或 attestation。
- Gate 从 Profile、环境变量、client/service 顺序或业务常量恢复缺失 binding。


---

## 3. 迁移策略

采用**增量迁移，每次重构后所有 Gates 必须保持 PASS**：

### Phase 1: Core 层创建 + TauriDriver 重构
1. 创建 `core/` 目录结构，实现 BaseDriver、AcceptanceGate、BaseFixture、Evidence Schema
2. 将 `tauri_webdriver.py` 重构为继承 DomDriver 的 `drivers/tauri.py`，迁移所有消费者后删除旧入口
3. 重构 Chat Gates 继承 AcceptanceGate，删除重复的 GateError/async_harness/save_dom
4. 运行所有 Chat Gates 验证 PASS：
   - `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-domain-validation`

### Phase 2: ChromeDriver + StationDriver + Dashboard/Desktop Gates
1. ChromeDriver 实现 DomDriver；StationDriver 只实现 BaseDriver 生命周期
2. 抽取 StationAPIDriver，实现 HTTP 调用封装
3. 重构 Dashboard federation_visible_surface 和 desktop gateway_smoke 使用新 Driver
4. 运行所有 Dashboard/Federation Gates 验证 PASS：
   - `make acceptance-station-dashboard-domain-validation`

### Phase 3: 前端 Harness Registry + Applet Wrapper
1. 实现前端 acceptance registry 机制
2. 迁移 Chat Harness 为注册模式，保持方法路径兼容
3. 为 Applet MJS 脚本创建 Python wrapper gates
4. 运行 Applet Gates 验证 PASS：
   - `make acceptance applet-domain-validation`（新增）

### Phase 4: Mobile Driver + 扩展
1. 实现 MobileTauriDriver（Android 优先）
2. 注册 Mobile domain 到 domains/index.yaml
3. 补充 Mobile 基础 smoke gate

---

## 4. 兼容性保证

- **Gate 命令行接口保持不变**：所有 `python3 tooling/acceptance/gates/<domain>/<scenario>.py` 继续工作
- **报告逻辑角色保持不变**：Gate/report IDs保持稳定，physical path迁到Evidence Store
- **Make targets 保持不变**：所有 `make acceptance-*` 命令继续工作
- **Driver 单一入口**：统一使用 `tooling.acceptance.drivers.tauri`；不保留兼容 re-export
- **Core Runtime 已合并基线**：原 Core Runtime 通用化不要求 capability/domain/feature/registry/gates 迁移

以上保证只适用于已合并的 Core Runtime 通用化。Runtime Provisioning 扩展的目标
兼容边界如下：

- Gate ID、产品断言和 report 主路径保持稳定。
- Make target 名称保持稳定，但其执行从“只跑命令”升级为“provision → run → cleanup”。
- `gates.yaml.environment` 从描述字段升级为必须可解析的 contract key。
- 旧 ad-hoc 环境变量不是长期公共 API；迁移后由 runtime manifest 取代。
- 缺少 provisioning artifact 时行为从文本失败升级为结构化 `BLOCKED/UNPROVEN`，
  不得伪装为 Gate 产品失败。

### Runtime Manifest Service Topology Hard Cut

所有 Runtime Manifest producer、consumer、validator、test 和 Gate helper 必须原子
迁移到 `services[service-id]`：

- Environment Contract 为每个 service role 声明 `kind`。
- Station 与 Relay runtime owner 产生 kind-aware attestation。
- Artifact 路径为
  `runtime/services/<service-id>/attestation.json`。
- Provisioner 在进入 `FIXTURE_READY` 前验证 required service ID 和 kind 闭包。
- 缺失、重复、kind mismatch 或 legacy 顶层 `station` 都 fail closed。

禁止 compatibility reader、dual-write period、按顺序选择第一台 Station，或由 Mobile
Gate 创建第二份业务 manifest。

### Client-To-Service Binding Hard Cut

D-18 在 D-17 services map 上增加 typed dependency edge，不增加第二份服务拓扑：

- Environment Contract 通用解析 client declarations 与 `service_bindings`。
  Client must explicitly declare `required_service_roles`; omission is invalid,
  and a service-independent client must declare an explicit empty list.
- D-18 adds only `id`, `required_service_roles`, and `service_bindings` to the
  existing `ClientRuntime`; D-13 continues to own platform allocation and
  isolation fields.
- `ClientRuntime.service_bindings[role]` 只保存 `service_id` 和
  `required_kind`。
- Provisioner 在启动客户端前验证 client ID 唯一、service 引用存在及 kind 一致,
  using closed `ClientBindingError` codes with numeric values and stage;
  bare string errors forbidden.
- Every initial launch and restart uses
  `create_bound_session(client_id, launch_options)`. Runtime Binding allocates
  the client's monotonic launch generation, resolves the service from the
  immutable manifest, launches the client, and reads observed identity for each
  required role from live client connection state. It binds observations to a
  platform-neutral identity backed by existing D-13 runtime identity, asks Core
  to persist one verified `BindingProofRecord` per role, and automatically
  contributes the proof refs to Gate evidence before returning the session.
  Gate code cannot supply generation, service URL, or service identity.
- `launch_options` is a closed typed contract owned by each Runtime Binding.
  Unknown fields, arbitrary environment maps, and topology-bearing values fail
  before launch with `ENDPOINT_COPY_DETECTED`.
- Existing Chat fault-replay paths migrate from extracting
  `RuntimeEndpoint.url` and calling `configure_station(...)` to opaque
  `TransportOverrideHandle` application through Runtime Binding. This is an
  atomic Chat Domain cutover: the proxy remains Domain-owned, its routable
  endpoint stays inside Runtime Binding, and proxy evidence continues proving
  upstream identity, fault behavior, and cleanup.
- Runtime Manifest consumer 使用唯一 lookup helper：
  `client ID -> binding role -> service ID -> ServiceAttestation`。
- 具体环境只注入稳定 service ID、profile/deployment reference、client role 和
  Fixture；host、port、commit 与 runtime identity 来自对应 service attestation。

**Migration ownership boundary** (Acceptance Infra responsibility firewall):

Acceptance Infra delivers:
- Generic binding parser, validator, and lookup helper in `core/provisioning.py`
- `BindingProofRecord` contract and closed `ClientBindingError` typed codes
- Core binding verifier that derives expected identity from ServiceAttestation

Each business Domain independently owns:
- Its own migration schedule (when to switch runners/gates to the generic helper)
- Deletion of its own legacy constants (`CLIENT_SERVICE`, authority/follower
  URLs, default-Station inference)
- Platform observation mechanism used by its Runtime Binding

**Intra-Domain atomic cutover gate**: Within each Domain, the following must
switch in one atomic change (same commit):
1. Environment Contract client `required_service_roles` and `service_bindings`
2. Runtime Binding switching to `create_bound_session`
3. All Gate consumers stopping topology injection and consuming bound sessions
4. Fault-injection consumers switching from routable proxy URLs to opaque
   `TransportOverrideHandle`
5. Deletion of the Domain's legacy private mapping constants
6. Removal of any fallback to old fields, Profile defaults, or array order

A partial migration must fail the Domain's structural gate. The execution plan
must inventory each Domain's consumers and define tree-wide zero-reference
checks for its legacy mappings; D-18 does not add a runtime enforcement mode.

Cross-Domain migration order is independent. Infra's obligation is that the
generic helper is available and correct before any Domain begins migration.

迁移后各 Domain 必须删除各自的遗留映射：

- Mobile Domain: `gates/mobile/proof_contracts.py::CLIENT_SERVICE`
- Federation Domain: Gate 用于表达 topology 的 authority/follower Station URL 读取
- Chat/Native Desktop Domain: runner 对所有 client 使用单个默认 Station 的假设
- 所有 Domain: 从旧字段、Profile 默认值或数组顺序恢复 binding 的兼容逻辑

该 hard cut 不改变 Chat、Mobile 或 Federation 产品断言。具体 `four`、`fiveArm`
拓扑与回执、恢复、故障注入场景属于业务 Domain injection，在独立执行计划中接入。


D-11 compatibility boundary：

- Gate IDs、Make target names、product assertions和proof semantics保持不变；
- `PT_ACCEPTANCE_ARTIFACT_ROOT`可选，local developer无需配置；
- CI必须override root并从该目录收集artifact；
- repository-relative runtime report paths不是public API，原子删除；
- explicit test fixture paths保留，但必须位于temporary directory或
  `tooling/acceptance/tests/fixtures/`；
- downstream consumer无法解析ArtifactRef时fail closed，不尝试旧路径。
