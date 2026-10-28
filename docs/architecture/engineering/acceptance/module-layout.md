# Acceptance Framework — 模块目录结构

> **Status**: active
> **Version**: v2.4
> **Created**: 2026-08-15 | **Updated**: 2026-10-26


> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 当前目录树

> Runtime Provisioning 相关的 `core/provisioning.py`、`environments/`、
> `provisioners/` 和 Actor Fixture 由已接受的 D-07 ~ D-10 约束。

```
tooling/acceptance/
├── core/                           # 通用核心抽象（domain-neutral）
│   ├── __init__.py
│   ├── gate.py                     # AcceptanceGate 基类
│   ├── execution_budget.py         # 范围冻结、阶段deadline、成本和停止投影
│   ├── scope_ownership.py          # 所选Catalog的Capability/Feature/Registry/Domain归属闭包
│   ├── execution_graph.py          # 显式证明依赖、唯一生产者、原始manifest验证与效率投影
│   ├── e2e_preflight.py            # 只读Journey/实现引用、依赖/生命周期检查及独立入口复核
│   ├── execution_session.py        # 固定完整范围、有界请求、清理后续跑或归因修复
│   ├── execution_identity.py       # 闭合输入、只读Owner探测、环境约束和逐Gate身份
│   ├── input_artifacts.py          # 装备后捕获原始引用、inventory核验与续跑原始上下文
│   ├── operation_observer.py       # 有界存活/锁诊断、安全stderr心跳与observer退出
│   ├── evidence.py                 # Evidence Schema + 报告工具
│   ├── proof.py                    # 唯一证真读取：原报告断言、源码、清理、扫描与authority
│   ├── evidence_store.py           # [D-11] 唯一root/run/ref/manifest/latest/cleanup owner
│   ├── errors.py                   # GateError 统一异常
│   ├── resource_diagnostic.py      # Owner 的不可变资源检查与缺项状态
│   ├── redaction.py                # 结构化报告和文本证据统一脱敏
│   ├── harness.py                  # 通用 JS harness 桥接 helper
│   ├── provisioning.py             # Environment contract、runtime manifest 与生命周期接口
│   ├── provisioner.py              # EnvironmentProvisioner 生命周期与 fail-closed 公共逻辑
│   ├── profile_bindings.py         # reviewed Profile 到声明 service role 的唯一解析
│   ├── lease.py                    # OS/source lease、连接 owner 和逐操作远端锁检查
│   ├── launch_context.py           # [D-18] ephemeral capability channel与child launch binding
│   ├── bounded_http.py             # monotonic deadline与byte-bound HTTP response reader
│   ├── result_contracts.py          # shared pure canonical result tuple/cell/matrix algebra
│   ├── finalization_contracts.py   # [D-19] pure wire types、closed unions与digest functions
│   ├── evidence_finalization.py    # [D-19] supervisor/worker lifecycle coordinator
│   ├── authority_cli_bootstrap.py  # [D-19] isolated authority command verifier/loader
│   ├── power_controller.py         # [D-19] external controller runtime, durable journal, key custody and actuator owner
│   ├── trust_admission.py          # [D-19] shared-lock ACTIVE trust dispatch mediator
│   ├── proof_admission.py          # [D-19] claim envelope、job registry、epoch/quiescence owner
│   ├── finalizer_worker.py         # [D-19] isolated Python worker bootstrap
│   ├── finalization_supervisor.c   # [D-19] POSIX hard-deadline worker supervisor
│   ├── runtime_cell.py              # [D-13] Cell contract/manifest/matrix/lease与纯源码快照匹配
│   ├── source_sync.py               # Reviewed central transport resolver and exact Git sync
│   ├── suite_runtime.py             # [D-21] Suite lifecycle/reuse ledger and report validation
│   ├── attestation.py              # Station deployment/runtime attestation producer
│   ├── drivers/
│   │   ├── __init__.py
│   │   ├── base.py                 # BaseDriver 生命周期 + DomDriver DOM 能力
│   │   └── launcher.py             # App launcher metadata 与资源生命周期契约
│   └── fixtures/
│       ├── __init__.py
│       └── base.py                 # BaseFixture 抽象基类
├── input_owners/                   # 具体Gate输入闭包，由对应Owner提供
│   ├── source_toolchain.py         # 源码检查的工具/安装依赖/临时fixture身份
│   ├── node_toolchain.py           # 实际Node安装与显式传递依赖身份
│   ├── pnpm_toolchain.py           # 唯一pnpm安装入口、实际版本委派和完整包身份
│   ├── pnpm_project.py             # 实际项目平铺安装路径、内容与依赖链接；无build资格
│   ├── pnpm_observation.cjs        # 不替换spawn的父子CLI退出观察
│   ├── pnpm_launchers.py           # 已审查Node启动器与实际搜索根；无tool/build资格
│   ├── pnpm_launcher_observation.cjs # 真实bin的pre-tool环境观察后退出
│   ├── pnpm_tool_execution.py      # 原环境版本负载的实际模块/原生库；无完整tool/build资格
│   ├── node_execution_observation.cjs # 原解析/加载/dlopen、缓存状态及有界完整输出
│   ├── node_async_execution_observation.mjs # 公共异步hook原样委派；复用唯一字节/输出Owner
│   ├── rust_toolchain.py           # 实际rustup编译器安装与唯一Cargo配置include图
│   ├── native_toolchain.py         # 实际dyld进程image、C工具链与完整macOS SDK
│   ├── machine_dev_toolchain.py    # MachineDev自检与Runner回归的工具和端口输入
│   ├── metadata_toolchain.py       # Architecture pnpm/Cargo metadata实际输入
│   ├── workflow_toolchain.py       # 完整workflow检查的metadata/Perl/夹具输入
│   ├── prerequisite_toolchain.py   # 七个聚合command的原producer引用与安装输入
│   ├── go_source_toolchain.py      # Station AST Gate实际Go安装及离线依赖输入
│   ├── pnpm_metadata.cjs           # 实际pnpm进程退出时的模块与image观察
│   ├── installed_inputs.py         # 实际工具、Python安装与链接边界
│   └── observation_trace.py        # 复用通用observer观察只读Owner内部阶段
├── drivers/                        # 具体 Driver 实现
│   ├── __init__.py
│   ├── tauri.py                    # launcher-neutral embedded WebDriver client
│   ├── native/
│   │   ├── __init__.py
│   │   ├── base.py                 # NativeDesktopAdapter contract
│   │   ├── macos.py                # AppKit/CoreGraphics/Accessibility
│   │   ├── linux_x11.py            # X11 XTest/EWMH
│   │   └── windows.py              # Win32 SendInput/UI Automation
│   └── chrome.py                   # Selenium Chrome driver + CDP command bridge
├── transports/
│   ├── __init__.py
│   └── ssh.py                      # verified host、owned connection、bounded command、tunnel、cancel
├── fixtures/                       # 具体 Fixture 实现
│   ├── chat_native_reset.py        # Chat 环境重置
│   └── chat_native_actors.py       # Chat account/PTID actor manifest producer
├── environments/                   # 非 local Gate 的机器可读 provisioning contracts
│   ├── native-tauri-embedded-webdriver.yaml
│   └── home-station.yaml
├── runtime-cells/                  # Desktop platform capability contracts
│   ├── desktop-macos-native.yaml
│   ├── desktop-linux-native.yaml
│   └── desktop-windows-native.yaml
├── images/
│   └── desktop-linux/
│       ├── Containerfile           # Supported WebKitGTK 4.1 userland
│       ├── entrypoint.sh           # Xorg/WM/DBus/keyring/app supervisor
│       ├── remote_control.py       # run lease, TTL reaper and forced cleanup
│       └── xorg-dummy.conf         # fixed connected 1920x1080 output
├── provisioners/                   # 环境生命周期实现，不承载产品断言
│   ├── station_equipment.py        # 隔离部署子环境；父证据保留原run；随后由原owner租约/验签
│   ├── __init__.py
│   ├── home_station.py
│   ├── native_desktop_macos.py
│   ├── desktop_acceptance_build.py # 本地精确源码构建、完整性校验及覆盖提交/成功观察的同一期限
│   ├── local_tunnel_supervisor.py # bounded local SSH-forward ownership
│   ├── remote_source_identity.py  # SSH-backed deployment source identity adapter
│   ├── native_desktop_linux.py
│   └── native_desktop_windows.py
├── finalizers/
│   └── registry.py                 # domain-neutral registration schema/resolver
├── behavior-rules/
│   └── chat-receipts.yaml          # receiver-visible receipt/badge Gate 选择
├── gates/                          # 各域 Gate 实现（Core evidence lifecycle）
│   ├── chat/
│   │   ├── desktop_dom_message_visible.py
│   │   ├── native_two_client_runner.py
│   │   ├── native_visible_e2e.py
│   │   ├── group_pressure_security.py
│   │   ├── private_pressure_security.py
│   │   ├── group_admin_e2e.py
│   │   └── ...
│   ├── desktop/
│   │   └── primary_navigation_e2e.py           # Native Tauri navigation Gate
│   └── applet/                       # Applet MJS wrapper gates
│       ├── __init__.py
│       ├── lifecycle_smoothness.py
│       └── ...
├── capabilities/                   # 保持不变：能力定义 YAML
│   ├── core.yaml
│   ├── chat.yaml
│   ├── federation.yaml
│   ├── station-dashboard.yaml
│   └── applet.yaml
├── domains/                        # 保持不变：域 profile YAML
│   ├── index.yaml
│   ├── chat.yaml
│   ├── federation.yaml
│   ├── station-dashboard.yaml
│   └── applet.yaml
├── features/                       # 保持不变：feature contract YAML
│   └── *.yaml
├── templates/                      # 保持不变：onboarding 模板
│   ├── domain.yaml
│   ├── capability.yaml
│   └── feature.yaml
├── plans/                          # 保持不变：plan JSON
├── playbooks/                      # 保持不变：操作手册
├── evidence/                       # 保持不变：历史证据存档
├── tests/
│   └── fixtures/                   # reviewed deterministic fixtures only
├── gates.yaml                      # 保持不变：Gate catalog
├── registry.yaml                   # 保持不变：路径影响映射
├── desktop-performance-cohort.json # 保持不变：性能测试 cohort
└── README.md                       # 更新文档
```

