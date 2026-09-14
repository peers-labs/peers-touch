package infrastructure

import (
	"context"
	"crypto/ed25519"
	"errors"

	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

// FriendRequestActorKeyResolver delegates verified device-key reads and remote
// profile hydration to the Actor Identity owner inside the Social transaction.
type FriendRequestActorKeyResolver interface {
	ResolveVerifiedActorDeviceSigningKey(
		ctx context.Context,
		transaction delivery.Transaction,
		actorPTID string,
		expectedHomeStationPeerID string,
		deviceID string,
		signingKeyID string,
	) (*model.VerifiedActorDeviceSigningKey, error)
}

func verifyFriendRequestCommandSignature(
	ctx context.Context,
	transaction delivery.Transaction,
	device *model.ActorDeviceRef,
	claimedHomeStationPeerID string,
	localStationPeerID string,
	actorKeys FriendRequestActorKeyResolver,
	signingKeyID string,
	canonicalSigningBytes []byte,
	signature []byte,
) error {
	const operation = "social.verify_friend_request_command_signature"
	if transaction == nil ||
		transaction.DB() == nil ||
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

	db := transaction.DB()
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
		if actorKeys == nil {
			return domain.NewFederationError(
				domain.FederationErrorIdentityUnavailable,
				operation,
				"actor_identity",
				"capability provider is unavailable",
			)
		}
		key, err = actorKeys.ResolveVerifiedActorDeviceSigningKey(
			ctx,
			transaction,
			device.GetActor().GetPtid(),
			claimedHomeStationPeerID,
			device.GetDeviceId(),
			signingKeyID,
		)
		if err != nil {
			return classifyFriendRequestActorKeyError(operation, err)
		}
		if key == nil ||
			key.GetActorPtid() != device.GetActor().GetPtid() ||
			key.GetActorDeviceId() != device.GetDeviceId() ||
			key.GetHomeStationPeerId() != claimedHomeStationPeerID ||
			key.GetSigningKeyId() != signingKeyID ||
			(key.GetVerificationSource() !=
				model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE &&
				key.GetVerificationSource() !=
					model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_LOCATOR) ||
			len(key.GetEd25519PublicKey()) != ed25519.PublicKeySize ||
			key.GetProfileVersion() <= 0 ||
			key.GetValidFromUnixMs() <= 0 ||
			key.GetRevokedAtUnixMs() != 0 {
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

func classifyFriendRequestActorKeyError(
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
