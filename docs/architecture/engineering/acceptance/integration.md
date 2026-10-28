# Acceptance Framework Core Runtime — 集成与迁移

> **Status**: active
> **Version**: v2.2
> **Created**: 2026-08-15 | **Updated**: 2026-10-16


> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/core/`

当前 [执行预算合同](execution-budget.md) 在既有 Runner 和
GateProcessLauncher 集成 scope、deadline、计时和停止记录。
YAML governance parser 使用 Node 的显式 `yaml` 依赖，
删除跨 Python 解析子进程；输入与 alias expansion 有界，失败不跳过 registry。
共享场景与具体资源迁移尚未发生，旧产品证明要求保持有效。
固定范围恢复和公共元数据消费同一 [执行合同](execution-budget.md)：
Runner 保留完整 required 范围及原 producer 引用，每个新请求有独立期限；
Planner、RunHandle、ArtifactSession 共享 Evidence Store 的类型化 JSON writer。
只允许真实 ArtifactRef / ExecutionGraph 公共结构，所有字符串继续秘密扫描，
所有 manifest inventory 继续逐项解析、校验身份和 hash。

CCU、Chat storage、Station Access lifecycle、Relay 与 X Config 的聚合证明
统一由 `station_access_evidence.py` 消费。生产者只从当前 Runner 注入的
`prerequisiteProofs` 和 `current_result_proof_envelope` 交集选取；禁止独立查询
latest 补齐缺失证明或替换原 run。业务聚合、Coverage、Gap、能力验证、前置依赖
和续跑统一调用 `core/proof.py::read_gate_proof`；由 Evidence Store 校验
完整 inventory、bytes 与 finalizer authority，由共享证真读取器比较原
manifest、当前 envelope、source、DONE/PROVEN、显式 cleanup、扫描、原报告
断言及请求的 Runtime Cell。报告保留原 manifest ArtifactRef。
同 Gate canonical JSON report 即使未被 sourceArtifact 绑定仍核验断言。
证据锁诊断由 Evidence Store 实际取得/释放调用写入当前 OperationObserver；
消费者不复制锁管理、延长期限或从锁样本推导业务进展。
缺失、冲突、损坏或来源变化仍为未证明。匹配 SHA 的本地快照可以聚合；
远端源码同步与 release owner 的 clean 限制不由此改变。
Session-class 的正式证明同样使用共享读取器；开发态只读取当前 envelope
引用的原 functional manifest 与完整 inventory，复验 source、result 和
cleanup，保持 `proofStatus=NOT_APPLICABLE`，禁止读取 latest 或转成正式证明。

E2E 准备由 `acceptance-run.py` 在冻结依赖图和读取当前源码之后、Evidence Store
及资源分配之前调用 `core/e2e_preflight.py::prepare_e2e`。原 Runner 的源码锁、
逐 Gate 准备及独立子入口再次复核同一选择。`AcceptanceGate` 在构造和执行
边界检查；构造 Gate 前就读取或准备资源的入口必须显式调用
`preflight_gate_entry`，Chat 的 `native_support.selected_native_runtime` 执行该检查。
Planner 和 Validator 共享声明检查，实际实现缺口由运行前检查报告。
宿主 Hook 保持 advisory，`make desktop` 不接入该准备阶段。
Development 的依赖引用保留 `developmentManifest`，正式模式保留 `runManifest`，
两者不能替代。具体引用结构与失败边界见 [E2E 合同](e2e-execution-hook.md)。

Station API AST 源码 Gate 使用具体 Go input Owner：实际 native Go 和
compiler/asm/link、解析后的标准库文件与安装 module、workspace 和生效配置
共同进入输入身份。命令与探针禁用持久配置、自动工具链下载、网络依赖解析及
CGO，验证编译缓存。未知 shim、外部 replacement、原生对象与产品装备不进入
该闭包。由调用方提供满足仓库版本的已安装工具链，Owner 不安装或切换。

Profile 到资源的解析由 `core/profile_bindings.py` 统一负责。显式
`SERVICE_ID=PROFILE` 覆盖环境服务声明的 `profile_ref: profile:<name>`；
同一种服务只有一个角色时使用当前 Machine Dev Profile。多个同类服务必须
显式绑定或由环境声明，禁止从角色顺序、URL 或客户端顺序推断拓扑。
注册表只按 Provisioner 支持的参数交付绑定；构造阶段不查询 Profile 或装备资源。
Provisioner 在所选 Gate 的资源准备阶段调用同一解析器，Mobile 的 Station 与
Relay 都从 reviewed Profile 投影到既有 endpoint/deployment refs。
`PROFILE` 的 Make 投影只核对当前绑定，不能改写目标或扩大 capability。

Station 装备由共享 `provisioners/station_equipment.py` 调用既有
`devctl station start --target-profile`。目标 Profile 在 Machine Dev 中解析，
活动绑定和 slot 不变；装备失败保留原部署日志和 typed code。Native/Mobile
不再把远端源码不匹配作为人工部署前置条件。装备先完成，随后取得持续
remote source lease 并重新执行健康、源码与协议 attestation；这避免嵌套
source-sync 重复取锁，也拒绝装备与验收间发生的部署竞态。
Current-Profile Native 使用同一装备入口，健康检查必须在持续租约内执行；
运行账号与客户端准备只能消费装备后的独立 attestation。
装备子进程只承担普通 Station readiness/deploy，不继承父验收的环境 ID、
运行 ID、Agent scenario control 或 external-runtime 参数。失败日志仍由
父装备 Owner 使用原验收上下文发布，保留相同 run、原错误码与 ArtifactRef。
Station 装备与 Desktop 构建保留原 `EphemeralLaunchCleanupFailed`，不能将其
转换为普通 `BlockedError`。Runner 分别记录 provisioning process 与已取得
Environment/Cell 资源的清理：后者成功不能覆盖前者失败。清理失败停止后续
Gate，独立于 `stop-on-failure`；仍执行剩余资源的反向清理并封存完整范围。

本地 Desktop 构建与 macOS Cell 使用实际 commit、workspace digest 和
canonical worktree hash。干净工作区记录 `clean`，开发态记录实际
`sha256:<digest>`；构建身份还绑定配置、工具链、外部输入和产物 hash。
构建前后、Cell 探针完成后、客户端启动和身份读回时必须复验同一快照，变化即拒绝。
本地 Runtime Binding 保存准备时的源码身份与产物 hash，禁止在读回时重新标记
当前源码为运行中的构建；Acceptance 客户端不搜索或启动未经构建 owner 验证的产物。
远端 `git-object-sync` 仍要求 clean checkout；本地快照不能证明未部署的
Station 改动，服务 attestation 与 protocol 校验仍由原生产者负责。
Chat Native 的本地候选包含 Station、Note service、model、Go SDK 或 Go workspace
未提交输入时，必须先取得对应部署证明，禁止沿用同 commit 的旧远端证明。
所有 Native Chat Runner 共用 `native_runtime_source_identity`，客户端快照匹配由
domain-neutral `core.runtime_cell.runtime_source_matches` 负责。
同一源码构建可供多个隔离客户端实例使用，实例隔离由进程、端口、设备与
storage identity 证明。恢复 Fixture 必须在运行内通过真实产品操作形成状态，
再执行故障、重启和 receiver readback；不依赖旧 worktree 或外部种子。
当前 Profile 的 Chat Provisioner 复用现有生产账号 registrar，为每个运行创建
独立账号；Fixture 只初始化这些新账号的头像和 contact/Federation context，
不重置既有 Station Actor。两个客户端共用 Desktop build owner 验证的同一产物，
由 Runtime Cell parent 装备并冻结 `source.canonicalRoot/binaryPath/binarySha256`。
child 从已传入的 Cell manifest 校验 Gate、lease、平台、input mode、源码快照、
工作区内可执行路径和实际 bytes；绑定构造完成前必须消费并冻结该凭据，
身份读回与客户端启动共用已验证状态。首次启动不能承担凭据准备，
启动前身份读取也不能触发编译；child 不调用 build owner。
分别在 run-owned ephemeral storage 中通过认证产生设备与密钥。`ephemeral` 表示
运行结束回收，不能在场景重启时删除。Station 保留新账号及 Authority 审计记录，
客户端会话、进程、端口和本地存储必须全部释放。
Submitted-command Gate 先暂停派发，再通过可见 composer 创建真实 pending command。
故障注入只对该精确 message/command 做事务内 `submitted` 状态转换，保持 bytes/hash、
lane checkpoint 和原身份。Gate 身份限定注入权限；外部装备布尔值不是执行前提。
真实 Native 重启后，两端必须保持设备身份并显示相同 message ID 与精确明文。
validator 独立复算准备、故障、重启与收敛次序、命令 hash 和 receiver-visible 结果。

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
| Native Desktop Station binding | `tooling/acceptance/drivers/tauri.py` | 通过 embedded WebView 的 Tauri IPC 调用 `station_*` commands，不经过 localhost HTTP gateway |
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
| `make station` / `station-status` | 能 ready/check，但不产出 Gate 可消费的完整 attestation | Station deployment/runtime | service-scoped Station attestation |
| `CHAT_NATIVE_*_PTID` | 由调用方手工提供 | Chat Fixture | actor manifest |
| `CHAT_NATIVE_DEMO_PASSWORD` | 来源未声明且 runner 有默认值 | approved credential source | credential reference |
| `CHAT_NATIVE_STATION_ATTESTATION` | runner 只消费，没有生产者 | Station deployment/runtime | source-bound service attestation artifact |
| `CHAT_NATIVE_STATION_URL` | Profile 与 Gate 使用不同变量 | Environment Provisioner | `runtime manifest.services.station.endpoint` |
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

### 1.5 Native Desktop Runtime Cell 目标映射

> 本节由 accepted D-13 ~ D-16 约束。

| 当前输入或行为 | 当前问题 | 目标 Owner | 目标 contract/artifact |
|---|---|---|---|
| `gates.yaml.environment` 单值 | 无法表达同一 Gate 的 macOS/Linux/Windows proof matrix | Acceptance Infra | optional `requiredRuntimeCells` schema + matrix result |
| `TauriDriver._launch_app()` | 本机 launch 与 W3C client 耦合 | Acceptance Infra | launcher-neutral `TauriDriver` |
| `127.0.0.1:<port>` | 默认等同 orchestrator localhost | Acceptance Infra | run-scoped endpoint/tunnel lease |
| macOS AppKit/CoreGraphics methods 位于 Chat runner | 平台机制污染业务 Gate | Desktop platform injection | `NativeDesktopAdapter` |
| 本机 development Gate 无条件激活 app 并发布 global HID | 抢占用户鼠标、键盘和 frontmost app | Desktop input policy | 默认 `semantic-nonintrusive`；隔离 cell 才允许 `exclusive-native-input` |
| 本机 `.local/acceptance/bin` | 无远端 source/binary identity | Desktop platform injection | source staging + binary attestation |
| `deploy.sh` 内嵌 source push/fetch | Git 增量同步能力与 Station/Relay role lifecycle 耦合 | Deployment/Acceptance Infra | role-neutral remote source-sync contract |
| 本机 process/storage cleanup | 无远端 crash/SSH disconnect 回收 | Acceptance Infra + cell injection | remote lease + TTL reaper + cleanup audit |
| 单个 Gate result | 无 runtime cell identity，可能跨平台冒充 | Acceptance Infra | `(gateId, cellId, sourceCommit)` result |

目标调用链：

```text
Gate Catalog
  -> Environment Contract
  -> required Runtime Cell Contract
  -> Runtime Cell lease
  -> incremental Git object sync + exact commit checkout
  -> exact-source remote build with persistent caches
  -> remote app + loopback embedded WebDriver
  -> run-scoped SSH tunnel
  -> local TauriDriver + remote NativeDesktopAdapter
  -> unchanged business Gate assertions
  -> local immutable Evidence Store
  -> remote reverse-order cleanup
