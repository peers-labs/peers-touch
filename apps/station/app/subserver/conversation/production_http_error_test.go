package conversation

import (
	"context"
	"errors"
	"net/http"
	"testing"

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
