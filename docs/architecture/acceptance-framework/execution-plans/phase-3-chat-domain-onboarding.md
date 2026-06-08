# Phase 3: Chat Managed Domain Onboarding

> **Status**: implemented
> **Version**: v1.4
> **Created**: 2026-06-04 | **Updated**: 2026-06-04
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 目标

本阶段把 `chat` 接入项目级 Acceptance Framework，验证 acceptance 能覆盖更接近用户主路径的产品能力，而不仅是 Federation 或管理面。

目标边界：

- `chat` 是 managed domain，不承担框架自证职责。
- Chat persistence truth 属于 `friend_chat` service / repository 和 proto contract。
- Realtime / SSE 是 delivery contract，不是 message persistence truth。
- Desktop chat typed surface 只能证明编译期契约，不替代 DOM 级 UI E2E。

---

## 交付物

| 交付物 | 路径 | 状态 |
|--------|------|------|
| Domain index entry | `tooling/acceptance/domains/index.yaml` | done |
| Domain profile | `tooling/acceptance/domains/chat.yaml` | done |
| Capability file | `tooling/acceptance/capabilities/chat.yaml` | done |
| Service feature contract | `tooling/acceptance/features/chat-service-contract.yaml` | done |
| Realtime feature contract | `tooling/acceptance/features/chat-realtime-delivery.yaml` | done |
| Live realtime feature contract | `tooling/acceptance/features/chat-live-realtime-delivery.yaml` | done |
| Desktop surface feature contract | `tooling/acceptance/features/desktop-chat-surface.yaml` | done |
| Runtime flow feature contract | `tooling/acceptance/features/chat-runtime-message-flow.yaml` | done |
| Desktop gateway feature contract | `tooling/acceptance/features/chat-desktop-gateway-message-flow.yaml` | optional done |
| Desktop DOM visibility feature contract | `tooling/acceptance/features/chat-desktop-dom-message-visible.yaml` | optional done |
| Runtime E2E gate | `tooling/acceptance/gates/chat/runtime_e2e.py` | done |
| Live realtime E2E gate | `tooling/acceptance/gates/chat/live_realtime_e2e.py` | done |
| Desktop gateway E2E gate | `tooling/acceptance/gates/chat/desktop_gateway_e2e.py` | optional done |
| Desktop DOM message visibility gate | `tooling/acceptance/gates/chat/desktop_dom_message_visible.py` | optional done |
| Registry rules | `tooling/acceptance/registry.yaml` | done |
| Gate catalog entries | `tooling/acceptance/gates.yaml` | done |
| Make targets | `Makefile` | done |
| Architecture design update | `docs/architecture/acceptance-framework/design.md` | done |
| Decision record | `docs/architecture/acceptance-framework/decisions.md` | done |

---

## 验证标准

本阶段完成必须满足：

- `make acceptance-validate DOMAIN=chat` 通过，证明 profile / capability / feature / registry / gate 结构自洽。
- `make acceptance-validate` 通过，证明所有 active domains 可被项目级入口统一验证。
- `make acceptance-coverage-report` 能展示 `chat` 为 `managed_domain`。
- `make acceptance-plan` 在 chat owned paths 变更时能选择对应 gates。
- `make acceptance-chat-domain-validation` 可作为 evidence-proven 入口运行。
- `chat-runtime-e2e` 在运行中的 Station 上完成两 actor session、send、list、read acknowledgement 链路。
- `chat-live-realtime-e2e` 在运行中的 Station 上完成两 actor `/events/stream` 实时消息和已读回执链路。
- `chat-desktop-gateway-e2e` 可在显式启动 Desktop HTTP gateway 时运行，验证 desktop-rust BFF 的 auth、session list、sync、message list 和 ack 链路。
- `chat-desktop-dom-message-visible` 可在显式启动 Desktop web + Desktop HTTP gateway 时运行，验证真实 Station 消息通过 gateway scoped sync 后在 Desktop React DOM 中可见。

当前 stable gates：

