package logrus

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/logger/logrus/logrus"
)

func TestRequestIDHook_Levels(t *testing.T) {
	hook := &RequestIDHook{}
	levels := hook.Levels()

	if len(levels) != len(logrus.AllLevels) {
		t.Errorf("expected %d levels, got %d", len(logrus.AllLevels), len(levels))
	}
}

func TestRequestIDHook_Fire_WithRequestID(t *testing.T) {
	hook := &RequestIDHook{}
	ctx := logger.WithRequestID(context.Background(), "req-test-123")

	entry := &logrus.Entry{
		Context: ctx,
		Data:    make(logrus.Fields),
	}

	err := hook.Fire(entry)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	if entry.Data["request_id"] != "req-test-123" {
		t.Errorf("expected request_id=req-test-123, got %v", entry.Data["request_id"])
	}
}

func TestRequestIDHook_Fire_WithTraceID(t *testing.T) {
	hook := &RequestIDHook{}
	ctx := logger.WithTraceID(context.Background(), "trace-xyz-789")

	entry := &logrus.Entry{
		Context: ctx,
		Data:    make(logrus.Fields),
	}

	err := hook.Fire(entry)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	if entry.Data["trace_id"] != "trace-xyz-789" {
		t.Errorf("expected trace_id=trace-xyz-789, got %v", entry.Data["trace_id"])
	}
}

func TestRequestIDHook_Fire_WithBothIDs(t *testing.T) {
	hook := &RequestIDHook{}
	ctx := context.Background()
	ctx = logger.WithRequestID(ctx, "req-456")
	ctx = logger.WithTraceID(ctx, "trace-789")

	entry := &logrus.Entry{
		Context: ctx,
		Data:    make(logrus.Fields),
	}

	err := hook.Fire(entry)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	if entry.Data["request_id"] != "req-456" {
		t.Errorf("expected request_id=req-456, got %v", entry.Data["request_id"])
	}
	if entry.Data["trace_id"] != "trace-789" {
		t.Errorf("expected trace_id=trace-789, got %v", entry.Data["trace_id"])
	}
}

func TestRequestIDHook_Fire_NoContext(t *testing.T) {
	hook := &RequestIDHook{}
	entry := &logrus.Entry{
		Context: nil,
		Data:    make(logrus.Fields),
	}

	err := hook.Fire(entry)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	if _, exists := entry.Data["request_id"]; exists {
		t.Errorf("request_id should not exist when context is nil")
	}
}

func TestRequestIDHook_Fire_EmptyContext(t *testing.T) {
	hook := &RequestIDHook{}
	entry := &logrus.Entry{
		Context: context.Background(),
		Data:    make(logrus.Fields),
	}

	err := hook.Fire(entry)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	if _, exists := entry.Data["request_id"]; exists {
		t.Errorf("request_id should not exist when not set in context")
	}
}
