// Package infrastructure — AuditRepository provides persistence operations
// for the DashboardAuditLog aggregate root.
//
// Change History:
// - 2026-04-10: Initial implementation — audit log creation and paginated listing.
// - 2026-04-10: Extracted from flat auth.go into DDD infrastructure layer.
package infrastructure

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"gorm.io/gorm"
)

// AuditRepository defines persistence operations for DashboardAuditLog.
type AuditRepository interface {
	Record(ctx context.Context, adminID uint64, username, action, resource, detail, ip, userAgent string)
	ListPaginated(ctx context.Context, page, pageSize int) ([]domain.DashboardAuditLog, int64, error)
	ListRecent(ctx context.Context, limit int) ([]domain.DashboardAuditLog, error)
}

// auditRepository is the GORM-backed implementation of AuditRepository.
type auditRepository struct {
	db *gorm.DB
}

// NewAuditRepository constructs a GORM-backed AuditRepository.
func NewAuditRepository(db *gorm.DB) AuditRepository {
	return &auditRepository{db: db}
}

// Record persists an audit log entry. Errors are logged but never bubble up,
// ensuring that audit failures do not break business flows.
func (r *auditRepository) Record(ctx context.Context, adminID uint64, username, action, resource, detail, ip, userAgent string) {
	entry := &domain.DashboardAuditLog{
		AdminID:   adminID,
		Username:  username,
		Action:    action,
		Resource:  resource,
		Detail:    detail,
		IPAddress: ip,
		UserAgent: userAgent,
		CreatedAt: time.Now(),
	}
	if err := r.db.WithContext(ctx).Create(entry).Error; err != nil {
		log.Errorf(ctx, "[dashboard] failed to record audit log: %v", err)
	}
}

func (r *auditRepository) ListPaginated(ctx context.Context, page, pageSize int) ([]domain.DashboardAuditLog, int64, error) {
	var total int64
	r.db.WithContext(ctx).Model(&domain.DashboardAuditLog{}).Count(&total)

	var logs []domain.DashboardAuditLog
	offset := (page - 1) * pageSize
	err := r.db.WithContext(ctx).Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&logs).Error
	if err != nil {
		return nil, 0, err
	}

	return logs, total, nil
}

func (r *auditRepository) ListRecent(ctx context.Context, limit int) ([]domain.DashboardAuditLog, error) {
	var logs []domain.DashboardAuditLog
	err := r.db.WithContext(ctx).Order("created_at DESC").Limit(limit).Find(&logs).Error
	return logs, err
}
