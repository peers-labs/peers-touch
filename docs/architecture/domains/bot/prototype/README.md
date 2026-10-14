# Bot 能力 — 原型

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-11 | **Updated**: 2026-10-12
> **Owner**: Architecture Team

---

## 原型在哪

`packages/prototypes/desktop/features/bot-inbox/`（pnpm workspace 内独立 Vite + React 工程，`hidden: true`，不产生 Portal 平铺卡片）。

```bash
cd packages/prototypes/desktop/features/bot-inbox
pnpm install --no-frozen-lockfile
pnpm dev          # http://localhost:3108
pnpm build        # vite 构建自检
pnpm typecheck    # 仅本包 tsc（跨包预存在错误见“已知差异”）
```

Bot 会话与消息**复用 social-chat 原型**（生产 1:1 对齐的 ChatArea/SessionList），
不复制聊天面；social-chat 仅增加默认休眠的 additive seam：

- `MockConversation.type` 增加 `'bot'`、`MockMessage.type` 增加 `'bot-event'`；
- `Avatar` 增加 `botIcon`；
- `ChatArea.registerBotEventRenderer()` 注册点（social-chat 自身不注册，行为不变）；
- `useChatState(seed?)` 支持 seed 与 `ingestInboundMessage`（外部注入 + 折叠）。

bot-inbox 提供事件卡片渲染器、Bots 设置、菜单栏驻留层与事件模拟器。

## 落地目标

Desktop（`apps/desktop`）：聊天时间线内的 Bot 事件消息、全局 Settings 的 Bots 管理、
Tauri tray 驻留 + OS 通知。原型仅为 web 形态，落地时按 Tauri tray/notification 运行时重新实现。

## 怎么跑 / 看什么

右侧「事件模拟器」是纯本地 mock 的事件源（agent 在窗口隐藏时仍是外部进程，故模拟器在任何窗口态都常驻）：

1. **Bot 是普通会话**：会话列表里"Claude Code 通知员"与真人并列（bot 字形、无锁、头部"非端到端加密"）。
2. **事件卡片**：任务完成 / 等待确认 / 任务失败 → 时间线内结构化卡片（severity 色条、agent/workspace/session、"打开 Claude Code"深链按钮）。
3. **折叠**：连续点"等待确认（重复，折叠）"→ 会话内折叠为一张 ×N 卡片，只产生一条 OS 横幅、角标只增一次。
4. **菜单栏驻留（核心）**：切"隐藏到菜单栏"→ 窗口收起为桌面壁纸，顶部菜单栏 Peers 图标常驻；触发事件 → 右上角 OS 横幅；点"查看"→ 恢复窗口直达 Bot 会话。
5. **两类总线来源**：Bot 消息（message arm）与"纯系统通知"（notification arm，无会话）走同一焦点/静音横幅策略；纯系统通知不增加菜单栏角标（角标=未读会话数，BOT-D13）。
6. **静音 / 焦点 / 离线**：静音不弹横幅但未读照记；聚焦当前会话不弹横幅；离线时事件不入（恢复后补）。
7. **Bots 设置**（左下"Bots 设置"）：创建（URL+secret 仅一次 + hook 片段）、轮换（URL 不变）、停用、吊销。

## 对应设计

Journey：BOT-J01 设置、BOT-J02/J05 会话与折叠、BOT-J03 菜单栏触达、BOT-J04 恢复、BOT-J06/J07 拒绝与吊销。
决策：BOT-D03（消息+通知两通道）、BOT-D05（非 E2EE 视觉）、BOT-D09（tray）、BOT-D13（角标=未读会话）。

## Craft Quality 合同（§7 Surface Quality Contract）

- **Thesis**：agent 在别处忙完，用户即使把 Peers 收进菜单栏也能被可靠叫回，并一键跳回 agent。
- **Surface type**：高频工作流（Quiet Protocol Minimalism）。Main subject = 时间线里的事件卡 / 隐藏态的 OS 横幅。
- **Boundary**：menu bar（OS 层）· banner floating layer · chat content rail · simulator action rail · 壁纸 recovery layer。
- **Signature feature（一个）**：菜单栏驻留下"OS 横幅 → 点击深链恢复直达会话"。
- **Inherited rules**：复用 social-chat token（surface/text/action/border/radius role）与行结构；OS 菜单栏/横幅为暗色 OS surface，使用独立的 OS 暗面 token，不污染聊天 token。
- **Positive calibration**：bot 与真人在同一列表/时间线；无 E2EE 锁但有明确"Station 可读"信任标记；折叠降低打扰；角标语义唯一。
- **Negative calibration（已拒绝）**：另起 bot 聊天壳、generic card grid、装饰渐变、紫色头像当锁、纯通知推高会话角标、每条重复事件弹横幅。

