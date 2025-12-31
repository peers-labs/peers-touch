// Package log provides a log interface
package logger

import "context"

var (
	// Default logger.
	// todo no default like so
	DefaultLogger Logger = NewLogger(context.Background())

	// Default logger helper.
	DefaultHelper *Helper = NewHelper(DefaultLogger)
)

// Logger is a generic logging interface.
type Logger interface {
	// Init initializes options
	Init(ctx context.Context, options ...Option) error
	// The Logger options
	Options() Options
	// Fields set fields to always be logged
	Fields(fields map[string]interface{}) Logger
	// Log writes a log entry
	Log(level Level, v ...interface{})
	// Logf writes a formatted log entry
	Logf(level Level, format string, v ...interface{})
	// String returns the name of logger
	String() string
}

// Init initializes the DefaultLogger with provided options.
func Init(ctx context.Context, opts ...Option) error { return DefaultLogger.Init(ctx, opts...) }

// Fields returns a new Logger that logs with the given default fields.
func Fields(fields map[string]interface{}) Logger { return DefaultLogger.Fields(fields) }

// Log writes a log entry using DefaultLogger.
func Log(level Level, v ...interface{}) { DefaultLogger.Log(level, v...) }

// Logf writes a formatted log entry using DefaultLogger.
func Logf(level Level, format string, v ...interface{}) { DefaultLogger.Logf(level, format, v...) }

// String returns the DefaultLogger name.
func String() string { return DefaultLogger.String() }

// LoggerOrDefault returns l if non-nil, otherwise DefaultLogger.
func LoggerOrDefault(l Logger) Logger {
	if l == nil {
		return DefaultLogger
	}
	return l
}
