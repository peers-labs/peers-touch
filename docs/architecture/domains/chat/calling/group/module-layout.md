# 群媒体模块布局

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-11-13 | **Updated**: 2026-11-13
> **Owner**: Chat Product Team

## 1. 目录与职责

| 根 | 单一职责 |
|---|---|
| `model/domain/realtime/group_call.proto` | 跨 Station endpoint grant |
| `apps/station/app/subserver/groupcall/` | Home/Authority admission、grant、SFU 管理 |
| `packages/client-chat-core/src/group-call/` | types/controller/LiveKit adapter |
| `packages/client-chat-core/src/mediaReservation.ts` | 设备内媒体占用，无 SDK |
| `apps/desktop/src/modules/groupCall/` | Host facade 和公共导出 |
| `apps/mobile/src/features/call/` | Mobile session facade 和 Direct |
| `apps/mobile/src/components/call/` | peers-ui 全局通话呈现与 DOM attach |
| `tooling/acceptance/gates/chat/lifecycle_group_live.py` | 原生多人媒体 Gate |

## 2. 依赖

共享媒体 subpath `@peers-touch/client-chat-core/group-call` 依赖 LiveKit，
以 lazy import 进入需要媒体的 Host。普通 Chat core 导出不主动加载 SDK。
Controller 只依赖 provider/Host ports。Mobile/desktop 的 UI、认证和 SSE
不得进入共享包；共享包不得导入任何 Host 路径。
