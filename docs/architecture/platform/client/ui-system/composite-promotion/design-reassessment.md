# 已确认原型 UI 如何直接接入生产

> **Status**: 搜索方案已确认；P2/P3 仍为提案
> **Version**: v0.2.0
> **Created**: 2026-11-23 | **Updated**: 2026-11-27
> **Owner**: Client Platform / UI System
> **Source**: `origin/master` `5792cc344`；试点 rebase 后 `10fb8b40d`
> **目标**: 用户已同意落实 P1 完整搜索浮层，按 `UI-AC01/02/03` 检查；P2/P3 未纳入

## 结论

用户已确认的目标及验收定义见 [目标与验收](./acceptance-contract.md)。本设计必须
让确认后的完整 UI 直接进入生产。公共按钮、头像或结果行已有复用，只证明基础
条件成立；把完整界面缩成这些零件不能满足目标。

**原型从开始就把完整界面的布局、样式和交互写成可接数据与动作的 UI 实现。
原型父组件提供样本和模拟动作，生产父组件提供现有接口的数据与真实动作。
两边引用这同一份完整 UI，生产不再绘制另一套外壳。**

现有 `@peers-touch/ui` 已承载基础件与组合件，可以继续使用；具体完整 UI 放在
已有 UI 包还是领域拥有的共享前端模块，由实际依赖确定。包名不是验收条件，
也不能仅凭试点缺陷就判定需要新建或删除一个包。只保留一个实际展示实现，
不制造“渲染核”“数据核”或长期并存的两套界面。

沿用 [UI System](../design.md)、[北极星窗框](../prototype/north-star-frame.md)、
[Desktop Runtime Projections](../../../../../client/desktop/runtime-projections.md)
及各域现有产品合同。真实业务权限、请求序列和数据持久化继续由原 owner 负责。
若确认原型与现有生产合同冲突，先列明差异并解决，不由接入组件自行改变任意一方。
原[试点设计](./design.md)和[决策](./decisions.md)供对照，本稿没有授权大规模迁移。

## 基于实接入口的证据

下面记录修复前的重评结果。搜索的快捷项查找、受控选中/滚位、旧查询 Enter、
初始关闭遮罩及原型选择器已在本轮修正；这些修正是否可用仍须由实际入口验证。

