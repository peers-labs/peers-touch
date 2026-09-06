# Conversation Engine

This directory contains the modern Conversation authority and its delivery
adapters during CA-HC. It is composed and registered only by the parent
Conversation subserver, which is the sole public Chat entry point.

## Boundaries

- `domain/` defines repository contracts, state, errors, and federation claim
  names. It has no dependency on application or infrastructure packages.
- `application/` owns authority, queue, recovery, and federation use cases.
- `infrastructure/` owns PostgreSQL persistence and outbound federation
  adapters.
- `interface/http/` binds authenticated actor/device or Station identities to
  typed application calls.
- `worker/` owns durable federation dispatch.
- `composition.go` is the current dependency graph while CA-W2 and CA-W3 split
  resource implementations behind Conversation, Device, Recovery, Key Exchange,
  and Federation ports.

This package is an internal implementation module, not a separately registered
subserver or a second business authority. CA-W2 and CA-W5 remain responsible
for making the DDD aggregate/UOW the only Conversation authority.

## Verification

```bash
cd apps/station
go test -count=1 ./app/subserver/conversation/...
```

PostgreSQL concurrency gates additionally require an isolated test database:

```bash
MESSAGING_TEST_POSTGRES_DSN='<test-dsn>' \
  go test -count=1 -v ./app/subserver/conversation/engine/infrastructure -run TestPostgres
```

Each PostgreSQL test creates and drops its own schema.
