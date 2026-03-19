package auth

import (
	"context"
)

// contextKey is a private type for context keys to avoid collisions
type contextKey string

const (
	subjectKey contextKey = "auth:subject"
)

// WithSubject adds a subject to the context
func WithSubject(ctx context.Context, subject *Subject) context.Context {
	return context.WithValue(ctx, subjectKey, subject)
}

// GetSubject retrieves the subject from the context
// Returns nil if no subject is found
func GetSubject(ctx context.Context) *Subject {
	if subject, ok := ctx.Value(subjectKey).(*Subject); ok {
		return subject
	}
	return nil
}

// MustGetSubject retrieves the subject from the context
// Panics if no subject is found (should only be used after auth middleware)
func MustGetSubject(ctx context.Context) *Subject {
	subject := GetSubject(ctx)
	if subject == nil {
		panic("auth: no subject found in context")
	}
	return subject
}

// HasSubject checks if a subject exists in the context
func HasSubject(ctx context.Context) bool {
	return GetSubject(ctx) != nil
}
