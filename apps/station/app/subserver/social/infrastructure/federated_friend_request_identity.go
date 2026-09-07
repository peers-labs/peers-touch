package infrastructure

import (
	"context"
	"crypto/ed25519"
	"errors"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

// GORMFriendRequestIdentityVerifier reads the Actor Identity-owned actor_devices
// projection without mutating it. Remote keys enter that table only through a
// verified profile or locator envelope.
type GORMFriendRequestIdentityVerifier struct {
	db *gorm.DB
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
	return &GORMFriendRequestIdentityVerifier{db: db}, nil
}

// VerifyFriendRequestCommandSignature binds a command to one active verified device.
func (v *GORMFriendRequestIdentityVerifier) VerifyFriendRequestCommandSignature(
	ctx context.Context,
	device *model.ActorDeviceRef,
	claimedHomeStationPeerID string,
	signingKeyID string,
	canonicalSigningBytes []byte,
	signature []byte,
) error {
	return verifyFriendRequestCommandSignature(
		ctx,
		v.db,
		device,
		claimedHomeStationPeerID,
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

	key, err := touchactor.NewDeviceStore(db).ResolveSigningKey(
		ctx,
		device.GetActor().GetPtid(),
		device.GetDeviceId(),
		signingKeyID,
	)
	if errors.Is(err, touchactor.ErrDeviceSigningKeyNotFound) {
		return domain.NewFederationError(
			domain.FederationErrorUnauthorized,
			operation,
			"authorizing_device",
			"is not registered",
		)
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
