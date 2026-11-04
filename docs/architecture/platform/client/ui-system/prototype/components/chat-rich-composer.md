# 富输入（迁移增量 13）

> **Status**: draft · **Created**: 2026-10-31 · **Owner**: Client Platform · UI System
> **旧来源**：社交聊天 `components/chat/ChatComposer.tsx`、
> `composer/useChatVoiceRecorder.ts`、`composer/useChatAttachmentDrafts.ts`、
> `AttachmentItem.tsx`、`AttachmentDetailHost.tsx`、`composer/useChatScreenshotCapture.ts`

## 1. 产品边界（全部 peers-ui，本地真实状态）

- **工具行**：表情、文件、截图、语音、展开/收起五入口；录音/语音草稿期间其余入口与发送禁用。
- **表情**：Popover 40 枚 4 组，最近使用写入 localStorage（≤24），按光标位置插入并回焦。
- **附件草稿**：文件多选/粘贴图片/拖放添加；缩略图或类型图标 + 名称/大小，
  确定性进度条 uploading→ready；≥8MB 首传必失败（本地示例策略），红卡可重试（第二次成功）或移除；
  上传中/失败时发送禁用。
- **截图**：桌面壳是屏幕捕获；浏览器原型诚实地映射为「选择图片文件」（accept=image/*），
  走同一条草稿→就绪→发送链路，不伪造系统截图。
- **语音**：真实 `getUserMedia` + `MediaRecorder`，红点秒表录制行（×取消 / ■完成），
  草稿行用同一 `VoicePlayer` 试听/拖进度/丢弃/发送；发出后是气泡内语音条（播放/暂停/seek/时间），
  权限拒绝/环境不支持给红色 Alert，不静默。
- **消息内附件**：图片缩略气泡（点开详情 Dialog，含真实 blob 下载）、
  文件卡（类型/大小 + 详情 Dialog，保存本地副本；系统打开/密文下载诚实标注随桌面壳接线）。
- 附件/语音发送后会话行预览变为 `[图片]`/`[文件]`/`[语音]`。
- 输入框展开/收起真实切换 4 行↔10 行（aria-pressed）。

## 2. 旧设计审计

- 旧 composer 是单文件 900 行（附件/录音/emoji/拖放/展开/能力开关混排）。
  原型拆为 `ChatComposer`（编排）、`ComposerAttachments`（草稿 hook + 草稿卡）、
  `VoiceNote`（录音 hook + 播放器）、`MessageAttachments`（气泡渲染 + 详情宿主），
  ConversationView 不再内联输入区。
- blob URL 所有权：发送即转移给消息气泡，草稿清理**不**回收；
  只有显式移除/放弃草稿才 `revokeObjectURL`（修掉了发送后图片 ERR_FILE_NOT_FOUND、语音不可播）。
- 旧实现依赖 Tauri 暂存与截图 IPC；原型用确定性本地状态模拟上传生命周期，
  但录音坚持走真实 MediaRecorder，探针以 fake-media Chromium 驱动真实链路而非桩。
- 旧版还有另一个 `components/composer/ChatComposer.tsx`——那是 **Agent** 聊天输入区
  （agent 附件/流式停止），不属本次社交聊天范围。

## 3. 只读分享页的审计结论（不迁移）

旧 `pages/SharePage.tsx` 是 **AI Agent 会话**分享（Bot/User 角色、Markdown 渲染、
`/api/share/:token`），属于既定排除的 AI 域；社交聊天没有对应的只读分享能力。
按「不做烟囱原型」原则本增量不新建分享视图，原计划清单项以审计结论关闭，而非伪造一个社交分享页。

## 4. 组件与探针落点

- 新增：`chat/ChatComposer.tsx`、`chat/ComposerAttachments.tsx`、`chat/VoiceNote.tsx`、
  `chat/MessageAttachments.tsx`；`chat-data.ts` 增 `MessageAttachment`/`voiceUrl`；
  `chat.css` 增量 13 段（工具行/草稿卡/录音行/播放器/附件/详情 Dialog）。
- 探针 runner 增强：`setFiles` 操作（真实 Buffer，PNG/large/text 三种载荷），
  Chromium `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`
  与 microphone 权限、自动播放放开——用于驱动真实录音/回放断言。
- 新增 6 场景，能力 **75/75 OBSERVED**（双宽溢出门同过）：
  `composer-emoji`、`composer-attachment-file`（发送→文件卡→详情 Dialog）、
  `composer-attachment-image`（截图入口→图片气泡→图片 Dialog）、
  `composer-attachment-retry`（失败→重试就绪→移除；失败态语义）、
  `composer-voice`（真实录音→完成→发送→气泡 available→播放 playing=true，finalizer 暂停）、
  `composer-expand`（aria-pressed）。consumer 18/18，tsc 干净，0 console error。
  Playwright 双宽 Journey 截图核验表情面板/进度卡/图片 Dialog/文件 Dialog/录音行/试听行/语音气泡。

## 5. UNPROVEN

真实 Tauri 文件暂存/截图捕获与密文附件下载、系统级「打开方式」、录音最长时长与
后台打断策略、多附件消息在 MLS 消息类型上的映射、附件可见域（public/chat/private）徽标、
视频附件（原型按普通文件入列，不内联播放）、社交只读分享页（产品上不存在）。
