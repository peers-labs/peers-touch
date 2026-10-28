# Gate 时间约束、共享证明与修复循环

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-22 | **Updated**: 2026-10-26
> **Owner**: Acceptance Infra

## 本轮职责

目标是研发 Gate 执行架构。MR #150 是固定候选验证负载，
不以完成 MR 验收为本轮成功标准。用户已授权先审查适用性、落地首版，
再执行除 Agent 及其配套之外的全量范围；任何首个超标必须暂停后续调度，
随后原地诊断、修复、记录和自验，再冻结新候选继续循环到可用版本。
只有归因或影响边界无法可靠判断时才请求用户决定。

业务等待、操作保护、性能目标和整轮资源期限分别拥有自己的合同。
Catalog timeout 是完整命令的保护上界，不是产品承诺或性能目标。
没有实测目标时性能为 UNPROVEN；不允许自动扩大保护期限以获得通过。
整轮 requestSeconds 不证明全量请求必然可在该时间内完成。

## 适用性审查

当前方案适合分阶段落地，不能声称现有 Gate 已具备完整场景复用能力。

- `acceptance-run.py` 通过 `GateExecution` 对真实 owner 边界计时，
  工作受整轮期限及该操作保护约束；清理与发布各有固定尾部。
- shell 子进程超时可能遗留后代。预算合同沿用已有
  `GateProcessLauncher`，将既有 shell 命令作为明确的 `sh -c` argv，
  由同一进程组终止机制处理；不新造进程监督器。
- Chat 两个完整 interactions 入口执行重叠场景，是业务生产者注入缺口。
  只有业务 owner 注入唯一 case、断言引用、状态和复用身份后才能合并。
  本版不通过命令字符串碰撞继承 PASS，不声称解决了这项重复。
- `SuiteRuntimeLedger` 验证生命周期事件，不拥有实际资源。
  同环境名不证明账号、设备、epoch 与 fixture 兼容，
  因此本版不自动合并现有 Provisioner 实例。
- 控制面 YAML 解析必须保留真实 YAML 语义。工具链异常和无子 timeout
  单独归属，不能跳过注册来减少等待。

非规范性的未决优化见
[execution-model proposal](proposals/execution-model/README.md)。
当前合同已实现预算、显式结构检查依赖图和修复循环。业务 case/断言生产者、
跨 Gate 原生资源共享及产品 input→receiver 细粒度计量不属于当前已证明能力。

## Desktop 构建复用

`provisioners/desktop_acceptance_build.py::DesktopAcceptanceBuild` 是本地
Desktop Acceptance binary 的唯一构建 Owner。`make acceptance-driver-build`
与 macOS Runtime Cell 均消费该 Owner；其他调用 Make 的 Provisioner
同时获得同一构建校验，不保留独立的 Vite/Cargo 构建配方。

工具搜索路径由根 Makefile 拥有。Owner 通过只读
`acceptance-driver-build-environment` 消费 Make 实际导出的 PATH，并按
首个出现顺序去重，避免 Make 包装的重复前缀造成同一产物被反复构建。
直接 Cell 调用与 Make 调用必须得到相同的有效工具路径和输入摘要。

Owner 先获取 worktree-local OS 文件锁，再核对干净 HEAD/tree、
工作区绝对路径、平台、工具版本/可执行文件 hash、构建环境摘要、
本地 npm/Cargo/Vite 配置及安装依赖锁元数据。上述身份与私有 receipt
完全一致，且 binary 存在、可执行、SHA-256 一致时才复用。
源码、配置、工具或产物改变均失效；没有 receipt 的旧 binary 不能
被重新标为当前 commit。依赖安装由原有包管理器管理，receipt 不替代
依赖完整性审计。

macOS 构建的 Rust 安装由 `input_owners/rust_toolchain.py` 唯一观察。
从真实 Cargo 工作目录调用已有 rustup 选择器，禁止探测自动安装，
绑定 cargo/rustc 的实际 delegate、同一 sysroot 的 bin/lib/libexec/etc
完整内容、settings、逐级 toolchain 文件及 Cargo include 图。
`native_toolchain.py` 用只读 dyld 观察绑定同一进程的实际 image UUID、
非系统 image 文件内容与 OS build，拒绝未知输出、子进程和外部 loader。
已观察 image 的 delayed 转移有明确对应关系，不能用它跳过未知 image。
每个成功接纳的 image 在当前观察内登记一次 basename；delayed 记录只核对
该集合，避免逐条重新遍历全量 image。集合随本次观察释放，不保留安装
缓存；原始 image 身份、字节、顺序、数量边界及未知 delayed 拒绝不变。
SDK Owner 核对 xcrun 的实际工具选择、clang builtin resource、工具链
bin/lib/include 与完整 SDK 内容；冲突的 SDKROOT 在复用前失败。
Make 导出的有效环境传给两个安装 Owner，安装变化使 frontend 和 binary
两个 receipt 同时失效。原生和 pnpm 工具输入生产者保留全部 OS 字段，
但将 macOS version/version-info 序列产出为 JSON list；完整身份必须在
JSON 写入读取后严格相等。消费方仍比对完整身份，不只比摘要或转换旧
receipt。实际原生输入的回归须证明相同安装只构建一次、变化仍失效。
该安装观察只闭合编译器和 SDK，不自动闭合
Cargo 缓存包装器、原生依赖、Node 构建脚本或 live/runtime 输入，也不
授予任何 Gate 或产品证明。完整构建输入资格仍由对应 Owner 决定。

`pnpm_tool_execution.py` 只观察原 Make 环境下实际工具版本负载。
真实启动器继续注入 NODE_PATH；Node 同步加载 hooks 记录 CJS/ESM
解析、文件和加载源码字节、失败解析以及原缓存状态，实际 dlopen
观察原生模块和当前库。Native 库加载采样与 Node exit 明确区分；
原命令非零退出码不得改成成功。并发输出由同一观察器拆成携带实际
PID/thread、样本序号、分片序号及全样本 SHA-256 的独立片段；每次完整
写入最多 512 字节，满足 POSIX pipe 原子边界，不使用可能被强制终止
线程遗留的共享锁。消费方只重组完整且一致的片段，拒绝缺片、重复、
改写及身份不匹配。受同一两秒输出保护及有限输出总量约束，
不续发父 deadline；该校验只保证传输完整，不授予输入或产品资格。
加载后文件的存在、删除、改写或不可读状态与原加载 hash 一同保留。
生产者清理临时配置不得丢失终止记录或改变工具退出码；生命周期缺口
使样本明确 incomplete，版本 helper 拒绝该样本，不授予输入资格。
每个样本绑定实际 PID/thread。内部异步 loader 通过 Node thread data
继承同一 PID 的真实调用入口；不能对缺失的 argv[1] 推断 CLI 路径。
初始化及原始注册调用留下 incomplete 观察。异步 CommonJS 可合法返回
空源码，因此同步加载 hook 在原注册前结束。同一异步 delegate 通过
Node 公共 register API 在原注册前观察实际注册模块及其依赖，随后在
finally 中恢复运行期观察，原参数、结果、异常及转移对象不变；
await 原 nextLoad 后逐文件记录实际文件与返回源码字节，原 format、
source（包括 null）和返回对象保持原样。异步样本复用同一有界原子输出，
仅携带该次加载，不累计重发全量模块。公开 resolve 适配器 await 原
nextResolve，保留同一上下文、结果对象和失败对象；唯一 CJS Owner
记录实际 specifier、父 URL、结果 URL、条件或原错误码。成功及失败
分别只发送一个解析事件，使用原 8192 项总库存和两秒输出保护，
不重复发送累计模块或失败列表。真实失败与转移参数回归覆盖原行为，
加载记录可关联同一 PID/thread/入口的在先解析。AsyncLocalStorage
只在同一次原 resolve/load 委托链中抑制内层观察，最外层实际结果
仅记录一次；重复注册不得记录中间变换或制造 drift。注册模块与运行
模块使用同一字节 Owner 的独立库存，共享原 4096 项上限；注册事件
只含当前实际模块或解析，保持 incomplete。真实注册失败必须保留
原异常并恢复后续运行期观察。实际模块字节不能闭合注册生命周期、
内部 loader 终止、编译和缓存来源，全部异步样本保持 incomplete。
普通 Worker 构造时通过 Node 自身的 thread-data snapshot 绑定真实父入口
和独立文件入口，随后立即恢复父数据；创建、初始化和终止样本保持
incomplete，不将线程入口当成独立 CLI allowlist，也不推断源码缺口。
普通 Worker 的同步 hook 保留其实际加载文件、源码字节与退出时文件状态；
内部异步 loader 仍不安装同步 hook。加载记录不能闭合强制结束线程的
生命周期，也不能据此改变 incomplete 或缓存资格。
实际新增格式（包括原生 TypeScript）保留格式和字节，不中断工具；
其编译器来源未闭合时同样 incomplete。真实转移参数、ESM 变换、CJS
空源码及零/非零退出回归必须保留原缓存选择，并拒绝完整输入资格。
观察仅读取实际加载文件，不扫描全部 node_modules，不变更缓存选择。
版本负载不能穷尽 build import/config；缓存内容、完整工具、workspace
生成输出和完整构建仍为 UNPROVEN，该 helper 未接入构建复用或 Gate。

`PT_BUILD_SOURCE_COMMIT` 必须等于已核对的 HEAD；冲突在构建前拒绝，
Owner 将同一 commit 注入 frontend 与 Rust。配置摘要包含 Desktop E2E、
Station URL、外部 Lynx applet 根、protoc 与 sccache 输入，显式工具包装器
的文件内容也参与身份核对。`PROTOC_INCLUDE` 的文件内容参与本地输入摘要。
Applet 发现规则由 `packages/applets/build.js` 唯一拥有；只读
`--build-inputs` 与真实构建消费同一发现函数，输出外部 applet 的实际
源码内容摘要及上级 workspace/安装锁配置摘要。排除 dist、target、
node_modules、Git 元数据和临时构建目录，保留源码、manifest、配置和
源码链接；外部源码修改或 applet 增删必须使旧 binary 失效。

