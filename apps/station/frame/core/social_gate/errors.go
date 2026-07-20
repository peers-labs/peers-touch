package social_gate

import "fmt"

// PolicyDeniedError indicates the gate rejected an operation due to a
// social-layer policy violation (relationship, role, block, mute, trust).
type PolicyDeniedError struct {
	// Code is a machine-readable denial reason.
	// Known values: "RELATIONSHIP_REQUIRED", "BLOCKED",
	// "INSUFFICIENT_ROLE", "MUTED", "UNTRUSTED_STATION".
	Code string

	// Reason is a human-readable explanation suitable for logs and debugging.
	Reason string
}

func (e *PolicyDeniedError) Error() string {
	return fmt.Sprintf("social gate denied: %s (%s)", e.Code, e.Reason)
}

// RateLimitedError indicates the operation was rejected due to rate limiting.
// The caller should wait RetryAfterSec seconds before retrying.
type RateLimitedError struct {
	RetryAfterSec int
}

func (e *RateLimitedError) Error() string {
	return fmt.Sprintf("rate limited: retry after %ds", e.RetryAfterSec)
}
