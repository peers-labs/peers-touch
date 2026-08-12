package infrastructure

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type EndpointDirectoryVersionModel struct {
	ActorPTID   string    `gorm:"column:actor_ptid;size:255;primaryKey"`
	Version     uint64    `gorm:"column:directory_version;not null"`
	StateSHA256 []byte    `gorm:"column:state_sha256;type:bytea;not null"`
	UpdatedAt   time.Time `gorm:"column:updated_at;not null"`
}

func (*EndpointDirectoryVersionModel) TableName() string {
	return "messaging_endpoint_directory_versions"
}

type FederatedEndpointManifestModel struct {
	ActorPTID        string    `gorm:"column:actor_ptid;size:255;primaryKey"`
	HomeStationID    string    `gorm:"column:home_station_id;size:255;primaryKey"`
	DirectoryVersion uint64    `gorm:"column:directory_version;not null"`
	ManifestBytes    []byte    `gorm:"column:manifest_bytes;type:bytea;not null"`
	ManifestSHA256   []byte    `gorm:"column:manifest_sha256;type:bytea;not null"`
	IssuedAt         time.Time `gorm:"column:issued_at;not null"`
	ExpiresAt        time.Time `gorm:"column:expires_at;not null;index"`
}

func (*FederatedEndpointManifestModel) TableName() string {
	return "federated_endpoint_manifests"
}

type EndpointManifestRepository struct {
	db *gorm.DB
}

const endpointManifestTTL = 5 * time.Minute

func NewEndpointManifestRepository(
	db *gorm.DB,
) (*EndpointManifestRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("messaging: endpoint manifest repository is not configured")
	}
	return &EndpointManifestRepository{db: db}, nil
}

func (r *EndpointManifestRepository) AutoMigrate() error {
	return r.db.AutoMigrate(
		&EndpointDirectoryVersionModel{},
		&FederatedEndpointManifestModel{},
	)
}

