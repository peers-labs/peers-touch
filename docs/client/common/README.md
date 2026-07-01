# Client Common Docs

本目录承载 Desktop 与 Mobile 共同遵守的客户端通用契约。

## Reading Order

1. [ux-design-methodology.md](./ux-design-methodology.md) — 从具体 UX 问题抽象为准则、契约、invariant 的方法论。
2. [ui-identity/README.md](./ui-identity/README.md) — Peers Touch 客户端通用 UI Identity、模块 UI ID、跨模块 patterns。
   补充阅读：[ui-identity/new-identity.md](./ui-identity/new-identity.md) — 新的 UI Identity 总纲草案，聚焦“统一但平”与“引导 + 发散”的重构方向。
   补充阅读：[ui-identity/frontend-component-tree.md](./ui-identity/frontend-component-tree.md) — 前端组件树、Alive 策略、渲染边界与卡顿规避标准。
   补充阅读：[ui-identity/frontend-component-tree-registry.md](./ui-identity/frontend-component-tree-registry.md) — 一级模块、Settings/provider、Applet、大列表等 Alive / 非 Alive 登记表。
3. [form-control-ux-contract.md](./form-control-ux-contract.md) — 跨端表单控件与组合输入控件体验契约。
4. [base.md](./base.md) — 跨平台共享策略。
5. [globalcontext.md](./globalcontext.md) — GlobalContext 相关共享说明。
6. [packages.md](./packages.md) — shared package 说明。

## Related Platform Docs

- [../mobile/form-control-layout-contract.md](../mobile/form-control-layout-contract.md)
- [../desktop/base.md](../desktop/base.md)
- [../mobile/base.md](../mobile/base.md)

## Related Knowledge

- [../../knowledge/invariants/composite-form-control-boundaries.md](../../knowledge/invariants/composite-form-control-boundaries.md)
- [../../knowledge/playbooks/ux-case-to-contract.md](../../knowledge/playbooks/ux-case-to-contract.md)

## UI Identity Modules

- [ui-identity/modules/social/README.md](./ui-identity/modules/social/README.md) — Human 联邦社交 UI ID，当前作为方法论验证样板。
