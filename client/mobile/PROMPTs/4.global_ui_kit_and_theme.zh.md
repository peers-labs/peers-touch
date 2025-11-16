# 移动端 UI Kit 与主题规范（语义化 Token）

## 核心原则

- 主题驱动：所有样式由主题派生（light/dark），不在组件内写死颜色/字号
- 语义命名：使用 Token（如 `color.surface`、`space.md`、`radius.lg`、`text.body`）替代具体数值
- 封装复用：通用组件以语义属性暴露配置，内部绑定 Token

## 颜色系统（示例）

- Brand：`brand.primary`、`brand.secondary`
- Semantic：`semantic.success`、`semantic.warning`、`semantic.error`、`semantic.info`
- Text：`text.primary`、`text.secondary`、`text.muted`
- Surface：`surface.primary`、`surface.secondary`、`surface.overlay`、`surface.inverse`
- Border/Divider：`border.default`、`divider.default`

暗色主题补偿：提高对比度、降低饱和度；强调层级与阴影轻度提升

## 字体与字号

- 标题：`text.h1`、`h2`、`h3`、`h4`、`h5`
- 正文：`text.body`（16）、`text.sub`（14）
- 辅助：`text.caption`（12）

移动端密度：在 Phone 上字号比桌面放大 1–2 级；平板与桌面一致或稍降

## 间距与圆角

- 间距（4 的倍数）：`space.xs(4)`、`sm(8)`、`md(12)`、`lg(16)`、`xl(24)`、`2xl(32)`
- 圆角：`radius.sm(6)`、`md(8)`、`lg(12)`、`xl(16)`
- 阴影：`elevation.sm`、`md`、`lg`（暗色中适度提升）

## 组件库（示例）

- Buttons：`primary/secondary/ghost/danger`（大小：`sm/md/lg`）
- Inputs：`text/password/search`（状态：`focus/error/disabled`）
- Containers：`card/panel/sheet`（绑定 Surface 与 Elevation）
- Navigation：`app_bar/tab_bar/bottom_tab_bar/drawer`（绑定高度与密度 Token）
- Feedback：`snackbar/toast/dialog/loading_dialog/skeleton`

## 主题实现

- 在 `app/theme/app_theme.dart` 统一定义 Token 与 ThemeData；`app_styles.dart` 暴露便捷常量
- 组件内部仅引用 Token；不直接使用硬编码常量
- 支持动态切换（light/dark/brand 变种），即时生效