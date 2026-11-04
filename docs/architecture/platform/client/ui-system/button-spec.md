# Button 规范提案

> DRAFT；当前没有 Peers Button 实现或已通过的 specimen。约束已有来源与新增提案分别标注。

## 1. 先判断意图

Button 表示一次命令；Link 表示去往一个地址；ToggleButton 表示可保持的选择。三者不能靠同一个 `type="text"` 决定语义。

Button 的视觉层级不决定风险。停止生成可以是高频普通动作；删除、撤销设备、授权工具需要依其对象、影响和可逆性决定确认方式。一个表面只有一个主要承诺区域，同一意图的替代选择可组成 SplitButton。

## 2. 正交轴

**语义轴，提案**

- `behavior`：action / submit / reset。默认 action；表单 submit 显式声明；reset 只在明确“恢复表单初值”时用。
- `emphasis`：primary / secondary / quiet / inline。控制视觉权重，不能用多个 unrelated primary 争夺阅读路径。
- `tone`：neutral / danger。成功不是绿色提交按钮变体；成功是结果状态。
- `density`：文本 Button 使用 compact / standard / chat / hero。inline / header 是 IconButton 的视觉角色；relationshipDecision 为业务 DecisionPair 的固定投影，业务页不能随意指定。整套控件视觉高度共用下述几何合同，但不把这些角色全部塞进文本 Button 类型。
- `content`：label / leadingIconLabel / trailingIconLabel。只有图标的动作使用单独 IconButton，类型要求 `label`。
- `availability`：enabled / disabled-with-reason。业务可用性由业务 Owner 决定。
- `execution`：idle / pending / succeeded / failed / recovering；这是外部 action 投影。pending 不等于 disabled-with-reason，也不等于完成。
- `width`：intrinsic / fill。行尾组保持共同轨道；文本扩展不可导致相邻动作上下错位。
- `selection`：不属于 Button。需要按下持久状态用 ToggleButton。
- `navigation`：不属于 Button。存在真实目标地址用 Link；不在 Button 公共类型添加第三方 `href` 万能模式。

**已有几何约束**

