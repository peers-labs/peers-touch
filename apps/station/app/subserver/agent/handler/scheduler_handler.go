package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type SchedulerHandlers struct {
	schedulerService *service.SchedulerService
}

func NewSchedulerHandlers(svc *service.SchedulerService) *SchedulerHandlers {
	return &SchedulerHandlers{schedulerService: svc}
}

type schedulerStartRequest struct {
	AgentID          string `json:"agent_id"`
	ReviewIntervalM  int    `json:"review_interval_minutes"`
	DogfoodIntervalM int    `json:"dogfood_interval_minutes"`
}

type schedulerAddJobRequest struct {
	Kind       string `json:"kind"`
	AgentID    string `json:"agent_id"`
	IntervalM  int    `json:"interval_minutes"`
}

func (h *SchedulerHandlers) HandleStart(w http.ResponseWriter, r *http.Request) {
	var req schedulerStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.AgentID == "" {
		writeError(w, http.StatusBadRequest, "agent_id is required")
		return
	}

	configs := service.DefaultSchedulerConfigs(req.AgentID)

	if req.ReviewIntervalM > 0 {
		configs[0].Interval = time.Duration(req.ReviewIntervalM) * time.Minute
	}
	if req.DogfoodIntervalM > 0 {
		configs[1].Interval = time.Duration(req.DogfoodIntervalM) * time.Minute
	}

	h.schedulerService.Start(r.Context(), configs)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "message": "scheduler started"})
}

func (h *SchedulerHandlers) HandleStop(w http.ResponseWriter, r *http.Request) {
	h.schedulerService.Stop(r.Context())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "message": "scheduler stopped"})
}

func (h *SchedulerHandlers) HandleStatus(w http.ResponseWriter, r *http.Request) {
	status := h.schedulerService.Status()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

func (h *SchedulerHandlers) HandleAddJob(w http.ResponseWriter, r *http.Request) {
	var req schedulerAddJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.AgentID == "" || req.Kind == "" {
		writeError(w, http.StatusBadRequest, "agent_id and kind are required")
		return
	}

	interval := 60 * time.Minute
	if req.IntervalM > 0 {
		interval = time.Duration(req.IntervalM) * time.Minute
	}

	cfg := service.ScheduledJobConfig{
		Kind:     service.ScheduledJobKind(req.Kind),
		AgentID:  req.AgentID,
		Interval: interval,
		Enabled:  true,
	}

	if err := h.schedulerService.AddJob(r.Context(), cfg); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}
