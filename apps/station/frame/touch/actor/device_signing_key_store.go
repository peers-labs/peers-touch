package actor

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"errors"
	"time"

	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrDeviceSigningKeyNotFound = errors.New("actor: verified device signing key not found")
	ErrDeviceSigningKeyConflict = errors.New("actor: device signing key rotation proof required")
)

// DeviceRecord is the identity-owned registry for one actor device and its
// verified Ed25519 signing key.
type DeviceRecord struct {
	ID                 uint       `gorm:"column:id;primaryKey"`
	Ptid               string     `gorm:"column:ptid;size:255;index:idx_device_ptid;uniqueIndex:idx_device_ptid_device"`
	DeviceID           string     `gorm:"column:device_id;size:255;uniqueIndex:idx_device_ptid_device"`
	Label              string     `gorm:"column:label;size:255"`
	HomeStationPeerID  string     `gorm:"column:home_station_peer_id;size:255"`
	SigningKeyID       string     `gorm:"column:signing_key_id;size:255;index"`
	PublicKey          []byte     `gorm:"column:public_key;type:bytea"`
	ProfileVersion     int64      `gorm:"column:profile_version"`
	VerificationSource int32      `gorm:"column:verification_source"`
	Revoked            bool       `gorm:"column:revoked"`
	CreatedAt          time.Time  `gorm:"column:created_at"`
	RevokedAt          *time.Time `gorm:"column:revoked_at"`
}

func (*DeviceRecord) TableName() string { return "actor_devices" }

// DeviceStore persists and resolves verified actor-device signing keys.
type DeviceStore struct {
	db *gorm.DB
}

func NewDeviceStore(db *gorm.DB) *DeviceStore {
	return &DeviceStore{db: db}
}

func (s *DeviceStore) AutoMigrate() error {
	return s.db.AutoMigrate(&DeviceRecord{})
}

// RegisterLocal records a key asserted by an authenticated local actor.
func (s *DeviceStore) RegisterLocal(
	ctx context.Context,
	ptid string,
	deviceID string,
	label string,
	homeStationPeerID string,
	signingKeyID string,
	publicKey []byte,
	profileVersion int64,
) error {
	if signingKeyID == "" || len(publicKey) != ed25519.PublicKeySize {
		return s.upsertUnverifiedDevice(ctx, ptid, deviceID, label, homeStationPeerID)
	}
	record := &DeviceRecord{
		Ptid:               ptid,
		DeviceID:           deviceID,
		Label:              label,
		HomeStationPeerID:  homeStationPeerID,
		SigningKeyID:       signingKeyID,
		PublicKey:          publicKey,
		ProfileVersion:     profileVersion,
		VerificationSource: int32(model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION),
		CreatedAt:          time.Now(),
	}
	if err := s.rejectUnprovenRotation(ctx, record); err != nil {
		return err
	}
	return s.upsert(ctx, record)
}

// UpsertVerifiedRemote records a key from a verified profile or locator
// envelope. Callers must complete envelope verification before invoking it.
func (s *DeviceStore) UpsertVerifiedRemote(
	ctx context.Context,
	key *model.VerifiedActorDeviceSigningKey,
) error {
	if key == nil ||
		key.ActorPtid == "" ||
		key.ActorDeviceId == "" ||
		key.HomeStationPeerId == "" ||
		key.SigningKeyId == "" ||
		len(key.Ed25519PublicKey) != ed25519.PublicKeySize ||
		(key.VerificationSource != model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE &&
			key.VerificationSource != model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_LOCATOR) {
		return ErrDeviceSigningKeyNotFound
	}
	record := &DeviceRecord{
		Ptid:               key.ActorPtid,
		DeviceID:           key.ActorDeviceId,
		HomeStationPeerID:  key.HomeStationPeerId,
		SigningKeyID:       key.SigningKeyId,
		PublicKey:          key.Ed25519PublicKey,
		ProfileVersion:     key.ProfileVersion,
		VerificationSource: int32(key.VerificationSource),
		CreatedAt:          time.UnixMilli(key.ValidFromUnixMs),
	}
	if err := s.rejectUnprovenRotation(ctx, record); err != nil {
		return err
	}
	return s.upsert(ctx, record)
}

