# Search 门户 — 原型

> 状态：confirmed（Desktop 2026-10-22；Mobile 全屏端侧范围 2026-10-23 已批准；Ask/联邦面孔仍待补）
> 创建：2026-10-22
> 对应设计：[..\/README.md](../README.md)（封闭检索域 D-19）· [product.md](../product.md) · [design.md](../design.md)
> 落地计划：[20261022-device-search-find-open](../execution-plans/20261022-device-search-find-open/plan.md)（Desktop 端侧「找回 + 打开」）

## 原型在哪

唯一 Desktop Shell 内的 Search 覆盖层（不单列 Portal 卡片）：

- 组件：`packages/prototypes/desktop/shell/src/search/SearchOverlay.tsx`
- mock 数据与查询/权限模拟：`packages/prototypes/desktop/shell/src/search/searchMock.ts`
- 样式：`packages/prototypes/desktop/shell/src/search/SearchOverlay.css`
- Shell 接线：`packages/prototypes/desktop/shell/src/Shell.tsx`（搜索按钮、⌘K、默认落点 Chat、anchor toast、Shell 根 `position: relative` 定位上下文）

## 怎么跑

```bash
make run-prototype
```

⌘/Ctrl+K 或点击左侧搜索图标唤起；Esc 关闭。

## 首版范围（Owner 已确认，2026-10-22）

- 第一约束：**存在性不泄漏**——无权对象在标题、片段、计数、建议中整体不存在，不是“搜到但拒绝打开”；召回率排在其后。
- 主任务锁定 **找回 + 打开**：一个框找回人/会话/消息/动态/Agent/收藏/附件，结果可定位回原对象；功能直达同框可达。
- **探索** 与 **问（Ask）** 首版不进入主界面，仅在 [product.md](../product.md) 合同中保留语义与位置。

mock 世界是社交生活语境（好友、兴趣群、徒步/咖啡/胶片、联邦山友、个人 Agent、私人收藏），不是企业办公场景。

## 覆盖的产品语义（对回 S 编号）

1. **S-01/S-02**：默认进入 Chat，Search 是覆盖层而非页面；按钮 + ⌘K 唤起。
2. **D-19 封闭域**：输入框固定「Peers 内」标识；范围提示明示“仅当前账号有权访问的 Peers 内容 · 不含公网与本机文件”；没有任何公网/文件/连接器入口。
3. **S-09/S-10**：轻量首屏（最近 + 功能直达）；意图只有「综合 / 功能」两个页签；提交后综合结果按 人/会话/消息/动态/Agent/知识/附件 分组并有类型计数 chips（建议态不显示 chips，避免出现点了无效果的控件）。
4. **S-03**：输入中只给本机即时建议（明示“未提交远端”）；Enter 才提交完整检索。输入、展示 query 与结果分离，等待时保留旧内容，超过 200ms 在输入区固定槽显示状态，不用骨架替换列表。
5. **S-05 权限可见性（用户层表达）**：右下角「原型演示视角」可在“我 / 站友视角”间切换：
   - owner-only 内容（私聊消息与轨迹、体检报告附件与解读、私人日记 Agent）在站友视角从标题/片段/计数中消失；
   - 不可用来源显示 partial 状态（“本机端到端内容暂不可用，已从结果中排除”），不伪装成全量；
   - 联邦内容（Marta Silva、Camino 山友群、Marta 联邦动态）在两个视角均可见，模拟同一联邦上下文。
6. **信任区**：每条内容结果标注 `本机·端到端`（D，带锁）/ `本站`（S）/ `联邦`（F）；同一查询（“徒步”）同时出现三个区的结果。功能直达是本地导航，不带信任区标记。
7. **S-13/S-14 打开与定位**：点结果关闭覆盖层、导航回原对象（聊天/Agent/动态/设置），toast 显示精确定位语义（会话 + 时间 + 作者，或 Agent 轮次，或设置操作面）。
8. **S-08/S-16**：功能直达（隐私与权限、通知与免打扰、身份与站台、新建 Agent）；域内附件随父消息出现，不是文件来源。
9. **空态**：无命中时明确说明不搜公网与 OS 文件。
10. 键盘：↑↓ 移动选择（未移动前 Enter 始终提交检索），Enter 打开，Esc 关闭；输入为 combobox 语义并通过 `aria-activedescendant` 归属选中行。
11. 同账号关闭/返回保留输入、意图、结果与滚动；已完成同词检索在有界 32 项内直接恢复，不重复加载动画。演示账号切换清除这些状态。

## 视觉与定位合同（本轮修正）

- 覆盖层相对 **Shell 根容器** 绝对定位（Shell 根 `position: relative`），在独立 dev server、Portal 全屏、Portal 内嵌 Live Preview 三种宿主下均相对产品表面居中；实测四场景中心偏差均为 0px。旧版用 `position: fixed` 相对视口居中，Portal 内嵌预览（Shell 位于居中内容列）时整体偏左。
- 搜索框是一个复合字段，焦点环落在父容器（`data-focus-boundary`，复用共享 `focus.css` 合同），内部 input 不再单独画环；「Peers 内」标记与关闭按钮都在环内，不再出现焦点框穿过标记的问题。
- Token 角色对齐 UI Identity：surface.subtle/raised、border.hairline、radius.md/lg、shadow.float、trust.local/remote/warning；图标按钮为圆角方形；功能结果不显示信任区 pill。

