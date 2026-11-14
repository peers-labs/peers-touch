# IDE 与 Agent 提示接入

> **Status**: active
> **Created**: 2026-09-19 | **Updated**: 2026-10-16
> **Owner**: Platform Team

## 1. 接入目标

TRAE、Cursor、Codex 使用仓库内同一组规范和 Skill，宿主 adapter 仅处理事件及输出格式。Hook 可选，负责补充上下文；宿主不提供身份或阻断能力时，仍可按项目规范开发。

本文描述当前接入合同。各宿主现场观察是支持性诊断，不因某宿主离线回调成功就宣称所有 IDE 可用。

## 2. 项目归属

从结构化任务根、工具工作目录和文件目标核对 canonical worktree；多根冲突时跳过可能归属错误的自动提示，保留简短诊断。

安装源目录、Hook 文件所在位置、活动编辑器和 folder 顺序不构成任务工作区。明确任务工作区仍是 Agent 的执行范围；Hook 不提供任意 shell 的强制跨目录写保护。

每个项目 Hook 只响应解析结果等于自身安装 root 的事件。多根 workspace 中，宿主级
`repo_working_dir` 不能单独选择 worktree；必须有明确 task root 或工具工作目录。
解析到兄弟 root 时该 Hook 返回 `NOOP`，无法唯一解析时不注入上下文，也不写
worktree observation。

会话字段可用于脱敏诊断。缺少字段不伪造身份，不创建 OWNER，不领取 grant，也不要求另开会话才能使用 Skill。

## 3. 提示输出

保留现有事件归一化和各宿主支持的上下文格式。只注入相关规范、知识和明确选定任务的简短进度；无 task 选择不记录任务轨迹。

流程 Skill 默认必须执行；只有用户在当前 scope 显式声明跳过才可豁免。Hook 仍不提供
DENY 阻断（见下条），因此这条规则通过上下文注入表达而不是机械拦截：`SessionStart`、
`UserPromptSubmit` 与压缩事件都会带出该口径。`PreCompact`/`PostCompact` 是恢复边界——
压缩会用摘要替换实时上下文，故二者归一化为有效事件并返回 `CONTEXT`，明确要求先经
`pt-god-view` 重新入场、再恢复所属流程 Skill，禁止把冻结 Plan、交接摘要当作流程已执行
的证据；`SubagentStart`/`SubagentStop` 归一化为有效事件但保持 `ALLOW`，不产生提示。

未知事件、未知工具、输入错误、知识缺失或内部异常采用中性输出并安全退出，不能产生普通工具 DENY 或 Stop 阻断。输出有大小和耗时上限，诊断不得带原始 prompt、凭据、会话 ID 或命令日志。

宿主不支持上下文输出时，报告该提示能力不可用。不得把提示伪装成已经执行的验证或授权。

### 3.1 工具与技能调用追踪

Hook 不能阻断，但可以留痕。`PreToolUse`/`PostToolUse` 归一化后保留宿主原始
`tool_name`（同一字段跨 trae/cursor/codex），由 `hook-entry` 以 best-effort 方式
追加到当前 worktree 本地的
`.dev-workflow/observations/skill-events.jsonl`，每行记录
`{host, event, toolName, isSkill, at}`。写盘失败只输出诊断，不改变 ALLOW/CONTEXT 决策。

追踪文件与 `worktree.json` 一样只允许写在 worktree 内部：宿主 hook 子进程（尤其
命令执行类工具）运行在文件系统沙箱内，只保证对执行 worktree 的写权限，写入机器级
`~/.peers-touch/dev/` 会确定性失败。跨 worktree 的可见性由非沙箱 CLI 工具以只读
拉取方式统一收集（显式 `workspaceRoots` 或经 machine registry 的
`registeredCanonicalRoots` 发现），收集方只读取、不回写。

- `isSkill` 由保守规则（工具名包含 `skill`）判定，只用于检索，不作为合规权威。trae 已
  实测技能工具名为 `Skill`，与该规则一致；cursor/codex 的真实技能工具名待真机确认后再收紧。
- 追踪复用多根归属判定：当 `executionRoot` 无法唯一解析时不写记录，宁可缺记也不把事件
  记到错误 worktree（与 §2 的多根保护一致）。
- 描述符对失效 worktree 条目具备韧性：`workspaceContext` 跳过磁盘上不存在或非目录的
  folder 并在 `skippedFolders` 报告，只有零个可解析 root 才判 `TRAE_WORKSPACE_DESCRIPTOR_INVALID`。
  因此单个被删除的 sibling worktree 不会再让整个多根 workspace 的 hook 失活。
- trae 已用真实 hook 链路验证：普通工具（`RunCommand`/`Read`）与技能调用（`tool_name="Skill"`，
  pre/post 均触发、带顶层 `cwd`）都能正确落盘，`isSkill` 分类正确；cursor/codex 走同一归一化
  代码路径，结构上已覆盖但尚未做真机验证。

## 4. 安装与审计

复用现有 `make skills IDE=<host>` 入口。只更新明确选定 worktree 的 Skill 与项目配置，不写全局 Hook，不自动修改共享 workspace descriptor 或其他窗口。

安装流程核对源与目标真实路径、符号链接边界和配置合并范围；保留非项目条目。Skill 投影和 Hook 状态分开，不用机器开发总账、OWNER 或 Action Receipt 授权安装。

多根 workspace descriptor 只用于验证选定 root 的成员身份并向 Hook 提供只读上下文，
不能把一次安装扩大成跨根 rollout。每次安装只写 `--root` 指定 worktree 的项目配置；
每条托管 Hook 命令中的 `hook-entry.mjs` 必须解析到同一 worktree。迁移多个 worktree
必须逐根执行和审计；没有本地插件源的 root 只能移除托管条目，不能借用其他
worktree 的 Hook。审计必须独立检查命令归属，不能只复用安装器生成的 expected 配置。

发现本机解释器后，写入正确引号包裹的绝对命令；自检使用落盘命令原文及受限 PATH。不能重拼 argv 或继承完整终端 PATH 来代替。

解释器缺失或 Hook 失败时说明提示不可用；Skill 仍可安装和使用。配置未加载时只说明提示待生效，不停止正常研发。

审计只检查目标 worktree 的源、投影、配置和命令，不枚举或评估目标外 worktree，
不修复其他记录，也不要求 PlanMount、Session 或工作登记。

## 5. 切换和回退

当前工作区的源码、Skill 和消费者完成一致迁移后，才更新该工作区安装。仍在执行同路径的旧实例需先到安全边界；不能强杀其他任务或删除其机器记录。

临时目录验证配置安装、移除和恢复。真实安装需明确选定范围，额外 worktree 按批准列表逐个验证；原范围授权不扩展为全机 rollout。

回退恢复已知源码与该次配置，不重置环境、数据库或锁。历史 OWNER、grant 和 work.json 不参与新流程；它们的清理不作为安装前提。

## 6. 验证结果如何报告

离线检查分别说明命令能执行、输出格式正确、工作区选择正确。真实宿主还要确认工具调用是否发生、宿主是否接受上下文，以及关闭提示后同任务能否继续。

尚未真实验证的宿主显示未验证；不能用“已安装”合并这些结果。验收见 FLOW-A03—A06、A20 的[清单](./acceptance-matrix.md)。

真实宿主观察不进入整体完成 Gate，也不需要仓库内捕获器。需要排查宿主差异时，
开发者可在已授权的目标配置中手动启用或移除 Hook，核对上下文与工作连续性；
结果明确标为现场观察，不能替代当前源码测试、运行准入或产品 Acceptance。
