package persistence

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	localActorOrigin        = "local"
	remoteCachedActorOrigin = "remote_cached"
)

// BuildLocalEndpointManifestSnapshot reads one Actor-owned routing snapshot and
// advances its directory version in the same transaction.
func (r *Repository) BuildLocalEndpointManifestSnapshot(
	ctx context.Context,
	requestedActor *actormodel.ActorRef,
	homeStationPeerID string,
	issuedAt time.Time,
	expiresAt time.Time,
) (*actormodel.ActorEndpointManifest, error) {
	const operation = "actor_identity.build_local_endpoint_manifest"

	if r == nil || r.db == nil {
		return nil, domain.NewError(
			domain.ErrorCodePersistence,
			operation,
			"repository",
			"is not configured",
		)
	}
	if requestedActor == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"actor",
			"is required",
		)
	}
	if err := domain.ValidatePTID(operation, requestedActor.GetPtid()); err != nil {
		return nil, err
	}
	if homeStationPeerID == "" ||
		homeStationPeerID != strings.TrimSpace(homeStationPeerID) {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"home_station_peer_id",
			"is required and must be canonical",
		)
	}
	if issuedAt.IsZero() ||
		expiresAt.IsZero() ||
		!expiresAt.After(issuedAt) ||
		expiresAt.After(issuedAt.Add(time.Hour)) {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"manifest_lifetime",
			"must be positive and bounded to one hour",
		)
	}

	var manifest *actormodel.ActorEndpointManifest
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var identity ActorIdentityModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("ptid = ?", requestedActor.GetPtid()).
			First(&identity).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.NewError(
					domain.ErrorCodeDeviceNotFound,
					operation,
					"actor",
					"has no established identity",
				)
			}

			return err
		}
		if len(identity.PublicKey) != ed25519.PublicKeySize ||
			len(identity.Fingerprint) != sha256.Size ||
			identity.ProfileVersion <= 0 {
			return domain.NewError(
				domain.ErrorCodeInvalidProof,
				operation,
				"actor_identity",
				"is not a verified canonical identity",
			)
		}
		fingerprint := sha256.Sum256(identity.PublicKey)
		if !bytes.Equal(fingerprint[:], identity.Fingerprint) {
			return domain.NewError(
				domain.ErrorCodeIdentityConflict,
				operation,
				"actor_identity",
				"public key does not match its established fingerprint",
			)
		}

		var devices []ActorDeviceModel
		if err := tx.
			Where(
				"ptid = ? AND home_station_peer_id = ? AND revoked = ? "+
					"AND verification_source = ? AND length(public_key) = ? "+
					"AND signing_key_id <> ''",
				requestedActor.GetPtid(),
				homeStationPeerID,
				false,
				localVerificationSource,
				ed25519.PublicKeySize,
			).
			Order("device_id ASC").
			Find(&devices).Error; err != nil {
			return err
		}
		if len(devices) == 0 {
			return domain.NewError(
				domain.ErrorCodeDeviceNotFound,
				operation,
				"active_endpoints",
				"has no active locally verified device",
			)
		}

		actorKind := actormodel.ActorKind(devices[0].ActorKind)
		if requestedActor.GetKind() != actorKind {
			return domain.NewError(
				domain.ErrorCodeInvalidProof,
				operation,
				"actor.kind",
				"does not match the Actor Identity directory",
			)
		}
		manifestActor := &actormodel.ActorRef{
			Ptid: requestedActor.GetPtid(),
			Kind: actorKind,
		}
		entries := make(
			[]*actormodel.ActorEndpointManifestEntry,
			0,
			len(devices),
		)
		for _, device := range devices {
			if actormodel.ActorKind(device.ActorKind) != actorKind ||
				device.ProfileVersion <= 0 ||
				device.ProfileVersion > identity.ProfileVersion {
				return domain.NewError(
					domain.ErrorCodeIdentityConflict,
					operation,
					"active_endpoints",
					"contain inconsistent Actor identity metadata",
				)
			}
			publicKeyHash := sha256.Sum256(device.PublicKey)
			entries = append(entries, &actormodel.ActorEndpointManifestEntry{
				Endpoint: &actormodel.ActorDeviceRef{
					Actor:    proto.Clone(manifestActor).(*actormodel.ActorRef),
					DeviceId: device.DeviceID,
				},
				SigningKeyId: device.SigningKeyID,
				PublicMaterialSha256: [][]byte{
					append([]byte(nil), publicKeyHash[:]...),
				},
			})
		}

		stableState := &actormodel.ActorEndpointManifestSigningInput{
			FormatVersion:          application.EndpointManifestFormatVersion,
			Actor:                  proto.Clone(manifestActor).(*actormodel.ActorRef),
			HomeStationPeerId:      homeStationPeerID,
			ActiveEndpoints:        cloneManifestEntries(entries),
			ActorIdentityPublicKey: append([]byte(nil), identity.PublicKey...),
			ActorProfileVersion:    uint64(identity.ProfileVersion),
		}
		stateBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(stableState)
		if err != nil {
			return err
		}
		stateHash := sha256.Sum256(stateBytes)
		directoryVersion, err := advanceActorEndpointDirectoryVersion(
			tx,
			requestedActor.GetPtid(),
			stateHash[:],
			issuedAt.UTC(),
		)
		if err != nil {
			return err
		}
		manifestIdentity := homeStationPeerID + "\x00" +
			requestedActor.GetPtid() + "\x00" +
			strconv.FormatUint(directoryVersion, 10) + "\x00" +
			hex.EncodeToString(stateHash[:])
		manifest = &actormodel.ActorEndpointManifest{
			FormatVersion:          application.EndpointManifestFormatVersion,
			ManifestId:             uuid.NewSHA1(uuid.NameSpaceOID, []byte(manifestIdentity)).String(),
			Actor:                  manifestActor,
			HomeStationPeerId:      homeStationPeerID,
			DirectoryVersion:       directoryVersion,
			ActiveEndpoints:        entries,
			IssuedAt:               timestamppb.New(issuedAt.UTC()),
			ExpiresAt:              timestamppb.New(expiresAt.UTC()),
			ActorIdentityPublicKey: append([]byte(nil), identity.PublicKey...),
			ActorProfileVersion:    uint64(identity.ProfileVersion),
		}

		return nil
	})
	if err != nil {
		return nil, mapCapabilityPersistenceError(operation, err)
	}

	return proto.Clone(manifest).(*actormodel.ActorEndpointManifest), nil
}

