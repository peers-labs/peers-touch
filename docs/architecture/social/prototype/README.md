# Social Chat — 原型

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-02 | **Updated**: 2026-07-08
> **Owner**: Chat / Social
> **Module**: `packages/prototypes/desktop/features/social-chat/`

---

## 原型在哪

`packages/prototypes/desktop/features/social-chat/`

这是 Desktop 站点下的 Chat 局部能力原型，不是一级站点，也不是最终产品代码。可预览入口收敛到 `packages/prototypes/desktop/shell/`：Social Chat 作为 Desktop Shell 内的 `chat` 页面承载，不再作为 Prototype Portal 顶层独立卡片展示。

## 落地目标

落地目标是 `apps/desktop` 的社交聊天体验：

- 私聊会话列表、消息阅读流、composer、私聊详情。
- 群聊会话列表、群聊消息阅读流、群详情、成员管理与权限差异。
- Chat 模块内的 `Chat` / `Contacts` 竖向二级 tab。
- stream call：从 Chat 会话头部的语音 / 视频按钮进入，以会话内浮层、HUD、toast 和紧凑状态 chip 展示。
- Conversation action surface：静音、置顶、背景、搜索、清空历史、退出/解散/删除。

原型只用于确认终态交互形态；确认后仍需在 Desktop 真实工程按运行时、store、i18n 和权限模型重新实现。

## 怎么跑

```bash
make run-prototype desktop
```

进入 `Desktop Shell` 后，从左侧「聊天」入口打开 Social Chat。

也可在原型包内单独运行，仅用于开发调试：

```bash
pnpm --filter @peers-touch/prototype-desktop-social-chat dev
```

## 对应设计

本原型覆盖 `docs/client/chat/chat-ux-contract.md` 中的核心 Chat UX 合同：

- `MessageItem -> Bubble -> Content -> MetaRow -> ActionAnchor` 消息语义。
- `HeaderRect / MessageViewportRect / ComposerRect / FloatingLayerRect` 边界。
- 私聊详情：身份验证、安全号入口、背景、搜索、清空历史、删除/屏蔽类风险动作。
- 群聊详情：成员预览、添加成员、管理成员、owner/admin/member 权限差异、退出/解散。
- Trust state：稳定加密/验证状态压缩为 quiet chip；群详情不展示原始加密指纹。
- Stream call state：idle / outgoing / incoming / active / reconnecting / ended / failed，评审状态切换折叠在 Chat header 的 `...` action menu 内。

## 总账状态

`pending-review`

原型已能跑、能点，并已登记在 [原型统一入口](../../prototypes/README.md)。下一步需要 Owner 确认后才能推进为 `confirmed`。

## 当前覆盖面

- 私聊样本：已验证在线、未验证离线、普通加密会话。
- 群聊样本：当前用户为群主、管理员、普通成员三种权限态。
- 消息样本：文本、系统消息、图片、文件、失败发送状态。
- 操作样本：发送 mock 消息、打开详情、成员管理、角色调整、禁言、转让群主、清空历史、退出/解散确认。
- 通话样本：语音/视频呼出、来电、接通、弱网重连、结束、失败提示。

## 已知差异 / 待补

- 原型使用 mock 数据，不接 Station、Desktop Rust、实时同步或真实端到端加密。
- `UNSYNCED`：真实 Desktop 在 X3DH 进行中显示 `Establishing secure channel…`，
  且只在 DM/MLS 会话真实 ready 后显示锁图标；当前原型仅覆盖稳定加密态。
  下一步由 Chat / Social Owner 在原型状态切换器补 `establishing` 态并完成 L2 截图确认。
- 同名联系人现在按 PTID 保留独立行，并在 Contacts / Create Group 中以两条
  可完整阅读的次级身份行分别展示 Federation 与 Home Station domain。头像
  fallback 以 PTID 而不是显示名稳定取值，且统一由方形 Avatar 组件控制圆角。
- Create Group 原型现在使用可见联系人选择，并覆盖“失败后保留选择 + inline error
  + Retry”的恢复态；第二次提交进入 mock 成功态。该 mock 只证明交互形态，
  不构成真实 MLS 或 Native Acceptance 证据。
- 文件/图片只展示交互卡片，不做真实上传、预览或下载。
- 搜索入口、背景选择入口只表达 action surface 的位置和层级，未实现完整搜索结果页。
- Owner 确认前不得把本原型当作真实 Desktop 落地依据。
