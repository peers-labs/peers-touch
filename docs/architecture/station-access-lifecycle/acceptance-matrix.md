# Station 接入生命周期 - 验收矩阵

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-26 | **Updated**: 2026-09-26
> **Owner**: Identity and Access

---

## 1. 验收规则

- 所有 required capability 必须由当前精确源码完成 Desktop 与 Mobile 原生证明。
- 双端比较产品语义、状态、错误和持久结果，不比较组件树或 command 数量。
- 接入失败路径必须证明不会调用旧 route。
- 任一 legacy matcher 在九个维度残留均失败。

## 2. Capability Crosswalk

| Capability | Journey | 当前差距 | Gate |
|---|---|---|---|
| SAL-C01 可信 Station | SAL-J01/J03/J05 | 原生双端证据待运行 | SAL-G01 |
| SAL-C02 Access Gate | SAL-J01/J02/J05 | protobuf-only 静态闭环已实现，原生双端证据待运行 | SAL-G01 |
| SAL-C03 Scope 隔离 | SAL-J02/J03 | 双端 scope fence 已实现，原生重启/登出证据待运行 | SAL-G02 |
| SAL-C04 Federation context | SAL-J04 | context 语义分散，Desktop 另有治理 UI | SAL-G03 |
| SAL-C05 基础设施收口 | SAL-J04/J05 | 普通客户端仍暴露治理与 Relay 概念 | SAL-G03 |
| SAL-C06 能力与遗产治理 | 全部 | 缺 client applicability 与零消费者审计 | SAL-G00/SAL-G04 |

## 3. Gates

### SAL-G00：能力契约

- 每个接入 capability 绑定产品 ID、Station owner、Proto contract 与平台适用性。
- 客户端 registry 不复制 Station method/path。
- 无生产 consumer 的 command、wrapper、DTO 和 mock 为零。

### SAL-G01：可信接入

- Desktop 与 Mobile 从新安装开始验证同一签名 Station identity。
- 两端分别通过四个 canonical protobuf endpoint 登录。
- 签名错误、PeerID 变化、404、unknown gate 与 attempt expiry 均 fail closed。
- 运行中不命中 `/actor/login`、`auth_login` 或 fallback。

Stable Gate：`station-access-auth-e2e`，环境
`station-access-native`（macOS Desktop + iOS Simulator，同一 source-attested
Station，无服务端 destructive reset）。

### SAL-G02：Scope 隔离

- Session、Messaging、Federation 与本地 projection 的 Station/Actor/Device 一致。
- 账号、Station 切换和重启不泄漏旧 projection。
- 未限定 scope 的历史 key 与兼容清理逻辑零引用。

Stable Gate：`station-access-scope-isolation-e2e`，环境
`station-access-native`。

### SAL-G03：Federation 与 Relay 边界

- 双端查看或选择明确 `federation_id`，并完成 scoped search/resolve/Chat。
- 普通客户端无 Federation create/join/leave/delete/member-station。
- 普通客户端无 Relay token/invite/mount/endpoint。
- Station operator flows 仍可由真实 Dashboard/CLI consumer 完成。

### SAL-G04：零引用与聚合

九个维度全部为零：production source、client wrapper、Station route/handler、Proto/
generated、schema/backfill、tests/fixtures/mocks、Acceptance runner、docs/locales/
prototype、build/runtime registration。

## 4. 必需运行单元

| Cell | 证明 |
|---|---|
| Desktop native | 首次接入、恢复、切换、失败关闭 |
| Mobile native | 首次接入、恢复、切换、失败关闭 |
| Mixed same-Station | 同一 actor/context 与 scope 一致 |
| Mixed cross-Station | 显式 Federation context 与 Relay 隔离 |
| Fresh install/reset | 无旧 key、旧 route 或兼容 schema 依赖 |

## 5. 完成条件

`STATION_ACCESS_LIFECYCLE_ACCEPTED` 仅在 SAL-G00..SAL-G04 全部通过、所有 Task
为 `done`、`CCU-20260922` 保持 completed 且最终工作树干净时成立。
