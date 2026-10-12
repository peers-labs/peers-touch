package ingest

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	botmodel "github.com/peers-labs/peers-touch/station/app/subserver/bot/model"
)

// Typed edge error codes. The HTTP adapter maps these to status codes while
// the application layer stays transport-free.
const (
	CodeUnauthenticated = "BOT_UNAUTHENTICATED"
	CodeInvalidRequest  = "BOT_INVALID_REQUEST"
	CodeRateLimited     = "BOT_RATE_LIMITED"
	CodeDeliveryFailed  = "BOT_DELIVERY_FAILED"
)

// Service orchestrates public webhook ingestion: authentication, rate
// limiting, normalization, idempotent delivery. It never derives actor or
// recipient from the request body — attribution comes from the registry.
type Service struct {
	authenticator Authenticator
	limiter       RateLimiter
	sink          DeliverySink
	clock         Clock
}

// NewService constructs the ingestion application service.
func NewService(
	authenticator Authenticator,
	limiter RateLimiter,
	sink DeliverySink,
	clock Clock,
) (*Service, error) {
	if authenticator == nil {
		return nil, domain.NewError(domain.CodeInvalidArgument, "authenticator is required")
	}
	if limiter == nil {
		return nil, domain.NewError(domain.CodeInvalidArgument, "rate limiter is required")
	}
	if sink == nil {
		return nil, domain.NewError(domain.CodeInvalidArgument, "delivery sink is required")
	}
	if clock == nil {
		clock = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		authenticator: authenticator,
		limiter:       limiter,
		sink:          sink,
		clock:         clock,
	}, nil
}

// EdgeError is a transport-mappable application error carrying a stable code.
type EdgeError struct {
	Code       string
	RetryAfter int // seconds, only for rate limiting
}

func (e *EdgeError) Error() string { return e.Code }

// Ingest authenticates and delivers one public webhook event.
//
// Ordering matters: authentication precedes any semantic response (BOT-A10
// indistinguishability); rate limiting precedes delivery; the sink owns the
// transactional idempotency record so a failed admission is retryable and a
// committed replay never duplicates products (BOT-A13).
func (s *Service) Ingest(
	ctx context.Context,
	webhookID string,
	secret string,
	ip string,
	req *botmodel.IngestWebhookEventRequest,
) (Result, error) {
	bot, ok := s.authenticator.AuthenticateWebhook(ctx, webhookID, secret)
	if !ok || bot == nil {
		return Result{}, &EdgeError{Code: CodeUnauthenticated}
	}
	now := s.clock()
	decision := s.limiter.Allow(ctx, bot.BotPtid, ip, int(bot.RateLimitPerMin), now)
	if !decision.Allowed {
		retryAfter := int(decision.RetryAfter.Seconds())
		if retryAfter < 1 {
			retryAfter = 1
		}
		return Result{}, &EdgeError{Code: CodeRateLimited, RetryAfter: retryAfter}
	}
	event, err := NormalizeRequest(req)
	if err != nil {
		return Result{}, &EdgeError{Code: CodeInvalidRequest}
	}
	eventID, replayed, err := s.sink.Deliver(ctx, DeliverCommand{
		RequestID: event.RequestID,
		Bot:       bot,
		Event:     event,
		Now:       now,
	})
	if err != nil {
		return Result{}, &EdgeError{Code: CodeDeliveryFailed}
	}
	if eventID == "" {
		return Result{}, &EdgeError{Code: CodeDeliveryFailed}
	}
	outcome := OutcomeAccepted
	if replayed {
		outcome = OutcomeDeduplicated
	}
	return Result{Outcome: outcome, EventID: eventID}, nil
}
