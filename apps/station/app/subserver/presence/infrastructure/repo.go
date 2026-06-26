package infrastructure

import (
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/presence/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type LeaseModel struct {
	ID             uint       `gorm:"column:id;primaryKey"`
	ActorDID       string     `gorm:"column:actor_did;size:255;uniqueIndex:idx_presence_actor_session;index"`
	SessionID      string     `gorm:"column:session_id;size:255;uniqueIndex:idx_presence_actor_session;index"`
	LastSeenAt     time.Time  `gorm:"column:last_seen_at;index"`
	LeaseExpiresAt time.Time  `gorm:"column:lease_expires_at;index"`
	OfflineAt      *time.Time `gorm:"column:offline_at;index"`
	CreatedAt      time.Time  `gorm:"column:created_at"`
	UpdatedAt      time.Time  `gorm:"column:updated_at"`
}

func (*LeaseModel) TableName() string { return "actor_presence_leases" }

type sessionParticipant struct {
	ParticipantADID string `gorm:"column:participant_a_did"`
	ParticipantBDID string `gorm:"column:participant_b_did"`
}

type GormRepo struct {
	db *gorm.DB
}

func NewGormRepo(db *gorm.DB) *GormRepo {
	return &GormRepo{db: db}
}

func (r *GormRepo) AutoMigrate() error {
	return r.db.AutoMigrate(&LeaseModel{})
}

func (r *GormRepo) Heartbeat(actorID, sessionID string, now, expiresAt time.Time) (bool, domain.Status, error) {
	wasOnline, err := r.IsOnline(actorID, now)
	if err != nil {
		return false, domain.Status{}, err
	}
	row := LeaseModel{
		ActorDID:       actorID,
		SessionID:      sessionID,
		LastSeenAt:     now,
		LeaseExpiresAt: expiresAt,
		OfflineAt:      nil,
	}
	if err := r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "actor_did"}, {Name: "session_id"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"last_seen_at":     now,
			"lease_expires_at": expiresAt,
			"offline_at":       nil,
			"updated_at":       now,
		}),
	}).Create(&row).Error; err != nil {
		return false, domain.Status{}, err
	}
	status, err := r.status(actorID, now)
	if err != nil {
		return false, domain.Status{}, err
	}
	return !wasOnline && status.State == domain.StateOnline, status, nil
}

func (r *GormRepo) Offline(actorID, sessionID string, now time.Time) (bool, domain.Status, error) {
	wasOnline, err := r.IsOnline(actorID, now)
	if err != nil {
		return false, domain.Status{}, err
	}
	if err := r.db.Model(&LeaseModel{}).
		Where("actor_did = ? AND session_id = ?", actorID, sessionID).
		Updates(map[string]interface{}{
			"lease_expires_at": now,
			"offline_at":       now,
			"updated_at":       now,
		}).Error; err != nil {
		return false, domain.Status{}, err
	}
	status, err := r.status(actorID, now)
	if err != nil {
		return false, domain.Status{}, err
	}
	return wasOnline && status.State == domain.StateOffline, status, nil
}

func (r *GormRepo) Expire(now time.Time) ([]string, error) {
	var candidates []string
	if err := r.db.Model(&LeaseModel{}).
		Distinct("actor_did").
		Where("offline_at IS NULL AND lease_expires_at <= ?", now).
		Pluck("actor_did", &candidates).Error; err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, nil
	}
	if err := r.db.Model(&LeaseModel{}).
		Where("offline_at IS NULL AND lease_expires_at <= ?", now).
		Updates(map[string]interface{}{"offline_at": now, "updated_at": now}).Error; err != nil {
		return nil, err
	}
	offlineActors := make([]string, 0, len(candidates))
	for _, actorID := range candidates {
		online, err := r.IsOnline(actorID, now)
		if err != nil {
			return nil, err
		}
		if !online {
			offlineActors = append(offlineActors, actorID)
		}
	}
	return offlineActors, nil
}

func (r *GormRepo) IsOnline(actorID string, now time.Time) (bool, error) {
	var count int64
	err := r.db.Model(&LeaseModel{}).
		Where("actor_did = ? AND offline_at IS NULL AND lease_expires_at > ?", actorID, now).
		Count(&count).Error
	return count > 0, err
}

func (r *GormRepo) ListAudience(actorID string) ([]string, error) {
	var rows []sessionParticipant
	if err := r.db.Table("friend_chat_sessions").
		Select("participant_a_did, participant_b_did").
		Where("participant_a_did = ? OR participant_b_did = ?", actorID, actorID).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	seen := map[string]struct{}{actorID: {}}
	recipients := []string{actorID}
	for _, row := range rows {
		for _, did := range []string{row.ParticipantADID, row.ParticipantBDID} {
			if did == "" {
				continue
			}
			if _, ok := seen[did]; ok {
				continue
			}
			seen[did] = struct{}{}
			recipients = append(recipients, did)
		}
	}
	return recipients, nil
}

func (r *GormRepo) Query(actorIDs []string, now time.Time) ([]domain.Status, error) {
	out := make([]domain.Status, 0, len(actorIDs))
	for _, actorID := range actorIDs {
		if actorID == "" {
			continue
		}
		status, err := r.status(actorID, now)
		if err != nil {
			return nil, err
		}
		out = append(out, status)
	}
	return out, nil
}

func (r *GormRepo) status(actorID string, now time.Time) (domain.Status, error) {
	var row LeaseModel
	err := r.db.Where("actor_did = ?", actorID).Order("lease_expires_at DESC").First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Status{ActorID: actorID, State: domain.StateOffline}, nil
	}
	if err != nil {
		return domain.Status{}, err
	}
	state := domain.StateOffline
	if row.OfflineAt == nil && row.LeaseExpiresAt.After(now) {
		state = domain.StateOnline
	}
	return domain.Status{
		ActorID:        actorID,
		State:          state,
		LastSeenAt:     row.LastSeenAt,
		LeaseExpiresAt: row.LeaseExpiresAt,
	}, nil
}
