# 飞书助手 — 体验工艺合同

> **Status**: draft
> **Version**: v1.1
> **Created / Updated**: 2026-10-15
> **Owner**: Agent / Channel

## 产品论点

飞书助手不是一组渠道配置项，而是一个可信连接对象：用户把当前 Agent
连接到飞书后即可自然使用；只有用户要求不同结果时才打开高级能力。

本页面属于高频 Core Workflow，并包含 Trust / Recovery 状态。
表达强度为中等：可以有明确记忆点，但不能牺牲长期可读性和操作效率。
根页面主角是可扫描的 Lark 身份名单；详情主角是“当前 Agent 与一个 Lark
身份的连接”。高级页面的主角是该连接拥有的可管理对象，而不是配置分类或技术协议。

## 结构与签名特征

继承 Peers Touch 的动作优先级、信任语义、单一重点色、hairline 边界、
可恢复状态与方形 Agent 身份。

唯一签名特征是 **Relationship Spine**：

- 首屏用方形 Agent 身份、连接线和 Lark 身份明确“谁在何处工作”。
- 有多个连接后，名单用一致行结构呈现身份、默认关系和运行状态，不改造成卡片墙。
- 进入详情后，同一内容轨从连接身份自然进入当前 Agent、测试投递和按需意图。
- 高级意图进入同一工作面的聚焦编辑或名单，不制造第二套标签导航。
- 保存后回到可管理对象和最近结果，不能退化成计数器或成功提示。

页面边界：

- Page canvas：全局 Settings 的 Channels 内容区。
- Content rail：名单或当前连接的单一连续工作面；两者不同时隐藏挂载。
- Action rail：当前任务唯一主动作，以及对象行内的编辑、启停、试运行和删除。
- Trust rail：连接身份、个人 OAuth 身份、应用替换影响与投递接收人。
- Recovery layer：表单校验、应用缺失能力、授权过期和投递失败的内联恢复。
- Floating layer：仅破坏性确认；创建、编辑和修复在工作面内完成。

## FWA 参考校准

参考只提供工艺证据，不构成奖项承诺，也不覆盖 Peers Touch UI Identity。

正向校准：

- FWA 的 IKEA “Convive mejor”把普通问卷通过信息架构、可用性和交互工艺
  转化为体验，并强调“用最少资源产生最大影响”。本页采纳其方法：
  不依赖图片或装饰，以状态过渡、排版和操作反馈提升普通设置流程。
  来源：<https://thefwa.com/article/insights-ikea-convive-mejor>
- Gabriel Beaugonin 案例强调 “Minimal, not empty”，微交互服务于清晰和流动，
  3D 与愉悦时刻不能挡住内容。本页采纳克制但有触感的状态过渡，
  拒绝把 WebGL、音效或 3D 当作核心价值。
  来源：<https://thefwa.com/cases/gabriel-beaugonin>
- “Well, Dots, Lines, Planes.”以连续空间和一致交互语言承载页面状态。
  本页采纳 Relationship Spine 和原地状态转换，不做断裂的功能标签页。
  来源：<https://thefwa.com/cases/well-dots-lines-planes>
- FWA 评委 Mario Ballario 强调原创、设计、内容、易用性、至少一个突出维度
  与对细节的完整关注。本页突出“可信连接的空间表达”，其余部分服从可用性。
  来源：<https://thefwa.com/fwa-hero/fwa-hero-mario-ballario>

负向校准：

- 不复制获奖站点的视觉身份、字体、声音、WebGL、粒子或页面转场。
- 不使用营销 hero、渐变、光球、卡片墙、装饰性动画或隐藏关键动作。
- 不用多个 Alert、相同权重的按钮和解释性长文案代替信息层级。
- 不把技术演示按钮暴露为普通用户的主路径。
- 不以截图、主观评分、“FWA-level”或 prototype build 证明产品完成。

## 工艺与状态要求

- Typography：名称、状态、行动形成三层；不使用浏览器默认标题边距。
- Density：高信息密度、低边界噪音；连续 section 使用留白与 hairline。
- Motion：只解释连接、授权、检查、试运行和局部恢复；无装饰性页面转场。
- Reduced motion：关闭位移、脉冲和路径增长，保留即时状态变化。
- Keyboard：新增连接、连接名单、详情返回、默认/启停、对象名单、编辑器、
  开通步骤和破坏性操作均可达。
- Focus：进入编辑器后聚焦当前工作面标题；关闭确认后返回来源动作。
- Localization：按钮和节点允许两行，不依赖固定字宽；长名称截断但可读取。
- Responsive：宽窄窗口保持同一对象顺序；窄窗口将对象动作移到独立动作行。
- Layout stability：编辑器、名单、加载和恢复共享工作面最小高度；结果预留空间。
- Performance：不引入 WebGL、音频、图片或新组件库；没有持续装饰动画。

## 证据要求

- L1 Contract：组件树、状态分支、token 所有权、i18n 边界与不支持项。
- L2 Visual：空名单、多连接名单、在线/暂停详情、对象名单、编辑器、应用修复、
  授权过期、投递失败；宽/窄窗口和长文案。
- L3 Dynamic：连续创建两个连接、切换隔离、默认/启停/删除、草稿恢复、
  对象创建/编辑/暂停/试运行/删除、
  应用校验/修复/替换、OAuth 授权/过期/撤权、投递失败恢复和键盘焦点。
- L4 Runtime Quality：语义 name/role/value、焦点顺序、对比、44px 关键触控目标、
  布局位移和 interaction-to-next-paint；未测单元保持 UNPROVEN。
