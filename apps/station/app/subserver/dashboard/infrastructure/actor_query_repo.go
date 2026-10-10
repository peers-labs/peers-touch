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
	FindActorByPTID(ctx context.Context, actorPTID string) (*touchdb.Actor, error)
	GetActorStatus(ctx context.Context, actorPTID string) (touchdb.ActorStatus, error)
	CountPostsByAuthor(ctx context.Context, actorPTID string) (int64, error)
	CountFollowers(ctx context.Context, actorPTID string) (int64, error)
	CountFollowing(ctx context.Context, actorPTID string) (int64, error)
	ListActorSessions(ctx context.Context, actorPTID string) ([]domain.ActorSessionInfo, error)
	RevokeActorSession(ctx context.Context, actorPTID, sessionID string) error

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

	// Peers actor sessions (global): all currently-valid sessions joined with
	// the owning actor's preferred_username/email for display.
	ListActivePeersSessions(ctx context.Context, limit int) ([]domain.PeersSessionInfo, error)

	// Per-actor session counters used to enrich ActorDetail.
	CountActiveSessionsByActor(ctx context.Context, actorPTID string) (int64, error)
	LastLoginAtByActor(ctx context.Context, actorPTID string) (*time.Time, error)
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
		db = db.Where("ptid LIKE ? OR preferred_username LIKE ? OR name LIKE ? OR email LIKE ?", pattern, pattern, pattern, pattern)
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

func (r *actorQueryRepository) FindActorByPTID(ctx context.Context, actorPTID string) (*touchdb.Actor, error) {
	var actor touchdb.Actor
	err := r.db.WithContext(ctx).Where("ptid = ?", actorPTID).First(&actor).Error
	if err != nil {
		return nil, err
	}
	return &actor, nil
}

func (r *actorQueryRepository) resolveActorID(ctx context.Context, actorPTID string) (uint64, error) {
	var actor struct {
		ID uint64 `gorm:"column:id"`
	}
	if err := r.db.WithContext(ctx).
		Model(&touchdb.Actor{}).
		Select("id").
		Where("ptid = ?", actorPTID).
		First(&actor).Error; err != nil {
		return 0, err
	}
	return actor.ID, nil
}

func (r *actorQueryRepository) GetActorStatus(ctx context.Context, actorPTID string) (touchdb.ActorStatus, error) {
	actorID, err := r.resolveActorID(ctx, actorPTID)
	if err != nil {
		return touchdb.ActorStatus{}, err
	}
	var status touchdb.ActorStatus
	err = r.db.WithContext(ctx).Where("actor_id = ?", actorID).First(&status).Error
	return status, err
}

func (r *actorQueryRepository) CountPostsByAuthor(ctx context.Context, actorPTID string) (int64, error) {
	actorID, err := r.resolveActorID(ctx, actorPTID)
	if err != nil {
		return 0, err
	}
	var publicCount, privateCount int64
	if err := r.db.WithContext(ctx).
		Model(&touchdb.SocialPublicPost{}).
		Where("author_id = ?", actorID).
		Count(&publicCount).Error; err != nil {
		return 0, err
	}
	if err := r.db.WithContext(ctx).
		Model(&touchdb.SocialPrivateContentPost{}).
		Where("author_ptid = ? AND deleted_at IS NULL", actorPTID).
		Count(&privateCount).Error; err != nil {
		return 0, err
	}
	return publicCount + privateCount, nil
}

func (r *actorQueryRepository) CountFollowers(ctx context.Context, actorPTID string) (int64, error) {
	actorID, err := r.resolveActorID(ctx, actorPTID)
	if err != nil {
		return 0, err
	}
	var count int64
	err = r.db.WithContext(ctx).Model(&touchdb.Follow{}).Where("following_id = ?", actorID).Count(&count).Error
	return count, err
}

func (r *actorQueryRepository) CountFollowing(ctx context.Context, actorPTID string) (int64, error) {
	actorID, err := r.resolveActorID(ctx, actorPTID)
	if err != nil {
		return 0, err
	}
	var count int64
	err = r.db.WithContext(ctx).Model(&touchdb.Follow{}).Where("follower_id = ?", actorID).Count(&count).Error
	return count, err
}

