package conversation

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestConversationMemberAuthorityRoutesAreTypedCanonicalPOSTs(t *testing.T) {
	identityWrapper := func(next server.EndpointHandler) server.EndpointHandler {
		return next
	}
	subserver := &subServer{
		composition: &ProductionComposition{},
		jwtWrapper:  identityWrapper,
	}
	handlers := subserver.Handlers()
	expected := map[string]string{
		"/conversation/member/update":      "conversation-member-update",
		"/conversation/ownership/transfer": "conversation-ownership-transfer",
	}
	for path, name := range expected {
		var matched server.Handler
		for _, handler := range handlers {
			if handler.Path() == path {
				matched = handler
				break
			}
		}
		if matched == nil {
			t.Fatalf("canonical handler %q is missing", path)
		}
		if matched.Name() != name ||
			matched.Method() != server.POST ||
			matched.Handler() == nil ||
			len(matched.Wrappers()) != 3 {
			t.Fatalf("handler %q = %#v", path, matched)
		}
	}
}

func TestMapProductionConversationErrorMapsMemberAuthorityFailures(t *testing.T) {
	tests := []struct {
		name string
		code conversationdomain.ErrorCode
		want int
	}{
		{"permission", conversationdomain.ErrorCodeUnauthorized, http.StatusForbidden},
		{"muted", conversationdomain.ErrorCodeMemberMuted, http.StatusForbidden},
		{"target not member", conversationdomain.ErrorCodeTargetNotMember, http.StatusNotFound},
		{"owner protected", conversationdomain.ErrorCodeOwnerProtected, http.StatusConflict},
		{"expired", conversationdomain.ErrorCodeCommandExpired, http.StatusConflict},
		{"stale head", conversationdomain.ErrorCodeStaleAuthorityHead, http.StatusConflict},
		{"command conflict", conversationdomain.ErrorCodeCommandConflict, http.StatusConflict},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cause := conversationdomain.NewError(
				test.code,
				"member_authority.test",
				"command",
				"failed",
			)
			mapped := mapProductionConversationError(context.Background(), cause)
			var handlerError *server.HandlerError
			if !errors.As(mapped, &handlerError) {
				t.Fatalf("mapped error type = %T, want *server.HandlerError", mapped)
			}
			if handlerError.Code != test.want {
				t.Fatalf("status = %d, want %d", handlerError.Code, test.want)
			}
			if got := handlerError.Headers["X-Peers-Error-Code"]; got != string(test.code) {
				t.Fatalf("error code = %q, want %q", got, test.code)
			}
			if !errors.Is(mapped, cause) {
				t.Fatal("mapped error did not retain domain cause")
			}
		})
	}
}

func TestMapProductionConversationErrorMapsActorIdentityFailures(t *testing.T) {
	tests := []struct {
		name string
		code actoridentitydomain.ErrorCode
		want int
	}{
		{"invalid", actoridentitydomain.ErrorCodeInvalidArgument, http.StatusBadRequest},
		{"unauthorized", actoridentitydomain.ErrorCodeUnauthorized, http.StatusForbidden},
		{"invalid proof", actoridentitydomain.ErrorCodeInvalidProof, http.StatusForbidden},
		{"device missing", actoridentitydomain.ErrorCodeDeviceNotFound, http.StatusNotFound},
		{"identity conflict", actoridentitydomain.ErrorCodeIdentityConflict, http.StatusConflict},
		{"device conflict", actoridentitydomain.ErrorCodeDeviceConflict, http.StatusConflict},
		{"stale profile", actoridentitydomain.ErrorCodeStaleProfileVersion, http.StatusConflict},
		{"future profile", actoridentitydomain.ErrorCodeFutureProfileVersion, http.StatusConflict},
		{"device revoked", actoridentitydomain.ErrorCodeDeviceRevoked, http.StatusConflict},
		{"identity unavailable", actoridentitydomain.ErrorCodeIdentityUnavailable, http.StatusServiceUnavailable},
		{"persistence", actoridentitydomain.ErrorCodePersistence, http.StatusServiceUnavailable},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cause := actoridentitydomain.NewError(
				test.code,
				"actor_identity.test",
				"endpoint_manifest",
				"failed",
			)
			mapped := mapProductionConversationError(context.Background(), cause)
			var handlerError *server.HandlerError
			if !errors.As(mapped, &handlerError) {
				t.Fatalf("mapped error type = %T, want *server.HandlerError", mapped)
			}
			if handlerError.Code != test.want {
				t.Fatalf("status = %d, want %d", handlerError.Code, test.want)
			}
			if got := handlerError.Headers["X-Peers-Error-Code"]; got != string(test.code) {
				t.Fatalf("error code = %q, want %q", got, test.code)
			}
			var details map[string]string
			if err := json.Unmarshal(
				[]byte(handlerError.Headers["X-Peers-Error-Details"]),
				&details,
			); err != nil {
				t.Fatalf("decode details: %v", err)
			}
			if details["operation"] != "actor_identity.test" ||
				details["field"] != "endpoint_manifest" ||
				details["reason"] != "failed" {
				t.Fatalf("details = %#v", details)
			}
			if !errors.Is(mapped, cause) {
				t.Fatal("mapped error did not retain Actor Identity cause")
			}
		})
	}
}

