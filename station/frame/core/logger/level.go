package logger

import (
	"context"
	"fmt"
	"os"
)

// Level represents logging severity.
type Level int8

const (
	// TraceLevel level. Designates finer-grained informational events than the Debug.
	TraceLevel Level = iota - 2
	// DebugLevel level. Usually only enabled when debugging. Very verbose logging.
	DebugLevel
	// InfoLevel is the default logging priority.
	// General operational entries about what's going on inside the application.
	InfoLevel
	// WarnLevel level. Non-critical entries that deserve eyes.
	WarnLevel
	// ErrorLevel level. Logs. Used for errors that should definitely be noted.
	ErrorLevel
	// FatalLevel level. Logs and then calls `logger.Exit(1)`. highest level of severity.
	FatalLevel
)

// String returns the string representation of the level.
func (l Level) String() string {
	switch l {
	case TraceLevel:
		return "trace"
	case DebugLevel:
		return "debug"
	case InfoLevel:
		return "info"
	case WarnLevel:
		return "warn"
	case ErrorLevel:
		return "error"
	case FatalLevel:
		return "fatal"
	}
	return ""
}

// Enabled returns true if the given level is at or above this level.
// Enabled reports whether lvl is at or above this level.
func (l Level) Enabled(lvl Level) bool {
	return lvl >= l
}

// GetLevel converts a level string into a logger Level value.
// returns an error if the input string does not match known values.
// GetLevel converts a level string into a Level value.
func GetLevel(levelStr string) (Level, error) {
	switch levelStr {
	case TraceLevel.String():
		return TraceLevel, nil
	case DebugLevel.String():
		return DebugLevel, nil
	case InfoLevel.String():
		return InfoLevel, nil
	case WarnLevel.String():
		return WarnLevel, nil
	case ErrorLevel.String():
		return ErrorLevel, nil
	case FatalLevel.String():
		return FatalLevel, nil
	}
	return InfoLevel, fmt.Errorf("Unknown Level String: '%s', defaulting to InfoLevel", levelStr)
}

// Info logs at info level using DefaultLogger.
func Info(ctx context.Context, args ...interface{}) {
	DefaultLogger.Log(InfoLevel, args...)
}

// Infof logs formatted message at info level.
func Infof(ctx context.Context, template string, args ...interface{}) {
	DefaultLogger.Logf(InfoLevel, template, args...)
}

// Trace logs at trace level.
func Trace(ctx context.Context, args ...interface{}) {
	DefaultLogger.Log(TraceLevel, args...)
}

// Tracef logs formatted message at trace level.
func Tracef(ctx context.Context, template string, args ...interface{}) {
	DefaultLogger.Logf(TraceLevel, template, args...)
}

// Debug logs at debug level.
func Debug(ctx context.Context, args ...interface{}) {
	DefaultLogger.Log(DebugLevel, args...)
}

// Debugf logs formatted message at debug level.
func Debugf(ctx context.Context, template string, args ...interface{}) {
	DefaultLogger.Logf(DebugLevel, template, args...)
}

// Warn logs at warn level.
func Warn(ctx context.Context, args ...interface{}) {
	DefaultLogger.Log(WarnLevel, args...)
}

// Warnf logs formatted message at warn level.
func Warnf(ctx context.Context, template string, args ...interface{}) {
	DefaultLogger.Logf(WarnLevel, template, args...)
}

// Error logs at error level.
func Error(ctx context.Context, args ...interface{}) {
	DefaultLogger.Log(ErrorLevel, args...)
}

// Errorf logs formatted message at error level.
func Errorf(ctx context.Context, template string, args ...interface{}) {
	DefaultLogger.Logf(ErrorLevel, template, args...)
}

// Fatal logs at fatal level and exits.
func Fatal(ctx context.Context, args ...interface{}) {
	DefaultLogger.Log(FatalLevel, args...)
	os.Exit(1)
}

// Fatalf logs formatted message at fatal level and exits.
func Fatalf(ctx context.Context, template string, args ...interface{}) {
	DefaultLogger.Logf(FatalLevel, template, args...)
	os.Exit(1)
}

// Returns true if the given level is at or lower the current logger level.
// V reports whether lvl is enabled by the given logger.
func V(lvl Level, log Logger) bool {
	l := DefaultLogger
	if log != nil {
		l = log
	}
	return l.Options().Level <= lvl
}
