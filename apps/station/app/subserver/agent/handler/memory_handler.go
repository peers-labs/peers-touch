// Changelog:
// 2026-04-11 — Wired MemoryHandlers to MemoryService: replaced 501 stubs with
//   real service calls for HandleListMemories and HandleGetSnapshot.
// 2026-04-15 — Request/response types from generated model (memory.pb.go).

package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// MemoryHandlers exposes HTTP handlers for the memory subsystem.
// Delegates all domain logic to MemoryService.
type MemoryHandlers struct {
	memoryService *service.MemoryService
}

func NewMemoryHandlers(memoryService *service.MemoryService) *MemoryHandlers {
	return &MemoryHandlers{memoryService: memoryService}
}

// HandleListMemories retrieves all memory entries for a given agent and target.
func (h *MemoryHandlers) HandleListMemories(ctx context.Context, req *model.ListMemoriesRequest) (*model.ListMemoriesResponse, error) {
	if req.GetAgentId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}

	items, err := h.memoryService.List(ctx, req.GetAgentId(), req.GetTarget())
	if err != nil {
		logger.Errorf(ctx, "HandleListMemories failed: agent_id=%s, target=%s, err=%v",
			req.GetAgentId(), req.GetTarget(), err)
		return nil, toHandlerError(err)
	}

	resp := &model.ListMemoriesResponse{
		Items: make([]*model.MemoryItem, 0, len(items)),
	}
	for i := range items {
		resp.Items = append(resp.Items, memoryItemToProto(&items[i]))
	}

	return resp, nil
}

// HandleGetSnapshot builds a frozen memory snapshot for prompt injection.
func (h *MemoryHandlers) HandleGetSnapshot(ctx context.Context, req *model.GetMemorySnapshotRequest) (*model.GetMemorySnapshotResponse, error) {
	if req.GetAgentId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}

	snapshot, err := h.memoryService.BuildSnapshot(ctx, req.GetAgentId())
	if err != nil {
		logger.Errorf(ctx, "HandleGetSnapshot failed: agent_id=%s, err=%v", req.GetAgentId(), err)
		return nil, toHandlerError(err)
	}

	return &model.GetMemorySnapshotResponse{
		Snapshot: memorySnapshotToProto(snapshot),
	}, nil
}

func memoryItemToProto(item *domain.MemoryItem) *model.MemoryItem {
	if item == nil {
		return nil
	}
	mi := &model.MemoryItem{
		MemoryId:     item.MemoryID,
		AgentId:      item.AgentID,
		Target:       item.Target,
		Content:      item.Content,
		SourceTurnId: item.SourceTurnID,
	}
	if !item.CreatedAt.IsZero() {
		mi.CreatedAt = timestamppb.New(item.CreatedAt)
	}
	if !item.UpdatedAt.IsZero() {
		mi.UpdatedAt = timestamppb.New(item.UpdatedAt)
	}
	return mi
}

func memorySnapshotToProto(s *domain.MemorySnapshot) *model.MemorySnapshot {
	if s == nil {
		return nil
	}
	out := &model.MemorySnapshot{
		AgentId:       s.AgentID,
		MemoryContent: s.MemoryContent,
		UserContent:   s.UserContent,
	}
	if !s.CapturedAt.IsZero() {
		out.CapturedAt = timestamppb.New(s.CapturedAt)
	}
	return out
}
