# Peers Touch Mobile PROMPTs

本目录用于建立移动端（iOS/Android）设计与实现的系统化基准，统一 UI 风格（LobeChat）、代码架构（沿用 Desktop 结构），指导后续模块扩展与演进。

## 三阶段目标

1) 建立设计基准：明确移动端的全局定位、交互框架、视觉与动效标准（参照 LobeChat 风格）
2) 搭建视觉系统：沉淀主题与 UI Kit，语义化 Token（颜色、字号、间距、阴影、圆角）并形成组件库
3) 精炼交互体验：完善骨架态、加载态、反馈态与过渡动效，提升移动端手势与性能体验

## 文档结构

- 1.global_description.zh.md：全局定位与设计基准
- 2.global_ui_skeleton.zh.md：移动端 LobeChat 风格导航骨架与布局细则
- 3.global_ui_components.zh.md：移动端组件清单与规范
- 4.global_ui_kit_and_theme.zh.md：主题系统与 UI Kit 语义化规范
- 5.global_ui_animation_dimension.zh.md：动效维度与时间/曲线基准
- 6.global_ui_visual.zh.md：视觉规格与资源规范

所有规范仅定义“原则与边界”，具体实现在各模块内以最小可依达成，保持模块内聚与复用友好。