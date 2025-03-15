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

func Init(ctx context.Context, opts ...Option) error {
	return DefaultLogger.Init(ctx, opts...)
}

func Fields(fields map[string]interface{}) Logger {
	return DefaultLogger.Fields(fields)
}

func Log(level Level, v ...interface{}) {
	DefaultLogger.Log(level, v...)
}

func Logf(level Level, format string, v ...interface{}) {
	DefaultLogger.Logf(level, format, v...)
}

func String() string {
	return DefaultLogger.String()
}

func LoggerOrDefault(l Logger) Logger {
	if l == nil {
		return DefaultLogger
	}
	return l
}
