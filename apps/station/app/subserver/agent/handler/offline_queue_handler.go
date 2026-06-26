package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type OfflineQueueHandlers struct {
	offlineQueueService *service.OfflineQueueService
}

func NewOfflineQueueHandlers(offlineQueueService *service.OfflineQueueService) *OfflineQueueHandlers {
	return &OfflineQueueHandlers{offlineQueueService: offlineQueueService}
}

func (h *OfflineQueueHandlers) HandleEnqueue(ctx context.Context, req *model.EnqueueOfflineOpsRequest) (*model.EnqueueOfflineOpsResponse, error) {
	return h.offlineQueueService.Enqueue(ctx, req)
}

func (h *OfflineQueueHandlers) HandleListPending(ctx context.Context, req *model.ListPendingOfflineOpsRequest) (*model.ListPendingOfflineOpsResponse, error) {
	return h.offlineQueueService.ListPending(ctx, req)
}

func (h *OfflineQueueHandlers) HandleGetOperation(ctx context.Context, req *model.GetOfflineOpRequest) (*model.GetOfflineOpResponse, error) {
	return h.offlineQueueService.GetOperation(ctx, req)
}

func (h *OfflineQueueHandlers) HandleAckOperation(ctx context.Context, req *model.AckOfflineOpRequest) (*model.AckOfflineOpResponse, error) {
	return h.offlineQueueService.AckOperation(ctx, req)
}

func (h *OfflineQueueHandlers) HandleSync(ctx context.Context, req *model.SyncOfflineOpsRequest) (*model.SyncOfflineOpsResponse, error) {
	return h.offlineQueueService.SyncOperations(ctx, req)
}

func (h *OfflineQueueHandlers) HandleResolveConflict(ctx context.Context, req *model.ResolveConflictRequest) (*model.ResolveConflictResponse, error) {
	return h.offlineQueueService.ResolveConflict(ctx, req)
}
