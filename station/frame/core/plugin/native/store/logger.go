package native

import (
	"context"
	"errors"
	"time"

	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// NewGormLogger creates a new GORM logger that uses the application's logger.
func NewGormLogger() gormlogger.Interface {
	return &gormLogger{
		logLevel: gormlogger.Info, // Default to Info to log all SQL statements
	}
}

type gormLogger struct {
	logLevel gormlogger.LogLevel
}

func (l *gormLogger) LogMode(level gormlogger.LogLevel) gormlogger.Interface {
	newLogger := *l
	newLogger.logLevel = level
	return &newLogger
}

func (l *gormLogger) Info(ctx context.Context, msg string, data ...interface{}) {
	if l.logLevel >= gormlogger.Info {
		logger.Infof(ctx, msg, data...)
	}
}

func (l *gormLogger) Warn(ctx context.Context, msg string, data ...interface{}) {
	if l.logLevel >= gormlogger.Warn {
		logger.Warnf(ctx, msg, data...)
	}
}

func (l *gormLogger) Error(ctx context.Context, msg string, data ...interface{}) {
	if l.logLevel >= gormlogger.Error {
		logger.Errorf(ctx, msg, data...)
	}
}

func (l *gormLogger) Trace(ctx context.Context, begin time.Time, fc func() (sql string, rowsAffected int64), err error) {
	if l.logLevel <= gormlogger.Silent {
		return
	}

	elapsed := time.Since(begin)
	sql, rows := fc()

	switch {
	case err != nil && l.logLevel >= gormlogger.Error && !errors.Is(err, gorm.ErrRecordNotFound):
		logger.Errorf(ctx, "GORM query error: latency=%.3fms rows=%d sql=%s error=%v",
			float64(elapsed.Nanoseconds())/1e6, rows, sql, err)
	case elapsed > 200*time.Millisecond && l.logLevel >= gormlogger.Warn:
		logger.Warnf(ctx, "GORM slow query: latency=%.3fms rows=%d sql=%s",
			float64(elapsed.Nanoseconds())/1e6, rows, sql)
	case l.logLevel >= gormlogger.Info:
		logger.Infof(ctx, "GORM query: latency=%.3fms rows=%d sql=%s",
			float64(elapsed.Nanoseconds())/1e6, rows, sql)
	}
}
