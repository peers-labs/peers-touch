# 北极星 · 桌面原型窗框语法

> **Status**: draft（候选语法，逐项待确认；未晋升为生产 token）
> **Created**: 2026-10-30
> **Owner**: Client Platform / UI System
> **Entry**: `?site=frontend-eles&eles=directions`（旧 `eles=northstar` 兼容指向同一视图）
> **Source**: `packages/prototypes/shared/ui-system/DesignDirections.tsx` + `design-directions.css`

## Purpose

一扇持续演进的桌面应用窗框原型，未来收敛为 Desktop 原型；窗框里验证过的
模式反向沉淀进 peers-ui 元素集。**全仓只允许这一扇原型窗框**：新增平行
全屏看板/复制窗框等于造第二套体系，已被明确拒绝。皮肤（color/material）
是窗框内的 CSS 变量维度，结构对所有皮肤完全一致；壁纸是第二条独立维度。

## Frame Grammar（设计原则）

1. **单一窗框，结构分区固定，信息列弹性。**
   60px 图标轨 / 62px 顶栏 / 296px 会话轨为固定几何（命中区 38 + 两侧留白
   反推），中栏 `flex:1` 是唯一随屏宽伸缩的阅读面；≤1040px 隐藏会话轨，
   ≤760px 图标轨转顶栏。任何分辨率下 chrome 几何不变。

2. **Chrome 分区靠材质，不靠发丝线。**
   图标轨、顶栏、会话轨之间**禁止 border 分隔**；层级用半透明表面
   （`--sk-rail-bg` / `--sk-head-bg` / `--sk-chat-bg`）、毛玻璃模糊与投影
   表达。描边发丝线是「后台瓷砖框」观感的来源。内容分组内部的分隔线
   （如「连接」区块底边）允许保留。

3. **圆角长在产生底色的那一层。**
   不允许只给父容器圆角 + `overflow:hidden` 而让实际绘制底色/描边的子元素
   保持直角——一旦裁剪路径变化（脱离父级、独立截图、换容器）方角立刻漏出。
   每个可见填充层必须自带与其角色匹配的 radius。

4. **焦点环跟随圆角；内嵌原生控件不画方形 outline。**
   圆形容器内的 `<input>` 必须在足够特异性下清零全局
   `:focus-visible` 方框，键盘焦点反馈画在圆角宿主上
   （`.host:focus-within { box-shadow: 0 0 0 2px … }`）。焦点态缺陷
   静态截图不可见，只能由聚焦后的计算样式门禁捕获。

5. **自定义按钮必须显式重置 UA 外观。**
   任何自定义 `<button>` 必须消除 `border-style: outset` 与系统灰底
   （`border:0; background:transparent/指定色`），否则残留一块系统按钮方盒。

6. **色彩角色：近黑胶囊承载关键动作/数据，琥珀是唯一强调色。**
   `--sk-primary: #0d100d` 用于主按钮、范围胶囊、选中项、数据胶囊与激活态；
   `--sk-accent: #e8a117` 只用于选中对象、滑杆填充、仪表弧、收藏、在线点。
   黑胶囊不描边、不透底；白卡为半透明白面（glass 皮肤）。

7. **数字仪表盘化：极小灰色标签 vs 超大细体数值。**
   关键数值用 400 字重、26–32px、tabular-nums、负字距；标签 9–10px、
   字距放开、三级灰。卡片内不堆 1px 描边框，用松绿填充砖或白砖 + 柔投影分层。

## Gate（机器门禁）

原则 3/4/5 与结构完整性由确定性套件守护，人工只判签名与品味：

```sh
node tooling/scripts/ui-system/evaluate-specimens.mjs \
  --suite tooling/scripts/ui-system/suites/north-star.suite.json
```

- craft battery C9 `embedded-control-square-focus`
- craft battery C10 `chrome-zone-hairline`
- craft battery C11 `ua-button-chrome`
- 结构计数（单窗框、3 统计/3 对象/3 设置/3 动态/3 会话）、范围切换、
  对象选择、滑杆联动（填充 + 气泡 + 0–7 刻度）、聚焦态计算样式

## Evolution Loop

每个被用户指出的工艺缺陷必须走完闭环，禁止停留在实例修复：

1. 修当前实例（CSS/结构）；
2. 抽象为可观察规则，进 craft battery / suite；
3. 记入 `docs/knowledge/pitfalls/`，owns 指向源码与门禁；
4. 本文件的 Grammar 在规则变化时更新。

## Boundaries

候选数值不写入 active token，不被生产页面消费；Manrope 为候选字体；
外部表达参考保持脱敏，仓内不保存其名称、链接、图像或业务对象。
真实读屏、触摸设备、性能分布、生产消费与用户对签名的最终判定均为 UNPROVEN。
