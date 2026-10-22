# 验收耗时调查

> **Status**: draft
> **Created**: 2026-10-22 | **Updated**: 2026-10-22
> **Owner**: Acceptance

## 证据范围

源码基准为 `d6466fddf658676dcb2ee80dfd6ec3bf19c6fb99`。
调查对象包括 Runner、Suite、等待器、Plan/架构校验调用和已结束运行的 manifest。
历史采样限定 workspace `48035cb460a725a5`、原 release completion 的 67 个 Gate，
时间窗口为 UTC 2026-10-17 至 2026-10-22。

可读取的匹配样本为 17 个 Gate、114 次已结束运行、60 个源码提交。
未覆盖其余 50 个 Gate、尚未结束的运行、其他 workspace、临时 Evidence Store，
也没有覆盖 Agent 调试、人工操作、构建与两次运行之间的全部时间。
不能把这些样本当成完整发布运行或当前源码通过结果。

## 运行与返工成本

**观察事实**：114 次历史运行中，28 passed、65 failed、21 blocked。
失败/阻塞占次数约 75.4%，占累计已记录运行时长约 76.5%。
这不是“机器误判率”或 flaky rate；真实产品故障、准备问题与源码迭代都可能包含其中。

这些 manifest 的 createdAt → completedAt 累计为 20,540.833 秒，约 5.71 小时。
该样本的时间区间没有相互重叠，合并区间时长与累计值相同。
记录横跨 2026-10-18T18:42:55Z 至 2026-10-21T12:12:03Z。
日历跨度与已记录工作时长之间的差额不能自动归为“人等待”，因为大量运行未采样。

主要成本集中：

- `mobile-social-ios-native`：54 次、43 个源码版本，累计 10,022.145 秒；
  单次中位数 196.127 秒，最大 270.038 秒。
- `social-cross-station-mobile-desktop-e2e`：28 次、17 个源码版本，
  累计 7,277.590 秒；单次中位数 314.628 秒，最大 454.853 秒。
- 两者合计占这批样本的运行时长约 84.2%。
- 相同 Gate＋相同源码出现 15 组多次运行，共 27 次额外 attempt。
  缺少完整 case/fixture/runtime 身份，不能将这 27 次直接判为冗余。

**推断**：除了去重，必须减少每次失败后的完整准备/重跑，
缩小源码迭代后的受影响验证范围，并尽早给出可定位的失败原因。
上述跨源码中位数只描述历史样本，不能作为同配置 SLO 的 P50/P95。

## 超时预算缺少端到端约束

**源码事实**：原 release 的 67 个不同 Gate 的 Catalog timeout 合计
154,230 秒，约 42.84 小时。这是串行上限之和，不是实测耗时或并行关键路径。

Access 9 个、Chat 19 个、Moments 5 个 Gate 的不同项 timeout 合计分别是
24,600、40,800、40,200 秒。若按旧 Task 先后执行相同 Chat/Moments
functional/proof 两轮，这三个 Task 的 timeout 额度合计达到 186,600 秒，
约 51.83 小时；仍只是允许的预算，不是一次实际运行时间。

Runner 的多个 Gate 循环串行执行；仅逐项声明 timeout 无法约束“多快返回答案”。
一个有实际失败的运行可能在多项宽松 timeout 中逐个耗尽预算。
目标应包含全图 deadline、首个诊断 deadline 和所需能力闭包的关键路径估算。

## 等待会放大不可恢复错误

**源码事实**：`chat/native_support.py:723-740` 的通用 wait_until
默认最多等待 120 秒、每 0.25 秒轮询，捕获任意 Exception 后继续等待。
如果谓词持续抛出 session 无效、selector 无效等不可恢复异常，也只在 deadline
后报告最后一次错误。不同等待器的异常/进度语义没有形成统一合同。

**推断**：多个边界等待串联可放大一次根因的反馈时间。
没有逐次 probe/exception/状态计时，当前无法给出该问题占总耗时的比例。
优化应区分 pending、retryable、terminal，并优先观察明确的状态变化。
轮询仍可用，但不能把业务 mutation 放进自动重试谓词。[cite:3]

`mobile/simulator_station_lifecycle_e2e.py:212-230` 的 suspend→等待→resume
包含 310–360 秒的真实路线过期等待，这是合同相关成本。
不应简单缩短或用虚拟时钟替代正式现实时间证明。
可以由业务注入短 TTL 的等价测试条件，但必须保留声明清楚的真实配置 case，
并把不可压缩等待计入单独的 slow-lane 下界。

