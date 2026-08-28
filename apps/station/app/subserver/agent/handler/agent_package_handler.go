package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

// AgentPackageHandlers expose Station-owned atomic package export and import.
type AgentPackageHandlers struct {
	service *service.AgentPackageService
}

func NewAgentPackageHandlers(packageService *service.AgentPackageService) *AgentPackageHandlers {
	return &AgentPackageHandlers{service: packageService}
}

func (h *AgentPackageHandlers) HandleExport(
	ctx context.Context,
	req *model.ExportAgentPackageRequest,
) (*model.ExportAgentPackageResponse, error) {
	response, err := h.service.Export(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *AgentPackageHandlers) HandleImport(
	ctx context.Context,
	req *model.ImportAgentPackageRequest,
) (*model.ImportAgentPackageResponse, error) {
	response, err := h.service.Import(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}
