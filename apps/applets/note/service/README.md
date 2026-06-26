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
