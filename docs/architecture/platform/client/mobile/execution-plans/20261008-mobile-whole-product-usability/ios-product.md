# Mobile 完整产品：iOS 实施契约

> Status: accepted, implementation in progress
> Version: 1.0
> Date: 2026-10-15
> Owner: Mobile Client
> Parent: [Whole Product Plan](./plan.md)
> Authorization: 用户本次 `/goal 确认`，双 iOS、单 Station，流程卡点自主处理。

## 北极星与范围

已确认原型中的全部 Mobile 功能正常使用。两台 iOS 模拟器通过同一个真实
Station 完成通信和接收方可见验证。Android 后续跟进；本轮不宣称 Android、
物理设备或跨 Station 证明。保留既有历史验收的原始范围与结果。

共享实现继续采用 React / Tauri / Rust。Station 持有业务真源，Rust 持有密钥、
安全会话与可靠命令账本，Lifecycle Kernel 管理 Runtime，页面呈现 Projection
并派发 Intent。禁止页面补轮询、重复 Store、手写协议和测试专属业务 UI。

## 实施顺序

1. **入口与原生基线**：Station 选择、身份核验、登录/PIN、恢复、退出；
   先完成两台原生客户端启动与双向文本消息。
2. **共享呈现**：统一 Shell、导航、消息作者、输入区、置顶与内联回复；
   Chat / Moments 共用 ReactionChip、ReactionPicker，28px 胶囊、44px 触控区，
   固定 `👍 ❤️ 😄 😮 🎉`，独立多选、再次点击取消，保留准确的历史 Emoji。
3. **Contacts / Search**：发现、好友请求/决定、资料、搜索、群组创建；
   最近十条搜索按规范化查询去重，支持重放、删除、清空及重新进入后恢复。
4. **Chat / Group**：文本、附件、语音、回复、转发、编辑、撤回、隐藏、置顶、
   Reaction、历史定位、群资料、成员权限、离开/解散；读回与失败恢复由原 owner
   负责，接收方验证内容和状态。
5. **通话**：音视频呼叫、接听、拒绝、取消、忙线、权限失败、重试、结束、
   重启后清理。模拟器缺少摄像头等设备能力时必须准确呈现权限/设备状态；
   信令成功不能冒充媒体互通证明。
6. **Moments**：Home / Public / Circles、发布、受众、媒体、详情、Reaction、
   评论/回复、资料与关系操作、删除、草稿与重启恢复；清除重复计数。
7. **Me / Settings**：按原型的八组十九节逐控件绑定真实能力与持久化；
   Desktop 专属系统能力按既有产品边界呈现，不能临时禁用 Mobile 功能来通过验收。
8. **完整生命周期**：在同一 Suite 中复用 Station、账户与两台客户端；
   实际产品界面覆盖全部 Journey、键盘/安全区、空态、失败、恢复、资源释放。

2026-10-15 范围修正：Agent 相关的 Providers、Models、Memory、Skills、MCP
暂不作为本轮可用性目标。保留已实现源码和设置入口，入口统一显示“待补齐”且禁用；
本轮不得据此宣称 Agent 能力可用，也不继续扩展该实现。

## 逐屏执行顺序

以下顺序是当前双 iOS Run 的唯一执行顺序。不得因为接口、组件或测试代码已经存在，
就跳过原型对照或把该功能标记完成。

1. **全局 Shell 与恢复层**
   - 对齐启动 Loading、草稿恢复、功能降级、错误、重试和恢复完成状态。
   - 阻塞恢复使用原型定义的 Mobile Bottom Sheet；阻塞层出现时隐藏重复的非阻塞
     状态条，背景内容和 Tabbar 不得继续响应。
   - 对齐 Tabbar、Header、安全区、键盘、横竖屏、Light / Dark。
2. **入口与身份**
   - Station 选择、身份核验、登录、PIN、前后台恢复、重启、退出。
   - 两台模拟器分别完成，不能复用另一台客户端的状态证明。