冷构建仍执行完整 applets/Desktop frontend 与 `acceptance-webdriver`
Cargo 构建，完成后重查源码和输入，再原子发布 binary 与 receipt。
锁等待、身份探测、两段构建、完整输出核对、二进制复制、receipt 提交
及成功观察发布共享同一个有限总时长。Owner 的原始 POSIX 主线程
deadline 覆盖同步文件操作，成功返回前再次核对同一结束时间。
超时不发布新的可复用 binary receipt；临时文件和 OS 锁必须释放，
失败观察使用调用方既有退出尾部。更早的外层取消保留原始异常、
阶段和归属，子进程清理失败也不能改为一般 blocked。沿用
`GateProcessLauncher` 的取消及进程组清理，不扩大 Gate 阈值。
每次尝试记录真实冷/热成本、阶段、返回码和输出；Gate 内构建输出
写入该 Gate 的 Evidence Store，独立准备的输出保留在 `.local`。
Receipt 是可重建产物缓存，不是产品证明，不继承任何 Gate PASS。

## 唯一执行入口

`tooling/scripts/acceptance-run.py` 继续拥有真实范围与执行。
新增参数：

```text
--all-gates
--exclude-domain <registered-acceptance-domain>
--exclude-gate <exact-catalog-gate-id>
--execution-budget <explicit-json>
--stop-on-failure
--resume-session <durable-session-manifest-artifact-ref-json>
--repair-record <qualified-repair-json>
--prior-session-manifest <prior-manifest-artifact-ref-json>
```

`--all-gates` 与 Gate/Plan/tier/completion/full 选择器互斥。
排除域仅排除所有声明 owner 均属于排除域的 Gate；
共享 Gate 和没有已解析领域归属的 Gate 保留。
`core/scope_ownership.py` 读取所选 Catalog 同目录的 Capability、Feature、
Registry 与 Domain 合同：Capability 的 domain 与 required_gates、
Feature 的 product_area 与 Capability 关联、Registry 的 features/require、
Domain 的 validation_gate_id 共同形成逐 Gate 的归属来源。Domain profile
消费某 Capability 不改变该 Capability 的 owner；框架能力不会因被业务 profile
消费而自动变成业务能力。所有共享 owner 均保留，禁止按 Gate ID 或命令前缀推断。
缺失 Feature 引用保留明确的 unresolvedFeatureReferences；它不能制造领域归属。
已确认属于排除业务但缺登记关联的 Gate 使用精确排除，并在范围核对报告保留
业务登记缺口，不能把这种精确排除冒充已有的规范映射。
`catalogExecution: manual` 的 Gate 保留精确 `--gate` / Plan 调度能力，
但不进入 `--all-gates`：它们要求人工观测、外部输入或显式诊断上下文，
自动全量运行不得把输入缺失制造成产品失败。未知值在范围冻结时失败。
精确排除项必须真实存在。每个 Catalog Gate 都保存纳入/排除理由、
Catalog 执行模式、完整归属来源、Capability 引用与定义摘要；
全部归属合同与整个范围各自保存摘要。
范围解析缺陷修复后，旧 Session 与原始义务账本保持不可变。
若同一排除授权重新解析出不同集合，先保存逐项来源、增减集合、原始 manifest
与原授权的核对记录，再以原预算建立全新 Session；不通过 resume 改写旧范围，
不向新候选转移旧 PASS。旧账本的每项仍须有保留或授权排除的明确去向。

该方式是显式全量请求的选择器，不恢复 PlanMount 或辅助 Admission。
它不推断业务先后依赖：Catalog 的显式 `dependsOn` 形成拓扑执行图。
共享 Gate 内嵌被排除的业务断言时必须报告 mixed-scope 注入缺口，
不能偷偷删断言或以全 Gate PASS 代替未验证的范围。
validator 的环境、Provisioner、继承与 import isolation 检查使用完整
依赖闭包，包括仅被消费者引用的生产者；不能只检查 Capability 直接列出的 Gate。

## 共享结构证明

Planner 和 Runner 调用同一个 `core/execution_graph.py` 编译器。
显式选择消费者时自动包含其必要依赖；每个生产者最多调度一次。
重复选择、重复依赖、缺失节点、环及依赖被排除都在启动前失败。
正式 Plan 的 Gate 根集合也包含其登记依赖闭包，不因此引入无关产品 Gate。

`dependsOn` 是证明依赖，并不合并 Provisioner。下游先验证生产者原始
ArtifactRef、SHA-256、DURABLE manifest、当前源码、PROVEN 结果及清理状态，
任一缺失则 `PREREQUISITE_UNPROVEN`，不启动下游命令或资源准备。

纯结构判定使用 `judgment: all-prerequisites`，没有 command/argv；
其独立结果只引用生产者原始 manifest，不能复制报告并改写 gateId。
仅允许 local 的 ci-structure、ci-cheap、local-evidence；不支持把它当作
原生环境、平台单元格、UI、接收者或异常断言的替代证明。

当前将架构 registry、Plan/host/Hook、安装投影、Runner、Planner、
validator 和 Infra 边界回归指定为共享生产者，删除消费者里的重复命令。
安装投影测试由一个 Suite 持有不可变源码和 Git fixture，
每个顺序用例只清理自己的投影、HOME 和 machine 状态；保留独立 CLI smoke。
生产目录扫描用 DirEntry 复用元数据观察，仍拒绝符号链接并逐文件计算 hash。
`tests/synthetic_git.py` 统一拥有构建、attestation、预算和执行图夹具的
临时源码操作。通过 `git --exec-path` 解析真实工具链 delegate，
移除 IDE 遥测变量，并使源码读取也优先选择该 delegate。全局
`trace2.eventTarget` 在变量移除后仍向后台写者发送事件，导致清理时
异步写回 `.git/ai`。夹具环境显式关闭三个 Trace2 流，并传给源码读取
和合成 Runner 子进程；仅过滤变量无法保证终态清理。
每个操作在自身配置禁用 Hook 和后台 maintenance，保持五秒子期限；
临时目录只清理一次，不用删除重试掩盖仍活跃的写者。该隔离只作用于
合成源码操作，不改真实仓库 Hook、构建完整性、取消断言或 Gate 预算。

图 artifact 保存原始选择、完整依赖、调度顺序及定义摘要。
效率报告给出实际 dispatch 数、共享引用数、Gate 总时长、观测 P95 和超标项。
P95 是本次已调度 Gate 的样本分位数，不冒充产品效果时延或长期控制面 SLO。

时间约束格式为闭合 JSON 对象：

```json
{
  "requestSeconds": 30,
  "planningSeconds": 5,
  "lifecycle": {
    "cleanupSeconds": 30,
    "publishSeconds": 15
  },
  "gates": {}
}
```

这里的 30 秒仅用于合成框架示例，不是默认值、业务 SLA 或整轮验收目标。
真实请求由调用方提供有限资源额度，框架不自动调大额度来取得通过。

`lifecycle` 只声明清理和发布保护；`gates` 是实际 Catalog Gate ID 到
显式 owner 约束的映射，未知 Gate 拒绝。删除 default、tiers、totalSeconds
格式，不保留旧语义兼容入口。没有全体 Gate 通用工作上界。
单个 Gate 可以显式声明 `workSeconds` 作为额外资源上界；该值必须有
owner 来源，不能批量作为未测量的性能目标。operations 绑定实际 stage。
当前 Catalog 的 Interactions 3600、Lifecycle Interactions 2400、Contact 600、
Product Closure 3600 秒保持原样，从实际 command 开始计算。
准备消耗整轮时间，不扣减命令自身的保护额度。

有效期限取整轮剩余期限、当前 phase 祖先及当前 owner 操作上界的较小值。
未声明子操作上界时父保护仍生效，granularity 保持 owner-boundary。
有限进展、日志与重试不续发父期限。本修订不引入 Suite/case 重构、
新的无进展 engine 或产品 SLO。缺进展注入与业务必要时长下界仍未证明。
既有正向等待和完整负向观察窗口保持原样；不透明 command 不能被推断为
必然能在剩余 request 时间内结束，也不能截短观察来取得 PASS。

request deadline 到期后停止启动新工作，清理和发布替换已退出的工作 alarm。
首次进入 phase 固定该 phase 的期限，后续子调用不续发尾部：
cleanupEnd 取首次 cleanup 开始加 cleanupLimit 与工作期限加 cleanupLimit
的较小值；publishEnd 同理受工作期限加两段尾部及首次 publish 开始约束。
命令取消、终止、后代确认与之后的资源清理共享同一 cleanup phase，
删除额外 termination allowance。Launcher 自身的终止、强杀与确认同样
共享一个固定上界。外层 timer 更早到期时保留实际外层取消身份。
取消状态不能通过进入清理而恢复业务执行。

Native 客户端最终清理只有一个终态写入者。重复调用复用首次结果与失败，
不重新发布同名证据或读取已移除的日志。会话保留停止后的实际 launch PID；
保留状态的进程停止和最终状态释放是两次不同的生命周期操作。接替会话
尚未验证时保留原失败，但不能因此跳过最终资源释放。端点先于其本地
代理关闭，代理端口身份保留实际 bind 结果。端口和进程释放共享同一剩余
期限；进程未确认停止时保留它使用的存储、staging 与日志。清理失败不能
转成产品通过，子调用不续发父 cleanup 尾部。