func (r *EndpointManifestRepository) BuildLocalManifestSnapshot(
	ctx context.Context,
	actorPTID string,
	homeStationID string,
	now time.Time,
) (*chat.FederatedEndpointManifest, error) {
	if actorPTID == "" || homeStationID == "" || now.IsZero() {
		return nil, messaging.ErrEndpointManifestInvalid
	}
	now = now.UTC().Truncate(time.Microsecond)
	var manifest *chat.FederatedEndpointManifest
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var devices []ActorDeviceReadModel
		if err := tx.
			Where(
				"ptid = ? AND home_station_peer_id = ? AND revoked = ? "+
					"AND verification_source = ? AND length(public_key) = ? "+
					"AND signing_key_id <> ''",
				actorPTID,
				homeStationID,
				false,
				int32(model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION),
				ed25519.PublicKeySize,
			).
			Order("device_id ASC").
			Find(&devices).Error; err != nil {
			return err
		}
		if len(devices) == 0 {
			return messaging.ErrNotFound
		}
		var identity ActorIdentityReadModel
		if err := tx.Where("ptid = ?", actorPTID).First(&identity).Error; err != nil {
			return mapNotFound(err)
		}
		if len(identity.PublicKey) != ed25519.PublicKeySize ||
			identity.ProfileVersion <= 0 {
			return messaging.ErrEndpointManifestInvalid
		}
		entries := make([]*chat.FederatedEndpointManifestEntry, 0, len(devices))
		for _, device := range devices {
			publicKeyHash := sha256.Sum256(device.PublicKey)
			materialHashes := [][]byte{publicKeyHash[:]}
			var keyPackages []MlsKeyPackageModel
			if err := tx.
				Select("data_sha256").
				Where(
					"ptid = ? AND device_id = ? AND length(data_sha256) = ?",
					actorPTID,
					device.DeviceID,
					sha256.Size,
				).
				Order("data_sha256 ASC").
				Find(&keyPackages).Error; err != nil {
				return err
			}
			for _, keyPackage := range keyPackages {
				materialHashes = append(
					materialHashes,
					append([]byte(nil), keyPackage.DataSHA256...),
				)
			}
			sort.Slice(materialHashes, func(i, j int) bool {
				return bytes.Compare(materialHashes[i], materialHashes[j]) < 0
			})
			materialHashes = deduplicateHashes(materialHashes)
			entries = append(entries, &chat.FederatedEndpointManifestEntry{
				Endpoint: &chat.CryptoEndpoint{
					Ptid:     actorPTID,
					DeviceId: device.DeviceID,
				},
				SigningKeyId:         device.SigningKeyID,
				PublicMaterialSha256: materialHashes,
			})
		}
		stateBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
			&chat.FederatedEndpointManifestSigningInput{
				FormatVersion:          application.EndpointManifestFormatVersion,
				ActorPtid:              actorPTID,
				HomeStationId:          homeStationID,
				ActiveEndpoints:        entries,
				ActorIdentityPublicKey: identity.PublicKey,
				ActorProfileVersion:    uint64(identity.ProfileVersion),
			},
		)
		if err != nil {
			return err
		}
		stateHash := sha256.Sum256(stateBytes)
		version, err := advanceEndpointDirectoryVersion(
			tx,
			actorPTID,
			stateHash[:],
			now,
		)
		if err != nil {
			return err
		}
		currentState := &chat.FederatedEndpointManifest{
			FormatVersion:          application.EndpointManifestFormatVersion,
			ActorPtid:              actorPTID,
			HomeStationId:          homeStationID,
			DirectoryVersion:       version,
			ActiveEndpoints:        entries,
			ActorIdentityPublicKey: append([]byte(nil), identity.PublicKey...),
			ActorProfileVersion:    uint64(identity.ProfileVersion),
		}
		var cached FederatedEndpointManifestModel
		cacheErr := tx.Where(
			"actor_ptid = ? AND home_station_id = ? AND directory_version = ? "+
				"AND expires_at > ?",
			actorPTID,
			homeStationID,
			version,
			now.Add(30*time.Second),
		).First(&cached).Error
		if cacheErr == nil {
			cachedManifest, decodeErr := decodeStoredManifest(cached, now)
			if decodeErr != nil {
				return decodeErr
			}
			if sameEndpointManifestState(cachedManifest, currentState) {
				manifest = cachedManifest
				return nil
			}
		} else if !errors.Is(cacheErr, gorm.ErrRecordNotFound) {
			return cacheErr
		}
		manifestID := uuid.NewSHA1(
			uuid.NameSpaceOID,
			append(
				[]byte(homeStationID+"\x00"+actorPTID+"\x00"),
				stateHash[:]...,
			),
		).String()
		manifest = &chat.FederatedEndpointManifest{
			FormatVersion:          application.EndpointManifestFormatVersion,
			ManifestId:             manifestID,
			ActorPtid:              actorPTID,
			HomeStationId:          homeStationID,
			DirectoryVersion:       version,
			ActiveEndpoints:        entries,
			IssuedAt:               timestamppb.New(now),
			ExpiresAt:              timestamppb.New(now.Add(endpointManifestTTL)),
			ActorIdentityPublicKey: append([]byte(nil), identity.PublicKey...),
			ActorProfileVersion:    uint64(identity.ProfileVersion),
		}
		return nil
	})
	return manifest, err
}

func (r *EndpointManifestRepository) SaveVerifiedManifest(
	ctx context.Context,
	manifest *chat.FederatedEndpointManifest,
	manifestBytes []byte,
	manifestSHA256 []byte,
) error {
	if manifest == nil ||
		len(manifestBytes) == 0 ||
		len(manifestSHA256) != sha256.Size ||
		manifest.IssuedAt == nil ||
		manifest.ExpiresAt == nil {
		return messaging.ErrEndpointManifestInvalid
	}
	actualHash := sha256.Sum256(manifestBytes)
	if !bytes.Equal(actualHash[:], manifestSHA256) {
		return messaging.ErrEndpointManifestInvalid
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := saveVerifiedManifestActorIdentity(tx, manifest); err != nil {
			return err
		}
		var existing FederatedEndpointManifestModel
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"actor_ptid = ? AND home_station_id = ?",
				manifest.ActorPtid,
				manifest.HomeStationId,
			).
			First(&existing).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			return tx.Create(manifestModel(manifest, manifestBytes, manifestSHA256)).Error
		case err != nil:
			return err
		case manifest.DirectoryVersion < existing.DirectoryVersion:
			return messaging.ErrEndpointManifestRollback
		case manifest.DirectoryVersion == existing.DirectoryVersion &&
			!bytes.Equal(existing.ManifestSHA256, manifestSHA256):
			var previous chat.FederatedEndpointManifest
			if unmarshalErr := proto.Unmarshal(existing.ManifestBytes, &previous); unmarshalErr != nil {
				return unmarshalErr
			}
			if !sameEndpointManifestState(&previous, manifest) {
				return messaging.ErrEndpointManifestConflict
			}
		}
		return tx.Model(&FederatedEndpointManifestModel{}).
			Where(
				"actor_ptid = ? AND home_station_id = ?",
				manifest.ActorPtid,
				manifest.HomeStationId,
			).
			Updates(map[string]any{
				"directory_version": manifest.DirectoryVersion,
				"manifest_bytes":    append([]byte(nil), manifestBytes...),
				"manifest_sha256":   append([]byte(nil), manifestSHA256...),
				"issued_at":         manifest.IssuedAt.AsTime().UTC(),
				"expires_at":        manifest.ExpiresAt.AsTime().UTC(),
			}).Error
	})
}

