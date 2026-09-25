package touch

import (
	"net/http"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func TestStatusCodeForError(t *testing.T) {
	tests := []struct {
		name string
		code model.ErrorCode
		want int
	}{
		{
			name: "unauthorized",
			code: model.ErrorCode_ERROR_CODE_UNAUTHORIZED,
			want: http.StatusUnauthorized,
		},
		{
			name: "internal",
			code: model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR,
			want: http.StatusInternalServerError,
		},
		{
			name: "invalid request",
			code: model.ErrorCode_ERROR_CODE_INVALID_REQUEST,
			want: http.StatusBadRequest,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := model.NewErrorResponse(test.code)
			if got := statusCodeForError(response); got != test.want {
				t.Fatalf("statusCodeForError() = %d, want %d", got, test.want)
			}
		})
	}
}
