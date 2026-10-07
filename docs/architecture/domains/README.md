# Business Domains

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-05 | **Updated**: 2026-10-06
> **Owner**: Architecture Team

---

## 1. Document Scope

`domains/` contains cross-client business architecture. A domain normally maps
to one or more `apps/station/app/subserver/*` owners, `model/domain/*`
contracts, and the Desktop/Mobile projections that consume that truth.

Client shells, Station framework mechanics, shared infrastructure, and
development governance do not belong here.

## 2. Domain Map

| Domain | Architecture | Primary code owners |
|---|---|---|
| Agent | [agent/](./agent/README.md) | `apps/station/app/subserver/agent`, Agent client runtimes |
| Chat | [chat/](./chat/README.md) | Conversation, events, messaging core, Chat clients |
| Social | [social/](./social/README.md) | Social authority and Social client projections |
| Identity | [identity/](./identity/README.md) | Actor identity, presence, OAuth identity |
| Federation | [federation/](./federation/README.md) | Federation lifecycle, membership, policy, governance ledger |
| Notification | [notification/](./notification/README.md) | Notification lifecycle, persistence, preferences, aggregation |
| Applets | [applets/](./applets/README.md) | Product applets built on the Applet platform |

## 3. Coverage Rule

Code-backed domains without an accepted architecture module are listed as
gaps in the nearest domain index. An index must not manufacture product
semantics merely to make the tree look complete.
