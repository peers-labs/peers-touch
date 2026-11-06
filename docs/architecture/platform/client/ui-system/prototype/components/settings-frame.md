# 设置框架与 IA（desktop Settings.tsx 对齐，增量 6/22/23）

> **Status**: draft · **Owner**: Client Platform · UI System
> **Last updated**: 2026-11-01 · **Spec ref**:
> `packages/prototypes/desktop/shell/src/Settings.tsx`（FULL production IA）

## IA（真身结构，增量 23 对齐）

```
设置
├─ 通用 General
│  ├─ 账号 Account
│  ├─ 消息通知 Notifications
│  ├─ 隐私与安全 Privacy & Security
│  └─ 外观与语言 Appearance & Language
├─ 网络 Network
│  ├─ 你的站点 Your Station
│  ├─ 发现 Discovery
│  └─ 联邦 Federation
├─ AI
│  ├─ 供应商 Providers
│  ├─ 模型 Models
│  ├─ 发现 Discover
│  ├─ 记忆 Memory
│  ├─ 技能 Skills
│  └─ MCP
├─ 通道 Channels
│  ├─ 机器人 Bots
│  └─ 飞书 Lark
└─ 高级 Advanced
   ├─ 数据与存储 Data & Storage
   ├─ 统计 Statistics
   ├─ 日志 Diagnostics & Logs
   ├─ 定时任务 Scheduled Tasks
   ├─ 命令面板 Command Palette
   └─ 关于 About
```

小程序（Applets）按产品决定移除；其入口与内容均不出现。

## 二级分区：与动态/聊天同构的 Segmented 岛（跨模块对称）

- 设置组（通用/网络/AI/通道/高级）是产品**二级分区切换**，与动态「动态/圈友」、聊天「消息/联系人」同级——必须用同一个 peers-ui `Segmented` 原语（`density="compact"`）、同一套几何：**岛 36px / 目标 28px / 12 号 / 图标 13 / 圆角 6px**，subbar 内边距 8/14/10，不允许同一层级在不同模块出现下划线 tab vs 胶囊、或厚薄不一的两套表达。
- 设置比另外两个面多一级：**三级是 190px 朴素分区侧栏**（账号/消息通知/…），图标+标签、激活项淡主色底、右侧发丝分隔内容区。
- 历史教训：增量 23 一度把设置组做成 48px 下划线文字 tab，聊天岛是 compact 28px、动态岛却是默认密度 36px——三个同级切换三套大小，破坏立体空间对称。先统一到默认密度后被判定过厚，最终以消息面 compact 薄岛为准，三面全部收敛到 compact（岛 36 / 目标 28 / 12 号）；`level2-tabs-symmetric` 场景逐面断言几何一致，禁止回退。

## 偏好

语言、主题、消息密度、消息对齐（各在一边/统一靠左）、通知 7 开关、隐私开关全部经 `prefs.ts` 落 localStorage 并跨面广播。消息对齐仍驱动聊天面 CSS（`data-message-layout`）。

## 门禁

- `north-star.suite.json › settings-frame / settings-groups`：5 个 Segmented 组（compact：岛 36、目标 28/12 号）、各组三级分区数 4/3/6/2/6、无 applets 入口；`level2-tabs-symmetric` 锁三面二级岛几何一致。
- 每个分区一个动态场景（账号、通知、隐私恢复、外观、站点设备、发现、联邦、供应商、模型、发现包、记忆、技能、MCP、机器人、飞书、存储、统计、日志、定时任务、命令面板、关于）。
