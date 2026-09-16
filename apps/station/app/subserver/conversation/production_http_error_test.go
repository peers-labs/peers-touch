package conversation

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

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