## Plan 解析卡在外部解释器边界

**源码事实**：`plan-package.mjs:1194-1347` 的 loadPlanPackage 会执行
validateRegisteredArchitecture；`module-governance.mjs:1106-1124` 再校验完整 registry。
后者在 `:418-422` 为外部 YAML registry 调用 `spawnSync('python3', ...)`，
该子调用没有自己的 timeout。

当前 registry 有 13 个模块，但只有 1 项外部 capability registry 引用。
因此本次不能把卡顿解释为“同一检查重复启动几十个 YAML parser”。

**现场观察**：在仓库外临时探针中记录实际调用边界，
20 秒总 deadline 前只记录到读取
`docs/architecture/engineering/api-governance/station-api-capabilities.yaml`
的 Python child-start，没有 child-end；探针按自己的 deadline 终止进程组。
这是诊断采样，不是官方 Plan 校验结果。

进一步的解释器启动探针：

- 当前 PATH 的 Python，直接 `print` 的 3 秒 probe 未产生输出。
- 同一解释器加 `-S`，3 秒 probe 也未产生输出。
- 系统 Python 的相同 `print` probe 完成，包含启动与工具等待约 0.447 秒。

这些观察把卡点缩小到外部解释器启动/执行边界；未确定其安装、装载或
运行环境层面的根因，也未证明系统 Python 已安装所需 YAML 依赖。
目标需要显式可用工具链、有限子进程 deadline 和可归属的错误；
不能悄悄跳过 registry 验证或把这个 YAML 文件当成 JSON。

## 取证成本需要显式预算

**观察事实**：历史 whole-product usability 运行
`20261021T111045392102Z-57ab4db4276c770c4bf782ab1bd3ae91`
的 manifest 引用 1,958 个实际文件，合计 224,504,084 bytes，约 214.10 MiB；
createdAt → completedAt 为 567.778 秒。

源码 `simulator_whole_product_usability_e2e.py` 按 surface 和 viewport/text-size
cell 展开捕获。这些组合可能是完整可用性合同的必要维度，文件多本身不证明重复。
但全产品审查不应成为每次小范围修改的默认验证。
需要按选定合同生成受影响组合，只保存 required evidence，
失败时再在有界范围内增加诊断。没有 span，当前不能证明该运行的 I/O 时间占比。

**观察限制**：这 114 个样本中未提取到可用的 Step duration 数组。
源码已有部分 `step()/durationMs`，但不足以恢复跨进程、
前置准备、等待、断言、清理与发布的完整时间线。
不能因此宣称全仓库完全没有步骤计时。

## 可复用机制与边界

OpenTelemetry 提供 span、事件、上下文和 span links，适合表达 Suite、
case、跨端操作及多消费者的因果关系；不需要自建 tracing 协议。[cite:1]
Acceptance 当前 Python requirements 没有 OTel SDK；Station 已有 OTel 相关依赖
和 Prometheus facade，但这不证明 Acceptance 已接入观测。

Bazel 的 action inputs/outputs、action cache 与 CAS 提供构建复用的参考：
显式输入匹配后复用产物，而不是以命令名字判断可复用。[cite:2]
本提案不要求迁移整个项目到 Bazel。
构建/确定性解析缓存与真实外部世界的产品证明具有不同语义；
Native 历史 PASS 仍不能直接迁移到新源码。

Playwright 的条件断言提供有界等待的参考机制；现有 Tauri/Selenium/Appium
运行时保留，通过已有 adapter 表达就绪/状态/可见结果，
不为了这些机制替换原生验证栈。[cite:3]

## 来源

<a id="cite-1"></a>[cite:1] [OpenTelemetry：Traces](https://opentelemetry.io/docs/concepts/signals/traces/)。
核对日期 2026-10-22；用于 span/event/link 机制，不提供本项目性能基线。

<a id="cite-2"></a>[cite:2] [Bazel：Remote Caching](https://bazel.build/remote/caching)。
核对日期 2026-10-22；用于显式输入与产物缓存，不用于继承 Native proof。

<a id="cite-3"></a>[cite:3] [Playwright：Assertions](https://playwright.dev/docs/test-assertions)。
核对日期 2026-10-22；用于条件等待机制，不用于宣称原生 App 已验证。

仓库源码定位：本文列出的 repo-relative 路径和函数；历史采样脚本、
逐 run 的 manifest SHA-256、probe 输出保留在仓库外诊断目录。
用户可审阅副本附派生的 history-summary.json；
它是历史耗时统计，不是正式 Runtime report 或 current-source PASS。
