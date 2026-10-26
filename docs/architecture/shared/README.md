# Shared System Capabilities

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-05 | **Updated**: 2026-10-06
> **Owner**: Architecture Team

---

## 1. Document Scope

`shared/` contains cross-domain capabilities with their own narrow owners.
They may support several business domains but must not become a second
business authority.

## 2. Capability Map

| Capability | Entry |
|---|---|
| Realtime event transport | [communication/](./communication/README.md) |
| Cross-domain content security | [security/](./security/README.md) |
| Internationalization | [i18n/](./i18n/README.md) |

## 3. Design Proposals

- [Schema](./schema/README.md) — 通用链接、DeepURL 与标准/Peers 风格二维码，
  支持受控头像注入；待确认草案，不拥有登录或网络 authority。
