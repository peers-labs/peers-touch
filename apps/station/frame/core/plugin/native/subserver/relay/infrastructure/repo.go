package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ---- Persistent Object models (GORM) ----

type mountPO struct {
	ID             uint64 `gorm:"primaryKey;autoIncrement:false"`
	StationPeerID  string `gorm:"size:255;uniqueIndex;uniqueIndex:idx_relay_mount_station_generation,priority:1"`
	HostPublicKey  []byte
	Label          string             `gorm:"size:255"`
	Status         domain.MountStatus `gorm:"index"`
	Generation     uint64             `gorm:"not null;default:1;uniqueIndex:idx_relay_mount_station_generation,priority:2"`
	CredentialJTI  string             `gorm:"size:128;index"`
	MaxClients     int32
	BandwidthLimit int64
	InviteID       uint64    `gorm:"index"`
	LastHeartbeat  time.Time `gorm:"index"`
	MountedAt      time.Time
	RevokedAt      *time.Time `gorm:"index"`
	CreatedAt      time.Time  `gorm:"autoCreateTime"`
	UpdatedAt      time.Time  `gorm:"autoUpdateTime"`
}

func (*mountPO) TableName() string { return "relay_mount" }

func (m *mountPO) BeforeCreate(_ *gorm.DB) error {
	if m.ID == 0 {
		m.ID = id.NextID()
	}
	return nil
}

type invitePO struct {
	ID                    uint64 `gorm:"primaryKey;autoIncrement:false"`
	SecretDigest          string `gorm:"column:secret_digest;size:64;uniqueIndex"`
	IntendedStationPeerID string `gorm:"column:intended_station_peer_id;size:255;index"`
	Label                 string `gorm:"size:255"`
	MaxClients            int32
	BandwidthLimit        int64
	Status                domain.InviteStatus `gorm:"index"`
	ConsumedBy            string              `gorm:"size:255"`
	ConsumedAt            *time.Time
	ExpiresAt             time.Time `gorm:"index"`
	CreatedAt             time.Time `gorm:"autoCreateTime"`
	UpdatedAt             time.Time `gorm:"autoUpdateTime"`
}

func (*invitePO) TableName() string { return "relay_invite" }

func (i *invitePO) BeforeCreate(_ *gorm.DB) error {
	if i.ID == 0 {
		i.ID = id.NextID()
	}
	return nil
}

// ---- domain ↔ PO converters ----

func toDomainMount(po mountPO) domain.Mount {
	return domain.Mount{
		ID:             po.ID,
		StationPeerID:  po.StationPeerID,
		HostPublicKey:  append([]byte(nil), po.HostPublicKey...),
		Label:          po.Label,
		Status:         po.Status,
		Generation:     po.Generation,
		CredentialJTI:  po.CredentialJTI,
		MaxClients:     po.MaxClients,
		BandwidthLimit: po.BandwidthLimit,
		InviteID:       po.InviteID,
		LastHeartbeat:  po.LastHeartbeat,
		MountedAt:      po.MountedAt,
		RevokedAt:      po.RevokedAt,
		CreatedAt:      po.CreatedAt,
		UpdatedAt:      po.UpdatedAt,
	}
}

func toMountPO(m *domain.Mount) mountPO {
	return mountPO{
		ID:             m.ID,
		StationPeerID:  m.StationPeerID,
		HostPublicKey:  append([]byte(nil), m.HostPublicKey...),
		Label:          m.Label,
		Status:         m.Status,
		Generation:     m.Generation,
		CredentialJTI:  m.CredentialJTI,
		MaxClients:     m.MaxClients,
		BandwidthLimit: m.BandwidthLimit,
		InviteID:       m.InviteID,
		LastHeartbeat:  m.LastHeartbeat,
		MountedAt:      m.MountedAt,
		RevokedAt:      m.RevokedAt,
		CreatedAt:      m.CreatedAt,
		UpdatedAt:      m.UpdatedAt,
	}
}

