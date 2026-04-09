package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// ---- Sentinel errors ----

var ErrInviteAlreadyConsumed = errors.New("invite already consumed or inactive")

// ---- Persistent Object models (GORM) ----

type mountPO struct {
	ID             uint64             `gorm:"primaryKey;autoIncrement:false"`
	StationPeerID  string             `gorm:"size:255;uniqueIndex"`
	Label          string             `gorm:"size:255"`
	Status         domain.MountStatus `gorm:"index"`
	MaxClients     int32
	BandwidthLimit int64
	InviteID       uint64    `gorm:"index"`
	LastHeartbeat  time.Time `gorm:"index"`
	MountedAt      time.Time
	CreatedAt      time.Time `gorm:"autoCreateTime"`
	UpdatedAt      time.Time `gorm:"autoUpdateTime"`
}

func (*mountPO) TableName() string { return "relay_mount" }

func (m *mountPO) BeforeCreate(_ *gorm.DB) error {
	if m.ID == 0 {
		m.ID = id.NextID()
	}
	return nil
}

type invitePO struct {
	ID             uint64              `gorm:"primaryKey;autoIncrement:false"`
	Token          string              `gorm:"size:512;uniqueIndex"`
	StationPeerID  string              `gorm:"size:255;index"`
	Label          string              `gorm:"size:255"`
	MaxClients     int32
	BandwidthLimit int64
	Status         domain.InviteStatus `gorm:"index"`
	ConsumedBy     string              `gorm:"size:255"`
	ConsumedAt     *time.Time
	ExpiresAt      time.Time `gorm:"index"`
	CreatedAt      time.Time `gorm:"autoCreateTime"`
	UpdatedAt      time.Time `gorm:"autoUpdateTime"`
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
		Label:          po.Label,
		Status:         po.Status,
		MaxClients:     po.MaxClients,
		BandwidthLimit: po.BandwidthLimit,
		InviteID:       po.InviteID,
		LastHeartbeat:  po.LastHeartbeat,
		MountedAt:      po.MountedAt,
		CreatedAt:      po.CreatedAt,
		UpdatedAt:      po.UpdatedAt,
	}
}

func toMountPO(m *domain.Mount) mountPO {
	return mountPO{
		ID:             m.ID,
		StationPeerID:  m.StationPeerID,
		Label:          m.Label,
		Status:         m.Status,
		MaxClients:     m.MaxClients,
		BandwidthLimit: m.BandwidthLimit,
		InviteID:       m.InviteID,
		LastHeartbeat:  m.LastHeartbeat,
		MountedAt:      m.MountedAt,
		CreatedAt:      m.CreatedAt,
		UpdatedAt:      m.UpdatedAt,
	}
}

func toDomainInvite(po invitePO) domain.Invite {
	return domain.Invite{
		ID:             po.ID,
		Token:          po.Token,
		StationPeerID:  po.StationPeerID,
		Label:          po.Label,
		MaxClients:     po.MaxClients,
		BandwidthLimit: po.BandwidthLimit,
		Status:         po.Status,
		ConsumedBy:     po.ConsumedBy,
		ConsumedAt:     po.ConsumedAt,
		ExpiresAt:      po.ExpiresAt,
		CreatedAt:      po.CreatedAt,
		UpdatedAt:      po.UpdatedAt,
	}
}

func toInvitePO(i *domain.Invite) invitePO {
	return invitePO{
		ID:             i.ID,
		Token:          i.Token,
		StationPeerID:  i.StationPeerID,
		Label:          i.Label,
		MaxClients:     i.MaxClients,
		BandwidthLimit: i.BandwidthLimit,
		Status:         i.Status,
		ConsumedBy:     i.ConsumedBy,
		ConsumedAt:     i.ConsumedAt,
		ExpiresAt:      i.ExpiresAt,
		CreatedAt:      i.CreatedAt,
		UpdatedAt:      i.UpdatedAt,
	}
}

// ---- GormRepo implements domain.Repository ----

var _ domain.Repository = (*GormRepo)(nil)

type GormRepo struct {
	db *gorm.DB
}

func NewGormRepo(db *gorm.DB) *GormRepo {
	return &GormRepo{db: db}
}

func (r *GormRepo) AutoMigrate() error {
	return r.db.AutoMigrate(&mountPO{}, &invitePO{})
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

func (r *GormRepo) GetInviteByToken(ctx context.Context, token string) (*domain.Invite, error) {
	var po invitePO
	if err := r.db.WithContext(ctx).Where("token = ?", token).First(&po).Error; err != nil {
		return nil, err
	}
	out := toDomainInvite(po)
	return &out, nil
}

// 2026-04-07: Block 5 — check RowsAffected to prevent silent no-op.
func (r *GormRepo) ConsumeInvite(ctx context.Context, inviteID uint64, stationPeerID string) error {
	now := time.Now()
	result := r.db.WithContext(ctx).Model(&invitePO{}).
		Where("id = ? AND status = ?", inviteID, domain.InviteStatusActive).
		Updates(map[string]interface{}{
			"status":      domain.InviteStatusConsumed,
			"consumed_by": stationPeerID,
			"consumed_at": &now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("%w: invite_id=%d", ErrInviteAlreadyConsumed, inviteID)
	}
	return nil
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
		Where("status = ? AND expires_at < ?", domain.InviteStatusActive, time.Now()).
		Update("status", domain.InviteStatusExpired)
	return result.RowsAffected, result.Error
}

// ---- Mount ----

func (r *GormRepo) CreateMount(ctx context.Context, mount *domain.Mount) error {
	po := toMountPO(mount)
	if err := r.db.WithContext(ctx).Create(&po).Error; err != nil {
		return err
	}
	mount.ID = po.ID
	mount.CreatedAt = po.CreatedAt
	mount.UpdatedAt = po.UpdatedAt
	return nil
}

func (r *GormRepo) GetMountByStationPeerID(ctx context.Context, stationPeerID string) (*domain.Mount, error) {
	var po mountPO
	if err := r.db.WithContext(ctx).Where("station_peer_id = ?", stationPeerID).First(&po).Error; err != nil {
		return nil, err
	}
	out := toDomainMount(po)
	return &out, nil
}

func (r *GormRepo) UpdateMountStatus(ctx context.Context, stationPeerID string, status domain.MountStatus) error {
	return r.db.WithContext(ctx).Model(&mountPO{}).
		Where("station_peer_id = ?", stationPeerID).
		Update("status", status).Error
}

func (r *GormRepo) UpdateHeartbeat(ctx context.Context, stationPeerID string) error {
	return r.db.WithContext(ctx).Model(&mountPO{}).
		Where("station_peer_id = ?", stationPeerID).
		Update("last_heartbeat", time.Now()).Error
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
	cutoff := time.Now().Add(-timeout)
	result := r.db.WithContext(ctx).Model(&mountPO{}).
		Where("status = ? AND last_heartbeat < ?", domain.MountStatusOnline, cutoff).
		Update("status", domain.MountStatusOffline)
	return result.RowsAffected, result.Error
}

func (r *GormRepo) DeleteMount(ctx context.Context, stationPeerID string) error {
	return r.db.WithContext(ctx).
		Where("station_peer_id = ?", stationPeerID).
		Delete(&mountPO{}).Error
}
