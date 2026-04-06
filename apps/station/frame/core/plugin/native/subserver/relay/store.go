package relay

import (
	"context"
	"time"

	relaymodel "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/model"
	"gorm.io/gorm"
)

type relayStore struct {
	db *gorm.DB
}

func newRelayStore(db *gorm.DB) *relayStore {
	return &relayStore{db: db}
}

func (s *relayStore) AutoMigrate() error {
	return s.db.AutoMigrate(&relaymodel.RelayMount{}, &relaymodel.RelayInvite{})
}

func (s *relayStore) CreateInvite(ctx context.Context, invite *relaymodel.RelayInvite) error {
	return s.db.WithContext(ctx).Create(invite).Error
}

func (s *relayStore) GetInviteByToken(ctx context.Context, token string) (*relaymodel.RelayInvite, error) {
	var invite relaymodel.RelayInvite
	err := s.db.WithContext(ctx).Where("token = ?", token).First(&invite).Error
	if err != nil {
		return nil, err
	}
	return &invite, nil
}

func (s *relayStore) ConsumeInvite(ctx context.Context, inviteID uint64, stationPeerID string) error {
	now := time.Now()
	return s.db.WithContext(ctx).Model(&relaymodel.RelayInvite{}).
		Where("id = ? AND status = ?", inviteID, relaymodel.InviteStatusActive).
		Updates(map[string]interface{}{
			"status":      relaymodel.InviteStatusConsumed,
			"consumed_by": stationPeerID,
			"consumed_at": &now,
		}).Error
}

func (s *relayStore) CreateMount(ctx context.Context, mount *relaymodel.RelayMount) error {
	return s.db.WithContext(ctx).Create(mount).Error
}

func (s *relayStore) GetMountByStationPeerID(ctx context.Context, stationPeerID string) (*relaymodel.RelayMount, error) {
	var mount relaymodel.RelayMount
	err := s.db.WithContext(ctx).Where("station_peer_id = ?", stationPeerID).First(&mount).Error
	if err != nil {
		return nil, err
	}
	return &mount, nil
}

func (s *relayStore) UpdateMountStatus(ctx context.Context, stationPeerID string, status relaymodel.MountStatus) error {
	return s.db.WithContext(ctx).Model(&relaymodel.RelayMount{}).
		Where("station_peer_id = ?", stationPeerID).
		Update("status", status).Error
}

func (s *relayStore) UpdateHeartbeat(ctx context.Context, stationPeerID string) error {
	return s.db.WithContext(ctx).Model(&relaymodel.RelayMount{}).
		Where("station_peer_id = ?", stationPeerID).
		Update("last_heartbeat", time.Now()).Error
}

func (s *relayStore) ListOnlineMounts(ctx context.Context) ([]*relaymodel.RelayMount, error) {
	var mounts []*relaymodel.RelayMount
	err := s.db.WithContext(ctx).Where("status = ?", relaymodel.MountStatusOnline).Find(&mounts).Error
	return mounts, err
}

func (s *relayStore) CountOnlineMounts(ctx context.Context) (int64, error) {
	var count int64
	err := s.db.WithContext(ctx).Model(&relaymodel.RelayMount{}).
		Where("status = ?", relaymodel.MountStatusOnline).
		Count(&count).Error
	return count, err
}

func (s *relayStore) MarkStaleOffline(ctx context.Context, timeout time.Duration) (int64, error) {
	cutoff := time.Now().Add(-timeout)
	result := s.db.WithContext(ctx).Model(&relaymodel.RelayMount{}).
		Where("status = ? AND last_heartbeat < ?", relaymodel.MountStatusOnline, cutoff).
		Update("status", relaymodel.MountStatusOffline)
	return result.RowsAffected, result.Error
}

func (s *relayStore) ListInvites(ctx context.Context) ([]*relaymodel.RelayInvite, error) {
	var invites []*relaymodel.RelayInvite
	err := s.db.WithContext(ctx).Order("created_at DESC").Find(&invites).Error
	return invites, err
}

func (s *relayStore) RevokeInvite(ctx context.Context, inviteID uint64) error {
	return s.db.WithContext(ctx).Model(&relaymodel.RelayInvite{}).
		Where("id = ? AND status = ?", inviteID, relaymodel.InviteStatusActive).
		Update("status", relaymodel.InviteStatusRevoked).Error
}