// ResolveVerifiedActorDeviceSigningKey returns an exact verified key, including
// its revocation timestamp so callers can evaluate historical signatures.
func (r *Repository) ResolveVerifiedActorDeviceSigningKey(
	ctx context.Context,
	actorPTID string,
	deviceID string,
) (*actormodel.VerifiedActorDeviceSigningKey, bool, error) {
	const operation = "actor_identity.resolve_verified_device_signing_key"

	if r == nil || r.db == nil {
		return nil, false, domain.NewError(
			domain.ErrorCodePersistence,
			operation,
			"repository",
			"is not configured",
		)
	}
	if err := domain.ValidatePTID(operation, actorPTID); err != nil {
		return nil, false, err
	}
	if err := domain.ValidateDeviceID(operation, deviceID); err != nil {
		return nil, false, err
	}

	var record ActorDeviceModel
	err := r.db.WithContext(ctx).
		Where("ptid = ? AND device_id = ?", actorPTID, deviceID).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, mapCapabilityPersistenceError(operation, err)
	}
	key, err := verifiedSigningKeyFromModel(operation, record)
	if err != nil {
		return nil, false, err
	}

	return key, true, nil
}

// ResolveActorHomeStationPeerID returns one unambiguous Actor-owned route.
func (r *Repository) ResolveActorHomeStationPeerID(
	ctx context.Context,
	actorPTID string,
) (string, error) {
	const operation = "actor_identity.resolve_actor_home_station"

	if r == nil || r.db == nil {
		return "", domain.NewError(
			domain.ErrorCodePersistence,
			operation,
			"repository",
			"is not configured",
		)
	}
	if err := domain.ValidatePTID(operation, actorPTID); err != nil {
		return "", err
	}

	homeStations := make(map[string]struct{})
	var deviceRoutes []struct {
		HomeStationPeerID string `gorm:"column:home_station_peer_id"`
	}
	if err := r.db.WithContext(ctx).
		Model(&ActorDeviceModel{}).
		Distinct("home_station_peer_id").
		Where(
			"ptid = ? AND verification_source <> ? AND home_station_peer_id <> ''",
			actorPTID,
			int32(
				actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED,
			),
		).
		Find(&deviceRoutes).Error; err != nil {
		return "", mapCapabilityPersistenceError(operation, err)
	}
	for _, route := range deviceRoutes {
		if err := addCanonicalHomeStation(
			homeStations,
			route.HomeStationPeerID,
		); err != nil {
			return "", err
		}
	}

	if r.db.Migrator().HasTable("touch_actor") {
		var actorRoute struct {
			HomeStationPeerID string `gorm:"column:home_station_peer_id"`
			Origin            string `gorm:"column:origin"`
		}
		err := r.db.WithContext(ctx).
			Table("touch_actor").
			Select("home_station_peer_id", "origin").
			Where("ptid = ?", actorPTID).
			First(&actorRoute).Error
		switch {
		case err == nil:
			if actorRoute.Origin != localActorOrigin &&
				actorRoute.Origin != remoteCachedActorOrigin {
				return "", domain.NewError(
					domain.ErrorCodeInvalidProof,
					operation,
					"actor_origin",
					"is not a trusted Actor projection",
				)
			}
			if err := addCanonicalHomeStation(
				homeStations,
				actorRoute.HomeStationPeerID,
			); err != nil {
				return "", err
			}
		case errors.Is(err, gorm.ErrRecordNotFound):
		default:
			return "", mapCapabilityPersistenceError(operation, err)
		}
	}

	switch len(homeStations) {
	case 0:
		return "", domain.NewError(
			domain.ErrorCodeIdentityUnavailable,
			operation,
			"home_station_peer_id",
			"is not available from Actor Identity",
		)
	case 1:
		for homeStationPeerID := range homeStations {
			return homeStationPeerID, nil
		}
	default:
		return "", domain.NewError(
			domain.ErrorCodeIdentityConflict,
			operation,
			"home_station_peer_id",
			"has conflicting Actor Identity projections",
		)
	}

	return "", domain.NewError(
		domain.ErrorCodeIdentityUnavailable,
		operation,
		"home_station_peer_id",
		"is not available from Actor Identity",
	)
}

