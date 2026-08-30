package infrastructure

import (
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/presence/domain"
	modeldb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type LeaseModel struct {
	ID             uint       `gorm:"column:id;primaryKey"`
	ActorPtid      string     `gorm:"column:actor_ptid;size:255;uniqueIndex:idx_presence_actor_session;index"`
	SessionID      string     `gorm:"column:session_id;size:255;uniqueIndex:idx_presence_actor_session;index"`
	LastSeenAt     time.Time  `gorm:"column:last_seen_at;index"`
	LeaseExpiresAt time.Time  `gorm:"column:lease_expires_at;index"`
	OfflineAt      *time.Time `gorm:"column:offline_at;index"`
	CreatedAt      time.Time  `gorm:"column:created_at"`
	UpdatedAt      time.Time  `gorm:"column:updated_at"`
}

func (*LeaseModel) TableName() string { return "actor_presence_leases" }

type sessionParticipant struct {
	ParticipantAPtid string `gorm:"column:participant_a_ptid"`
	ParticipantBPtid string `gorm:"column:participant_b_ptid"`
}

type conversationPeer struct {
	PTID string `gorm:"column:ptid"`
}

type GormRepo struct {
	db *gorm.DB
}

func NewGormRepo(db *gorm.DB) *GormRepo {
	return &GormRepo{db: db}
}

func (r *GormRepo) AutoMigrate() error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, rename := range []struct {
			table string
			from  string
			to    string
		}{
			{table: "actor_presence_leases", from: "actor_did", to: "actor_ptid"},
			{table: "friend_chat_sessions", from: "participant_a_did", to: "participant_a_ptid"},
			{table: "friend_chat_sessions", from: "participant_b_did", to: "participant_b_ptid"},
		} {
			if err := modeldb.MigrateStringIdentityColumn(tx, rename.table, rename.from, rename.to); err != nil {
				return err
			}
		}
		return tx.AutoMigrate(&LeaseModel{})
	})
}

func (r *GormRepo) Heartbeat(actorPTID, sessionID string, now, expiresAt time.Time) (bool, domain.Status, error) {
	wasOnline, err := r.IsOnline(actorPTID, now)
	if err != nil {
		return false, domain.Status{}, err
	}
	row := LeaseModel{
		ActorPtid:      actorPTID,
		SessionID:      sessionID,
		LastSeenAt:     now,
		LeaseExpiresAt: expiresAt,
		OfflineAt:      nil,
	}
	if err := r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "actor_ptid"}, {Name: "session_id"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"last_seen_at":     now,
			"lease_expires_at": expiresAt,
			"offline_at":       nil,
			"updated_at":       now,
		}),
	}).Create(&row).Error; err != nil {
		return false, domain.Status{}, err
	}
	status, err := r.status(actorPTID, now)
	if err != nil {
		return false, domain.Status{}, err
	}
	return !wasOnline && status.State == domain.StateOnline, status, nil
}

func (r *GormRepo) Offline(actorPTID, sessionID string, now time.Time) (bool, domain.Status, error) {
	wasOnline, err := r.IsOnline(actorPTID, now)
	if err != nil {
		return false, domain.Status{}, err
	}
	if err := r.db.Model(&LeaseModel{}).
		Where("actor_ptid = ? AND session_id = ?", actorPTID, sessionID).
		Updates(map[string]interface{}{
			"lease_expires_at": now,
			"offline_at":       now,
			"updated_at":       now,
		}).Error; err != nil {
		return false, domain.Status{}, err
	}
	status, err := r.status(actorPTID, now)
	if err != nil {
		return false, domain.Status{}, err
	}
	return wasOnline && status.State == domain.StateOffline, status, nil
}

func (r *GormRepo) Expire(now time.Time) ([]string, error) {
	var candidates []string
	if err := r.db.Model(&LeaseModel{}).
		Distinct("actor_ptid").
		Where("offline_at IS NULL AND lease_expires_at <= ?", now).
		Pluck("actor_ptid", &candidates).Error; err != nil {
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
	for _, actorPTID := range candidates {
		online, err := r.IsOnline(actorPTID, now)
		if err != nil {
			return nil, err
		}
		if !online {
			offlineActors = append(offlineActors, actorPTID)
		}
	}
	return offlineActors, nil
}

func (r *GormRepo) IsOnline(actorPTID string, now time.Time) (bool, error) {
	var count int64
	err := r.db.Model(&LeaseModel{}).
		Where("actor_ptid = ? AND offline_at IS NULL AND lease_expires_at > ?", actorPTID, now).
		Count(&count).Error
	return count > 0, err
}

func (r *GormRepo) ListAudience(actorPTID string) ([]string, error) {
	var rows []sessionParticipant
	if err := r.db.Table("friend_chat_sessions").
		Select("participant_a_ptid, participant_b_ptid").
		Where("participant_a_ptid = ? OR participant_b_ptid = ?", actorPTID, actorPTID).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	seen := map[string]struct{}{actorPTID: {}}
	recipients := []string{actorPTID}
	for _, row := range rows {
		for _, participantPTID := range []string{row.ParticipantAPtid, row.ParticipantBPtid} {
			if participantPTID == "" {
				continue
			}
			if _, ok := seen[participantPTID]; ok {
				continue
			}
			seen[participantPTID] = struct{}{}
			recipients = append(recipients, participantPTID)
		}
	}
	var peers []conversationPeer
	if err := r.db.Table("conversation_members AS self").
		Select("peer.ptid").
		Joins("JOIN conversation_members AS peer ON peer.conversation_id = self.conversation_id").
		Where("self.ptid = ? AND self.member_status = ? AND peer.member_status = ? AND peer.ptid <> ?",
			actorPTID, 1, 1, actorPTID).
		Find(&peers).Error; err != nil {
		return nil, err
	}
	for _, peer := range peers {
		if peer.PTID == "" {
			continue
		}
		if _, ok := seen[peer.PTID]; ok {
			continue
		}
		seen[peer.PTID] = struct{}{}
		recipients = append(recipients, peer.PTID)
	}
	return recipients, nil
}

func (r *GormRepo) Query(actorPTIDs []string, now time.Time) ([]domain.Status, error) {
	out := make([]domain.Status, 0, len(actorPTIDs))
	for _, actorPTID := range actorPTIDs {
		if actorPTID == "" {
			continue
		}
		status, err := r.status(actorPTID, now)
		if err != nil {
			return nil, err
		}
		out = append(out, status)
	}
	return out, nil
}

func (r *GormRepo) status(actorPTID string, now time.Time) (domain.Status, error) {
	var row LeaseModel
	err := r.db.Where("actor_ptid = ?", actorPTID).Order("lease_expires_at DESC").First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Status{ActorPTID: actorPTID, State: domain.StateOffline}, nil
	}
	if err != nil {
		return domain.Status{}, err
	}
	state := domain.StateOffline
	if row.OfflineAt == nil && row.LeaseExpiresAt.After(now) {
		state = domain.StateOnline
	}
	return domain.Status{
		ActorPTID:      actorPTID,
		State:          state,
		LastSeenAt:     row.LastSeenAt,
		LeaseExpiresAt: row.LeaseExpiresAt,
	}, nil
}
