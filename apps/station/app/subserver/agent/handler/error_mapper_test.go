package handler

import (
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestCanvasReadinessErrorPreservesTypedHeaders(t *testing.T) {
	mapped := toHandlerError(errcode.NewCanvasSingleAgentNotReady())
	var handlerErr *server.HandlerError
	if !errors.As(mapped, &handlerErr) {
		t.Fatalf("expected HandlerError, got %T: %v", mapped, mapped)
	}
	expected := map[string]string{
		"X-Peers-Error-Code":       string(errcode.AgentCanvasSingleAgentNotReady),
		"X-Peers-Error-Locale-Key": errcode.AgentCanvasSingleAgentNotReadyLocaleKey,
		"X-Peers-Error-Retryable":  "false",
		"X-Peers-Error-Terminal":   "true",
		"X-Peers-Required-Gate":    errcode.AgentCanvasSingleAgentNotReadyRequiredGate,
	}
	for key, value := range expected {
		if handlerErr.Headers[key] != value {
			t.Fatalf("%s=%q, want %q", key, handlerErr.Headers[key], value)
		}
	}
}
