# Logrus Logger Implementation

## Overview

This package provides a [Logrus](https://github.com/sirupsen/logrus)-based implementation of the unified logger interface. It includes advanced features like log rotation, level-based file splitting, and package filtering.

## Feature Comparison

| Abstract Layer Feature | Logrus Implementation | Status |
|------------------------|----------------------|--------|
| Unified interface | ✅ Implements `logger.Logger` | ✅ |
| Multiple log levels | ✅ Trace/Debug/Info/Warn/Error/Fatal | ✅ |
| Context propagation | ✅ Entry.Context | ✅ |
| Structured fields | ✅ Fields | ✅ |
| Request ID injection | ✅ RequestIDHook | ✅ |
| Trace ID injection | ✅ RequestIDHook | ✅ |
| File persistence | ✅ Lumberjack integration | ✅ |
| Log level splitting | ✅ Level Hooks | ✅ |
| Package filtering | ✅ Include/Exclude Packages | ✅ |
| JSON/Text format | ✅ Configurable | ✅ |
| Timestamp format | ✅ Configurable | ✅ |
| Caller information | ✅ ReportCaller | ✅ |
| Log rotation | ✅ Size/Age/Count based | ✅ |
| Log sampling | ✅ High-frequency log control | ✅ |

## Configuration

### Basic Configuration

```yaml
peers:
  logger:
    name: slogrus              # ✅ Required: must be "slogrus"
    level: debug               # ✅ Now working: trace/debug/info/warn/error/fatal
    caller-skip-count: 2       # ✅ Now working: stack frame skip count
    persistence:
      enable: true
      dir: /var/logs/peers-touch
      back-dir: /var/logs/peers-touch/backup
      max-file-size: 50        # MB
      max-backup-size: 700     # MB
      max-backup-keep-days: 14
      file-name-pattern: app.log
      backup-file-name-pattern: app-%Y%m%d-%H.zip
    slogrus:
      formatter: text          # text or json
      report-caller: true      # Include file:line info
      split-level: false       # Split logs by level
      without-key: false       # Remove field keys in text format
      without-quote: false     # Remove quotes in text format
      timestamp-format: "2006-01-02 15:04:05.999"
      include-packages: []     # Only log from these packages
      exclude-packages: []     # Exclude logs from these packages
      sampling:
        enable: false          # Enable log sampling
        initial: 100           # First N logs always recorded
        thereafter: 100        # After initial, record 1 out of M
        window: 1m             # Time window for counter reset
        per-package: false     # Sample per package+message
```

### Configuration Examples

#### 1. Development Mode (Verbose Logging)

```yaml
peers:
  logger:
    name: slogrus
    level: debug
    caller-skip-count: 2
    persistence:
      enable: false            # Log to console only
    slogrus:
      formatter: text
      report-caller: true
      timestamp-format: "15:04:05.999"
```

#### 2. Production Mode (File Logging with Rotation)

```yaml
peers:
  logger:
    name: slogrus
    level: info
    persistence:
      enable: true
      dir: /var/logs/peers-touch
      max-file-size: 100
      max-backup-keep-days: 30
    slogrus:
      formatter: json
      report-caller: false
```

#### 3. Level-Split Logging

```yaml
peers:
  logger:
    name: slogrus
    level: debug
    persistence:
      enable: true
      dir: /var/logs/peers-touch
    slogrus:
      split-level: true        # Creates separate files per level
```

Generated files:
- `app.log` - All logs
- `app-error.log` - Error and Fatal only
- `app-warn.log` - Warn only
- `app-info.log` - Info only
- `app-debug.log` - Debug only

#### 4. Package Filtering

```yaml
peers:
  logger:
    name: slogrus
    level: debug
    slogrus:
      include-packages:
        - "github.com/peers-labs/peers-touch/station/app"
        - "github.com/peers-labs/peers-touch/station/frame/touch"
      exclude-packages:
        - "gorm.io"
        - "github.com/cloudwego/hertz"
```

#### 5. Log Sampling (High-Frequency Log Control)

```yaml
peers:
  logger:
    name: slogrus
    level: debug
    slogrus:
      report-caller: true      # Required for per-package sampling
      sampling:
        enable: true
        initial: 50            # First 50 logs always recorded
        thereafter: 100        # After that, 1 out of 100
        window: 1m             # Reset counter every minute
        per-package: true      # Separate sampling per package
```

**Use Case**: When a package repeatedly logs the same message (e.g., polling, heartbeat), sampling prevents log flooding while preserving the first occurrences and periodic samples.

**Example Output**:
```
[1st log]  level=debug msg="polling status" pkg=mdns
[2nd log]  level=debug msg="polling status" pkg=mdns
...
[50th log] level=debug msg="polling status" pkg=mdns
[150th log] level=debug msg="polling status" pkg=mdns suppressed_count=99
[250th log] level=debug msg="polling status" pkg=mdns suppressed_count=99
```

## Features in Detail

### 1. Request ID & Trace ID

Automatically injected via `RequestIDHook`:

```go
ctx = logger.WithRequestID(ctx, "req-12345")
ctx = logger.WithTraceID(ctx, "trace-67890")

logger.Info(ctx, "processing request")
// Output: ... msg="processing request" request_id=req-12345 trace_id=trace-67890
```

### 2. Package Field

Automatically adds `pkg` field showing the calling package:

```
level=info msg="user logged in" pkg=touch/activitypub request_id=req-123
```

### 3. Log Rotation

Uses [Lumberjack](https://github.com/natefinch/lumberjack) for automatic log rotation:

- **Size-based**: Rotates when file exceeds `max-file-size` MB
- **Age-based**: Deletes backups older than `max-backup-keep-days` days
- **Count-based**: Keeps only `max-backup-size / max-file-size` backup files
- **Compression**: Automatically compresses rotated logs to `.zip`

### 4. Formatters

#### Text Formatter (Default)

```
time="2025-01-05 10:30:45.123" level=info msg="user logged in" request_id=req-123 user_id=user456
```

Options:
- `without-key: true` - Remove field keys: `time="..." info "user logged in" req-123 user456`
- `without-quote: true` - Remove quotes: `time=2025-01-05 10:30:45.123 level=info msg=user logged in`

#### JSON Formatter

```json
{"level":"info","msg":"user logged in","request_id":"req-123","time":"2025-01-05T10:30:45.123Z","user_id":"user456"}
```

### 5. Caller Information

When `report-caller: true`:

```
time="..." level=info msg="..." file="touch/activitypub/account.go:45"
```

The `caller-skip-count` controls how many path segments to show:
- `0`: Full path
- `1`: `activitypub/account.go:45`
- `2`: `account.go:45`

### 6. Log Sampling

Controls high-frequency repeated logs to prevent log flooding.

**How it works**:
1. First `initial` logs of the same message are always recorded
2. After that, only 1 out of every `thereafter` logs is recorded
3. Suppressed log count is added to the next recorded log
4. Counters reset after `window` duration

**Configuration**:

```yaml
sampling:
  enable: true
  initial: 100           # First 100 logs always pass
  thereafter: 100        # Then 1 out of 100
  window: 1m             # Reset every minute
  per-package: false     # Global sampling by message hash
```

**Per-Package Sampling**:

When `per-package: true`, sampling is applied separately for each package+message combination. This requires `report-caller: true`.

```yaml
sampling:
  enable: true
  initial: 50
  thereafter: 100
  window: 1m
  per-package: true      # Separate counters per package
```

**Important Notes**:
- Only applies to `Debug` and `Info` levels
- `Warn`, `Error`, and `Fatal` are **never sampled**
- Sampling key is based on message content hash
- When `per-package: true`, key includes package path

**Example Scenario**:

A polling loop logs "checking status" every 100ms:
- Without sampling: 600 logs/minute
- With sampling (initial=10, thereafter=100): 10 + 5 = 15 logs/minute
- Reduction: 97.5%

### 7. Package Filtering

Control which packages produce logs:

**Include Mode** (whitelist):
```yaml
include-packages:
  - "github.com/peers-labs/peers-touch/station/app"
```
Only logs from matching packages are output.

**Exclude Mode** (blacklist):
```yaml
exclude-packages:
  - "gorm.io"
  - "github.com/cloudwego/hertz"
```
Logs from matching packages are suppressed.

**Pattern Matching**:
- Prefix match: `"github.com/peers-labs"` matches all subpackages
- Wildcard: `"gorm.io/*"` matches all subpackages

## Implementation Details

### Architecture

```
logrus.go
├── logrusLogger (implements logger.Logger)
│   ├── Logger: entryLogger (logrus.Entry or logrus.Logger)
│   └── opts: Options
│
├── Hooks
│   ├── RequestIDHook (injects request_id/trace_id)
│   ├── PackageFieldHook (adds pkg field)
│   └── LevelHooks (splits logs by level)
│
└── Formatter
    ├── TextFormatter (with customization)
    ├── JSONFormatter
    └── FilteringFormatter (package filtering wrapper)
```

### Hooks

1. **RequestIDHook**: Extracts Request ID and Trace ID from context
2. **PackageFieldHook**: Adds `pkg` field from caller info
3. **LevelHooks**: Writes specific levels to separate files

### Initialization Flow

```
app/conf/log.yml
  ↓ (config loading)
frame/core/peers/config/config.go
  ↓ (RegisterOptions)
plugin/logger/logrus/plugin.go
  ↓ (init, Options())
logrus.go
  ↓ (Init)
Logrus Logger Instance
  ├── Register Hooks
  ├── Set Formatter
  ├── Configure Output
  └── Replace DefaultLogger
```

## Testing

### Run Tests

```bash
cd station/frame/core/plugin/logger/logrus
go test -v
```

### Test Coverage

```bash
go test -cover
```

Current coverage:
- `logrus.go`: Core implementation
- `request_id_hook.go`: Request ID injection
- `plugin.go`: Configuration loading
- `level_hooks.go`: Level-based splitting
- `pkg_filter.go`: Package filtering

### Test Files

- `plugin_test.go`: Configuration loading tests
- `request_id_hook_test.go`: Hook functionality tests
- `sampling_hook_test.go`: Log sampling tests
- Additional tests in `logrus/` subdirectory

## Troubleshooting

### Issue: Log level not working

**Problem**: Setting `level: debug` in config doesn't show debug logs.

**Solution**: ✅ Fixed in this version. The plugin now correctly reads the `level` field from config.

### Issue: Request ID not appearing in logs

**Problem**: Logs don't show `request_id` field.

**Solution**: Ensure you're using context-aware logging:
```go
// ✅ Correct
ctx = logger.WithRequestID(ctx, "req-123")
logger.Info(ctx, "message")

// ❌ Wrong (no context)
logger.DefaultLogger.Log(logger.InfoLevel, "message")
```

### Issue: Too many logs from dependencies

**Problem**: Logs flooded with GORM/Hertz debug messages.

**Solution**: Use package filtering:
```yaml
slogrus:
  exclude-packages:
    - "gorm.io"
    - "github.com/cloudwego/hertz"
```

### Issue: Log file not rotating

**Problem**: Log file grows indefinitely.

**Solution**: Check persistence configuration:
```yaml
persistence:
  enable: true
  max-file-size: 50        # Must be > 0
  max-backup-keep-days: 14 # Must be > 0
```

### Issue: Too many repeated logs flooding the system

**Problem**: A package repeatedly logs the same message (e.g., polling, heartbeat), filling up disk space.

**Solution**: Enable log sampling:
```yaml
slogrus:
  sampling:
    enable: true
    initial: 50            # Keep first 50 occurrences
    thereafter: 100        # Then 1 out of 100
    window: 1m             # Reset every minute
    per-package: true      # Separate sampling per package
```

This reduces log volume by 95%+ while preserving important information.

## Performance Considerations

1. **Async Logging**: Logrus writes are synchronous. For high-throughput scenarios, consider buffering.
2. **File I/O**: Disk writes can be slow. Use SSD or separate log disk in production.
3. **Caller Info**: `report-caller: true` adds overhead (~10-20%). Disable in production if not needed.
4. **JSON Format**: Slightly slower than text format but better for log aggregation.

## Migration from Old Logger

If migrating from `frame/core/util/log`:

```go
// Old (deprecated)
import "github.com/peers-labs/peers-touch/station/frame/core/util/log"
log.Info("message")

// New (correct)
import "github.com/peers-labs/peers-touch/station/frame/core/logger"
logger.Info(ctx, "message")
```

Key changes:
- All functions now require `context.Context` as first parameter
- Use `logger.Infof(ctx, ...)` instead of `log.Infof(...)`
- Request ID is automatically included if set in context

## See Also

- [Logger Abstract Interface](../../logger/README.md)
- [Logrus Documentation](https://github.com/sirupsen/logrus)
- [Lumberjack Documentation](https://github.com/natefinch/lumberjack)
- [Station Library Usage Standards](../../../../../.prompts/30-STATION/35-lib-usage.md)
