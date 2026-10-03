package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type McpServerHandlers struct {
	service *service.McpServerService
}

func NewMcpServerHandlers(service *service.McpServerService) *McpServerHandlers {
	return &McpServerHandlers{service: service}
}

func (h *McpServerHandlers) HandleUpsert(
	ctx context.Context,
	req *model.UpsertMcpServerRequest,
) (*model.UpsertMcpServerResponse, error) {
	response, err := h.service.Upsert(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *McpServerHandlers) HandleGet(
	ctx context.Context,
	req *model.GetMcpServerRequest,
) (*model.GetMcpServerResponse, error) {
	server, err := h.service.Get(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetMcpServerResponse{Server: server}, nil
}

func (h *McpServerHandlers) HandleList(
	ctx context.Context,
	req *model.ListMcpServersRequest,
) (*model.ListMcpServersResponse, error) {
	servers, err := h.service.List(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ListMcpServersResponse{Servers: servers}, nil
}

func (h *McpServerHandlers) HandleRefresh(
	ctx context.Context,
	req *model.RefreshMcpServerRequest,
) (*model.RefreshMcpServerResponse, error) {
	response, err := h.service.Refresh(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *McpServerHandlers) HandleDelete(
	ctx context.Context,
	req *model.DeleteMcpServerRequest,
) (*model.DeleteMcpServerResponse, error) {
	response, err := h.service.Delete(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}
