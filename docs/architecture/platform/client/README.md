# Client Platform

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-10-05 | **Updated**: 2026-10-17
> **Owner**: Client Platform Team

---

## 1. Document Scope

This directory contains cross-layer architecture for Desktop, Mobile,
cross-client reusable assets and portable runtime boundaries, and the shared
frontend runtime. Platform-internal implementation guidance remains in
`docs/client/`.

## 2. Client Map

| Client | Entry |
|---|---|
| Desktop/Mobile forms, reusable assets, reuse admission, portable Rust cores, hosts, and ports | [cross-client-runtime/](./cross-client-runtime/README.md) |
| Desktop runtime | [desktop/](./desktop/README.md) |
| Mobile shell and native kernel | [mobile/](./mobile/README.md) |
| Shared frontend Page/Runtime/Boot model | [frontend-runtime/](./frontend-runtime/README.md) |
| Signed bootstrap and release configuration | [control-plane/](./control-plane/README.md) |
