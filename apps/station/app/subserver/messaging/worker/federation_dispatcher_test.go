package worker

import (
	"context"
	"testing"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type dispatcherRepository struct {
	claims       []messaging.FederationOutboxClaim
	delivered    []string
	retried      []string
	deadLettered []string
	retryAt      time.Time
}

func (r *dispatcherRepository) EnqueueFederationFrame(
	context.Context,
	*chat.MessagingFederationFrame,
	time.Time,
) error {
	return nil
}

func (r *dispatcherRepository) ClaimFederationFrames(
	context.Context,
	string,
	int,
	time.Time,
	time.Duration,
) ([]messaging.FederationOutboxClaim, error) {
	return r.claims, nil
}

func (r *dispatcherRepository) MarkFederationDelivered(
	_ context.Context,
	frameID string,
	_ string,
	_ uint64,
	_ time.Time,
) error {
	r.delivered = append(r.delivered, frameID)
	return nil
}

func (r *dispatcherRepository) ScheduleFederationRetry(
	_ context.Context,
	frameID string,
	_ string,
	_ uint64,
	nextAttemptAt time.Time,
	_ string,
) error {
	r.retried = append(r.retried, frameID)
	r.retryAt = nextAttemptAt
	return nil
}

func (r *dispatcherRepository) MarkFederationDeadLetter(
	_ context.Context,
	frameID string,
	_ string,
	_ uint64,
	_ string,
) error {
	r.deadLettered = append(r.deadLettered, frameID)
	return nil
}

type dispatcherTransport struct {
	results map[string]FederationDeliveryResult
}

func (t dispatcherTransport) Deliver(
	_ context.Context,
	frame *chat.MessagingFederationFrame,
) FederationDeliveryResult {
	return t.results[frame.FrameId]
}

func TestFederationDispatcherDeliversRetriesAndDeadLetters(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	repository := &dispatcherRepository{
		claims: []messaging.FederationOutboxClaim{
			{
				Frame:           &chat.MessagingFederationFrame{FrameId: "delivered"},
				LeaseGeneration: 1,
				AttemptCount:    1,
			},
			{
				Frame:           &chat.MessagingFederationFrame{FrameId: "retry"},
				LeaseGeneration: 1,
				AttemptCount:    2,
			},
			{
				Frame:           &chat.MessagingFederationFrame{FrameId: "terminal"},
				LeaseGeneration: 1,
				AttemptCount:    1,
			},
			{
				Frame:           &chat.MessagingFederationFrame{FrameId: "exhausted"},
				LeaseGeneration: 1,
				AttemptCount:    3,
			},
			{
				Frame: &chat.MessagingFederationFrame{
					FrameId:     "projection-exhausted",
					PayloadType: chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_FOLLOWER_PROJECTION,
				},
				LeaseGeneration: 1,
				AttemptCount:    3,
			},
			{
				Frame: &chat.MessagingFederationFrame{
					FrameId:     "device-gap-exhausted",
					PayloadType: chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_DEVICE_QUEUE_BATCH,
				},
				LeaseGeneration: 1,
				AttemptCount:    3,
			},
		},
	}
	dispatcher, err := NewFederationDispatcher(
		"dispatcher-1",
		repository,
		dispatcherTransport{results: map[string]FederationDeliveryResult{
			"delivered": {Delivered: true},
			"retry":     {Retryable: true, ErrorCode: "network"},
			"terminal":  {Retryable: false, ErrorCode: "invalid_frame"},
			"exhausted": {Retryable: true, ErrorCode: "network"},
			"projection-exhausted": {
				Retryable: true,
				ErrorCode: "network",
			},
			"device-gap-exhausted": {
				Retryable: true,
				ErrorCode: "http_503",
			},
		}},
		FederationDispatcherPolicy{
			BatchSize:     10,
			LeaseDuration: time.Minute,
			MaxAttempts:   3,
			BaseBackoff:   time.Second,
			MaxBackoff:    time.Minute,
		},
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}
	processed, err := dispatcher.DispatchOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if processed != 6 {
		t.Fatalf("processed = %d, want 6", processed)
	}
	if len(repository.delivered) != 1 || repository.delivered[0] != "delivered" {
		t.Fatalf("delivered = %v", repository.delivered)
	}
	if len(repository.retried) != 3 ||
		repository.retried[0] != "retry" ||
		repository.retried[1] != "projection-exhausted" ||
		repository.retried[2] != "device-gap-exhausted" {
		t.Fatalf("retried = %v", repository.retried)
	}
	if repository.retryAt != now.Add(4*time.Second) {
		t.Fatalf("retry at = %v, want %v", repository.retryAt, now.Add(4*time.Second))
	}
	if len(repository.deadLettered) != 2 {
		t.Fatalf("dead lettered = %v", repository.deadLettered)
	}
}

func TestFederationDispatcherRejectsUntypedFailure(t *testing.T) {
	repository := &dispatcherRepository{
		claims: []messaging.FederationOutboxClaim{{
			Frame:           &chat.MessagingFederationFrame{FrameId: "frame-1"},
			LeaseGeneration: 1,
			AttemptCount:    1,
		}},
	}
	dispatcher, err := NewFederationDispatcher(
		"dispatcher-1",
		repository,
		dispatcherTransport{results: map[string]FederationDeliveryResult{
			"frame-1": {},
		}},
		FederationDispatcherPolicy{
			BatchSize:     1,
			LeaseDuration: time.Minute,
			MaxAttempts:   3,
			BaseBackoff:   time.Second,
			MaxBackoff:    time.Minute,
		},
		time.Now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dispatcher.DispatchOnce(context.Background()); err == nil {
		t.Fatal("untyped transport failure was accepted")
	}
	if len(repository.retried)+len(repository.deadLettered)+len(repository.delivered) != 0 {
		t.Fatal("untyped failure mutated outbox state")
	}
}
