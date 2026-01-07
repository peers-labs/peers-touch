# Logger - Unified Logging Interface

## Overview

The `logger` package provides a unified logging interface for the Peers-Touch Station backend. It supports structured logging, multiple log levels, context propagation, and request tracing.

## Features

- [x] Unified logging interface (`Logger` interface)
- [x] Multiple log levels (Trace/Debug/Info/Warn/Error/Fatal)
- [x] Context propagation support
- [x] Structured fields
- [x] Request ID / Trace ID automatic injection
- [x] Helper utility class
- [x] Pluggable implementations (supports multiple logger backends)

## Quick Start

### Basic Usage

```go
import (
    "context"
    "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

func DoSomething(ctx context.Context) {
    // Simple log
    logger.Info(ctx, "operation started")
    
    // Formatted log
    logger.Infof(ctx, "processing user: %s", userID)
    
    // Error log
    logger.Errorf(ctx, "failed: %v", err)
}
```

### Request ID Usage

```go
// Inject Request ID into context
ctx = logger.WithRequestID(ctx, "req-12345")

// Logs will automatically include request_id field
logger.Info(ctx, "processing request")
// Output: time=... level=info msg="processing request" request_id=req-12345
```

### Trace ID Usage

```go
// Inject Trace ID into context
ctx = logger.WithTraceID(ctx, "trace-67890")

logger.Info(ctx, "processing request")
// Output: time=... level=info msg="processing request" trace_id=trace-67890
```

### Structured Fields

```go
h := logger.NewHelper(logger.DefaultLogger)
h = h.WithFields(map[string]interface{}{
    "user_id": "user123",
    "action": "login",
})
h.Info("user action")
// Output: ... msg="user action" user_id=user123 action=login
```

### Using Helper

```go
// Extract logger from context
h := logger.Extract(ctx)
h.Info("message with context logger")

// Add fields to helper
h = h.WithFields(map[string]interface{}{"key": "value"})
h.Infof("formatted message: %s", data)

// Add error to helper
h = h.WithError(err)
h.Error("operation failed")
```

## Log Levels

| Level | Usage | Example |
|-------|-------|---------|
| **Trace** | Very detailed debugging | Function entry/exit, variable dumps |
| **Debug** | Development debugging | Detailed operation steps, intermediate values |
| **Info** | Normal operation | Service startup, request processing, state changes |
| **Warn** | Warning but not affecting operation | Deprecated API usage, missing config with defaults |
| **Error** | Error but recoverable | Request failures, database query errors |
| **Fatal** | Critical error, exits program | Startup failures, unrecoverable errors |

## API Reference

### Context Functions

```go
// Logger context
func FromContext(ctx context.Context) (Logger, bool)
func NewContext(ctx context.Context, l Logger) context.Context

// Request ID context
func WithRequestID(ctx context.Context, requestID string) context.Context
func GetRequestID(ctx context.Context) string

// Trace ID context
func WithTraceID(ctx context.Context, traceID string) context.Context
func GetTraceID(ctx context.Context) string
```

### Logging Functions

All logging functions require `context.Context` as the first parameter:

```go
func Info(ctx context.Context, args ...interface{})
func Infof(ctx context.Context, template string, args ...interface{})
func Debug(ctx context.Context, args ...interface{})
func Debugf(ctx context.Context, template string, args ...interface{})
func Warn(ctx context.Context, args ...interface{})
func Warnf(ctx context.Context, template string, args ...interface{})
func Error(ctx context.Context, args ...interface{})
func Errorf(ctx context.Context, template string, args ...interface{})
func Fatal(ctx context.Context, args ...interface{})
func Fatalf(ctx context.Context, template string, args ...interface{})
```

### Helper Class

```go
type Helper struct {
    logger Logger
}

func NewHelper(logger Logger) *Helper
func Extract(ctx context.Context) *Helper

func (h *Helper) WithFields(fields map[string]interface{}) *Helper
func (h *Helper) WithError(err error) *Helper
func (h *Helper) Info(args ...interface{})
func (h *Helper) Infof(template string, args ...interface{})
// ... other level methods
```

## Configuration

Logger configuration is loaded from `app/conf/log.yml`:

```yaml
peers:
  logger:
    name: slogrus           # Logger implementation name
    level: debug            # Log level (trace/debug/info/warn/error/fatal)
    caller-skip-count: 2    # Stack frame skip count for caller info
    persistence:
      enable: true
      dir: /var/logs/peers-touch
      max-file-size: 50
```

## Implementation Plugins

Current supported implementations:

- [Logrus](../plugin/logger/logrus/README.md) (default)

## Best Practices

1. **Always pass context**
   ```go
   // ✅ Correct
   logger.Info(ctx, "message")
   
   // ❌ Wrong
   logger.Info("message")  // Compile error
   ```

2. **Use formatted functions**
   ```go
   // ✅ Recommended
   logger.Infof(ctx, "user %s logged in from %s", userID, ip)
   
   // ❌ Not recommended
   logger.Info(ctx, "user " + userID + " logged in from " + ip)
   ```

3. **Include context in error logs**
   ```go
   // ✅ Good
   logger.Errorf(ctx, "failed to save user %s: %v", userID, err)
   
   // ❌ Poor
   logger.Error(ctx, err)
   ```

4. **Avoid sensitive information**
   ```go
   // ❌ Dangerous
   logger.Infof(ctx, "password: %s", password)
   
   // ✅ Safe
   logger.Infof(ctx, "user authenticated: %s", userID)
   ```

5. **Use appropriate log levels**
   - Don't use `Info` for debugging details
   - Don't use `Error` for expected conditions
   - Use `Fatal` only for unrecoverable errors

## Request Tracing

The logger automatically supports request tracing through Request ID and Trace ID:

1. **Automatic in HTTP requests**: The Hertz middleware automatically generates Request IDs
2. **Manual injection**: Use `WithRequestID()` and `WithTraceID()` for custom tracing
3. **Propagation**: IDs are automatically included in all logs within the same context

Example output:
```
time="2025-01-05 10:30:45" level=info msg="→ GET /api/users" request_id=req-a1b2c3
time="2025-01-05 10:30:46" level=debug msg="query database" request_id=req-a1b2c3 pkg=touch/activitypub
time="2025-01-05 10:30:47" level=info msg="← GET /api/users 200 2.1s" request_id=req-a1b2c3
```

## Testing

Run tests:
```bash
cd station/frame/core/logger
go test -v
```

Check coverage:
```bash
go test -cover
```

## See Also

- [Logrus Implementation](../plugin/logger/logrus/README.md)
- [Station Library Usage Standards](../../../.prompts/30-STATION/35-lib-usage.md)