```

平台 adapter mapping：

| Cell | WebView | Native input/window backend | Platform-only evidence |
|---|---|---|---|
| `desktop-macos-native` | WKWebView semantic input | AppKit/CoreGraphics exclusive input；独立资格的 process-scoped AX chooser | Spaces、frontmost PID、AX focus |
| `desktop-linux-native` | WebKitGTK | X11 XTest + EWMH | active window、stack/point owner、X11 focus |
| `desktop-windows-native` | WebView2 | Win32 `SendInput` + UI Automation | foreground HWND、process/window ownership |

Business Gate 只能依赖 adapter interface。平台实现不得 import Chat Gate，也不得改变
selector、actor journey、timeout budget 或 success assertion。

macOS 窗口状态、定位、激活和关闭由 Native adapter 通过
`AXUIElementCreateApplication(actorPid)` 直接访问进程的 Accessibility 对象；
focused-control observation 使用同一通道。不得以 System Events 的进程窗口缓存
判断窗口是否存在：同一 app binary 反复构建启动时，该缓存可能报告零窗口，而
直接 AX 和 CoreGraphics 均能观察到真实窗口。AX 消息超时最多 0.5 秒，
读取共享 1.5 秒预算，每个探测子进程仍限时 2 秒。只有只读请求的 `-25204`
消息失败可在剩余预算内重试；权限、无效对象与耗尽预算的错误保留为 Driver
failure，不能解释成已隐藏或失焦。OS mutation/action 不重试。
`drivers/native/macos_ax.py` 统一窗口探测、文件选择和面板按钮的读取策略；
每次完整树观察共用上述读取预算，并受原有 2 秒窗口、30 秒文件选择、10 秒
面板操作期限约束。只有可选属性的 unsupported/no-value 可表示缺值；
必需的 `AXWindows` 读取失败不能表示文件面板关闭。选择和按钮动作检查
AX 返回码，失败即终止，不再次执行可能已经生效的操作。
窗口选择优先 `AXMain`，激活后的 frontmost PID 必须等于 actor PID；
关闭使用该窗口的 `AXCloseButton`，不向全局发送关闭快捷键。
WebDriver channel ready 与 AX window ready 是独立条件。Runtime preflight 在
原有 30 秒窗口启动预算内等待直接 AX 返回非空的进程窗口列表，再执行定位；
成功读取的空列表表示尚未登记；不可恢复或耗尽读取预算的 AX 错误仍失败。

macOS exclusive runtime 保持 AppKit 的正常文档窗口层级；原生 Open/Save panel
使用系统默认层级。不得将主窗口提升到屏保层级或用更高层的 panel 补偿：
这会遮挡 `qlmanage` 和外部应用的普通文档窗口，改变真实文件动作的可见结果。
客户间切换由显式 activation 协调，文档交接保留 OS 的窗口排序。

`qlmanage -p` 的窗口由 CoreGraphics 报告，但该 CLI 进程不提供可用 AX 文档树。
系统预览 oracle 因此绑定 action-owned PID 与单一窗口几何，截取真实屏幕的标题
和正文区域，复用 Vision OCR 核对原文件名及 fixture 内容。捕获前后窗口身份必须
一致；标题被其他进程遮挡或窗口越出捕获显示器时拒绝证明。AX 或窗口标题元数据
不能替代实际文件名和正文像素。

本机开发默认调用链：

```text
Business Gate
  -> TauriSession semantic action
  -> embedded WebDriver loopback
  -> WKWebView evaluateJavaScript
  -> visible product result
