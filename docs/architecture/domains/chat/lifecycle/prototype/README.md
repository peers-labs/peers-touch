# Chat 文件查看原型

对应 [attachment-viewing.md](../attachment-viewing.md)，覆盖 CHAT-J03 文件点击、
下载状态、取消/继续、详情与预览/外部打开/保存三个动作。

Desktop 使用 `packages/prototypes/desktop/features/social-chat`，由唯一 Desktop
Shell 引用；Mobile 使用 `packages/prototypes/mobile/chat`。统一运行入口为
`make run-prototype`。

产品论点是文件收到后可识别、可使用、可恢复。主体是所选文件及其原始名称，
主动作是保存副本；下载期间主任务是等待或取消。当前没有独立 Chat 模块 UI ID，
复用 shared UI Identity、Social 语义与两端 Chat layout contract。预览区域和
底部动作区域独立，长名称可换行，Mobile 控件保留 44px 点击高度。

原型签名是同一文件从卡片进入详情，名称和状态连续可见。保留现代 IM 的文件
详情与显式操作语义；不模仿外部品牌，不增加装饰卡片、自动外部打开或不可达按钮。
详情在选中时挂载、关闭即卸载；卡片上的模拟下载可继续，取消后显式重试。

当前为实现同步草稿。模拟附件只有名称和大小，没有真实文件字节：PDF、文本与
Office 名称显示分页设计样本；Mobile 工作表样本可选择工作表和切换行列页，
Desktop 工作表样本展示工作表和行列页。PDF/Word 样本均提供宽度、整页和
实际尺寸选择；这是模拟阅读布局，不证明真实解码。其他格式显示不可用，外部打开显示无可用应用，
保存演示取消结果。真实格式解码、OS 文件面板、字节校验、后台恢复和 scope fencing
由产品客户端验收，原型不提供这些证明。文件动作层级和原有详情挂载 owner 保留。

当前 worktree 的 Portal 已运行。Mobile 文件卡片经键盘选择进入详情，模拟下载完成，
保存取消反馈和 Escape 关闭已观察；详情边界保持在 390px 设备容器内，关闭后卸载。
这是原型交互证据，不是产品下载、预览或 OS 保存证据。

L1 为源码合同检查。Mobile 消息布局的 L2/L3 证据见下文；
Desktop 文件详情、物理设备 touch、L4 AT、全量 localization 和 Native 恢复
仍为 UNPROVEN。Mobile Vite 构建通过；整包 TypeScript 检查受共享
ReactionChip/ReactionPicker 既有依赖解析错误阻塞。

本次分页同步在现有 Portal 完成 Mobile PDF 样本前后翻页及 Escape 关闭卸载，
390×844 浏览器视口两种 color-scheme 均通过；不据此推断实际主题切换或物理 touch。
截图已打开检查，记录在 `/tmp/pt-attachment-checks/prototype-document-preview/`。
当前 Mobile PDF 样本的缩放、第二页与关闭按钮卸载已在 Portal 观察。
缩放后 Escape 行为未证明。Desktop 分页样本和 Mobile Office 工作表交互未单独渲染，
这些原型面仍为 `UNPROVEN`；实际共享 Office SDK 已有独立本地功能检查。

## Mobile 消息布局合同

消息阅读使用 shared UI Identity 和 Social 合同。消息正文是主体，时间和操作
在正文之外；签名是稳定的双向会话轴，连续消息保持可辨认的阅读节奏。

- 双方使用相同的 34px 头像列、8px 列间距、12px 视口内边距；正文使用中间
  可伸缩列，左右气泡对应边缘保持镜像，头像隐藏时列宽不变。
- 每个消息组的头像与首条正文顶边对齐，群聊名称占独立行，不能移动头像轴。
- 连续消息行间距为 `space.xs`（8px）；新消息组为 `space.md`（16px），
  时间、回复、失败操作仍占其所属行的独立区域。
- 文件卡片继承文字和颜色，移除浏览器默认按钮边框；仅键盘焦点显示品牌环，
  长文件名可换行，窄屏正文不溢出。
- 页面、列表窗口、消息 key 和详情挂载策略保持原有 owner；没有新增 runtime。

正向校准是对称轨道、稳定头像和内容连续性。反向校准检查头像贴时间行、
紧贴气泡、单侧缺失轨道、浏览器黑边和窄屏单字列。
验证必须先在修正前记录失败，再覆盖 Portal 宽/窄视口、亮/暗主题、单行/多行/
文件/失败状态，并检查文件点击、键盘焦点、关闭卸载和 Retry。
当前修正为 `pending-review`。42 个浏览器渲染样本与六组模拟 touch/keyboard
交互通过；全部截图已通过六张联系图打开检查，故意错位和非对称内边距会使
几何检查失败。证据与适用边界见
[Mobile 原型入口](../../../../platform/client/mobile/prototype/README.md)。
