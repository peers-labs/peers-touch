# Test Resources

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-07-06 | **Updated**: 2026-07-06
> **Owner**: Peers-Touch Engineering

---

## 1. Scope

本文档记录本地开发、验收、E2E 性能排查可复用的测试资源物料。

本文档不定义生产账号、权限策略、认证架构或安全边界。

---

## 2. Desktop 常用测试账号

仅用于 `profile=one` 等测试/验收环境。

| Account | Password | PIN | 用途 |
|---|---|---|---|
| `b@p.t` | `1` | `111111` | Desktop E2E、双账号对照、卡顿排查 |
| `c@p.t` | `1` | `111111` | Desktop E2E、双账号对照、卡顿排查 |

---

## 3. 使用约束

- 不用于生产环境。
- 不写入自动化脚本的永久配置；E2E 脚本需要时应通过环境变量或测试夹具注入。
- 性能排查报告引用这些账号时，只记录账号标识和测试环境，不扩散到生产文档。
