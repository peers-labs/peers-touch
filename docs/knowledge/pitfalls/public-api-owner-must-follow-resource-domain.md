---
kind: pitfall
title: Public APIs must follow resource ownership
status: active
owns:
  - apps/station/app/main.go
  - apps/station/app/subserver/
  - apps/desktop/src-tauri/src/
  - apps/mobile/src-tauri/src/
  - model/domain/
  - tooling/acceptance/
referenced-by: []
related:
  - ../../architecture/engineering/api-governance/README.md
  - ../../architecture/engineering/api-governance/decisions.md
detected: 2026-09-06
---

# Public APIs must follow resource ownership

## Symptom

Chat acquired two independently registered public API surfaces and two
authority-store families even though Conversation was already the business
owner. The duplicate surface was named after an internal delivery engine, so
exact path-collision checks did not detect the semantic duplication.

## Root cause

Runtime registration validated method/path uniqueness but did not bind each
public capability to one stable capability ID, domain owner, contract family,
and truth-store family. An internal implementation module could therefore
become a second public business boundary without violating the mechanical route
registry.

## Mitigation

### What was done in code

- Conversation remains the sole Chat business entry point.
- The Device Messaging Engine remains an internal Desktop/Mobile runtime.
- Modern authority and delivery behavior is composed under the Conversation
  bounded context instead of being registered as a separate Station subserver.
- The API ownership registry and `station-api-ownership` Gate bind routes,
  owners, contracts, stores, and superseded symbols.

### What guards against regression

- `messaging-platform-contract` rejects a second Station Chat facade and
  duplicate public route family.
- `station-api-ownership` parses Station handler registrations and compares
  them with the reviewed capability registry.

## How to detect a recurrence

```bash
python3 tooling/scripts/acceptance-run.py --gate station-api-ownership
python3 -m unittest tooling.acceptance.gates.chat.messaging_platform_contract_test
```

Reviewers must also reject any public capability whose route owner is derived
from an internal package name rather than the resource domain.

## Crosswalks

- `docs/architecture/engineering/api-governance/README.md`
- `docs/architecture/engineering/api-governance/decisions.md`
- `docs/architecture/engineering/api-governance/execution-plans/20260906-conversation-authority-hard-cut.md`