## 文件职责

| 路径 | 职责 |
|------|------|
| `core/gate.py` | AcceptanceGate 抽象基类，统一 execute() 入口、异常捕获、自动证据保存、报告输出 |
| `core/evidence.py` | Evidence Schema 定义、证据文件路径管理、JSON 报告写入 |
| `core/evidence_store.py` | 解析artifact root、独占atomic run allocation、验证闭合 ArtifactRef 与完整 inventory、类型化公共元数据/JSON writer、atomic write、artifact seal、manifest finalize/latest、closed authoritative-resolution envelope、active lock与cleanup |
| `core/errors.py` | GateError 统一异常，其他通用异常类型 |
| `core/redaction.py` | 敏感字段、Bearer token、private key 和文本证据统一脱敏 |
| `core/execution_graph.py` | 唯一显式依赖编译器、闭合 ExecutionGraph 和原 producer 证明关系 |
| `core/execution_session.py` | 固定 required 范围、有界请求账本、恢复/修复状态和原始证明引用 |
| `core/execution_budget.py` | Request/owner/退出 deadline、取消和实际成本；不生产产品证明 |
| `core/scope_ownership.py` | 读取所选Catalog的完整领域归属合同；保留共享Owner与未解析引用，不按名称猜测 |
| `core/execution_identity.py` | 闭合 executionInputs、实际子环境、有限只读Owner探测与逐Gate身份；保留类型化探测/清理失败、原始诊断、有界输出和原有阶段尾部；不制造业务输入值 |
| `core/input_artifacts.py` | 既有装备成功后捕获同run原始Environment/Runtime Cell与依赖引用；核验完整inventory、identity和hash；清理后及续跑只读原始上下文，不装备或寻找替代latest |
| `station_access_evidence.py` | CCU/Storage/Station Access/Relay/X Config统一聚合读取器；消费Runner原依赖ArtifactRefs及当前proof envelope，校验完整inventory、source、sealed result、cleanup、扫描与请求Runtime Cell；禁止latest替换 |
| `input_owners/source_toolchain.py` | 逐项资格化的local源码Owner工具与显式安装依赖摘要；拒绝Provisioner、Runtime Cell、ephemeral和活态输入 |
| `input_owners/node_toolchain.py` | 具体Node源码Owner：实际native Node、动态库、显式import origin及解析出的包/传递依赖内容；拒绝未闭合loader配置、native addon及其它工具链 |
| `input_owners/pnpm_toolchain.py` | 唯一已安装pnpm入口和版本委派观察；绑定父子package全字节、实际链接、Node和Mach-O依赖、可选cache缺失；预先拒绝缺失委派，不安装工具，不单独资格化Gate/build/live输入 |
| `input_owners/pnpm_project.py` | 实际CLI直接依赖和平铺路径、完整安装包字节、逐级依赖链接及optional缺失、原生库和exec环境；workspace生成输出及bin启动器继续未资格化，不注入Gate或grant build复用 |
| `input_owners/pnpm_observation.cjs` | 同一CLI与真实版本子进程的只读preload；保留实际选择/spawn/output，报告实际模块、动态库、解释器及cache状态 |
| `input_owners/pnpm_launchers.py` | 实际bin模板/manifest/入口、Node和shell工具、注入NODE_PATH及global lookup名字/链接/缺失；不遍历未选择package，不资格化工具执行或构建 |
| `input_owners/pnpm_tool_execution.py` | 原pnpm启动链下版本负载的实际CJS/ESM/原生加载、文件字节及加载后状态、缓存状态、退出码、PID/thread和JSON原生平台序列；唯一原子分片消费方核验完整字节及身份，拒绝缺片、重复和改写；生命周期和异步loader缺口拒绝资格，native-load采样不替代exit，不注入Gate或资格化完整工具/缓存/构建 |
| `input_owners/node_execution_observation.cjs` | 唯一实际解析/失败、加载字节、状态与原子输出Owner；绑定内部loader真实父入口，保留注册/初始化未闭合样本；普通Worker使用同步hook，内部loader使用公共异步delegate逐解析/加载样本且不装同步hook；原注册参数、返回format/source/null、缓存和退出不变 |
| `input_owners/node_async_execution_observation.mjs` | 唯一公共异步resolve/load适配器；await真实delegate并返回同一结果或重抛同一错误，库存/字节/漂移/输出规则由统一观察器拥有；单解析事件绑定原条件/父URL/结果URL或错误码；注册/终止/编译/缓存来源保持未闭合，不授予build或Gate资格 |
| `input_owners/pnpm_launcher_observation.cjs` | 只在声明的实际bin入口记录真实环境和Node image，然后在工具代码执行前退出；不提供tool/product proof |
| `input_owners/machine_dev_toolchain.py` | MachineDev原完整自检及其Runner回归的实际Node/Python/Git/进程工具、临时父目录和原API端口状态闭包；不读Profile、不持有监听socket、不资格化产品装备 |
| `input_owners/metadata_toolchain.py` | 仅Architecture registry的pnpm workspace/Cargo no-deps metadata闭包；绑定安装代码、实际delegate/image、配置/include图、当前与临时fixture父目录选择和解析结果；不资格化build或活态输入 |
| `input_owners/workflow_toolchain.py` | 完整workflow Node/Plan/skill-check的实际工具闭包；复用metadata Owner，另绑定真实Perl checksum模块/XS、shell utilities、临时父目录/Git模板；不资格化Profile或产品装备 |
| `input_owners/prerequisite_toolchain.py` | 七个已注册本地聚合command的真实Python/sh安装与原producer输入；从原input-artifacts复验完整引用、inventory、source、proof与cleanup，禁止替代latest；不资格化生产者运行时或产品行为 |
| `input_owners/go_source_toolchain.py` | Station API AST command的真实Go/compiler/asm/link、逐包stdlib与安装module字节、配置和workspace输入；离线且禁止自动工具链下载/CGO，拒绝shim、外部replacement和活态输入 |
| `input_owners/pnpm_metadata.cjs` | 同一实际pnpm Node delegate的退出观察；不改写stdout，返回实际模块、加载动态库和解释器，编译缓存必须禁用 |
| `input_owners/installed_inputs.py` | 具体源码Owner的Python安装、实际native executable和非系统动态库输入；目录递归携带已解析父路径，仅解析符号链接，保留全部当前字节/模式/bytecode摘要；未知delegate和外部安装链接拒绝资格 |
| `input_owners/observation_trace.py` | 只读Owner的内部阶段到既有OperationObserver的薄绑定；不拥有deadline、装备、输入身份或产品证明 |
| `core/operation_observer.py` | 有界 START/HEARTBEAT/END、非阻塞流背压、worker 停止与取得阶段绑定的锁诊断；不生产业务进展 |
| `core/harness.py` | async_harness 通用 JS 桥接，支持命名空间调用 |
| `core/provisioning.py` | 定义 EnvironmentProvisioner 生命周期、typed service topology、client-to-service bindings、Runtime Resource Manifest、blocked artifact 和 cleanup result |
| `core/provisioner.py` | 解析并验证worktree Profile、管理Provisioner状态和reverse-order cleanup；D-19后不持有或执行business finalizer |
| `core/profile_bindings.py` | 解析显式 service Profile、环境 profile_ref 与唯一角色的 active Profile；禁止猜测多服务拓扑，不获取资源或制造业务身份 |
| `provisioners/__init__.py` | 仅分派已选择的适配器；公共 factory 唯一校验 Station/Service Profile 别名重叠角色的冲突，shared constructor 合并无冲突角色，不比较整张映射或在注册时解析、获取环境 |
| `core/launch_context.py` | 定义不可持久化launch context、capability registry、anonymous channel backend、child binding、framing与cleanup |
| `core/bounded_http.py` | 以mandatory byte limit和monotonic deadline读取urllib response；无法控制底层socket deadline时fail closed |
| `core/result_contracts.py` | 定义无I/O、无Evidence Store依赖的`CanonicalResultTuple`、`PlatformCellResult`、`PlatformMatrixResult`及唯一fold；供Runtime Cell与D-19共同使用 |
| `core/execution_plan.py` | 解析正式Execution Plan的worktree绑定、current closure与Acceptance Execution合同；不持久化第二套计划状态 |
| `core/finalization_contracts.py` | **D-19 / pure**：定义requirement/config、worker wire schemas、closed unions、canonical digest functions与merge truth table；不得import Evidence Store或执行I/O |
| `core/evidence_finalization.py` | **D-19**：协调preflight source capture、supervisor/worker lifecycle、one-shot invocation与abort maintenance；只通过Evidence Store public API请求allocation/seal/finalize，不拥有run allocation或merge/publish |
| `core/authority_cli_bootstrap.py` | **D-19**：以`-I -S -E -B`启动；仅用stdlib验证自身、clean HEAD、canonical approval与`ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES` import/process closure，再以source-only loader加载tracked authority modules；同时提供独立的two-phase public power-controller trust enrollment authority commands |
| `core/power_controller.py` | **D-19**：repo-owned external power-controller runtime；唯一拥有controller key custody、independently qualified local journal store、runtime epoch/lease、command state machine与in-process actuator dispatch；不得运行在被中断target上 |
| `core/trust_admission.py` | **D-19**：Acceptance Infra-owned read-only mediator；以shared Gate publish lock解析ACTIVE trust current并向同进程controller调用签发不可序列化`TrustDispatchLease`，不拥有key、journal或actuator |
| `core/proof_admission.py` | **D-19**：唯一claim-admission coordinator；拥有shared/exclusive lock、job identity registry、execution-environment epoch、quiescence record与authoritative envelope emission |
| `core/finalizer_worker.py` | **D-19**：`-I -S -E -B` isolated worker bootstrap，验证request/runtime/bundle/FD identity后分派fixed worker kind，包括authority-runtime persistence；不得持有Evidence Store API |
| `core/finalization_supervisor.c` | **D-19**：在spawn Python worker前解除signal mask、安装default-action real-time timer，并在runner EOF/timeout时kill/reap worker group |
| `core/runtime_cell.py` | Runtime Cell manifest、lease state与typed validation，包括独立 closed chooser descriptor；不观察平台 UI 或制造 product PASS；只消费canonical matrix contract |
| `provisioners/mobile_runtime_cell.py` | Mobile-owned attach-only projection of existing physical Provisioner build/device authority; no additional device lease or cleanup owner |
| `core/source_sync.py::resolve_central_environment` | Single reviewed env-repository central transport selection shared by deploy CLI and remote Desktop cells; no `.local/deploy/git-server.env` fallback |
| `core/suite_runtime.py` | **D-21** domain-neutral `runtimeReuse` contract、Suite lifecycle ledger、reuse metrics、report digest与fail-closed validation；不启动资源、不包含业务Scenario或断言 |
| `core/attestation.py` | 从 live Station 和 deployment worktree 生产 commit/workspace/proto attestation |
| `core/drivers/base.py` | BaseDriver 定义生命周期；DomDriver 定义 DOM/JS/截图能力 |
| `core/drivers/launcher.py` | 定义 launcher metadata、start/stop/alive 资源所有权契约 |
| `core/fixtures/base.py` | BaseFixture 抽象基类，定义 setup/teardown/reset 接口 |
| `drivers/tauri.py` | 纯 W3C client、local/provisioned launcher、TauriSession 与 non-intrusive semantic actions；只连接 local 或 forwarded loopback endpoint |
| `drivers/native/base.py` | Native input mode、isolation admission、focus、window stack、point ownership、screenshot 与不可重置 operator observation contract |
| `drivers/native/macos.py` | AppKit/CoreGraphics/Accessibility adapter；唯一 operator sampling 与 exact-PID AX chooser owner；共享 AX reader 区分可选缺失与真实失败、保留状态并释放 CF 值，全部 operator 属性消费原始焦点 deadline；Home 仅匹配 sidebar 的 AXStaticText；只读 panel presence 与选择共用 AX finder；global input 只允许 explicit exclusive mode |
| `drivers/native/runtime.py` | 从同一 prepared Cell 消费 current-source chooser 资格；不根据平台名或 flag 推断 capability |
| `provisioners/native_desktop_macos.py` | parent 装备当前 binary 并执行真实 chooser qualification，owned stop 后投影 descriptor；不重复实现 operator sampling |
| `gates/chat/native_file_picker.py` | 共用可见 trigger/native-panel selection；单一 selector 实现，保留原有业务与接收端 oracle；不提供 capability 或恢复 semantic operator focus |
| `drivers/native/linux_x11.py` | X11 XTest/EWMH adapter |
| `drivers/native/windows.py` | Win32 SendInput/UI Automation adapter |
| `transports/ssh.py` | SSH host-key verification、bounded command、run-scoped port forward、cancel 与 teardown |
| `provisioners/remote_source_identity.py` | 通过 strict-known-host SSH 读取 remote Git commit/workspace/proto identity，并作为显式 provider 注入 Core attestation |
| `tooling/scripts/deploy/source-sync.sh` | Station/Relay/Desktop 共用的 role-neutral incremental Git source sync |
| `drivers/chrome.py` | Selenium Chrome/Chromium headless 驱动，支持 CDP command bridge；Dashboard 消费迁移由 WS5 完成 |
| `environments/*.yaml` | 把 Gate environment id 映射为 Profile、service、Fixture、credential reference、attestation 和 cleanup contract |
| `runtime-cells/*.yaml` | 声明 Desktop OS、display、WebView、native adapter、source identity 与 cleanup capability |
| `images/desktop-linux/` | Linux cell 的 digest-pinned userland 与独立 Xorg desktop lifecycle |
| `provisioners/*.py` | 执行环境contract、生成runtime manifest并完成cleanup；不得持有或调用business finalizer |
| `finalizers/registry.py` | **D-19 / Acceptance Infra**：提供domain-neutral registration schema/resolver，验证fixed entrypoint并构造canonical argv；不持有具体业务entry |
| `fixtures/chat_native_actors.py` | 发现/准备测试账号并产出 role、account reference、canonical PTID，不写入凭据值 |
| `gates/<domain>/*.py` | 各域验收场景实现；通过 AcceptanceGate（包括共享基类）或直接 source-bound ArtifactSession 使用 Core evidence lifecycle，只包含业务编排逻辑 |
| `tooling/scripts/acceptance-run.py` | **D-19/D-21 owner**：调用时序owner；验证required declaration、seal artifact、bounded启动detached finalizer并把typed outcome提交给Evidence Store；以显式policy区分non-publishing Development与formal Acceptance，并支持single-Gate preallocated run ID |
| `tooling/scripts/execution-plan.py` | 校验当前worktree唯一active plan及merge前closure完成状态 |