requestSeconds 是 Runner 接收请求后的工作期限，正常运行中的清理和发布
也消耗它；到期后的退出尾部可使完整墙钟超过该值。上层监督须容纳尾部，
实际总成本完整保留。最终 aggregate owner 沿用 20 秒生命周期上界
（18 秒工作、1 秒清理、1 秒发布）；独立异常停止记录最多 5 秒。
阶段记录保留实际限制来源与相交期限，区分 request、显式 Gate work、
owner operation 和退出 phase。没有性能目标时 protection 通过仍不产生
性能 PASS。sealed run report 注明发布前测量边界；Runner 在终态发布和
handle 清理尝试后输出 `execution-wall-cost`，保留完整墙钟、aggregate
发布成本与真实 handle 清理结果。外层监督器同时保留全部退出开销。

## 生命周期与异常

`core/execution_budget.py` 定义预算、范围冻结、单 Gate 时钟与 observer 生命周期；
Runner 在真实 owner 调用边界记录 source、resolve、credentials、
provision、runtime-cell、launch-context、command、cleanup、scan、
finalize 与 publish。使用 monotonic clock，当前 granularity 明示为
`owner-boundary`，不伪造未观测到的业务 Step 或产品效果时延。

Evidence Store 阻塞锁使用统一有限 OS 尝试，最大 60 秒。较短显式保护及
当前阶段的原 owner deadline 保持优先，不通过锁重试续期。取得失败关闭
本次文件描述符，成功持有者在原 finally 释放。OperationObserver 记录
当前阶段的真实竞争次数、wait/hold 与失败类型；跨阶段释放仍关联原取得
阶段。锁样本和内存有界，累计统计保留被截断样本的实际耗时。未观察的
Machine Dev/Profile/Session 外部 owner 不被标记为已测量，锁数量本身
也不能推导架构过度或性能合格。

Gate 源码采集发生在 Evidence handle 和 Runtime 资源获取之前。该边界仅有
request-work 到期时，Runner 将未启动项保留为 UNPROVEN，记录其 cleanup 为
not-required，再进入同一个 aggregate/Session 封存流程；实际 dispatched
计数不增加。owner-operation、混合期限、SIGINT 和资源获取后的异常仍走独立
诊断，不能改成清理完整的请求耗尽。任何已封存 Session 都输出原始 manifest
引用，继续执行仍须通过原有完整 inventory、状态和清理复验。

Environment Fixture 注入 `station.reset:<scope>` 后，Runner 在资源准备前
执行 `fixture-authority` 阶段。Machine Dev 验证当前 binding、非 stable
Profile、capability、scope、Git identity 与 tracked-clean topology，再由
`tooling/scripts/local-dev/machine-dev-lease.py::MachineLease` 取得真实 OS 锁，
锁内复验同一身份。CLI 与 Runner 共用这一实现，Core 不复制 flock 或
Profile reset policy，也不实现业务删除。

租约寿命使用当前工作加清理的剩余绝对预算，不另加时间；普通无实验预算
入口使用 Catalog timeout 作为租约上界。父 Provisioner 最先登记租约释放，
最后释放；业务 cleanup 继续使用本 Gate 的环境和真实 FD。已继承同一 scope
的租约必须复验，借用者不释放。一个 Environment 声明多个 reset scope
时明确拒绝，不能用一个 scope 冒充全部权限。锁内校验失败或取消都会清空
metadata 并释放锁。Capability context 的隔离环境仍不接受 raw reset authority。
普通 Gate 在 launch 前复验同一真实租约，通过已有 Launcher 的显式
`pass_fds` 继承该 FD 和 Provisioner 产出的输入；借用者不负责释放。
Capability context Gate 拒绝额外继承 FD，继续只通过其专用 channel 调用能力。

Runner 的父进程上下文显式投影租约的 FD、ID、kind、resource、scope、
workspace、branch、head 八个字段，并在退出时恢复原值。取得租约之后，
credentials、provision 与 cleanup 均重新进入这一上下文；只更新子进程
环境字典不能证明父 Provisioner 持有可验证权限。

Native Chat、Chat Storage、Home Station 与 Cross-Station Social 的 Fixture
声明 canonical `station.reset:<scope>`，不再要求布尔 reset 开关。
Native Gate 消费同一 `verify_runtime_fixture_ready` 校验：
Runtime 为 `FIXTURE_READY`，Actor Manifest 的 targetVerified 为 true；
reset 模式要求 authorized 为 true，保留既有状态的模式要求
initialState 为 existing 且 authorized 为 false。Gate 不再独立读取旧布尔
开关作为第二份权限。该状态校验不签发 reset 权限；真实 mutation 仍由
Fixture 的 reviewed Profile、精确目标与 live OS lease 控制。
Chat Fixture 子进程保留八个租约字段并使用 `pass_fds` 继承真实 FD；
远端 reset 必须先通过租约校验，再触碰本地 client storage。
多 Station Fixture 由业务 Provisioner 将已选择的 Profile 映射为精确部署目标；
每个目标重新调用 Machine Dev 的公开 Profile definition owner，
核对 tracked-clean Profile/部署定义、非 stable policy、deployment environment
和完整 Station URL。此映射是运行输入，不是第二份授权，也不要求先把每个
目标设为共享 active Profile。作用域退出后恢复映射，子进程沿用相同映射。
在已绑定多个 Profile 的 Fixture 中，未显式指定 deployment 的操作先按完整
Station URL 唯一匹配 reviewed target，再加载该 deployment；不得用 active
Profile 推断另一个 URL 的归属。显式 deployment 仍须通过原有精确目标校验。
空 URL、未知 URL、歧义匹配、binding 漂移、stable policy 与缺失 live lease
均保持拒绝。Chat Fixture target owner 为这些拒绝附上实际 expected/observed
资源检查与恢复动作；没有执行的检查不得补写为通过。
本地源码分支先按真实 URL 判断是否为 loopback 候选；非本地 URL 不查询
无关 active Profile，直接进入同一次 reviewed deployment 解析。显式 `local`
请求仍执行原有完整目标 mismatch 检查，未绑定操作保留 active deployment
回退；该分支选择不替代后续 live lease、registry 和容器身份校验。
一次目标解析只校验一次当前 live lease，并为每个待匹配 Profile 调用一次
registry owner；显式目标只解析其 Profile。解析结果沿同一次 deployment
加载与授权检查传递，不跨操作缓存。Core held-lease 校验子进程有独立
10 秒 deadline，超时保留真实资源检查，不将命令参数当作进程超时。
Fixture Actor 读取按精确 Station 目标批量执行：每次操作解析目标一次、
在一次 SSH 调用内检查 Station/PostgreSQL 两个容器，再以一个查询读取该目标
全部账号。每个账号必须恰有一个 local Actor，遗漏、重复、身份字段不完整均
拒绝。建档和联系人写入前仍各自执行一次独立读取与身份漂移核对，不跨阶段
或租约缓存。Federation 准备使用同一批量读取 owner。

有界 Environment 准备在 `remote_source_context` 中获取 POSIX 远端 source lease。
该租约的现有 SSH 进程同时拥有 OpenSSH ControlMaster，`ControlPersist=no`；
私有 socket 随租约创建和删除，不建立主机级连接缓存或持久 daemon。
Provisioner 保存本次获取的连接描述，Runner 显式投影到父准备上下文、普通
Gate 子进程和 cleanup。上下文退出恢复原值，子进程只借用、不释放；
连接描述及 socket 不写入 Runtime Manifest、Git 或 Evidence Store。
无可复用连接的 Windows、本机独立维护和 persistent lease 保持其独立生命周期。

每次 SSH 命令先验证完整 host/user/port/known-host path/platform 目标、
私有 socket 权限和实际 master PID，再在同一远端调用内重查 source 文件锁
确实被记录 owner 持有。主连接存活不能代替实际租约检查；远端租约提前释放
时仍拒绝新操作。`ProxyCommand=false` 禁止 master 丢失后的隐式 TCP 重连。
copy 先验证同一租约；forward 保持独立 SSH 进程和转发清理，不把转发注册到
借用 master。检查耗时消费原命令 deadline，Gate 工作预算不增加。
租约竞争、目标/PID/owner 不一致、提前退出、子进程继承及 socket 清理必须
通过真实连接资格验证。此优化仅减少重复握手，不替代 Profile/reset、源码、
Actor、UI 或接收者证明，也不说明底层网络变化原因。

macOS Runtime Cell 采用 Native Input 合同的 semantic-nonintrusive 默认值，
在构建和写入 PREPARING 状态之前检查输入隔离。
托盘 Gate 必须先通过 exclusive-native-input 的隔离检查，再构建真实
app bundle；其 Acceptance driver 由 Runtime Cell 唯一构建。共享用户
会话不能冒充 isolated-gui-session，拒绝输入资源不允许先花构建预算。

全量 Catalog 的 Profile 分配仅传给 registration 明确支持的 binding
类别，并按真实 service ID 过滤；精确 Gate 请求继续拒绝不支持的参数。
同服务名不代表可复用运行时，distinct-Station 合同依然检查 Profile 唯一性。

实验 synchronous owner deadline 使用 POSIX main-thread `setitimer`。
取消异常继承 `BaseException`，普通 retry/polling 不得吞掉它。
不支持的平台在执行前 fail closed，不能声称 Windows 生命周期已验证。
子进程仍由已有 launcher/adapter 拥有；远端任务和自主新 session
不因本地进程组退出而被证明已清理。清理失败必须保留 `UNPROVEN`。

第一次工作超时进入清理，清理共享预留预算；发布再共享其预留预算。
清理或发布超时同样停止后续 Gate。发布异常不能重写 sealed Gate，
停止诊断写入独立 Evidence Store run，属于 supporting evidence。
独立停止 run 同时保存 immutable stop observation 和完整范围 run report，
不依赖调用者是否启用 Session。初始化阶段尚未取得 Gate run 时，启动数
保持零；已经启动但尚未发布结果的 Gate 保留实际时长与 UNPROVEN 失败。
停止 report 引用原始 stop observation，不补造 Gate Manifest 或产品证明。

