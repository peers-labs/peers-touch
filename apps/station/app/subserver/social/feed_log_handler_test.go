package social

import (
	"errors"
	"net/http"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

func TestFeedRejectionsCarryCanonicalErrorResponse(t *testing.T) {
	for _, test := range []struct {
		cause   error
		status  int
		message string
	}{
		{domain.ErrFeedInvalid, http.StatusBadRequest, domain.ErrFeedInvalid.Error()},
		{domain.ErrFeedGap, http.StatusBadRequest, domain.ErrFeedGap.Error()},
		{domain.ErrFeedWriter, http.StatusUnauthorized, domain.ErrFeedWriter.Error()},
		{domain.ErrFeedSignature, http.StatusUnauthorized, domain.ErrFeedSignature.Error()},
		{domain.ErrFeedFork, http.StatusConflict, domain.ErrFeedFork.Error()},
		{domain.ErrFeedRollback, http.StatusConflict, domain.ErrFeedRollback.Error()},
		{gorm.ErrRecordNotFound, http.StatusNotFound, "feed not found"},
		{errors.New("private storage failure"), http.StatusInternalServerError, "Social feed operation failed"},
	} {
		response, ok := feedHandlerError(test.cause).(*server.HandlerError)
		if !ok || response.Code != test.status ||
			response.ContentType != server.CanonicalProtobufContentType ||
			!errors.Is(response, test.cause) {
			t.Fatalf("Feed rejection lost status, contract or cause: %v", response)
		}
		var decoded model.ErrorResponse
		if err := proto.Unmarshal(response.Body, &decoded); err != nil ||
			decoded.Message != test.message || decoded.Code == model.ErrorCode_ERROR_CODE_UNSPECIFIED {
			t.Fatalf("Feed rejection cannot be decoded: %v, %v", &decoded, err)
		}
	}
}
