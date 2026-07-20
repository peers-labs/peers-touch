# Agent Chat DC Handoff Freshness Guard

> Evidence ID: EVID-011-DC-pre
> Status: pre-confirmation guard
> Plan Step: PLAN-P2 Owner review preparation / PLAN-P5 blocked precondition
> Gates: GATE-003, GATE-004, GATE-005, GATE-006, GATE-008

## Purpose

`EVID-011-DB-pre` promoted the DA Agent Chat clean scoped screenshot and DOM
artifacts into the active compact artifact gate. This guard prevents Owner and
PLAN-P5 handoff documents from drifting back to the historical CK active-artifact
wording after that promotion.

## Guarded State

The active Agent Chat compact artifact is:

| Artifact | Active Value |
| --- | --- |
| Review URL | `?surface=chat&check=da` |
| Screenshot | `tmp/agent-lobehub-l2-screenshots/chat-da-compact-new-topic-scoped.png` |
| DOM | `tmp/agent-lobehub-chat-da-dom.json` |
| Metadata | `tmp/agent-lobehub-chat-da-scoped-screenshot-meta.json` |
| Revision docs | `chat-da-compact-follow-up-revision.md`, `chat-db-clean-scoped-artifact-refresh.md` |

Historical CK artifacts remain valid history, but they are no longer the active
compact artifact gate input for Agent Chat.

## Automated Checks

`tooling/scripts/agent-lobehub-owner-review-readiness-gate.py` and
`tooling/scripts/agent-lobehub-parity-evidence-chain-gate.py` now require
`EVID-011-DB-pre` and `EVID-011-DC-pre` in the relevant Owner/P5 handoff docs and
fail closed when active handoff text still presents CK as the current Chat
artifact.

This does not confirm Chat, does not confirm the prototype, does not authorize
`EVID-012`, and does not start PLAN-P5 product migration.

