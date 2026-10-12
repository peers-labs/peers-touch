package ingest

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
)

// Outcome reports the ingestion result to the edge.
type Outcome int

const (
	OutcomeUnspecified Outcome = iota
	OutcomeAccepted
	OutcomeDeduplicated
)

// Result is the application-level ingestion result.
type Result struct {
	Outcome Outcome
	EventID string
}

// Authenticator resolves a public webhook id and verifies its Bearer secret.
// Unknown ids, revoked/disabled bots, and wrong secrets all collapse to an
// unauthenticated result so the edge cannot distinguish them (BOT-A10).
type Authenticator interface {
	AuthenticateWebhook(ctx context.Context, webhookID, presentedSecret string) (*domain.Bot, bool)
}

// RateDecision reports whether a request is admitted and, when denied, the
// minimum time the caller should wait.
type RateDecision struct {
	Allowed    bool
	RetryAfter time.Duration
}

// RateLimiter enforces a per-Bot token bucket plus a per-IP overflow bucket.
type RateLimiter interface {
	Allow(ctx context.Context, botPtid, ip string, perMinute int, now time.Time) RateDecision
}

// DeliverCommand is the fully authorized, normalized, deduplicated delivery
// instruction handed to the dual-product sink.
type DeliverCommand struct {
	RequestID   string
	Bot         *domain.Bot
	Event       domain.IncomingEvent
	PayloadHash [32]byte
	Now         time.Time
}

// DeliverySink performs the dual-product effect in one transaction: one
// direct-conversation service-plaintext message and at most one notification
// row, plus the idempotency record. Replaying the same request id within the
// window returns the original event id with replayed=true and never
// duplicates products.
type DeliverySink interface {
	Deliver(ctx context.Context, command DeliverCommand) (eventID string, replayed bool, err error)
}

// Clock supplies wall time, injectable for tests.
type Clock func() time.Time