3. **Contacts 与 Search**
   - 发现、好友请求与决定、资料、最近搜索、创建群组。
   - 先建立后续 Direct / Group Journey 所需的真实关系和会话。
4. **Direct Chat**
   - 列表与空态、首次加载、历史加载、文本、附件、语音、回复、Thread、转发、
     编辑、撤回、仅自己隐藏、置顶、Reaction、失败恢复。
   - 每个跨端动作由接收方按同一对象 ID 和最终内容读回。
5. **Group Chat**
   - 创建、首条消息、附件与语音、群资料、成员角色、禁言、移除、转让、
     非 Owner 离开、Owner 解散。
   - 群创建后首条消息必须立即可发；不得依赖刷新页面或等待人工重试。
6. **一对一 Call**
   - 音频 / 视频呼叫、来电、接听、拒绝、取消、忙线、权限失败、重试、
     重连和结束清理。
   - 信令、媒体和模拟器设备限制分别记录，任何一层成功都不能冒充另一层成功。
7. **Moments 与 Circles**
   - Home / Public / Circles、发布、受众、媒体、详情、Reaction、评论与回复、
     资料和关系动作、删除、草稿及重启恢复。
8. **Me 与非 Agent Settings**
   - Account、Security、General、Federation、Storage、Logs / Help 等本轮范围。
   - Agent 五项入口保留、显示“待补齐”并禁用，不进入功能验收。
9. **完整生命周期回归**
   - 在同一 Station、同一双 iOS Suite 中从冷启动重走 1-8。
   - 覆盖后台、重启、弱网 / 失败恢复、长内容、中文、Light / Dark、资源释放。

## 单步关闭条件

每一步严格执行：

`确认原型状态 -> 生产源码实现 -> 聚焦检查 -> iOS A 实际操作 -> iOS B 接收方读回
-> 截图对照 -> 失败/恢复状态 -> 资源检查`

只有同时满足下列条件才进入下一步：

- 默认、Loading、Empty、Error、Recovery 和极端内容状态与已确认原型一致；
- 页面层级、控件顺序、文案、尺寸、颜色、间距、触控区和安全区无已知偏差；
- 真实原生页面完成操作，Station / Harness / API 结果不替代 UI；
- 跨端功能由接收方可见结果证明；
- 没有内部 key、调试状态、重复状态条或未解释的降级提示泄漏到产品界面；
- 当前步骤的截图和对象 ID 已记录，未完成项明确保持 `UNPROVEN`。

用户可在每个步骤完成后直接观察当前模拟器。观察到的原型偏差属于当前步骤缺陷，
在修复并重新对照前不得继续向后累计“已完成”。

## 代码边界

- AppRoot 只组合 Lifecycle 与入口呈现；异步入口状态在对应 Runtime 收口。
- MobileShell 只订阅导航、身份、徽标与 readiness；不订阅完整 Social Store。
- 共享 UI 位于组件层，模块只做生成协议到显示状态的映射。
- 设置重表单按所选 section 挂载；列表使用既有 BoundedList；详情有明确生命周期。
- Acceptance Fixture 在生产数据/平台边界注入，最终证明操作实际页面。
- 所有文案使用 locale key；样式继承 UI Identity 与 Mobile 布局契约。

## 证明与交付

每个步骤先运行聚焦检查和真实 iOS Journey，再扩展正式验收。最终记录客户端
源码、Station 构建身份、两个账户、消息/对象 ID、交互与接收方可见结果、
截图和资源释放。原型构建、Harness、API 结果不能替代原生业务证明。

现有 PlanMount 与历史证据不手写伪造或改标完成。本轮用户明确允许绕开流程
卡点；进度以实际源码与当前 Journey 结果为准。提交/PR 遵循已授权范围。

## 验证入口

- `make config`：选用已审查 remote profile，禁止占用其他任务的运行资源。
- `pnpm --dir apps/mobile run check:web` 与 `build`：共享 UI 与协议检查。
- iOS Tauri 原生调试入口、Appium / XCUITest：实际页面与双端接收验证。
- 聚焦 Runtime、命令、Projection 检查及最终 Suite：按上述风险与状态选择。
