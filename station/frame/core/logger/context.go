package logger

import "context"

// loggerKey is the context key used to store logger instances.
type loggerKey struct{}

// FromContext retrieves a Logger from context.
func FromContext(ctx context.Context) (Logger, bool) {
	l, ok := ctx.Value(loggerKey{}).(Logger)
	return l, ok
}

// NewContext stores a Logger into context.
func NewContext(ctx context.Context, l Logger) context.Context {
	return context.WithValue(ctx, loggerKey{}, l)
}
