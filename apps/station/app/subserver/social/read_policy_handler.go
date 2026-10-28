package social

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

func (s *subServer) handleMomentReadPolicy(
	ctx context.Context, request *privatecontentpb.CheckMomentReadPolicyRequest,
) (*privatecontentpb.CheckMomentReadPolicyResponse, error) {
	viewer, ok := privateCommentViewer(ctx)
	if !ok {
		return nil, server.Unauthorized("authenticated private-content device required")
	}
	if s.privateContentSvc == nil {
		return nil, server.InternalError("private Social read authority unavailable")
	}
	response, err := s.privateContentSvc.CheckMomentReadPolicy(ctx, viewer, request)
	if err != nil {
		return nil, privateContentHandlerError(err)
	}
	return response, nil
}
