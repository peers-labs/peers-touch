# Station Messaging Platform

This directory owns the target Station-side messaging authority, durable device
queues, recovery revisions, and federation delivery.

## Boundaries

- `domain/` defines repository contracts, state, errors, and federation claim
  names. It has no dependency on application or infrastructure packages.
- `application/` owns authority, queue, recovery, and federation use cases.
- `infrastructure/` owns PostgreSQL persistence and outbound federation
  adapters.
- `interface/http/` binds authenticated actor/device or Station identities to
  typed application calls.
- `worker/` owns durable federation dispatch.
- `composition.go` is the only dependency graph for these owners.

The composition is intentionally not registered in `apps/station/app/main.go`
during MP-W02 through MP-W04 and MP-W06. MP-W05 atomically registers its
production routes and removes the old Conversation/Envelope message owners.
There is no feature flag or dual-runtime path.

## Verification

```bash
cd apps/station
go test -count=1 ./app/subserver/messaging/...
```

PostgreSQL concurrency gates additionally require an isolated test database:

```bash
MESSAGING_TEST_POSTGRES_DSN='<test-dsn>' \
  go test -count=1 -v ./app/subserver/messaging/infrastructure -run TestPostgres
```

Each PostgreSQL test creates and drops its own schema.
