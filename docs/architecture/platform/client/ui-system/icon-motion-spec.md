# 图标几何与动效提案

> DRAFT。具体数值是待打样确认的 Peers 规范提案；没有截图、设备测量或动效 PASS。

当前审阅模型默认沿主线已有时长及登记曲线。[合同审定](./contract-review/audit.md)明确了来源与冲突；本文件的新 easing、glyph stroke 和 optical 数值是待接受的替代提案，不覆盖 active token。

## 1. 先分清三个对象

- Icon glyph：表示动作/对象/状态的图形，具有 Peers icon ID。
- Control contour：承载图形的按钮/头像外框，按控件 geometry token 生成。
- Transition：表达状态变化的时间函数。图标轮廓曲线与时间 easing 不能混成“统一一个曲线”。

供应商商标单独使用 `BrandMark`，记录来源与授权；品牌标志不能因统一线宽而变形。它们不承担普通按钮的状态语义。

## 2. Glyph 几何

**提案基线**

- canonical viewBox 为 24×24，有效绘制区域默认 2–22；容器尺寸按 density 使用 16/18/20/24。
- base stroke 为 1.8 个 viewBox 单位；linecap/linejoin 为 round；普通动作不混用 fill 和 stroke 两套随意风格。
- 简单 glyph 按等比缩放：`s = renderedSize / 24`，物理线宽 `w = 1.8s`。在 16px/18px 的光学特例可用单独 optical asset，禁止页面随手改 strokeWidth。
- path 坐标在 canonical asset 中冻结。尖角、重叠线、光学重心和空白对齐由资产打样验证，不能凭统一 viewBox 声称已一致。
- glyph ID 表达语义，如 `action.send`、`action.stop`、`navigation.more`、`status.warning`、`file.document`；业务不传 lucide constructor、React 图标对象或供应商路径名。
- 装饰 icon 为 aria-hidden；独立传达状态则有可读 label；IconButton 的名称归按钮，不重复朗读图形。

**资产独立边界**

资产清单记录 id、用途、原始来源、license、内容 hash、各 optical size、RTL 镜像政策和所有者。现有 lucide 等可依法内化经审阅的子集；被内化后由 Peers 目录维护，不再由业务依赖供应商 npm 导出。若完全原创资产尚未完成，必须标记 external-origin，不能宣称全资产原创。

方向相关的 back/forward 依 locale policy 镜像；媒体 play、品牌 mark、钟表、数字和绝大多数文件 glyph 不自动镜像。

## 3. 外框轮廓函数

当前 UI Identity 要求圆角方形；本提案选择普通 rounded rectangle。未批准的 squircle/superellipse 不混入同族。

对外框宽高 `W,H`，圆角 `r ≤ min(W,H)/2`；四个角是半径 r 的四分之一圆，边是直线。CSS border-radius 与 Lynx/矢量输出必须对应同一轮廓。

以右上角为例，圆心为 `(W-r,r)`，使用三次 Bezier：

```text
k = 4(√2-1)/3 ≈ 0.5522847498
P0 = (W-r, 0)
P1 = (W-r+kr, 0)
P2 = (W, r-kr)
P3 = (W, r)
B(t) = (1-t)^3P0 + 3(1-t)^2tP1 + 3(1-t)t^2P2 + t^3P3
0 ≤ t ≤ 1
```

这是一条圆弧的 Bezier 近似；其它角用旋转/反射生成，不能每角独立手写四套控制点。

Button 的 `r` 由 density 绑定到 6/8/10/12，详见 Button spec。Avatar 不等同 Button 的尺寸轴：现有 SquareAvatar 默认 `max(8,floor(size×0.25))`，但允许 arbitrary radius/style；目标移除业务任意覆盖并把算法与获准尺寸绑定到 token。对于小尺寸需 `r ≤ size/2` 的钳制，新的尺寸/算法要打样后确认。

focus outline 按同一 contour 扩展，不能因 wrapper 与 control 半径不同而出现两层轮廓。头像与封面重叠的分离 ring 是结构轮廓，不是可信状态。

## 4. 时间函数

**目标 token，提案**