SIGINT 记录为 `OWNER_INTERRUPTED`，不归类为 timeout。Gate 内中断先由
已有 Launcher 终止并确认后代进程、捕获输出，再执行剩余资源 cleanup
和结果发布；初始化或发布中断通过相同独立停止 owner 保存完整范围。
所有路径保留现有预算，停止下游调度。Launcher 的输出回调仅在其真实
终止检查完成后报告 process cleanup；中断本身不证明远端资源已释放。
Provisioner 与 Runtime Cell 的嵌套 Launcher 清理失败保留原 typed exception。
Runner 将其单独记入 `provisioningProcessCleanup`，继续反向清理已取得资源；
Environment/Cell 清理成功不能将总清理改记为通过。即使没有 Session 或
`stop-on-failure`，清理失败仍停止后续 Gate 并保存完整范围 `UNPROVEN`。
Session 消费实际 run report 和原始 ArtifactRef，下一轮仍要求有界
诊断与资格验证，不能从中断记录继承 PASS。

普通 stop report 保留已经实际完成的结果，所有未执行项记为
`BLOCKED/UNPROVEN`，含 stop 引用和零执行时间。
已启动但未能发布结果的 Gate 保留实际时长和 `FAILED/PARTIAL/UNPROVEN`，
不作为零时长未执行项。单 Gate 成本 artifact 的测量边界为发布成本 artifact
之前；包含该发布开销的终态由 aggregate `executionBudget.gates` 或独立 stop
记录拥有，不能把前置快照当作完整终态。
产品 proof 与成本状态独立；一个有效产品结果不证明成本达标。
不能因未运行项缺 manifest 而补造正式证明。

## 活态 Gate 记录

每次实验保存 scope、policy digest、固定源码身份、实际阶段 spans、
Gate cost 和 stop 原因。状态包含 planned、within-budget、over-budget、
未调度与尚未合格的 reuse。

耗时归属只按已观察边界判断：

- cleanup/publish 超时属于架构开销；
- 唯一 request-work 到期记录 `REQUEST_PREEMPTED` /
  `ADMINISTRATIVE_PREEMPTION`，表示有限请求配额耗尽；
- owner 工作边界超时先记 `UNKNOWN`，需检查工具链、准备与真实操作；
- 必要业务时长必须有产品合同及观测支持；缺失时记
  `mandatoryDuration=UNPROVEN`，不得凭宽松旧 timeout 判断合理。

已接受的恢复合同由 `core/execution_session.py` 持有完整范围与有限请求账本，
Runner 仍是唯一调度入口。Session 的 required 集合、graph、policy 和 source
固定；一次请求的 dispatch 可以是仍需证明的必要依赖闭包子集。
最终报告始终保留全部 required Gate，不以本次 dispatch 反推全量范围。
恢复消费同 Store 的 DURABLE manifest ArtifactRef；单独可编辑的 ledger
不是恢复入口。新请求持有现有 OS 文件锁，在锁后重查 source 和 ledger，
一次请求序号只消费一次；并发、重复继续或缺失崩溃清理证明均拒绝执行。
账本使用 `sessionId`、`requests`、`request`、`dispatchGateIds`、
`validatedGateIds`、`graphDigest` 和 `contextDigest`。删除旧 attempts/PAUSED
恢复语义。序号消费及实际 handle cleanup 后的 terminal manifest 保存在
worktree `.local/acceptance/execution-sessions/<store-digest>/<sessionId>/`，
不作为产品 evidence 或资源权限。正常退出打印
`execution-session-manifest`，该引用才是下一次明确调用的恢复输入。
控制面规划继续消费 planningSeconds；session-validation 只处理原始请求历史、
排序和序号消费。请求开始时完整范围进入 dispatch，validated 为空。
原 producer 的逐项复验发生在该 Gate 源码采集之后、新 run 获取之前，
消费该入口的原 request deadline 和原 Gate 清理尾部；必要依赖先行复验或执行。
通过复验且源码前后稳定后，Session 的 record_reuse 才将这一个 Gate 从
dispatch 移到 validated。复验成本单独保存在 validation，复用不增加实际
dispatch，不改写原始 manifest、runId 或成本。不设置全局原证明扫描屏障，
也不增加工作额度。报告分别保存 planning、validation、原始成本和本次 Gate
成本。请求 terminal commit 与 handle cleanup 共用原有
2 秒尾部；任一失败以非零退出，未提交的请求序号不能再次执行。

仅当实际唯一限制为 request-work、工作已取消且资源清理成功时，状态为
PAUSED_REQUEST_EXHAUSTED。其它结果必须已 DONE/PROVEN，或是引用同一 stop、
无已获取 run 且无实际工作的未调度投影。此前实际失败、依赖阻塞或不完整证明
不会被后续配额耗尽覆盖，仍须进入 PAUSED_REPAIR_REQUIRED。
显式继续只发起一个使用原策略的新有界请求，
不延长旧期限、不自动追加额度或无限重启。取消的 Gate 从完整入口重跑，
不拼接局部业务窗口；配额耗尽不证明业务挂起，也不证明必要业务时长。
operation、cleanup、publish、混合限制和其它停止为
PAUSED_REPAIR_REQUIRED，必须先有原 owner 修复与 qualification；
归因仍不可靠时为 NEEDS_JUDGMENT。修复证据的 ArtifactRef 必须在同 Store
可解析且 hash 有效。框架不编辑源码、授权资源或生产产品 proof。

同一候选的完成结果只引用原 producer 的 manifest/runId。Runner 重新核验
全部 inventory/hash、source、definition、policy、运行输入身份、最终 required
checks、DONE/PROVEN 和 cleanup；任何缺失或变化使该项重回需执行集合。
provider、oracle、action-plan 或 runtime 的当前合同身份无法证明一致时不复用。
确定性 local Gate 必须由 owner 声明闭合 `executionInputs`：

```json
{"executionInputs": {"environmentKeys": ["DECLARED_INPUT"]}}
```

声明表示命令的确定性输入仅来自当前源码、显式依赖证明、标准工具环境
以及列出的变量；外部文件、账号、活态服务或 oracle 状态不能被空声明隐藏。
仅声明环境键时，ci-structure、ci-cheap、local-evidence 且无 Provisioner、
Runtime Cell 或 ephemeral capability 的 Gate 才有复用资格。
有外部输入的 Owner 必须另外注入 `identityProbe`，不能以 local 标签代替闭包。
缺声明的结果始终新执行。
MachineDev 自检及其 Runner 回归由具体 `machine-dev-toolchain` Owner 观察：
沿用实际 Node/Python/Git/进程工具安装闭包，再通过原 `isPortListening`、
`slotPorts` API 读取负向端口和全部候选 Station 端口状态，以及实际临时父目录
身份和权限。观察不发应用请求、不持有监听端口、不读取机器 Profile 或登记表，
也不改变原 MachineDev 测试命令。端口或临时目录输入变化使原证明失效；
完整命令与清理证明仍由原 Gate 提供。此 Owner 只接受两条明确审查过的自检
命令，继续拒绝产品 Provisioner、Runtime Cell 和 ephemeral capability。
全局 context 仅绑定明确的 Plan、执行策略、runtime/Profile 选择；每个 Gate
另以 `core/execution_identity.py` 对实际允许继承的环境值计算摘要。
子进程只继承标准工具变量和声明键，再由 Runner 注入本次证据与依赖引用，
防止未参与身份计算的环境偷偷成为执行输入。秘值不写入 identity artifact。
变量变化仅使该 Gate 及依赖消费者重执行；无关观察变量不失效其它证明。

`executionInputs.identityProbe` 是闭合的 `{ownerId, argv, timeoutSeconds}`。
Owner 提供 shell-free、只读、有限时长的命令，使用既有 Launcher；命令继承
同一标准工具环境和声明键，以及 Runner 注入的候选上下文。
输出仅允许 `acceptance-gate-input-observation`、精确 Gate/Owner ID 和
`runtime/provider/oracle/actionPlan/fixture` 五个 SHA-256 摘要。Owner
负责读取并摘要化真实输入，Core 只核验合同，不从旧 Manifest、Profile 名称或
环境名称合成值。秘值、端点、设备 handle 和原始配置不能成为输出字段。

Runner 先完成既有 Environment、Runtime Cell 和 launch-context 装备，
再于产品 command 前观察；源码检查无装备时沿用直接观察的顺序。
`core/input_artifacts.py` 从当前 Run inventory 捕获实际装备引用和依赖证明，
封存为 `proof/input-artifacts.json`。引用必须属于当前 workspace/Gate/run，
命中原始 inventory 和实际 hash；缺失或错属装备拒绝执行。
Owner 接收此不可变上下文与只读 Artifact Store root，不接收凭据、lease
descriptor 或 launch capability。观察阶段仅说明当前为 command 前、
清理后或原始证明续跑核验，不成为身份或资源授权。
Runner 在清理完成、结果封存前再次核验；执行中输入变化或
核验失败使本次结果保持 UNPROVEN。续批只对原始完整结果及已核验依赖执行
当前探测，读取原 producer inventory 的同一 input-artifacts，禁止重装或改用
current latest，然后比较原始 `execution-identity.ownerInputs` 和输入上下文引用。
具体 Owner 必须同时核验原始装备事实和当前 Profile/provider 的实质输入，
不能把旧 READY Manifest 当作当前活态证明。其余 inventory、
源码、当前 authority、依赖 manifest、DONE/PROVEN 和 cleanup 条件继续生效。
探测、清理与发布消费原有 deadline，不增发请求或尾部。没有合格探测的活态
Gate 始终新执行；ephemeral capability Gate 仍需独立的输入通道合同。
探测进程成功或自身超时且清理已确认时，不提前结束 Gate 的工作阶段。
请求取消先撤销工作计时，再使用原 Gate 固定清理尾部；清理取消或失败保留
`InputIdentityCleanupFailed`，不能降成普通身份缺失或续跑 pending。
任何清理失败都停止后续派发，即使未指定 `--stop-on-failure`。
Gate 入口复验发生此失败时保留已完成项，封存完整范围的独立 stop、Session
和 `PAUSED_REPAIR_REQUIRED` 终态；原始干净请求不能再授权重放。
入口尚未获取新 Gate run，不能补造该 run。探针被唯一 request-work 取消且
实际清理已确认时，沿正常 aggregate/Session 封存为干净耗尽；其它取消或清理
失败仍走独立诊断。