来自 [components.md](../../../../../client/common/ui-identity/components.md#L46-L55) 的视觉高度：inline icon 24、compact text 28、relationship decision 30、standard text 32、chat chrome 34、header icon 36、hero CTA 40。控件圆角只有 6/8/10/12；圆形/胶囊 icon button 不属于产品语言。

**几何绑定，新增提案**

- inline 24→radius 6；compact 28→6；relationship 30→8；standard 32→8；chat 34→8；header 36→10；hero 40→12。
- 图标 glyph 使用 16/18/20 等 token，由密度决定；按钮外框不直接等于 glyph 大小。
- 触摸命中区域是独立 policy：建议最小 44×44 CSS px 等价目标，可在紧凑外框外围扩展；命中区域不能彼此重叠。44 是目标提案，不是当前已测设备事实。
- focus-visible 由语义拥有者显示一圈；同一 composite 不叠加子控件 ring。
- “loading”不能只替换文本为 spinner 导致宽度跳变；保留标签或固定原宽度。

## 3. 场景矩阵

每项包含选择、具体文字、命令/状态 Owner、失败恢复和禁用情况。文字为可本地化示例。

### B01 保存配置

- primary / neutral / standard / label；文案“保存”→“正在保存”。
- 提交 dirty 字段；Field/Form Owner 聚合校验，Settings runtime 执行写入。
- 无改动时可禁用并说明；权限不足用原因和可执行路径。验证失败定位首个字段。
- 写入失败保留所有 dirty values；成功只在 owner 确认后显示。不要用 `onClick` 先清空表单。

### B02 发送消息

- primary / neutral / chat / leadingIconLabel；窄屏可用具名 IconButton“发送消息”。
- IME composition 与 Shift+Enter 换行不能触发提交；Enter 行为由 composer policy 决定。
- 草稿与附件集合归 MessageComposer/runtime；提交携带同一 intentId，重复按键不产生多份消息。
- 空草稿且无可发附件禁用并可解释；离线是否入本地队列由 messaging 合同决定。失败保留正文和附件。

### B03 停止 Agent 输出

- secondary 或 quiet / neutral / chat；文案“停止生成”，停止 glyph 为自有 Icon ID。
- 从 running 变为 stopping；响应确认或终态事件才变 stopped；不是删掉对话。
- request-stop 失败保持已生成内容并允许重试；不可瞬间切成“已完成”。
- 取消整个任务与停止当前流必须是两个不同 action ID。

### B04 取消操作

- secondary / neutral / standard；“取消”。
- 未提交编辑取消=退出编辑并处理 dirty；运行中取消=向执行 owner 发出取消意图。
- pending 的主按钮不能让取消一起消失；取消本身 pending 时只锁重复取消。
- 取消确认与超时不等于后台任务终止；关闭视图不得静默遗弃需清理的资源。

### B05 删除对象

- quiet / danger 于对象上下文；确认面内 primary / danger / standard；文案“删除会话『项目讨论』”。
- 低风险可撤销删除可 ConfirmAction + Undo；不可逆删除用 ConfirmDialog，说明范围与后果。
- 命令由 domain owner 执行；成功之前不抹去关键上下文。失败保持对象且提示受影响范围。
- 通常不在阅读段落中摆一个像普通导航的红色 inline link。

### B06 重试失败

- secondary / neutral / standard；“重试发送”或“重新连接”，不要只写“重试”而丢失对象。
- 在局部 RecoveryState 或 AttachmentItem；使用已有 intentId 的恢复语义，避免新建重复业务对象。
- recovering 状态保留原失败和草稿；达到预算说明下一步；不可无限自动重试。
- 若原任务已经被别端完成，消费最新投影，不重新执行。

### B07 复制内容

- quiet / neutral / inline IconButton，或 inline label；“复制消息”→“已复制”。
- Clipboard adapter 返回成功才显示 succeeded；拒绝时可选择文本手动复制。
- 短暂成功提示不改变按钮永久含义，timer 在卸载清理。
- 敏感内容使用 SecretValue/CopyAction 的专用 policy；不能把明文塞进 telemetry。

### B08 添加对象

- secondary / neutral / standard / leadingIconLabel；“添加成员”“新建 Agent”。
- 只是进入创建任务，不代表创建成功；提交在目标表面有自己的主承诺。
- 列表空状态可升为 primary；已有内容里高频管理入口保持 secondary。
- dashed 不是默认“新增”语义；如视觉模式需要虚线边界应归 FileDropzone 等具体合同。

### B09 打开详情

- 真实可路由目标用 Link；局部展开用 quiet Button/Disclosure；“查看附件详情”。
- 源对象 identity 和返回位置保持；键盘打开后焦点进入目标标题或局部内容。
- 不能用 Button 包 `href` 丢失复制链接和新窗口行为。

### B10 更多操作

- quiet / neutral / inline/header IconButton；label“消息更多操作”。
- 作为 Menu trigger，keyboard ArrowDown/Enter/Space 打开按 menu contract；Escape 返回 trigger。
- 移动长按与 visible menu 入口必须提供同一命令集合；hover 不是唯一可发现路径。
- trigger 不能同时发业务命令。

### B11 SplitButton 替代操作

- primary/secondary 主动作“发送”；独立菜单 trigger“选择发送方式”。
- 适用“发送/定时发送”“导出/选择格式”：主动作是明确默认，菜单是同意图变体。
- 两部分同高度、外轮廓、pending/disabled policy；主区点击不展开菜单，菜单不提交默认动作。
- 不能把不同对象的“删除/编辑”塞成一个主承诺。

### B12 批准权限

- primary / neutral / standard / label；“允许此次读取所选文件”。
- PermissionDecision 展示资源、范围、期限和后果；允许一次、持续授权、拒绝为不同语义。
- pending 期间重复批准去重；已过期/别端已处理要消费真实终态；失败保留请求详情。
- 不让默认 Enter、焦点落点或超时自动代表用户批准。

### B13 接受 / 拒绝关系请求

- 使用 canonical DecisionPair，由 RelationshipRequestItem 提供；固定 30 视觉高度和一致圆角。
- 接受 primary/neutral，拒绝 secondary；是否 danger 取决于实际影响，拒绝本身通常不是破坏性删除。
- Contacts 与 Notifications 同实体、同动作、同 label、同 marker；不是两套手画按钮。
- 任一动作 pending 锁住该请求的竞争决策；过期、撤回、已处理提供真实结果。

### B14 格式或筛选开关

- ToggleButton / ToggleGroup；例“加粗”使用 aria-pressed。
- 已选状态可持久；onToggle 改本地编辑状态或发业务选择，不能假设它是一次提交 Button。
- 互斥值和多选值显式；失败恢复之前选择。

### B15 立即生效设置

- SettingRow + Switch；例“启用消息通知”。
- label 不随值变为两种命令；远端 pending 独立，失败 rollback。
- 待统一提交的表单值用 Checkbox。不要用 primary Button 的颜色表达 on。

### B16 下载 / 导出

- secondary / neutral / standard / leadingIconLabel；“保存附件”“导出对话”。
- DownloadAction 负责准备、可测进度、取消和失败；资源接口负责访问权限、文件名和有效期。
- 浏览器下载启动不等于 OS 已写盘；产品成功文案匹配实际可证实语义。

### B17 清空 / 重置

- 清空字段用 quiet IconButton“清空搜索”；重置整个表单用 secondary Button“恢复初始值”。
- 清空可保留焦点和已选对象政策；reset 要处理 dirty，不能自动提交默认值。
- 清除本地输入与删除业务记录分开；bulk destructive 走 B05。

### B18 打开外部资源

- Link + trailing external glyph，显示目标名；外部 browser/host adapter 管理 handoff。
- 允许复制目标、打开新标签；权限拒绝可恢复。
- 不把外部 handoff 当作已完成远端操作。

### B19 不可用但需要解释

- 禁用样式保持可读，附近 inline reason：“需要先连接 Station”；可用恢复按钮“连接”。
- 不把原因仅藏进不可聚焦 disabled button 的 Tooltip。
- 若解释是必需操作入口，采用 aria-disabled 的可聚焦说明模式，统一组件拦截 activation；不能同时靠 CSS 和默认事件偶然阻止。

### B20 批量承诺

- primary/secondary + label“删除所选 3 项”；危险则 danger。
- 展示选中数量、影响、权限差异；混合结果逐项可读。
- pending 避免 stale selection 改变目标集合；失败保留未成功项，成功项不可重复提交。

## 4. 状态与重复操作

- enabled+idle：可以发一次 activate intent。
- pending：保持可读；单动作 single-flight；反馈属于同一对象；独立 stop/cancel 可用。
- disabled-with-reason：拒绝 activate；原因有真实可读路径。
- succeeded：以 owner 返回/投影为准；视觉恢复不擦除业务事实。
- failed：本地保留输入和对象；reason 类型决定 retry、edit、request-access、return。
- recovering：再次操作绑定原意图或明确新意图；不依赖 Button 自动判断业务幂等。
- unmounted：不再消费旧回调；Button 清理自身 timer/listener，不能未经 owner 同意终止业务任务。

控件阻止连点只是 UI 防护，不能承担服务器幂等。命令身份、lease、授权、重放与取消语义继续使用既有业务协议。

## 5. 公共 API 形状提案

```ts
type Emphasis = 'primary' | 'secondary' | 'quiet' | 'inline';
type ActionTone = 'neutral' | 'danger';
type ButtonDensity = 'compact' | 'standard' | 'chat' | 'hero';
type ActionAvailability =
  | { kind: 'enabled' }
  | { kind: 'disabled'; reason: string; reasonId: string };
type ExecutionView =
  | { kind: 'idle' }
  | { kind: 'pending'; label: string }
  | { kind: 'succeeded'; label: string }
  | { kind: 'failed'; label: string; reason: string }
  | { kind: 'recovering'; label: string };
interface ButtonContract {
  actionId: string;
  label: string;
  emphasis?: Emphasis;
  tone?: ActionTone;
  density?: ButtonDensity;
  behavior?: 'action' | 'submit' | 'reset';
  availability: ActionAvailability;
  execution: ExecutionView;
  icon?: PeersIconId;
  iconPosition?: 'start' | 'end';
  width?: 'intrinsic' | 'fill';
  onActivate: () => void;
}
```

这里展示跨 renderer 的语义形状，不是可导入的 TypeScript 实现。Web wrapper 的 ref、DOM data markers、ARIA 属性在平台合同中定义；不得从 LobeUI/antd 的 `ButtonProps` extend/re-export。IconButton 独立要求 label 与 icon ID；DecisionPair 固定控制尺寸，不向业务开放任意 radius。

## 6. 上游事实与映射

LobeUI 6.9.0 源码 `src/Button/type.ts`：

- type：default / primary / dashed / fill / link / text。
- shape：default / circle / round；size：small / middle / large。
- danger、ghost、loading、block 为独立轴；iconPosition start/end；htmlType、href、target 均存在。
- ghost 的注释说明其含义是移除底色/边框而保留语义颜色，与 antd 的 on-dark-background ghost 不同。
- `SplitButton.Main` 与 `.Menu` 是源对象 member 结构，不是根导出下两个独立控件。
- 当前 Peers 混用 Lobe Button、antd Button、ActionIcon、原生 button；全部 1,769 位点及静态属性在机器附录。

迁移不能机械将第三方 `type` 字符串改名。先判命令/导航/选择，再判 emphasis/tone/density/state；circle/round 无映射，变为 Peers 圆角方形。dashed/fill 的真实用途需逐位点确认，而非偷偷删掉语义。

## 7. 打样与验收

- B01–B20 每个场景至少一个真实自有组件 specimen；各自有失败/恢复分支和 owner mock。
- 基础状态、文本/图标组合、危险与普通、密度尺度、fill/intrinsic、禁用解释和双动作关系均需覆盖。
- keyboard：Enter/Space、form submit、IME、Tab、Escape；读屏 label/state；pointer、touch 的目标和重复操作。
- 多主按钮、圆形 icon button、缺 label、Link 没 href、Toggle 没 pressed、disabled 没 reason、重复提交、失败清空草稿、停止即完成应成为反例 specimen。
- light/dark、长标签、200% 文字、窄屏、RTL、reduced motion；验证外框、命中区、focus ring 与行轨道。
- 单个默认 Button 截图不能通过；mock specimen 证明控件合同，真实发送/批准/删除仍需对应产品 Journey。
