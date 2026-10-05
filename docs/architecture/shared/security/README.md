# Shared Security

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-05 | **Updated**: 2026-10-05
> **Owner**: Architecture Team

---

## 1. Document Scope

This directory contains security mechanics reused by multiple business
domains. It does not own Chat or Social business truth.

## 2. Modules

| Module | Entry | Boundary |
|---|---|---|
| Secure Content | [secure-content/](./secure-content/README.md) | Stateless encryption, validation, recovery, and opaque-object mechanics |

Chat-specific Direct/Group encryption remains under
[Chat Encryption](../../domains/chat/encryption/README.md).