// UpsertVerifiedRemoteDeviceSigningKeys persists only keys already verified by
// the Actor Identity profile/locator chain.
func (r *Repository) UpsertVerifiedRemoteDeviceSigningKeys(
	ctx context.Context,
	actorPTID string,
	homeStationPeerID string,
	keys []*actormodel.VerifiedActorDeviceSigningKey,
) error {
	const operation = "actor_identity.persist_verified_remote_device_signing_keys"

	if r == nil || r.db == nil {
		return domain.NewError(
			domain.ErrorCodePersistence,
			operation,
			"repository",
			"is not configured",
		)
	}
	if err := domain.ValidatePTID(operation, actorPTID); err != nil {
		return err
	}
	if homeStationPeerID == "" ||
		homeStationPeerID != strings.TrimSpace(homeStationPeerID) {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"home_station_peer_id",
			"is required and must be canonical",
		)
	}

	for _, key := range keys {
		if err := validateVerifiedRemoteDeviceSigningKey(
			operation,
			actorPTID,
			homeStationPeerID,
			key,
		); err != nil {
			return err
		}
		candidate := ActorDeviceModel{
			PTID:               actorPTID,
			ActorAccount:       "",
			ActorKind:          int32(actormodel.ActorKind_ACTOR_KIND_UNSPECIFIED),
			DeviceID:           key.GetActorDeviceId(),
			Label:              "",
			HomeStationPeerID:  homeStationPeerID,
			SigningKeyID:       key.GetSigningKeyId(),
			PublicKey:          append([]byte(nil), key.GetEd25519PublicKey()...),
			ProfileVersion:     key.GetProfileVersion(),
			VerificationSource: int32(key.GetVerificationSource()),
			Revoked:            false,
			CreatedAt:          time.UnixMilli(key.GetValidFromUnixMs()).UTC(),
		}
		if err := r.db.WithContext(ctx).
			Clauses(clause.OnConflict{DoNothing: true}).
			Create(&candidate).Error; err != nil {
			return mapCapabilityPersistenceError(operation, err)
		}

		var existing ActorDeviceModel
		if err := r.db.WithContext(ctx).
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("ptid = ? AND device_id = ?", actorPTID, key.GetActorDeviceId()).
			First(&existing).Error; err != nil {
			return mapCapabilityPersistenceError(operation, err)
		}
		switch {
		case existing.Revoked:
			return domain.NewError(
				domain.ErrorCodeDeviceRevoked,
				operation,
				"device_id",
				"cannot be reactivated by a profile refresh",
			)
		case existing.HomeStationPeerID != "" &&
			existing.HomeStationPeerID != homeStationPeerID:
			return domain.NewError(
				domain.ErrorCodeIdentityConflict,
				operation,
				"home_station_peer_id",
				"does not match the established device route",
			)
		case existing.VerificationSource != int32(
			actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED,
		) &&
			(existing.SigningKeyID != key.GetSigningKeyId() ||
				!bytes.Equal(existing.PublicKey, key.GetEd25519PublicKey())):
			return domain.NewError(
				domain.ErrorCodeDeviceConflict,
				operation,
				"device_id",
				"is already bound to different verified signing material",
			)
		case key.GetProfileVersion() < existing.ProfileVersion:
			return domain.NewError(
				domain.ErrorCodeStaleProfileVersion,
				operation,
				"profile_version",
				"is older than the persisted device projection",
			)
		}

		result := r.db.WithContext(ctx).
			Model(&ActorDeviceModel{}).
			Where("id = ? AND revoked = ?", existing.ID, false).
			Updates(map[string]interface{}{
				"home_station_peer_id": homeStationPeerID,
				"signing_key_id":       key.GetSigningKeyId(),
				"public_key":           append([]byte(nil), key.GetEd25519PublicKey()...),
				"profile_version":      key.GetProfileVersion(),
				"verification_source":  int32(key.GetVerificationSource()),
			})
		if result.Error != nil {
			return mapCapabilityPersistenceError(operation, result.Error)
		}
		if result.RowsAffected != 1 {
			return domain.NewError(
				domain.ErrorCodeDeviceConflict,
				operation,
				"device_id",
				"changed while applying the verified profile",
			)
		}
	}

	return nil
}