func saveVerifiedManifestActorIdentity(
	tx *gorm.DB,
	manifest *chat.FederatedEndpointManifest,
) error {
	if len(manifest.ActorIdentityPublicKey) != ed25519.PublicKeySize ||
		manifest.ActorProfileVersion == 0 ||
		manifest.ActorProfileVersion > uint64(1<<63-1) {
		return messaging.ErrEndpointManifestInvalid
	}
	now := manifest.IssuedAt.AsTime().UTC()
	fingerprint := sha256.Sum256(manifest.ActorIdentityPublicKey)
	var existing touchactor.ActorIdentityRecord
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("ptid = ?", manifest.ActorPtid).
		First(&existing).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return tx.Create(&touchactor.ActorIdentityRecord{
			PTID:           manifest.ActorPtid,
			PublicKey:      append([]byte(nil), manifest.ActorIdentityPublicKey...),
			Fingerprint:    fingerprint[:],
			ProfileVersion: int64(manifest.ActorProfileVersion),
			CreatedAt:      now,
			UpdatedAt:      now,
		}).Error
	case err != nil:
		return err
	case !bytes.Equal(existing.PublicKey, manifest.ActorIdentityPublicKey) ||
		!bytes.Equal(existing.Fingerprint, fingerprint[:]) ||
		manifest.ActorProfileVersion < uint64(existing.ProfileVersion):
		return messaging.ErrEndpointManifestConflict
	case manifest.ActorProfileVersion > uint64(existing.ProfileVersion):
		return tx.Model(&touchactor.ActorIdentityRecord{}).
			Where("ptid = ?", manifest.ActorPtid).
			Updates(map[string]any{
				"profile_version": int64(manifest.ActorProfileVersion),
				"updated_at":      now,
			}).Error
	default:
		return nil
	}
}

func (r *EndpointManifestRepository) ListVerifiedManifests(
	ctx context.Context,
	actorPTIDs []string,
	now time.Time,
) ([]*chat.FederatedEndpointManifest, error) {
	if len(actorPTIDs) == 0 || now.IsZero() {
		return nil, messaging.ErrEndpointManifestInvalid
	}
	actors := append([]string(nil), actorPTIDs...)
	sort.Strings(actors)
	actors = deduplicateStrings(actors)
	var models []FederatedEndpointManifestModel
	if err := r.db.WithContext(ctx).
		Where("actor_ptid IN ? AND expires_at >= ?", actors, now.UTC()).
		Order("actor_ptid ASC, home_station_id ASC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	if len(models) != len(actors) {
		return nil, messaging.ErrEndpointManifestExpired
	}
	manifests := make([]*chat.FederatedEndpointManifest, 0, len(models))
	for index, model := range models {
		if model.ActorPTID != actors[index] {
			return nil, messaging.ErrEndpointManifestConflict
		}
		manifest, err := decodeStoredManifest(model, now)
		if err != nil {
			return nil, err
		}
		manifests = append(manifests, manifest)
	}
	return manifests, nil
}

func (r *EndpointManifestRepository) HomeStationForEndpoint(
	ctx context.Context,
	endpoint *chat.CryptoEndpoint,
	now time.Time,
) (string, error) {
	if endpoint == nil || endpoint.Ptid == "" || endpoint.DeviceId == "" {
		return "", messaging.ErrEndpointManifestInvalid
	}
	manifests, err := r.ListVerifiedManifests(ctx, []string{endpoint.Ptid}, now)
	if err != nil {
		return "", err
	}
	for _, entry := range manifests[0].ActiveEndpoints {
		if entry.Endpoint != nil &&
			entry.Endpoint.Ptid == endpoint.Ptid &&
			entry.Endpoint.DeviceId == endpoint.DeviceId {
			return manifests[0].HomeStationId, nil
		}
	}
	return "", messaging.ErrEndpointManifestConflict
}