Python Gate 入口的 I1 校验解析 AST 和仓库内 import，不以字符串或未使用的
import 判断继承。共享基类必须实际追溯到 Core AcceptanceGate，并由入口
调用 execute；直接使用 ArtifactSession 的聚合 producer 必须绑定同函数读取的
source_identity，在 with 生命周期中写入 artifact 并 complete。该结构检查不替代
Runner 对实际 source、manifest、hash、proof、cleanup 和 finalizer 的验证。
plans 下的 Gate 集合引用 Catalog ID，只保留集合自己的 timeout_seconds 和
required_by；command、environment、依赖和 executionInputs 的唯一真源为 gates.yaml。

`power_controller.py`当前提供controller store/journal/lifecycle的source-check
实现和qualification-only P-256 witness signer/verifier。Pure witness
authorization/identity contracts由`finalization_contracts.py`拥有；P-256
on-curve schema validation不引入I/O或runtime SDK依赖。Production Ed25519
strict point/scalar admission复用pinned PyNaCl/libsodium，signature verification
复用现有cryptography；P-256 verification复用cryptography。Pinned dependencies
位于`tooling/acceptance/requirements.txt`。完整qualified host/store/lease、
receipt/recovery closure和authority CLI尚未完成，source-check结果不授予实际
power action资格。