func advanceActorEndpointDirectoryVersion(
	tx *gorm.DB,
	actorPTID string,
	stateSHA256 []byte,
	now time.Time,
) (uint64, error) {
	candidate := &ActorEndpointDirectoryVersionModel{
		ActorPTID:   actorPTID,
		Version:     1,
		StateSHA256: append([]byte(nil), stateSHA256...),
		UpdatedAt:   now,
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
		Create(candidate).Error; err != nil {
		return 0, err
	}

	var current ActorEndpointDirectoryVersionModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("actor_ptid = ?", actorPTID).
		First(&current).Error; err != nil {
		return 0, err
	}
	if bytes.Equal(current.StateSHA256, stateSHA256) {
		return current.Version, nil
	}

	nextVersion := current.Version + 1
	result := tx.Model(&ActorEndpointDirectoryVersionModel{}).
		Where(
			"actor_ptid = ? AND directory_version = ?",
			actorPTID,
			current.Version,
		).
		Updates(map[string]interface{}{
			"directory_version": nextVersion,
			"state_sha256":      append([]byte(nil), stateSHA256...),
			"updated_at":        now,
		})
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected != 1 {
		return 0, domain.NewError(
			domain.ErrorCodeIdentityConflict,
			"actor_identity.advance_endpoint_directory_version",
			"directory_version",
			"changed concurrently",
		)
	}

	return nextVersion, nil
}

func verifiedSigningKeyFromModel(
	operation string,
	record ActorDeviceModel,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	source := actormodel.ActorSigningKeyVerificationSource(record.VerificationSource)
	if record.PTID == "" ||
		record.DeviceID == "" ||
		record.HomeStationPeerID == "" ||
		record.SigningKeyID == "" ||
		len(record.PublicKey) != ed25519.PublicKeySize ||
		record.ProfileVersion <= 0 ||
		record.CreatedAt.IsZero() ||
		!trustedSigningKeySource(source) ||
		(record.Revoked && record.RevokedAt == nil) ||
		(!record.Revoked && record.RevokedAt != nil) {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidProof,
			operation,
			"device_signing_key",
			"is not a canonical verified projection",
		)
	}
	key := &actormodel.VerifiedActorDeviceSigningKey{
		ActorPtid:          record.PTID,
		ActorDeviceId:      record.DeviceID,
		HomeStationPeerId:  record.HomeStationPeerID,
		SigningKeyId:       record.SigningKeyID,
		Ed25519PublicKey:   append([]byte(nil), record.PublicKey...),
		ProfileVersion:     record.ProfileVersion,
		VerificationSource: source,
		ValidFromUnixMs:    record.CreatedAt.UTC().UnixMilli(),
	}
	if record.RevokedAt != nil {
		key.RevokedAtUnixMs = record.RevokedAt.UTC().UnixMilli()
	}

	return key, nil
}

