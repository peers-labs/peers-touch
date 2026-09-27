# Station 接入生命周期 - 产品状态模型

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-26 | **Updated**: 2026-09-27
> **Owner**: Identity and Access

---

## 1. Station 与 Access

```text
unselected
  -> probing
  -> identity_verifying
  -> identity_confirm_required
  -> access_gating
  -> runtime_bootstrapping
  -> ready
```

| 状态 | 用户含义 | 允许动作 | 禁止动作 |
|---|---|---|---|
| `unselected` | 尚未选择 Station | 添加、选择 | 提交凭据 |
| `probing` | 检查可达性 | 取消 | 将 URL 当身份 |
| `identity_verifying` | 验证签名身份 | 取消、重试 | 登录 |
| `identity_confirm_required` | 首次固定或身份变化 | 确认、返回 | 静默替换 |
| `access_gating` | 执行 gate chain | 当前 gate 动作、取消 | 绕过 gate |
| `runtime_bootstrapping` | 绑定 scope 与 runtime | 等待、失败后重试 | 进入业务页 |
| `ready` | 当前 scope 可用 | 正常使用、切换 | 读取其他 scope |

签名、PeerID、scope 或 gate 不一致统一进入 `blocked_typed`，不得调用未登记入口。

## 2. Federation Context

```text
loading -> single_selected | selection_required | unavailable
selection_required -> selected
selected -> stale -> refreshing -> selected
```

- `single_selected` 与 `selected` 都携带明确 `federation_id`。
- `unavailable` 阻止依赖 Federation 的操作，不伪造默认值。
- Relay 的 `direct/relayed/offline` 仅是诊断投影，不改变 Federation context。

## 3. Scope 切换

```text
ready(previous)
  -> quiescing_previous
  -> projections_cleared
  -> verifying_new
  -> access_gating_new
  -> ready(new)
```

- 前一 runtime 停止后才能清 projection。
- 新 scope 完整 ready 前不得恢复业务页面。
- 前一 scope 的异步请求返回时必须因 revision 不匹配而丢弃。

## 4. 禁止状态

- `ready` 但没有已验证的 `station_peer_id`。
- Session 与 Messaging 使用不同 `device_id`。
- Federation action 没有明确 `federation_id`。
- 前一账号、Station、Chat 或 context projection 出现在新 scope。
- 未知 gate 被转换为其他登录路径或 generic success。
- Relay topology 成为普通客户端可编辑状态。
