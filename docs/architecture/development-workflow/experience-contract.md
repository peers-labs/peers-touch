# Peers Dev 体验合同

> **Status**: active
> **Created**: 2026-09-26 | **Updated**: 2026-09-30
> **Owner**: Platform Team
> **Module**: `apps/dev/`

---

## DEV-J01: 安装并绑定

**Actor**：在明确选定的 worktree 中启动 Agent 的开发者。
**Decision**：DWF-D26。

1. 开发者运行 `make skills IDE=trae`。
2. 安装过程验证 canonical source，写入受支持的宿主投影，并通过已安装路径执行
   合成回调。
3. 第一个真实且可阻断的 `PreToolUse` 创建一次 conversation binding。
4. 后续工具调用复用同一 binding，不受当前 shell 目录影响。

成功结果必须同时证明已安装 Hook、回调可达、执行根不可变且 workspace identity
一致。Doctor 汇总这些检查，但每次结果只对当时的安装与源码有效。

回调缺失、宿主合同不受支持、稳定 conversation identity 缺失或执行根不匹配时，
必须返回 typed failure，且不得显示为 `INSTALLED` 或 `ENFORCED`。

## DEV-J02: 观察正在执行的工作

**Actor**：观察 Plan Run 的开发者或 reviewer。
**Decision**：DWF-D27、DWF-D29。

1. Peers Dev 列出已注册或只有声明的 worktree。
2. 每个 worktree 分别展示 Plan progress 和 current Task stage。
3. 当前 Agent 活动在不整页刷新的情况下更新。
4. UI 区分 working、waiting、blocked、stalled、looping 和 drift。
5. 用户无需读取 machine file，即可识别当前 Task、最后动作、下一 closure 和
   状态新鲜度。

UI 保持只读。恢复动作只能显示为可复制的 owner command，浏览器不得直接执行。
在当前源码和 Acceptance 尚未证明 DWF-D27/DWF-D29 前，这一 Journey 必须标记
为 `UNPROVEN`。

## DEV-J03: 审查完成声明

**Actor**：检查 Task 或 Plan 完成声明的独立 reviewer。
**Decision**：DWF-D28；失效后的重开遵循 DWF-D24。

1. 实现达到其正常验证边界。
2. Review owner 捕获当前 Git identity 和声明的完成义务。
3. 与实现上下文不同的 reviewer 执行仓库检查并记录 findings。
4. 只有所有 required finding 关闭后，`PASS` receipt 才有效。
5. Task/Plan closure 在同一 source、obligation、candidate 和 evidence digest
   下读取该 receipt。

当源码、Plan 义务、Gate 定义或 required evidence 改变时，receipt 进入
`STALE`。历史 receipt 可以保留用于审计，但不能授权完成；需要重开源码时只能由
DWF-D24 定义的 Plan owner 路径执行。

## DEV-J04: 诊断产品真值

**Actor**：排查文档承诺与运行现实不一致的开发者。
**Decision**：DWF-D30。

1. 开发者调用唯一 Doctor 入口。
2. Doctor 检查安装、conversation binding、Plan/Task/Session ownership、
   Action Receipt、Completion Review 和 Peers Dev server。
3. 每条可执行 README 承诺映射到一个机器检查和 typed result。
4. 任一 required promise 为假时，命令以非零状态退出。

`make workflow-doctor` 是唯一公开入口；它必须从当前源码运行后才可作为该次
诊断事实。

Doctor 输出不得泄露凭据、原始 conversation identifier、用户主目录绝对路径或
原始命令日志。

## DEV-J05: 在规范 owner 中开始下一 Plan

**Actor**：在稳定 canonical owner worktree 中连续维护同一模块的开发者。
**Decision**：DWF-D31。

1. 当前 Plan 达到 `completed`。
2. 开发者释放 declaration、active-work 和 runtime lease。
3. 新 Plan 以当前 workspace、branch 和 immutable initial HEAD 创建。
4. 开发者以 expected generation 调用 `make plan-binding-advance`。
5. binding owner 保留旧 generation 记录并原子推进当前指针。

任何未完成 Plan、live owner state、generation mismatch 或 history tamper 都
必须无 mutation 地拒绝。Agent 不得以新建 worktree 作为恢复动作。

## DEV-J06: 一次准备多模块开发资源

**Actor**：要求 Agent 实现并验证一个跨 Agent、Relay、Station、Desktop 或
Mobile 模块任务的开发者。
**Decision**：DWF-D32。

1. 每个受影响模块先输出标准 `ModuleImpact`，不直接部署或申请账号。
2. Dev Workflow 合并全部影响，解析 target 依赖和可并行 wave。
3. 资源计划对账号、服务、客户端、设备、Fixture 和自动化 session 去重，并
   展示峰值需求。
4. 健康且身份匹配的资源被复用；漂移资源按 owner 能力选择 restart、build 或
   provision。
5. 容量不足时只 park 冲突 target；不相关 target 继续。
6. 每个 ready target 的 claims 一次性进入现有机器工作账本，随后由 Runtime
   Owner 执行并返回 manifest。
7. Acceptance Gate 只 attach 到已准备 manifest。

开发者可观察的结果必须明确说明哪些 target 会运行、哪些资源被复用、哪些需要
重建或创建、哪些 lane 被 park，以及原因。执行过程不得重复创建同一账号/客户端
或用全局锁串行化无关模块。

## Recovery Contract

- 缺少 Plan 或 declaration：显示缺失 owner 和预期 owner command，不猜测 Plan。
- Hook 不可用：阻止 mutation，并报告缺失的宿主能力。
- Source drift：使 Completion Review 失效，并按 DWF-D24 要求 fresh review。
- Loop/stall：展示重复 action fingerprint 或 stale interval，不改写 Task 状态。
- Dev server protocol 不兼容：拒绝复用；兼容的 machine-wide singleton 可由
  任意 worktree 查看，并显式展示 serving-source freshness。
- Browser/API failure：保留最后一个有效 Snapshot，并显示其年龄。
- Overlay 试图改变执行政策：按 DWF-D25 忽略其政策影响并返回 typed denial。
