# Gate 执行预算、共享证明与修复循环

> **Status**: experimental implementation
> **Created**: 2026-10-22 | **Owner**: Acceptance Infra

## 本轮职责

目标是研发 Gate 执行架构。MR #150 是固定候选验证负载，
不以完成 MR 验收为本轮成功标准。用户已授权先审查适用性、落地首版，
再执行除 Agent 及其配套之外的全量范围；任何首个超标必须暂停后续调度，
随后原地诊断、修复、记录和自验，再冻结新候选继续循环到可用版本。
只有归因或影响边界无法可靠判断时才请求用户决定。

执行预算属于性能实验合同，不替代产品阈值、Catalog timeout、
Runtime Profile、证明合同或 Evidence Store。数值是显式实验阈值，
不是历史 P95，不允许自动扩大以获得通过。

## 适用性审查

当前方案适合分阶段落地，不能声称现有 Gate 已具备完整场景复用能力。

- `acceptance-run.py` 当前只对命令设置 timeout，资源准备、清理、
  evidence 扫描与发布缺少统一生命周期上界。这是 Infra 缺陷。
- shell 子进程超时可能遗留后代。预算实验沿用已有
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

完整执行模型仍见 [proposals/execution-model](proposals/execution-model/README.md)。
本版实现预算、显式结构检查依赖图和修复循环。业务 case/断言生产者、
跨 Gate 原生资源共享及产品 input→receiver 细粒度计量仍是后续注入范围。

## 唯一执行入口

`tooling/scripts/acceptance-run.py` 继续拥有真实范围与执行。
新增参数：

```text
--all-gates
--exclude-domain <registered-capability-domain>
--exclude-gate <exact-catalog-gate-id>
--execution-budget <explicit-json>
--stop-on-failure
--resume-session <previous-paused-session-json>
--repair-record <qualified-repair-json>
```

`--all-gates` 与 Gate/Plan/tier/completion/full 选择器互斥。
排除域仅排除所有声明 owner 均属于排除域的 Gate；
共享 Gate 和无 Capability 映射的 Gate 保留。
`catalogExecution: manual` 的 Gate 保留精确 `--gate` / Plan 调度能力，
但不进入 `--all-gates`：它们要求人工观测、外部输入或显式诊断上下文，
自动全量运行不得把输入缺失制造成产品失败。未知值在范围冻结时失败。
精确排除项必须真实存在。每个 Catalog Gate 都保存纳入/排除理由、
Catalog 执行模式、Capability 引用与定义摘要，整个范围保存摘要。

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

图 artifact 保存原始选择、完整依赖、调度顺序及定义摘要。
效率报告给出实际 dispatch 数、共享引用数、Gate 总时长、观测 P95 和超标项。
P95 是本次已调度 Gate 的样本分位数，不冒充产品效果时延或长期控制面 SLO。

预算格式为闭合 JSON 对象：

```json
{
  "requestSeconds": 3600,
  "planningSeconds": 5,
  "default": {
    "totalSeconds": 180,
    "cleanupSeconds": 30,
    "publishSeconds": 15
  },
  "tiers": {
    "ci-structure": {
      "totalSeconds": 30,
      "cleanupSeconds": 5,
      "publishSeconds": 10
    }
  },
  "gates": {}
}
```

优先级是 exact Gate、tier、default。总预算包含工作、清理与发布，
工作可用时间为 total−cleanup−publish。Catalog command timeout 仍生效，
实际命令最多使用它与工作剩余时间中的较小值。
每个阶段消费同一绝对 deadline，后续 RPC 不重新获得完整预算。
request deadline 到期后停止启动新工作，仅允许预留的清理和发布尾部。
最终 aggregate 发布另有 20 秒上界，异常停止记录最多 5 秒。

## 生命周期与异常

`core/execution_budget.py` 定义纯预算、范围冻结和单 Gate 时钟；
Runner 在真实 owner 调用边界记录 source、resolve、credentials、
provision、runtime-cell、launch-context、command、cleanup、scan、
finalize 与 publish。使用 monotonic clock，当前 granularity 明示为
`owner-boundary`，不伪造未观测到的业务 Step 或产品效果时延。

实验 synchronous owner deadline 使用 POSIX main-thread `setitimer`。
取消异常继承 `BaseException`，普通 retry/polling 不得吞掉它。
不支持的平台在执行前 fail closed，不能声称 Windows 生命周期已验证。
子进程仍由已有 launcher/adapter 拥有；远端任务和自主新 session
不因本地进程组退出而被证明已清理。清理失败必须保留 `UNPROVEN`。

第一次工作超时进入清理，清理共享预留预算；发布再共享其预留预算。
清理或发布超时同样停止后续 Gate。发布异常不能重写 sealed Gate，
停止诊断写入独立 Evidence Store run，属于 supporting evidence。

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
- 工作边界超时先记 `UNKNOWN`，需检查工具链、准备与真实操作；
- 必要业务时长必须有产品合同及观测支持；缺失时记
  `mandatoryDuration=UNPROVEN`，不得凭宽松旧 timeout 判断合理。

暂停后先做有界诊断，修复并自验后允许新 attempt；不得停在记录问题。
`core/execution_session.py` 记录完整范围、attempt、归因、修复和验证引用，
未知归因进入 NEEDS_JUDGMENT。它不编辑源码或授权资源，不生产产品 proof。
Runner 的实际结果和异常停止记录都生成 immutable session ledger。
恢复必须同时提供暂停 session 和修复记录；修复记录的验证 ArtifactRef
必须在同一个 Evidence Store 内可解析且 hash 有效，范围与预算不得改变。
字段为 `cause`、`owner`、`correction`、`qualification`、
`validation_refs`；归因只允许 ARCHITECTURE_OVERHEAD、REQUIRED_DURATION、
PRODUCT_FAILURE、UNKNOWN。UNKNOWN 不允许继续执行。
固定候选执行期间禁止修改源码；新源码使所有旧 proof 失效，
全量要求保持不变。下一窗口必须保留 exact source、
范围摘要、policy digest、首个失败阶段、资源清理状态、未执行项与诊断预算。
续跑是新 attempt，先检查候选、范围及资源身份；旧 PASS 不改标为新源码。
成本 profile 只能推荐合法策略，不能改变证明强度、范围或阈值。

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

结构预算依旧 30 秒总预算，含 cleanup 5 秒、publish 10 秒。
复合检查拆成真实共享生产者，各自接受预算约束。历史 timeout 或复合总时长
不能作为单项必须耗时的依据。全量每轮仍在第一超标处暂停并进入修复循环。

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

本轮只补报告与诊断验真，不修改业务拒绝条件，不证明跨 Gate Runtime
复用、共享业务断言或自动成本优化已完成。
