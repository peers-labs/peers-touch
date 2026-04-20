// Package infrastructure — ActorQueryRepository provides read-only access to
// Peers actor data for the dashboard's management views.
//
// Change History:
// - 2026-04-10: Initial implementation — actor list, detail, session management.
// - 2026-04-10: Extracted from flat actors_service.go into DDD infrastructure layer.
package infrastructure

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	touchdb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// ActorQueryRepository provides read/write access to the shared Peers actor tables
// from the dashboard perspective. Write operations are limited to admin actions
// (password reset, session revocation).
type ActorQueryRepository interface {
	ListActors(ctx context.Context, query domain.ActorListQuery) ([]touchdb.Actor, int64, error)
	FindActorByID(ctx context.Context, id uint64) (*touchdb.Actor, error)
	GetActorStatus(ctx context.Context, actorID uint64) (touchdb.ActorStatus, error)
	CountPostsByAuthor(ctx context.Context, authorID uint64) (int64, error)
	CountFollowers(ctx context.Context, actorID uint64) (int64, error)
	CountFollowing(ctx context.Context, actorID uint64) (int64, error)
	ResetPassword(ctx context.Context, actorID uint64, passwordHash string) error
	ListActorSessions(ctx context.Context, actorID uint64) ([]domain.ActorSessionInfo, error)
	RevokeActorSession(ctx context.Context, sessionID string) error

	// Overview queries
	CountActors(ctx context.Context) (int64, error)
	CountActorsSince(ctx context.Context, since time.Time) (int64, error)
	CountOnlineActors(ctx context.Context) (int64, error)
	RecentActors(ctx context.Context, limit int) ([]touchdb.Actor, error)

	// Social counters
	CountPosts(ctx context.Context) (int64, error)
	CountComments(ctx context.Context) (int64, error)
	CountLikes(ctx context.Context) (int64, error)
	CountFollows(ctx context.Context) (int64, error)
	CountPostsSince(ctx context.Context, since time.Time) (int64, error)

	// Peers actor sessions (global)
	ListActivePeersSessions(ctx context.Context, limit int) ([]peerSessionRow, error)
}

// peerSessionRow is the raw DB row for actor_sessions queries.
type peerSessionRow struct {
	SessionID    string    `gorm:"column:session_id" json:"session_id"`
	UserID       uint64    `gorm:"column:user_id" json:"user_id"`
	DeviceType   string    `gorm:"column:device_type" json:"device_type"`
	IPAddress    string    `gorm:"column:ip_address" json:"ip_address"`
	UserAgent    string    `gorm:"column:user_agent" json:"user_agent"`
	CreatedAt    time.Time `gorm:"column:created_at" json:"created_at"`
	ExpiresAt    time.Time `gorm:"column:expires_at" json:"expires_at"`
	LastActiveAt time.Time `gorm:"column:last_active_at" json:"last_active_at"`
}

// actorQueryRepository is the GORM-backed implementation.
type actorQueryRepository struct {
	db *gorm.DB
}

// NewActorQueryRepository constructs the GORM-backed implementation.
func NewActorQueryRepository(db *gorm.DB) ActorQueryRepository {
	return &actorQueryRepository{db: db}
}

// ---------------------------------------------------------------------------
// Actor CRUD
// ---------------------------------------------------------------------------

func (r *actorQueryRepository) ListActors(ctx context.Context, query domain.ActorListQuery) ([]touchdb.Actor, int64, error) {
	db := r.db.WithContext(ctx).Model(&touchdb.Actor{})

	if query.Search != "" {
		pattern := "%" + query.Search + "%"
		db = db.Where("preferred_username LIKE ? OR name LIKE ? OR email LIKE ?", pattern, pattern, pattern)
	}

	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var actors []touchdb.Actor
	offset := (query.Page - 1) * query.PageSize
	err := db.Order("created_at DESC").Offset(offset).Limit(query.PageSize).Find(&actors).Error
	return actors, total, err
}

func (r *actorQueryRepository) FindActorByID(ctx context.Context, id uint64) (*touchdb.Actor, error) {
	var actor touchdb.Actor
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&actor).Error
	if err != nil {
		return nil, err
	}
	return &actor, nil
}

func (r *actorQueryRepository) GetActorStatus(ctx context.Context, actorID uint64) (touchdb.ActorStatus, error) {
	var status touchdb.ActorStatus
	err := r.db.WithContext(ctx).Where("actor_id = ?", actorID).First(&status).Error
	return status, err
}

func (r *actorQueryRepository) CountPostsByAuthor(ctx context.Context, authorID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&touchdb.Post{}).Where("author_id = ?", authorID).Count(&count).Error
	return count, err
}

func (r *actorQueryRepository) CountFollowers(ctx context.Context, actorID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&touchdb.Follow{}).Where("following_id = ?", actorID).Count(&count).Error
	return count, err
}

func (r *actorQueryRepository) CountFollowing(ctx context.Context, actorID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&touchdb.Follow{}).Where("follower_id = ?", actorID).Count(&count).Error
	return count, err
}

