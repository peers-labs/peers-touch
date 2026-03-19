package logger

import (
	"context"
	"os"
)

type Helper struct {
	logger Logger
}

// NewHelper constructs a Helper for a given Logger.
func NewHelper(logger Logger) *Helper {
	return &Helper{logger: logger}
}

// Extract always returns valid Helper with logger from context or with DefaultLogger as fallback.
// Can be used in pair with function Inject.
// Example: propagate RequestID to logger in node handler methods.
func Extract(ctx context.Context) *Helper {
	if l, ok := FromContext(ctx); ok {
		return NewHelper(l)
	}

	return NewHelper(DefaultLogger)
}

// Inject stores the underlying logger into the context.
func (h *Helper) Inject(ctx context.Context) context.Context {
	return NewContext(ctx, h.logger)
}

// Log logs at given level.
func (h *Helper) Log(ctx context.Context, level Level, args ...interface{}) {
	h.logger.Log(ctx, level, args...)
}

// Logf logs formatted at given level.
func (h *Helper) Logf(ctx context.Context, level Level, template string, args ...interface{}) {
	h.logger.Logf(ctx, level, template, args...)
}

// Info logs arguments at info level.
func (h *Helper) Info(args ...interface{}) {
	if !h.logger.Options().Level.Enabled(InfoLevel) {
		return
	}
	h.logger.Log(context.Background(), InfoLevel, args...)
}

// Infof logs formatted message at info level.
func (h *Helper) Infof(template string, args ...interface{}) {
	if !h.logger.Options().Level.Enabled(InfoLevel) {
		return
	}
	h.logger.Logf(context.Background(), InfoLevel, template, args...)
}

// Trace logs arguments at trace level.
func (h *Helper) Trace(args ...interface{}) {
	if !h.logger.Options().Level.Enabled(TraceLevel) {
		return
	}
	h.logger.Log(context.Background(), TraceLevel, args...)
}

// Tracef logs formatted message at trace level.
func (h *Helper) Tracef(template string, args ...interface{}) {
	if !h.logger.Options().Level.Enabled(TraceLevel) {
		return
	}
	h.logger.Logf(context.Background(), TraceLevel, template, args...)
}

// Debug logs arguments at debug level.
func (h *Helper) Debug(args ...interface{}) {
	if !h.logger.Options().Level.Enabled(DebugLevel) {
		return
	}
	h.logger.Log(context.Background(), DebugLevel, args...)
}

// Debugf logs formatted message at debug level.
func (h *Helper) Debugf(template string, args ...interface{}) {
	if !h.logger.Options().Level.Enabled(DebugLevel) {
		return
	}
	h.logger.Logf(context.Background(), DebugLevel, template, args...)
}

// Warn logs arguments at warn level.
func (h *Helper) Warn(args ...interface{}) {
	if !h.logger.Options().Level.Enabled(WarnLevel) {
		return
	}
	h.logger.Log(context.Background(), WarnLevel, args...)
}

// Warnf logs formatted message at warn level.
func (h *Helper) Warnf(template string, args ...interface{}) {
	if !h.logger.Options().Level.Enabled(WarnLevel) {
		return
	}
	h.logger.Logf(context.Background(), WarnLevel, template, args...)
}

// Error logs arguments at error level.
func (h *Helper) Error(args ...interface{}) {
	if !h.logger.Options().Level.Enabled(ErrorLevel) {
		return
	}
	h.logger.Log(context.Background(), ErrorLevel, args...)
}

// Errorf logs formatted message at error level.
func (h *Helper) Errorf(template string, args ...interface{}) {
	if !h.logger.Options().Level.Enabled(ErrorLevel) {
		return
	}
	h.logger.Logf(context.Background(), ErrorLevel, template, args...)
}

// Fatal logs arguments at fatal level and exits.
func (h *Helper) Fatal(args ...interface{}) {
	if !h.logger.Options().Level.Enabled(FatalLevel) {
		return
	}
	h.logger.Log(context.Background(), FatalLevel, args...)
	os.Exit(1)
}

// Fatalf logs formatted message at fatal level and exits.
func (h *Helper) Fatalf(template string, args ...interface{}) {
	if !h.logger.Options().Level.Enabled(FatalLevel) {
		return
	}
	h.logger.Logf(context.Background(), FatalLevel, template, args...)
	os.Exit(1)
}

// WithError returns a helper with error field.
func (h *Helper) WithError(err error) *Helper {
	return &Helper{logger: h.logger.Fields(map[string]interface{}{"error": err})}
}

// WithFields returns a helper with additional fields.
func (h *Helper) WithFields(fields map[string]interface{}) *Helper {
	return &Helper{logger: h.logger.Fields(fields)}
}

// HelperOrDefault returns h or DefaultHelper if h is nil.
func HelperOrDefault(h *Helper) *Helper {
	if h == nil {
		return DefaultHelper
	}
	return h
}
