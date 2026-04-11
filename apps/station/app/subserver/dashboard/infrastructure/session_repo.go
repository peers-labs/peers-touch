// Package infrastructure — SessionRepository provides persistence operations
// for the DashboardSession aggregate root.
//
// Change History:
// - 2026-04-10: Initial implementation — session CRUD, revocation, listing.
// - 2026-04-10: Extracted from flat auth.go into DDD infrastructure layer.
package infrastructure

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"gorm.io/gorm"
)

// SessionRepository defines persistence operations for DashboardSession.
type SessionRepository interface {
	Create(ctx context.Context, session *domain.DashboardSession) error
	RevokeByAdminID(ctx context.Context, adminID uint64) error
	RevokeBySessionID(ctx context.Context, sessionID string, adminID uint64) error
	RevokeBySessionIDOnly(ctx context.Context, sessionID string) error
	ListActive(ctx context.Context) ([]domain.DashboardSession, error)
}

// sessionRepository is the GORM-backed implementation of SessionRepository.
type sessionRepository struct {
	db *gorm.DB
}

// NewSessionRepository constructs a GORM-backed SessionRepository.
func NewSessionRepository(db *gorm.DB) SessionRepository {
	return &sessionRepository{db: db}
}

func (r *sessionRepository) Create(ctx context.Context, session *domain.DashboardSession) error {
	return r.db.WithContext(ctx).Create(session).Error
}

func (r *sessionRepository) RevokeByAdminID(ctx context.Context, adminID uint64) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&domain.DashboardSession{}).
		Where("admin_id = ? AND revoked = ?", adminID, false).
		Updates(map[string]interface{}{
			"revoked":    true,
			"revoked_at": now,
		}).Error
}

func (r *sessionRepository) RevokeBySessionID(ctx context.Context, sessionID string, adminID uint64) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&domain.DashboardSession{}).
		Where("session_id = ? AND admin_id = ?", sessionID, adminID).
		Updates(map[string]interface{}{
			"revoked":    true,
			"revoked_at": now,
		}).Error
}

func (r *sessionRepository) RevokeBySessionIDOnly(ctx context.Context, sessionID string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&domain.DashboardSession{}).
		Where("session_id = ? AND revoked = ?", sessionID, false).
		Updates(map[string]interface{}{
			"revoked":    true,
			"revoked_at": now,
		}).Error
}

func (r *sessionRepository) ListActive(ctx context.Context) ([]domain.DashboardSession, error) {
	var records []domain.DashboardSession
	err := r.db.WithContext(ctx).
		Where("revoked = ? AND expires_at > ?", false, time.Now()).
		Order("last_active_at DESC").
		Find(&records).Error
	return records, err
}
