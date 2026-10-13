# Node Connectivity

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-10-10 | **Updated**: 2026-10-13
> **Owner**: Architecture Team
> **Module**: `apps/station/frame/core/plugin/native/`

---

## 1. Document Scope

本文档集是 Node 连通性与 Relay transport 的唯一架构真源，定义已评审目标：

- 逻辑 Station 身份与独立物理 Node PeerID 的授权关系；
- 单进程单 Host、内置 Frame 接入与 canonical HTTP/protobuf API；
- 标准 libp2p Direct / Circuit Relay v2，以及有界端到端 TLS；
- Relay enrollment、signed route、private grant 与 admission；
- 单节点和集群部署的共享状态、事件恢复、租约及就绪条件；
- Station Access、Federation 和各业务域的 ownership 分界。

设计接受不等于源码交付；当前源码事实和缺口见 `design.md` Evidence Ledger。
候选执行计划未批准、未挂载，不构成运行时完成证据。

本文档集不定义：

- Access Gate、Session 类别和客户端接入 Journey，见
  [Station Access](../../station/access/README.md)；
- Federation membership、Ledger、sequencer 和业务授权，见
  [Federation](../../../domains/federation/README.md)；
- Chat、Social、Agent 等业务 API；
- 通用 P2P mesh、客户端业务监听、DCUtR 保证或跨区域数据库复制；
- 新增 Gateway 服务、业务 command 协议、scheduler 或消息 broker。

## 2. Current Problem

个人和家庭只需一个 Station 节点；私有团队需要同一逻辑 Station 可运行多个节点。
当前 Host identity、进程内事件 fanout、Agent 启动恢复和 OSS 内存锁无法直接证明
集群正确性。现有 Frame 已有 transport/router 边界，接入能力应在这里扩展。
Relay 的标准传输替换与业务集群就绪分别验证，不能把连通性当成高可用。

## 3. Design Goals

1. Relay 永远不是 Station、Federation 或业务 authority。
2. `station_peer_id` 是逻辑身份，每个 Node 使用独立 transport key / PeerID。
3. Station 和 Relay 复用 binary；Station 内置 Frame 接入，只有两种服务角色。
4. Direct / Circuit v2 共用 canonical router，不引入第二套业务协议。
5. 标准库管理 transport；Model 定义签名控制契约；资源限制显式配置。
6. N=1 / N>1 使用同一代码，集群启动校验共享状态与 fenced domain workers。
7. 同一逻辑 Station 切节点保留 Session、设备 cursor 和业务幂等语义。
8. 单一传输切换完整删除自研 WSS/mount framing，无兼容数据面。
9. Relay service host 继续使用 Linux/POSIX；平台适配分别证明。
10. Desktop 由 Tauri composition root 持有一个显式 StationRuntime；不通过
    getter、localhost proxy 或进程全局单例隐式创建 transport 资源。
11. Desktop transport identity 按已验证 endpoint scope 持久化；Station 资源以
    transport-independent reference 投影，不把 active route origin 当作资源身份。

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [design.md](./design.md) | Ownership、拓扑、信任边界与运行流 |
| [decisions.md](./decisions.md) | 当前接受的 Relay/route/runtime 决策 |
| [data-model.md](./data-model.md) | Identity、delegation、route、grant、registry 与 shared-state contracts |
| [module-layout.md](./module-layout.md) | 目标 owner、现有扩展点与依赖方向 |
| [integration.md](./integration.md) | consumer cutover、风险与真实验证契约 |
| [候选执行计划](./execution-plans/20261011-unified-station/plan.md) | 新目标、纵向闭环、依赖与批准边界 |
| [Desktop StationRuntime 重构计划](./execution-plans/20261012-desktop-station-runtime/plan.md) | Desktop app-scoped transport lifecycle、typed client 与原生证明 |

## 5. Related Sources

- [Station Access](../../station/access/README.md)
- [Federation](../../../domains/federation/README.md)
- [Service Coordination](../service-coordination.md)
- [Station Platform](../../../../station/base.md)
