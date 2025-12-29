package hertz

import (
	"context"
	"io"

	"github.com/cloudwego/hertz/pkg/common/hlog"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// hertzLoggerAdapter implements hlog.FullLogger interface using our custom logger
type hertzLoggerAdapter struct {
	logger log.Logger
}

// NewHertzLogger constructs a Hertz-compatible logger that forwards to the core logger.
func NewHertzLogger() hlog.FullLogger {
	return &hertzLoggerAdapter{
		logger: log.DefaultLogger,
	}
}

// SetOutput sets the output of the logger.
// Our custom logger doesn't support changing output dynamically in this way,
// so this is a no-op or we could try to re-init.
func (l *hertzLoggerAdapter) SetOutput(w io.Writer) {
	// No-op for now as our logger handles output internally
}

// SetLevel sets the level of the logger.
// We map Hertz levels to our logger levels.
func (l *hertzLoggerAdapter) SetLevel(level hlog.Level) {
	var lvl log.Level
	switch level {
	case hlog.LevelTrace:
		lvl = log.TraceLevel
	case hlog.LevelDebug:
		lvl = log.DebugLevel
	case hlog.LevelInfo:
		lvl = log.InfoLevel
	case hlog.LevelNotice, hlog.LevelWarn:
		lvl = log.WarnLevel
	case hlog.LevelError:
		lvl = log.ErrorLevel
	case hlog.LevelFatal:
		lvl = log.FatalLevel
	default:
		lvl = log.InfoLevel
	}

	// Re-initialize logger with new level
	l.logger.Init(context.Background(), log.WithLevel(lvl))
}

// Fatal implements hlog.FullLogger
func (l *hertzLoggerAdapter) Fatal(v ...interface{}) {
	l.logger.Log(log.FatalLevel, v...)
}

// Fatalf implements hlog.FullLogger
func (l *hertzLoggerAdapter) Fatalf(format string, v ...interface{}) {
	l.logger.Logf(log.FatalLevel, format, v...)
}

// Error implements hlog.FullLogger
func (l *hertzLoggerAdapter) Error(v ...interface{}) {
	l.logger.Log(log.ErrorLevel, v...)
}

// Errorf implements hlog.FullLogger
func (l *hertzLoggerAdapter) Errorf(format string, v ...interface{}) {
	l.logger.Logf(log.ErrorLevel, format, v...)
}

// Warn implements hlog.FullLogger
func (l *hertzLoggerAdapter) Warn(v ...interface{}) {
	l.logger.Log(log.WarnLevel, v...)
}

// Warnf implements hlog.FullLogger
func (l *hertzLoggerAdapter) Warnf(format string, v ...interface{}) {
	l.logger.Logf(log.WarnLevel, format, v...)
}

// Notice implements hlog.FullLogger
func (l *hertzLoggerAdapter) Notice(v ...interface{}) {
	// Map Notice to Info as we don't have Notice level
	l.logger.Log(log.InfoLevel, v...)
}

// Noticef implements hlog.FullLogger
func (l *hertzLoggerAdapter) Noticef(format string, v ...interface{}) {
	l.logger.Logf(log.InfoLevel, format, v...)
}

// Info implements hlog.FullLogger
func (l *hertzLoggerAdapter) Info(v ...interface{}) {
	l.logger.Log(log.InfoLevel, v...)
}

// Infof implements hlog.FullLogger
func (l *hertzLoggerAdapter) Infof(format string, v ...interface{}) {
	l.logger.Logf(log.InfoLevel, format, v...)
}

// Debug implements hlog.FullLogger
func (l *hertzLoggerAdapter) Debug(v ...interface{}) {
	l.logger.Log(log.DebugLevel, v...)
}

// Debugf implements hlog.FullLogger
func (l *hertzLoggerAdapter) Debugf(format string, v ...interface{}) {
	l.logger.Logf(log.DebugLevel, format, v...)
}

// Trace implements hlog.FullLogger
func (l *hertzLoggerAdapter) Trace(v ...interface{}) {
	l.logger.Log(log.TraceLevel, v...)
}

// Tracef implements hlog.FullLogger
func (l *hertzLoggerAdapter) Tracef(format string, v ...interface{}) {
	l.logger.Logf(log.TraceLevel, format, v...)
}

// CtxFatal implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxFatal(ctx context.Context, v ...interface{}) {
	l.logger.Log(log.FatalLevel, v...)
}

// CtxFatalf implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxFatalf(ctx context.Context, format string, v ...interface{}) {
	l.logger.Logf(log.FatalLevel, format, v...)
}

// CtxError implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxError(ctx context.Context, v ...interface{}) {
	l.logger.Log(log.ErrorLevel, v...)
}

// CtxErrorf implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxErrorf(ctx context.Context, format string, v ...interface{}) {
	l.logger.Logf(log.ErrorLevel, format, v...)
}

// CtxWarn implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxWarn(ctx context.Context, v ...interface{}) {
	l.logger.Log(log.WarnLevel, v...)
}

// CtxWarnf implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxWarnf(ctx context.Context, format string, v ...interface{}) {
	l.logger.Logf(log.WarnLevel, format, v...)
}

// CtxNotice implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxNotice(ctx context.Context, v ...interface{}) {
	l.logger.Log(log.InfoLevel, v...)
}

// CtxNoticef implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxNoticef(ctx context.Context, format string, v ...interface{}) {
	l.logger.Logf(log.InfoLevel, format, v...)
}

// CtxInfo implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxInfo(ctx context.Context, v ...interface{}) {
	l.logger.Log(log.InfoLevel, v...)
}

// CtxInfof implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxInfof(ctx context.Context, format string, v ...interface{}) {
	l.logger.Logf(log.InfoLevel, format, v...)
}

// CtxDebug implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxDebug(ctx context.Context, v ...interface{}) {
	l.logger.Log(log.DebugLevel, v...)
}

// CtxDebugf implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxDebugf(ctx context.Context, format string, v ...interface{}) {
	l.logger.Logf(log.DebugLevel, format, v...)
}

// CtxTrace implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxTrace(ctx context.Context, v ...interface{}) {
	l.logger.Log(log.TraceLevel, v...)
}

// CtxTracef implements hlog.FullLogger
func (l *hertzLoggerAdapter) CtxTracef(ctx context.Context, format string, v ...interface{}) {
	l.logger.Logf(log.TraceLevel, format, v...)
}
