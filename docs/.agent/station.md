# Station (Go) — Agent Platform Rules

> Load this file when working on `apps/station/`.
> Parent rules: [AGENTS.md](../../AGENTS.md)

---

## Coding Standards

| Rule | Detail |
|------|--------|
| Error handling | Always check errors, never `_, _ =` |
| Context | Pass `context.Context` everywhere |
| Proto | Use proto-generated structs, no manual models |
| State | Dependency injection, no global state |
| Naming | Files: `snake_case.go`, packages: lowercase single word |

---

## Logger

Use `frame/core/logger` — first argument **must** be `context.Context`.

```go
import "github.com/peers-labs/peers-touch/station/frame/core/logger"

logger.Infof(ctx, "[HandleRequest] processing user %s", userID)
```

All log calls must prefix message with `[CurrentMethodName]`.

### Forbidden

`fmt.Println`, `log.*` (stdlib), any third-party logger direct call.

---

## Subserver Standard (DDD)

Directory structure for `apps/station/app/subserver/<module>/`:

```
<module>/
├── plugin.go      # Plugin registration & lifecycle factory
├── options.go     # Config options & DI
├── <module>.go    # SubServer interface (Init/Start/Stop/Handlers)
├── handler.go     # HTTP route handlers
├── auth.go        # Auth & permissions (optional)
├── db/            # Data access layer (optional)
│   ├── model/
│   └── repo/
└── service/       # Business logic layer (optional)
```

### Lifecycle

```
Init (resource build, DI) → Start (running) → Stop (graceful shutdown)
```

### State Machine

```
stopped → starting → running → stopping → stopped
```

### Routing

- Subserver: `/<module>/...` (module name prefix)
- Main server: `/activitypub/...`, `/api/v1/...`, `/management/...`, `/.well-known/...`
- **Never** prefix subserver routes with `/api/` — conflicts with Mastodon API.

---

## Go Struct Conventions

Options structs must include `*option.Options`:

```go
type Options struct {
    SomeField string
    *option.Options
}
```

Model structs must have `CreatedAt` and `UpdatedAt` as the **last two fields**:

```go
type MyModel struct {
    ID   string
    Name string
    CreatedAt time.Time
    UpdatedAt time.Time
}
```

---

## Error Handling

- Domain layer: `model.NewErrorResponse(ErrorCode)` + sentinel errors
- Framework layer: `server.BadRequest()`, `server.Unauthorized()`, `server.InternalError()`
- Subserver BizError: module-specific `errcode.Code` mapped via `error_mapper.go`

```go
// Always wrap with context
if err != nil {
    return fmt.Errorf("failed to create provider name=%s: %w", name, err)
}

// Log before propagating
logger.Errorf(ctx, "failed to sync providers: %v", err)
return nil, toHandlerError(err)
```

---

## Verification

```bash
cd apps/station
gofmt -l .
go test ./...
./tooling/scripts/check-go-style.sh
```
