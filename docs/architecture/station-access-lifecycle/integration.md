# Station 接入生命周期 - 集成与硬切

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-09-26 | **Updated**: 2026-09-26
> **Owner**: Identity and Access

---

## 1. 当前实现映射

| Concern | 当前入口 | 问题 | 目标 |
|---|---|---|---|
| Desktop login | `application/auth/service.rs`、`auth_login` | Access Gate 404 回退 `/actor/login` | 只保留 protobuf Access Gate |
| Mobile login | `authSession.ts`、`AccessGateHost.tsx` | 仍有旧账号 key 清理 | 只读 scoped canonical key |
| Station trust | Mobile `stationConnection.ts`；Desktop `probe_station` | Desktop 未将签名 identity 作为 auth 前置 | 双端相同验证 |
| Federation context | 双端 list/resolve | scope 语义分散 | 明确 context contract |
| Federation governance | Desktop Settings 与 Rust commands | 普通用户不应拥有 | 移至 operator plane |
| Relay | Station relay/relay-client | 客户端展示技术拓扑 | 仅 Station/运维与诊断 |

## 2. 保留的 Owner

- Station Identity：签名 statement 与验证协议。
- Access Gate：进入 Station 的唯一 policy owner。
- Actor：PTID、profile 与 discoverability。
- Federation：Station membership、Ledger 与 transport。
- Relay：转发、mount 与 invite。
- `station-api-capabilities.yaml`：Station route/owner 唯一注册表。

本模块只定义客户端接入编排，不成为新的业务真源。

## 3. Access 硬切

保留：

- `access_start`、generic `access_submit`、`access_decision`、`access_cancel`；
- `station_identity.proto` 与签名验证；
- 双端 identity/access runtime；
- Station-scoped remembered accounts。

删除：

- Desktop `auth_login` Tauri/http-gateway/frontend chain；
- `direct_login_fallback` 与 `/actor/login` 客户端调用；
- Station legacy login/invite submission handlers；
- JSON key/enum dual-form normalizer；
- Mobile unscoped legacy account key 与兼容 purge；
- “probe 成功即信任 Station”的分支。

## 4. Federation 与 Relay 硬切

普通客户端保留 context list/select、scoped search/resolve 和连接状态。

Desktop 删除 `federation_create`、`federation_join`、`federation_leave`、
`federation_delete`、`federation_list_member_stations` 的 UI/TS/Rust consumer
chain。Station API 仅在 Dashboard/CLI 有真实 consumer 时保留。

`/actor/federation/me` 与 `/actor/federation/visibility` 的用户资料语义收敛到
Actor Profile；health 只用于运维。客户端不直接访问 `/relay/*`。

## 5. 干净基线

执行时：

1. 先完成 canonical consumer 与失败语义。
2. 在同一 closure 删除旧 route、wrapper、parser、key 和测试。
3. 删除受影响的 schema/backfill/compat reader。
4. 对获批的开发环境重置数据，从 clean install 建立双端 scope。
5. 运行首次接入、恢复、切换和 Federation context E2E。

不编写旧数据迁移，不保留 compatibility version marker。

## 6. 文档同步

接受后同步：

- `docs/architecture/access-gates/`：客户端 protobuf-only。
- `docs/architecture/federation/`：普通客户端只消费 context。
- `docs/architecture/api-ownership/`：删除无 consumer route/wrapper。
- `docs/client/desktop/` 与 `docs/client/mobile/`：同一接入状态与 scope。
- `docs/knowledge/`：移除被硬切淘汰的兼容 invariant。
