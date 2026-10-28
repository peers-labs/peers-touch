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
| Bot | [bot/](./bot/README.md) | Bot product metadata, owner lifecycle, client management surfaces |
| Chat | [chat/](./chat/README.md) | Conversation, events, messaging core, Chat clients |
| Social | [social/](./social/README.md) | Social authority and Social client projections |
| Identity | [identity/](./identity/README.md) | Actor identity, presence, OAuth identity |
| Federation | [federation/](./federation/README.md) | Federation lifecycle, membership, policy, governance ledger |
| Notification | [notification/](./notification/README.md) | Notification lifecycle, persistence, preferences, aggregation |
| Applets | [applets/](./applets/README.md) | Product applets built on the Applet platform |
| Search | [search/](./search/README.md) | Device query core, native coordinator, source adapters |

## 3. Coverage Rule

Code-backed domains without an accepted architecture module are listed as
gaps in the nearest domain index. An index must not manufacture product
semantics merely to make the tree look complete.

## 4. Implementation Boundaries

- [Search 门户能力](./search/README.md)：Peers 封闭域（端 + Station、当前 actor 授权）内
  的已登记架构模块。Desktop/Mobile 共用端侧核心，overlay/按需详情、
  功能直达和旧入口替换已落地；所选原生证明绑定
  [指定源码与环境](./search/acceptance-evidence.md)，原型不构成生产验收。