```

该路径不得调用 `activate_process`、`CGEventPost` 或 always-on-top window level。
macOS chooser 调用链为 parent Cell 的真实 open/select/close/owned-stop qualification
→ 当前 Cell/source 绑定的 `nativeAdapter.fileChooser` → local Binding admission
→ shared picker 的可见触发器 → exact-PID AX selection → 原有 product/receiver oracle。
parent 与 picker 共用 Driver 的操作员采样。缺少或陈旧 descriptor 在触发面板前
fail closed，不能通过 Profile、平台名或输入 flag 推导资格。该能力不需要全局
激活、HID 或 clipboard，也不授予 physical input proof。
parent 与 picker 从 `NativeOperatorObservation.file_chooser` 消费同一次真实读取的
typed panel presence 与 operator identity。每个等待样本都对照同一 baseline；
任一 mismatch 保持失败，不等面板状态收敛后才检测。
macOS 的 operator-only/operator+panel/control/pointer 复用一个有界 native probe。
每次只启动一个受管子进程，其中独立读取两次稳定 focus；禁止持久 worker 或
缓存现场状态。focus 截止时间包含子进程初始化，保留原 1s 稳定、2s control、
3s observation 限制和原面板等待窗口。
Driver 的只读观测与选择复用同一个 AX 面板查找器。生命周期必须 absent →
present → absent；窗口/sheet 数量只是其它窗口诊断，不能替代面板观测。
需要未独立取得资格的 native file panel、permission sheet、physical hover/drag
或 native-focus proof 时，Gate 进入 `exclusive-native-input`；本地执行必须同时声明
`isolated-gui-session`，否则在 OS mutation 前 fail closed。

### 1.6 Linux Candidate Cell Preflight Baseline

Linux cell 必须通过以下 fail-closed preflight：

- x86_64 Linux host kernel 与 working container runtime；
- digest-pinned supported Linux userland image；
- cell userland 内具备 Tauri 当前锁定依赖所需的 WebKitGTK 4.1
  development/runtime packages；
- connected virtual or physical output、固定 geometry、persistent Xorg session；
- dedicated GUI identity、DBus session、keyring 与 user runtime directory；
- Node/pnpm、Rust/Cargo、Python 和 native build dependencies；
- SSH host-key pinning、loopback tunnel capability 与 passwordless non-interactive
  lifecycle commands；
- repository source staging、clean commit check、remote digest 与 binary SHA-256；
- 首次传输完整 Git objects、后续仅传缺失 objects；不得传输 `node_modules`、Cargo
  target 或完整 worktree；
- X11 XTest input、EWMH focus/window stack 与 desktop screenshot probes；
- remote process/port/storage/session lease cleanup。

候选机缺少任一项时输出 `ACCEPTANCE_GATE_BLOCKED_BY_ENVIRONMENT`。不得混装其它
发行版的软件包、回退 Xvfb、改用 browser shell 或省略 Native input proof。宿主
发行版不需要升级；host kernel、container image digest 与 cell userland 必须分别
attest。

### 1.7 Ephemeral Gate Launch Context 初始到目标映射（D-18落地前基线）

> 本节由accepted D-18约束。

| 初始输入或行为 | 初始问题 | 目标 Owner | 目标 contract |
|---|---|---|---|
| `EnvironmentProvisioner.provision()`只返回Runtime Manifest | process-local broker无法跨越Gate subprocess边界 | Acceptance Infra | optional `EphemeralGateLaunchContext` |
| `acceptance-run.py`使用`shell=True`执行command string | descriptor继承目标不精确，shell可能扩散authority | Acceptance Infra | context Gate使用validated argv + `shell=False` |
| Gate Catalog只有`command` string | 无法声明需要哪些ephemeral capability | Acceptance Infra schema + business entry | mutually-exclusive `argv`与`ephemeralCapabilities` |
| Gate通过constructor注入`device_broker` | CLI子进程无法获得parent Python object | business Provisioner + Core channel | registered capability handler + child client |
| Mobile broker持有raw device handle与correlation secret | 两者禁止序列化和持久化 | Mobile business injection | parent-only handler state |
| Runtime Manifest path通过environment传递 | 只适合非敏感durable artifact | Runtime Provisioning | 保持不变，不承载ephemeral authority |

目标调用链：

```text
Provisioner prepares durable resources
  -> writes immutable Runtime Manifest
  -> registers business capability handlers in in-memory launch context
  -> Core seals context to workspace/gate/evidence-run/provisioning-run
  -> Core starts anonymous broker channel
  -> runner uses Popen to launch exact Gate argv with one inherited child descriptor
  -> parent immediately closes its child endpoint copy
  -> Gate performs bound handshake and typed capability calls
  -> runner quiesces context
  -> runtime-cell cleanup -> Environment Provisioner cleanup
  -> runner closes context and verifies zeroization
