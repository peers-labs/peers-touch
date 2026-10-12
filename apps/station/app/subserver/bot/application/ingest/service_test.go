package ingest

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	botmodel "github.com/peers-labs/peers-touch/station/app/subserver/bot/model"
)

type fakeAuthenticator struct {
	bot *domain.Bot
	ok  bool
}

func (f fakeAuthenticator) AuthenticateWebhook(
	_ context.Context,
	_, _ string,
) (*domain.Bot, bool) {
	return f.bot, f.ok
}

type fakeLimiter struct {
	deny bool
}

func (f fakeLimiter) Allow(
	_ context.Context,
	_, _ string,
	_ int,
	_ time.Time,
) RateDecision {
	if f.deny {
		return RateDecision{Allowed: false, RetryAfter: 3 * time.Second}
	}
	return RateDecision{Allowed: true}
}

type fakeSink struct {
	calls   int
	replay  bool
	fail    bool
	lastCmd DeliverCommand
}

func (f *fakeSink) Deliver(
	_ context.Context,
	command DeliverCommand,
) (string, bool, error) {
	f.calls++
	f.lastCmd = command
	if f.fail {
		return "", false, errors.New("delivery boom")
	}
	return "evt-1", f.replay, nil
}

func activeBot() *domain.Bot {
	return &domain.Bot{
		BotPtid:         "ptid:bot",
		OwnerPtid:       "ptid:owner",
		State:           domain.StateActive,
		RateLimitPerMin: domain.DefaultRateLimitPerMinute,
	}
}

func validRequest() *botmodel.IngestWebhookEventRequest {
	return &botmodel.IngestWebhookEventRequest{
		SchemaVersion: "1",
		RequestId:     "req-1",
		EventType:     botmodel.BotEventType_BOT_EVENT_TYPE_TASK_COMPLETED,
		Severity:      botmodel.BotEventSeverity_BOT_EVENT_SEVERITY_ATTENTION,
		Title:         "Build finished",
		Source: &botmodel.WebhookSource{
			Agent:     "claude-code",
			Workspace: "peers-touch",
			Labels:    map[string]string{"repo": "peers-touch"},
		},
	}
}

func newTestService(auth Authenticator, limiter RateLimiter, sink DeliverySink) *Service {
	clock := func() time.Time {
		return time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	}
	svc, err := NewService(auth, limiter, sink, clock)
	if err != nil {
		panic(err)
	}
	return svc
}

func edgeCode(t *testing.T, err error) string {
	t.Helper()
	var edge *EdgeError
	if !errors.As(err, &edge) {
		t.Fatalf("error %v is not *EdgeError", err)
	}
	return edge.Code
}

func TestIngestAcceptedAndDelegatesAttribution(t *testing.T) {
	sink := &fakeSink{}
	svc := newTestService(fakeAuthenticator{bot: activeBot(), ok: true}, fakeLimiter{}, sink)

	result, err := svc.Ingest(context.Background(), "wh_1", "ptsec_secret", "1.2.3.4", validRequest())
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if result.Outcome != OutcomeAccepted || result.EventID != "evt-1" {
		t.Fatalf("result = %+v, want accepted evt-1", result)
	}
	if sink.calls != 1 {
		t.Fatalf("sink calls = %d, want 1", sink.calls)
	}
	if sink.lastCmd.Bot.OwnerPtid != "ptid:owner" {
		t.Fatalf("attribution not derived from registry: %+v", sink.lastCmd.Bot)
	}
	if sink.lastCmd.Event.Kind != domain.KindTaskCompleted ||
		sink.lastCmd.Event.Severity != domain.SeverityAttention {
		t.Fatalf("normalized event = %+v", sink.lastCmd.Event)
	}
	if sink.lastCmd.Event.Source.Labels["repo"] != "peers-touch" {
		t.Fatalf("source labels lost: %+v", sink.lastCmd.Event.Source.Labels)
	}
}

func TestIngestDeduplicatedOutcome(t *testing.T) {
	sink := &fakeSink{replay: true}
	svc := newTestService(fakeAuthenticator{bot: activeBot(), ok: true}, fakeLimiter{}, sink)

	result, err := svc.Ingest(context.Background(), "wh_1", "ptsec_secret", "ip", validRequest())
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if result.Outcome != OutcomeDeduplicated || result.EventID != "evt-1" {
		t.Fatalf("result = %+v, want deduplicated evt-1", result)
	}
}

func TestIngestAuthenticationPrecedesEverything(t *testing.T) {
	sink := &fakeSink{}
	svc := newTestService(fakeAuthenticator{ok: false}, fakeLimiter{}, sink)

	_, err := svc.Ingest(context.Background(), "wh_missing", "wrong", "ip", validRequest())
	if edgeCode(t, err) != CodeUnauthenticated {
		t.Fatalf("code = %v, want unauthenticated", err)
	}
	if sink.calls != 0 {
		t.Fatal("authenticated path must never reach the sink")
	}
}

func TestIngestRateLimitedWithRetryAfter(t *testing.T) {
	sink := &fakeSink{}
	svc := newTestService(
		fakeAuthenticator{bot: activeBot(), ok: true},
		fakeLimiter{deny: true},
		sink,
	)

	_, err := svc.Ingest(context.Background(), "wh_1", "ptsec_secret", "ip", validRequest())
	var edge *EdgeError
	if !errors.As(err, &edge) || edge.Code != CodeRateLimited || edge.RetryAfter != 3 {
		t.Fatalf("err = %v, want rate limited retry-after 3", err)
	}
	if sink.calls != 0 {
		t.Fatal("rate-limited request must not reach the sink")
	}
}

func TestIngestRejectsInvalidRequestBeforeSink(t *testing.T) {
	sink := &fakeSink{}
	svc := newTestService(fakeAuthenticator{bot: activeBot(), ok: true}, fakeLimiter{}, sink)

	req := validRequest()
	req.RequestId = ""
	_, err := svc.Ingest(context.Background(), "wh_1", "ptsec_secret", "ip", req)
	if edgeCode(t, err) != CodeInvalidRequest {
		t.Fatalf("code = %v, want invalid request", err)
	}
	if sink.calls != 0 {
		t.Fatal("invalid request must not reach the sink")
	}
}

func TestIngestMapsSinkFailure(t *testing.T) {
	svc := newTestService(
		fakeAuthenticator{bot: activeBot(), ok: true},
		fakeLimiter{},
		&fakeSink{fail: true},
	)

	_, err := svc.Ingest(context.Background(), "wh_1", "ptsec_secret", "ip", validRequest())
	if edgeCode(t, err) != CodeDeliveryFailed {
		t.Fatalf("code = %v, want delivery failed", err)
	}
}

func TestNewServiceRequiresDependencies(t *testing.T) {
	if _, err := NewService(nil, fakeLimiter{}, &fakeSink{}, nil); err == nil {
		t.Fatal("expected error for nil authenticator")
	}
	if _, err := NewService(fakeAuthenticator{}, nil, &fakeSink{}, nil); err == nil {
		t.Fatal("expected error for nil limiter")
	}
	if _, err := NewService(fakeAuthenticator{}, fakeLimiter{}, nil, nil); err == nil {
		t.Fatal("expected error for nil sink")
	}
}
