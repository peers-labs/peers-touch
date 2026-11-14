package social

import (
	"context"
	"errors"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

func (s *subServer) handleSubmitFeedEvent(ctx context.Context, request *model.SubmitFeedEventRequest) (*model.SubmitFeedEventResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if s.feedLogSvc == nil {
		return nil, server.InternalError("Social feed service unavailable")
	}
	response, err := s.feedLogSvc.Submit(ctx, actorPTID, serverwrapper.GetDeviceID(ctx), request)
	if err != nil {
		return nil, feedHandlerError(err)
	}
	return response, nil
}

func (s *subServer) handleReadFeed(ctx context.Context, request *model.ReadFeedRequest) (*model.ReadFeedResponse, error) {
	viewer, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if s.feedLogSvc == nil {
		return nil, server.InternalError("Social feed service unavailable")
	}
	response, err := s.feedLogSvc.ReadForViewer(ctx, viewer, request)
	if err != nil {
		return nil, feedHandlerError(err)
	}
	return response, nil
}

func feedHandlerError(err error) error {
	status, code, message := http.StatusInternalServerError,
		model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR, "Social feed operation failed"
	switch {
	case errors.Is(err, domain.ErrFeedInvalid), errors.Is(err, domain.ErrFeedGap):
		status, code, message = http.StatusBadRequest, model.ErrorCode_ERROR_CODE_INVALID_REQUEST, err.Error()
	case errors.Is(err, domain.ErrFeedSignature), errors.Is(err, domain.ErrFeedWriter):
		status, code, message = http.StatusUnauthorized, model.ErrorCode_ERROR_CODE_UNAUTHORIZED, err.Error()
	case errors.Is(err, domain.ErrFeedFork), errors.Is(err, domain.ErrFeedRollback):
		status, code, message = http.StatusConflict, model.ErrorCode_ERROR_CODE_INVALID_REQUEST, err.Error()
	case errors.Is(err, gorm.ErrRecordNotFound):
		status, code, message = http.StatusNotFound, model.ErrorCode_ERROR_CODE_INVALID_REQUEST, "feed not found"
	}
	// Security-sensitive Feed routes use the existing error contract. A map
	// cannot be marshaled by the protobuf serializer and loses the rejection.
	body, encodeErr := proto.MarshalOptions{Deterministic: true}.Marshal(
		&model.ErrorResponse{Code: code, Message: message})
	if encodeErr != nil {
		return server.InternalErrorWithCause("encode Social feed error", encodeErr)
	}
	response := server.NewHandlerErrorWithResponse(status, message,
		server.CanonicalProtobufContentType, body, nil)
	response.Err = err
	return response
}
