# Node Connectivity

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-10 | **Updated**: 2026-10-10
> **Owner**: Architecture Team
> **Module**: `apps/station/frame/core/plugin/native/subserver/relay/`, `apps/station/frame/core/plugin/native/subserver/relay-client/`

---

## 1. Document Scope

本文档集是当前 Node 连通性与 Relay transport 的唯一架构真源，定义：

- Station 与 Relay 的运行角色、信任边界和最小能力面；
- Relay enrollment、mount generation、signed route 与 connection grant；
- Client/Station 和 Station/Station 共用的端到端 TLS opaque tunnel；
- Station identity 与 direct/relay route 分离；
- tunnel framing、资源边界、取消、背压和失败语义；
- Linux/POSIX-only Relay service-host 与外层 TLS 部署边界；
- Station Access、Federation 与 Relay transport 的 ownership 分界。

本文档集不定义：

- Access Gate、Session 类别和客户端接入 Journey，见
  [Station Access](../../station/access/README.md)；
- Federation membership、Ledger、sequencer 和业务授权，见
  [Federation](../../../domains/federation/README.md)；
- Chat、Social、Agent 等业务 API；
- 通用 libp2p Circuit Relay、DCUtR 或客户端全面 P2P 改写。

## 2. Current Problem

Relay 协议曾同时散落在 Station Access 与 Federation 文档中，导致同一 enrollment、
route、tunnel 和运行角色由多个模块重复定义。历史透明 HTTP forwarding 还曾让
Relay 读取 method、path、header、Authorization 和业务 body。

当前实现已经硬切到 bounded opaque tunnel，但缺少一个与源码一致、可以被
Station Access 和 Federation 共同引用的单一架构 owner。

## 3. Design Goals

1. Relay 永远不是 Station、Federation 或业务 authority。
2. Relay 只转发有界 inner TLS ciphertext，不解析 HTTP 或业务 Proto。
3. `station_peer_id` 是身份；Relay origin、route 和 tunnel 只是可替换路径。
4. Station enrollment 必须证明 host-key possession，并由 generation 撤销。
5. Station 与 Relay 复用同一 binary，但 Relay role 默认拒绝全部业务能力。
6. Client access 与 Federation peer transport 共用 primitive、分离 caller scope。
7. 所有跨运行时 frame 使用 generated protobuf 和显式资源上限。
8. 历史透明 forwarding、Request/Response frame 和 header passthrough 保持零引用。
9. Relay service host 只使用一套 Linux/POSIX runtime contract；Windows 只作为
   客户端或由 Station 模块独立治理的 Station 平台。

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [design.md](./design.md) | Ownership、拓扑、信任边界与运行流 |
| [decisions.md](./decisions.md) | 当前接受的 Relay/route/runtime 决策 |
| [data-model.md](./data-model.md) | Identity、enrollment、route、grant 与 tunnel contracts |
| [module-layout.md](./module-layout.md) | 当前代码 owner、目录和依赖方向 |
| [integration.md](./integration.md) | Station Access/Federation 映射、语义合并处置与删除清单 |

## 5. Related Sources

- [Station Access](../../station/access/README.md)
- [Federation](../../../domains/federation/README.md)
- [Service Coordination](../service-coordination.md)
- [Station Platform](../../../../station/base.md)
