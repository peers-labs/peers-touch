# Desktop Platform Architecture

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-05 | **Updated**: 2026-10-16
> **Owner**: Client Platform Team
> **Module**: `apps/desktop/`

---

## 1. Document Scope

This index owns Desktop cross-layer runtime relationships. Detailed Desktop
implementation contracts remain under `docs/client/desktop/`; product-domain
behavior remains under `domains/`. Client forms, portable Rust cores, hosts,
and runtime ports are defined by
[Cross-Client Runtime](../cross-client-runtime/README.md).

## 2. Documents

| Document | Scope |
|---|---|
| [runtime.md](./runtime.md) | renderer, Desktop Rust BFF, native shell, and Station relationship |
| [feature-flags.md](./feature-flags.md) | Desktop feature-flag ownership and evaluation |
| [execution-plans/](./execution-plans/) | Historical Desktop runtime delivery material |
