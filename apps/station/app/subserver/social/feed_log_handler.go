package social

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
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
	if _, ok := getActorPTID(ctx); !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if s.feedLogSvc == nil {
		return nil, server.InternalError("Social feed service unavailable")
	}
	response, err := s.feedLogSvc.Read(ctx, request)
	if err != nil {
		return nil, feedHandlerError(err)
	}
	return response, nil
}

func feedHandlerError(err error) error {
	switch {
	case errors.Is(err, domain.ErrFeedInvalid), errors.Is(err, domain.ErrFeedGap):
		return server.BadRequest(err.Error())
	case errors.Is(err, domain.ErrFeedSignature), errors.Is(err, domain.ErrFeedWriter):
		return server.Unauthorized(err.Error())
	case errors.Is(err, domain.ErrFeedFork), errors.Is(err, domain.ErrFeedRollback):
		return server.Conflict(err.Error())
	case errors.Is(err, gorm.ErrRecordNotFound):
		return server.NotFound("feed not found")
	default:
		return server.InternalErrorWithCause("Social feed operation failed", err)
	}
}