- instant：0ms，用于不需运动的状态/focus/读屏更新。
- fast：100ms，用于 hover/press 与短颜色变化。
- normal：200ms，用于 Popover/Menu/Tab 指示与局部连续性。
- slow：300ms，用于主要面板开合；不用于拖动跟手和文字输入。
- durations 只约束 presentation。命令不能等待动画完成才发出；动画结束不能推断业务成功。

**函数**

标准：`cubic-bezier(0.4,0,0.2,1)`；进入：`cubic-bezier(0.2,0,0,1)`；退出：`cubic-bezier(0.4,0,1,1)`；匀速量化/转动：`linear`。每个 component 明确使用哪个角色；不新增自己的 easing 数字。

对于 `cubic-bezier(x1,y1,x2,y2)`：

```text
x(u) = 3(1-u)^2u·x1 + 3(1-u)u^2·x2 + u^3
y(u) = 3(1-u)^2u·y1 + 3(1-u)u^2·y2 + u^3
progress(t) = y(u), where x(u)=t and 0≤u,t≤1
value(t) = start + (end-start)·progress(t/duration)
```

不能把 `u=t` 直接代入 y 当 CSS easing；renderer 可使用平台 cubic-bezier 或统一数值求解。x1/x2 在 [0,1]；只允许注册过的曲线，避免每页不同手感。

Press 建议仅颜色/局部 stroke 变化。上游 Button 使用 `scale:0.98` + spring（stiffness 600、damping 26、mass 0.6）是上游事实；不是 Peers 已接受的手感。Peers 首版默认无弹簧，若启用需要对应 task 和动态证据。

## 5. 组件级运动用途

- Button/IconButton：fast 的 hover/press；focus ring 即时；pending indicator 不改变控件尺寸。
- Menu/Popover：normal enter/exit，位移建议不超过 4px；anchor 和 collision 修正不做摇摆动画。
- Dialog/Drawer/Sheet：normal 或 slow 解释空间变化；先建立焦点与可交互状态，不能等待 300ms 才响应关闭。
- Tabs/Segmented：normal 仅选中指示；切换的数据载入另有真实 pending。
- Progress：已知进度可 normal 插值，仍显示真实数值；未知进度不可用动画造假。
- Skeleton：只有 loading owner 真正 pending 才显示；reduced motion 去 shimmer；加载失败停止占位。
- Toast：normal；自动消失时钟独立于运动；需要用户决定的消息保持并改用合适 surface。
- ResizablePanel、拖拽排序、Slider：跟手过程不加 easing；release 后的可解释落位可 normal，键盘替代有相同结果。
- 流式消息：不对每个 token fade/scale；保留选区和滚动锚点。

## 6. 减弱运动与资源生命周期

- reduced motion 下非必要位移、缩放、shimmer、连续转动为 0；pending/完成/展开等状态仍由文字、图形或明确布局表达。
- 用户媒体播放与拖动操作不等同装饰运动；它们保留可控状态，不自动播放。
- 组件卸载取消 animation/listener/timer/observer；旧回调不写新对象状态。
- MotionPolicy 从 UIProvider 注入；业务组件不得各自监听系统偏好或创建另一 motion Store。

## 7. 已观察到的真源分裂

- `packages/prototypes/shared/design-tokens/tokens.ts`：brand `#667eea`，fast 140ms、normal 240ms、standard ease。
- Shell `theme.ts` 与 `main.tsx`：主色 `#6b5bd6`；accessibility.md 把 focus 固定到该颜色。
- 若干 glyph 直接设置 strokeWidth 1.15/1.8/2.5；这些是不同源码上下文，尚未验证是缺陷还是有意光学政策。

目标选择 `#6b5bd6` 作为 light brand 的提案，以现有 keyboard focus 和 Shell 为依据；dark brand、contrast、100/200/300ms 均需打样和实际对比确认。当前不能把任一组数值宣布为已统一。

## 8. 打样证据

Icon：全语义索引；16/18/20/24、light/dark、stroke/fill 特例、RTL、后备、品牌分离；轮廓与光学对齐截图。

Motion：每个角色各一动态 specimen；显示 token/函数/时间轴，支持 normal/reduced/instant；打断、重开、滚动、焦点恢复和卸载清理。纯数学函数验证只证明函数定义，不能替代动态 UX。