| 发现 | 分类 / 依据 | 能说明什么 |
|---|---|---|
| 新版有多个实际原型入口。 | 源码事实：[Frontend Eles manifest](../../../../../../packages/prototypes/shared/ui-system/prototype.manifest.ts#L3-L18) → [Gallery](../../../../../../packages/prototypes/shared/ui-system/UISystemGallery.tsx#L71-L86) → [Desktop 的 Chat / Moments / Settings / Search](../../../../../../packages/prototypes/shared/ui-system/DesignDirections.tsx#L322-L352)；[MobileFrame](../../../../../../packages/prototypes/shared/ui-system/MobileFrame.tsx#L10-L32) 和 [Mobile 证据入口](../../../../../../packages/prototypes/mobile/chat/src/MobilePrototype.tsx#L64-L95) 用的是同一个 `MobileApp`。 | 按面和场景核对，不能以 Gallery 样本、文件名或 `confirmed` 字段替代产品行为证明。 |
| 两端直接用同一 `peers-ui` 组合件在生产已有实例。 | 源码事实：[MomentComposerSurface](../../../../../../packages/ui/web/src/moment-composer.tsx#L7-L45) 同时由[原型 Moments](../../../../../../packages/prototypes/shared/ui-system/moments/MomentsFeature.tsx#L143-L169)和[生产发动态](../../../../../../apps/desktop/src/components/moments/MomentComposer.tsx#L871-L893)渲染。相同 [IdentityTrigger](../../../../../../packages/ui/web/src/identity-card.tsx#L176-L192) 已接[原型动态](../../../../../../packages/prototypes/shared/ui-system/moments/AuthorCard.tsx#L57-L86)、[原型聊天](../../../../../../packages/prototypes/shared/ui-system/chat/ChatIdentity.tsx#L17-L48)和[生产动态](../../../../../../apps/desktop/src/components/moments/MomentAuthorTrigger.tsx#L53-L74)。 | 已有组件与数据接入能力可继续使用；这些引用本身没有证明完整发布器或资料 UI 已与确认原型一致。 |
| 试点搜索两面确实消费同一组件，但改变了行为。 | 源码确认：[Desktop 快捷项另造在 `model.quickFunctions`](../../../../../../apps/desktop/src/components/search/SearchOverlay.tsx#L199-L220)，[点击](../../../../../../packages/ui/composite/src/search/GlobalSearchSurface.tsx#L432-L446)却由[只查 `hostRows` 的 `openRow`](../../../../../../apps/desktop/src/components/search/SearchOverlay.tsx#L162-L187)处理；[快捷项只在空输入建议模式出现](../../../../../../apps/desktop/src/runtimes/searchFrames.ts#L219-L243)，此时 `hostRows` 没有功能项。`5792cc344` 的 `SearchOverlay.tsx:389–399` 原本直接执行。共享组件把选中项放进[本地数组下标](../../../../../../packages/ui/composite/src/search/GlobalSearchSurface.tsx#L96-L105)，[Enter](../../../../../../packages/ui/composite/src/search/GlobalSearchSurface.tsx#L144-L165)不再执行原版的 `draftMatches` 检查，生产也未接回滚动读写。原型[把 `data-global-search` 放在父节点](../../../../../../packages/prototypes/shared/ui-system/search/GlobalSearchOverlay.tsx#L312-L334)，与[原门禁的焦点目标](../../../../../../tooling/scripts/ui-system/suites/north-star.suite.json#L279-L304)不符；原高亮和快捷行选择器也未落到同一语义节点。 | 快捷项不执行是可从调用链确认的缺陷。键盘、结果逐批变化、回跳滚位和焦点须经各自入口跑通，组件测试和类型通过不代表保真。 |
| 关闭的原型搜索浮层遮挡 Portal。 | Chromium 实测：从真实 Portal 打开原型、尚未唤起搜索时，`.ptc-search-scrim` 已拦截「全屏预览」点击，仓库探针在入口前置步骤超时。源码解释：[试点两个 effect](../../../../../../packages/ui/composite/src/search/GlobalSearchSurface.tsx#L120-L140) 让初始 `open=false` 也进入 `closing=true`，而负责启动退出计时的 effect 只依赖 `open`；[组件随后仍挂载](../../../../../../packages/ui/composite/src/search/GlobalSearchSurface.tsx#L318-L337)。 | 7 个已选搜索场景未执行到断言；不记作 7 个 FAIL 或 PASS。这个浏览器结果只证明原型入口被遮挡，不外推到 Native Desktop（生产宿主关闭时直接卸载）。 |
| `SearchSurfaceData` 目前没有实现样本与两端共用。 | 源码事实：[原型](../../../../../../packages/prototypes/shared/ui-system/search/GlobalSearchOverlay.tsx#L240-L287)从原型 seed 组装 `SearchSurfaceData`，再转 `SearchSurfaceModel`；[Desktop](../../../../../../apps/desktop/src/components/search/SearchOverlay.tsx#L197-L243)直接造后者；[`searchFixtures`](../../../../../../packages/ui/composite/src/search/search.fixtures.ts#L172-L179)只在自身测试实际消费。相比之下 [Mobile 原型 model](../../../../../../packages/prototypes/mobile/chat/src/app/model.ts#L11-L24)已经直接使用共享的聊天和动态样本。 | 格式要只有一份，样本值也必须由实际原型场景和对照测试共同消费；不能只检查 JSON 可序列化。 |
| 试点资料卡没有真实的双端消费，试点会话轨没有接入两面。 | 源码事实：[登记](../../../../../../packages/prototypes/shared/ui-system/registry.ts#L290-L306)把 `IdentityProfileCard` 写成 `vetted`，但原型动态/聊天实际走上述 `IdentityTrigger`，原型账号页走[独立的 AccountSection](../../../../../../packages/prototypes/shared/ui-system/settings/sections/AccountSection.tsx#L74-L98)；[试点同名适配器](../../../../../../packages/prototypes/shared/ui-system/identity/IdentityCard.tsx#L152-L186)没有运行入口。生产资料卡在[自我弹层](../../../../../../apps/desktop/src/components/UserProfilePopover.tsx#L49-L63)和[联系人资料页](../../../../../../apps/desktop/src/components/chat/ChatContactsDetailPanel.tsx#L160-L176)等处使用。会话侧真实入口仍是[原型 `ChatFeature` → `ChatRail`](../../../../../../packages/prototypes/shared/ui-system/chat/ChatFeature.tsx#L441-L470)及[生产 `SocialChatPage` → `ChatSessionList`](../../../../../../apps/desktop/src/pages/SocialChatPage.tsx#L336-L374)，两者各有自己的工具区和菜单行为。 | 以从入口可达的消费点计数，不能把「有 import、导出或样本测试」记成已晋升。快捷身份浮卡与完整资料页是两种任务。 |

## 建议边界

评审草图（箭头表示 import 依赖）：

```text
原型页面（样本、模拟动作） ───┐
                            ├──→ 同一完整 UI（布局、样式、交互、状态呈现）
生产页面（接口、真实动作） ───┘

原型页面、生产对照测试 ─────────→ 同一份合成样本
```

| 归属 | 负责 | 边界 |
|---|---|---|
| 完整 UI 的共享实现 | 确认范围内的 DOM、布局、样式、状态呈现、交互、动效和无障碍；内部继续组合现有按钮、列表、弹层、令牌。 | 不反向 import 原型父组件、客户端页面、业务请求或样本。插槽只接确实需要的内容，不能把所有区域交回两端各自重画。 |
| 真实原型入口的父组件 | 场景数据、模拟状态变更和原型导航。 | 不加模拟服务，不复制生产 runtime；界面确认前修复缺陷和缺失状态，不能用可接入的零件替代完整候选。 |
| 生产页面或父组件 | 从既有接口读取、映射共享 UI 所需数据，接 i18n 和真实动作；提供既有 runtime 的选中、返回及权限状态。 | Store 是内部实现，不是共享条件。不能在数据映射、外壳 CSS 或动作回调中重写确认 UI 的布局、文案含义和交互。 |
| 原型与对照测试的同一份样本 | 相同场景、稳定的行 ID、相同示例值和同一个字段/枚举定义；就近维护可独立导入的测试数据，优先沿用现有数据所有者。 | 原型和测试依赖样本；生产构建入口不依赖它。由测试入口喂给生产的渲染路径，不在发布版本加「切到假数据」开关。需要种原生业务数据时，仍由相应域的 Acceptance fixture 负责，不能把组件样本当成真实业务数据。 |

### 数据、状态、动作怎么接

- **格式**：定义完整 UI 实际消费的一份数据形状，例如搜索浮层除稳定结果 ID、标题和来源外，还需要查询、分组、快捷项、可见状态及允许动作。props 直接消费这个类型，回调、内容插槽分开传；不复制一份只为可序列化的平行模型。
- **样本**：原型和生产实际入口的验收对照消费同一份合成场景，覆盖整个界面。生产端经现有测试注入或域 fixture 读取，再沿实际装配路径展示；纯 props 快照只用于诊断，不替代端上对照。原型模拟动作与生产真实动作接受相同的 UI 意图，返回相应可见状态。真实数据继续来自原接口。
- **动作**：显示的每项动作与可执行项一一对应。回调只上报稳定 ID；当前结果过期、目标不再可用或正在打开时，由父组件沿已有契约判断、反馈或拒绝，不能默默吞掉仍显示为可用的动作。合成输入、提交、逐批结果与成功返回的规则延续本端合同。
- **状态**：UI 的 hover、展开、键盘移动、焦点和动效实现共用；生产需要持久保留的选中项、滚位与返回目标由已有 owner 提供并按稳定 ID 恢复。共享 UI 读取受控值、上报变化，不能在两端分别实现相同交互。弹层焦点有一个负责方；原生隐藏窗口与 reduced motion 的约束由共同实现保住。

## 候选完整界面的接入要求

| 试点 | 建议目标 | 必须保住的行为 |
|---|---|---|
| P1 全局搜索 | 候选为完整搜索浮层。先修复原型阻断，核对确认基线与生产搜索合同，补齐真实业务状态，再让两面实接同一完整 UI。当前 `GlobalSearchSurface` 的缺陷需要修正，不能通过退回只复用结果行而宣称完成。 | 原型最近/快捷项、焦点、命中及路由；Desktop 空输入快捷项真实导航、IME、旧查询不误开、逐批/分页、复制、返回选中与滚位、WKWebView 隐藏时不遗留透明面板。 |
| P2 身份 | 先明确验收的是快捷浮卡还是完整资料页，以及具体 variant；沿实际原型入口建立完整对照。现有 `IdentityCard` / `IdentityTrigger` 可作为基础，但头像复用或无入口的适配器不能证明整张资料 UI 接入。 | 所选完整界面的身份信息、详情展开、动作可见性、复制、真实关系动作、关闭和焦点；所选变体必须有两端实际入口。 |
| P3 会话轨 | 若选择会话轨作为验证对象，就包括确认范围内的轨头、tabs、筛选、列表、空态、菜单、紧凑状态及交互。现有实验整轨未接入，不作为已完成实现；接入时将完整 UI 共享，真实会话/联系人数据、动作与观测接原 owner。 | 验证真实 `ChatRail` / `ChatSessionList`。至少覆盖置顶与未读、右键与焦点、活跃会话、筛选与开新会话、窄轨收缩和[新版 tabs spring](../../../../../../apps/desktop/src/components/chat/ChatSessionList.tsx#L618-L640)；还要保留[生产菜单与观测边界](../../../../../../apps/desktop/src/components/chat/ChatSessionList.tsx#L738-L808)。Mobile 只按其已确认界面验收。 |

完整 UI 的 CSS 与交互只有一个 owner。父组件负责把界面安放到对应容器，不用
覆盖样式重新塑形。旧的重复展示路径、无入口的适配器和重复类型在实际切换时清理；
不以改包名代替接入，不用放宽断言获得通过。必要平台差异需有明确依据和确认，
不能把保真检查改成“体验大致相同”。

## 取舍与验证

| 决策 | 没选的方案 | 代价 / 复议条件 |
|---|---|---|
| R1：同一份完整 UI 接两端数据与动作。 | 复制原型后各自维护，或只提取零件而保留两套外壳；两者都不能满足已确认目标。 | 需要把原型内写死的数据和业务副作用移到父组件，补齐生产状态；不得用新的 UI 引擎代替普通 React 组合。具体包归属由实际依赖决定。 |
| R2：共用 UI 格式和合成样本，真实数据从已有接口接入。 | 只有类型不共享样本；或要求原型直连生产接口、让线上吃测试样本。 | 对照测试要维护一个真实的装配入口和一份合成场景。确有网络集成问题走已经存在的原生验收，不为对照样本搭服务。 |
| R3：以实际入口、完整 UI 对照和真实业务结果为晋升条件。 | 用目录 `vetted`、同一 import、截图或包单测单独证明完成。 | 同源修改、状态对照和真实业务闭环都有维护成本；验证范围是所选完整界面，不自动扩大为全站验收。 |

用户验收与通过条件只定义在 [目标与验收](./acceptance-contract.md)，不另维护
一套较弱标准。源码与类型检查用于排除接入错误；原型沿注册浏览器场景运行；
Desktop 的真实业务证明沿既有原生 Journey，例如[设备搜索](../../../../../../tooling/acceptance/gates/chat/device_search_runner.py)
及[社交内容搜索](../../../../../../tooling/acceptance/gates/social/content_search_desktop.py)。
缺少适用操作时增强原 Gate/Driver/Fixture，不新建第二个验收页面代替实际入口。

2026-11-23 在所列源码上，`peers-ui`、试点包、北极星/Mobile 原型和 Desktop 的
类型或包检查、Portal 构建通过；试点包 35 项测试、Desktop 搜索/资料 25 项测试通过。
原型搜索探针在前置入口受阻，没有运行原生验收。这些历史结果没有证明
`UI-PROMOTION-01` 已完成。2026-11-27 经用户同意后进入搜索实施；当前实现与
验证方式见 [design.md](./design.md) 和 [integration.md](./integration.md)，历史结果不作本轮证明。
