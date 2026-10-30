# Frontend Eles — 元素与组件原型

源码：`packages/prototypes/shared/ui-system/`。Prototype Portal 新增独立一级
tab **Frontend Eles**，默认入口为 `?site=frontend-eles&eles=basics`，展示20基础组件；
Agent表达入口 `?site=frontend-eles&eles=expression`；
单项深链 `&sample=selection|input|preview`。
基础拆解入口 `?site=frontend-eles&eles=foundations`，
维度 `&foundation=type|geometry|color|icon|surface|layout`，
方向 `&direction=clear|warm|precise`。
定义深链 `?site=frontend-eles&eles=catalogue&ele=ui.spec.text`。
复用现有 server、manifest 发现和全屏 Owner。

目录直接读取 `packages/ui/contracts/capability-catalogue.json` 的全部 130 项，
包含定义、状态规则、变体、非法组合、生命周期、Owner 与源码位置。
基础、其他通用能力、业务组合分别为 20 / 89 / 21 项；阶段分组属于本原型的
审阅顺序，不改变公共组件合同或实现状态。

当前阶段由 `AgentStyleStudy.tsx` 展示 Agent Groups 的成员选择、输入与动作、
协作组预览。完整表达包含暖白/奶油底层、薄荷/灰青表面、琥珀选择、
局部色彩弥散、透光身份层、细边界/短阴影、轻重排版、非对称比例、
成员关系与跨边缘附着摘要、焦点/禁用/创建反馈；继承现有方圆几何。
复用公共 Button、IconButton、Segmented、TextField、TextArea、Avatar 与 Icon。
名称/目标/编排与成员派生同一组预览，摘要计数对应本地成员与讨论。
身份图形由 CSS 和原有 Agent 标记组成；关系区域只表示草稿中的成员/编排，
不显示实际执行进度。正文、消息和输入保持不透明阅读层。
创建与记录只作用于本地示例；记录后清空消息输入并保留焦点。
本轮不导入参考的外部业务域、地图、第三方品牌或业务模型；Manrope 为字体候选，不是已确认规范。
可单看、浅深主题、窄屏、键盘与输入。六维基础拆解仍保留；130项定义完整，
20项基础组件已按用户授权整批制作；高级和业务组合留待后续推进。

`FoundationSpecimens.tsx`在总览和目录单项中复用同一20项renderer。
基础动作、身份、反馈、文字与布局沿用公共组件，支持标准/长文案/禁用，
包含菜单分支、收藏/展开、版本、计数、标签移除恢复、快捷键与本地创建反馈。
基础材质样式由Web Owner `expression.css`管理，scoped候选类启用。
公共quiet hover保持透明边界；Segmented焦点内收且目标间有留白；
菜单执行/Escape恢复入口焦点，outside关闭保留新选中目标。
EmojiArtwork为目录允许的原生表情text模式；插画资源版仍待制作。

顺序：设计基础 → 基础组件 → 高级与业务组合 → 交互、状态与动效。
每项须由用户明确认可后才可替换消费者；所有项当前均待确认。
消费者迁移暂停，既有隔离工作区改动不作为获准替换的依据。

整体状态：`drafting`。当前候选供逐项反馈，不代表全集已确认。
既有全组件交互 Gate 不适用于本轮分阶段展示；其历史结果不继承为当前证明。

```sh
make run-prototype
pnpm --filter @peers-touch/prototype-ui-system check
pnpm --filter @peers-touch/prototype-portal exec tsc --noEmit
pnpm --filter @peers-touch/prototype-portal build
```

设计依据：[UI System](../README.md)、[基础候选合同](./foundations.md)
与 shared UI Identity。整体任务为
[UI-20261028 / UI-F01、UI-F03](../execution-plans/20261028-ui-system/plan.md)：
EDX 的 UI 基准输入层，后续经过确认、组件/交互、Agent消费与独立效果比较。
当前无独立模块 UI ID，复用 shared UI ID。
此原型位于共享 UI 基础层；逐项编号把定义与样本对应起来，
使用户能在替换前检查每个对象，页面本身不授予确认状态。

工艺范围：主对象为 Agent Groups 草稿；Portal 管外壳、一级导航和全屏，
Gallery 管样本、目录与阅读轨道，scoped UIProvider使用draft变量。
候选不改变active公共token值，不成为已认可基准。
材质数值来自 `expression-candidate.ts`，geometry/motion继续继承公共token。
没有持续装饰动效；hover/press只表达可操作与按压。
目录固定为 130 项，筛选由 memoized 派生集合提供；
一次挂载组合或单项Agent样本、基础维度的1/3候选、20基础总览或一个目录项，
离开一级 tab 即卸载，不接业务 runtime/store。

本轮证据由真实浏览器和源码摘要记录在任务拥有的外部位置；
只证明当前样本阅读与Gallery操作。L2截图必须实际打开检查后才记为已检视。
EDX独立准入没有完成，候选不晋升高保真准入、pending-review或confirmed。

当前源码的 Agent 样本浏览与视觉证据单独采集；
历史其他题材的结果不继承为本轮证据。技术检查不批准视觉或用户认可。
当前边界修正与20基础样本证据在任务外部目录保存，绑定确切源码摘要。
真实浏览覆盖20项精确目录、总览/单项、按钮与分支菜单、焦点返回、
标签与计数、快捷键、长文案/禁用、浅深主题、390px/宽屏、Agent选择边界、
深链、130目录及退出卸载。检查数量和实际检视截图集合以当前外部结果为准。
历史整版Agent检查不继承为修改后全部交互证明。

待补：高级样本、业务组合样本、组件完整交互、独立 Experience Review、
真实读屏、真实触摸设备、性能分布、原生与接收端证明均为 `UNPROVEN`。

## 桌面原型北极星

`?site=frontend-eles&eles=directions` 是唯一持续演进的桌面应用窗框原型
（单窗框：60px 图标轨 + 滚动信息流 + 会话轨），未来收敛为 Desktop 原型，
验证过的模式回流元素集。窗框语法（材质分区、圆角归属、焦点环、近黑胶囊/
单琥珀/大数值）与其机器门禁见
[北极星窗框语法](./north-star-frame.md)；相关缺陷经验见
`docs/knowledge/pitfalls/prototype-embedded-control-chrome-leak.md`。
旧入口 `eles=northstar` 兼容指向同一视图，不再存在平行窗框。

## 外部参考材质校准

外部 UI 参考只作为离线、脱敏的视觉机制输入，不在仓库中保存其名称、
链接、图像或业务对象；旧 Agent 材质与 20 项基础样本可通过
`?site=frontend-eles&eles=expression`、`?site=frontend-eles&eles=basics` 查看。

