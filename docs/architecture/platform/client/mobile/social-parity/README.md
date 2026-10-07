# Mobile Social Desktop Parity

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Mobile / Social / Client Architecture
> **Module**: `apps/mobile/`

---

## 1. Document Scope

本文档集定义：

- Mobile Native 对 Desktop Social 的完整用户结果、权限、失败恢复和跨 Station 语义覆盖；
- Mobile 对 Feed、Explore、Feed 内联 thread、临时媒体层、Search、Profile、Circles、
  Audience、Composer、exception Detail、Comment、Reaction、Private Recovery 和 Revocation 的平台适配；
- Mobile Web、Mobile Rust、Station Social、Secure Content 和 Federation 的唯一 owner
  与依赖方向；
- iOS、Android、Desktop 互操作与两 Station runtime cells 的完成口径。

本文档集不定义：

- Social 的业务 authority、Audience 语义或 Federation transport；继续由 Social Core、
  Cross-Station Social、Secure Content 和 Federation 真源定义；
- Desktop 的具体页面实现；
- Browser Social 产品面；Browser Social 继续 prohibited；
- 实施阶段、Task DAG 或交付顺序；由同目录 `execution-plans/` 下的冻结 Plan Version 定义。

## 2. Background

Desktop 已经提供完整 Social 信息架构和 Native private/cross-Station runtime。Mobile
已经具备 public feed/detail、评论/回复、reaction rollback、持久草稿、Profile/People
Search，以及 Rust private publish/read/media/comment/recovery 基础，但这些能力没有形成
一套统一 Mobile Social 产品：

- Composer 只暴露 `PUBLIC`、`FOLLOWERS`、`SELF`；
- private runtime 未接入 feed/detail/composer 的主用户路径；
- Explore、Social Search、User Profile、Circles 和完整 Audience 缺少 Mobile 页面；
- remote pending/retrying/source-unavailable、recovery、revoked 等状态没有统一呈现；
- 当前 Mobile Shell Acceptance 只证明 same-Station，不足以声明 Desktop parity。

因此，本模块不新建 Social 业务栈，而是把现有 Mobile 基础接入同一 Social Core，并以
真实 Desktop/Mobile 互操作证明完整性。

## 3. Design Goals

1. `100% parity` 指用户结果、权限、状态、恢复和跨 Station 语义一致，不要求像素一致。
2. Station 继续拥有 Social 业务真相；Mobile 不复制 Audience、Circle、Post 或互动 authority。
3. Mobile Rust 继续拥有私密密钥、加解密、持久化命令和安全 transport。
4. Mobile Web 只渲染 generation-scoped projection，并通过一个 Social facade dispatch intent。
5. Feed、内联 thread、exception Detail、Composer 和 trust/recovery state 在
   public/private/local/remote 内容间保持连续。
6. iOS 使用 Simulator；Android 必须使用当前 USB authorized 真实设备，禁止用
   Android Emulator 代替；Desktop↔Mobile 双向两 Station 互操作都必须有证据。

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [product-definition.md](./product-definition.md) | Product promise, capability scope, and platform matrix |
| [capability-ledger.md](./capability-ledger.md) | Desktop capability inventory and Mobile gap disposition |
| [experience-contract.md](./experience-contract.md) | End-to-end Mobile Social journeys |
| [product-state-model.md](./product-state-model.md) | User-visible state and recovery contracts |
| [product-feasibility.md](./product-feasibility.md) | Repository-backed feasibility closure |
| [acceptance-matrix.md](./acceptance-matrix.md) | Runtime cells, assertions, and claim boundary |
| [design.md](./design.md) | Ownership, topology, contracts, and quality gates |
| [decisions.md](./decisions.md) | Accepted architecture decisions and rejected alternatives |
| [data-model.md](./data-model.md) | Projection, state, persistence, and type mapping |
| [integration.md](./integration.md) | Existing-source mapping and target cutover boundary |
| [module-layout.md](./module-layout.md) | Target Mobile module ownership |
| [prototype/README.md](./prototype/README.md) | Mobile Shell Social parity prototype amendment |
| [execution plan](./execution-plans/20261006-mobile-social-desktop-parity-v30/plan.md) | Frozen brand/prototype-aligned remaining-closure DAG, authorization, and Acceptance mapping |

## 5. Upstream Sources

- `docs/architecture/domains/social/core/`
- `docs/architecture/domains/social/cross-station/`
- `docs/architecture/shared/security/secure-content/`
- `docs/architecture/shared/federation/`
- `docs/architecture/platform/client/mobile/`
- `docs/client/common/ui-identity/`
- `docs/client/common/ui-identity/modules/social/`
- `docs/client/mobile/`

## 6. Status And Gate

Product and architecture semantics are accepted for planning. The Owner confirmed the executable Mobile
Shell Social parity prototype amendment on 2026-10-06, so the prototype confirmation gate no longer blocks
implementation planning. No production readiness claim is made by this design package.
