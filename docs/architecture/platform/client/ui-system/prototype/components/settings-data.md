# 数据分区：聊天存储 / 文件 / 日志（迁移增量 8）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-31 · **Owner**: Client Platform / UI System
> **旧来源**：`components/settings/ChatStorageSettings.tsx`、`MyFilesSettings.tsx`、
> `components/LogsTab.tsx`
> **前置**：[settings-frame](./settings-frame.md)

## 1. 产品边界（全部 peers-ui，本地真实状态）

**聊天存储（storage）**
- 用量 4 格：消息/媒体/缓存/合计，随清理联动（清缓存后缓存格归零、合计重算）。
- 消息留存 `Segmented`：永久 / 1 年 / 90 天 / 30 天，切换有保存中→已保存反馈。
- 清理缓存：行内两段确认（取消/危险确认），确认后释放并出成功 Alert；已清空时按钮禁用。
- 会话存储表：行内搜索（按名称）、按占用/按最近排序、类型 Tag、消息/媒体/合计三列、
  逐行删除（首次失败出「重试删除」，二次成功）、全选本页、批量管理条、
  批量确认 → Progress 逐项推进 → 完成 Alert → 空态。

**文件（files）**：文件表（名称/可见性 Tag/大小/日期 + 复制键、下载、删除操作，均有真实反馈）、
上传/刷新按钮；上传 Dialog：浏览按钮（真实打开文件选择器）+ 文件名输入（手填可测）、
存储桶字段、私有/公开 Segmented；未选文件时提交禁用；提交插入表头并成功提示。

**日志（logs）**：TRACE/DEBUG/INFO/WARN/ERROR 药丸级过滤器（默认后三级开）、
文本过滤、刷新（修订号）、等宽日志行与分级色标。

## 2. 旧设计审计

- 旧实现 antd Table/Modal/Switch/Tag + 大量 Flexbox 内联；新实现用 peers-ui
  `Segmented/Checkbox/Button/IconButton/Progress/Alert/Tag/TextField/Dialog/Empty`，
  表格用 CSS Grid 行（storage 7 列含选择框，files 5 列无选择框，避免列错位）。
- desktop 的批量删除有进度契约（completedCount/totalCount）：保留为逐项 setTimeout
  驱动的真实 Progress，不做假瞬时完成；单项删除保留「一次失败可重试」路径。
- 危险操作（清缓存、批量清理、删除文件）统一危险强调 + 两段确认，不直接执行。
- native 文件上传在原型退化为「浏览按钮 + 可编辑文件名」组合：按钮是真实文件选择器，
  无后端时仍可用手填字段完成上传闭环，不放假数据。

## 3. 门禁

新增 5 场景（能力 45/45）：存储结构、搜索过滤+批量条、全选→确认→进度→清空态、
文件上传闭环、日志过滤；storage 进度等待覆盖逐项动画。
consumer 18/18，tsc 干净，0 console error。

## 4. UNPROVEN

真实磁盘用量测算、留存清理执行、OSS 上传/下载/外链、日志真实落盘流与导出、
批量删除的失败部分恢复。
