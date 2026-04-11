package handler

import (
	"encoding/json"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
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

func (h *DogfoodHandlers) HandleRunDogfood(w http.ResponseWriter, r *http.Request) {
	var req dogfoodRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.AgentID == "" {
		writeError(w, http.StatusBadRequest, "agent_id is required")
		return
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

	report, err := h.dogfoodService.RunScenarios(r.Context(), req.AgentID, tiers)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(report)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
