package id

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/peers-touch/peers-touch/station/frame/core/store"
	"github.com/sony/sonyflake"
)

// IDType defines the type of ID generation method
type IDType int

const (
	IDTypeTiming    IDType = iota // Timing-based IDs using Sonyflake
	IDTypeReadable                // Human-readable unique IDs
	IDTypeRandom                  // Cryptographically secure random IDs
	IDTypeSonyflake               // Sonyflake distributed ID generator
)

// StoreMode defines how IDs are stored
type StoreMode int

const (
	StoreModeRealTime StoreMode = iota // Real-time computing, no store layer
	StoreModeDB                        // Database mode, uses store layer
)

// String returns string representation of IDType
func (t IDType) String() string {
	switch t {
	case IDTypeTiming:
		return "timing"
	case IDTypeReadable:
		return "readable"
	case IDTypeRandom:
		return "random"
	case IDTypeSonyflake:
		return "sonyflake"
	default:
		return "unknown"
	}
}

// String returns string representation of StoreMode
func (m StoreMode) String() string {
	switch m {
	case StoreModeRealTime:
		return "real-time"
	case StoreModeDB:
		return "db"
	default:
		return "unknown"
	}
}

// IDOptions contains configuration for ID generation
type IDOptions struct {
	IDType    IDType
	StoreMode StoreMode
	Prefix    string
	Suffix    string
	Length    int
	Timestamp bool
	Separator string
	Context   context.Context
}

// Option defines functional options for ID generation
type Option func(*IDOptions)

// Global Sonyflake instance
var flake *sonyflake.Sonyflake

// init initializes the Sonyflake instance
func init() {
	settings := sonyflake.Settings{
		StartTime: time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	flake = sonyflake.NewSonyflake(settings)
	if flake == nil {
		// Fallback to a simple counter-based approach if Sonyflake fails
		flake = sonyflake.NewSonyflake(sonyflake.Settings{
			StartTime: time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC),
			MachineID: func() (uint16, error) { return 1, nil },
		})
	}
}

// WithTiming sets ID type to timing-based (Sonyflake)
// Usage: Use with NextID() for numeric IDs
// Incompatible: WithReadable(), WithRandom()
func WithTiming() Option {
	return func(o *IDOptions) {
		o.IDType = IDTypeTiming
	}
}

// WithReadable sets ID type to human-readable unique strings
// Usage: Use with NextIDS() for string IDs
// Incompatible: WithTiming(), WithRandom() when used with NextID()
func WithReadable() Option {
	return func(o *IDOptions) {
		o.IDType = IDTypeReadable
	}
}

// WithRandom sets ID type to cryptographically secure random strings
// Usage: Use with NextIDS() for string IDs
// Incompatible: WithTiming(), WithReadable() when used with NextID()
func WithRandom() Option {
	return func(o *IDOptions) {
		o.IDType = IDTypeRandom
	}
}

// WithSonyflake sets ID type to Sonyflake distributed IDs
// Usage: Use with NextID() for numeric IDs or NextIDS() for string IDs
// Compatible: All store modes
func WithSonyflake() Option {
	return func(o *IDOptions) {
		o.IDType = IDTypeSonyflake
	}
}

// WithStoreMode sets the store mode for ID generation
// StoreModeRealTime: No store layer, real-time computing
// StoreModeDB: Uses store layer for persistence
func WithStoreMode(mode StoreMode) Option {
	return func(o *IDOptions) {
		o.StoreMode = mode
	}
}

// WithPrefix adds a prefix to generated string IDs
// Example: WithPrefix("user-") → "user-abc123"
func WithPrefix(prefix string) Option {
	return func(o *IDOptions) {
		o.Prefix = prefix
	}
}

// WithSuffix adds a suffix to generated string IDs
// Example: WithSuffix("-dev") → "abc123-dev"
func WithSuffix(suffix string) Option {
	return func(o *IDOptions) {
		o.Suffix = suffix
	}
}

// WithLength sets the length for random and readable IDs
// Default: 8 for random, 6 for readable
func WithLength(length int) Option {
	return func(o *IDOptions) {
		o.Length = length
	}
}

