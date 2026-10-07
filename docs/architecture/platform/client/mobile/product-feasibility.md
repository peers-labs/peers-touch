# Mobile Shell — 产品可行性闭环

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-08-27 | **Updated**: 2026-10-07
> **Owner**: Mobile Product Team
> **Module**: `apps/mobile/`

---

## 1. Purpose

本表把每个 capability 映射为用户动作、当前仓库基础、缺失闭环和可执行证据。
它证明能力可被真实实现和验收，但不定义实施顺序。

## 2. Feasibility Matrix

| Capability | Tangible user/system actions | Existing foundation | Missing closure | Executable proof |
|---|---|---|---|---|
| MS-C01 Station registry | Add, verify, select, remove, replace Station | Registry, Rust probe, selector UI | Signed peer handshake, mismatch/replacement UX | MS-PA01, MS-PA16, MS-PA25 |
| MS-C02 Access gates | Resume attempt, render schema gate, submit/cancel, block Shell | Access Gate Proto, Station orchestrator, Mobile gate host | OAuth/device/terms/custom renderer closure | MS-PA02, MS-PA04, MS-PA05, MS-PA17 |
| MS-C03 OAuth | Launch GitHub/Google, return by deep link, continue remaining gates | Native event bridge and prototype flow | Attempt binding, PKCE, atomic consume, expiry/replay recovery | MS-PA03, MS-PA25 |
| MS-C04 Navigation Shell | Switch tabs, open/back/deep-link details, restore focus/scroll | Active-only tabs and prototype detail surfaces | Descriptor host and registry migration | MS-PA15, MS-PA24 |
| MS-C05 Friend/group chat | Read/send/receive, attach, search, type, edit/recall/delete, settings/admin | One Messaging runtime, canonical Conversation projection, E2EE, current pages, and Messaging-owned group command outcomes | Complete remaining command/readback and native evidence | MS-PA06, MS-PA18 |
| MS-C06 Advanced messages | React, pin, forward, reply in thread, reload | Existing conversation commands/events and prototype | Endpoint wiring and authoritative readback parity | MS-PA07, MS-PA08 |
| MS-C07 Contacts/groups | Search/resolve, send/accept/reject request, inspect, create/manage group | Social relationship projection plus canonical Conversation group commands and pages | Failure/duplicate/federation recovery evidence | MS-PA09, MS-PA10, MS-PA19 |
| MS-C08 Moments | Read/paginate/publish/react/comment/reply and recover draft | Publish/upload path, social Proto, prototype feed | Feed/detail runtime, failure rollback and policy states | MS-PA11, MS-PA20, MS-PA23 |
| MS-C09 Profile/settings | Edit Profile/privacy, Notification, Social blocked-user, and device-local settings; switch/logout | Owner-backed settings surfaces, Profile/Notification APIs, Social block owner, device settings runtime, prototype Me | Complete cross-client Profile/Notification CAS and selected-owner save states | MS-PA12, MS-PA21, MS-PA24 |
| MS-C10 Runtime recovery | Background/resume, reconnect, revoke, reconcile, recover commands | Social ingress, Messaging runtime, command runtime, and native event bridge | Complete remaining native recovery evidence | MS-PA08, MS-PA13, MS-PA14, MS-PA26 |
| MS-C11 WeChat OAuth | See truthful unavailable state | Disabled prototype action | Provider contract absent; remains deferred | MS-PA27 |
| MS-C12 Voice/video call | See unavailable action before commitment | Disabled prototype call action | Call product/runtime contract absent; remains deferred | MS-PA27 |
| MS-C13 Chat Docs tab | No enabled entry | None required | Shared-document product/domain absent; remains deferred | MS-PA27 |
| MS-C14 Local message flag | Flag/unflag locally and understand device-only scope | Prototype interaction | Durable local projection and explicit scope copy | MS-PA22 |

## 3. Feasibility Rules

- Existing code is evidence only for the row's “foundation”, not proof of the
  missing closure.
- A required capability remains incomplete until every listed MS-PA assertion
  has source-bound simulator evidence and authoritative readback where state
  persists.
- Deferred capability UI is absent unless its unavailable explanation helps the
  current decision; disabled controls must never imply near-term readiness.
- Prototype evidence establishes interaction intent only. Production proof uses
  the required runtime cells in `acceptance-matrix.md`; physical-device runs
  are optional diagnostics.
