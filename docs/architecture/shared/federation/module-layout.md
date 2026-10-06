# Federation Architecture - 模块目录结构

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Architecture Team

---

## 1. 目录树

```text
model/domain/federation/
├── federation_*.proto          # ledger、membership、policy、projection
└── relay_transport.proto       # enrollment、route、tunnel contract

apps/station/
├── app/subserver/federation/   # Federation business truth
└── frame/core/plugin/native/
    ├── federation/             # typed peer transport adapters
    └── subserver/
        ├── relay/              # Relay runtime capability
        └── relay-client/       # Station-side mount/tunnel ingress

tooling/
├── docker/                     # same image, explicit role composition
└── acceptance/gates/
    ├── federation/
    └── station_access/
```

## 2. 文件职责

| 路径 | 职责 |
|---|---|
| `model/domain/federation/` | 跨 Station deterministic protobuf contract |
| `app/subserver/federation/` | membership、policy、ledger、role 与 materialized state |
| `native/federation/` | locator、resolver、signing 与 typed peer transport |
| `subserver/relay/` | Relay identity、enrollment、directory、opaque tunnel、quota |
| `subserver/relay-client/` | Station mount、rotation、inner TLS ingress |
| `tooling/docker/` | Station/Relay role allowlist 与安全配置注入 |
| `tooling/acceptance/gates/federation/` | Federation governance/transport proof |
| `tooling/acceptance/gates/station_access/` | Client-via-Relay product/security proof |

## 3. 依赖关系

```text
Federation app owner
  -> frame federation interface
  -> relay transport interface

relay-client
  -> relay transport Proto
  -> Station host identity/signing
  -> Station canonical router

relay
  -> relay transport Proto
  -> Relay-owned credential store

Station Access
  -> route attestation consumer
  -> client transport adapter
```

## 4. 禁止结构

- `apps/relay` 独立业务仓或复制的 Station handler tree。
- Relay package 导入 `app/subserver/{actor,chat,social,agent}`。
- Client Relay package拥有账号、Session、Federation 或业务缓存真源。
- Federation app 直接操作 Relay socket、token store 或 stream map。
- JSON-only 跨运行时协议绕开 `model/domain/federation`。
