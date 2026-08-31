package handler

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
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

func TestActiveMutationConflictPreservesTypedPayloadDetails(t *testing.T) {
	mapped := toHandlerError(errcode.NewActiveMutationConflict("agent-1", 4, 5))
	var handlerErr *server.HandlerError
	if !errors.As(mapped, &handlerErr) {
		t.Fatalf("expected HandlerError, got %T: %v", mapped, mapped)
	}
	expectedHeaders := map[string]string{
		"X-Peers-Error-Code":       string(errcode.AgentActiveMutationConflict),
		"X-Peers-Error-Locale-Key": errcode.AgentActiveMutationConflictLocaleKey,
		"X-Peers-Error-Retryable":  "true",
		"X-Peers-Error-Terminal":   "true",
	}
	for key, value := range expectedHeaders {
		if handlerErr.Headers[key] != value {
			t.Fatalf("%s=%q, want %q", key, handlerErr.Headers[key], value)
		}
	}

	var details map[string]string
	if err := json.Unmarshal([]byte(handlerErr.Headers[errorDetailsHeader]), &details); err != nil {
		t.Fatalf("decode %s: %v", errorDetailsHeader, err)
	}
	expectedDetails := map[string]string{
		"resource_id":       "agent-1",
		"expected_revision": "4",
		"actual_revision":   "5",
	}
	if !reflect.DeepEqual(details, expectedDetails) {
		t.Fatalf("details = %+v, want %+v", details, expectedDetails)
	}
}

func TestTypedErrorDetailsHeaderRejectsOversizedPayload(t *testing.T) {
	bizErr := errcode.New(errcode.AgentInvalidRequest, 400, "oversized", nil)
	bizErr.Payload = &model.ErrorPayload{
		ErrorType: "TEST_ERROR",
		LocaleKey: "agent.errors.test",
		Details: map[string]string{
			"resource_id": strings.Repeat("x", maxErrorDetailsHeaderBytes),
		},
	}

	mapped := toHandlerError(bizErr)
	var handlerErr *server.HandlerError
	if !errors.As(mapped, &handlerErr) {
		t.Fatalf("expected HandlerError, got %T: %v", mapped, mapped)
	}
	if _, exists := handlerErr.Headers[errorDetailsHeader]; exists {
		t.Fatalf("%s must be omitted when payload exceeds %d bytes", errorDetailsHeader, maxErrorDetailsHeaderBytes)
	}
	if handlerErr.Headers["X-Peers-Error-Code"] != "TEST_ERROR" {
		t.Fatalf("existing typed headers changed: %+v", handlerErr.Headers)
	}
}
