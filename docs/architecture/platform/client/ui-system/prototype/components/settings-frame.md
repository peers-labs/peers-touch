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

## 一级导航：下划线文字 tab（不是 SaaS 药丸）

- 48px 高的水平 tab 栏，透明背景的图标+文字按钮。
- 激活态：主色文字 + 650 字重 + 底部 **2px 主色指示条**；整条 tab 栏底部一条发丝分隔。
- 二级是 **190px 朴素分区侧栏**：图标+标签，激活项淡主色底；右侧发丝分隔内容区。
- 禁止把一级导航做回独立药丸容器（增量 23 前的材质胶囊是被用户明确否决的 SaaS 形态）。

## 偏好

语言、主题、消息密度、消息对齐（各在一边/统一靠左）、通知 7 开关、隐私开关全部经 `prefs.ts` 落 localStorage 并跨面广播。消息对齐仍驱动聊天面 CSS（`data-message-layout`）。

## 门禁

- `north-star.suite.json › settings-frame / settings-groups`：tab 栏底线、5 个 tab、各组二级分区数 4/3/6/2/6、无 applets 入口。
- 每个分区一个动态场景（账号、通知、隐私恢复、外观、站点设备、发现、联邦、供应商、模型、发现包、记忆、技能、MCP、机器人、飞书、存储、统计、日志、定时任务、命令面板、关于）。
