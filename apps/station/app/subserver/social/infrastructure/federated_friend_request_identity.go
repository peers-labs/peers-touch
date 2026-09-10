package infrastructure

import (
	"context"
	"crypto/ed25519"
	"errors"

	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	actoridentityinfra "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure"
	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

// FriendRequestActorKeyHydrator delegates remote identity recovery to the
// Actor Identity owner using only PTID and the authenticated Home Station.
type FriendRequestActorKeyHydrator interface {
	Hydrate(
		ctx context.Context,
		actorPTID string,
		claimedHomeStationPeerID string,
	) ([]*model.VerifiedActorDeviceSigningKey, error)
}

// NewVerifiedFriendRequestActorKeyHydrator creates the Actor Identity-owned hydrator.
func NewVerifiedFriendRequestActorKeyHydrator(
	db *gorm.DB,
) (FriendRequestActorKeyHydrator, error) {
	if db == nil {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.new_friend_request_actor_key_hydrator",
			"db",
			"is required",
		)
	}

	hydrator, err := actoridentityinfra.NewVerifiedProfileDeviceKeyHydrator(db)
	if err != nil {
		return nil, classifyFriendRequestHydratorError(
			"social.new_friend_request_actor_key_hydrator",
			err,
		)
	}

	return hydrator, nil
}

// GORMFriendRequestIdentityVerifier reads the Actor Identity-owned actor_devices
// projection. A cold remote miss delegates only to Actor Identity hydration.
type GORMFriendRequestIdentityVerifier struct {
	db       *gorm.DB
	hydrator FriendRequestActorKeyHydrator
}

// NewGORMFriendRequestIdentityVerifier constructs the Social identity read adapter.
func NewGORMFriendRequestIdentityVerifier(
	db *gorm.DB,
) (*GORMFriendRequestIdentityVerifier, error) {
	if db == nil {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.new_friend_request_identity_verifier",
			"db",
			"is required",
		)
	}
	hydrator, err := actoridentityinfra.NewVerifiedProfileDeviceKeyHydrator(db)
	if err != nil {
		return nil, classifyFriendRequestHydratorError(
			"social.new_friend_request_identity_verifier",
			err,
		)
	}
	return &GORMFriendRequestIdentityVerifier{
		db:       db,
		hydrator: hydrator,
	}, nil
}

// WithActorKeyHydrator overrides profile hydration for composition or tests.
func (v *GORMFriendRequestIdentityVerifier) WithActorKeyHydrator(
	hydrator FriendRequestActorKeyHydrator,
) *GORMFriendRequestIdentityVerifier {
	v.hydrator = hydrator
	return v
}

// VerifyFriendRequestCommandSignature binds a command to one active verified device.
func (v *GORMFriendRequestIdentityVerifier) VerifyFriendRequestCommandSignature(
	ctx context.Context,
	device *model.ActorDeviceRef,
	claimedHomeStationPeerID string,
	localStationPeerID string,
	signingKeyID string,
	canonicalSigningBytes []byte,
	signature []byte,
) error {
	return verifyFriendRequestCommandSignature(
		ctx,
		v.db,
		device,
		claimedHomeStationPeerID,
		localStationPeerID,
		v.hydrator,
		signingKeyID,
		canonicalSigningBytes,
		signature,
	)
}

