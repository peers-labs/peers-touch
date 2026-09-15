package handler

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

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

func TestToolHandlerErrorPreservesClientLeaseExpiredHeaders(t *testing.T) {
	expiredAt := time.Date(2026, time.September, 15, 3, 0, 0, 123, time.UTC)
	mapped := toolHandlerError(errcode.NewClientLeaseExpired(
		"capability-session-1",
		"capability-lease-1",
		expiredAt,
	))
	var handlerErr *server.HandlerError
	if !errors.As(mapped, &handlerErr) {
		t.Fatalf("expected HandlerError, got %T: %v", mapped, mapped)
	}
	if handlerErr.Code != http.StatusConflict {
		t.Fatalf("status=%d, want %d", handlerErr.Code, http.StatusConflict)
	}
	expectedHeaders := map[string]string{
		"X-Peers-Error-Code":       string(errcode.AgentClientLeaseExpired),
		"X-Peers-Error-Locale-Key": errcode.AgentClientLeaseExpiredLocaleKey,
		"X-Peers-Error-Retryable":  "true",
		"X-Peers-Error-Terminal":   "false",
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
		"session_id": "capability-session-1",
		"lease_id":   "capability-lease-1",
		"expired_at": expiredAt.Format(time.RFC3339Nano),
	}
	if !reflect.DeepEqual(details, expectedDetails) {
		t.Fatalf("details = %+v, want %+v", details, expectedDetails)
	}
}

func TestAdmissionDuplicateConflictPreservesTypedPayloadDetails(t *testing.T) {
	mapped := toHandlerError(
		errcode.NewAdmissionDuplicateConflict("request-1", "turn-1"),
	)
	var handlerErr *server.HandlerError
	if !errors.As(mapped, &handlerErr) {
		t.Fatalf("expected HandlerError, got %T: %v", mapped, mapped)
	}
	expectedHeaders := map[string]string{
		"X-Peers-Error-Code":       string(errcode.AgentAdmissionDuplicateConflict),
		"X-Peers-Error-Locale-Key": errcode.AgentAdmissionDuplicateConflictLocaleKey,
		"X-Peers-Error-Retryable":  "false",
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
		"idempotency_key_hash": fmt.Sprintf(
			"%x",
			sha256.Sum256([]byte("request-1")),
		),
		"existing_command_id": "turn-1",
	}
	if !reflect.DeepEqual(details, expectedDetails) {
		t.Fatalf("details = %+v, want %+v", details, expectedDetails)
	}
}

func TestForbiddenActorPreservesTypedPayloadDetails(t *testing.T) {
	mapped := toHandlerError(
		errcode.NewOwnershipForbiddenActor("conversation", "conversation-1"),
	)
	var handlerErr *server.HandlerError
	if !errors.As(mapped, &handlerErr) {
		t.Fatalf("expected HandlerError, got %T: %v", mapped, mapped)
	}
	if handlerErr.Code != http.StatusForbidden {
		t.Fatalf("status=%d, want %d", handlerErr.Code, http.StatusForbidden)
	}
	expectedHeaders := map[string]string{
		"X-Peers-Error-Code":       string(errcode.AgentOwnershipForbiddenActor),
		"X-Peers-Error-Locale-Key": errcode.AgentOwnershipForbiddenActorLocaleKey,
		"X-Peers-Error-Retryable":  "false",
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
		"resource_kind": "conversation",
		"resource_id":   "conversation-1",
	}
	if !reflect.DeepEqual(details, expectedDetails) {
		t.Fatalf("details = %+v, want %+v", details, expectedDetails)
	}
}

func TestQueueFullPreservesTypedPayloadDetails(t *testing.T) {
	mapped := toHandlerError(errcode.NewQueueFull("conversation-1", 8))
	var handlerErr *server.HandlerError
	if !errors.As(mapped, &handlerErr) {
		t.Fatalf("expected HandlerError, got %T: %v", mapped, mapped)
	}
	if handlerErr.Code != http.StatusTooManyRequests {
		t.Fatalf("status=%d, want %d", handlerErr.Code, http.StatusTooManyRequests)
	}
	expectedHeaders := map[string]string{
		"X-Peers-Error-Code":       string(errcode.AgentQueueFull),
		"X-Peers-Error-Locale-Key": errcode.AgentQueueFullLocaleKey,
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
		"conversation_id": "conversation-1",
		"capacity":        "8",
	}
	if !reflect.DeepEqual(details, expectedDetails) {
		t.Fatalf("details = %+v, want %+v", details, expectedDetails)
	}
}

func TestRuntimeUnavailablePreservesTypedPayloadDetails(t *testing.T) {
	mapped := toHandlerError(
		errcode.NewRuntimeUnavailable("direct_model", "provider_disabled"),
	)
	var handlerErr *server.HandlerError
	if !errors.As(mapped, &handlerErr) {
		t.Fatalf("expected HandlerError, got %T: %v", mapped, mapped)
	}
	if handlerErr.Code != http.StatusServiceUnavailable {
		t.Fatalf(
			"status=%d, want %d",
			handlerErr.Code,
			http.StatusServiceUnavailable,
		)
	}
	expectedHeaders := map[string]string{
		"X-Peers-Error-Code":       string(errcode.AgentRuntimeUnavailable),
		"X-Peers-Error-Locale-Key": errcode.AgentRuntimeUnavailableLocaleKey,
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
		"runtime_kind": "direct_model",
		"reason_code":  "provider_disabled",
	}
	if !reflect.DeepEqual(details, expectedDetails) {
		t.Fatalf("details = %+v, want %+v", details, expectedDetails)
	}
}

func TestProviderRateLimitPreservesTypedPayloadDetails(t *testing.T) {
	mapped := toHandlerError(
		errcode.NewProviderRateLimit("provider-1", 2000),
	)
	var handlerErr *server.HandlerError
	if !errors.As(mapped, &handlerErr) {
		t.Fatalf("expected HandlerError, got %T: %v", mapped, mapped)
	}
	if handlerErr.Code != http.StatusTooManyRequests {
		t.Fatalf(
			"status=%d, want %d",
			handlerErr.Code,
			http.StatusTooManyRequests,
		)
	}
	expectedHeaders := map[string]string{
		"X-Peers-Error-Code":       string(errcode.AgentProviderRateLimit),
		"X-Peers-Error-Locale-Key": errcode.AgentProviderRateLimitLocaleKey,
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
		"provider_id":    "provider-1",
		"retry_after_ms": "2000",
	}
	if !reflect.DeepEqual(details, expectedDetails) {
		t.Fatalf("details = %+v, want %+v", details, expectedDetails)
	}
}

func TestRuntimeIncompatibleCapabilityPreservesTypedPayloadDetails(t *testing.T) {
	mapped := toHandlerError(
		errcode.NewRuntimeIncompatibleCapability(
			"tool:skills_list",
			"runtime_capability_unavailable",
		),
	)
	var handlerErr *server.HandlerError
	if !errors.As(mapped, &handlerErr) {
		t.Fatalf("expected HandlerError, got %T: %v", mapped, mapped)
	}
	if handlerErr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d, want %d", handlerErr.Code, http.StatusUnprocessableEntity)
	}
	expectedHeaders := map[string]string{
		"X-Peers-Error-Code":       string(errcode.AgentRuntimeIncompatibleCapability),
		"X-Peers-Error-Locale-Key": errcode.AgentRuntimeIncompatibleCapabilityLocaleKey,
		"X-Peers-Error-Retryable":  "false",
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
		"capability_id": "tool:skills_list",
		"reason_code":   "runtime_capability_unavailable",
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
