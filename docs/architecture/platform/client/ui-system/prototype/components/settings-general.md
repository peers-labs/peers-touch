# 通用组设置：账号 / 通知 / 隐私与安全 / 外观（增量 7/22/23/43）

> **Status**: draft · **Owner**: Client Platform · UI System
> **Last updated**: 2026-11-02
> **Frame source**: `desktop/shell/src/Settings.tsx`（AccountTab / NotificationsSettingsSection / PrivacySection / AppearanceSection）

## 账号 Account

- 顺序：身份 → 公开资料 → 关系（黑名单）。
- 头图是独立 tile，头像不压在渐变上（无边缘染色）；复制身份用 26px 安静图标钮，身份文字承担主视觉。
- 关系：已屏蔽用户折叠行，展开后可逐个解除。
- 已授权设备与 QR 关联移至 **网络 › 你的站点**（desktop IA：设备属于 station，不属于 account）。

## 消息通知 Notifications

两卡五事件 + 投递两开关，共 7 个开关；开关带 `data-notify`，偏好跨面持久化。

## 隐私与安全 Privacy & Security

- 应用访问：PIN 锁（展开改/移除 PIN）+ 自动锁定时长；谁可以看到：在线状态、已读回执。
- **账户恢复**（原型保留能力，desktop 新 IA 未含）：24 词恢复密钥生成（pending 态）→ 词格 + 复制 → 创建备份门禁（无密钥禁用）→ 助记词恢复 Dialog（不足 24 词禁用确认，完成给成功提示）。actionId：`security.*`。

## 外观与语言 Appearance & Language

- 主题（跟随系统/浅色/深色）、消息密度（宽松/紧凑）、消息对齐（各在一边/统一靠左）、界面语言（简体中文/English）。
- 消息对齐与语言即时作用于聊天面；所有选择走 `prefs.ts`。
- **增量 43**：消息对齐下新增子开关「双边展示时隐藏自己头像」（`hideOwnAvatarInSides`，默认关），
  缩进为子行（`sk-settings-subrow`），仅在「各在一边」出现；切「统一靠左」即卸载，该模式下自己头像
  强制保留。分段选中态经 `PT_BRIDGE` 桥接 `--pt-primarySubtle`
  （`color-mix(in srgb, var(--sk-primary) 10%, var(--sk-raised))`）为皮肤派生墨洗，
  不再落库默认冷灰 `#e9ecf2`。
