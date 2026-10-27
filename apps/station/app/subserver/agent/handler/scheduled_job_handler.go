package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

// ScheduledJobHandlers exposes the persistent user scheduler API.
type ScheduledJobHandlers struct {
	scheduledJobs *service.ScheduledJobService
}

func NewScheduledJobHandlers(scheduledJobs *service.ScheduledJobService) *ScheduledJobHandlers {
	return &ScheduledJobHandlers{scheduledJobs: scheduledJobs}
}

func (h *ScheduledJobHandlers) HandleCreateScheduledJob(
	ctx context.Context,
	req *model.CreateScheduledJobRequest,
) (*model.CreateScheduledJobResponse, error) {
	job, conversationID, err := h.scheduledJobs.CreateScheduledJob(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.CreateScheduledJobResponse{Job: job, ConversationId: conversationID}, nil
}

func (h *ScheduledJobHandlers) HandleUpdateScheduledJob(
	ctx context.Context,
	req *model.UpdateScheduledJobRequest,
) (*model.UpdateScheduledJobResponse, error) {
	if req.GetJobId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "job_id is required", nil))
	}
	job, err := h.scheduledJobs.UpdateScheduledJob(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.UpdateScheduledJobResponse{Job: job}, nil
}

func (h *ScheduledJobHandlers) HandleDeleteScheduledJob(
	ctx context.Context,
	req *model.DeleteScheduledJobRequest,
) (*model.DeleteScheduledJobResponse, error) {
	if req.GetJobId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "job_id is required", nil))
	}
	ok, err := h.scheduledJobs.DeleteScheduledJob(ctx, subjectActorID(ctx), req.GetJobId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.DeleteScheduledJobResponse{Ok: ok, ConversationRetained: ok}, nil
}

func (h *ScheduledJobHandlers) HandleListScheduledJobs(
	ctx context.Context,
	req *model.ListScheduledJobsRequest,
) (*model.ListScheduledJobsResponse, error) {
	jobs, err := h.scheduledJobs.ListScheduledJobs(
		ctx, subjectActorID(ctx), req.GetAgentId(), req.GetIncludePaused(),
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ListScheduledJobsResponse{Jobs: jobs}, nil
}

func (h *ScheduledJobHandlers) HandleToggleScheduledJob(
	ctx context.Context,
	req *model.ToggleScheduledJobRequest,
) (*model.ToggleScheduledJobResponse, error) {
	if req.GetJobId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "job_id is required", nil))
	}
	job, err := h.scheduledJobs.ToggleScheduledJob(
		ctx, subjectActorID(ctx), req.GetJobId(), req.GetEnabled(),
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ToggleScheduledJobResponse{Job: job}, nil
}

func (h *ScheduledJobHandlers) HandleTriggerScheduledJob(
	ctx context.Context,
	req *model.TriggerScheduledJobRequest,
) (*model.TriggerScheduledJobResponse, error) {
	if req.GetJobId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "job_id is required", nil))
	}
	run, err := h.scheduledJobs.TriggerScheduledJob(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.TriggerScheduledJobResponse{Run: run}, nil
}

func (h *ScheduledJobHandlers) HandleListScheduledJobRuns(
	ctx context.Context,
	req *model.ListScheduledJobRunsRequest,
) (*model.ListScheduledJobRunsResponse, error) {
	if req.GetJobId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "job_id is required", nil))
	}
	runs, err := h.scheduledJobs.ListScheduledJobRuns(
		ctx, subjectActorID(ctx), req.GetJobId(), int(req.GetLimit()),
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ListScheduledJobRunsResponse{Runs: runs}, nil
}
