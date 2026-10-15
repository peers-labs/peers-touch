package service

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestMaintainChatStepLeaseRenewsUntilStopped(t *testing.T) {
	renewed := make(chan struct{}, 1)
	var calls atomic.Int64
	leaseContext, stop := maintainChatStepLease(
		context.Background(),
		time.Millisecond,
		func(context.Context) error {
			calls.Add(1)
			select {
			case renewed <- struct{}{}:
			default:
			}
			return nil
		},
	)

	select {
	case <-renewed:
	case <-time.After(time.Second):
		t.Fatal("lease maintenance did not renew")
	}
	stop()
	stoppedAt := calls.Load()
	time.Sleep(5 * time.Millisecond)
	if calls.Load() != stoppedAt {
		t.Fatalf("lease renewed after stop: before=%d after=%d", stoppedAt, calls.Load())
	}
	if err := context.Cause(leaseContext); err != nil {
		t.Fatalf("successful lease maintenance cancelled execution: %v", err)
	}
}

func TestMaintainChatStepLeaseCancelsExecutionOnRenewFailure(t *testing.T) {
	renewErr := errors.New("stale fencing token")
	leaseContext, stop := maintainChatStepLease(
		context.Background(),
		time.Millisecond,
		func(context.Context) error { return renewErr },
	)
	defer stop()

	select {
	case <-leaseContext.Done():
	case <-time.After(time.Second):
		t.Fatal("lease renewal failure did not cancel execution")
	}
	cause := context.Cause(leaseContext)
	if cause == nil ||
		!errors.Is(cause, renewErr) ||
		!strings.Contains(cause.Error(), "chat executor lease renewal failed") {
		t.Fatalf("unexpected lease cancellation cause: %v", cause)
	}
}
