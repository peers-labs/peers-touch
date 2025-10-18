package native

import (
	"github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/pion/logging"
)

// Logger is a wrapper around the core logger.
// Used for Turn logging
type Logger struct {
	logger logger.Logger
}

// NewLogger creates a new instance of Logger with the same underlying logger
func (l *Logger) NewLogger(scope string) logging.LeveledLogger {
	return &Logger{
		logger: l.logger,
	}
}

// Trace Level Logging
// Trace logs a trace message.
func (l *Logger) Trace(msg string) {
	l.logger.Logf(logger.TraceLevel, "[TURN] Trace: %s", msg)
}

// Tracef logs a formatted trace message.
func (l *Logger) Tracef(format string, args ...interface{}) {
	l.logger.Logf(logger.TraceLevel, "[TURN] Trace: "+format, args...)
}

// Debug Level Logging
// Debug logs a debug message.
func (l *Logger) Debug(msg string) {
	l.logger.Logf(logger.DebugLevel, "[TURN] "+msg)
}

// Debugf logs a formatted debug message.
func (l *Logger) Debugf(format string, args ...interface{}) {
	l.logger.Logf(logger.DebugLevel, "[TURN] "+format, args...)
}

// Info Level Logging
// Info logs an info message.
func (l *Logger) Info(msg string) {
	l.logger.Logf(logger.InfoLevel, "[TURN] "+msg)
}

// Infof logs a formatted info message.
func (l *Logger) Infof(msg string, args ...interface{}) {
	l.logger.Logf(logger.InfoLevel, "[TURN] "+msg, args...)
}

// Warn Level Logging
// Warn logs a warning message.
func (l *Logger) Warn(msg string) {
	l.logger.Logf(logger.WarnLevel, "[TURN] Warn: %s", msg)
}

// Warnf logs a formatted warning message.
func (l *Logger) Warnf(format string, args ...interface{}) {
	l.logger.Logf(logger.WarnLevel, "[TURN] "+format, args...)
}

// Error Level Logging
// Error logs an error message.
func (l *Logger) Error(msg string) {
	l.logger.Logf(logger.ErrorLevel, "[TURN] "+msg)
}

// Errorf logs a formatted error message.
func (l *Logger) Errorf(msg string, args ...interface{}) {
	l.logger.Logf(logger.ErrorLevel, "[TURN] "+msg, args...)
}

// LoggerFactory is a factory for creating Turn loggers.
type LoggerFactory struct {
	logger logger.Logger
}

// NewLoggerFactory creates a new instance of LoggerFactory.
func NewLoggerFactory() *LoggerFactory {
	return &LoggerFactory{
		logger: logger.DefaultLogger,
	}
}

// NewLogger creates a new logger instance implementing logging.LeveledLogger.
func (lf *LoggerFactory) NewLogger(scope string) logging.LeveledLogger {
	return &Logger{
		logger: lf.logger,
	}
}