// WithTimestamp includes timestamp in readable IDs
// Example: "usr-abc123-20241225-143022"
func WithTimestamp() Option {
	return func(o *IDOptions) {
		o.Timestamp = true
	}
}

// WithSeparator sets the separator for readable IDs
// Default: "-"
func WithSeparator(separator string) Option {
	return func(o *IDOptions) {
		o.Separator = separator
	}
}

// WithContext sets the context for store operations
// Required when StoreModeDB is used
func WithContext(ctx context.Context) Option {
	return func(o *IDOptions) {
		o.Context = ctx
	}
}

// Default options
var defaultOptions = IDOptions{
	IDType:    IDTypeSonyflake,
	StoreMode: StoreModeRealTime,
	Length:    8,
	Separator: "-",
	Context:   context.Background(),
}

// NextID generates a numeric ID based on the provided options
// Compatible with: IDTypeTiming, IDTypeSonyflake
// INCOMPATIBLE with: IDTypeReadable, IDTypeRandom (will panic)
// Usage: id.NextID(id.WithTiming()) or id.NextID(id.WithSonyflake())
func NextID(opts ...Option) uint64 {
	options := applyOptions(opts)

	// Validate compatibility
	if options.IDType == IDTypeReadable || options.IDType == IDTypeRandom {
		panic(fmt.Sprintf("NextID() cannot be used with %s ID type. Use NextIDS() instead.", options.IDType))
	}

	// Handle store mode
	if options.StoreMode == StoreModeDB {
		return handleDBStoreID(options)
	}

	// Real-time mode
	var id uint64
	switch options.IDType {
	case IDTypeTiming, IDTypeSonyflake:
		var err error
		id, err = flake.NextID()
		if err != nil {
			panic(fmt.Sprintf("failed to generate Sonyflake ID: %v", err))
		}
	default:
		panic(fmt.Sprintf("unsupported ID type for NextID: %s", options.IDType))
	}

	return id
}

// NextIDS generates a string ID based on the provided options
// Compatible with all ID types
// For IDTypeTiming and IDTypeSonyflake, converts uint64 to string
// For IDTypeReadable and IDTypeRandom, generates appropriate string formats
func NextIDS(opts ...Option) string {
	options := applyOptions(opts)

	// Handle store mode
	if options.StoreMode == StoreModeDB {
		return handleDBStoreStringID(options)
	}

	// Real-time mode
	var idStr string

	switch options.IDType {
	case IDTypeTiming, IDTypeSonyflake:
		id := NextID(opts...)
		idStr = strconv.FormatUint(id, 10)

	case IDTypeReadable:
		idStr = generateReadableID(options)

	case IDTypeRandom:
		idStr = generateRandomID(options)

	default:
		panic(fmt.Sprintf("unsupported ID type: %s", options.IDType))
	}

	// Apply prefix and suffix
	if options.Prefix != "" {
		idStr = options.Prefix + idStr
	}
	if options.Suffix != "" {
		idStr = idStr + options.Suffix
	}

	return idStr
}

// handleDBStoreID handles ID generation when StoreModeDB is used
func handleDBStoreID(options IDOptions) uint64 {
	if options.Context == nil {
		panic("context is required when StoreModeDB is used")
	}

	// Get store instance
	st, err := store.GetStore(options.Context)
	if err != nil {
		panic(fmt.Sprintf("failed to get store: %v", err))
	}

	// Use store for logging/debugging
	_ = st

	// For now, use Sonyflake for numeric IDs
	// Future: integrate with store-specific ID generation
	id, err := flake.NextID()
	if err != nil {
		panic(fmt.Sprintf("failed to generate Sonyflake ID: %v", err))
	}

	return id
}

// handleDBStoreStringID handles string ID generation when StoreModeDB is used
func handleDBStoreStringID(options IDOptions) string {
	if options.Context == nil {
		panic("context is required when StoreModeDB is used")
	}

	// Get store instance
	st, err := store.GetStore(options.Context)
	if err != nil {
		panic(fmt.Sprintf("failed to get store: %v", err))
	}

	// Use store for logging/debugging
	_ = st

	// Generate ID based on type
	var idStr string

	switch options.IDType {
	case IDTypeTiming, IDTypeSonyflake:
		id := handleDBStoreID(options)
		idStr = strconv.FormatUint(id, 10)

	case IDTypeReadable:
		idStr = generateReadableID(options)

	case IDTypeRandom:
		idStr = generateRandomID(options)

	default:
		panic(fmt.Sprintf("unsupported ID type: %s", options.IDType))
	}

	return idStr
}

