# Task Workbench — peers-ui 重构原型

> 状态：drafting（2026-11-06 新建，等待 Owner 评审）。全部为 mock/状态机驱动的可执行交互，不构成生产实现、运行时或验收证据。

## 原型在哪

`packages/prototypes/desktop/shell/src/workbench/`（唯一 Desktop Shell 内的 Agent 面状态，不新增可见卡片入口）：

- `model.ts`：纯状态机（受控 turn、决策回执、版本检查/接受、记忆复核、窄宽适配）
- `cards.tsx`：阅读路径卡片（MANUAL 审批、有界工具结果、HELD、版本化成果）
- `panels.tsx`：右侧资源 dock（成果 / 浏览 / 终端 / 记忆 / 能力）
- `Workbench.tsx`：三轨连续工作区与窄宽覆盖

在唯一 Shell 内打开：

```text
make run-prototype
?site=desktop&state=task-workbench
```

独立 vite（本分支本地验证）：`packages/prototypes/desktop/shell` 下 `pnpm dev`，同样的 `?state=task-workbench`。

## 为什么重构

2026-11-02 接受的交互合同原型（AgentTaskWorkspace）建立在 antd + Shell 本地 theme（`T.*`）之上；remote master 此后确立了 peers-ui 框架（`packages/ui`：tokens/contracts/web/desktop）与不变量：app 层只组合原语，不重绘 `.pt-*`。本原型是同一工作区设计在 peers-ui 上的重构参照：

- 视觉原语全部来自 `@peers-touch/ui`（Button/IconButton/Tag/Card/ListSection/ListRow/Segmented/Alert/Empty/Drawer 语义），颜色/圆角/间距只引用 `--pt-*` token，零 `.pt-*` CSS、零 `classList`/视觉 style 写入（primitive-layer-guard 零新增违规）。
- 表达 Quiet Protocol Minimalism：墨色主胶囊承担唯一主操作，品牌 hue 只出现在语义态（success/warning/danger/info）；hairline 分区，无卡片描边堆叠。

## 覆盖的产品合同（TW-20261102 已验收语义）

1. 受控多迭代 turn：工具调用停在 `tool_approval_required`，决策产生 revision 回执与终端系统卡；拒绝是终态，不渲染为成功，也不重复生成调用卡。
2. 风险分级 MANUAL + fail-closed：client-device / client-browser 标签；能力面板逐能力展示 READY/BLOCKED·reasonCode，并保留「任一绑定能力未就绪，整个 Turn 执行前拒绝」的说明。
3. 浏览器资源是会话真值：浏览面板呈现 conversation 绑定标签与 agent/人工租约；人工接管时模型动作以有界 `BROWSER_HUMAN_TAKEOVER_HELD` 工具结果返回（Alert，非执行器错误）。
4. 成果是不可变版本：结构检查通过才允许接受；接受是终态，卡片与 dock 行都不再出现变更动作。
5. 记忆候选在确认前不消费：dock 角标计数，确认后从待决队列移除。
6. 窄宽：<920px 资源 dock 默认收起，打开时为右侧覆盖抽屉 + scrim，不挤压会话轨。

## Craft 记录（进入界面前）

- Surface type：高频工作流（dense workflow），Quiet Protocol Minimalism 默认表达。
- Main subject：一次受控工具 turn 的因果阅读路径。
- Signature feature：审批证据先行——决策按钮只出现在 command/workdir/url/lease 证据之后。
- Positive calibration：三轨连续工作区、会话内审批、对象资源独立于查看生命周期（沿用 2026-11-02 接受合同）。
- Negative calibration：不用第二套组件库默认皮肤、不给风险/租约状态上品牌色、不把 HELD 做成报错中断、不在接受后保留操作按钮、不用无计数语义的红点。
- 布局稳定性：dock 分段使用单行 island（scrollable compact）；覆盖抽屉不推动布局；列表为空时由 Empty 占位。

## 证据

- L1 Contract：`tsc --noEmit` 通过；vite build 通过；primitive-layer-guard 零新增（baseline css=848/js=29 均为存量）。
- L3 Dynamic（本地浏览器实际点击）：批准→结果→第二次批准→HELD→成果卡；检查门禁用/通过启用/接受终态；记忆确认后空态；能力 BLOCKED+reasonCode；窄宽 scrim 关闭；拒绝终态（已拒绝回执 + turn denied，无重复卡）。
- L2 Visual：截图取自本地 vite 渲染（pending 与 completed 两态，1007px 视口），已人工检视；截图文件未入库，评审时按上述 URL 复验。暗色主题、完整键盘流、AT 语义树与长列表性能本轮未取证，标 `UNPROVEN`。

## 已知差异 / 待补

- 旧 AgentTaskWorkspace 的部分交互（多对象标签溢出菜单、列宽拖拽、选区反馈草稿、旁聊）未迁入本参照；该合同仍以 2026-11-02 原型为准，本原型聚焦本轮新能力（模型工具/能力 readiness/版本终态）。
- 生产落地仍需在 `apps/desktop` 参照重写；本原型不作为验收证据。
- 文案为原型临时中文，未经 i18n。
