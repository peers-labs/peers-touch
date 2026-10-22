# Lark Plan Package · 评审

> 日期：2026-10-15
> Reviewer：当前 Agent，独立 findings-first 内容审查
> 结论：结构校验通过；执行准入未通过；全部产品能力仍未验证。

## 评审输入

- [Plan Package](./plan.md) 与全部 `tasks/LARK-*.md`。
- [完整能力及恢复模型](plan.md)。
- 当前工作区 `AGENTS.md`、`pt-plan-and-document`、`pt-execution-plan-guardian`。
- Agent 根模块与 Modern Chat Agent 的产品、架构、权限、附件及执行合同。
- 当前源码存在性、工作区身份，以及实际 `make plan-validate` 输出。

## 已确认的结构与方向

- 唯一 Plan Package、唯一 Acceptance Execution，23 个 Task 与 closure 一一映射。
- Manifest 为 `draft`，Task 全部 `pending`，无 current Task、空 durableEvidence。
- 原始能力范围保留：真实媒体、工作工具、群、卡片、OAuth、运维。
- 工作写入拆分为文档、云盘和其余已登记扩展，不能以一个示例证明全部动作。
- 复用 Station admission/附件准入/审批；插件不成为第二 Agent 或凭据 owner。
- 持久入口与独立投递、开通 reservation、授权隔离、终态 revision 与失败恢复明确。
- 正式 Task 声明聚焦检查、真实 Journey 与 Acceptance，未执行结果不标 PASS。
- runtimeReuse 放在 Suite scope，场景 attach-only；规模参数是规划预算，不是已测性能。
- 提交、推送、PR、部署、重置和历史改写没有被虚构为已授权。
- `make plan-validate PLAN=docs/architecture/domains/agent/execution-plans/20261015-lark-capability-closure/plan.md`
  返回 `ok:true`、`status:draft`、`taskCount:23`，完成数为零。

## 执行前仍须关闭的 findings

### F01 · 唯一源码根与集成边界

当前包绑定 `peers-touch/master`，其 Channel Proto/Station 模块不存在。
引用的实现来自 `peers-lark/feat/lark-channel`，不是本包的执行根。
LARK-00 必须确定最终源码根与基线，或得到明确的源码集成授权。
不能直接复制另一工作区的文件，不能恢复用户删除内容，不能自动 rebase/切换工作树。
结构校验允许规划新路径，但这不证明既有代码已在当前根，也不授权跨工作区写入。

### F02 · 新产品、架构与原型准入

用户已确认四组完整产品范围。[Lark 产品合同](../../lark/README.md) 已明确
入口、旅程、状态、权限与恢复；[可执行原型](../../lark/prototype/README.md)
已接入全局 Settings 并登记为 pending-review。
新的具体交互仍待 Owner 确认，架构决策尚未正式准入。
不能把已有 Agent 原型确认或四组范围批准扩展成这版 Lark UI 已确认。
涉及 UI 的 Task 必须先取得对应确认；纯后端契约不应为形式主义建立原型。

### F03 · 业务 Gate 与真实适配器

`lark-*-e2e` 和 `LARK-J*` 是计划要求的标识，尚无业务 injection 或运行证据。
`journey.py` 是待实现入口。LARK-00 明确动作清单后，对应 owner 必须提供真实适配器和 Gate。
不得用 SOURCE_CHECK、静态规则、空跑或临时假接口制造 FUNCTIONAL_PASS。
LARK-18C 必须按完整参考扩展清单继续细分，否则无法形成所有工具的闭合验收。

### F04 · 资源、协议与迁移

当前授权包没有新部署/重置权限或现成 Suite manifest。
国际版账号、租户管理员审批、图片/文件和两用户隔离各需真实条件。
Proto-first 的具体 request/event/action/resource/receipt 需在开工前完成 schema 评审，
并明确全部消费者、错误码、兼容切换、持久迁移和不删除用户数据的回退方式。
缺资源只阻塞相关依赖；不能新造环境、借内部登录或暗中扩权限。

## 后续准入

完成 LARK-00 的来源与授权确认，并关闭对应 upstream finding 后，才把包推进到 prepared。
再按当前工作区工作流建立合法执行状态并派发实际可执行 Task。
此评审不选择执行根、不创建机器 Plan binding、不发布产品完成声明。

## 评审覆盖与限制

已覆盖所有 Task 的结构、依赖、范围、证据类别和失败边界。
没有运行任何 Lark product Journey、业务 Gate 或部署；没有证明任一功能已实现。