// generateReadableID creates human-readable IDs
func generateReadableID(opts IDOptions) string {
	parts := []string{}

	// Add random readable part
	randomPart := generateReadableRandom(opts.Length)
	parts = append(parts, randomPart)

	// Add timestamp if enabled
	if opts.Timestamp {
		timestamp := time.Now().Format("20060102-150405")
		parts = append(parts, timestamp)
	}

	return strings.Join(parts, opts.Separator)
}

// generateReadableRandom creates a human-readable random string
func generateReadableRandom(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, length)

	for i := 0; i < length; i++ {
		num, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			panic(fmt.Sprintf("failed to generate random number: %v", err))
		}
		result[i] = charset[num.Int64()]
	}

	return string(result)
}

// generateRandomID creates cryptographically secure random IDs
func generateRandomID(opts IDOptions) string {
	const charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	result := make([]byte, opts.Length)

	for i := 0; i < opts.Length; i++ {
		num, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			panic(fmt.Sprintf("failed to generate random number: %v", err))
		}
		result[i] = charset[num.Int64()]
	}

	return string(result)
}

// applyOptions applies the provided options to the default options
func applyOptions(opts []Option) IDOptions {
	options := defaultOptions
	for _, opt := range opts {
		opt(&options)
	}
	return options
}

// Quick helper functions for common use cases

// NextSonyflakeID generates a Sonyflake numeric ID
// Usage: id.NextSonyflakeID()
func NextSonyflakeID() uint64 {
	return NextID(WithSonyflake())
}

// NextTimingID generates a timing-based numeric ID (alias for Sonyflake)
// Usage: id.NextTimingID()
func NextTimingID() uint64 {
	return NextID(WithTiming())
}

// NextReadableID generates a human-readable string ID
// Usage: id.NextReadableID("prefix") or id.NextReadableID()
func NextReadableID(prefix ...string) string {
	if len(prefix) > 0 {
		return NextIDS(WithReadable(), WithPrefix(prefix[0]))
	}
	return NextIDS(WithReadable())
}

// NextRandomID generates a cryptographically secure random string ID
// Usage: id.NextRandomID(12) or id.NextRandomID()
func NextRandomID(length ...int) string {
	l := 8
	if len(length) > 0 {
		l = length[0]
	}
	return NextIDS(WithRandom(), WithLength(l))
}

// NextIDWithContext generates an ID with context for store operations
// Usage: id.NextIDWithContext(ctx, id.WithSonyflake(), id.WithStoreMode(id.StoreModeDB))
func NextIDWithContext(ctx context.Context, opts ...Option) uint64 {
	return NextID(append(opts, WithContext(ctx))...)
}

// NextIDSWithContext generates a string ID with context for store operations
// Usage: id.NextIDSWithContext(ctx, id.WithReadable(), id.WithStoreMode(id.StoreModeDB))
func NextIDSWithContext(ctx context.Context, opts ...Option) string {
	return NextIDS(append(opts, WithContext(ctx))...)
}

// storeIDInDB handles storing numeric IDs in database
// storeIDInDB handles storing numeric IDs in database
func storeIDInDB(ctx context.Context, id uint64, idType IDType) error {
	if ctx == nil {
		return nil
	}

	// Get store from context
	st, err := store.GetStore(ctx)
	if err != nil {
		return err
	}

	// Use store for logging/debugging
	_ = st

	// TODO: Implement actual storage logic based on your requirements
	// For now, we just return nil
	return nil
}

// storeStringIDInDB handles storing string IDs in database
func storeStringIDInDB(ctx context.Context, id string, idType IDType) error {
	if ctx == nil {
		return nil
	}

	// Get store from context
	st, err := store.GetStore(ctx)
	if err != nil {
		return err
	}

	// Use store for logging/debugging
	_ = st

	// TODO: Implement actual storage logic based on your requirements
	// For now, we just return nil
	return nil
}
