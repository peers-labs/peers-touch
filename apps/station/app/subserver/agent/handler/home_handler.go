package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type HomeHandlers struct {
	projection *service.HomeProjectionService
	commands   *service.HomeCommandService
}

func NewHomeHandlers(
	projection *service.HomeProjectionService,
	commands *service.HomeCommandService,
) *HomeHandlers {
	return &HomeHandlers{
		projection: projection,
		commands:   commands,
	}
}

func (h *HomeHandlers) HandleGetProjection(
	ctx context.Context,
	req *model.GetHomeWorkProjectionRequest,
) (*model.GetHomeWorkProjectionResponse, error) {
	projection, err := h.projection.Get(
		ctx,
		subjectActorID(ctx),
		req.GetAfterRevision(),
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetHomeWorkProjectionResponse{Projection: projection}, nil
}

func (h *HomeHandlers) HandleSubmitChat(
	ctx context.Context,
	req *model.SubmitHomeChatCommandRequest,
) (*model.SubmitHomeChatCommandResponse, error) {
	response, err := h.commands.SubmitChat(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *HomeHandlers) HandleSubmitTask(
	ctx context.Context,
	req *model.SubmitHomeTaskCommandRequest,
) (*model.SubmitHomeTaskCommandResponse, error) {
	response, err := h.commands.SubmitTask(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}
