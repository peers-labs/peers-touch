package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

type OfflineOpStatus string

const (
	OfflineOpStatusPending    OfflineOpStatus = "pending"
	OfflineOpStatusProcessing OfflineOpStatus = "processing"
	OfflineOpStatusCompleted  OfflineOpStatus = "completed"
	OfflineOpStatusFailed     OfflineOpStatus = "failed"
	OfflineOpStatusConflict   OfflineOpStatus = "conflict"
)

type OfflineOpType string

const (
	OfflineOpTypeWorkspaceFileCreate  OfflineOpType = "workspace_file_create"
	OfflineOpTypeWorkspaceFileUpdate  OfflineOpType = "workspace_file_update"
	OfflineOpTypeWorkspaceFileDelete  OfflineOpType = "workspace_file_delete"
	OfflineOpTypeMemoryCreate         OfflineOpType = "memory_create"
	OfflineOpTypeMemoryUpdate         OfflineOpType = "memory_update"
	OfflineOpTypeMemoryDelete         OfflineOpType = "memory_delete"
	OfflineOpTypeAgentConfigUpdate    OfflineOpType = "agent_config_update"
)

type OfflineOperation struct {
	ID              string
	AgentID         string
	DeviceID        string
	OpType          OfflineOpType
	Status          OfflineOpStatus
	Payload         string
	ClientRequestID string
	RetryCount      int32
	ErrorMessage    string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	ProcessedAt     *time.Time
}

type OfflineQueueService interface {
	Enqueue(ctx context.Context, ops []*OfflineOperation) ([]string, error)
	ListPending(ctx context.Context, agentID, deviceID string, limit int32) ([]*OfflineOperation, int32, error)
	GetOperation(ctx context.Context, id string) (*OfflineOperation, error)
	AckOperation(ctx context.Context, id string, success bool, errorMsg string) error
	SyncOperations(ctx context.Context, agentID, deviceID string, since time.Time) (pending []*OfflineOperation, completed []*OfflineOperation, err error)
	ResolveConflict(ctx context.Context, id string, resolution string, resolvedPayload string) (*OfflineOperation, error)
}

type offlineQueueService struct {
	db *gorm.DB
}

func NewOfflineQueueService(db *gorm.DB) OfflineQueueService {
	return &offlineQueueService{db: db}
}

func (s *offlineQueueService) Enqueue(ctx context.Context, ops []*OfflineOperation) ([]string, error) {
	var ids []string
	var records []persistence.AgentOfflineOp
	now := time.Now()

	for _, op := range ops {
		id := op.ID
		if id == "" {
			id = uuid.New().String()
		}
		ids = append(ids, id)
		status := string(op.Status)
		if status == "" {
			status = string(OfflineOpStatusPending)
		}
		records = append(records, persistence.AgentOfflineOp{
			ID:              id,
			AgentID:         op.AgentID,
			DeviceID:        op.DeviceID,
			OpType:          string(op.OpType),
			Status:          status,
			Payload:         op.Payload,
			ClientRequestID: op.ClientRequestID,
			RetryCount:      op.RetryCount,
			ErrorMessage:    op.ErrorMessage,
			CreatedAt:       now,
			UpdatedAt:       now,
		})
	}

	if err := s.db.WithContext(ctx).Create(&records).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

func (s *offlineQueueService) ListPending(ctx context.Context, agentID, deviceID string, limit int32) ([]*OfflineOperation, int32, error) {
	var records []persistence.AgentOfflineOp
	var total int64

	query := s.db.WithContext(ctx).Model(&persistence.AgentOfflineOp{}).
		Where("agent_id = ? AND device_id = ? AND status = ?", agentID, deviceID, string(OfflineOpStatusPending))

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("created_at ASC").Limit(int(limit)).Find(&records).Error; err != nil {
		return nil, 0, err
	}

	result := make([]*OfflineOperation, len(records))
	for i, rec := range records {
		result[i] = offlineOpFromModel(&rec)
	}
	return result, int32(total), nil
}

func (s *offlineQueueService) GetOperation(ctx context.Context, id string) (*OfflineOperation, error) {
	var rec persistence.AgentOfflineOp
	if err := s.db.WithContext(ctx).First(&rec, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return offlineOpFromModel(&rec), nil
}

func (s *offlineQueueService) AckOperation(ctx context.Context, id string, success bool, errorMsg string) error {
	status := string(OfflineOpStatusCompleted)
	if !success {
		status = string(OfflineOpStatusFailed)
	}
	updates := map[string]interface{}{
		"status":       status,
		"updated_at":   time.Now(),
		"processed_at": time.Now(),
	}
	if errorMsg != "" {
		updates["error_message"] = errorMsg
	}
	return s.db.WithContext(ctx).Model(&persistence.AgentOfflineOp{}).
		Where("id = ?", id).
		Updates(updates).Error
}

func (s *offlineQueueService) SyncOperations(ctx context.Context, agentID, deviceID string, since time.Time) ([]*OfflineOperation, []*OfflineOperation, error) {
	var records []persistence.AgentOfflineOp

	err := s.db.WithContext(ctx).
		Where("agent_id = ? AND device_id = ? AND updated_at > ?", agentID, deviceID, since).
		Order("created_at ASC").
		Find(&records).Error
	if err != nil {
		return nil, nil, err
	}

	var pending []*OfflineOperation
	var completed []*OfflineOperation

	for _, rec := range records {
		op := offlineOpFromModel(&rec)
		if op.Status == OfflineOpStatusPending || op.Status == OfflineOpStatusProcessing {
			pending = append(pending, op)
		} else {
			completed = append(completed, op)
		}
	}

	return pending, completed, nil
}

func (s *offlineQueueService) ResolveConflict(ctx context.Context, id string, resolution string, resolvedPayload string) (*OfflineOperation, error) {
	now := time.Now()
	updates := map[string]interface{}{
		"status":     string(OfflineOpStatusPending),
		"updated_at": now,
	}
	if resolvedPayload != "" {
		updates["payload"] = resolvedPayload
	}

	if err := s.db.WithContext(ctx).Model(&persistence.AgentOfflineOp{}).
		Where("id = ?", id).
		Updates(updates).Error; err != nil {
		return nil, err
	}

	return s.GetOperation(ctx, id)
}

func offlineOpFromModel(rec *persistence.AgentOfflineOp) *OfflineOperation {
	return &OfflineOperation{
		ID:              rec.ID,
		AgentID:         rec.AgentID,
		DeviceID:        rec.DeviceID,
		OpType:          OfflineOpType(rec.OpType),
		Status:          OfflineOpStatus(rec.Status),
		Payload:         rec.Payload,
		ClientRequestID: rec.ClientRequestID,
		RetryCount:      rec.RetryCount,
		ErrorMessage:    rec.ErrorMessage,
		CreatedAt:       rec.CreatedAt,
		UpdatedAt:       rec.UpdatedAt,
		ProcessedAt:     rec.ProcessedAt,
	}
}
