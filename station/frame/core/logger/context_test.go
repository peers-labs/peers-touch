package logger

import (
	"context"
	"testing"
)

func TestRequestIDContext(t *testing.T) {
	ctx := context.Background()
	requestID := "req-12345"

	ctx = WithRequestID(ctx, requestID)

	got := GetRequestID(ctx)
	if got != requestID {
		t.Errorf("expected %s, got %s", requestID, got)
	}
}

func TestTraceIDContext(t *testing.T) {
	ctx := context.Background()
	traceID := "trace-67890"

	ctx = WithTraceID(ctx, traceID)

	got := GetTraceID(ctx)
	if got != traceID {
		t.Errorf("expected %s, got %s", traceID, got)
	}
}

func TestRequestIDEmpty(t *testing.T) {
	ctx := context.Background()

	got := GetRequestID(ctx)
	if got != "" {
		t.Errorf("expected empty string, got %s", got)
	}
}

func TestRequestIDInLog(t *testing.T) {
	ctx := context.Background()
	ctx = WithRequestID(ctx, "req-test")

	reqID := GetRequestID(ctx)
	if reqID != "req-test" {
		t.Errorf("expected req-test, got %s", reqID)
	}
}

func TestMultipleIDsInContext(t *testing.T) {
	ctx := context.Background()
	requestID := "req-abc"
	traceID := "trace-xyz"

	ctx = WithRequestID(ctx, requestID)
	ctx = WithTraceID(ctx, traceID)

	gotReq := GetRequestID(ctx)
	gotTrace := GetTraceID(ctx)

	if gotReq != requestID {
		t.Errorf("expected request_id %s, got %s", requestID, gotReq)
	}
	if gotTrace != traceID {
		t.Errorf("expected trace_id %s, got %s", traceID, gotTrace)
	}
}