## 依赖关系

`ExecutionRequestClaim` 由 Evidence Store 复用现有 OS file lock 和 durable
no-replace writer 实现。它只持有 worktree-local 请求序号与 terminal manifest，
不授予产品资源权限，不写入 evidence inventory。Runner 在锁后复读 Session、
源码和当前合同，完成实际 handle cleanup 后才登记该请求 terminal manifest。

```
core/gate.py → core/evidence.py → core/errors.py
core/evidence.py → core/evidence_store.py → core/errors.py + core/redaction.py
core/execution_session.py → core/execution_budget.py + core/evidence_store.py
core/provisioning.py → core/errors.py + core/redaction.py
core/provisioner.py → core/provisioning.py + core/launch_context.py
core/launch_context.py → core/errors.py
provisioners/mobile_native.py + gates/mobile/simulator_e2e.py → core/bounded_http.py
core/result_contracts.py → core/errors.py
core/finalization_contracts.py → core/result_contracts.py
core/evidence_store.py → core/result_contracts.py + core/finalization_contracts.py
core/evidence_finalization.py → core/result_contracts.py + core/finalization_contracts.py + core/evidence_store.py + core/errors.py
core/authority_cli_bootstrap.py → verified stdlib only, then allowlisted tracked authority modules
core/trust_admission.py → core/evidence_store.py + core/finalization_contracts.py + core/errors.py
core/power_controller.py → core/trust_admission.py + core/finalization_contracts.py + core/errors.py + reviewed OS cryptography/filesystem/process APIs
core/proof_admission.py → core/evidence_store.py + core/finalization_contracts.py
core/finalizer_worker.py → core/result_contracts.py + core/finalization_contracts.py
core/runtime_cell.py → core/result_contracts.py + core/errors.py + core/redaction.py
core/suite_runtime.py → core/errors.py + core/redaction.py
core/attestation.py → core/provisioning.py + injected RemoteSourceIdentityProvider
core/harness.py → core/drivers/base.py
core/drivers/base.py → core/errors.py
core/fixtures/base.py → core/errors.py
drivers/tauri.py → core/drivers/base.py
drivers/native/*.py → drivers/native/base.py + platform APIs
transports/ssh.py → core/errors.py
drivers/chrome.py → core/drivers/base.py
provisioners/*.py → core/provisioning.py + core/runtime_cell.py + transports/* + drivers/* + fixtures/*
provisioners/remote_source_identity.py → core/errors.py + core/provisioner.py + transports/ssh.py
finalizers/registry.py → core/finalization_contracts.py
tooling/scripts/acceptance-run.py → core/launch_context.py + core/provisioning.py + core/provisioner.py + core/evidence_finalization.py + finalizers/registry.py
gates/**/*.py → core/gate.py + 具体 Driver + core/harness.py
fixtures/*.py → core/fixtures/base.py
```