func verifyFriendRequestCommandSignature(
	ctx context.Context,
	db *gorm.DB,
	device *model.ActorDeviceRef,
	claimedHomeStationPeerID string,
	localStationPeerID string,
	hydrator FriendRequestActorKeyHydrator,
	signingKeyID string,
	canonicalSigningBytes []byte,
	signature []byte,
) error {
	const operation = "social.verify_friend_request_command_signature"
	if db == nil ||
		device == nil ||
		device.GetActor() == nil ||
		device.GetActor().GetPtid() == "" ||
		device.GetDeviceId() == "" ||
		claimedHomeStationPeerID == "" ||
		localStationPeerID == "" ||
		signingKeyID == "" ||
		len(canonicalSigningBytes) == 0 ||
		len(signature) != ed25519.SignatureSize {
		return domain.NewFederationError(
			domain.FederationErrorInvalidSignature,
			operation,
			"proof",
			"is incomplete",
		)
	}

	deviceStore := touchactor.NewDeviceStore(db)
	key, err := deviceStore.ResolveSigningKey(
		ctx,
		device.GetActor().GetPtid(),
		device.GetDeviceId(),
		signingKeyID,
	)
	if errors.Is(err, touchactor.ErrDeviceSigningKeyNotFound) {
		unavailableErr := classifyUnavailableFriendRequestSigningKey(
			ctx,
			db,
			device,
			claimedHomeStationPeerID,
			localStationPeerID,
			signingKeyID,
		)
		if domain.FederationErrorCodeOf(unavailableErr) !=
			domain.FederationErrorIdentityUnavailable {
			return unavailableErr
		}
	} else if err != nil {
		return domain.WrapFederationError(
			domain.FederationErrorPersistence,
			operation,
			err,
		)
	}
	if claimedHomeStationPeerID != localStationPeerID {
		key = nil
		if hydrator == nil {
			var hydrateErr error
			hydrator, hydrateErr =
				actoridentityinfra.NewVerifiedProfileDeviceKeyHydrator(db)
			if hydrateErr != nil {
				return classifyFriendRequestHydratorError(operation, hydrateErr)
			}
		}
		hydratedKeys, hydrateErr := hydrator.Hydrate(
			ctx,
			device.GetActor().GetPtid(),
			claimedHomeStationPeerID,
		)
		if hydrateErr != nil {
			return classifyFriendRequestHydratorError(operation, hydrateErr)
		}
		for _, hydratedKey := range hydratedKeys {
			if hydratedKey == nil ||
				hydratedKey.GetActorPtid() != device.GetActor().GetPtid() ||
				hydratedKey.GetActorDeviceId() == "" ||
				hydratedKey.GetHomeStationPeerId() != claimedHomeStationPeerID ||
				hydratedKey.GetSigningKeyId() == "" ||
				(hydratedKey.GetVerificationSource() !=
					model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE &&
					hydratedKey.GetVerificationSource() !=
						model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_LOCATOR) ||
				len(hydratedKey.GetEd25519PublicKey()) != ed25519.PublicKeySize ||
				hydratedKey.GetProfileVersion() <= 0 ||
				hydratedKey.GetValidFromUnixMs() <= 0 ||
				hydratedKey.GetRevokedAtUnixMs() != 0 {
				return domain.NewFederationError(
					domain.FederationErrorInvalidSignature,
					operation,
					"hydrated_identity",
					"does not match the verified actor and Home Station",
				)
			}
			if upsertErr := deviceStore.UpsertVerifiedRemote(
				ctx,
				hydratedKey,
			); upsertErr != nil {
				return classifyFriendRequestHydratorError(operation, upsertErr)
			}
			if hydratedKey.GetActorDeviceId() == device.GetDeviceId() &&
				hydratedKey.GetSigningKeyId() == signingKeyID {
				key = hydratedKey
			}
		}
		if key == nil ||
			key.GetActorDeviceId() != device.GetDeviceId() ||
			key.GetSigningKeyId() != signingKeyID {
			return domain.NewFederationError(
				domain.FederationErrorUnauthorized,
				operation,
				"authorizing_device",
				"is absent from the latest verified Home Station profile",
			)
		}
		err = nil
	}
	if err != nil {
		return domain.WrapFederationError(
			domain.FederationErrorPersistence,
			operation,
			err,
		)
	}
	if key.GetActorPtid() != device.GetActor().GetPtid() ||
		key.GetActorDeviceId() != device.GetDeviceId() ||
		key.GetHomeStationPeerId() != claimedHomeStationPeerID ||
		key.GetSigningKeyId() != signingKeyID ||
		!trustedActorSigningKeySource(key.GetVerificationSource()) ||
		len(key.GetEd25519PublicKey()) != ed25519.PublicKeySize ||
		!ed25519.Verify(
			ed25519.PublicKey(key.GetEd25519PublicKey()),
			canonicalSigningBytes,
			signature,
		) {
		return domain.NewFederationError(
			domain.FederationErrorInvalidSignature,
			operation,
			"actor_device_signature",
			"does not bind an active verified device at the claimed Home Station",
		)
	}
	return nil
}