func toDomainInvite(po invitePO) domain.Invite {
	return domain.Invite{
		ID:                    po.ID,
		SecretDigest:          po.SecretDigest,
		IntendedStationPeerID: po.IntendedStationPeerID,
		Label:                 po.Label,
		MaxClients:            po.MaxClients,
		BandwidthLimit:        po.BandwidthLimit,
		Status:                po.Status,
		ConsumedBy:            po.ConsumedBy,
		ConsumedAt:            po.ConsumedAt,
		ExpiresAt:             po.ExpiresAt,
		CreatedAt:             po.CreatedAt,
		UpdatedAt:             po.UpdatedAt,
	}
}

func toInvitePO(i *domain.Invite) invitePO {
	return invitePO{
		ID:                    i.ID,
		SecretDigest:          i.SecretDigest,
		IntendedStationPeerID: i.IntendedStationPeerID,
		Label:                 i.Label,
		MaxClients:            i.MaxClients,
		BandwidthLimit:        i.BandwidthLimit,
		Status:                i.Status,
		ConsumedBy:            i.ConsumedBy,
		ConsumedAt:            i.ConsumedAt,
		ExpiresAt:             i.ExpiresAt,
		CreatedAt:             i.CreatedAt,
		UpdatedAt:             i.UpdatedAt,
	}
}

// ---- GormRepo implements domain.Repository ----

var _ domain.Repository = (*GormRepo)(nil)

type GormRepo struct {
	db           *gorm.DB
	enrollmentMu sync.Mutex
}

func NewGormRepo(db *gorm.DB) *GormRepo {
	return &GormRepo{db: db}
}

func (r *GormRepo) AutoMigrate() error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		legacyInviteTable := tx.Migrator().HasTable(&invitePO{}) &&
			tx.Migrator().HasColumn(&invitePO{}, "token")
		if legacyInviteTable {
			// Legacy invite rows contain plaintext bearer secrets. They cannot
			// be migrated into the PoP flow, so invalidate and remove them.
			if err := tx.Exec("DELETE FROM relay_invite").Error; err != nil {
				return fmt.Errorf("purge legacy relay invites: %w", err)
			}
			for _, indexName := range []string{
				"idx_relay_invite_token",
				"idx_relay_invite_station_peer_id",
			} {
				if err := dropLegacyIndex(tx, indexName); err != nil {
					return err
				}
			}
			if err := tx.Exec(
				"ALTER TABLE relay_invite DROP COLUMN token",
			).Error; err != nil {
				return fmt.Errorf("drop legacy relay invite token: %w", err)
			}
			if tx.Migrator().HasColumn(&invitePO{}, "station_peer_id") {
				if err := tx.Exec(
					"ALTER TABLE relay_invite DROP COLUMN station_peer_id",
				).Error; err != nil {
					return fmt.Errorf("drop legacy Relay invite identity: %w", err)
				}
			}
		}
		if err := tx.AutoMigrate(&mountPO{}, &invitePO{}); err != nil {
			return err
		}

		now := time.Now().UTC()
		result := tx.Model(&mountPO{}).
			Where(
				"status <> ? AND (generation = 0 OR credential_jti = ? OR host_public_key IS NULL OR length(host_public_key) = 0)",
				domain.MountStatusRevoked,
				"",
			).
			Updates(map[string]interface{}{
				"generation":     gorm.Expr("CASE WHEN generation = 0 THEN 1 ELSE generation + 1 END"),
				"credential_jti": "",
				"status":         domain.MountStatusRevoked,
				"revoked_at":     &now,
			})
		if result.Error != nil {
			return fmt.Errorf("invalidate legacy relay mounts: %w", result.Error)
		}
		return nil
	})
}

// ---- Invite ----

func (r *GormRepo) CreateInvite(ctx context.Context, invite *domain.Invite) error {
	po := toInvitePO(invite)
	if err := r.db.WithContext(ctx).Create(&po).Error; err != nil {
		return err
	}
	invite.ID = po.ID
	invite.CreatedAt = po.CreatedAt
	invite.UpdatedAt = po.UpdatedAt
	return nil
}

func (r *GormRepo) GetInviteBySecretDigest(ctx context.Context, secretDigest string) (*domain.Invite, error) {
	var po invitePO
	if err := r.db.WithContext(ctx).
		Where("secret_digest = ?", secretDigest).
		First(&po).Error; err != nil {
		return nil, err
	}
	out := toDomainInvite(po)
	return &out, nil
}

