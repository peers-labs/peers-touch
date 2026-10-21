# Station Development

> **Status**: active
> **Scope**: `apps/station/`

Station is the shared business runtime. `app/` owns business domains;
`frame/` owns transport, middleware, configuration, and infrastructure.

## Read First

1. [Station platform baseline](../../station/base.md)
2. [App layer](../../station/app-layer.md)
3. [Frame layer](../../station/frame-layer.md)
4. [Subserver standard](../../station/subserver-standard.md)
5. [Station coding guide](../../global/coding-guide/station/)

Cross-client or public-contract work also reads:

- [System architecture](../../global/architecture.md)
- [API ownership](../../architecture/engineering/api-governance/README.md)
- [Domain model](../../global/domain-model.md)

## Run

```bash
make station
make station-check
make station-logs
make station-restart
```

Never run a Station binary, `go run`, or `docker compose up station` directly.
The selected Profile owns topology, ports, database, source identity, and
health closure.

## Check

Run tests from the Go module that owns the change:

```bash
(cd apps/station/app && go test ./...)
(cd apps/station/frame && go test ./...)
./tooling/scripts/check-go-style.sh apps/station/app
```

Use focused package tests during iteration. Runtime claims require the selected
Profile and an authoritative readback from Station or the receiving client.

## Boundaries

- Shared contracts start in `model/domain/`.
- Handlers adapt transport; application and domain layers make business
  decisions.
- `app` may depend on `frame`; `frame` must not import business semantics from
  `app`.
- Public capabilities belong to their resource owner.
- Direct database writes are diagnostic exceptions, not recovery or product
  APIs.
