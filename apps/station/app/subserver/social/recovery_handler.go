package social

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

const routeSocialRecoverablePrivateContent = "/api/v1/social/moments/recoverable"

func (s *subServer) handleListRecoverablePrivateContent(
	ctx context.Context,
	request *privatecontentpb.ListRecoverablePrivateContentRequest,
) (*privatecontentpb.ListRecoverablePrivateContentResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized(
			"authenticated private-content actor required",
		)
	}
	if s.privateContentSvc == nil {
		return nil, server.InternalError(
			"Social private-content service is unavailable",
		)
	}

	response, err := s.privateContentSvc.ListRecoverablePrivateContent(
		ctx,
		actorPTID,
		request,
	)
	if err != nil {
		return nil, privateContentHandlerError(err)
	}

	return response, nil
}

func socialRecoverableQueryWrapper(
	next server.EndpointHandler,
) server.EndpointHandler {
	return func(
		ctx context.Context,
		request server.Request,
		response server.Response,
	) error {
		if err := rejectSocialRequestBody(
			request,
			"recoverable private-content query body is forbidden",
		); err != nil {
			return err
		}

		return next(ctx, request, response)
	}
}