禁止的依赖方向：
- core/ 下的任何模块不得导入 gates/、drivers/（具体实现）或 fixtures/
- `core/attestation.py` 不得导入 `transports/` 或 `provisioners/`；remote
  deployment source identity 必须由 concrete Provisioner 注入
- `core/launch_context.py`不得导入具体Provisioner、业务capability、Gate或Fixture
- `core/finalization_contracts.py`不得import `core/evidence_store.py`或执行I/O；
  `finalizers/*.py`不得transitively获得Evidence Store mutation APIs
- `core/result_contracts.py`不得import `core/finalization_contracts.py`、
  `core/evidence_store.py`或执行I/O；canonical result algebra不得在其它模块复制
- `core/suite_runtime.py`不得import Gate、Provisioner、Driver、Fixture、产品
  Domain或Development runner；业务只通过closed contract和lifecycle event注入
- `core/power_controller.py`不得import `core/evidence_store.py`、
  `core/evidence_finalization.py`、Gate、Provisioner或domain finalizer；Evidence Store
  可持久化和resolve typed controller artifacts，但不得拥有controller key、journal
  transition或actuator dispatch，双方不得调用对方private mutation API；
  `core/trust_admission.py`只能调用Evidence Store public read/lock API并返回
  process-local lease，不得暴露mutation API、serialized bearer token或raw store handle
