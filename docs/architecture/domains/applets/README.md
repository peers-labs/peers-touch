# Applet Business Domains

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-05 | **Updated**: 2026-10-05
> **Owner**: Architecture Team

---

## 1. Document Scope

This directory contains product domains implemented as applets. The Host,
SDK, capability gateway, lifecycle, and packaging contracts remain under
[Platform Applet Runtime](../../platform/applet-runtime/README.md).

## 2. Current Modules

| Applet domain | Entry | Status |
|---|---|---|
| Atelier | [atelier/](./atelier/README.md) | draft |

## 3. Code-Backed Architecture Gaps

- Note has Proto CRUD, service ownership, and an official applet, but no
  accepted standalone domain architecture set.
- Applet Catalog has `applet_store` ownership, installation state, bundles,
  and audit behavior, but no accepted product-domain architecture set.

These gaps are explicit. Applet Runtime documents must not silently become
their business architecture.
