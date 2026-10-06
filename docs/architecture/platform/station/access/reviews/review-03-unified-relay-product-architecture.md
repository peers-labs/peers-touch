# Review 03：统一 Relay/Station 接入产品与架构

> **Status**: passed-after-correction
> **Reviewed**: 2026-10-06
> **Scope**: Product + Architecture
> **Reviewer Mode**: findings-first design review

## Findings

| 严重度 | Finding | 证据 | 修正 |
|---|---|---|---|
| P1 | 现有透明 Relay forward 会暴露 Session credential 与业务明文 | `relay/handler_station.go`、`relay-client/subserver.go` | 目标改为 outer TLS + client-to-Station inner TLS opaque tunnel，并删除旧入口 |
| P1 | Station enrollment 可接受 header 声明的 PeerID，未证明私钥控制 | `relay/application/service.go` | 增加 Relay challenge + Station host-key PoP，PeerID 从 public key 推导 |
| P1 | Relay runtime 与 Station 共用完整装配，公网攻击面不清晰 | `tooling/docker/compose.yml`、`apps/station/app/conf/peers.yml` | 保留同一仓库/binary，新增显式 Relay role allowlist |
| P1 | Desktop URL-keyed registry 会把 route 当身份 | `apps/desktop/src-tauri/src/infrastructure/station_registry.rs` | 一个 station-keyed binding 持有 direct/relay route candidates |
| P2 | 自动从 Relay 降级到 direct 会静默改变隐私属性 | 初版 route fallback 语义 | 跨 DIRECT/RELAY 切换默认要求用户显式确认 |
| P2 | 私有 connection grant 可能经 URL/query/log 泄漏 | 初版 private discovery 语义 | 固定 `ptc1:`/deep-link fragment 编码、digest 预登记和全链路脱敏 |
| P2 | Relay credential 与“Relay 不见 credential”表述冲突 | 初版产品/验收措辞 | 收紧为 Relay 不见客户端 Station Session credential 与业务明文 |

复审后无未解决 P0-P2。

## Verdict

`Approved` for execution planning。未声明实现或运行时完成。

## Claim Ledger

| 类型 | 内容 | 证据或来源 | 状态 |
|---|---|---|---|
| 用户问题 | 同一输入应接 Station 或 Relay 并自动识别 | `product-definition.md`、`experience-contract.md` | 目标设计 |
| 用户问题 | Station 注册 Relay 缺少深入实践与验收 | `integration.md` 当前实现证据 | 源码已证明 |
| 核心不变量 | Station identity、Access Gate、Session 和业务真源不进入 Relay | SAL-D07-D10、D-12-D15 | 目标设计 |
| 核心不变量 | 不创建 Relay 专属 registry/session/business API | SAL-D08、SAL-D11、D-16 | 目标设计 |
| 运行基线 | Relay/relay-client 聚焦 race suite 通过 | 本次基线命令 | 运行已验证 |
| 未实现能力 | 客户端 Relay ingress、PoP enrollment、opaque tunnel | 全树 consumer/route/source 检查 | 已证明缺失 |
| 运维前提 | 现有 profiles 为 HTTP，生产 TLS 需要外部 env 授权 | `../env/peers-touch/{one,two,three}` | 尚未授权 |

## Capability Evidence Summary

| 能力 | 源码状态 | 复用决策 | 验证要求 |
|---|---|---|---|
| Direct Station Access | 已存在 | 直接复用并回归 | Desktop/Mobile native |
| Station identity | Mobile 完整、Desktop 不完整 | 重构后双端复用 | challenge/signature/pin |
| Relay Station transport | 原型存在 | 安全重构后复用 | enrollment/tunnel/limits |
| Client-via-Relay | 无生产 consumer | 真正新增 transport adapter | 双端原生 Journey |
| Federation business API | 已存在 | 直接复用 | typed peer route 回归 |

## Reuse Decisions

- **直接复用**：Station Access Gate、Session、业务 router、Federation owner。
- **重构后复用**：Relay stream manager、relay-client lifecycle、Station registry、
  signed Station identity。
- **真正新增**：endpoint discovery Proto、route attestation、opaque tunnel frame
  与 Station inner TLS ingress。
- **禁止新增**：Relay 业务 API、Relay client account/session、独立 Relay 仓库。

## Applicable Gates

| 门禁 | 计划 |
|---|---|
| 隔离环境 | 两 Station + 一 Relay + Desktop + iOS Simulator |
| Build / Unit | Go race、Proto、Desktop check/release、Mobile native |
| API | discovery、enrollment、rotate、revoke、typed peer transport |
| Native E2E | direct/relay/explicit route switch/restart |
| Security | forgery/replay/SPKI/oversize/overload/plaintext observation |
| 文档 | architecture module governance + plan validation |

## Residual Risks

- inner TLS over Relay transport 的具体 connector 实现成本较高，Task 4 必须先用
  reference harness 证明协议，再让双端消费。
- 现有 profile 的 TLS 与 role 配置不满足最终 proof；没有外部 env 授权时只能完成
  source 和本地隔离验证，不能声称生产拓扑验收。
