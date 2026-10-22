# 飞书助手 — 原型

> **Status**: draft
> **Prototype Review**: pending-review
> **Version**: v1.6
> **Created / Updated**: 2026-10-18
> **Owner**: Agent / Channel

本文是 [Agent 子模块文档集](../../README.md) 的原型专题；
生产能力与运行时所有权仍由 [Agent](../../../README.md) 合同定义。

## 原型位置

实现位于 `packages/prototypes/desktop/shell/src/LarkChannels.tsx`，
样式位于同目录 `LarkChannels.css`。原型复用 Desktop Shell、全局 Settings
和现有 LobeUI，不创建独立站点或 Portal 卡片。

入口为 `Settings → Channels → Lark`，审阅 query 为 `?state=lark-settings`。
`Bots` 与 `Lark` 是同级入口；Message Publishing 只作为底层复用框架。

## 交互模型

原型呈现 `connections[] + selectedConnectionId` 的名单/详情模型：

1. 空名单或页面头部点击 `Add Lark connection` 后保留当前页面，打开居中 Dialog；
   每次打开都创建新的空白会话，不恢复上次输入。
2. Dialog 使用“创建托管应用 / 使用已有应用”Tab 直接切换表单，不再为方式选择
   单独占用一步或渲染大卡片；托管应用提交后才进入扫码状态。两种方式都只取得
   应用身份并生成同一种 Lark Connection。
3. 新连接不携带 Agent。进入详情后才按需配置默认响应 Agent；会话 Agent 是更下游
   的路由覆盖，不参与应用绑定和能力校验。
4. 名单展示所有独立连接、默认身份和运行状态；点击进入选中详情。
5. 每个详情用一个紧凑工作区承载可选默认响应 Agent、连接状态、应用身份、路由、自动化、
   授权和测试消息；宽屏双列、窄屏单列，不再使用大型绑定示意区。
6. 高级能力按用户意图进入聚焦页面，并返回该连接的可管理对象：
   - 会话 Agent：创建、编辑、暂停、恢复、删除和刷新后草稿恢复。
   - 自动化：创建、编辑、试运行、最近投递、暂停、恢复、删除和草稿恢复。
   - 个人 Lark：授权中、身份读回、过期、重连和确认撤权。
   - 已有应用：字段校验、能力检查、自动修复、新增连接或确认替换。
   - 测试消息：接收人、文本、发送中、送达、失败与重试。
7. 连接级操作包含新增、设为默认、暂停、恢复、打开会话、活动诊断和确认删除。

新增流程以本机参考工程 `Channels → Add Channel` 为交互校准：复用其“当前页上方
Dialog”的空间关系和连续任务语义；不同接入方式按 Peers 的高密度原则收敛为 Tab，
视觉使用紫色 `action.primary`、8px 控件圆角和 Quiet Protocol Minimalism，不复制
参考工程的黑色按钮或大卡片方式选择。

私聊、群聊、话题、图片和文件不作为预配置模式。切换连接不会重置对象；
扫码和已有应用新增都不会覆盖现有连接。原型不持久化新增会话或 App Secret；
生产合同由 Station 加密持久化 Secret，客户端不保存也不回显。

## 运行方式

在当前工作区执行 `make run-prototype`，以命令实际输出端口为准。
端口占用时 Vite 会递增，不能仅凭历史端口判断工作树。

本轮审阅地址为 `http://127.0.0.1:3201/?state=lark-settings`；
`3201` 已通过进程工作目录确认属于当前工作区。

## 证据状态

L1：`LarkChannels.tsx`、`LarkChannels.css` 已实现多连接集合、单区选中详情、
一次性新增会话和每连接业务草稿。Desktop Shell production build 与 Desktop
聚焦 ESLint、完整 applet 预构建及 Desktop Vite production build 已通过；
build 仅有既有的 chunk size warning。
Desktop 全量 `tsc` 仍被 `CronJobDrawer.tsx` 对已移除 `Channel` / `ChatTarget` /
`listChannels` 接口的既有引用阻断，错误不涉及本页文件。

L2：本轮已实际检查 804×749 视口。空态、新增 Tab Dialog、托管应用表单、
已有应用空态/就绪态、双连接名单和未配置 Agent 的连接详情均无文本覆盖或控件重叠；
已有应用就绪态不再产生 3px 内滚或把确认按钮藏到可视区外。主操作使用 Peers 紫色，
表单保持双列。

L3：已在真实页面完成当前多连接版本回归：

- 空名单 → 新增 Dialog → Tab 表单 → 扫码 → 首个连接；再次新增仍不离开当前页。
- Dialog 关闭后焦点回到新增按钮；再次打开时平台恢复 Feishu，App ID 与 App Secret
  均为空，旧新增会话没有进入 `localStorage`。
- 托管扫码与已有应用都创建 `agent: ""` 的同型连接；详情显示默认响应待配置，
  列表显示 `No responder configured`，连接身份区不再展示 Agent 绑定图。
- 两个连接分别配置 Agent、保存草稿/对象和测试投递，来回切换状态不串写。
- 默认切换、暂停/恢复、删除默认后的提升、会话入口和活动诊断。
- 会话偏好创建、编辑、暂停、恢复、删除、重复会话校验和刷新后草稿恢复。
- 自动化创建、实时预览、编辑、试运行、结果读回、暂停、恢复、删除和刷新后草稿恢复。
- 个人 Lark 授权、身份读回、撤权确认、过期与重连；依赖个人资料的自动化暂停。
- 已有应用空值拒绝、能力检查、缺失项修复、新增连接和确认替换；关闭后再次新增
  不恢复 App ID、App Secret 或平台字段，App Secret 未写入原型持久化。
- 测试消息文本、目标、发送、结果读回、失败与重试。
- 高级意图标题获焦；确认弹窗初始焦点、Tab 闭环、`Escape` 关闭与触发器焦点恢复。

组件树审查：该原型沿用 Settings 的 `on-visit + none` / selected-only 边界；
高级编辑器按意图单独挂载，不隐藏挂载所有表单。草稿外置到 prototype workspace
状态，因此离开编辑器和页面刷新均可恢复。未改变生产 Settings 的 Alive 分类，
无需修改 frontend component tree registry。

## 已知边界

扫码、OAuth、测试消息、自动化和故障恢复均为本地模拟。
原型不创建 Lark App、不取得 token、不读取消息或个人工作资料。
生产运行时、真实媒体理解、群上下文、国际版、生产多连接、Mobile 和 L4
端到端验收均为 UNPROVEN。

当前界面使用英文产品文案；生产 i18n、暗色、缩放和完整辅助技术验收尚未完成。