`input_owners/source_toolchain.py` 是具体源码检查 Owner，核验实际可执行文件
内容和显式安装依赖内容，将源码 oracle、命令、临时 fixture 配方绑定同一候选。
`input_owners/installed_inputs.py` 读取当前 Python 的实际二进制、有效 import
路径、stdlib、安装包和已存在的字节码；macOS 非系统动态库读取实际文件，
系统库绑定 OS build。未知脚本或 shim、第二个未资格化解释器、无法解析的
动态库和外部 import root 均拒绝资格。安装链接默认不能越界；Python
sysconfig 指定的 framework 文件可作为精确文件依赖，不扩展目录边界。
macOS 动态库依赖读取区分 `otool -D` 的实际 `LC_ID_DYLIB` 和 `otool -L`
的加载依赖；库自身安装名不是额外文件输入。只排除同一 image 明确报告的
自身安装名，真实非系统加载依赖仍必须解析并摘要，缺失依赖不获得资格。
当前工具闭包只接受 Python、sh、env、Git 和 rg；Go、Rust、Node 等工具链
需各自的 delegate、配置和安装依赖 Owner，不能仅凭 native binary 格式获准。
`acceptance-validate.py` 的结构检查只消费当前合同、源码和规划器，不读取
latest run 或当前结果 envelope。`validate_domain` 与 `validate_infra` 仅在
`require_proven=True` 时调用唯一证据读取函数 `latest_passed_gates`；
`validate_capability` 拒绝结构模式传入证据集合，也拒绝证明模式缺失证据集合。
结构报告保留 `status=structurally_valid`，以 `proof_assessment=not-evaluated`
及两个 missing-gates 字段的 `null` 明确表示未评估产品证明，而非零缺口。
证明模式继续进行原有 source、严格 JSON、重复结果与完整 PROVEN 检查，
报告 `proof_assessment=evaluated` 及真实缺口集合。该分离只允许经过审查的
结构 Gate 绑定 Python/sh 和实际 PyYAML 安装闭包；不授权复用产品验收证据。
`input_owners/node_toolchain.py` 提供独立的具体 Node 源码闭包，绑定实际
native Node 和非系统动态库，并从声明的真实 repository import origin
解析实际包目录及传递依赖，核验 package manifest 与全部包代码。包解析
路径和可选依赖的实际缺失也属于输入，新增依赖或解析目标改变使原证明失效。
Python 安装依赖由同一安装输入 Owner 用 `packaging` 解析真实 distribution
requirements、平台 marker、版本约束及传递 extras；解析器本身也在闭包内。
每个已解析 distribution 的真实 import 根、代码、已有 bytecode 与 metadata
均绑定身份；缺包、版本不满足、共享 namespace、越界 import 和直接 URL
依赖保持未资格化。单文件模块的 bytecode 缺失也记录，不能只摘要 `.py`。
安装树由同一 Owner 按原有排序枚举名称、权限、链接与重复目标引用，
以固定 4 个线程读取完整文件内容，最多持有 8 个未归约的读取任务。
每个读取任务按顺序处理最多 32 个文件，减少大量小文件逐个提交 Future
的调度开销；全部当前字节仍逐文件读取，摘要与原有遍历、归约顺序相同。
只有内容读取并全部归约后才返回身份；完成顺序不能改变目录或链接摘要。
正常返回、读取失败、边界拒绝和取消均取消未启动任务并等待已启动读取退出。
不保留跨观察缓存，不以大小或 mtime 代替内容，不增加原 probe deadline；
外层 Launcher 继续拥有完整进程的取消和固定清理期限。
Node Owner 可声明额外 Python 包和经审查的原生 shell utilities；系统 Make
启动器还必须绑定 `xcrun` 实际选中的 developer-tool delegate 及其动态库。
Boundary 自检声明真实 review shell utilities 与 governance 的 `yaml` import；
Provisioning 自检声明 Selenium 的完整 Python 依赖及合成构建实际调用的 Make。
这些自有临时夹具的配方来自同一源码与 Gate；真实设备、Profile 或服务
输入不能因此得到源码复用资格。完整命令全部通过并完成原清理后才能复用。
它只读取逐项解析的安装根，不扫描整棵 workspace node_modules 或构建目录；
包内越界链接、native addon、未资格化 loader/OpenSSL/ICU 配置均拒绝。
Node 版本号和 wrapper hash 不能单独证明闭包。需要 pnpm、Cargo、Go 或真实
本机状态的 Gate 保持新执行，直到对应 Owner 注入；不能沿用空 environmentKeys
声明代替缺失的工具链身份。纯 prerequisite judgment 仍绑定原 producer 引用。
`input_owners/metadata_toolchain.py` 仅为 `architecture-registry-self` 的
pnpm workspace enumeration 与 Cargo `metadata --no-deps` 提供具体闭包。
它复用 Node/Python 源码 Owner，绑定实际 pnpm package 全部字节、实际加载模块
与动态库、有效配置和 workspace 结果，以及 rustup proxy、当前与临时夹具
父目录实际选中的 Cargo delegate、动态库、settings、配置 include 图和
Desktop/Mobile metadata。Node compile cache 与 pnpm package-manager 自动跳转
在该 Gate 与探针中均显式禁用，临时 fixture 也继承同一命令环境。
pnpm 的 stdout 保持原样；同进程退出观察只补充实际 image inventory。
所有配置、结果和路径在 Owner 内摘要化；不接受包管理器跳转、外部 pnpm hook
或临时夹具目录的专用 rustup override。该闭包不授权 Rust 编译、Go、其它
pnpm 命令、Profile、设备或活态 Gate 的复用。原 10 秒探针期限不扩展。
`input_owners/pnpm_toolchain.py` 独立拥有安装入口解析。通过同一 Node 运行
已安装 CLI，并以只读 preload 观察真实版本委派子进程；不替换 spawn、
版本选择或命令输出。委派前必须核验精确 packageManager 版本对应的已安装
manifest/bin，缺失或不匹配直接拒绝，不让探针安装工具。观察绑定父子
CLI 的全部安装字节、实际入口及路径链接、Node 解释器/版本/动态库、
可选 `v8-compile-cache` 的实际缺失和原生 Mach-O 模块依赖。
配置、版本两次观察的真实委派顺序及安装身份必须一致；外部 loader、
未资格化可选 cache、pnpm hook 或 Node 重定向均拒绝。原生 Node 编译缓存
必须显式禁用。metadata Owner 复用该唯一安装入口，继续禁用自动版本委派。
安装观察本身不是 Gate identityProbe，也不资格化编译、包解析、测试服务、
SDK、Profile、设备或活态产品输入。
子目录的版本选择以 pnpm 实际查找的最近 workspace manifest 和根 package
manifest 为准。查找路径上的存在、缺失、链接和字节均绑定身份；
配置重定向和错误 workspace 文件名拒绝观察，不能以子目录缺少
packageManager 推断不存在已安装的版本委派。
`input_owners/pnpm_project.py` 提供独立的安装项目观察，不注入任何 Gate。
它通过同一已资格化 CLI 的 `list --depth 0 --json` 与
`list --depth Infinity --parseable` 取得直接依赖和完整平铺路径，核对两者
一致性，保留重复版本、实际缺失路径和全部已安装包字节。每个包的必需、
peer 与 optional dependency 从真实逐级 node_modules 链接解析，越界目标
或缺失必需依赖拒绝；只有声明可选的依赖允许缺失。原生模块依赖仍由
同一 Mach-O 库 Owner 读取。pnpm exec 的真实 cwd、PATH、Node image 与
shell utility 选择也属于观察。workspace 源码与生成输出明确保留独立
producer 资格缺口；本观察不闭合 pnpm bin 启动器的 NODE_PATH、
workspace 构建输出、编译服务或完整构建，不能用于授予 build receipt
或正式 Gate 复用。命令、probe 与工作预算均保持原值。
`input_owners/pnpm_launchers.py` 独立观察声明的真实 bin 启动链。
它只接受已审查的 pnpm Node shell 模板和实际 manifest/bin 对；
preload 记录真实 cwd、PATH、注入的 NODE_PATH、Node image 和 globalPaths，
随后在工具代码执行前退出。各搜索根的当前名字、链接、普通文件字节、
缺失及断链保留为解析输入，不递归读取未选择的 package 目录。
未资格化模板、其它 Node/bin 来源、观察期间启动器或搜索根变化均拒绝。
该记录为 `LAUNCHER_ENVIRONMENT_INPUTS_ONLY`，不代替实际工具代码、
native addon 加载、workspace 生成输出及完整构建资格，不注入 Gate。
`input_owners/workflow_toolchain.py` 为完整 `development-workflow-control-plane`
命令组合提供具体输入闭包，复用同一 Node/Python 和 pnpm/Cargo metadata Owner。
原 Node、Plan 与 skill-check 检查全部保留，仅显式禁用 Node 编译缓存与 pnpm
自动版本跳转。校验链另外绑定实际 shell utilities、macOS `shasum` 的真实
Perl 解释器、实际加载模块与 XS image 字节、动态库和 import resolution。
只执行已审查的 SHA-256 stdin 路径，不以 wrapper hash 或替代摘要实现资格化。
未知 checksum 选择、Perl loader 配置、条件 Git 配置、签名或 fsmonitor
执行路径保持未资格化。实际临时父目录权限/身份、Git 配置与模板代码进入夹具
身份；自有 workflow Git 夹具全部在首次 commit 前关闭机器级 Hook。
该 Owner 不读真实 Profile、运行时证据或本机业务状态，仍拒绝产品装备与
ephemeral 输入，原 10 秒探针和完整 Gate 清理要求保持不变。
只有逐项审查为纯源码检查的 local Gate 才可注入该 Owner；它拒绝 Provisioner、
Runtime Cell、ephemeral capability 和非 local 环境，完全自有实验仍需自己的 Owner。
读取 `.local` 现场、跨 Gate 未声明证据、真实 Profile/设备/服务的 Gate
必须由其业务 Owner 提供真正的当前状态核验，不能注入空的源码合同。
源码、图、策略或全局明确输入变化仍使全部旧证明失效。
原 producer 的依赖 manifest 必须与本次核验通过的依赖引用完全一致。
仅迁移框架 owner 的声明；业务活态输入缺失保持 BUSINESS_INJECTION_REQUIRED。

