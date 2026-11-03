# 附件详情下载流（补齐增量 18）

> **Status**: draft · **Created**: 2026-10-31 · **Owner**: Client Platform · UI System
> **审计来源**：`packages/prototypes/desktop/features/social-chat/src/components/ChatArea.tsx`
> 的 `FileAttachmentCard`（含 1040 宽文件详情 Modal）与 `AttachmentDetailHost.tsx`。

## 1. 从真身补齐的功能点

文件消息卡片点击后打开详情，状态机：**remote → downloading → ready / cancelled**：

- 打开即自动开始传输；确定性进度（每 250ms +20%），进度条带百分比。
- **取消下载**（downloading 中）→ cancelled 态；**重新下载**（cancelled 中）重新走进度。
- ready 后：
  - 文档类（pdf/docx/xlsx/pptx/txt/md）进入内嵌预览：**上一页/下一页（2 页）**、
    pdf/docx 的**缩放选择**（适合宽度/整页/实际大小）、xlsx 的**工作表切换**（Report/Summary）+ 表格网格。
  - 非文档类显示「无可用内嵌预览，保存后用系统应用打开」。
  - 底部动作：**系统预览 / 用其他应用打开 / 保存副本**——前两者就绪前禁用并说明原因，
    就绪后在浏览器壳点击给出明确反馈「没有可用于打开此文件的应用」（不假装能打开）。
  - 保存副本走真实 blob 锚点下载。
- 描述行实时显示 `类型 · 大小 · 状态`（下载中/已取消/已下载）。
- 图片消息保持独立灯箱（增量 13）。

## 2. 与真身的差异（诚实边界）

真身的「下载」对应密文附件从 Station 拉取+解密；原型附件是 composer 本地选择的 blob，
因此进度是**确定性模拟**，传输的是同一个 object URL，不存在真实网络/解密。这一点在文案与
本合同中显式标注，避免把本地副本误认为端到端下载。

## 3. 探针（能力 91/91 OBSERVED，consumer 18/18，0 console error，双宽溢出全绿）

- `attachment-transfer-cancel-retry`：打开即 downloading → 取消（data-transfer-state=cancelled）
  → 重试 → ready 且文档预览出现。
- `attachment-doc-paging`：PDF 第 1/2 页 → 下一页 2/2 → 末页下一页 disabled → 缩放选择存在（含 craft battery）。
- `attachment-workbook`：xlsx 标记 data-workbook=true、工作表选择、表格、就绪后保存副本 enabled。
- 旧 `composer-attachment-file` 收尾改 Escape（详情 footer 不再放关闭钮，关闭走 Dialog ×）。

## 4. UNPROVEN

真实密文下载与解密、取消的网络竞态、大文件断点续传、系统应用注册与打开、
Office/PDF 真实解析渲染、另存为对话框（Tauri shell 能力）。
