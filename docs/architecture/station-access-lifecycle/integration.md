# Station 接入生命周期 - 集成

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-26 | **Updated**: 2026-09-27
> **Owner**: Identity and Access

---

## 1. 当前实现映射

| Concern | Station owner | Desktop consumer | Mobile consumer |
|---|---|---|---|
| Station identity | bootstrap identity | identity kernel | station connection runtime |
| Access attempt | Access Gate | session store + Rust adapter | auth session + Host adapter |
| Session scope | Actor session | runtime coordinator | mobile runtime coordinator |
| Federation context | Federation | context store | social runtime |
| Relay diagnosis | Station operations | read-only status | read-only status |

Desktop 与 Mobile 通过相同 capability ID 和 protobuf contract 对齐，但保留各自
平台 adapter 与 UI 组织。

## 2. Owner Mapping

- Station Identity：签名 statement 与验证协议。
- Access Gate：进入 Station 的唯一 policy owner。
- Actor：PTID、profile 与 discoverability。
- Federation：Station membership、Ledger 与 transport。
- Relay：转发、mount 与 invite。
- `station-api-capabilities.yaml`：Station route/owner 唯一 registry。
- Station Access module contract：双端 consumer 与 scope 约束的机器投影。

本模块只定义客户端接入编排，不成为新的业务真源。

## 3. Access Integration

当前接入链：

```text
station.identity.verify
  -> access.gate.start
  -> access.gate.submit | access.gate.cancel
  -> access.gate.decision
  -> scoped session bootstrap
```

双端必须：

- 使用 generated protobuf codec；
- 在凭据提交前验证签名 Station identity；
- 把 Station、Actor、Device 与 lifecycle generation 一起传递；
- 将未知 gate 或不完整响应转换为 typed failure；
- 只通过 registry 中的能力构建请求。

## 4. Federation And Relay Integration

普通客户端只消费：

- Federation context list/select；
- scoped search/resolve；
- 当前 Station、Federation 名称与连接状态；
- Station 生成的 Relay 诊断摘要。

Federation topology mutation 与 Relay administration 只属于 operator plane。
Actor profile 和 visibility 由 Actor owner 提供。

## 5. Persistence And Lifecycle

客户端持久化 key 包含：

```text
station_peer_id + actor_ptid + device_id + lifecycle_generation
```

切换流程先 quiesce 当前 runtime，再清理 projection，随后验证新 Station 并建立
新 scope。任何异步结果在提交 projection 前重新比较 lifecycle generation。

## 6. Validation

- Station route、Proto 和 owner 由 `station-api-ownership` 验证。
- 双端 capability consumer 由 Station Access current-interface contract 验证。
- 首次接入、恢复、切换和 Federation context 由原生 Acceptance 验证。
- active 文档与模块声明由 architecture module governance 验证。
