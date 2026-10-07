---
kind: pitfall
title: Conversation production migration must use canonical owner
status: active
owns:
  - apps/station/app/subserver/conversation/production_composition.go
  - apps/station/app/subserver/conversation/infrastructure/persistence/schema.go
referenced-by: []
related:
  - ../../architecture/domains/chat/messaging/data-model.md
detected: 2026-10-06
---

# Conversation production migration must use canonical owner

## Symptom

Fresh Direct Conversation creation returned HTTP 500 at
`commit_persist_transition_create_authority_insert_aggregate` with PostgreSQL
SQLSTATE `23502`.

## Root cause

Production composition maintained a second `AutoMigrate` model list instead of
calling the persistence-owned canonical migration. GORM does not drop retired
columns, so the production table retained historical non-null columns that the
current model no longer wrote. Schema validation accepted those extra columns.

## Mitigation

### What was done in code

- Production composition now delegates Conversation authority migration to
  `persistence.MigrateCanonicalSchema`.
- The canonical migration explicitly drops retired Conversation columns and
  verifies that they are gone.
- Delivery and attachment migrations remain production-owned and run in the
  same outer transaction.

### What guards against regression

- `TestMigrateProductionConversationSchemaUsesCanonicalMigration` proves the
  production path removes retired columns.
- `TestMigrateCanonicalSchemaDropsRetiredConversationColumns` proves existing
  rows survive the canonical migration.

## How to detect a recurrence

```bash
rg -n 'persistence\.Conversation(Model|MemberModel|MemberDeviceModel)' \
  apps/station/app/subserver/conversation/production_composition.go
```

The command must return no duplicated authority model migration list.

```bash
cd apps/station/app
go test ./subserver/conversation/... -count=1
```

## Crosswalks

- `docs/architecture/domains/chat/messaging/data-model.md` defines the
  canonical Conversation persistence model.
