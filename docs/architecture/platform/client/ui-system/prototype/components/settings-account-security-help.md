# 账号 / 安全 / 帮助分区（迁移增量 7）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-31 · **Owner**: Client Platform / UI System
> **旧来源**：`components/settings/AccountTab.tsx`、`DeviceLinkPanel.tsx`、
> `RecoverySettings.tsx`、`pages/SettingsPage.tsx` 的 HelpTab
> **前置**：[settings-frame](./settings-frame.md)

## 1. 产品边界

**账号（account）**
- 身份卡：头图 + 80px 方圆头像（r22）负 34px 叠压、显示名/@handle/本机身份标签、
  动态·关注·粉丝统计与加入时间；头图/头像支持本地选图即时预览（FileReader，无上传）。
- 首选用户名与 PTID 嵌片，peers-ui `CopyButton` 一键复制。
- 设备：关联新设备 Dialog 本地状态机：二维码（peers-ui `QrCode`）→
  模拟扫码请求 → 设备名 + 6 位核对码 → 允许（finishing → 完成）/拒绝（过期），
  完成态给「完成」、过期态给「刷新二维码」。
- 公开资料：显示名、简介（280 字 + 计数）、地区、可搜索时区 Select、
  标签（回车添加、Tag 可删）、资料链接行（名称/URL/删除、添加），全部本地真实状态。

**安全（security）**：备份状态嵌片（无备份警告 Alert / 已备份+时间 / 恢复完成成功提示）、
24 词恢复密钥（生成 pending → 词格 + 复制）、创建备份（密钥生成前真实禁用、pending 态）、
从助记词恢复 Dialog（24 词门槛，不足时禁用确认，完成后成功 Alert）。

**帮助（help）**：关于卡（版本/命令面板快捷键说明，kbd 样式）+ `Accordion` 内置
4 个可搜索功能（账号/安全/通用/聊天存储；联邦与 AI 入口排除），每项真实跳转到
对应分组分区（聊天存储跳到数据组，落地为诚实空态）。

## 2. 旧设计审计

- AccountTab 是 antd/Flexbox 内联样式大组件（头像上传走远端 provider）；新实现
  用 peers-ui `Avatar/Tag/TextField/TextArea/Select/CopyButton/QrCode/Dialog/Button`
  组合，上传退化为本地选图预览（无后端），状态全部留在组件。
- DeviceLinkPanel 的固定舞台几何（QR/审批/finishing/complete/expired 同位切换）
  保留为单一 `.sk-device-stage[data-stage]`，避免弹层高度跳动。
- RecoverySettings 的依赖链做成真实门禁：未生成密钥 → 创建备份禁用；恢复词不足
  24 个 → 确认禁用；异步动作用按钮 execution=pending 表达，不加假进度条。
- HelpTab 旧实现含 applet 来源标记；原型无 applet 动态目录，只留内置 4 项，
  且每项必须有真实跳转去向，不做死列表。

## 3. 门禁

新增 6 场景（能力内 40/40）：账号解剖与标签/链接增删、设备关联状态机、
安全生成→备份→恢复全链、恢复 24 词门槛、帮助 4 项内容、帮助跳转数据组。
1360/390 双宽度由框架溢出检查覆盖；0 console error；consumer 18/18，tsc 干净。

## 4. UNPROVEN

真实头像/头图上传与持久化、远端 provider 资料同步、PTID 二维码真实配对、
设备 claims 多选、恢复密钥真实加密与备份落盘、帮助目录对 applet/动态设置项的聚合、
i18n 语言实际切换。
