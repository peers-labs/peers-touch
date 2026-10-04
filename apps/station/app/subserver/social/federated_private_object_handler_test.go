package social

import (
	"net/http"
	"net/http/httptest"
	"testing"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
)

func TestFederatedPrivateObjectDenialsReturnCanonicalNotFound(t *testing.T) {
	denials := []error{
		socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentNotFound,
			"test",
			"object",
			"missing",
		),
		socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnauthorized,
			"test",
			"grant",
			"revoked",
		),
		socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			"test",
			"descriptor",
			"mismatch",
		),
	}
	for _, denial := range denials {
		recorder := httptest.NewRecorder()
		response := &socialHTTPResponse{writer: recorder}
		writeFederatedPrivateObjectReadError(response, denial)
		if recorder.Code != http.StatusNotFound ||
			recorder.Body.Len() != 0 {
			t.Fatalf(
				"peer denial = status %d body %x",
				recorder.Code,
				recorder.Body.Bytes(),
			)
		}
	}
}