## 证据（L2 视觉，1440×900 unless noted）

| 文件 | 状态 | 判定项 |
|------|------|--------|
| [evidence/01-default-chat.png](evidence/01-default-chat.png) | 启动默认 Chat | 搜索不抢占默认落点 |
| [evidence/02-search-initial.png](evidence/02-search-initial.png) | 覆盖层首屏 | 单主输入（父级焦点环含范围标记与关闭）、综合/功能、封闭域提示、最近、功能直达 |
| [evidence/03-suggestions.png](evidence/03-suggestions.png) | 输入建议 | 无类型 chips（提交后才有）、本机建议提示、未提交不外发 |
| [evidence/03b-keyboard-active.png](evidence/03b-keyboard-active.png) | 键盘选择 | ↑↓ 后行级归属（左侧 inset 环），Enter 打开选中行 |
| [evidence/04-results.png](evidence/04-results.png) | 综合结果 | 分组顺序、命中高亮、D/S/F 三信任区同屏、类型计数、meta 行 |
| [evidence/04b-filter-message.png](evidence/04b-filter-message.png) | 类型过滤 | 仅消息分组 |
| [evidence/05-functions.png](evidence/05-functions.png) | 功能意图 | 仅功能直达、无信任区标记、无内容类型 chips |
| [evidence/06-empty.png](evidence/06-empty.png) | 空态 | 无命中 + 边界说明 |
| [evidence/07-owner-actor.png](evidence/07-owner-actor.png) | 本人视角 | 可见含私人日记 Agent（2 条） |
| [evidence/08-member-actor.png](evidence/08-member-actor.png) | 站友视角 | 私人 Agent 消失 + partial 来源提示 |
| [evidence/09-open-anchor.png](evidence/09-open-anchor.png) | 打开结果 | 跳到 Agent 模块 + 轮次定位 toast |
| [evidence/10-narrow.png](evidence/10-narrow.png) | 900px 窄宽 | 覆盖层自适应、边界提示换行、中心偏差 0px |
| [evidence/11-portal-embedded.png](evidence/11-portal-embedded.png) | Portal 内嵌预览 | Shell 位于居中内容列时覆盖层仍相对 Shell 居中（左右间隙均 201px） |

几何实测（Playwright，2026-10-22）：独立 1440 中心偏差 0px；站友切换后 0px；独立 900 窄宽左右间隙均 90px；Portal 内嵌（Shell 根 x=289、宽 1122）左右间隙均 201px。

L3 动态：已真实点击走查（建议→提交→过滤→视角切换→打开定位→关闭）；未做录屏。
L4 runtime：未做语义树/对比度自动化，UNPROVEN。

## 已知差异 / 待补

- Mobile 全屏 Search、显式会话范围、原消息/线程打开与返回的源码已同步到
  `packages/prototypes/mobile/chat/src/pages/SearchPage.tsx` 与既有 Shell。
  已通过 Portal 的四个一级入口、实际消息/线程 focus、附件筛选、Settings
  跳转、返回输入、暗色/窄屏和可控 loading/error/retry 走查；结果列表使用
  原 `PrototypeListWindow`。L2/L3 开发证据位于
  `/tmp/mobile-search-prototype-20261023/`，不替代 Android/iOS 原生证明。
  既有 `check-long-lists.mjs` / `check-residual-parity.mjs` 的旧 Search
  路径仍需迁移；可控 demo 的跨会话失效与完整本地化仍未证明。
  Owner：Mobile / Search。
- Desktop 端侧实现只启用本机消息/会话和真实 Settings 功能目录；原型 D/S/F 全对象是目标产品，未接入的来源在生产 footer 明示。Applet 仅预留 binding。
- 新建 Agent 搜索项打开 Agent 的现有创建入口，实际创建仍由原模块的显式操作触发。通知/免打扰无真实分区，不伪造生产入口。
- 同账号状态恢复/有界 mock 复用已同步；本轮 `make run-prototype` Portal
  走查 5 项通过，宽/窄截图已检查。开发证据：`tmp/search-prototype/result.json`
  与 `01-portal.png`、`02-results.png`、`03-narrow.png`。不替代原生证明。
- anchor 当前用 toast 表达定位语义；真实产品需在消息流滚动高亮（依赖统一 ResourceResolver，V-01）。
- Agent「工具调用/任务执行事件」是否独立可搜（定位到 tool-call 而非轮次）仍为待确认范围。
- 未画：Ask 回答态、语义模型处理位置的二次授权弹窗、Federation 对端拒绝态。
- 未演示真实索引/延迟分布；输入 120ms/提交 280ms 为 mock。持续输入、
  退格、展示 query 与旧结果保留已同步
  [Desktop Search continuity](../../../../client/desktop/search-experience-contract.md)；
  新表现的视觉/动态证据必须单独验证，既有截图不证明本轮同步。
- 演示视角切换器是原型专用控件，落地时移除。
- 背景 Chat 仍为既有 social-chat acceptance 夹具（英文 Release Room 等），属另一原型的测试语料，本原型不改动；Search 自身语料已全部社交生活化。