## L2 / L3 证据

截图由 playwright-core + Chrome headless 真实渲染/点击生成（`shots/capture.mjs`，视口 1440×900 @2x）：

| 文件 | 状态 | 判定项 |
|---|---|---|
| `shots/01-default.png`、`02-card-avatar.png` | default，窗口聚焦 | bot 在普通会话列表；事件卡带 bot 头像（1:1 会话不重复发送者名）；无锁；角标=未读会话数 |
| `shots/01-bot-header.png` | 打开 bot 会话 | 头部无"非端到端加密"文案，改为琥珀色警示 icon + hover tip；副标题只留"自动化 Bot · Station 托管"（不显示人类在线状态）；无语音/视频呼叫入口；底部输入框替换为"单向发布通道、暂不支持回复"提示条 |
| `shots/01c-bot-detail.png` | 头部"…"直达详情（bot 不经过呼叫模拟器） | 身份区无 presence、无 Posts/Followers 社交计数，仅"自动化 Bot · 常驻可达"+ Technical details（PTID/Home Station）；唯一 SECURITY 区块为琥珀色"非端到端加密 · Station 明文"+ 不发送敏感信息提示，无 safety number 入口 |
| `shots/03-hidden-banner.png` | 隐藏到菜单栏 + 两次等待确认 | 单条 OS 横幅（折叠 ×2）；菜单栏驻留；模拟器常驻；角标只增一次 |
| `shots/04-settings.png` | Bots 设置 | 账户级 Bots 列表、轮换/停用/吊销主次与 destructive 分级 |
| `shots/05-create-form.png`、`05-create-form-typed.png` | 创建 Bot 对话框 · 阶段一 | 单一对话框：名称输入 + 头像入口 + 通道说明；名称为空时"生成通道与 Secret"禁用；取消不产生任何资源；05-typed 展示创建时选定的预设头像 |
| `shots/06-credentials-revealed.png` | 同一对话框 · 阶段二 | 提交后 URL/Secret/配置片段在原对话框就地揭示（不再弹第二个 modal）；Secret 自动选中且标注仅显示一次；新 Bot 行即时入列；"再创建一个"回到阶段一，"我已保存，完成"关闭；遗失经轮换恢复、URL 不变 |
| `shots/09-avatar-picker.png` | 创建对话框内叠层头像选择器 | 实时预览；上传图片（image/*、≤2MB、dataURL 本地保存）、8 个预设图标 × 6 底色、恢复默认；非法文件行内报错 |
| `shots/07-avatar-picker-row.png`、`07-settings-custom-avatars.png` | 列表行头像编辑 | 行头像右下相机角标打开同一选择器（吊销态禁用）；确认后行头像即时更新；两个 Bot 可分别自定义 |
| `shots/08-chat-avatar-propagated.png` | 返回聊天 | 头像单一事实源在账户级 Bot 设置，经会话补丁 + profile store 双路同步：会话列表、时间线事件卡（含 ×2 折叠卡）全部一致；头部仍为琥珀警示 icon |

L3：成功路径（横幅→查看→恢复会话）、折叠、静音/焦点/离线分支可在 `pnpm dev` 手动复现；`capture.mjs` 覆盖点击链路。
L4 Runtime Quality（语义/对比度/长列表/真机性能）：`UNPROVEN`（web 原型不证明真机 tray；以 Tauri 打包 Journey G-BOT-06 为准）。

## 总账状态

drafting（见 `docs/architecture/engineering/prototypes/README.md`）。Owner 确认且无 L2 阻断后置 `confirmed`，方可作为落地依据。

## 已知差异 / 待补

- 菜单栏与 OS 横幅是 **web 模拟**（浏览器无法驱动真实系统 tray/通知中心）；真实交互以 Tauri 打包 Journey 为准。`L2 blocked: 真机 tray 外观`。
- 仅表达 macOS 菜单栏形态；Windows/Linux tray 与暗色主题另计。
- 未模拟 CLI 本体与 Station 后端；事件直接注入前端状态。
- social-chat 包存在 master 既有的跨包 tsc 噪音（onHangup、borderSecondary、React18 类型等，非本次改动引入）；本包自有文件 tsc 干净，vite build 通过。
- 头像上传（FileReader → dataURL）已经 Playwright `setInputFiles` 真图验证（选择器预览、列表行、会话列表、时间线卡片一致）；生产形态为 Station 托管的图标 URL，非 dataURL。
- v1 Bot 为单向通知通道：会话内不提供回复输入（输入区为说明条）、无呼叫入口、详情不提供 safety number；交互式回传不在本期。
- 多账号 Bot 管理（多 Bot 各自的会话种子与模拟器事件路由）不在本原型；当前仅种子 Bot 关联真实会话。