每次 request 单独计算拓扑调度顺序：先执行此前实际启动但未完成的根及其
必要生产者，再逐根执行未启动项及其依赖，最后执行此前完成但没有复用资格的
其它 Gate。Session 从原始封存请求的 report ArtifactRef 读取当前连续候选的
完整执行历史，核验 hash、完整范围、source、graph、policy 和 stop。
后续请求未调度某项不会抹去其此前实际观察；新的实际失败会替换此前完成观察。
source、graph 或 context 变化截断历史；历史仅提供排序和原始候选引用，
本身不能进入本次结果或获得 proof。只有逐 Gate 的完整复验可以接纳候选。
新执行的依赖 manifest 与原消费者引用不一致时，消费者必须新执行。
报告仍独立标记本次未调度且未复验项为 UNPROVEN。
每个根的依赖按冻结顺序先行；未启动聚合项的依赖闭包不能把
无关的已完成前缀升到实际中断项之前。冻结 ExecutionGraph 的
完整范围、原顺序与 digest 不改写；实际顺序写入 Session 的 dispatchGateIds。
取消项从完整入口重启，复用项保留原 manifest、runId 和成本。

`core/operation_observer.py` 在操作开始、结束及每秒采样 owner 存活。
每条样本含绝对时间、phase/stage 与剩余期限；最多保留 256 条并计数丢弃项。
该心跳不是业务进展、等待谓词或性能证明，也不续发任何 deadline。
CLI 在自身生命周期内拥有 stderr 非阻塞模式并在退出恢复原模式。
Observer 检查描述符实际为非阻塞后才写；满管道丢事件，未提供安全流则记录
不可用，不因日志等待阻塞操作。每个 operation 退出时停止并有界 join worker，
证据发布不交给后台线程；报告保留存活 worker 数、丢弃量与输出健康状态。
当前 authority 由 Evidence Store `authoritative_latest` 校验；D-19 interlock、
pending 或 generation 变化不能由裸 manifest 绕过。
原失败、阻断或取消结果不能变为 completed proof。复核成本、本次实际执行成本、
历史成本与本次 disposition 分别记录，复用结果不冒充新运行。
Reporter 与 Gap Detector 消费完整 required report 和原 producer 引用，
损坏引用不能被 passed 文本补足。新源码建立新候选，旧证明全部失效。

明确确认的时间合同修订使用 `--prior-session-manifest` 建立全新 Session；
它与原有 resume/repair 互斥。Runner 验证旧 manifest 的 DURABLE 状态、
原始 ArtifactRef/hash、session inventory 和完整范围，并要求策略确实变化。
新 Session 只保留旧 manifest/session 的 lineage 引用，请求从 1 开始，
不复制旧请求、结果或 PASS。旧源码证据保留原身份，不补写历史记录。
字段为 `cause`、`owner`、`correction`、`qualification`、
`validation_refs`；归因只允许 ARCHITECTURE_OVERHEAD、REQUIRED_DURATION、
PRODUCT_FAILURE、UNKNOWN。UNKNOWN 不允许继续执行。
固定候选执行期间禁止修改源码；新源码使所有旧 proof 失效，
全量要求保持不变。预算执行在 Gate 启动前及清理后复验源码；首次漂移
保留该 Gate 的失败与实际清理结果，记录 `SOURCE_IDENTITY_STOP`，
后续项均为未执行，不继续制造同一漂移下的重复失败。
源码漂移不归类为超时，也不自动恢复、暂存或覆盖外部改动。
重新冻结实际源码后才允许下一轮。下一窗口必须保留 exact source、
范围摘要、policy digest、首个失败阶段、资源清理状态、未执行项与诊断预算。
续跑是新有界请求，先检查候选、范围及资源身份；旧 PASS 不改标为新源码。
成本 profile 只能推荐合法策略，不能改变证明强度、范围或阈值。

## 公共元数据与不可变引用

Evidence Store 是唯一公共元数据序列化 owner。Manifest inventory 只从真实
ArtifactRef 构造；图映射只消费 `compile_graph` 返回的闭合 ExecutionGraph。
图保存原始编译摘要，序列化前复核字段、Gate 集合、依赖顺序与 definition
digest；任意 dict、额外字段和修改后的编译图不能声明公开而绕过秘密检查。
Planner、父 RunHandle 和子 ArtifactSession 的 JSON 写入消费同一个 owner，
不在 JSON 编码后再次用 role/Gate 名删除已经验证的 typed value。
不可变字节审计使用同一个 ExecutionGraph validator 重新验证完整序列化图：
字段集合、Gate ID、依赖闭合与顺序、definition 摘要和图摘要全部有效时，
仅该闭合元数据子树免于 payload 字段名启发式。artifactKind 单独不能授权，
额外字段、缺失字段、摘要或依赖漂移仍按普通 payload 扫描。
写入器对普通 dict 继续使用 payload 启发式；字节复验不赋予写入类型资格，
不跳过注册文件、不改写旧 artifact，也不从图摘要推断 producer 来源。

敏感字段启发式继续用于 payload。公开 role/Gate ID、path、所有引用字符串
仍通过秘密文本和已知秘密值扫描；发现秘密或会改变身份时拒绝写入或发布。
不按业务名称建立白名单，不允许通过 redact=False 关闭持久化秘密检查。
秘密值的编码变体由现有 redaction owner 生成并在单次遍历中复用。

ArtifactRef reader 拒绝额外、缺失和非字符串字段。DURABLE manifest writer
和 reader 均复核完整 inventory 的每条引用、同 run 归属与 SHA-256；
任何引用无法解析都不允许完整性 PASS。三条 finalization publication 路径
共享同一 inventory owner，不回填历史损坏 manifest 或重新署名。

## 验证边界

`tooling/acceptance/tests/test_execution_budget.py` 使用 synthetic fixture
验证不可吞掉的取消、共享 deadline、cleanup/publish reserve、
嵌套 timer 恢复、真实子孙进程终止、无关进程存活、范围完整性，
并通过真实 Runner 验证首个超时后第二 Gate 的 mutation 从未启动。

这些结果证明 Infra 预算边界。它们不证明原生产品可用、
现有业务 Gate 去重完成、真实资源复用成功或全量 MR 已通过。

## 已确认的开销与处理边界

基准负载来自 MR #150 的 `d6466fddf658676dcb2ee80dfd6ec3bf19c6fb99`，
加当前 Infra 工作区修改。每轮保存精确 workspace digest，原始实验
artifact 不重写。原负载为 234 个 Catalog Gate，185 个纳入、49 个排除；
新增 Infra 生产者属于加法闭包，不删除任何原有非 Agent Gate。

控制面开销已观察到全平台 eager import、重复 YAML 子进程、
全域 synthetic path 枚举、重复 scope/stop 展开、重复回归夹具、
目录元数据重复读取和 Python 字节码写入。它们属于架构或工具链开销，
不构成产品必须等待的证明。预算执行显式保留选定解释器并禁止写字节码缓存；
解释器 invocation path 与 resolved path 不视为自动等价或可回退。
Go 工具链由实验 Profile 显式选择当前已观测的实际 `go1.24.6` driver，
保留 GOPATH、GOMODCACHE 和 GOTOOLCHAIN。断网前 `goenv` shim 的有界诊断
在 8 秒内仍未返回 identity；同一已选择 driver 的直接 identity 查询为
0.141 秒。重连后同一 shim 为 0.127 秒，旧瓶颈没有复现，不能继续把它
描述为当前问题。PATH Python wrapper 指向已丢失的临时环境，直接失败；
显式选择的已安装 Python 3.13.5 和 PyYAML 6.0.2 在 0.164 秒内正常返回。
这些是工具环境观察，不能算业务必要耗时，也不通过修改用户全局配置修复。
Profile 和实际 identity 作为外部实验输入保留，Runner 继续继承明确选择的 PATH。
Station ownership Gate 的目录/文件读取由分析内共享输入和固定 16 并发负责；
原有断言、目录排除规则与源码漂移拒绝均保留。重连后的相同完整 payload
在 2.779 秒内退出 0，回归在 1.150 秒内退出 0；旧 I/O 等待未复现。
实验输入、监督器和日志保存到工作区外的持久 machine 目录，不依赖 `/tmp`。

结构检查沿用 Catalog 命令保护与原有清理、发布上界，
删除 tier 通用总时长。复合检查拆成真实共享生产者，各自消费实际 owner
约束。历史 timeout 或复合总时长不能作为单项必须耗时的依据。
全量每轮仍在第一保护超标处暂停并进入修复循环。

