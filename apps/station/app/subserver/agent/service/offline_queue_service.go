package service

import (
	"context"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type OfflineQueueService struct {
	domainService domain.OfflineQueueService
}

func NewOfflineQueueService() *OfflineQueueService {
	db, _ := store.GetRDS(context.Background(), store.WithRDSDBName("agent"))
	return &OfflineQueueService{
		domainService: domain.NewOfflineQueueService(db),
	}
}

func (s *OfflineQueueService) Enqueue(ctx context.Context, req *model.EnqueueOfflineOpsRequest) (*model.EnqueueOfflineOpsResponse, error) {
	ops := make([]*domain.OfflineOperation, len(req.Ops))
	for i, op := range req.Ops {
		ops[i] = &domain.OfflineOperation{
			ID:              op.Id,
			AgentID:         req.AgentId,
			DeviceID:        req.DeviceId,
			OpType:          protoToDomainOpType(op.OpType),
			Status:          protoToDomainOpStatus(op.Status),
			Payload:         op.Payload,
			ClientRequestID: op.ClientRequestId,
			RetryCount:      op.RetryCount,
			ErrorMessage:    op.ErrorMessage,
		}
	}

	ids, err := s.domainService.Enqueue(ctx, ops)
	if err != nil {
		return nil, err
	}

	return &model.EnqueueOfflineOpsResponse{
		EnqueuedCount: int32(len(ids)),
		OpIds:         ids,
	}, nil
}

func (s *OfflineQueueService) ListPending(ctx context.Context, req *model.ListPendingOfflineOpsRequest) (*model.ListPendingOfflineOpsResponse, error) {
	ops, total, err := s.domainService.ListPending(ctx, req.AgentId, req.DeviceId, req.Limit)
	if err != nil {
		return nil, err
	}

	result := make([]*model.OfflineOperation, len(ops))
	for i, op := range ops {
		result[i] = domainToProtoOfflineOp(op)
	}

	return &model.ListPendingOfflineOpsResponse{
		Ops:   result,
		Total: total,
	}, nil
}

func (s *OfflineQueueService) GetOperation(ctx context.Context, req *model.GetOfflineOpRequest) (*model.GetOfflineOpResponse, error) {
	op, err := s.domainService.GetOperation(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	return &model.GetOfflineOpResponse{
		Op: domainToProtoOfflineOp(op),
	}, nil
}

func (s *OfflineQueueService) AckOperation(ctx context.Context, req *model.AckOfflineOpRequest) (*model.AckOfflineOpResponse, error) {
	err := s.domainService.AckOperation(ctx, req.Id, req.Success, req.ErrorMessage)
	if err != nil {
		return nil, err
	}
	return &model.AckOfflineOpResponse{Success: true}, nil
}

func (s *OfflineQueueService) SyncOperations(ctx context.Context, req *model.SyncOfflineOpsRequest) (*model.SyncOfflineOpsResponse, error) {
	var since time.Time
	if req.LastSyncAt != "" {
		parsed, err := time.Parse(time.RFC3339, req.LastSyncAt)
		if err == nil {
			since = parsed
		}
	}

	pending, completed, err := s.domainService.SyncOperations(ctx, req.AgentId, req.DeviceId, since)
	if err != nil {
		return nil, err
	}

	pendingProto := make([]*model.OfflineOperation, len(pending))
	for i, op := range pending {
		pendingProto[i] = domainToProtoOfflineOp(op)
	}

	completedProto := make([]*model.OfflineOperation, len(completed))
	for i, op := range completed {
		completedProto[i] = domainToProtoOfflineOp(op)
	}

	return &model.SyncOfflineOpsResponse{
		PendingOps:   pendingProto,
		CompletedOps: completedProto,
		SyncCursor:   time.Now().Format(time.RFC3339),
	}, nil
}

func (s *OfflineQueueService) ResolveConflict(ctx context.Context, req *model.ResolveConflictRequest) (*model.ResolveConflictResponse, error) {
	op, err := s.domainService.ResolveConflict(ctx, req.OpId, req.Resolution, req.ResolvedPayload)
	if err != nil {
		return nil, err
	}
	return &model.ResolveConflictResponse{
		Success: true,
		Op:      domainToProtoOfflineOp(op),
	}, nil
}

func protoToDomainOpStatus(status model.OfflineOpStatus) domain.OfflineOpStatus {
	switch status {
	case model.OfflineOpStatus_OFFLINE_OP_STATUS_PENDING:
		return domain.OfflineOpStatusPending
	case model.OfflineOpStatus_OFFLINE_OP_STATUS_PROCESSING:
		return domain.OfflineOpStatusProcessing
	case model.OfflineOpStatus_OFFLINE_OP_STATUS_COMPLETED:
		return domain.OfflineOpStatusCompleted
	case model.OfflineOpStatus_OFFLINE_OP_STATUS_FAILED:
		return domain.OfflineOpStatusFailed
	case model.OfflineOpStatus_OFFLINE_OP_STATUS_CONFLICT:
		return domain.OfflineOpStatusConflict
	default:
		return domain.OfflineOpStatusPending
	}
}

func domainToProtoOpStatus(status domain.OfflineOpStatus) model.OfflineOpStatus {
	switch status {
	case domain.OfflineOpStatusPending:
		return model.OfflineOpStatus_OFFLINE_OP_STATUS_PENDING
	case domain.OfflineOpStatusProcessing:
		return model.OfflineOpStatus_OFFLINE_OP_STATUS_PROCESSING
	case domain.OfflineOpStatusCompleted:
		return model.OfflineOpStatus_OFFLINE_OP_STATUS_COMPLETED
	case domain.OfflineOpStatusFailed:
		return model.OfflineOpStatus_OFFLINE_OP_STATUS_FAILED
	case domain.OfflineOpStatusConflict:
		return model.OfflineOpStatus_OFFLINE_OP_STATUS_CONFLICT
	default:
		return model.OfflineOpStatus_OFFLINE_OP_STATUS_UNSPECIFIED
	}
}

func protoToDomainOpType(opType model.OfflineOpType) domain.OfflineOpType {
	switch opType {
	case model.OfflineOpType_OFFLINE_OP_TYPE_WORKSPACE_FILE_CREATE:
		return domain.OfflineOpTypeWorkspaceFileCreate
	case model.OfflineOpType_OFFLINE_OP_TYPE_WORKSPACE_FILE_UPDATE:
		return domain.OfflineOpTypeWorkspaceFileUpdate
	case model.OfflineOpType_OFFLINE_OP_TYPE_WORKSPACE_FILE_DELETE:
		return domain.OfflineOpTypeWorkspaceFileDelete
	case model.OfflineOpType_OFFLINE_OP_TYPE_MEMORY_CREATE:
		return domain.OfflineOpTypeMemoryCreate
	case model.OfflineOpType_OFFLINE_OP_TYPE_MEMORY_UPDATE:
		return domain.OfflineOpTypeMemoryUpdate
	case model.OfflineOpType_OFFLINE_OP_TYPE_MEMORY_DELETE:
		return domain.OfflineOpTypeMemoryDelete
	case model.OfflineOpType_OFFLINE_OP_TYPE_AGENT_CONFIG_UPDATE:
		return domain.OfflineOpTypeAgentConfigUpdate
	default:
		return domain.OfflineOpTypeWorkspaceFileUpdate
	}
}

func domainToProtoOpType(opType domain.OfflineOpType) model.OfflineOpType {
	switch opType {
	case domain.OfflineOpTypeWorkspaceFileCreate:
		return model.OfflineOpType_OFFLINE_OP_TYPE_WORKSPACE_FILE_CREATE
	case domain.OfflineOpTypeWorkspaceFileUpdate:
		return model.OfflineOpType_OFFLINE_OP_TYPE_WORKSPACE_FILE_UPDATE
	case domain.OfflineOpTypeWorkspaceFileDelete:
		return model.OfflineOpType_OFFLINE_OP_TYPE_WORKSPACE_FILE_DELETE
	case domain.OfflineOpTypeMemoryCreate:
		return model.OfflineOpType_OFFLINE_OP_TYPE_MEMORY_CREATE
	case domain.OfflineOpTypeMemoryUpdate:
		return model.OfflineOpType_OFFLINE_OP_TYPE_MEMORY_UPDATE
	case domain.OfflineOpTypeMemoryDelete:
		return model.OfflineOpType_OFFLINE_OP_TYPE_MEMORY_DELETE
	case domain.OfflineOpTypeAgentConfigUpdate:
		return model.OfflineOpType_OFFLINE_OP_TYPE_AGENT_CONFIG_UPDATE
	default:
		return model.OfflineOpType_OFFLINE_OP_TYPE_UNSPECIFIED
	}
}

func domainToProtoOfflineOp(op *domain.OfflineOperation) *model.OfflineOperation {
	result := &model.OfflineOperation{
		Id:              op.ID,
		AgentId:         op.AgentID,
		DeviceId:        op.DeviceID,
		OpType:          domainToProtoOpType(op.OpType),
		Status:          domainToProtoOpStatus(op.Status),
		Payload:         op.Payload,
		ClientRequestId: op.ClientRequestID,
		RetryCount:      op.RetryCount,
		ErrorMessage:    op.ErrorMessage,
		CreatedAt:       timestamppb.New(op.CreatedAt),
		UpdatedAt:       timestamppb.New(op.UpdatedAt),
	}
	if op.ProcessedAt != nil {
		result.ProcessedAt = timestamppb.New(*op.ProcessedAt)
	}
	return result
}
