# Server Wrappers

This package provides common middleware wrappers for the server framework.

## Available Wrappers

### LogID
Generates and injects a unique log ID for each request.

```go
import "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"

handler := server.NewHTTPHandler(
    "my-handler",
    "/api/endpoint",
    server.GET,
    myEndpointHandler,
    wrapper.LogID(),
)
```

### JWT
Validates JWT tokens and injects authenticated subject into context.

```go
provider := coreauth.NewJWTProvider(secret, ttl)
handler := server.NewHTTPHandler(
    "protected-handler",
    "/api/protected",
    server.GET,
    myProtectedHandler,
    wrapper.JWT(provider),
)

// In your handler:
subject := wrapper.GetSubject(ctx, req)
if subject != nil {
    userID := subject.ID
}
```

### AccessControl
Checks if a route is enabled based on configuration.

```go
handler := server.NewHTTPHandler(
    "admin-handler",
    "/api/admin",
    server.GET,
    myAdminHandler,
    wrapper.AccessControl("admin", config),
)
```

## Creating Custom Wrappers

Wrappers follow the signature:

```go
type Wrapper func(EndpointHandler) EndpointHandler
```

Example:

```go
func MyCustomWrapper() server.Wrapper {
    return func(next server.EndpointHandler) server.EndpointHandler {
        return func(ctx context.Context, req server.Request, resp server.Response) error {
            // Pre-processing
            
            err := next(ctx, req, resp)
            
            // Post-processing
            
            return err
        }
    }
}
```

For HTTP-based wrappers, use `server.HTTPWrapperAdapter`:

```go
func MyHTTPWrapper() server.Wrapper {
    httpWrapper := func(ctx context.Context, next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            // Pre-processing
            next.ServeHTTP(w, r)
            // Post-processing
        })
    }
    return server.HTTPWrapperAdapter(httpWrapper)
}
```
