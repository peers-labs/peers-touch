# Mobile Shell — 产品定义

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-08-27 | **Updated**: 2026-09-19
> **Owner**: Mobile Product Team
> **Module**: `apps/mobile/`

---

## 1. Product Thesis

Mobile Shell 面向需要从手机连接个人或组织 Station、完成认证并持续使用
Peers Touch 社交能力的用户。它提供一个可信、可恢复、移动优先的入口：

```text
选择 Station -> 完成 Station 驱动的准入链 -> 进入社交 Shell
```

首个有用结果是用户成功进入一个 Station 并看到真实会话、联系人和动态投影。
持续价值来自跨前后台、弱网、重启和 Station 切换后仍可恢复的社交体验。

## 2. Product Promise

用户可以在 Mobile 上明确知道自己连接的是哪个 Station、以哪个身份进入，
并在同一个 Shell 中完成聊天、动态、联系人和个人设置任务；共享业务事实始终
与 Station 收敛，设备能力和网络异常都有可见、可恢复的状态。

## 3. Target And Excluded Users

目标用户：

- 已拥有或获得某个 Peers Touch Station 访问权的个人用户。
- 需要在移动场景中处理私聊、群聊、联系人和 Moments 的用户。
- 需要在多个 Station 之间明确切换上下文的用户。

非目标用户：

- Station 运维管理员；管理入口属于 Station Dashboard。
- 依赖 Desktop 专属窗口、托盘、本地 shell 或 P2P 主链能力的用户。
- 需要 Mobile 成为离线业务真源或独立后端的场景。

## 4. Jobs And Current Alternatives

| User job | Current pain | Product outcome |
|---|---|---|
| Enter a known Station safely | URL reachability does not prove Station identity | User sees the selected Station and blocks on identity mismatch |
| Continue social work away from Desktop | Feature pages expose uneven depth and recovery | Chat, Contacts, Moments and Me form one recoverable Mobile shell |
| Act under weak connectivity | Retry can duplicate writes or lose drafts | Pending/unknown state survives interruption and converges visibly |
| Switch Station or identity | Old projections may remain visible | Old scope disappears before the new gate or Shell can render |

Current alternatives are Desktop for the complete social workflow, browser-like
Mobile Web UI for partial access, or waiting until connectivity returns. Mobile
Shell replaces those fragmented paths without copying Desktop-only chrome or
making the device a business authority.

## 5. Capability Profile

| ID | Capability | Class | Product claim |
|---|---|---|---|
| MS-C01 | Station registry and selection | required | Add, verify, select, remove, and change Station with truthful reachability state. |
| MS-C02 | Station access gate chain | required | Station decides gate order and shell admission; Email login and session restore are supported. |
| MS-C03 | OAuth sign-in | required | GitHub and Google complete external authorization, deep-link callback, Station verification, and session creation. |
| MS-C04 | Mobile navigation shell | required | Chats, Moments, Contacts, and Me are first-level tabs; detail surfaces hide the tab bar when immersive. |
| MS-C05 | Friend and group chat | required | List, open, send, receive, read state, typing, attachments, reply, edit, recall, delete, search, settings, and group administration. |
| MS-C06 | Advanced message collaboration | required | Reactions, pinning, forwarding, and thread replies use authoritative conversation contracts. |
| MS-C07 | Contacts and groups | required | Search people, handle requests, inspect profiles, create groups, and enter conversations. |
| MS-C08 | Moments | required | Read feed, publish text/images, react, comment, reply, paginate, and recover failed actions. |
| MS-C09 | Profile and settings | required | Show and edit Actor Profile and privacy, Notification preferences, Social blocked users, device-local appearance/language/storage settings, Station switch, and logout. No additional account-preference fields are claimed in this release. |
| MS-C10 | Runtime freshness and recovery | required | Foreground events plus reconciliation, background wakeups, resume sync, stale indication, and session revocation recovery. |
| MS-C11 | WeChat OAuth | deferred | Visible only as unavailable until provider and callback support are production-ready. |
| MS-C12 | Voice/video call | deferred | No enabled call action until the Mobile call contract and runtime exist. |
| MS-C13 | Chat Docs custom tab | deferred | No enabled tab until a shared-document domain and product journey are accepted. |
| MS-C14 | Local message flag | degraded | May remain device-local if clearly labeled and never presented as cross-device truth. |

## 6. Platform Matrix

| Capability | Desktop | Mobile | Browser prototype | Degradation or exclusion |
|---|---|---|---|---|
| Station/access/auth | Shared Station semantics | Native deep link + secure storage | Interaction simulation only | Browser cannot prove credential security |
| Social truth | Station-backed projection | Station/Relay only | Mock records | Prototype never proves persistence |
| Navigation | Desktop PageHost | Active-only tabs + descriptor details | Mobile viewport simulation | Desktop window patterns are excluded |
| Device capability | Desktop OS adapters | Tauri Mobile native plugins | Not available | Missing permission/capability is explicit |
| Background recovery | Process/window reconcile | Push/wakeup + resume reconcile | Scenario simulation only | Browser evidence cannot prove native lifecycle |

## 7. Completeness Rule

- Required capabilities MS-C01..MS-C10 must pass every mapped acceptance row.
- Degraded MS-C14 must expose its device-only scope before the user relies on it.
- Deferred MS-C11..MS-C13 do not count toward readiness, but any visible entry
  must be disabled with a useful reason.
- `product-feasibility.md` owns current foundation, missing closure, and proof.

## 8. Product Boundaries

- Station owns shared business truth and access decisions.
- Model owns cross-client contracts.
- Mobile owns navigation, device-local UI state, secure local credentials, runtime
  orchestration, and bounded caches.
- A future cross-device preference requires a product amendment that names its
  fields and behavior before a new Station owner or UI section may exist.
- Prototype-only types and demo transitions are not product contracts.
- A disabled future capability must explain unavailability or be absent.
- Mobile does not expose a peer endpoint and does not join the Desktop P2P mesh.

## 9. Prototype Basis

The interaction reference is:

- `packages/prototypes/mobile/chat/`
- `docs/architecture/platform/client/mobile/prototype/README.md`
- `packages/prototypes/mobile/chat/UI-IDENTITY-AUDIT.md`

The happy-path interaction and expanded recovery/accessibility amendment were
confirmed by the Owner on 2026-08-27. Prototype evidence never proves Station
integration, native lifecycle, security, or production runtime behavior.

## 10. Non-Goals

- Rebuilding Desktop pages at phone width.
- Introducing Flutter, React Native, or native Compose/SwiftUI main UI paths.
- Treating local cache, optimistic state, or push payloads as authoritative truth.
- Implementing Station Dashboard policy administration in Mobile.
- Defining implementation phases or runtime topology in this document.
