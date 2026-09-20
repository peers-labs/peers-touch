package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type ConnectorManifestHandlers struct {
	service *service.ConnectorManifestService
}

func NewConnectorManifestHandlers(
	service *service.ConnectorManifestService,
) *ConnectorManifestHandlers {
	return &ConnectorManifestHandlers{service: service}
}

func (h *ConnectorManifestHandlers) HandleSync(
	ctx context.Context,
	req *model.SyncConnectorResourceManifestsRequest,
) (*model.SyncConnectorResourceManifestsResponse, error) {
	response, err := h.service.Sync(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *ConnectorManifestHandlers) HandleList(
	ctx context.Context,
	req *model.ListConnectorResourceManifestsRequest,
) (*model.ListConnectorResourceManifestsResponse, error) {
	manifests, err := h.service.List(
		ctx,
		subjectActorID(ctx),
		req.GetConnectorId(),
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ListConnectorResourceManifestsResponse{
		Manifests: manifests,
	}, nil
}