- drivers/ 不得导入 gates/ 或 fixtures/
- `drivers/native/base.py` 不得导入任一平台实现
- platform native adapter 不得导入业务 Gate、Fixture 或 selector
- SSH transport 不得解释 Gate result、产品状态或 credential value
- gates/ 之间不得互相导入（场景独立）
- gates/ 不得导入 `.local` Profile 或 deployment 实现
- fixtures/ 不得调用 Gate 或修改 Gate 成功条件
- provisioners/ 不得复制产品断言、包含DOM selector、判断消息内容或执行业务
  finalizer
- `core/provisioner.py`和`tooling/scripts/acceptance-run.py`不得导入业务 Artifact
  Role、relation或业务validator
- finalizer v1为trusted/no-child contract，不得调用subprocess、fork、setsid、
  network或product client；该边界不提供hostile-code sandbox
- post-cleanup finalizer不得写artifact、重新获取resource、执行cleanup、调用产品系统、
  publish Evidence Store run或把failed/blocked结果升级为passed
- artifact writer、role registration、seal与manifest finalize
  必须服从同一个Store-owned跨进程lock和durable sealed marker
- cleanup、discard和普通retention/delete必须拒绝active run与sealed incomplete run；
  sealed incomplete run只允许由`abort-sealed`在获取active lock、等待Core watchdog
  ceiling加5秒grace、持久化append-only authorization event并原子rename到
  `aborted-runs/` tombstone后删除，且不得被reader/repair发布
