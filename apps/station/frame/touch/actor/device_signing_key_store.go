package actor

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrDeviceSigningKeyNotFound = errors.New("actor: verified device signing key not found")
	ErrDeviceSigningKeyConflict = errors.New("actor: device signing key rotation proof required")
	ErrActorIdentityConflict    = errors.New("actor: actor identity continuity mismatch")
	ErrDeviceEnrollmentProof    = errors.New("actor: device enrollment proof is invalid")
)

type ActorIdentityRecord struct {
	PTID           string    `gorm:"column:ptid;size:255;primaryKey"`
	PublicKey      []byte    `gorm:"column:public_key;type:bytea;not null"`
	Fingerprint    []byte    `gorm:"column:fingerprint;type:bytea;not null"`
	ProfileVersion int64     `gorm:"column:profile_version;not null"`
	CreatedAt      time.Time `gorm:"column:created_at;not null"`
	UpdatedAt      time.Time `gorm:"column:updated_at;not null"`
}

func (*ActorIdentityRecord) TableName() string { return "actor_identity_keys" }

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

type VerifiedLocalDeviceEnrollment struct {
	PTID                      string
	DeviceID                  string
	Label                     string
	HomeStationPeerID         string
	ActorIdentityPublicKey    []byte
	ActorIdentityFingerprint  []byte
	DeviceSigningPublicKey    []byte
	SigningKeyID              string
	ProfileVersion            uint64
	CanonicalCertificateBytes []byte
	ActorCrossSignature       []byte
}

// DeviceStore persists and resolves verified actor-device signing keys.
type DeviceStore struct {
	db *gorm.DB
}

func NewDeviceStore(db *gorm.DB) *DeviceStore {
	return &DeviceStore{db: db}
}

func (s *DeviceStore) AutoMigrate() error {
	return s.db.AutoMigrate(&ActorIdentityRecord{}, &DeviceRecord{})
}

func (s *DeviceStore) EnrollVerifiedLocal(
	ctx context.Context,
	input VerifiedLocalDeviceEnrollment,
) error {
	if input.PTID == "" ||
		input.DeviceID == "" ||
		input.HomeStationPeerID == "" ||
		len(input.ActorIdentityPublicKey) != ed25519.PublicKeySize ||
		len(input.ActorIdentityFingerprint) != sha256.Size ||
		len(input.DeviceSigningPublicKey) != ed25519.PublicKeySize ||
		input.SigningKeyID == "" ||
		input.ProfileVersion == 0 ||
		input.ProfileVersion > uint64(1<<63-1) ||
		len(input.CanonicalCertificateBytes) == 0 ||
		len(input.ActorCrossSignature) != ed25519.SignatureSize {
		return ErrDeviceEnrollmentProof
	}
	identityHash := sha256.Sum256(input.ActorIdentityPublicKey)
	deviceHash := sha256.Sum256(input.DeviceSigningPublicKey)
	if !bytes.Equal(identityHash[:], input.ActorIdentityFingerprint) ||
		hex.EncodeToString(deviceHash[:]) != input.SigningKeyID ||
		!ed25519.Verify(
			ed25519.PublicKey(input.ActorIdentityPublicKey),
			input.CanonicalCertificateBytes,
			input.ActorCrossSignature,
		) {
		return ErrDeviceEnrollmentProof
	}
	now := time.Now().UTC()
	profileVersion := int64(input.ProfileVersion)
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var identity ActorIdentityRecord
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("ptid = ?", input.PTID).
			First(&identity).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			if err := tx.Create(&ActorIdentityRecord{
				PTID:           input.PTID,
				PublicKey:      append([]byte(nil), input.ActorIdentityPublicKey...),
				Fingerprint:    append([]byte(nil), input.ActorIdentityFingerprint...),
				ProfileVersion: profileVersion,
				CreatedAt:      now,
				UpdatedAt:      now,
			}).Error; err != nil {
				return err
			}
		case err != nil:
			return err
		case !bytes.Equal(identity.PublicKey, input.ActorIdentityPublicKey) ||
			!bytes.Equal(identity.Fingerprint, input.ActorIdentityFingerprint) ||
			profileVersion < identity.ProfileVersion:
			return ErrActorIdentityConflict
		default:
			if profileVersion > identity.ProfileVersion {
				if err := tx.Model(&ActorIdentityRecord{}).
					Where("ptid = ?", input.PTID).
					Updates(map[string]any{
						"profile_version": profileVersion,
						"updated_at":      now,
					}).Error; err != nil {
					return err
				}
			}
		}

		var existing DeviceRecord
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("ptid = ? AND device_id = ?", input.PTID, input.DeviceID).
			First(&existing).Error
		if err == nil &&
			(existing.Revoked ||
				(existing.VerificationSource != int32(model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED) &&
					(existing.SigningKeyID != input.SigningKeyID ||
						!bytes.Equal(existing.PublicKey, input.DeviceSigningPublicKey) ||
						existing.HomeStationPeerID != input.HomeStationPeerID))) {
			return ErrDeviceSigningKeyConflict
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		record := &DeviceRecord{
			Ptid:               input.PTID,
			DeviceID:           input.DeviceID,
			Label:              input.Label,
			HomeStationPeerID:  input.HomeStationPeerID,
			SigningKeyID:       input.SigningKeyID,
			PublicKey:          append([]byte(nil), input.DeviceSigningPublicKey...),
			ProfileVersion:     profileVersion,
			VerificationSource: int32(model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION),
			Revoked:            false,
			CreatedAt:          now,
		}
		return tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "ptid"}, {Name: "device_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"label",
				"home_station_peer_id",
				"signing_key_id",
				"public_key",
				"profile_version",
				"verification_source",
			}),
		}).Create(record).Error
	})
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
		fmt.Printf("[DIAG] ResolveSigningKey NOT FOUND ptid=%q device=%q key=%q\n", ptid, deviceID, signingKeyID)
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

func (s *DeviceStore) IsVerifiedActive(
	ctx context.Context,
	ptid string,
	deviceID string,
) (bool, error) {
	if ptid == "" || deviceID == "" {
		return false, nil
	}
	var count int64
	err := s.db.WithContext(ctx).
		Model(&DeviceRecord{}).
		Where(
			"ptid = ? AND device_id = ? AND revoked = ? AND verification_source <> ? AND length(public_key) = ?",
			ptid,
			deviceID,
			false,
			int32(model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED),
			ed25519.PublicKeySize,
		).
		Count(&count).Error
	return count == 1, err
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