- `proto-build`：验证 `model/domain/chat/*.proto` 可生成派生契约。
- `station-chat-unit`：运行 Station `friend_chat` package tests。
- `chat-runtime-e2e`：在真实 Station 上创建临时测试 actor，验证消息发送、持久化可见和 read acknowledgement。
- `chat-live-realtime-e2e`：在真实 Station 上打开两条 authenticated `/events/stream`，验证 B 收到 live `MessageEnvelope`，A 收到 live `MessageReceipt READ`。
- `desktop-check`：运行 Desktop TypeScript checks，覆盖 chat typed surfaces。
- `chat-desktop-dom-message-visible`：在真实 Station、Desktop HTTP gateway、Desktop web renderer 上证明同步后的 message session row 与 message DOM node 可见。
- `chat-domain-validation`：要求 latest evidence 满足 Chat domain profile。

当前 optional gates：

- `chat-desktop-gateway-e2e`：要求调用者提供运行中的 Desktop HTTP gateway；它证明 desktop-rust BFF 客户端命令链路，不默认并入 `acceptance-chat-domain-validation`，避免默认验收依赖本地 GUI/gateway 运行态。
- `chat-desktop-dom-message-visible`：要求调用者提供运行中的 Desktop web 和 Desktop HTTP gateway；它证明 synced message DOM visibility，不证明 live realtime DOM event consumption、双 Desktop client 或 reconnect replay。

---

## 设计落地反思

本阶段的重点不是“把 Chat 全量测完”，而是校准 acceptance 对用户主路径的表达方式：

- 好的落地：把事实源、传输、UI typed surface 分成不同 feature/capability，避免一个 gate 承载所有语义。
- 好的边界：`station-chat-unit` 证明 Station package contract，不证明双客户端实时消息体验。
- 好的报告：把 live SSE、离线恢复、DOM 级消息收发明确列入 unproven scope。
- 已落地改进：`chat-runtime-e2e` 使用两个真实测试 Actor 通过 Station API 验证 session、send、list 和 read acknowledgement，把 Chat 从 typed contract 推进到 runtime evidence。
- 已落地改进：`chat-live-realtime-e2e` 使用两个真实测试 Actor 和 authenticated `/events/stream` 验证 Station realtime delivery，把 Chat 从 typed realtime contract 推进到 live transport evidence。
- 已落地改进：`chat-desktop-gateway-e2e` 使用真实 Desktop HTTP gateway 验证 desktop-rust BFF 作为 Chat client 能完成 receiver login、session listing、message sync/list 和 read acknowledgement。
- 已落地改进：`chat-desktop-dom-message-visible` 使用显式 `VITE_ACCEPTANCE_HARNESS=1` 进入真实 identity pipeline，再通过真实 Desktop gateway scoped sync 驱动 `socialChat` store，最终断言 Desktop DOM 中的 session row 和 message node。
- 需要继续改进：后续应沉淀 live realtime DOM event-consumption gate，验证用户可见双客户端消息收发、read receipt 以及重连恢复。

---

## 未证明范围

本阶段不声明以下能力已完成：

- 两个运行中 Desktop client 的 DOM-level live realtime delivery。
- Postgres / testnet 环境下的离线消息恢复。
- Desktop renderer 对 Tauri `realtime:event` 的真实 event-consumption DOM 证明。
- 用户可见的完整发送、接收、已读、撤回、编辑链路。

---

## 下一步

下一阶段应把 Chat managed domain 从 Station runtime evidence 推进到 user-visible runtime evidence：

- 将 optional `chat-desktop-gateway-e2e` / `chat-desktop-dom-message-visible` 升级为可由 Make 自动启动隔离 gateway/web 的稳定 app-runtime gates，或继续保留为显式本地运行态 gates。
- 新增 Desktop live realtime DOM gate，把 Station live realtime + gateway BFF + DOM visibility evidence 推进到 renderer event-consumption proof。
- 将 realtime reconnect / missed event replay 从 unproven scope 收敛为可证明 gate。
- 再考虑接入 Mobile 或 Applet domain，避免在 Chat live gate 之前扩大 domain 数量。