- finalizer timeout、异常、identity mismatch和required artifact缺失不得覆盖已有
  primary failure；原成功必须降级为`failed/PARTIAL/UNPROVEN`
- launch context、handler、descriptor、secret或raw handle不得进入Runtime Manifest、
  Evidence Store、argv、日志或环境变量值；环境只允许传递非敏感descriptor locator
- 携带launch context的Gate不得通过`shell=True`启动，也不得把descriptor继承给
  任意grandchild
- unsupported launch transport不得fallback到file、environment secret、localhost
  service或Gate-side resource reacquisition
- attestation 不得由消费它的 Gate 或 validator 生产
- Runtime Manifest 只允许 `services[service-id]` 表达服务拓扑；禁止 singular
  `station`、dual-write 和按 map 顺序推断 primary service
- client-to-service 关系只允许由 Environment Contract 声明并由
  `ClientRuntime.service_bindings` 发布；禁止 Gate 常量、裸 URL、Profile 默认值、
  client/service 顺序或 endpoint 副本成为第二真源
- 通用 binding resolver / validator 必须位于 `core/provisioning.py`；Mobile、
  Federation、Chat 或平台 Provisioner 不得各自实现同语义 parser
- Platform Runtime Binding owns `create_bound_session`; business Gate code may
  pass only client ID and fields accepted by that binding's closed typed
  non-topology launch-options contract. Unknown fields, arbitrary environment
  maps, and topology-bearing values are rejected. Runtime Binding owns monotonic
  generation allocation and proof-ref collection. It must read each required
  role's observed identity from live client connection state, bind it to the
  existing D-13 runtime-instance identity, and return no session until Core
  persists a verified proof for every required role.
- Run-scoped fault routing uses Runtime Binding-owned
  `TransportOverrideHandle`; Gate code may request apply/clear operations but
  must not receive a routable endpoint or call `configure_station` with proxy
  URLs. Fault proxy implementation and product assertions remain Domain-owned.


- `core/_paths.py`不得定义runtime report/evidence/manifest目录
- 除`core/evidence_store.py`外不得解析`PT_ACCEPTANCE_ARTIFACT_ROOT`或platform default
- runtime writers不得写repository、`tooling/`、`docs/`或`.git/`
- readers不得通过字符串拼接解析ArtifactRef
- cleanup不得删除active run或latest target
- remote embedded WebDriver 不得监听非 loopback address
- runtime cell contract 不得保存 literal host、username、password、key path 或远端绝对路径
- cell matrix validator 不得用一个平台的 evidence 填补另一个 required cell

## Repository 外 Runtime Layout

该layout不是source module tree，不得在repository中创建：

```text
<artifact-root>/
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
