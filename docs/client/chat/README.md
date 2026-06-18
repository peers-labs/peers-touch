# Client Chat Docs

本目录承载 Desktop 与 Mobile 共同遵守的 Chat / IM 产品体验契约。

## Reading Order

1. [chat-ux-contract.md](./chat-ux-contract.md) — 跨端 Chat UX 语义、布局边界、消息结构、操作语义的单点真源。
2. [../mobile/chat-layout-contract.md](../mobile/chat-layout-contract.md) — Mobile 专属布局、键盘、安全区、底部输入区、触控菜单规则。
3. [../desktop/chat-layout-contract.md](../desktop/chat-layout-contract.md) — Desktop 专属布局、侧栏、hover、右键菜单、窗口尺寸规则。

## Knowledge Invariants

写代码前还必须读取：

- [../../knowledge/invariants/chat-message-boundaries.md](../../knowledge/invariants/chat-message-boundaries.md)
- [../../knowledge/invariants/mobile-chat-layout-boundaries.md](../../knowledge/invariants/mobile-chat-layout-boundaries.md)
- [../../knowledge/invariants/desktop-chat-layout-boundaries.md](../../knowledge/invariants/desktop-chat-layout-boundaries.md)

## Scope

本目录定义跨端一致体验，不定义 Station 业务真源、proto schema、具体组件 API 或视觉稿像素实现。
