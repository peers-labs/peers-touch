package auth

import (
	"context"
	"sync"
	"time"
)

type Method string

const (
	MethodJWT         Method = "jwt"
	MethodOAuth2      Method = "oauth2"
	MethodConnections Method = "connections"
)

type Credentials struct {
	Scheme     string
	Token      string
	SubjectID  string
	SessionID  string
	Attributes map[string]string
}

type Subject struct {
	ID         string
	SessionID  string
	Attributes map[string]string
}

// SessionValidator checks whether a session is still valid (not revoked/expired).
// Implement this with the session store to enforce single-session per device.
type SessionValidator interface {
	CheckSessionValid(ctx context.Context, sessionID string) (bool, string)
}

var (
	globalSessionValidator SessionValidator
	svMu                   sync.RWMutex
)

// SetGlobalSessionValidator registers the application-wide SessionValidator.
// Call this during initialization (e.g. after session store is ready).
// All RequireJWT middlewares will automatically use it.
func SetGlobalSessionValidator(sv SessionValidator) {
	svMu.Lock()
	defer svMu.Unlock()
	globalSessionValidator = sv
}

// GetGlobalSessionValidator returns the registered SessionValidator, or nil.
func GetGlobalSessionValidator() SessionValidator {
	svMu.RLock()
	defer svMu.RUnlock()
	return globalSessionValidator
}

// CheckSubjectSessionValid applies the application-wide session validator to an
// authenticated subject. Long-lived transports and request middleware both use
// this path so revocation policy stays centralized.
func CheckSubjectSessionValid(ctx context.Context, subject *Subject) (bool, string) {
	if subject == nil || subject.SessionID == "" {
		return true, ""
	}

	validator := GetGlobalSessionValidator()
	if validator == nil {
		return true, ""
	}

	return validator.CheckSessionValid(ctx, subject.SessionID)
}

type Token struct {
	Value     string
	ExpiresAt time.Time
	Type      string
}
