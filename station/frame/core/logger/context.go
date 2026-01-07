package logger

import "context"

// loggerKey is the context key used to store logger instances.
type loggerKey struct{}
type requestIDKey struct{}
type traceIDKey struct{}

// FromContext retrieves a Logger from context.
func FromContext(ctx context.Context) (Logger, bool) {
	l, ok := ctx.Value(loggerKey{}).(Logger)
	return l, ok
}

// NewContext stores a Logger into context.
func NewContext(ctx context.Context, l Logger) context.Context {
	return context.WithValue(ctx, loggerKey{}, l)
}

func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, requestID)
}

func GetRequestID(ctx context.Context) string {
	if id, ok := ctx.Value(requestIDKey{}).(string); ok {
		return id
	}
	return ""
}

func WithTraceID(ctx context.Context, traceID string) context.Context {
	return context.WithValue(ctx, traceIDKey{}, traceID)
}

func GetTraceID(ctx context.Context) string {
	if id, ok := ctx.Value(traceIDKey{}).(string); ok {
		return id
	}
	return ""
}