func TestMapProductionConversationErrorPreservesSafeDirectStage(t *testing.T) {
	cause := errors.New("database details must remain private")
	staged := productionStage("production_http.create_direct", "social_gate", cause)

	mapped := mapProductionConversationError(context.Background(), staged)
	var handlerError *server.HandlerError
	if !errors.As(mapped, &handlerError) {
		t.Fatalf("mapped error type = %T, want *server.HandlerError", mapped)
	}
	if handlerError.Code != http.StatusInternalServerError {
		t.Fatalf(
			"status = %d, want %d",
			handlerError.Code,
			http.StatusInternalServerError,
		)
	}
	if got := handlerError.Headers["X-Peers-Error-Code"]; got != productionInternalErrorCode {
		t.Fatalf("error code = %q, want %q", got, productionInternalErrorCode)
	}
	var details map[string]string
	if err := json.Unmarshal(
		[]byte(handlerError.Headers["X-Peers-Error-Details"]),
		&details,
	); err != nil {
		t.Fatalf("decode details: %v", err)
	}
	if details["operation"] != "production_http.create_direct" ||
		details["field"] != "stage" ||
		details["reason"] != "social_gate" {
		t.Fatalf("details = %#v", details)
	}
	if strings.Contains(
		handlerError.Headers["X-Peers-Error-Details"],
		"database details",
	) {
		t.Fatal("internal cause leaked through public error details")
	}
	if !errors.Is(mapped, cause) {
		t.Fatal("mapped error did not retain staged cause")
	}
}

func TestMapProductionConversationErrorMapsDeviceInboxFailures(t *testing.T) {
	tests := []struct {
		name string
		code delivery.ErrorCode
		want int
	}{
		{"invalid", delivery.ErrorCodeInvalidArgument, http.StatusBadRequest},
		{"unauthorized", delivery.ErrorCodeUnauthorized, http.StatusForbidden},
		{"owner mismatch", delivery.ErrorCodeItemOwnerMismatch, http.StatusConflict},
		{"not found", delivery.ErrorCodeItemNotFound, http.StatusNotFound},
		{"consumer fenced", delivery.ErrorCodeConsumerFenced, http.StatusConflict},
		{"quota", delivery.ErrorCodeQuotaExceeded, http.StatusTooManyRequests},
		{"persistence", delivery.ErrorCodePersistence, http.StatusServiceUnavailable},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mapped := mapProductionConversationError(
				context.Background(),
				delivery.NewError(test.code, "delivery.test", "device", "failed"),
			)
			var handlerError *server.HandlerError
			if !errors.As(mapped, &handlerError) {
				t.Fatalf("mapped error type = %T, want *server.HandlerError", mapped)
			}
			if handlerError.Code != test.want {
				t.Fatalf("status = %d, want %d", handlerError.Code, test.want)
			}
		})
	}
}

func TestMapProductionConversationErrorMapsInteractionFailures(t *testing.T) {
	tests := []struct {
		name string
		code interaction.ErrorCode
		want int
	}{
		{"invalid", interaction.ErrorCodeInvalidArgument, http.StatusBadRequest},
		{"integrity", interaction.ErrorCodeIntegrityFailed, http.StatusConflict},
		{"unauthorized", interaction.ErrorCodeUnauthorized, http.StatusForbidden},
		{"stale", interaction.ErrorCodeStalePulse, http.StatusConflict},
		{"idempotency", interaction.ErrorCodeIdempotencyConflict, http.StatusConflict},
		{"quota", interaction.ErrorCodeQuotaExceeded, http.StatusTooManyRequests},
		{"persistence", interaction.ErrorCodePersistence, http.StatusServiceUnavailable},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mapped := mapProductionConversationError(
				context.Background(),
				interaction.NewError(
					test.code,
					"interaction.test",
					"device",
					"failed",
				),
			)
			var handlerError *server.HandlerError
			if !errors.As(mapped, &handlerError) {
				t.Fatalf("mapped error type = %T, want *server.HandlerError", mapped)
			}
			if handlerError.Code != test.want {
				t.Fatalf("status = %d, want %d", handlerError.Code, test.want)
			}
		})
	}
}
