package handler

import (
	"context"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type DogfoodHandlers struct {
	dogfoodService *service.DogfoodService
}

func NewDogfoodHandlers(svc *service.DogfoodService) *DogfoodHandlers {
	return &DogfoodHandlers{dogfoodService: svc}
}

type dogfoodRunRequest struct {
	AgentID string `json:"agent_id"`
	Tiers   []int  `json:"tiers"`
}

func (h *DogfoodHandlers) HandleRunDogfood(ctx context.Context, req *dogfoodRunRequest) (*service.DogfoodReport, error) {
	if req.AgentID == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "agent_id is required")
	}

	tiers := make([]service.DogfoodTier, len(req.Tiers))
	for i, t := range req.Tiers {
		tiers[i] = service.DogfoodTier(t)
	}

	if len(tiers) == 0 {
		tiers = []service.DogfoodTier{
			service.TierHealthCheck,
			service.TierBasicChain,
			service.TierGrowthLoop,
			service.TierSecurity,
		}
	}

	report, err := h.dogfoodService.RunScenarios(ctx, req.AgentID, tiers)
	if err != nil {
		return nil, server.NewHandlerErrorWithCause(http.StatusInternalServerError, err.Error(), err)
	}

	return report, nil
}