func (r *GormRepo) ConsumeInviteAndActivateMount(
	ctx context.Context,
	inviteID uint64,
	mount *domain.Mount,
	maxStations int,
) (*domain.Mount, error) {
	r.enrollmentMu.Lock()
	defer r.enrollmentMu.Unlock()

	now := time.Now().UTC()
	var activated domain.Mount
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&invitePO{}).
			Where(
				"id = ? AND status = ? AND expires_at > ?",
				inviteID,
				domain.InviteStatusActive,
				now,
			).
			Updates(map[string]interface{}{
				"status":      domain.InviteStatusConsumed,
				"consumed_by": mount.StationPeerID,
				"consumed_at": &now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return fmt.Errorf("%w: invite_id=%d", domain.ErrInviteAlreadyConsumed, inviteID)
		}

		var current mountPO
		getErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("station_peer_id = ?", mount.StationPeerID).
			First(&current).Error
		if getErr != nil && !errorsIsRecordNotFound(getErr) {
			return getErr
		}

		if errorsIsRecordNotFound(getErr) && maxStations > 0 {
			var count int64
			if err := tx.Model(&mountPO{}).
				Where("status <> ?", domain.MountStatusRevoked).
				Count(&count).Error; err != nil {
				return err
			}
			if count >= int64(maxStations) {
				return domain.ErrRelayCapacityFull
			}
		}

		next := toMountPO(mount)
		next.Status = domain.MountStatusOffline
		next.LastHeartbeat = now
		next.MountedAt = now
		next.RevokedAt = nil
		if errorsIsRecordNotFound(getErr) {
			next.Generation = 1
			if err := tx.Create(&next).Error; err != nil {
				return err
			}
		} else {
			next.ID = current.ID
			next.Generation = current.Generation + 1
			next.CreatedAt = current.CreatedAt
			if err := tx.Save(&next).Error; err != nil {
				return err
			}
		}
		activated = toDomainMount(next)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &activated, nil
}

func (r *GormRepo) ListInvites(ctx context.Context) ([]domain.Invite, error) {
	var pos []invitePO
	if err := r.db.WithContext(ctx).Order("created_at DESC").Find(&pos).Error; err != nil {
		return nil, err
	}
	out := make([]domain.Invite, 0, len(pos))
	for _, po := range pos {
		out = append(out, toDomainInvite(po))
	}
	return out, nil
}

func (r *GormRepo) RevokeInvite(ctx context.Context, inviteID uint64) error {
	return r.db.WithContext(ctx).Model(&invitePO{}).
		Where("id = ? AND status = ?", inviteID, domain.InviteStatusActive).
		Update("status", domain.InviteStatusRevoked).Error
}

func (r *GormRepo) ExpireStaleInvites(ctx context.Context) (int64, error) {
	result := r.db.WithContext(ctx).Model(&invitePO{}).
		Where("status = ? AND expires_at < ?", domain.InviteStatusActive, time.Now().UTC()).
		Update("status", domain.InviteStatusExpired)
	return result.RowsAffected, result.Error
}

// ---- Mount ----

func (r *GormRepo) GetMountByStationPeerID(ctx context.Context, stationPeerID string) (*domain.Mount, error) {
	var po mountPO
	if err := r.db.WithContext(ctx).Where("station_peer_id = ?", stationPeerID).First(&po).Error; err != nil {
		return nil, err
	}
	out := toDomainMount(po)
	return &out, nil
}

func (r *GormRepo) ActivateMount(
	ctx context.Context,
	identity domain.MountIdentity,
) error {
	result := r.db.WithContext(ctx).Model(&mountPO{}).
		Where(
			"id = ? AND station_peer_id = ? AND generation = ? AND credential_jti = ? AND status <> ?",
			identity.MountID,
			identity.StationPeerID,
			identity.Generation,
			identity.JTI,
			domain.MountStatusRevoked,
		).
		Update("status", domain.MountStatusOnline)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrMountCredentialStale
	}
	return nil
}

func (r *GormRepo) UpdateMountStatus(
	ctx context.Context,
	stationPeerID string,
	generation uint64,
	status domain.MountStatus,
) error {
	result := r.db.WithContext(ctx).Model(&mountPO{}).
		Where(
			"station_peer_id = ? AND generation = ? AND status <> ?",
			stationPeerID,
			generation,
			domain.MountStatusRevoked,
		).
		Update("status", status)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrMountCredentialStale
	}
	return nil
}

