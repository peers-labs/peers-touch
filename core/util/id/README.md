# ID Generation Utility

A comprehensive ID generation system for Go applications that supports multiple ID types, storage modes, and extensive customization options.

## Features

- **Multiple ID Types**: Sonyflake, timing-based, human-readable, and cryptographically secure random IDs
- **Store Integration**: Real-time computing and database storage modes
- **Flexible Options**: Prefixes, suffixes, timestamps, custom separators, and lengths
- **Thread Safety**: Safe for concurrent use
- **Context Support**: Context-aware ID generation for store operations
- **Validation**: Built-in compatibility checks and panic prevention

## Quick Start

```go
import "github.com/dirty-bro-tech/peers-touch-go/core/util/id"

// Numeric IDs
numericID := id.NextID(id.WithSonyflake())
timingID := id.NextID(id.WithTiming())

// String IDs
readable := id.NextIDS(id.WithReadable())
random := id.NextIDS(id.WithRandom())
sonyflakeStr := id.NextIDS(id.WithSonyflake())

// Quick helpers
id.NextSonyflakeID()      // uint64
id.NextTimingID()         // uint64  
id.NextReadableID()       // string
id.NextRandomID(12)       // string with length 12
```

## ID Types

### Sonyflake (`WithSonyflake()`)
- **Type**: 64-bit distributed unique ID generator
- **Usage**: `NextID()` for uint64, `NextIDS()` for string
- **Description**: Uses Sonyflake algorithm for globally unique IDs across distributed systems
- **Example**: `1234567890123456789`

### Timing (`WithTiming()`)
- **Type**: Timing-based ID (alias for Sonyflake)
- **Usage**: `NextID()` for uint64, `NextIDS()` for string
- **Description**: Same as Sonyflake, provided for semantic clarity
- **Example**: `1234567890123456789`

### Readable (`WithReadable()`)
- **Type**: Human-readable unique strings
- **Usage**: `NextIDS()` only (will panic with `NextID()`)
- **Description**: Alphanumeric strings suitable for URLs and user-facing IDs
- **Example**: `abc123-def-20241225-143022`

### Random (`WithRandom()`)
- **Type**: Cryptographically secure random strings
- **Usage**: `NextIDS()` only (will panic with `NextID()`)
- **Description**: Uses crypto/rand for security-critical applications
- **Example**: `a8B3c9D2e4F5g6H7`

## Store Modes

### Real-time Mode (`StoreModeRealTime`)
- **Default**: No database storage, real-time computation
- **Usage**: Default behavior, no additional setup required
- **Performance**: Fastest, no I/O overhead

### Database Mode (`StoreModeDB`)
- **Integration**: Uses `peers-touch-go/core/store` package
- **Setup**: Requires store injection and context
- **Usage**: `WithStoreMode(StoreModeDB)` + `WithContext(ctx)`
- **Example**:
  ```go
  ctx := context.Background()
  id := NextIDS(WithReadable(), WithStoreMode(StoreModeDB), WithContext(ctx))
  ```

## Option Methods

### ID Type Options
- `WithSonyflake()` - Sonyflake distributed IDs
- `WithTiming()` - Timing-based IDs (Sonyflake alias)
- `WithReadable()` - Human-readable strings
- `WithRandom()` - Cryptographically secure random strings

### Store Options
- `WithStoreMode(mode StoreMode)` - Set storage mode
- `WithContext(ctx context.Context)` - Context for store operations

### Format Options
- `WithPrefix(prefix string)` - Add prefix to string IDs
- `WithSuffix(suffix string)` - Add suffix to string IDs
- `WithLength(length int)` - Set length for random/readable IDs
- `WithTimestamp()` - Include timestamp in readable IDs
- `WithSeparator(separator string)` - Custom separator for readable IDs

## Compatibility Matrix

| ID Type | NextID() | NextIDS() | StoreModeRealTime | StoreModeDB |
|---------|----------|-----------|-------------------|-------------|
| Sonyflake | ✅ | ✅ | ✅ | ✅ |
| Timing | ✅ | ✅ | ✅ | ✅ |
| Readable | ❌ | ✅ | ✅ | ✅ |
| Random | ❌ | ✅ | ✅ | ✅ |