func validateVerifiedRemoteDeviceSigningKey(
	operation string,
	actorPTID string,
	homeStationPeerID string,
	key *actormodel.VerifiedActorDeviceSigningKey,
) error {
	if key == nil ||
		key.GetActorPtid() != actorPTID ||
		key.GetActorDeviceId() == "" ||
		key.GetActorDeviceId() != strings.TrimSpace(key.GetActorDeviceId()) ||
		key.GetHomeStationPeerId() != homeStationPeerID ||
		key.GetSigningKeyId() == "" ||
		key.GetSigningKeyId() != strings.TrimSpace(key.GetSigningKeyId()) ||
		len(key.GetEd25519PublicKey()) != ed25519.PublicKeySize ||
		key.GetProfileVersion() <= 0 ||
		key.GetValidFromUnixMs() <= 0 ||
		key.GetRevokedAtUnixMs() != 0 ||
		(key.GetVerificationSource() !=
			actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE &&
			key.GetVerificationSource() !=
				actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_LOCATOR) {
		return domain.NewError(
			domain.ErrorCodeInvalidProof,
			operation,
			"device_signing_key",
			"does not match the verified Actor and Home Station",
		)
	}
	if err := domain.ValidateDeviceID(operation, key.GetActorDeviceId()); err != nil {
		return err
	}

	return nil
}

func trustedSigningKeySource(
	source actormodel.ActorSigningKeyVerificationSource,
) bool {
	switch source {
	case actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION,
		actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
		actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_LOCATOR:
		return true
	default:
		return false
	}
}

func addCanonicalHomeStation(
	homeStations map[string]struct{},
	homeStationPeerID string,
) error {
	const operation = "actor_identity.resolve_actor_home_station"

	if homeStationPeerID == "" ||
		homeStationPeerID != strings.TrimSpace(homeStationPeerID) {
		return domain.NewError(
			domain.ErrorCodeInvalidProof,
			operation,
			"home_station_peer_id",
			"is not canonical",
		)
	}
	homeStations[homeStationPeerID] = struct{}{}
	if len(homeStations) > 1 {
		return domain.NewError(
			domain.ErrorCodeIdentityConflict,
			operation,
			"home_station_peer_id",
			"has conflicting Actor Identity projections",
		)
	}

	return nil
}

func cloneManifestEntries(
	entries []*actormodel.ActorEndpointManifestEntry,
) []*actormodel.ActorEndpointManifestEntry {
	cloned := make([]*actormodel.ActorEndpointManifestEntry, 0, len(entries))
	for _, entry := range entries {
		cloned = append(
			cloned,
			proto.Clone(entry).(*actormodel.ActorEndpointManifestEntry),
		)
	}

	return cloned
}

func mapCapabilityPersistenceError(operation string, err error) error {
	if err == nil || domain.CodeOf(err) != "" {
		return err
	}

	return domain.WrapError(domain.ErrorCodePersistence, operation, err)
}

var _ application.EndpointManifestRepository = (*Repository)(nil)
