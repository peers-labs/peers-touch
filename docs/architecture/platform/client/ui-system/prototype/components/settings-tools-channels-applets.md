# 工具 / 通道 / 小程序分区（迁移增量 9）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-31 · **Owner**: Client Platform / UI System
> **旧来源**：`CronJobsSettings.tsx`、`CommandPaletteSettings.tsx`、`ToolsTab`
> （SettingsPage）、`channels/*`（飞书通道）、`AppletsSettingsTab`
> **前置**：[settings-frame](./settings-frame.md)

## 1. 产品边界（全部 peers-ui，本地真实状态）

**工具分组（tools）**
- 定时任务：运行中/已暂停计数、刷新、新建任务 Dialog（名称 + 5 段 cron 表达式，
  正则校验不过则提交禁用）、逐行立即运行（pending→刚刚·成功）、启用 Switch
  （暂停时运行键禁用）、删除、空态。
- 命令面板：打开按钮唤起 Dialog，实时过滤的命令列表（5 个内置命令），
  点选执行并关闭；对应 desktop 的单按钮分区。
- 工具表：名称/分类 Tag/需要审批·自动放行 Tag、重新扫描（pending→更新扫描时间）。

**通道分组（channels）**
- 已连接通道卡：名称、已连接 Tag、域名、投递/入站 Switch、移除（两段确认 Dialog）。
- 添加飞书通道向导：域名输入（空值禁用授权）→ 授权等待 → 开通中（data-wizard-step 同位切换）
  → 自动入列第二张通道卡。
- Bots 通道显式不提供，信息 Alert 说明归属仍在决策。

**小程序分组（applets）**：小程序列表（图标/名称/描述/可配置·只读 Tag）；
可配置项钻取到设置面板（通知/位置 Switch），面板头部真实返回；只读行不可点。

## 2. 旧设计审计

- 旧 Cron 是 428 行 antd 抽屉大组件；新实现保留其功能骨架（计数、新建校验、
  立即运行、启停、删除）并把抽屉换成窗框 Dialog，cron 表达式用 5 段正则做真实门禁。
- 旧飞书通道是 3000+ 行企业开通/路由/健康面板；原型只迁「开通向导 + 已连接卡
  两个开关 + 移除」的可见闭环，路由/自动化/话题/活动健康等企业配置标记 UNPROVEN。
- 旧 Applets 设置面板是动态注册的真实小程序面板；原型用 3 个 fixture 与
  2 个示例开关呈现钻取合同，不假装动态注册。
- 危险操作（移除通道、删除任务）统一危险强调 + 确认；Bots 以信息卡占位而非死按钮。

## 3. 门禁

新增 7 场景（能力 53/53）：cron 结构与暂停禁用、cron 删除、cron 新建校验闭环、
命令面板过滤、工具表、通道向导入列与 Bots 挂起、小程序钻取。
consumer 18/18，tsc 干净，0 console error。

## 4. UNPROVEN

真实 cron 调度执行与执行历史、命令面板对小程序命令的聚合、飞书 OAuth/租户开通、
webhook 路由/活动健康/入站话题、小程序动态设置面板注册、通道错误重试。