func advanceEndpointDirectoryVersion(
	tx *gorm.DB,
	actorPTID string,
	stateSHA256 []byte,
	now time.Time,
) (uint64, error) {
	var existing EndpointDirectoryVersionModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("actor_ptid = ?", actorPTID).
		First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		record := &EndpointDirectoryVersionModel{
			ActorPTID:   actorPTID,
			Version:     1,
			StateSHA256: append([]byte(nil), stateSHA256...),
			UpdatedAt:   now,
		}
		return record.Version, tx.Create(record).Error
	}
	if err != nil {
		return 0, err
	}
	if bytes.Equal(existing.StateSHA256, stateSHA256) {
		return existing.Version, nil
	}
	next := existing.Version + 1
	if err := tx.Model(&EndpointDirectoryVersionModel{}).
		Where("actor_ptid = ? AND directory_version = ?", actorPTID, existing.Version).
		Updates(map[string]any{
			"directory_version": next,
			"state_sha256":      append([]byte(nil), stateSHA256...),
			"updated_at":        now,
		}).Error; err != nil {
		return 0, err
	}
	return next, nil
}

func manifestModel(
	manifest *chat.FederatedEndpointManifest,
	manifestBytes []byte,
	manifestSHA256 []byte,
) *FederatedEndpointManifestModel {
	return &FederatedEndpointManifestModel{
		ActorPTID:        manifest.ActorPtid,
		HomeStationID:    manifest.HomeStationId,
		DirectoryVersion: manifest.DirectoryVersion,
		ManifestBytes:    append([]byte(nil), manifestBytes...),
		ManifestSHA256:   append([]byte(nil), manifestSHA256...),
		IssuedAt:         manifest.IssuedAt.AsTime().UTC(),
		ExpiresAt:        manifest.ExpiresAt.AsTime().UTC(),
	}
}

func decodeStoredManifest(
	model FederatedEndpointManifestModel,
	now time.Time,
) (*chat.FederatedEndpointManifest, error) {
	actualHash := sha256.Sum256(model.ManifestBytes)
	if len(model.ManifestSHA256) != sha256.Size ||
		!bytes.Equal(actualHash[:], model.ManifestSHA256) ||
		model.ExpiresAt.Before(now.UTC()) {
		return nil, messaging.ErrEndpointManifestInvalid
	}
	manifest := &chat.FederatedEndpointManifest{}
	if err := proto.Unmarshal(model.ManifestBytes, manifest); err != nil {
		return nil, err
	}
	if manifest.ActorPtid != model.ActorPTID ||
		manifest.HomeStationId != model.HomeStationID ||
		manifest.DirectoryVersion != model.DirectoryVersion {
		return nil, messaging.ErrEndpointManifestInvalid
	}
	return manifest, nil
}

func sameEndpointManifestState(
	left *chat.FederatedEndpointManifest,
	right *chat.FederatedEndpointManifest,
) bool {
	if left == nil || right == nil {
		return false
	}
	leftInput := &chat.FederatedEndpointManifestSigningInput{
		FormatVersion:          left.FormatVersion,
		ActorPtid:              left.ActorPtid,
		HomeStationId:          left.HomeStationId,
		DirectoryVersion:       left.DirectoryVersion,
		ActiveEndpoints:        left.ActiveEndpoints,
		ActorIdentityPublicKey: left.ActorIdentityPublicKey,
		ActorProfileVersion:    left.ActorProfileVersion,
	}
	rightInput := &chat.FederatedEndpointManifestSigningInput{
		FormatVersion:          right.FormatVersion,
		ActorPtid:              right.ActorPtid,
		HomeStationId:          right.HomeStationId,
		DirectoryVersion:       right.DirectoryVersion,
		ActiveEndpoints:        right.ActiveEndpoints,
		ActorIdentityPublicKey: right.ActorIdentityPublicKey,
		ActorProfileVersion:    right.ActorProfileVersion,
	}
	return proto.Equal(leftInput, rightInput)
}

func deduplicateHashes(values [][]byte) [][]byte {
	result := values[:0]
	for _, value := range values {
		if len(result) == 0 || !bytes.Equal(result[len(result)-1], value) {
			result = append(result, value)
		}
	}
	return result
}

func deduplicateStrings(values []string) []string {
	result := values[:0]
	for _, value := range values {
		if len(result) == 0 || result[len(result)-1] != value {
			result = append(result, value)
		}
	}
	return result
}

var _ messaging.EndpointManifestRepository = (*EndpointManifestRepository)(nil)
