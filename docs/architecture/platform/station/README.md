# Station Platform Architecture

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-05 | **Updated**: 2026-10-05
> **Owner**: Station Platform Team

---

## 1. Document Scope

This directory contains Station platform boundaries that are not product
domains: client admission, framework isolation, and shared Station runtime
mechanics. Station business subservers remain represented by `domains/` or
`shared/`.

## 2. Architecture Map

| Concern | Entry |
|---|---|
| Signed Station access and Gate chain | [access/](./access/README.md) |
| Actor-isolated execution environment | [actor-isolation.md](./actor-isolation.md) |

## 3. Code-Backed Architecture Gaps

`dashboard`, `launcher`, `manage`, `app_meta`, and `frontend_telemetry` have
source ownership but no accepted Station operations architecture set. They are
listed as gaps instead of being folded into unrelated modules.
