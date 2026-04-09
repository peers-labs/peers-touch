1. 更新 `Layout.tsx`，减小底部 Tab 框的圆角半径（`rounded-t-2xl` -> `rounded-t-xl`）。
2. 压缩底部 Tab 区域的垂直高度（`expandedHeight` 减小到 60，`collapsedHeight` 减小到 32，减小 `pb`）。
3. 优化背景融合效果，移除 `border-t`，使用 `bg-gradient-to-t from-white/95 to-white/75 backdrop-blur-2xl` 和极淡的阴影 `shadow-[0_-4px_20px_rgba(0,0,0,0.02)]` 实现自然过渡。