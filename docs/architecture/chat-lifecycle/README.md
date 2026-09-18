# Chat Lifecycle

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-16 | **Updated**: 2026-09-17
> **Owner**: Chat Product Team
> **Module**: `apps/desktop/`, `apps/mobile/`, `apps/station/app/subserver/`

---

## 1. Document Scope

This document set defines the product-grade Chat lifecycle from finding another
person through relationship establishment, conversation use, rich messaging,
recorded voice, live voice/video, group participation, and durable continuity.

It defines:

- one cross-domain product boundary and readiness claim;
- complete Desktop and Mobile user journeys and visible states;
- the composition of Actor, Social, Conversation, Device Messaging Engine,
  Realtime, Federation, and Recovery owners;
- current capability truth and receiver-perspective acceptance;
- the only active execution plan for Chat product completion in this worktree.

It does not redefine the internal authority or protocol ownership of those
domains. `20260906-conversation-authority-hard-cut.md` is executed in the
`peers-access-gate` worktree and is not an active plan here.

## 2. Product Goal

A user can find another person, establish a trusted relationship, open a
conversation, exchange text and rich media, record and play voice messages,
complete live one-to-one voice and video calls, use groups, and continue after
disconnect, restart, device change, or Station boundary.

No capability is product-ready merely because source, tests, or historical
evidence exist. The current exact source must pass the required sender,
receiver, durable-readback, and cleanup evidence.

## 3. Governing Boundaries

| Concern | Existing owner |
|---|---|
| Actor search and identity | Actor / Federation Discovery |
| Friendship lifecycle | Social |
| Conversation membership and ordered facts | Conversation |
| Device encryption, delivery, local history, attachments | Device Messaging Engine |
| Live call signaling | Realtime |
| Live media | Client WebRTC with TURN fallback |
| Cross-Station transport | Federation |
| Product readiness | Chat Lifecycle acceptance matrix |

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [product-definition.md](./product-definition.md) | Product promise, capability scope, and platform claims |
| [experience-contract.md](./experience-contract.md) | Complete user journeys and recovery paths |
| [product-state-model.md](./product-state-model.md) | User-visible state machines |
| [acceptance-matrix.md](./acceptance-matrix.md) | Receiver-perspective evidence contract |
| [current-capability-audit.md](./current-capability-audit.md) | Current source and evidence classification |
| [design.md](./design.md) | Cross-domain ownership and runtime composition |
| [decisions.md](./decisions.md) | Accepted lifecycle integration decisions |
| [integration.md](./integration.md) | Existing source mapping, cutovers, and retained owners |
| [execution-plans/20260916-chat-lifecycle-product-closure/plan.md](./execution-plans/20260916-chat-lifecycle-product-closure/plan.md) | Replacement product-first execution plan |

## 5. Superseded Execution Plans

- `../messaging-platform/execution-plans/20260808-messaging-platform.md` is
  historical implementation evidence only.
- `../acceptance-framework/execution-plans/20260824-native-desktop-runtime-cells.md`
  is historical runtime-cell evidence only.

Neither plan may supply current progress, current task selection, or readiness
claims for Chat Lifecycle.