func (r *actorQueryRepository) ResetPassword(ctx context.Context, actorID uint64, passwordHash string) error {
	result := r.db.WithContext(ctx).Model(&touchdb.Actor{}).Where("id = ?", actorID).Update("password_hash", passwordHash)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *actorQueryRepository) ListActorSessions(ctx context.Context, actorID uint64) ([]domain.ActorSessionInfo, error) {
	var sessions []struct {
		SessionID     string    `gorm:"column:session_id"`
		DeviceType    string    `gorm:"column:device_type"`
		IPAddress     string    `gorm:"column:ip_address"`
		UserAgent     string    `gorm:"column:user_agent"`
		CreatedAt     time.Time `gorm:"column:created_at"`
		ExpiresAt     time.Time `gorm:"column:expires_at"`
		LastActiveAt  time.Time `gorm:"column:last_active_at"`
		Revoked       bool      `gorm:"column:revoked"`
		RevokedReason string    `gorm:"column:revoked_reason"`
	}

	err := r.db.WithContext(ctx).Table("actor_sessions").
		Where("user_id = ?", actorID).
		Order("created_at DESC").
		Limit(50).
		Find(&sessions).Error
	if err != nil {
		return nil, err
	}

	result := make([]domain.ActorSessionInfo, 0, len(sessions))
	for _, s := range sessions {
		result = append(result, domain.ActorSessionInfo{
			SessionID:     s.SessionID,
			DeviceType:    s.DeviceType,
			IPAddress:     s.IPAddress,
			UserAgent:     s.UserAgent,
			CreatedAt:     s.CreatedAt,
			ExpiresAt:     s.ExpiresAt,
			LastActiveAt:  s.LastActiveAt,
			Revoked:       s.Revoked,
			RevokedReason: s.RevokedReason,
		})
	}

	return result, nil
}

func (r *actorQueryRepository) RevokeActorSession(ctx context.Context, sessionID string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Exec(
		"UPDATE actor_sessions SET revoked = ?, revoked_at = ?, revoked_reason = ? WHERE session_id = ? AND revoked = ?",
		true, now, "revoked_by_admin", sessionID, false,
	).Error
}

// ---------------------------------------------------------------------------
// Overview aggregation queries
// ---------------------------------------------------------------------------

func (r *actorQueryRepository) CountActors(ctx context.Context) (int64, error) {
	var c int64
	err := r.db.WithContext(ctx).Model(&touchdb.Actor{}).Count(&c).Error
	return c, err
}

func (r *actorQueryRepository) CountActorsSince(ctx context.Context, since time.Time) (int64, error) {
	var c int64
	err := r.db.WithContext(ctx).Model(&touchdb.Actor{}).Where("created_at >= ?", since).Count(&c).Error
	return c, err
}

func (r *actorQueryRepository) CountOnlineActors(ctx context.Context) (int64, error) {
	var c int64
	// Online status must be bounded by heartbeat TTL; otherwise stale rows can be
	// counted as "online" indefinitely (e.g. client crashed without logout).
	heartbeatThreshold := time.Now().Add(-5 * time.Minute)
	err := r.db.WithContext(ctx).
		Model(&touchdb.ActorStatus{}).
		Where("status = ? AND last_heartbeat > ?", touchdb.ActorStatusOnline, heartbeatThreshold).
		Count(&c).Error
	return c, err
}

func (r *actorQueryRepository) RecentActors(ctx context.Context, limit int) ([]touchdb.Actor, error) {
	var actors []touchdb.Actor
	err := r.db.WithContext(ctx).Order("created_at DESC").Limit(limit).Find(&actors).Error
	return actors, err
}

func (r *actorQueryRepository) CountPosts(ctx context.Context) (int64, error) {
	var c int64
	err := r.db.WithContext(ctx).Model(&touchdb.Post{}).Count(&c).Error
	return c, err
}

func (r *actorQueryRepository) CountComments(ctx context.Context) (int64, error) {
	var c int64
	err := r.db.WithContext(ctx).Model(&touchdb.Comment{}).Count(&c).Error
	return c, err
}

func (r *actorQueryRepository) CountLikes(ctx context.Context) (int64, error) {
	var c int64
	err := r.db.WithContext(ctx).Model(&touchdb.PostLike{}).Count(&c).Error
	return c, err
}

func (r *actorQueryRepository) CountFollows(ctx context.Context) (int64, error) {
	var c int64
	err := r.db.WithContext(ctx).Model(&touchdb.Follow{}).Count(&c).Error
	return c, err
}

func (r *actorQueryRepository) CountPostsSince(ctx context.Context, since time.Time) (int64, error) {
	var c int64
	err := r.db.WithContext(ctx).Model(&touchdb.Post{}).Where("created_at >= ?", since).Count(&c).Error
	return c, err
}

func (r *actorQueryRepository) ListActivePeersSessions(ctx context.Context, limit int) ([]peerSessionRow, error) {
	var sessions []peerSessionRow
	now := time.Now()
	err := r.db.WithContext(ctx).Table("actor_sessions").
		Where("revoked = ? AND expires_at > ?", false, now).
		Order("last_active_at DESC").
		Limit(limit).
		Find(&sessions).Error
	return sessions, err
}
