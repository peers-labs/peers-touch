package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type SchedulerHandlers struct {
	schedulerService *service.SchedulerService
}

func NewSchedulerHandlers(svc *service.SchedulerService) *SchedulerHandlers {
	return &SchedulerHandlers{schedulerService: svc}
}

func (h *SchedulerHandlers) HandleStart(ctx context.Context, req *model.SchedulerStartRequest) (*model.SchedulerStartResponse, error) {
	if req.GetAgentId() == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "agent_id is required")
	}

	configs := service.DefaultSchedulerConfigs(req.GetAgentId())

	if req.GetReviewIntervalMinutes() > 0 {
		configs[0].Interval = time.Duration(req.GetReviewIntervalMinutes()) * time.Minute
	}
	if req.GetDogfoodIntervalMinutes() > 0 {
		configs[1].Interval = time.Duration(req.GetDogfoodIntervalMinutes()) * time.Minute
	}

	h.schedulerService.Start(ctx, configs)

	return &model.SchedulerStartResponse{Ok: true, Message: "scheduler started"}, nil
}

func (h *SchedulerHandlers) HandleStop(ctx context.Context, _ *model.SchedulerStopRequest) (*model.SchedulerStopResponse, error) {
	h.schedulerService.Stop(ctx)
	return &model.SchedulerStopResponse{Ok: true, Message: "scheduler stopped"}, nil
}

func (h *SchedulerHandlers) HandleStatus(ctx context.Context, _ *model.SchedulerStatusRequest) (*model.SchedulerStatusResponse, error) {
	st := h.schedulerService.Status()
	return schedulerStatusToProto(st), nil
}

func (h *SchedulerHandlers) HandleAddJob(ctx context.Context, req *model.SchedulerAddJobRequest) (*model.SchedulerAddJobResponse, error) {
	if req.GetAgentId() == "" || req.GetKind() == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "agent_id and kind are required")
	}

	interval := 60 * time.Minute
	if req.GetIntervalMinutes() > 0 {
		interval = time.Duration(req.GetIntervalMinutes()) * time.Minute
	}

	cfg := service.ScheduledJobConfig{
		Kind:     service.ScheduledJobKind(req.GetKind()),
		AgentID:  req.GetAgentId(),
		Interval: interval,
		Enabled:  true,
	}

	if err := h.schedulerService.AddJob(ctx, cfg); err != nil {
		return nil, server.NewHandlerErrorWithCause(http.StatusConflict, err.Error(), err)
	}

	return &model.SchedulerAddJobResponse{Ok: true}, nil
}

func schedulerStatusToProto(st service.SchedulerStatus) *model.SchedulerStatusResponse {
	resp := &model.SchedulerStatusResponse{
		Running:    st.Running,
		ActiveJobs: int32(len(st.Jobs)),
	}
	for _, j := range st.Jobs {
		if d, err := time.ParseDuration(j.Interval); err == nil {
			mins := int32(d / time.Minute)
			if mins < 1 {
				mins = 1
			}
			switch j.Kind {
			case service.JobKindReview:
				resp.ReviewIntervalMinutes = mins
			case service.JobKindDogfood:
				resp.DogfoodIntervalMinutes = mins
			}
		}
		if j.AgentID != "" {
			resp.AgentId = j.AgentID
		}
	}
	return resp
}
