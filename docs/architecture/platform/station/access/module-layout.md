# Station 统一接入生命周期 - 模块目录结构

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-27 | **Updated**: 2026-10-06
> **Owner**: Identity and Access

---

## 1. 目标目录

```text
model/domain/
├── access_gate/                    # Access attempt/gate/decision
├── peer/
│   ├── station_identity.proto      # Station identity
│   └── access_endpoint.proto       # endpoint role + route attestation
└── federation/
    └── relay_transport.proto       # enrollment + opaque tunnel

apps/station/
├── frame/core/plugin/native/subserver/
│   ├── relay/                      # minimal Relay role
│   └── relay-client/               # Station mount and tunnel ingress
├── frame/core/plugin/native/federation/
│   └── transport                   # typed peer capability adapter
├── frame/core/facility/session/    # canonical client-class Session slots
├── frame/touch/accessgate/         # access policy and attempt owner
├── frame/touch/actor/              # actor and device session owner
└── app/subserver/federation/       # Federation context and operator API

apps/desktop/
├── src-tauri/src/application/station_binding/
├── src-tauri/src/infrastructure/station_transport/
├── src/components/common/StationPicker.tsx
└── src/runtimes/

apps/mobile/
├── src/features/station/
├── src/services/stationTransport.ts
├── src-tauri/src/runtime/station_transport/
└── src/runtimes/

tooling/
├── docker/                         # explicit station/relay role composition
└── acceptance/gates/station_access/
```

## 2. 文件职责

| 路径 | 职责 | 不得承担 |
|---|---|---|
| `model/domain/peer/` | endpoint 与 Station identity wire | transport implementation |
| `model/domain/federation/relay_transport.proto` | Relay control/tunnel wire | business API |
| `subserver/relay/` | Relay identity、directory、mount、opaque forwarding | Actor/Chat/Social policy |
| `subserver/relay-client/` | Station enrollment、credential、inner TLS ingress | Federation governance |
| `native/federation/` | typed Station-to-Station transport adapter | Relay credential ownership |
| Desktop `station_binding/` | station-keyed binding 与 lifecycle | Station business truth |
| 双端 `station_transport` | direct/relay route 建连与切换 | Session scope owner |
| 双端业务 runtimes | 消费同一个 active Station transport | 自行选择 Relay |
| `tooling/docker/` | role allowlist、TLS/key/config 注入 | 复制 Station image |
| `tooling/acceptance/` | exact-source security/Journey proof | 生产状态或凭据真源 |
| `model/domain/access_gate/` | 跨端 Access Gate wire contract | 平台 UI 或持久化策略 |
| `frame/core/facility/session/` | Session class slot、撤销与持久化 | 客户端运行时标签或 UI policy |
| `frame/touch/accessgate/` | gate policy、attempt、decision | 客户端 projection |
| `frame/touch/actor/` | Actor/Device session truth | Federation topology |
| `app/subserver/federation/` | Federation context 与 operator 能力 | 普通客户端 UI |
| `apps/desktop/src/kernel/` | Desktop identity/startup 编排 | Station policy |
| `apps/mobile/src/features/auth/` | Mobile gate 呈现与输入 | Station policy |
| 双端 `runtimes/` | scope 生命周期与异步 fence | 共享业务真相 |

## 3. 依赖关系

```text
generated endpoint / relay contracts
  <- Station identity + Relay transport owners
  <- Desktop/Mobile native transport adapters
  <- canonical Station binding
  <- Access/runtime/UI projections

Station domain APIs
  <- direct TLS OR opaque Relay tunnel

Federation business owner
  -> typed federation transport capability
  -> Relay transport primitive
```

禁止依赖：

- UI 或业务 runtime 直接依赖 Relay admin/client token。
- Relay 导入 Station app business owner。
- Federation frame transport读取 app-layer policy 表。
- 新建 Relay 专属 client store、session store 或业务 API package。
