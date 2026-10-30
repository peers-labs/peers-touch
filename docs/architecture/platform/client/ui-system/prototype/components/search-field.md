# SearchField · 搜索框（组件训练 01）

> **Status**: draft（北极星窗框内训练中，未晋升 peers-ui）
> **Created**: 2026-10-30
> **Owner**: Client Platform / UI System
> **Specimen**: `packages/prototypes/shared/ui-system/DesignDirections.tsx` · `design-directions.css`
> **Gate**: `tooling/scripts/ui-system/suites/north-star.suite.json`

## 1. 产品用途与边界（先于视觉）

- **用于**：在当前窗框范围内，按名称/站点/连接对列表即时过滤；输入只改本地视图。
- **不用于**：页面导航、命令执行、全局设置（归命令面板/设置页）；不发起任何业务写请求。
- **空状态契约**：清空或空查询必须恢复完整列表；清除动作把焦点还给输入框。

## 2. 六维定义

| 维度 | 定义 |
|---|---|
| 文字 | placeholder 13px、三级文字色；输入值用 `--sk-text`；无标签时必须有 `aria-label` |
| 几何 | 宿主高 40；左右内边距 13/10；圆角取 `--sk-radius-control`（皮肤 9–12px），方圆不描边 |
| 色彩 | 面取 `--sk-tile`；前导图标三级文字；聚焦环 `--sk-focus-ring`；不引入皮肤外颜色 |
| 图标 | 前导 search 15px、线宽 1.6–1.7；清除为 20px 圆形 quiet 按钮，仅 filled 态出现 |
| 表面 | 填充砖（材质分层），**无 1px 描边**；玻璃皮肤下半透明白 + 模糊 |
| 布局 | `flex`：前导图标 / 弹性 input / 清除；最小宽 240，长文本 ellipsis，不撑破宿主 |

## 3. 状态合同

| 状态 | 表现 | 可观察断言 |
|---|---|---|
| empty | 前导图标 + placeholder | 无清除按钮 |
| focus | 宿主 2px 焦点环（即时出现，不做 transition）；内嵌 input 无方形 outline | `input` outline-style=none；宿主 box-shadow 含环；craft C13 |
| filled | 右侧清除按钮 | 值非空时清除按钮存在；点击值清空、焦点回输入框 |
| disabled | 降透明度、不可聚焦、无清除按钮 | `disabled` 属性在；焦点不落在其上 |
| 长文本 | 省略号截断 | 无横向溢出（overflow 门禁） |

## 4. 皮肤扩展性

组件只消费角色变量（`--sk-tile` / `--sk-text*` / `--sk-radius-control` /
`--sk-focus-ring`），三套皮肤改值不改规则。新增皮肤禁止为 SearchField 写专用选择器。

## 5. 门禁（机器）

```sh
node tooling/scripts/ui-system/evaluate-specimens.mjs \
  --suite tooling/scripts/ui-system/suites/north-star.suite.json
```

结构计数、filled→clear、focus 焦点环归属、disabled 不可聚焦、长文本无溢出、
craft battery C9/C11/C12、390px 与宽屏。签名与品味仍由人审，作者不自判通过。

## 6. 边界与 UNPROVEN

真实过滤数据源、命令面板边界、读屏实测、触摸键盘、跨皮肤对比度精算、
晋升 peers-ui 后的 API 合同（受控/非受控、i18n、ref 转发）均 UNPROVEN，
在晋升前逐项补。
