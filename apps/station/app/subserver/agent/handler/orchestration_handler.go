package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type OrchestrationHandlers struct {
	orchestrationService *service.OrchestrationService
}

func NewOrchestrationHandlers(orchestrationService *service.OrchestrationService) *OrchestrationHandlers {
	return &OrchestrationHandlers{orchestrationService: orchestrationService}
}

func (h *OrchestrationHandlers) HandleCreateCollaborationTask(ctx context.Context, req *model.CreateCollaborationTaskRequest) (*model.CreateCollaborationTaskResponse, error) {
	task, _, err := h.orchestrationService.CreateCollaborationTask(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.CreateCollaborationTaskResponse{Task: task}, nil
}

func (h *OrchestrationHandlers) HandleGetCollaborationTask(ctx context.Context, req *model.GetCollaborationTaskRequest) (*model.GetCollaborationTaskResponse, error) {
	task, nodes, err := h.orchestrationService.GetCollaborationTask(ctx, subjectActorID(ctx), req.GetTaskId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetCollaborationTaskResponse{Task: task, Nodes: nodes}, nil
}

func (h *OrchestrationHandlers) HandleListCollaborationTasks(ctx context.Context, req *model.ListCollaborationTasksRequest) (*model.ListCollaborationTasksResponse, error) {
	tasks, total, err := h.orchestrationService.ListCollaborationTasks(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ListCollaborationTasksResponse{Tasks: tasks, Total: int32(total)}, nil
}

func (h *OrchestrationHandlers) HandleListTaskEvents(ctx context.Context, req *model.ListTaskEventsRequest) (*model.ListTaskEventsResponse, error) {
	events, nextSeq, err := h.orchestrationService.ListTaskEvents(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ListTaskEventsResponse{Events: events, NextEventSeq: nextSeq}, nil
}

func (h *OrchestrationHandlers) HandleCancelCollaborationTask(ctx context.Context, req *model.UpdateCollaborationTaskRequest) (*model.UpdateCollaborationTaskResponse, error) {
	task, _, err := h.orchestrationService.CancelCollaborationTask(ctx, subjectActorID(ctx), req.GetTaskId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.UpdateCollaborationTaskResponse{Task: task}, nil
}

func (h *OrchestrationHandlers) HandleResumeCollaborationTask(ctx context.Context, req *model.ResumeTaskRequest) (*model.ResumeTaskResponse, error) {
	task, _, err := h.orchestrationService.ResumeCollaborationTask(ctx, subjectActorID(ctx), req.GetTaskId(), "agent.collaboration.resume")
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ResumeTaskResponse{Task: task}, nil
}

func (h *OrchestrationHandlers) HandleSubmitCollaborationNodeResult(ctx context.Context, req *model.SubmitCollaborationNodeResultRequest) (*model.SubmitCollaborationNodeResultResponse, error) {
	task, nodes, err := h.orchestrationService.SubmitCollaborationNodeResult(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.SubmitCollaborationNodeResultResponse{Task: task, Nodes: nodes}, nil
}

func (h *OrchestrationHandlers) HandleClaimDesktopExecutorTask(ctx context.Context, req *model.ClaimDesktopExecutorTaskRequest) (*model.ClaimDesktopExecutorTaskResponse, error) {
	return h.orchestrationService.ClaimDesktopExecutorTask(ctx, subjectActorID(ctx), req)
}

func (h *OrchestrationHandlers) HandleHeartbeatExecutorLease(ctx context.Context, req *model.HeartbeatExecutorLeaseRequest) (*model.HeartbeatExecutorLeaseResponse, error) {
	lease, err := h.orchestrationService.HeartbeatExecutorLease(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.HeartbeatExecutorLeaseResponse{Lease: lease}, nil
}

func (h *OrchestrationHandlers) HandleReleaseExecutorLease(ctx context.Context, req *model.ReleaseExecutorLeaseRequest) (*model.ReleaseExecutorLeaseResponse, error) {
	lease, err := h.orchestrationService.ReleaseExecutorLease(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ReleaseExecutorLeaseResponse{Lease: lease}, nil
}
