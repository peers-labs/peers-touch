# 会话列表对齐（补齐增量 17）

> **Status**: draft · **Created**: 2026-10-31 · **Owner**: Client Platform · UI System
> **审计来源**：`packages/prototypes/desktop/features/social-chat/src/components/SessionList.tsx`（764 行）

## 1. 从真身补齐的功能点

- **在线状态点**：单聊头像右下绿点（在线）/ 灰点（离线），群聊不显示（真身 presence 语义）。
- **相对时间**：刚刚 / N 分钟前 / N 小时前 / N 天前 / M/D，替代绝对时间字符串。
- **群头像拼贴**：`GroupAvatarComposite` 单一实现——2–4 人 2×2、5–9 人 3×3，列表与群资料卡共用（增量 29）。
- **未读角标**：从 peers Badge 改为自定义胶囊——置顶/主色、免打扰灰、99+ 封顶、1.5px 描边压在头像上。
- **会话级菜单 5 项**：置顶 / 免打扰 / 标记已读（无未读时禁用）/ 隐藏 / 删除。
- **三种等价触发路径**：hover 快捷钮（静音、置顶、⋯）、⋯ 菜单、**右键菜单**（onContextMenu → Menu anchorPoint 跟随指针），
  解决真身只能右键、触控板/触屏不可发现的问题。
- **置顶排序与底色**：置顶会话按 lastTs 下沉后整体置顶，行有淡材质底。
- **打开即已读**：选中会话清未读。

## 2. 相对真身的 UX 改进

1. **删除会话两段确认**：真身 `deleteConversation` 立即 filter 不可恢复；原型删除走 Dialog 确认
   （「将从本机的会话列表移除，不影响对方与 Station 记录」）。隐藏保持即时（非破坏操作）。
2. 菜单在 hover 与右键下行为一致，右键菜单跟随指针坐标（anchorPoint），非固定右下角。
3. 会话操作浮层改用 `--sk-overlay` 不透明底（沿用增量 12 的防穿透 token）。

## 3. 探针（能力 88/88 OBSERVED，consumer 18/18，0 console error）

- `session-presence-time`：单聊在线点、群聊无点、九宫格、相对时间格式。
- `session-context-menu`：⋯ 菜单标记已读后角标消失（同场景跑 craft battery）。
- `session-delete-confirm`：两段确认后 `data-session-count` 7→6。
- 旧 `conversation-rail`/`create-group` 选择器适配新角标与九宫格。

## 4. UNPROVEN

真实 presence 订阅（SSE）、成员角色排序所需的 owner/admin 数据、隐藏会话的「归档/找回」流、
删除在 Station 侧的同步语义。
