// Changelog:
// 2026-04-11 — Wired MemoryHandlers to MemoryService: replaced 501 stubs with
//   real service calls for HandleListMemories and HandleGetSnapshot.

package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// MemoryHandlers exposes HTTP handlers for the memory subsystem.
// Delegates all domain logic to MemoryService.
type MemoryHandlers struct {
	memoryService *service.MemoryService
}

func NewMemoryHandlers(memoryService *service.MemoryService) *MemoryHandlers {
	return &MemoryHandlers{memoryService: memoryService}
}

// -- Request / Response types ------------------------------------------------

type ListMemoriesRequest struct {
	AgentID string `json:"agent_id"`
	Target  string `json:"target"`
}

type MemoryItemResponse struct {
	MemoryID  string `json:"memory_id"`
	Content   string `json:"content"`
	Target    string `json:"target"`
	CreatedAt string `json:"created_at"`
}

type ListMemoriesResponse struct {
	Items []MemoryItemResponse `json:"items"`
}

type GetSnapshotRequest struct {
	AgentID string `json:"agent_id"`
}

type GetSnapshotResponse struct {
	MemoryContent string `json:"memory_content"`
	UserContent   string `json:"user_content"`
}

// -- Handlers ----------------------------------------------------------------

// HandleListMemories retrieves all memory entries for a given agent and target.
func (h *MemoryHandlers) HandleListMemories(ctx context.Context, req *ListMemoriesRequest) (*ListMemoriesResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}

	items, err := h.memoryService.List(ctx, req.AgentID, req.Target)
	if err != nil {
		logger.Errorf(ctx, "HandleListMemories failed: agent_id=%s, target=%s, err=%v",
			req.AgentID, req.Target, err)
		return nil, toHandlerError(err)
	}

	resp := &ListMemoriesResponse{
		Items: make([]MemoryItemResponse, 0, len(items)),
	}
	for _, item := range items {
		resp.Items = append(resp.Items, MemoryItemResponse{
			MemoryID:  item.MemoryID,
			Content:   item.Content,
			Target:    item.Target,
			CreatedAt: item.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	return resp, nil
}

// HandleGetSnapshot builds a frozen memory snapshot for prompt injection.
func (h *MemoryHandlers) HandleGetSnapshot(ctx context.Context, req *GetSnapshotRequest) (*GetSnapshotResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}

	snapshot, err := h.memoryService.BuildSnapshot(ctx, req.AgentID)
	if err != nil {
		logger.Errorf(ctx, "HandleGetSnapshot failed: agent_id=%s, err=%v", req.AgentID, err)
		return nil, toHandlerError(err)
	}

	return &GetSnapshotResponse{
		MemoryContent: snapshot.MemoryContent,
		UserContent:   snapshot.UserContent,
	}, nil
}
