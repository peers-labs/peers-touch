1. 更新 `Layout.tsx`，将底部 Tab 高度调整为展开 72px / 收起 44px。
2. 移除 `Layout.tsx` 中内容区的 `paddingBottom`，改为通过 CSS 变量 `--tab-height` 传递给子页面，让子页面的背景能够完全延伸到底部，彻底消除内容区底边框和 Tab 区域圆角处的黑线/接缝。
3. 移除 Tab 栏的顶部阴影，确保无缝融合。
4. 更新 `Home.tsx`, `IMChat.tsx`, `AIChat.tsx`, `Settings.tsx`，在各自的滚动区域或底部区域应用 `var(--tab-height)` 作为 padding-bottom，确保内容不被遮挡且背景完美延伸。