func (s *DeviceStore) upsertUnverifiedDevice(
	ctx context.Context,
	ptid string,
	deviceID string,
	label string,
	homeStationPeerID string,
) error {
	record := &DeviceRecord{
		Ptid:              ptid,
		DeviceID:          deviceID,
		Label:             label,
		HomeStationPeerID: homeStationPeerID,
		CreatedAt:         time.Now(),
	}
	return s.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "ptid"}, {Name: "device_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"label":      label,
				"revoked":    false,
				"revoked_at": nil,
			}),
		}).
		Create(record).Error
}

func (s *DeviceStore) rejectUnprovenRotation(
	ctx context.Context,
	candidate *DeviceRecord,
) error {
	var existing DeviceRecord
	err := s.db.WithContext(ctx).
		Where("ptid = ? AND device_id = ?", candidate.Ptid, candidate.DeviceID).
		First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if existing.VerificationSource ==
		int32(model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED) {
		return nil
	}
	if existing.SigningKeyID == candidate.SigningKeyID &&
		existing.HomeStationPeerID == candidate.HomeStationPeerID &&
		bytes.Equal(existing.PublicKey, candidate.PublicKey) &&
		candidate.ProfileVersion >= existing.ProfileVersion {
		return nil
	}
	return ErrDeviceSigningKeyConflict
}

func (s *DeviceStore) upsert(ctx context.Context, record *DeviceRecord) error {
	return s.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "ptid"}, {Name: "device_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"label",
				"home_station_peer_id",
				"signing_key_id",
				"public_key",
				"profile_version",
				"verification_source",
				"revoked",
				"revoked_at",
			}),
		}).
		Create(record).Error
}

// ResolveSigningKey returns one active, identity-verified device key.
func (s *DeviceStore) ResolveSigningKey(
	ctx context.Context,
	ptid string,
	deviceID string,
	signingKeyID string,
) (*model.VerifiedActorDeviceSigningKey, error) {
	var record DeviceRecord
	err := s.db.WithContext(ctx).
		Where(
			"ptid = ? AND device_id = ? AND signing_key_id = ? AND revoked = ?",
			ptid,
			deviceID,
			signingKeyID,
			false,
		).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrDeviceSigningKeyNotFound
	}
	if err != nil {
		return nil, err
	}
	if len(record.PublicKey) != ed25519.PublicKeySize ||
		record.VerificationSource == int32(model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED) {
		return nil, ErrDeviceSigningKeyNotFound
	}
	return &model.VerifiedActorDeviceSigningKey{
		ActorPtid:          record.Ptid,
		ActorDeviceId:      record.DeviceID,
		HomeStationPeerId:  record.HomeStationPeerID,
		SigningKeyId:       record.SigningKeyID,
		Ed25519PublicKey:   record.PublicKey,
		ProfileVersion:     record.ProfileVersion,
		VerificationSource: model.ActorSigningKeyVerificationSource(record.VerificationSource),
		ValidFromUnixMs:    record.CreatedAt.UnixMilli(),
	}, nil
}

func (s *DeviceStore) ListActive(ctx context.Context, ptid string) ([]DeviceRecord, error) {
	var records []DeviceRecord
	err := s.db.WithContext(ctx).
		Where("ptid = ? AND revoked = ?", ptid, false).
		Order("created_at ASC").
		Find(&records).Error
	return records, err
}

func (s *DeviceStore) Revoke(ctx context.Context, ptid string, deviceID string) error {
	now := time.Now()
	return s.db.WithContext(ctx).
		Model(&DeviceRecord{}).
		Where("ptid = ? AND device_id = ?", ptid, deviceID).
		Updates(map[string]any{
			"revoked":    true,
			"revoked_at": now,
		}).Error
}

func (s *DeviceStore) Count(ctx context.Context, ptid string) (int64, error) {
	var count int64
	err := s.db.WithContext(ctx).
		Model(&DeviceRecord{}).
		Where("ptid = ? AND revoked = ?", ptid, false).
		Count(&count).Error
	return count, err
}