func (r *actorQueryRepository) ListActorSessions(ctx context.Context, actorPTID string) ([]domain.ActorSessionInfo, error) {
	actorID, err := r.resolveActorID(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
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

	err = r.db.WithContext(ctx).Table("actor_sessions").
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

func (r *actorQueryRepository) RevokeActorSession(ctx context.Context, actorPTID, sessionID string) error {
	actorID, err := r.resolveActorID(ctx, actorPTID)
	if err != nil {
		return err
	}
	now := time.Now()
	result := r.db.WithContext(ctx).Exec(
		"UPDATE actor_sessions SET revoked = ?, revoked_at = ?, revoked_reason = ? WHERE session_id = ? AND user_id = ? AND revoked = ?",
		true, now, "revoked_by_admin", sessionID, actorID, false,
	)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
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
	var publicCount, privateCount int64
	if err := r.db.WithContext(ctx).Model(&touchdb.SocialPublicPost{}).Count(&publicCount).Error; err != nil {
		return 0, err
	}
	if err := r.db.WithContext(ctx).
		Model(&touchdb.SocialPrivateContentPost{}).
		Where("deleted_at IS NULL").
		Count(&privateCount).Error; err != nil {
		return 0, err
	}
	return publicCount + privateCount, nil
}

func (r *actorQueryRepository) CountComments(ctx context.Context) (int64, error) {
	var publicCount, privateCount int64
	if err := r.db.WithContext(ctx).Model(&touchdb.SocialComment{}).Count(&publicCount).Error; err != nil {
		return 0, err
	}
	if err := r.db.WithContext(ctx).
		Model(&touchdb.SocialPrivateContentComment{}).
		Where("deleted_at IS NULL").
		Count(&privateCount).Error; err != nil {
		return 0, err
	}
	return publicCount + privateCount, nil
}

// CountLikes preserves the dashboard's prior semantic of "user engagement on
// posts" by counting LIKE-kind reactions specifically. Other reaction kinds
// (LOVE / LAUGH / etc.) are intentionally excluded so historical metrics
// remain comparable.
func (r *actorQueryRepository) CountLikes(ctx context.Context) (int64, error) {
	var c int64
	err := r.db.WithContext(ctx).Model(&touchdb.SocialReaction{}).Where("kind = ?", "LIKE").Count(&c).Error
	return c, err
}

func (r *actorQueryRepository) CountFollows(ctx context.Context) (int64, error) {
	var c int64
	err := r.db.WithContext(ctx).Model(&touchdb.Follow{}).Count(&c).Error
	return c, err
}

func (r *actorQueryRepository) CountPostsSince(ctx context.Context, since time.Time) (int64, error) {
	var publicCount, privateCount int64
	if err := r.db.WithContext(ctx).
		Model(&touchdb.SocialPublicPost{}).
		Where("created_at >= ?", since).
		Count(&publicCount).Error; err != nil {
		return 0, err
	}
	if err := r.db.WithContext(ctx).
		Model(&touchdb.SocialPrivateContentPost{}).
		Where("created_at >= ? AND deleted_at IS NULL", since).
		Count(&privateCount).Error; err != nil {
		return 0, err
	}
	return publicCount + privateCount, nil
}

func (r *actorQueryRepository) ListActivePeersSessions(ctx context.Context, limit int) ([]domain.PeersSessionInfo, error) {
	type row struct {
		SessionID         string    `gorm:"column:session_id"`
		ActorPTID         string    `gorm:"column:actor_ptid"`
		PreferredUsername string    `gorm:"column:preferred_username"`
		Email             string    `gorm:"column:email"`
		DeviceType        string    `gorm:"column:device_type"`
		IPAddress         string    `gorm:"column:ip_address"`
		UserAgent         string    `gorm:"column:user_agent"`
		CreatedAt         time.Time `gorm:"column:created_at"`
		ExpiresAt         time.Time `gorm:"column:expires_at"`
		LastActiveAt      time.Time `gorm:"column:last_active_at"`
	}

	if limit <= 0 {
		limit = 100
	}

	var rows []row
	now := time.Now()
	err := r.db.WithContext(ctx).
		Table("actor_sessions AS s").
		Select(`s.session_id, a.ptid AS actor_ptid, s.device_type, s.ip_address, s.user_agent,
		         s.created_at, s.expires_at, s.last_active_at,
		         a.preferred_username, COALESCE(s.email, a.email) AS email`).
		Joins("LEFT JOIN touch_actor a ON a.id = s.user_id").
		Where("s.revoked = ? AND s.expires_at > ?", false, now).
		Order("s.last_active_at DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	out := make([]domain.PeersSessionInfo, 0, len(rows))
	for _, r := range rows {
		out = append(out, domain.PeersSessionInfo{
			SessionID:         r.SessionID,
			ActorPTID:         r.ActorPTID,
			PreferredUsername: r.PreferredUsername,
			Email:             r.Email,
			DeviceType:        r.DeviceType,
			IPAddress:         r.IPAddress,
			UserAgent:         r.UserAgent,
			CreatedAt:         r.CreatedAt,
			ExpiresAt:         r.ExpiresAt,
			LastActiveAt:      r.LastActiveAt,
		})
	}
	return out, nil
}

// CountActiveSessionsByActor returns the number of non-revoked, unexpired
// sessions for a single actor.
func (r *actorQueryRepository) CountActiveSessionsByActor(ctx context.Context, actorPTID string) (int64, error) {
	actorID, err := r.resolveActorID(ctx, actorPTID)
	if err != nil {
		return 0, err
	}
	var c int64
	now := time.Now()
	err = r.db.WithContext(ctx).
		Table("actor_sessions").
		Where("user_id = ? AND revoked = ? AND expires_at > ?", actorID, false, now).
		Count(&c).Error
	return c, err
}

// LastLoginAtByActor returns the timestamp of the most recently created
// session for the given actor (best available proxy for "last login").
// Returns nil if the actor has never logged in.
func (r *actorQueryRepository) LastLoginAtByActor(ctx context.Context, actorPTID string) (*time.Time, error) {
	actorID, err := r.resolveActorID(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	var row struct {
		CreatedAt *time.Time `gorm:"column:created_at"`
	}
	err = r.db.WithContext(ctx).
		Table("actor_sessions").
		Select("MAX(created_at) AS created_at").
		Where("user_id = ?", actorID).
		Scan(&row).Error
	if err != nil {
		return nil, err
	}
	return row.CreatedAt, nil
}
