# 架构模块治理 - 集成

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-27 | **Updated**: 2026-09-27
> **Owner**: Architecture Team

---

## 1. 当前到目标映射

| Concern | 当前机制 | 目标机制 |
|---|---|---|
| 文档结构 | 固定文件名与元数据 | 保留，并增加按模块特征推导的内容要求 |
| 架构完整性 | 方法论人工检查 | `architecture-modules.json` + 共享 validator |
| Plan architecture sources | 仅检查路径存在 | 同时校验模块状态、文档、决策和 capability 引用 |
| 编辑前知识 | Skill 约定人工执行 | PreToolUse 读取 knowledge 与架构源并生成 receipt |
| Review | knowledge path 匹配 | changed paths 同时校验 knowledge 与模块契约 |
| 接口治理 | 专用 registry 各自运行 | 模块声明引用专用 registry 的当前 capability ID |

## 2. 接入边界

### 2.1 Architecture Documents

`docs/global/architecture-document-standard.md` 增加内容 profile、状态边界和
正向声明规则。现有模块不批量迁移；被修改的 active 模块必须在同一变更登记。

### 2.2 Station Access Lifecycle

Station Access Lifecycle 作为首个回填模块：

- 补齐 `data-model.md` 与 `module-layout.md`；
- 统一文档状态为 `active`；
- 只描述当前接入能力和 target layout；
- 引用 Station capability registry 的当前 capability ID；
- 删除基于已移除名称的库存文件和扫描入口。

### 2.3 Plan Package

`plan-package.mjs` 只对 registry 已登记且被 Plan 引用的模块执行语义校验。
未登记存量模块继续通过原 schema，直到其首次文档变更触发登记。

### 2.4 Workflow Hook

`workflow-kernel.mjs` 在现有 declaration、scope 和 worktree 身份检查之外，
调用共享 parser。Context Receipt 不改变原有授权结果，只能：

- 在匹配成功时附加 compact context；
- 在 registry 或必读真源不可用时拒绝写入。

### 2.5 Review And CI

`knowledge-match.sh` 保留 knowledge frontmatter 新鲜度检查，并将 changed paths
交给共享 parser。正式 `architecture-module-governance` Gate 覆盖：

- registry 与当前仓库；
- Plan integration；
- Hook context receipt；
- Review changed-path integration；
- Station Access 首个模块回填。

## 3. Rollout

1. 先落地标准、治理模块和首个 Plan。
2. 建立 parser 与正向 registry。
3. 接入 Hook、Plan、Review 和 CI。
4. 回填 Station Access 并删除迁移词汇和库存。
5. 以后每个被修改的 active 模块在同一变更中登记。

这是单向收敛。没有关闭校验、忽略模块或恢复黑名单的兼容开关。

## 4. 非声明

- 不宣称所有存量架构模块已经回填。
- 不改变任何业务协议或产品行为。
- 不把历史 Git 对象转成当前架构输入。
- 不用静态治理 Gate 替代产品运行时 E2E。
