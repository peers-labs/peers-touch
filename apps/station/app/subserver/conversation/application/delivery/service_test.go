package delivery_test

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

type repositorySpy struct {
	claimCalls  int
	rejectCalls int
	reject      delivery.RejectRequest
}

func (s *repositorySpy) Enqueue(
	_ context.Context,
	_ delivery.EnqueueRequest,
) (delivery.Item, error) {
	return delivery.Item{}, nil
}

func (s *repositorySpy) Claim(
	_ context.Context,
	_ delivery.ClaimRequest,
) (delivery.ClaimResult, error) {
	s.claimCalls++

	return delivery.ClaimResult{}, nil
}

func (s *repositorySpy) Acknowledge(
	_ context.Context,
	_ delivery.AcknowledgeRequest,
) (int64, error) {
	return 0, nil
}

func (s *repositorySpy) Reject(
	_ context.Context,
	request delivery.RejectRequest,
) (delivery.RejectResult, error) {
	s.rejectCalls++
	s.reject = request

	return delivery.RejectResult{}, nil
}

func (s *repositorySpy) Stats(
	_ context.Context,
	_ valueobject.Endpoint,
) (delivery.QueueStats, error) {
	return delivery.QueueStats{}, nil
}

type deviceAccessStub struct {
	active bool
}

func (s deviceAccessStub) IsActive(
	_ context.Context,
	_ valueobject.Endpoint,
) (bool, error) {
	return s.active, nil
}

type fixedClock struct {
	now time.Time
}

func (c fixedClock) Now() time.Time {
	return c.now
}

func testPolicy() delivery.Policy {
	return delivery.Policy{
		LeaseDuration:  time.Minute,
		MaxBatchSize:   10,
		MaxAttempts:    3,
		BaseRetryDelay: time.Second,
		MaxRetryDelay:  time.Minute,
	}
}

func TestServiceRejectsInactiveDeviceBeforeRepositoryMutation(t *testing.T) {
	repository := &repositorySpy{}
	service, err := delivery.NewService(
		repository,
		deviceAccessStub{active: false},
		testPolicy(),
		fixedClock{now: time.Now()},
	)
	if err != nil {
		t.Fatal(err)
	}

	_, err = service.Claim(
		context.Background(),
		valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-device"},
		"consumer-a",
		0,
		0,
		1,
	)
	if !delivery.IsCode(err, delivery.ErrorCodeUnauthorized) {
		t.Fatalf("inactive device error = %v", err)
	}
	if repository.claimCalls != 0 {
		t.Fatalf("inactive device reached repository %d times", repository.claimCalls)
	}
}

func TestServiceOwnsCanonicalRejectRetryability(t *testing.T) {
	repository := &repositorySpy{}
	now := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	service, err := delivery.NewService(
		repository,
		deviceAccessStub{active: true},
		testPolicy(),
		fixedClock{now: now},
	)
	if err != nil {
		t.Fatal(err)
	}
	recipient := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-device"}

	if _, err := service.Reject(context.Background(), delivery.RejectRequest{
		Recipient:     recipient,
		ItemID:        "item-1",
		LaneSequence:  1,
		ConsumerEpoch: 1,
		Code:          delivery.RejectCodeCryptoStateUnavailable,
	}); err != nil {
		t.Fatal(err)
	}
	if !repository.reject.Retryable ||
		repository.reject.MaxAttempts != testPolicy().MaxAttempts ||
		repository.reject.Now != now {
		t.Fatalf("retryable policy = %+v", repository.reject)
	}

	if _, err := service.Reject(context.Background(), delivery.RejectRequest{
		Recipient:     recipient,
		ItemID:        "item-1",
		LaneSequence:  1,
		ConsumerEpoch: 1,
		Code:          delivery.RejectCodeIntegrityFailed,
	}); err != nil {
		t.Fatal(err)
	}
	if repository.reject.Retryable {
		t.Fatalf("integrity failure was marked retryable: %+v", repository.reject)
	}
}

func TestServiceRejectsUnboundedPolicy(t *testing.T) {
	repository := &repositorySpy{}
	policy := testPolicy()
	policy.MaxBatchSize = delivery.MaximumClaimBatchSize + 1

	if _, err := delivery.NewService(
		repository,
		deviceAccessStub{active: true},
		policy,
		fixedClock{now: time.Now()},
	); !delivery.IsCode(err, delivery.ErrorCodeInvalidArgument) {
		t.Fatalf("unbounded policy error = %v", err)
	}
}
