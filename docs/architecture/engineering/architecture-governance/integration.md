# 架构模块治理 - 集成

> **Status**: active
> **Version**: v1.4
> **Created**: 2026-09-27 | **Updated**: 2026-10-20
> **Owner**: Architecture Team

---

## 1. 当前到目标映射

| Concern | 当前机制 | 目标机制 |
|---|---|---|
| 文档结构 | 固定文件名与元数据 | 四类 taxonomy index + 嵌套 module root + 按特征推导的内容要求 |
| 架构完整性 | 方法论人工检查 | `architecture-modules.json` + 共享 validator |
| Plan architecture sources | 仅检查路径存在 | 同时校验模块状态、文档、决策和 capability 引用 |
| 编辑前知识 | Skill 约定人工执行 | PreToolUse 读取 knowledge 与架构源并生成 receipt |
| Review | knowledge path 匹配 | changed paths 同时校验 knowledge 与模块契约 |
| 接口治理 | 专用 registry 各自运行 | 模块声明引用专用 registry 的当前 capability ID |
| 跨客户端复用 | package/Cargo manifest 隐式共享 | 推导共同 direct dependency 并要求 capability 登记 |

## 2. 接入边界

### 2.1 Architecture Documents

`docs/global/architecture-document-standard.md` 增加内容 profile、状态边界和
正向声明规则。分类 README 只组织导航，module ID 与物理 basename 解耦；被修改的
active 模块必须在同一变更登记。

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

### 2.6 Agent Integration

`agent-integration-control.py` 与 `agent-integration-audit.py` 把共享 parser
纳入 canonical integration catalog。安装回执因此绑定 Hook、Kernel 和 parser
的同一源码摘要；宿主 adapter 仍只转换输入输出，不解析 registry 或修改回执。

### 2.7 Cross-Client Reuse

当 registry 包含 `cross-client-runtime`：

- 读取 Desktop/Mobile pnpm manifest 的共同 workspace dependencies；
- 通过 pnpm 自身 resolver 解析 `pnpm-workspace.yaml` package identity；
- 通过 `cargo metadata` 读取 Desktop/Mobile 的共同 normal path
  dependencies；
- 将每个 manifest 及其 Desktop/Mobile consumer 映射到同一 capability；
- 要求每个共同 dependency 只有一个匹配 capability，并按 Cargo portable core
  或 shared platform adapter、`packages/client-*`、`packages/ui/*` 校验
  `reuseLayer`；
- validation result 输出 capability ID、owner、canonical roots、allowed
  dependencies、evidence Gates 与 reuse layer，形成可审计的共享能力清单；
- 未登记共享依赖返回 `ARCHITECTURE_REUSE_UNREGISTERED`。

`architecture-registry-self` 的有界续跑输入由具体 metadata Owner 核验。
除 Node 与 `yaml` 安装外，还核验 pnpm 实际 package、加载 image、有效配置与
workspace list，及 rustup 实际选择的 Cargo delegate、配置 include 图和
Desktop/Mobile `metadata --no-deps` 结果。源码测试的临时 fixture 父目录
独立核验配置与默认 delegate，不能由当前 worktree 的 toolchain override
代替。Gate 与只读探针均关闭 Node compile cache 和 pnpm package-manager
自动跳转，临时 fixture 继承同一环境；缺失或变化保持重新执行，
不从纯 Node version、wrapper hash 或空输入声明推导复用资格。

Shared package capability 的 `contractRoots` 同时登记 package manifest 与
当前语义 Owner 源文件。Desktop/Mobile manifest 证明直接消费关系；具体
Presentation Policy 通过独立 `presentation-policy` capability 登记并显式依赖
对应 headless capability。当前 Chat 分别登记
`client.chat.presentation.desktop` 与
`client.chat.presentation.mobile`，不把 Form 分叉误记为 reuse divergence。

共同 dependency 有多个 owner、缺少分类或分类与 manifest 类型不一致时返回
`ARCHITECTURE_REUSE_INVALID`。Model contract、Desktop/Mobile Presentation
Policy 与 Android/iOS adapter 仍由其上游架构边界治理；dependency inventory
不会把这些 authority 转给共享 package。

语义相似但没有共同 manifest 的重复实现由 Cross-Client Runtime 的
`CCR-G10..CCR-G12` review contract 处理，validator 不使用高误报的文本或文件名
启发式判断。已接受的例外必须写入 registry `reuseDivergences`，并引用当前
capability、accepted decision、实现路径、consumer、evidence Gate 与 review
trigger；路径必须由 registered architecture module 治理，Gate 必须存在于
Acceptance registry，悬空记录返回 `ARCHITECTURE_REUSE_INVALID`。

### 2.8 Architecture Document Index

`document-index.mjs` 读取现有 `architecture-modules.json`，生成
`docs/architecture/README.md` 的 active module 索引。它不解析代码来发明模块，
也不维护第二份 module manifest。

canonical 图在所属模块目录用 `*.diagram.json` 声明稳定 Diagram ID、module、
viewpoint、layout、layout-specific scene 与单一箭头语义。`diagram-render.mjs`
按 C4 上下文、逻辑分层、运行拓扑、复用带、权威矩阵、时序泳道和控制闭环分别
生成独立 SVG，并校验边界、节点重叠、节点引用、文本容量、正交路径和标签遮挡。
`document-index.mjs` 扫描真实 Markdown SVG link，输出
`docs/architecture/references.md`。只有链接或嵌入具体 SVG 资产的引用进入反向
索引；仅链接文档不冒充图引用。

`diagram-render.mjs --check` 与 `document-index.mjs --check` 对已提交生成内容做
精确比较。生成后还必须把 SVG 转成位图做人工视觉检查；schema 通过不能代替层次、
文字和连线路由检查。Registry、Diagram spec、SVG 或引用变化后未重新生成会失败。

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