```

业务迁移边界：

- Acceptance Infra只提供channel、identity、framing、timeout、dedupe、cancel和cleanup。
- Acceptance Infra扩展Gate Catalog validator以支持`argv`和
  `ephemeralCapabilities`；具体capability ID仍由业务Gate entry注入。
- Mobile Provisioner负责把现有device/provider/Station Fixture broker能力注册为
  typed handler；其operation和payload schema仍属于Mobile。
- device-bound Appium操作在parent handler内执行，只向Gate返回opaque session
  reference、脱敏结果或ArtifactRef；不得通过channel返回raw device identifier。
- quiesce失败时，仍可能被handler使用的device/account/browser resource必须
  quarantine，不得由cleanup错误地释放回共享pool。
- Mobile Gate只把`device_broker` constructor注入替换为Core child client adapter；
  产品variant、assertion和evidence语义不变。
- Current-Profile Chat Provisioner注册`chat.runtime-account-login`，在parent保留
  符合生产signup规则的run-generated密码。Handler只接受已绑定actor的现存Native
  WebDriver session，复验canonical Station后调用现有login harness；child只收到
  authentication结果。借用session不创建或删除session，secret不经channel输出，
  仍参与Evidence redaction且在context关闭时zeroize。Child消费typed client已投影的
  结果；两端首次认证完成即关闭channel，后续restart使用保留的产品session。
- Desktop build owner在Make导出的tool path前统一放置已选Python interpreter目录，
  去重后才计算environment identity；Python纳入tool identity。Make与Cell使用相同
  interpreter时复用同一源码构建，实际source/tool/config变化仍使receipt失效。
- Desktop build的成功frontend stage独立保留receipt，绑定完整candidate identity、
  非空且不含symlink的dist输出清单、逐文件hash及原producer耗时/日志。Rust失败
  不删除已成功stage；后续request只有复验相同输入和全部输出才attach复用。
  frontend失败、source drift或产物改变必须重建；最终binary仍由Cargo产生，并在
  source和frontend输出复查后原子发布完整receipt。阶段复用不扩大request预算，
  不发布失败binary，不把build checkpoint视作product或Gate PASS。
- 无launch context的现有Gate保持当前执行路径；不得为它们创建空context或隐式
  capability。

---

## 2. 影响面分析

### 2.1 受影响的现有代码

| 模块 | 改动程度 | 说明 |
|------|---------|------|
| `tooling/acceptance/gates/chat/*.py` | 中度重构 | 继承 AcceptanceGate，删除重复样板代码，业务逻辑不变 |
| `tooling/acceptance/gates/dashboard/*.py` | 中度重构 | 使用 ChromeDriver，删除自建 CDPSession，业务逻辑不变 |
| `tooling/acceptance/gates/desktop/primary_navigation_e2e.py` | 中度重构 | 使用 Native Tauri Driver，验证真实 Desktop 导航与生命周期 |
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
| `tooling/acceptance/core/result_contracts.py` | 新增neutral pure contract | 唯一拥有canonical result tuple、cell/matrix schema与fold；不得依赖Evidence Store/finalizer |
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
| `tooling/scripts/acceptance-run.py` | 架构扩展 | D-18 context seal/bind、argv spawn与context-first cleanup |
| `tooling/acceptance/core/launch_context.py` | 新增通用Infra | ephemeral capability registry、anonymous channel、typed client与生命周期 |
| `tooling/acceptance/core/provisioner.py` | 小幅接口扩展 | 可选创建launch context；默认无context，不改变已有Provisioner |

### 2.2 不受影响的代码

- Station Go 代码（`apps/station/`）
- Desktop Rust 代码（`apps/desktop/src-tauri/`）
- 所有 proto 定义和生成代码（`model/`）
- Applet 业务代码
- Chat 产品业务逻辑；本设计不修复 `DELIVERED` receipt
- Gate 产品成功标准；不得因 provisioning 改造而降低
- Chat actor journey、selector、message/attachment assertion 与 first-failed-boundary
  纪律
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

Ephemeral launch context迁移禁止：

- 将provider correlation key、raw device identifier、provider subject、token或
  broker endpoint写入Runtime Manifest、environment value、argv、filesystem、
  Evidence Store或日志；
- 以localhost/TCP/Unix pathname service替代anonymous inherited channel；
- Gate重新解析Profile、重新获取device/account/browser lease或创建第二个broker；
- 为兼容旧Gate同时保留constructor broker注入和channel broker两套authority；
- 携带context时继续使用`shell=True`，或允许Gate grandchild继承descriptor；
- transport不支持、handshake失败、timeout或cleanup失败时降级执行产品Gate。

---

## 3. 迁移策略

采用**增量迁移，每次重构后所有 Gates 必须保持 PASS**：

### Phase 1: Core 层创建 + TauriDriver 重构
1. 创建 `core/` 目录结构，实现 BaseDriver、AcceptanceGate、BaseFixture、Evidence Schema
2. 将 `tauri_webdriver.py` 重构为继承 DomDriver 的 `drivers/tauri.py`，迁移所有消费者后删除旧入口
3. 重构 Chat Gates 继承 AcceptanceGate，删除重复的 GateError/async_harness/save_dom
4. 运行所有 Chat Gates 验证 PASS：
   - `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-domain-validation`

### Phase 2: ChromeDriver + Native Tauri Driver + Dashboard/Native Desktop Gates
1. ChromeDriver 实现 Dashboard DomDriver；Native Desktop 通过 Tauri IPC 和 WebDriver 组合驱动
2. 抽取 StationAPIDriver，实现 HTTP 调用封装
3. 新增 Dashboard browser Gate 前先建立 owned Environment Contract 与 Provisioner；Desktop surface proof 迁移到 Native Tauri Driver
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
- `PT_ACCEPTANCE_ARTIFACT_ROOT`只作为CI和隔离测试override，local developer无需配置；
- local default由Machine Dev Control Plane统一解析为
  `~/.peers-touch/dev/acceptance`；
- legacy `~/Library/Application Support/PeersTouch/acceptance`只允许一次性迁移，
  不保留symlink、dual-write、dual-read或fallback；
- migration cutover要求当前Git worktree全集全部证明canonical resolver或先从Git
  worktree registry移除；旧root删除后，live registry和active docs同步删除legacy
  字段与迁移分支，不保留永久`legacy-removed`状态；
- CI必须override root并从该目录收集artifact；
- repository-relative runtime report paths不是public API，原子删除；
- explicit test fixture paths保留，但必须位于temporary directory或
  `tooling/acceptance/tests/fixtures/`；
- downstream consumer无法解析ArtifactRef时fail closed，不尝试旧路径。

D-18 compatibility boundary：

- 未声明ephemeral capability的Gate继续使用现有command路径；
- 声明capability的Gate必须原子迁移到child client，不保留旧constructor注入；
- Runtime Manifest schema和现有ArtifactRef不变；
- POSIX inherited descriptor是首个backend，不代表Windows支持；缺少安全backend时
  对应host保持`BLOCKED/UNPROVEN`；
- Gate ID、产品assertion、evidence role和现有cleanup resource identity保持稳定。

D-19 accepted target compatibility boundary：

- Mobile-owned `capabilities/mobile.yaml` protected required-finalizer mapping独立声明required
  finalizer并通过repository-relative `finalizerRegistry.path`与
  `finalizerRegistry.protectedBaseline`显式定位generated finalizer registration
  catalog和reviewed baseline；
  declaration还绑定baseline digest。Gate Catalog只声明ID与执行limit，不接受第二个
  `required`字段。Generic resolver不得接受CLI/environment/Gate覆盖。未迁移的Gate才
  允许required-finalizer mapping、registration-catalog pointer与Gate Catalog
  execution config同时缺省；
- required finalizer ID必须通过Capability-owned required-finalizer mapping、Gate
  Catalog execution config与generated finalizer registration catalog三方validation；
  任一missing/mismatch在publish前fail closed；
- D-19 Infra landing必须先把`CanonicalResultTuple`、`PlatformCellResult`、
  `PlatformMatrixResult`及唯一fold落到neutral pure `core/result_contracts.py`，再让
  `core/runtime_cell.py`的aggregate及每个nested cell只导入该真源：
  旧`proofStatus=PARTIAL|BLOCKED|FAILED`不得保留，
  completion与proof必须分别投影；在全部nested/aggregate source migration和回归测试
  完成前，platform matrix只属diagnostic，不能进入authoritative resolution；
- Evidence Store以bounded `activate_finalizer_enforcement()`和immutable generation
  records管理cutover；D-19-aware `begin_run`与activation共享gate cleanup lock。
  Mobile source cutover前先安装永久publication interlock；reader/writer只按durable
  interlock/pending/sentinel/current dispatch，不读取Capability Graph或worktree。
  D-19 Infra先把artifact CLI、planner/runner aggregate与readiness reporter全部切到
  closed `AuthoritativeLatestResolution`并冻结source inventory digest；interlock存在
  后legacy mode、bare manifest、raw latest和free-form legacy verifier output均不能
  进入project-owned proof claim。每个final claim sink从read到emit持有shared
  claim-admission lock并在emit前复验current authority；interlock/activation持有
  exclusive lock。首次install前，sole `ProofAdmissionCoordinator`必须重启claim
  execution environment、暂停新job并以PID/start/executable/source identity registry
  证明`activeJobs=()`；process-table inference不构成quiescence proof。Darwin/Linux
  environment identity是closed tagged union；每个job必须是
  `NO_CHILD_NO_SESSION_CHANGE_V1` trusted leaf emitter，完整source closure拒绝process
  creation、shell/process wrapper、`setsid`/`setpgid`、same-PID `exec*`、
  `spawn*`/`popen`、dynamic symbol resolution和native extension。V1仅允许source-only Python interpreted claim emitter，并持久化
  scanner source、exact rule registry、完整inspected source nodes与empty findings的
  closed `ForbiddenProcessApiScan`。Scanner entrypoint/source closure固定，emitter
  禁止import，只接收restricted builtin mapping与canonical-JSON facade，不暴露
  filesystem/import/dynamic-code/descriptor capability；digest-bound AST只允许
  direct `canonical_json.encode|decode` call-target形式的`Attribute`。Fixed
  non-claim wrapper独占lease FD，不向claim传递该FD或descriptor-control capability，
  只在private channel捕获output并consume leaf wait；coordinator consume wrapper wait、
  durability-profile sync immutable completion，再在publish lock内重解并逐字节匹配
  expected authority。随后先durable publish emission intent，再以deterministic key调用
  bounded idempotent sink；payload固定为base64-framed exact JCS
  `ClaimEmitterOutput` bytes及其raw SHA-256，收到并持久化stable acknowledgement后才视为external
  emission完成；lost ACK只能重放同一key/bytes。Linux另由epoch PID
  namespace约束。Normal completion要求leaf wait及empty exact group enumeration，
  process group本身不被视为descendant containment。首次Darwin epoch要求在claim
  consumer source cutover后、mandatory reboot前持久化boot observation，并由
  source/runtime-bound helper证明boot UUID/time均变化；每个后续Darwin epoch也必须
  由environment typed ref解析exact prior observation、绑定supervisor boot UUID，再
  通过新的before-observation、reboot与after-observation关闭，process absence或
  shutdown intent不能替代。首次Linux epoch使用独立legacy identity和
  同样的source-cutover后mandatory reboot boot-boundary proof；后续Linux epoch
  绑定PID-namespace device/inode与init PID/start；同host build/kernel必须在
  allocation前以sacrificial child证明`pidfd_open + waitid(P_PIDFD, WEXITED)`，
  并保存同一pidfd lease的pre/post raw poll masks；pre-wait必须有`POLLIN`、无
  `POLLHUP/POLLERR/POLLNVAL`，post-wait必须有`POLLHUP`且仍无error bits，所有
  derived flags都由raw mask精确计算；unsupported host fail closed；epoch supervisor在job release前
  打开pidfd，作为sole wait-capable parent、保持default `SIGCHLD`且禁止
  `SA_NOCLDWAIT`，持有同一non-transferable lease直至
  `POLLIN + waitid(P_PIDFD)`。Supervisor crash要求reboot-boundary recovery；
  graceful termination证明零存活process，不声称namespace pins已全部销毁；
  Inventory由fixed
  `ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES` rule覆盖同一commit中
  `tooling/acceptance/**`、`tooling/scripts/acceptance-*`、exact
  `quality-evidence.py`/`_acceptance_artifacts.py`与全部repository-local transitive
  imports及statically resolved subprocess/shell/Make/CI-local helpers；全仓
  tracked source/configuration files再执行language-neutral reverse
  caller/importer/includer fixed-point，间接Node/Rust/Go/Python/shell/Make/CI wrapper
  也进入digest；unsupported grammar、unresolved dynamic edge或closure外claim
  consumer拒绝，不由plan/caller选择。Classifier使用唯一ordered
  precedence/valid-pair table；每个non-data edge必须resolve唯一target node并与其
  grammar/interpreter pair逐项相等；
  Interlock install与generation activation都必须经过Evidence Store local interactive
  CLI授权：kernel-derived principal、controlling TTY、real/effective UID、
  `authoritySourceCommit`中的canonical accepted D-19 document path/raw hash、
  action-specific expected state和domain-separated challenge全部进入closed
  authorization。Source commit必须等于clean current HEAD，整个canonical worktree
  必须无tracked/untracked drift，isolated authority entrypoint不得加载
  ignored/untracked/dynamic source。Command以`python3 -I -S -E -B`运行fixed bootstrap；
  bootstrap在加入repo root前验证自身，再以AST import closure与runtime loaded-module
  probe拒绝site/native/inventory外dependency；只允许`tooling`和
  `tooling.acceptance`作为single-location repository namespace package；
  project module只由source-only loader读取verified tracked `.py` bytes，repository
  bytecode cache存在即fail closed；
  proof-admission及activation digests从同一commit
  重算，禁止stale approval与其它source inputs组合；任一失败
  在durable write前返回`NO_MUTATION`。Interlock与activation intent嵌入该authorization
  并由各自digest覆盖；authorization及每个maintenance request还绑定
  supervisor/worker/Python/stdlib `maintenanceRuntimeDigest`并与live READY逐项比较；
  power-controller trust使用独立two-phase local interactive protocol：phase one以
  同样的kernel principal、TTY、clean HEAD和canonical accepted-D-19 approval校验
  public material，只创建绑定`crashFixtureId + qualificationRunId`且one-shot consumed的
  non-authoritative candidate；bootstrap boot observation只绑定该finite context；
  phase two绑定successful manifest/backend并用该backend先发布predecessor-keyed
  immutable transition reservation（内含frozen promotion intent），再consume
  candidate并发布exact active anchor、immutable generation record与CAS current
  selector；revocation同样先reserve predecessor key，再发布intent/revocation/
  generation并CAS current。
  Requalification/key rotation从exact current digest发布predecessor-linked generation
  `N+1`；revocation发布immutable record并把current推进到不授权的`REVOKED`状态；
  rollback、stale CAS与sibling successor失败。Crash recovery只能完成frozen
  transition bytes。Normal expectation只接受current active anchor，
  fixture不能创建或替换authority；
  operator确认后先由`AUTHORITY_RUNTIME_PERSISTER`使用gate/temp FDs发布
  content-addressed runtime refs；只有`AUTHORITY_RUNTIME_DURABLE`允许继续interlock、
  activation或abort mutation；所有nested refs、persist request与外层authority/abort
  authorization ID必须相等。Final-path publish前I/O/timeout/worker-process失败返回
  `NO_MUTATION`；任一publish attempt后的同类failure或ACK不确定返回
  `AUTHORITY_RUNTIME_MAY_BE_DURABLE`与
  `FINALIZER_AUTHORITY_RUNTIME_IO_FAILED`，retry验证完整expected set并重放backend；
  每个transition绑定同一`ProofAuthorityDurabilityProfile`。Linux执行file/directory
  fsync；Darwin仅允许local APFS，并执行file `F_FULLFSYNC`、directory fsync及
  same-volume sync-anchor `F_FULLFSYNC`。Unsupported filesystem/primitive、
  cross-device state、profile drift或capability evidence缺失均在mutation前
  `NO_MUTATION`。Capability evidence通过fixed-path content-addressed refs解析
  closed manifest、每个interruption-point power-cut trace、recovery result和probe
  runtime。Profile只绑定reboot-stable volume identity；每次operation从opened FD派生
  live mount binding。Boot observation携带并复验profile/live mount，kernel helper
  entrypoint/source closure/runtime ref固定；每个power command的signed receipt与
  arm receipt在fixture mutation前独立持久化，signed append-only controller journal
  以hash-bound token执行
  `ACCEPTED -> ARMED -> EXECUTION_STARTED -> ACTION_DISPATCHED -> EXECUTED`
  一次性状态机；每个command
  使用独立lock与deterministic singleton head，controller restart使全部nonterminal
  prior-epoch command失效且不得resume/re-execute；permanent close-on-exec runtime
  lock由no-child controller单独持有整个epoch并在power action前复验；independently
  qualified controller backend/locality/contention/epoch lease必须匹配同一external
  controller host、完整live mount及实际opened `.runtime.lock` device/inode，且不得与
  interrupted target environment混同；`core/power_controller.py`唯一拥有external
  runtime/key/store/journal/actuator，该controller store在trust promotion前独立通过
  closed OS-specific physical power-loss durability profile；bootstrap candidate只携带
  finite prequalification store identity，qualification由无production authority的独立
  witness执行；其canonical P-256 key必须先由candidate-local immutable owner
  authorization限定为qualification-only，并签署case/run/environment-bound的
  phase-tagged before/interruption/after/recovery evidence；production controller
  只接受canonical Ed25519 credential，两个closed schema禁止cross-decode或key
  conversion，因此不依赖mutable global exclusion registry；witness authorization、
  candidate creation与promotion在Gate publish lock下按各自bootstrap/qualified
  durability boundary发布；case PASS只接受signed recovery中的
  observed state/hash；current-epoch
  duplicate可重放，prior terminal只read-only lookup，prior nonterminal拒绝；
  transition resolution携带exact target但始终禁止external action，只有独立
  `EXECUTE_POWER_ACTION`对current `EXECUTION_STARTED` head先durably claim
  `ACTION_DISPATCHED`，再由lock-owning in-process operation执行一次power；dispatch
  entry与head必须先完成qualified file/directory及Darwin anchor durability barriers；
  unheaded dispatch只允许原still-live call持有Core生成的non-serializable
  process-memory capability，并以exact request digest、expected head、command lock和
  process/epoch重算匹配persisted digest后adopt，随后继续其唯一一次actuator
  call；caller/later request不得获得该capability；process restart创建新epoch并拒绝
  prior nonterminal；durable dispatch uncertain retry与其它
  invalid current head/edge请求均typed reject；dispatch-state classification优先于
  stale-head，所有rejection绑定exact request operation/digest/epoch/expected identity；
  cancellation使用accepted-origin与armed-origin两个closed journal variant；
  physical/VM interruption使用disjoint controller-kind variants且三个receipt refs与
  domain digests、arm command/epoch/token identity逐项相等；bootstrap/active
  qualification分别使用`QUALIFICATION_BOOT_OBSERVATION`/`BOOT_OBSERVATION` refs；
  arm signature使用explicit domain-wrapped RFC 8785 UTF-8 bytes；
  Interlock install在publish lock内匹配exact expected legacy latest，并由closed
  maintenance result区分`NO_MUTATION`、`INTERLOCK_MAY_BE_DURABLE`与
  `INTERLOCK_DURABLE`；
  Activation在cleanup+publish locks内捕获prior pointer，冻结timestamp/source commit
  并把完整candidate enforcement record写入pending；该pending是不可逆authority cutoff，
  retry只能逐字节完成同一frozen intent。Interlock lost-ACK retry只接受原authorization
  和marker bytes，并在重新fsync marker file与directory后才报告durable；activation
  pending前失败重新授权，pending后retry必须由同一kernel
  principal重新确认原challenge，禁止替换authorization或rebase expected state。
  Equal existing pending/generation/sentinel/current/manifest也必须重新fsync file与
  containing directory后才能推进下一durable transition；
  Pending同时冻结canonical current pointer；
  reader验证其schema/digest并resolve exact immutable generation record。首次cutover
  还发布永久activation sentinel；sentinel存在而current缺失时fail closed。首个generation
  记录pending前legacy latest或null，后续generation记录pending前current generation
  latest，生效后都只作diagnostic。已加载legacy runner不受新锁控制但只能
  写非权威legacy namespace。D-19 publish/read改用
  `finalizer-enforcement/latest/<generation>.json`；legacy top-level或旧generation
  latest永不进入current-generation authority，后续accepted baseline变化创建新generation；
- Requirement按Gate ID唯一，不在Feature间复制。Mobile requirement绑定
  `mobile-native-access-e2e`，并由
  `tooling/acceptance/contracts/mobile/native_oauth.protected.json`冻结；删除/修改mapping必须经过新的
  architecture decision并更新reviewed baseline；
- activation/preflight读取current-worktree protected paths后，run allocation把
  canonical mapping和每个protected source exact bytes复制为immutable requirement-record
  ArtifactRefs；historical reader只消费这些refs和sealed executable bundle；
- finalizer在Gate、runtime-cell、Provisioner与launch-context cleanup以及全部Infra
  artifact写入和secret audit之后执行，但早于manifest finalize/publish；
- Evidence Store在跨进程finalization lock内先由bounded snapshot-materializer完成全部
  payload读取、hash与digest，再通过durable marker一次seal排序后的
  `roleName + discriminator + ArtifactRef + payloadDigest` snapshot；finalizer与
  manifest finalize必须消费同一snapshot digest，seal后禁止任何artifact/role write
  或snapshot mutation；
- finalizer运行在独立bounded进程，只接收typed identity、Runtime Manifest
  ArtifactRef、snapshot-bound bounded JSON payload、sealed refs/hash和frozen
  primary status/digest，只返回validated role-instance IDs，不接收完整primary result、
  Provisioner、authority、artifact root或绝对路径；
- `FinalizerInput`以`finalizerInputDigest`覆盖invocation/context/snapshot，所有重复
  enforcement/run/source/runtime/snapshot/primary字段必须逐项相等；child/Core outcome
  持久化同一digest；sealed marker的`sealDigest`覆盖包括`sealedAt`的完整对象；
- canonical pre-merge primary result只由parent持久化到sealed marker/finalization
  record，历史reader从该mapping重算digest和merge，不从published tuple反推；
- Runtime Manifest ref必须属于snapshot，其payload source identity必须与Store-owned
  `RunHandle.source`、snapshot和context逐项相等；
- preflight通过supervised `BUNDLE_PREPARER`一次捕获protected sources并绑定
  process-local capture；allocation只消费该capture一次，持久化包含Core bootstrap、
  validator、contract和schema的canonical executable bundle；prepare/parse/expand服从固定
  file-count、path、manifest、entry、expanded-byte、temporary-storage和wall-time
  hard limits。相同bytes写入Evidence Store并展开到owner-only temporary directory，
  ArtifactRef、bundle digest和逐文件hash必须相等；historical reader从persisted
  source ArtifactRefs按`pt-finalizer-bundle-v1`重建bundle并复验raw hash，不从运行中
  的worktree直接import；
- preflight用独立supervised `RUNTIME_CAPTURE`生成无run-ref measurement和process-local
  runtime capture；canonical `pt-finalizer-runtime-bundle-v1`以fixed magic、JCS
  manifest和ordered length-prefixed file bytes定义exact bundle hash。Allocation持久化
  supervisor/Python/compiler/FILE-stdlib refs后才构造final runtime identity，历史reader
  从这些refs重建bundle并复验hash，不读取host当前runtime。Caller只提供closed
  `RuntimeMeasurementBasis`与supervisor/Python/compiler/FILE-stdlib
  `RuntimePathInput`；basis绑定reviewed build/bootstrap/stdlib closure，loaded-image
  logical/origin identity由worker loader probe独占枚举；
- Infra bootstrap closure固定为pure `core/finalization_contracts.py`与
  `core/result_contracts.py`、isolated `core/finalizer_worker.py`及native
  `core/finalization_supervisor.c`；Mobile
  registration只列business sources，business finalizer不得transitively import
  Evidence Store；
- seal-time artifact materialization由Evidence Store-owned native setup在timer
  保护下按ArtifactRef打开regular-file FDs、关闭directory FD，再交给不加载domain code
  的generic parser完成；business finalizer不接收任何artifact FD。两段worker和
  finalizer都由run allocation前已完成`READY` handshake的native POSIX deadline
  supervisor执行，unsupported host fail closed；
- supervisor FD protocol按worker kind绑定ordered descriptor roles：
  maintenance/materializer各一个directory FD，bundle preparer两个固定顺序FD，
  runtime capture一个temporary-directory FD，finalizer零FD；每个claim绑定sender-side
  device/inode/type和logical owner digest，
  independent request-identity digest绑定kind/claims，receiver逐项`fstat`等值；
  count/order/object mismatch关闭全部duplicates并fail closed；
  materializer inventory使用closed `ArtifactMaterializationInput`显式绑定
  JSON/binary与schema identity，禁止Core从role name推断payload schema；
- stream channel只接受closed `SupervisorControlFrame` union，SCM_RIGHTS datagram只
  接受identity-correlated `DescriptorTransferFrame`；worker matrix精确绑定
  kind/request/results/descriptors，active cancel使用request/ack pair，frame
  identity/digest与legal sequence逐帧验证；`WORKER_READY`不携带第二个request digest；
- finalizer失败只能降低成功结果，不能覆盖已有primary failure或升级结果；
- pre-seal finalizer failure同样通过固定merge matrix处理：primary success降级，已有
  failed/blocked tuple、reason和source trace保持不变；
- preflight token绑定live supervisor session/runtime identity，allocation在cleanup lock
  内复验同一process handle、control channel与liveness；supervisor failure必须完成
  `FAILED -> CLOSING -> CLOSED`和reap后才允许降级publication；
- immutable manifest使用atomic no-replace；generation latest使用D-11 ordered atomic
  replace，旧candidate lost-ACK retry只能得到`SUPERSEDED`，不能覆盖新pointer；
- maintenance request/result由exhaustive operation-specific matrix绑定，任何
  cross-operation result在解释status前拒绝；durable boundary与continuation只按固定
  transition table推进；interlock install具有独立
  `NO_MUTATION / INTERLOCK_MAY_BE_DURABLE / INTERLOCK_DURABLE` result，invalid delete
  request/state使用
  zero-delta `NO_MUTATION` rejection；
- abort delete retry从durable FAILED event读取continuation digest/token；每个batch在
  首个delete前先durably写`DELETE_BATCH_STARTED`并绑定exact immutable plan range，
  event后、terminal前crash只可重放该range，且只有range内missing entry可视为先前
  authorized progress。Tombstone root是deletion plan的explicit final entry并由该range
  授权，不存在implicit root delete。Present entries必须同时匹配
  type/device/inode；regular file额外匹配byteLength并计入byte budget，directory
  byteLength必须为null。Symlink/socket/FIFO/device等其它type整体拒绝，不得省略。
  全部entry必须与tombstone root同device；v1 destructive delete只支持Linux
  `RESOLVE_NO_XDEV`。Darwin/其它POSIX在authorization/rename/delete前返回
  CLI-owned `AbortSealedPreflightRejected/NO_MUTATION`与
  `ABORT_SEALED_DELETE_UNSUPPORTED`，不启动maintenance worker，也不以`st_dev`
  近似mount identity。
  Existing equal event重新fsync file与directory后才能
  继续mutation。Tombstone rename retry重新验证directory identity并fsync source/
  destination parents；每个delete batch在terminal event前fsync全部modified surviving
  parents，root unlink后fsync`aborted-runs`。Corrupt requirement/seal保留为forensic orphan，v1不提供绕过identity
  proof的delete reason。Events以sequence/previous digest形成单一chain，continuation
  使用plan index而非mutable directory offset；plan由
  gate-scoped fixed-path `AbortControlArtifactRef`解析，不使用run ArtifactRef；
  每个event还携带从`authorized.json`逐字节复制的immutable
  `AbortEventAuthorizationProjection`；任一operator/reason/workspace/run/snapshot/
  requirement/challenge substitution都使chain失效；
- `abort-sealed` authorization只由local interactive Evidence Store CLI在影响面展示和
  controlling-TTY digest challenge后签发；kernel effective UID和closed reason code
  进入durable identity，retry必须精确匹配。Abort命令使用同一source-only authority
  bootstrap，并把clean source/claim closure和full maintenance runtime绑定进
  authorization及每个event；
- finalizer在当前live RunHandle中只执行一次；runner crash不续跑、不补写manifest、
  不恢复publish；unpointed manifest不是权威proof，普通retention/delete拒绝sealed
  incomplete run；唯一删除入口`abort-sealed`获取active lock后等待Core watchdog
  ceiling加5秒grace，持久化append-only authorization event，将run原子rename到
  `aborted-runs/` tombstone，再递归删除并写`DELETED/FAILED` event；所有阶段持有
  bounded gate-scoped abort lock，run-local locks只在run path仍存在时需要；
- Mobile在neutral business-contract module拥有冻结Artifact Role与validator；
  Provisioner、Gate和finalizer共同消费该唯一真源。该迁移属于post-acceptance Mobile
  E2-5 amendment，不属于D-19 Infra closure；旧Python module、JSON schema、tests、
  docs与全部imports在同一原子变更中切换并删除旧路径，不保留re-export；
- `tooling/acceptance/contracts/mobile/finalizers.yaml`由canonical Mobile contract确定性生成；CI
  byte-compare重生成结果，protected baseline绑定required mapping、registration、
  contract/schema与entrypoint digests，避免第二个可编辑role或mapping真源；
- Infra不包含Mobile role或业务断言，也不得direct-import Mobile validator。

## 7. Unified Client Aggregate Integration

UCA 的最终 aggregate 使用现有 Evidence Store latest manifest 与 Suite Runtime
contract，不新增第二套证据存储、结果 tuple 或 Provisioner。

```text
UCA child Gate
  -> immutable current-source run manifest
  -> optional suite-runtime artifact role
  -> unified-client-architecture-aggregate
  -> aggregate report + outcome-comparison SHA-256
```

集成约束：

- aggregate catalog entry 固定为 `environment: local`，不得声明
  `provisioner` 或 `requiredRuntimeCells`；
- aggregate 只运行 `check:native-platforms` 与 architecture registry validation
  两项 bounded source baseline；
- Android、iOS、Messaging 与 Secure Content runtime Gate 自己 provision 一次并
  产出 reusable Suite Runtime；aggregate 只读取其 immutable artifact；
- Messaging/Secure Content owner-zero Gate 作为独立 child manifest 消费；
- outcome comparison 的计划区受 frozen Plan digest 保护；实际结果只在 UCA-08
  根据 current-source 证据回填，aggregate 记录完整文件 SHA-256；
- 尚未实现的 Gate 先指向统一 fail-closed entry；对应 owner Task 必须原子替换
  catalog command、实现和证据合同，不能把 placeholder 成功化。