## Usage Examples

### Basic Usage
```go
// Numeric Sonyflake ID
id := id.NextID(id.WithSonyflake())

// Readable string ID  
readable := id.NextIDS(id.WithReadable())

// Custom length random ID
random := id.NextIDS(id.WithRandom(), id.WithLength(16))
```

### Advanced Configuration
```go
// Readable ID with prefix, suffix, and timestamp
id := id.NextIDS(
    id.WithReadable(),
    id.WithPrefix("user-"),
    id.WithSuffix("-2024"),
    id.WithTimestamp(),
    id.WithLength(8),
    id.WithSeparator("_"),
)
// Output: user_abc123def_20241225_143022_2024
```

### Store Integration
```go
// Real-time mode (default)
realtime := id.NextIDS(id.WithReadable())

// Database mode with context
ctx := context.Background()
dbID := id.NextIDS(
    id.WithReadable(),
    id.WithStoreMode(id.StoreModeDB),
    id.WithContext(ctx),
)
```

### Context-Aware Generation
```go
ctx := context.WithTimeout(context.Background(), 5*time.Second)

// With context for store operations
numeric := id.NextIDWithContext(ctx, id.WithSonyflake())
stringID := id.NextIDSWithContext(ctx, id.WithReadable())
```

### Quick Helper Functions
```go
// Numeric IDs
id.NextSonyflakeID()    // Returns uint64
id.NextTimingID()       // Returns uint64

// String IDs  
id.NextReadableID()     // Returns string
id.NextReadableID("usr") // With prefix
id.NextRandomID()       // Returns string (length 8)
id.NextRandomID(12)     // With custom length
```

## Error Handling

The package uses panic for invalid configurations to fail fast during development:

```go
// This will panic - incompatible combination
id := id.NextID(id.WithReadable()) // ❌ Panics

// Correct usage
id := id.NextIDS(id.WithReadable()) // ✅ Works
```

## Performance

Benchmarks on typical hardware:
- **Sonyflake**: ~25,000 IDs/second
- **Readable**: ~500,000 IDs/second  
- **Random**: ~300,000 IDs/second

All operations are thread-safe and suitable for high-concurrency environments.

## Testing

Run the comprehensive test suite:

```bash
go test -v ./core/util/id/

# Run with benchmarks
go test -v -bench=. ./core/util/id/

# Run performance tests only
go test -v -run TestPerformance ./core/util/id/
```

## Thread Safety

The ID generator is safe for concurrent use:

```go
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        id := id.NextIDS(id.WithReadable())
        // Use generated ID
    }()
}
wg.Wait()
```

## Integration with Store Layer

For database mode integration, ensure your store is properly initialized:

```go
// Initialize store (in your application setup)
store.InjectStore(ctx, yourStoreInstance)

// Use with store mode
ctx := context.Background()
id := id.NextIDS(
    id.WithReadable(),
    id.WithStoreMode(id.StoreModeDB),
    id.WithContext(ctx),
)
```

## API Reference

### Core Functions
- `NextID(opts ...Option) uint64` - Generate numeric ID
- `NextIDS(opts ...Option) string` - Generate string ID
- `NextIDWithContext(ctx context.Context, opts ...Option) uint64` - Context-aware numeric ID
- `NextIDSWithContext(ctx context.Context, opts ...Option) string` - Context-aware string ID

### Helper Functions
- `NextSonyflakeID() uint64` - Quick Sonyflake numeric ID
- `NextTimingID() uint64` - Quick timing numeric ID
- `NextReadableID(prefix ...string) string` - Quick readable string ID
- `NextRandomID(length ...int) string` - Quick random string ID

### Option Functions
- `WithSonyflake()` - Set Sonyflake ID type
- `WithTiming()` - Set timing ID type
- `WithReadable()` - Set readable ID type
- `WithRandom()` - Set random ID type
- `WithStoreMode(mode StoreMode)` - Set storage mode
- `WithContext(ctx context.Context)` - Set context
- `WithPrefix(prefix string)` - Add prefix
- `WithSuffix(suffix string)` - Add suffix
- `WithLength(length int)` - Set length
- `WithTimestamp()` - Include timestamp
- `WithSeparator(separator string)` - Set separator