func classifyFriendRequestHydratorError(
	operation string,
	err error,
) error {
	if err == nil {
		return nil
	}
	if domain.FederationErrorCodeOf(err) != "" {
		return err
	}
	if errors.Is(err, touchactor.ErrDeviceSigningKeyConflict) ||
		errors.Is(err, touchactor.ErrActorIdentityConflict) ||
		errors.Is(err, touchactor.ErrDeviceSigningKeyNotFound) {
		return domain.WrapFederationError(
			domain.FederationErrorInvalidSignature,
			operation,
			err,
		)
	}
	switch actoridentitydomain.CodeOf(err) {
	case actoridentitydomain.ErrorCodeIdentityUnavailable:
		return domain.WrapFederationError(
			domain.FederationErrorIdentityUnavailable,
			operation,
			err,
		)
	case actoridentitydomain.ErrorCodePersistence:
		return domain.WrapFederationError(
			domain.FederationErrorPersistence,
			operation,
			err,
		)
	case actoridentitydomain.ErrorCodeUnauthorized,
		actoridentitydomain.ErrorCodeDeviceRevoked:
		return domain.WrapFederationError(
			domain.FederationErrorUnauthorized,
			operation,
			err,
		)
	case actoridentitydomain.ErrorCodeInvalidArgument,
		actoridentitydomain.ErrorCodeInvalidProof,
		actoridentitydomain.ErrorCodeIdentityConflict,
		actoridentitydomain.ErrorCodeDeviceConflict,
		actoridentitydomain.ErrorCodeStaleProfileVersion,
		actoridentitydomain.ErrorCodeFutureProfileVersion,
		actoridentitydomain.ErrorCodeDeviceNotFound:
		return domain.WrapFederationError(
			domain.FederationErrorInvalidSignature,
			operation,
			err,
		)
	}
	return domain.WrapFederationError(
		domain.FederationErrorIdentityUnavailable,
		operation,
		err,
	)
}

func classifyUnavailableFriendRequestSigningKey(
	ctx context.Context,
	db *gorm.DB,
	device *model.ActorDeviceRef,
	claimedHomeStationPeerID string,
	localStationPeerID string,
	signingKeyID string,
) error {
	const operation = "social.verify_friend_request_command_signature"
	var record touchactor.DeviceRecord
	err := db.WithContext(ctx).
		Where(
			"ptid = ? AND device_id = ?",
			device.GetActor().GetPtid(),
			device.GetDeviceId(),
		).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if claimedHomeStationPeerID != localStationPeerID {
			return domain.NewFederationError(
				domain.FederationErrorIdentityUnavailable,
				operation,
				"authorizing_device",
				"remote identity projection is not available yet",
			)
		}
		return domain.NewFederationError(
			domain.FederationErrorUnauthorized,
			operation,
			"authorizing_device",
			"is not registered at its Home Station",
		)
	}
	if err != nil {
		return domain.WrapFederationError(
			domain.FederationErrorPersistence,
			operation,
			err,
		)
	}
	if record.Revoked {
		return domain.NewFederationError(
			domain.FederationErrorUnauthorized,
			operation,
			"authorizing_device",
			"is revoked",
		)
	}
	if !trustedActorSigningKeySource(
		model.ActorSigningKeyVerificationSource(record.VerificationSource),
	) || len(record.PublicKey) != ed25519.PublicKeySize {
		return domain.NewFederationError(
			domain.FederationErrorInvalidSignature,
			operation,
			"authorizing_device",
			"identity projection is not verified",
		)
	}
	if record.HomeStationPeerID != claimedHomeStationPeerID ||
		record.SigningKeyID != signingKeyID {
		return domain.NewFederationError(
			domain.FederationErrorInvalidSignature,
			operation,
			"authorizing_device",
			"does not match the verified identity projection",
		)
	}
	return domain.NewFederationError(
		domain.FederationErrorInvalidSignature,
		operation,
		"actor_device_signature",
		"does not verify against the active identity projection",
	)
}

func trustedActorSigningKeySource(
	source model.ActorSigningKeyVerificationSource,
) bool {
	switch source {
	case model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION,
		model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
		model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_LOCATOR:
		return true
	default:
		return false
	}
}