具体源码输入 Owner 复用已有 OperationObserver，记录 executable、platform、
Python/Node installation、native libraries、Git configuration 和 Make delegate
阶段；样本只证明 Owner 存活，不控制或更新 probe deadline。
Core 的 `InputIdentityProbeFailed` 保留 Launcher 的原始异常类型、
ResourceDiagnostic，以及各不超过 64 KiB 的 stdout/stderr 尾部。
正常终止但非零退出、超限输出、非法或不完整观察同样保留原 argv、
实际退出码及有界输出；退出 0 不能替代输入资格。非零退出采用
CalledProcessError，不推断未发生的超时或资源故障。
JSON payload 中的 `secretScan` 只有通过同一规范 schema 校验后才保留
状态、计数和脱敏的 artifact 路径；非法字段或值仍遮蔽。聚合与原
manifest 的扫描元数据必须一致，不能靠忽略比较恢复旧证据。
Runner 通过同一脱敏 writer 写入 `input-owner-failure` supporting artifact；
原始证明的 entry validation 失败也保留该诊断。原有 timeout、清理尾部、
完整范围和 proof 拒绝规则保持原义。无法复现的瞬时耗时原因仍未证明，
不得用成功回放替代原失败原因或宣称产品 Gate 已通过。

## 当前控制面切换

- Provisioner registration 使用同一 lazy registry，仅加载选定环境，
  构造策略与 identity 校验仍保留；不在 import 注册时加载 Selenium 或全部平台。
- 所选 Domain/Infra 只扫描自己的 Feature source/synthetic path；
  glob 只需要第一个真实匹配，不枚举依赖和构建目录。
- validator 调用同一规范 Planner 的纯入口，不重复启动解释器。
- knowledge matcher 使用单进程拥有 schema/owns/匹配，shell 仅保留 CLI launcher；
  同一 canonical architecture validator 仍执行。frontmatter 以独立分隔行提取，
  freshness 使用行内关联和实际 checklist/数字标题；Unicode 路径和精确 Git range
  由真实 CLI fixture 验证，不依赖旧 shell 的实现文本。
- Node governance 使用直接声明的 `yaml` 库，删除 Python parser child，
  保留 YAML merge key，限制 input bytes、重复字段和 alias expansion，
  不跳过真实 YAML。
- 结构化 redaction 单次遍历，显式 secret representations 每次调用只计算一次；
  敏感字段、文本和编码变体仍脱敏，产品 proof 不降级。
- scope 在 aggregate 内保存一次，Gate/report 引用 ArtifactRef，
  不在每份结果中重复复制整个范围。


## 可接手的拒绝结果

`BLOCKED` 表示本轮未获得要求的证明，不自动表示产品缺实现、设备不存在，
也不表示还要向人申请一次已授予的开发权限。仅有 Phase/BOM/Spec/Gate
traceability 不能证明诊断完整。

`acceptance-report.py` 通过原始 Gate 的 DURABLE manifest 与 ArtifactRef
读取本轮事实，复验 hash、Gate/run 归属及 aggregate source。资源、原因和
依赖来自 sealed result；caller 修改 aggregate 字段会被标为诊断缺口。
部署 attestation 展示实际服务、endpoint、环境、producer、commit 与
候选 source；二者是已记录的身份值，Reporter 不生成部署、不猜测拓扑。
通用 supporting evidence 可以是 JSON 数组或标量；Reporter 在相同的
inventory 与 hash 校验后解析其真实值类型，保留类型与数组长度，不将其
内容或 caller 标签投影为 Runtime 或部署。`sourceArtifact` 仍必须是对象，
Evidence Store 的对象读取合同不变。合法数组不能被误报为损坏证据。

消费者的 `requiredGateIds` 递归展开为完整根依赖路径，保留原始生产者
manifest 和证据引用。缺节点、环、缺失/损坏 artifact、跨 Gate 引用或
source mismatch 都保留 `DIAGNOSTIC_INCOMPLETE`，不能复制生产者报告并
改写身份。空 services/clients 仅表示缺少该记录，不能推导资源不存在。

根生产者可在其 sealed result 注入 `diagnostic`：

- `owner`：非空责任模块引用；不从技术错误文本推断人名或团队。
- `recoveryAction`：非空、符合现有资源权限与目标合同的恢复动作。
- `resourceChecks`：非空列表，每项声明非空 `resource`、`expected`、
  `state` 和本 Gate inventory 内已验证的 `evidenceArtifact`。
  `OBSERVED` 必须包含 `observed`；`NOT_EVALUATED` 必须说明 `reason`。
  列表必须覆盖该结果的 blockedResource；没有记录、畸形记录和没有
  可验证证据的记录都不能合格。

生产者在探测边界创建 `core/resource_diagnostic.py::ResourceDiagnostic`，
只传实际 `OBSERVED` 或带理由的 `NOT_EVALUATED` 检查。Core 对其进行
不可变复制、字段校验、资源去重与 blockedResource 覆盖校验；
`BlockedError`、Runtime Manifest、命令侧 EvidenceReport 与 ephemeral
channel 保留同一个检查内容，没有诊断时保持缺失。
Native Tauri Station 的 commit/protocol mismatch 由其 Provisioner 在实际
attestation 比较处产生诊断，记录 service ID、Profile、部署环境、期望和
实际身份、端点，以及对该 Profile 的规范部署和读回动作；不能只返回拒绝文本。
同一 Provisioner 的健康检查消费 Core 的实际 HTTP probe，保留 endpoint、
8 秒 timeout、HTTP status 或安全的异常 type/cause/errno，不采集 response
body 与私有 headers。失败诊断绑定 service、Profile、部署环境和恢复动作；
健康准备失败前尚未进行的 source attestation 明确为 `NOT_EVALUATED`，
不能推断源码漂移或设备缺失。其他布尔 readiness 调用复用同一个 probe owner。
通用 Profile/source lease 失败由 `EnvironmentProvisioner` 记录实际租约
获取结果、已配置的部署环境/SSH 端点/路径及原始异常。只有文件锁冲突
实际返回 holder 时才能记录持有者；SSH 握手超时不证明远端锁被占用、
源码漂移或主机不存在。未获租约时，后续源码验证明确为 `NOT_EVALUATED`。
恢复动作定位同一个 reviewed Profile，保留规范租约获取与持有者清理边界。

Native Input policy 的全部拒绝边界必须保留 `ResourceDiagnostic`：
实际 operation、input mode 或 isolation 值、期望 capability、同一 policy owner
及恢复动作。未声明 isolation 按现有合同解析为 shared user session，不推断
硬件缺失或源码漂移。恢复原生 file panel、permission、drag/focus 证明需要
真实 reviewed isolated GUI Runtime Cell；Station Profile 只提供 Station 资源，
不能把 shared user session 改名为 isolated。原生操作及后续未运行断言继续
`BLOCKED/UNPROVEN`，完整的阻断诊断不等于产品 `PASS`。
macOS Cell 的 operator focus 拒绝由该 Provisioner 记录实际 PID、probe 状态
或已超过原有上界的采样状态，不采集窗口标题。恢复动作保留同一语义 Cell、
非侵入式断言及原有 timeout；前台 PID 变化不推断为产品激活失败。
原生探测返回失败时，Driver 保留子进程的实际异常类型、代码函数和行号；
响应解码异常单独记录为 adapterErrorType，不能覆盖原始异常。
不持久化原生控件值或私有异常文本；随后成功的资格检查不能补全旧失败的归因。

Runner 为准备异常和 deadline 生成本 Gate 的不可变失败 observation，
并将原始 Manifest、Report 或 observation 的 ArtifactRef 绑定到每项
检查；生产者不签发自引用 hash。显式失败 observation 优先于清理和
其他辅助 artifact。若清理失败替换了原始阻断原因，最终诊断不能继续
描述原始阻断为最终失败。Reporter 只验真并投影这些原始记录。

`AcceptanceGate` 的普通异常也记录实际错误类型、错误文本和已经观察到的
失败 Step，责任引用为实际 `run` 实现的绝对源码文件和 Gate 类名；
脚本入口的 `__main__` 不是可定位的实现责任引用。该检查描述命令失败，不推断
资源不存在或业务根因。进程 timeout 由 `GateProcessLauncher` 记录实际
命令上界、PID、终止返回码和完成的进程清理，资源为命令进程，
不把无 capability channel 的命令超时描述为缺少 ephemeral context。
Runner 继续绑定原始同 run observation，不改变 proof 或预算。

Chat Fixture 联系人准备按已绑定的 Station 分组。每个远程 Station 在现有租约
内解析并验证目标一次，以一个数据库事务写入该目标的全部定向联系人；每对
联系人的 canonical Friend Request、关系、远端 Actor 和 Federation 断言仍在
事务内执行。失败回滚整个目标事务，不缓存跨 run 或跨租约的目标验证结果。
账号读取、身份漂移检查和 Federation 路由收敛保持原有边界。

