package http

import (
	"errors"
	nethttp "net/http"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestMapErrorPreservesRecoveryFailureClasses(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
	}{
		{
			name: "invalid archive",
			err: domain.NewError(
				domain.ErrorCodeArchiveIntegrity,
				"test",
				"encrypted_archive",
				"is invalid",
			),
			wantStatus: nethttp.StatusBadRequest,
		},
		{
			name: "inactive device",
			err: domain.NewError(
				domain.ErrorCodeUnauthorized,
				"test",
				"device_id",
				"is inactive",
			),
			wantStatus: nethttp.StatusForbidden,
		},
		{
			name: "conflicting revision",
			err: domain.NewError(
				domain.ErrorCodeRevisionConflict,
				"test",
				"revision_id",
				"has different content",
			),
			wantStatus: nethttp.StatusConflict,
		},
		{
			name: "missing revision",
			err: domain.NewError(
				domain.ErrorCodeRevisionNotFound,
				"test",
				"revision_id",
				"does not exist",
			),
			wantStatus: nethttp.StatusNotFound,
		},
		{
			name:       "unknown failure",
			err:        errors.New("unexpected"),
			wantStatus: nethttp.StatusInternalServerError,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var mapped *server.HandlerError
			if !errors.As(MapError(test.err), &mapped) {
				t.Fatal("MapError did not return a HandlerError")
			}
			if mapped.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", mapped.Code, test.wantStatus)
			}
			if mapped.Err == nil {
				t.Fatal("mapped error lost the typed cause")
			}
		})
	}
}
