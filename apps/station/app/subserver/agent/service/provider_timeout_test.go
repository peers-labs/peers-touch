package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

func TestProviderAttemptDeadlineCancelsUpstreamRequest(t *testing.T) {
	upstreamCancelled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(
		func(response http.ResponseWriter, request *http.Request) {
			response.Header().Set("Content-Type", "application/json")
			response.WriteHeader(http.StatusOK)
			if flusher, ok := response.(http.Flusher); ok {
				flusher.Flush()
			}
			<-request.Context().Done()
			close(upstreamCancelled)
		},
	))
	t.Cleanup(func() {
		server.CloseClientConnections()
		server.Close()
	})

	provider := NewProviderService(nil)
	provider.providerTimeout = 25 * time.Millisecond
	startedAt := time.Now()
	_, err := provider.callWithProviderDeadline(
		context.Background(),
		func(callCtx context.Context) (*ProviderCallResponse, error) {
			return provider.callOpenAI(
				callCtx,
				server.URL,
				"",
				"test-model",
				"",
				[]domain.Message{{
					Role:    domain.MessageRoleUser,
					Content: "wait for the provider deadline",
				}},
				"low",
				domain.ThinkingModeDisabled,
				32,
				nil,
				nil,
			)
		},
	)
	var timeoutErr *providerTimeoutError
	if !errors.As(err, &timeoutErr) {
		t.Fatalf("provider deadline error = %T %v", err, err)
	}
	if timeoutErr.Deadline.Before(startedAt) ||
		timeoutErr.Deadline.After(startedAt.Add(time.Second)) {
		t.Fatalf("provider deadline = %s, started_at = %s", timeoutErr.Deadline, startedAt)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("provider deadline lost context cause: %v", err)
	}
	select {
	case <-upstreamCancelled:
	case <-time.After(time.Second):
		t.Fatal("provider deadline did not cancel the upstream request")
	}
}

func TestProviderAttemptDeadlineDoesNotReclassifyParentCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	provider := NewProviderService(nil)

	_, err := provider.callWithProviderDeadline(
		ctx,
		func(callCtx context.Context) (*ProviderCallResponse, error) {
			return nil, callCtx.Err()
		},
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("parent cancellation = %v, want context canceled", err)
	}
	var timeoutErr *providerTimeoutError
	if errors.As(err, &timeoutErr) {
		t.Fatalf("parent cancellation was reclassified as provider timeout: %v", err)
	}
}