Native interactions 的 Step owner 在调用前后写入独立、顺序编号、只写一次的
`acceptance-step-observation`。嵌套 Step 使用同一个事件序列；STARTED 记录
在进程终止后仍可用于定位最后进入的业务边界。它们使用现有 Evidence Store
脱敏与当前 run 写入合同，标记 `SUPPORTING_OBSERVATION/NOT_APPLICABLE`，
不替代断言、完成的产品报告或接收者证明。全部业务轮询经过同一个 Step
owner；predicate observation 保留期望值、实际值或实际异常，以及本次轮询
读取的实际消息、Engine、Group 和 DOM 投影。嵌套等待使用独立采样上下文，
过滤条件返回空值时仍保留底层投影，不把未满足与缺失状态混为一谈。状态改变
时有界采样，已满足条件立即记录，不改变等待断言、轮询间隔或执行预算。
非轮询 Harness 调用按实际 method 与 Actor 记录开始、完成或异常边界，
不记录密码等输入 payload。Station 读回按实际 Conversation 和 Message
记录调用边界；轮询内仅采样实际结果，避免每次 RPC 生成嵌套 Step。
权限负向断言拥有拒绝是否符合预期的判断，RPC 异常 observation 不能
抢先把已预期的拒绝记为 Gate 首个失败。所有事件仍只是 supporting evidence。
登录 Harness 已完成 Actor hydration，interactions 与 product closure
直接核对返回的 Actor ID，
保留原有 device readiness 检查；不再次加载同一 Actor。消费等待记录
`consumptionCount > beforeCount` 的真实基线，避免诊断缺少 predicate 操作数。
Product closure 同样持久化全部外层 Step 及登录/device readiness 的实际
开始、完成和失败边界，保留原始错误与运行身份。步骤观测不签发产品 PASS，
不改变原生输入、接收者断言或等待预算。
弹窗退出后的等待按下一步控件的实际中心命中判断，不按全局
`role="dialog"` 数量判断。Toast 使用同一 ARIA 角色，但其存在不证明
控件被遮挡。调用方明确指定下一步 selector；缺失、断开、禁用、隐藏、
零尺寸或中心命中外部节点均继续等待。真实遮挡保留原有十秒保护，
之后仍执行同一 Selenium 原生点击；不关闭 Toast、删节点或更改动画。
恢复既有 Group 时分别记录进入 Chat、Group 项存在、Conversation pane 存在；
存在性观察保留实际路由、已挂载 Group 和 pane，维持原有 180 秒等待与
0.5 秒采样。离线恢复单独记录重启边界及双端实际 transcript，维持原有
exact equality、离线消息存在断言、180 秒等待和 0.25 秒采样。预算终止后的
最后进入边界只能定位未完成的等待；没有拒绝投影时不得推断产品卡死。
Native AXWindows 失败诊断记录实际 OS 状态码、是否返回 CF 值及窗口数。
读取失败、null 值和空数组不能被解释为 panel 不存在；失败返回的 CF 值仍
由共享 AX reader 释放。实际状态码取得前，不推断窗口消失或产品进程退出。
共享 AX 属性读取只允许明确的 NoValue/AttributeUnsupported 表示可选属性
不存在；AXWindows 必须成功返回值。通信错误保留属性名、真实状态、
值存在性和耗时并立即中断。operator 的全部控制属性消费同一个原始焦点
deadline；每次消息等待最多为 min(0.5 秒, 剩余时间)，调用前后均检查到期，
迟到的返回值释放后仍失败，不继续读取或生成稳定空焦点。
原生 chooser 路径查找先检查同一深度的全部控件，再展开该层；
确认按钮不能因先进入更深的文件列表而漏检。观察和选择共享同一查找器，
保留原有深度上限，所有已复制的子数组在成功或异常时释放。
没有更早目标的实际读取失败仍传播，不把错误当作节点缺失。
Transcript/thread 内部的发送、Reply、Thread 操作分别记录 UI 调用边界；
消息可见性、Thread summary 和双端 exact transcript 轮询记录原始期望、
实际投影或异常。未命中的可见消息检查仍保留实际消息行，不能只记 null。
状态变化有界采样，成功立即记录；外层失败不能覆盖已记录的最内层首个
失败步骤。原有消息集合、顺序、接收者和 Thread 断言保持原样。
Thread 回复由真实 Thread 面板展示。Product closure 先等待 root 的
reply count，再分别通过 Alice/Bob 的可见 Thread 操作打开面板，
比较完整回复 ID、内容、顺序及两端实际 summary；主时间线只比较 top-level 消息。
完整 reply IDs 在 on-visit Thread 加载后才可验证，不能在打开面板前等待
尚未加载的 IDs。Desktop summary 与面板都消费同一个共享 Thread surface
投影 owner；summary 保留独立的实际 DOM 读取，count/IDs 必须精确等于面板。
初始化证明和恢复快照消费同一个面板读取 owner，不再等待已删除的
timeline preview 元素。任何一端内容不一致仍失败。
Interactions 的消息 DOM 检查未命中时保留实际 active conversation、
可见消息行、滚动位置和已打开的 Thread root；这些辅助投影不能使原有
nullable message predicate 满足。

保留会话后的 Native 重启由调用方将 `restore_session` 明确传入
`NativeLaunchOptions`；仅跳过密码登录不能代表绑定采用恢复策略。
恢复分支观察持久化 Station 路由并为新 client generation 生成新的 live
binding proof，不重新配置 Station。Actor、device 和 predecessor/successor
关系仍须精确验证；普通启动保留发现、配置及登录。该参数修复不增加预算，
不跳过设备恢复或接收端断言，完整重启 Journey 仍由当前源码现场执行。

Semantic keyboard sequence 由 Tauri Driver 以一次目标 WebView 的异步调用执行。
每键之间让出事件循环，采用与对应原生 sequence 相同的显式输入间隔，
使 React 有机会提交动作栏焦点及 picker 控件，再从实际 activeElement
解析下一键的目标。单个同步循环不能等价于跨事件循环的真实键盘输入。
等待 interval 为零时也必须让出任务；不增加业务等待预算。Reaction 的
选中等待通过已有 Step owner 保存实际按键、焦点、overlay Message ID 和
click emoji 事件，失败保留截图及 DOM，不能把空 TimeoutException 当作诊断。
键名只记录 Enter、Tab、Escape 和空格的允许集合，避免通用 secret-key
脱敏抹除输入语义；普通字符不记录。键盘观察同时保留动作控件实际
visibility、transition property 与动画时间。动作按钮只动画明确的视觉
属性，不动画继承的 visibility；后台 WebView 的动画停顿不能使已显示的
动作栏控件持续隐藏。此修复不变更按键间隔、焦点顺序或工作预算。

Chat product closure 与联系人 Message 故障场景使用已存在的 Direct TCP proxy。
Runtime Binding 始终通过 canonical Station origin 完成签名发现和 binding proof，
只在 live client 完成发现后应用 opaque handle 到 Direct dial override。Reaction
使用真实 UI 操作，Engine command ledger 前后唯一新增的目标 Message command、
持久化 intent/outbox ID 与 hash、失败计数和终态以及双端可见结果证明 exact retry。
故障只针对已持久化命令的 dispatch：复用 actor-bound lifecycle pause，
让 UI 在健康路由上完成 authority sync、计划校验与持久化；核对唯一新增命令、
intent/outbox 相同 hash、pending 状态及零失败计数后，才 arm TCP proxy 并 resume。
暂停状态在所有退出路径恢复。不得在命令准备前断连并将未创建命令解释为重试失败。
Direct dial override 替换会关闭旧连接；先完成同一 Actor 的 worker pause/join，
再在原 pause-restoring `try/finally` 内应用 override，避免中断正在返回 consumer
epoch 的 inbox claim。替换失败保留原异常并恢复暂停；真实 Native reaction
仍须证明健康路由准备、持久化 hash、故障 dispatch、exact retry 和双端结果。
`attemptCount` 计数失败重试安排，成功提交不自动递增；恢复保留该计数，proxy
恢复后的新转发连接及 `submitted/committed` 状态证明后续提交。加密 TCP proxy
只证明连接丢失与转发，不宣称 HTTP path 或线上 command byte hash。联系人场景
保留 2000ms peer-bound 导航、inline error 与 enabled retry 断言，并通过恢复后的
只读 Direct route probe 验证正常转发。

缺少原因、具体资源、生产阶段、上述诊断或有效证据时，输出逐项缺口，
而非合成完整结论。业务 producer 负责补足业务检查；Reporter 只投影。
消费者继承根生产者的诊断缺口，不伪造自己的资源故障。

报告同时保存 Markdown 与 `acceptance-run-diagnostics` JSON。报告属于
`SUPPORTING_OBSERVATION`，独立记录 observation source 与 reporter source，
其 `proofStatus` 固定为 `NOT_APPLICABLE`，不把历史 PASS 更新成当前证明。
诊断不完整的报告 manifest 为 `blocked/PARTIAL`；
`--require-diagnostics` 在保存报告后以 2 退出，使调用者可拒收不完整交接。
合法的业务 BLOCKED 可以具有完整诊断；诊断完整不等于产品通过。
结构判定的渲染直接复用 `core/execution_graph.py::validate_judgment`。

构建复用和诊断通道不修改业务拒绝条件，不证明跨 Gate Runtime 复用、
共享业务断言或产品证明已完成。

具体资源生产者遵循以下观察边界：

- 凭据只记录解析结果、存在性和安全脱敏条件，不保存值。配置存在不等于
  外部 Provider 已完成投递或授权。Home Station 的通用 CredentialRef
  解析由 Core EnvironmentProvisioner 唯一负责；业务层只保留专有凭据来源
  或产品约束，不复制同一个通用解析过程。
- 服务 attestation 保存 live/deployed commit、目标和实际 source 状态；
  Station 与候选源码不同的恢复动作是部署到已绑定的 reviewed 目标并读回。
- Mobile preflight 保存 Appium status/version 与实际设备 inventory 数量。
  inventory 命令未成功时，设备检查为 `NOT_EVALUATED`。Host 的 FCM/APNs
  配置检查明确属于 prerequisite-configuration，不能代替推送结果。
- Linux Cell 的 Profile、部署描述符、host 和 ready document 分别有自己的
  资源观察。未获得 ready document 不足以判断 display 是否可用。
- retained-current-profile 检查既有 Alice/Bob worktree 和身份存储。新建
  worktree 或启动新客户端不能证明 retained Engine 的恢复行为。
- Mobile W5 场景若只分派到声明性拒绝过程，诊断记录缺少可执行 Gate
  Journey，并将产品依赖状态标为 `NOT_EVALUATED`；常量中的旧拒绝文本
  不是当前产品缺实现的证据。

NCP 的独立 Compose 集群在 active reviewed remote Profile 上创建。
远端 env-file 来自该部署的 reviewed Compose 命令，并在创建集群前检查
文件可读性及所需凭据声明。stop/readback 从原 Runtime Manifest 的
`profile.resolvedName` 解析目标，不使用后来选择的 active Profile。
消息发布客户端使用 resolved Profile 和 Station 服务角色，Agent Profile
约束只适用于 Agent Gates。Profile 选择和源码部署不降低产品断言。
