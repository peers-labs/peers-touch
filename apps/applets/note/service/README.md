# Note Service

This service follows the official applet DDD service contract.

## Layers

- `domain/`: aggregate, value objects, repository interfaces, domain errors, domain events.
- `application/`: commands, queries, use cases, transaction boundaries, authorization context.
- `infrastructure/`: repository implementations and persistence details.
- `transport/`: inbound HTTP/gRPC adapters.
- `stationadapter/`: Station subserver mounting.
- `standalone/`: standalone deployment entry.

Station may mount `stationadapter`, but applet business rules stay in `apps/applets/note/service`.

## Owner PTID Schema Cut

Before GORM auto-migration, the repository performs a one-way rename of
`official_applet_notes.owner_id` to `owner_ptid`. A legacy-only schema is
renamed in place so existing values are preserved. A canonical-only schema is
left unchanged. If both columns exist, startup fails without reading from,
writing to, merging, or dropping either column; an operator must resolve the
conflict before retrying.