func (r *GormRepo) UpdateHeartbeat(
	ctx context.Context,
	stationPeerID string,
	generation uint64,
	credentialJTI string,
) error {
	result := r.db.WithContext(ctx).Model(&mountPO{}).
		Where(
			"station_peer_id = ? AND generation = ? AND credential_jti = ? AND status <> ?",
			stationPeerID,
			generation,
			credentialJTI,
			domain.MountStatusRevoked,
		).
		Update("last_heartbeat", time.Now().UTC())
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrMountCredentialStale
	}
	return nil
}

func (r *GormRepo) RotateMountCredential(
	ctx context.Context,
	current domain.MountIdentity,
	nextCredentialJTI string,
) (*domain.Mount, error) {
	r.enrollmentMu.Lock()
	defer r.enrollmentMu.Unlock()

	result := r.db.WithContext(ctx).Model(&mountPO{}).
		Where(
			"id = ? AND station_peer_id = ? AND generation = ? AND credential_jti = ? AND status <> ?",
			current.MountID,
			current.StationPeerID,
			current.Generation,
			current.JTI,
			domain.MountStatusRevoked,
		).
		Updates(map[string]interface{}{
			"generation":     current.Generation + 1,
			"credential_jti": nextCredentialJTI,
		})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, domain.ErrMountCredentialStale
	}
	return r.GetMountByStationPeerID(ctx, current.StationPeerID)
}

func (r *GormRepo) RevokeMount(
	ctx context.Context,
	stationPeerID string,
) (*domain.Mount, error) {
	r.enrollmentMu.Lock()
	defer r.enrollmentMu.Unlock()

	var revoked domain.Mount
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current mountPO
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("station_peer_id = ?", stationPeerID).
			First(&current).Error; err != nil {
			if errorsIsRecordNotFound(err) {
				return domain.ErrMountNotFound
			}
			return err
		}
		now := time.Now().UTC()
		result := tx.Model(&mountPO{}).
			Where("id = ? AND generation = ?", current.ID, current.Generation).
			Updates(map[string]interface{}{
				"generation":     current.Generation + 1,
				"credential_jti": "",
				"status":         domain.MountStatusRevoked,
				"revoked_at":     &now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return domain.ErrMountCredentialStale
		}
		current.Generation++
		current.CredentialJTI = ""
		current.Status = domain.MountStatusRevoked
		current.RevokedAt = &now
		revoked = toDomainMount(current)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &revoked, nil
}

func (r *GormRepo) ListOnlineMounts(ctx context.Context) ([]domain.Mount, error) {
	var pos []mountPO
	if err := r.db.WithContext(ctx).Where("status = ?", domain.MountStatusOnline).Find(&pos).Error; err != nil {
		return nil, err
	}
	out := make([]domain.Mount, 0, len(pos))
	for _, po := range pos {
		out = append(out, toDomainMount(po))
	}
	return out, nil
}

func (r *GormRepo) CountOnlineMounts(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&mountPO{}).
		Where("status = ?", domain.MountStatusOnline).
		Count(&count).Error
	return count, err
}

func (r *GormRepo) MarkStaleOffline(ctx context.Context, timeout time.Duration) (int64, error) {
	cutoff := time.Now().UTC().Add(-timeout)
	result := r.db.WithContext(ctx).Model(&mountPO{}).
		Where("status = ? AND last_heartbeat < ?", domain.MountStatusOnline, cutoff).
		Update("status", domain.MountStatusOffline)
	return result.RowsAffected, result.Error
}

func errorsIsRecordNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}

func dropLegacyIndex(tx *gorm.DB, indexName string) error {
	statement := "DROP INDEX IF EXISTS " + indexName
	if tx.Dialector.Name() == "mysql" {
		statement = "DROP INDEX " + indexName + " ON relay_invite"
	}
	if err := tx.Exec(statement).Error; err != nil &&
		tx.Dialector.Name() == "mysql" {
		return fmt.Errorf("drop legacy Relay invite index %s: %w", indexName, err)
	}
	return nil
}
