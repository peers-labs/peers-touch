package identity

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"sort"

	actoridentity "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	conversationports "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

// Directory adapts the Actor Identity-owned tables to Conversation read ports.
type Directory struct {
	db *gorm.DB
}

func NewDirectory(db *gorm.DB) (*Directory, error) {
	if db == nil {
		return nil, fmt.Errorf("conversation identity directory: database is required")
	}
	return &Directory{db: db}, nil
}

func (d *Directory) IsActive(ctx context.Context, endpoint valueobject.Endpoint) (bool, error) {
	if err := endpoint.Validate(); err != nil {
		return false, err
	}
	var count int64
	err := d.db.WithContext(ctx).
		Model(&actoridentity.ActorDeviceModel{}).
		Where(
			"ptid = ? AND device_id = ? AND revoked = ? AND verification_source <> ? AND length(public_key) = ?",
			string(endpoint.Actor),
			string(endpoint.Device),
			false,
			0,
			ed25519.PublicKeySize,
		).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("conversation identity directory: check active endpoint: %w", err)
	}
	return count == 1, nil
}

func (d *Directory) ActorIdentityPublicKey(
	ctx context.Context,
	actor valueobject.PTID,
) ([]byte, error) {
	var identity actoridentity.ActorIdentityModel
	if err := d.db.WithContext(ctx).
		First(&identity, "ptid = ?", string(actor)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeActorKeyUnavailable,
				"identity.actor_public_key",
				"ptid",
				"has no verified identity key",
			)
		}
		return nil, fmt.Errorf("conversation identity directory: load actor key: %w", err)
	}
	if len(identity.PublicKey) != ed25519.PublicKeySize {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeActorKeyUnavailable,
			"identity.actor_public_key",
			"public_key",
			"is not a valid Ed25519 key",
		)
	}
	return append([]byte(nil), identity.PublicKey...), nil
}

func (d *Directory) VerifyDeviceSignature(
	ctx context.Context,
	endpoint valueobject.Endpoint,
	signingKeyID string,
	payload []byte,
	signature []byte,
) (conversationports.DeviceSignatureVerification, error) {
	var device actoridentity.ActorDeviceModel
	err := d.db.WithContext(ctx).
		Where(
			"ptid = ? AND device_id = ? AND signing_key_id = ? AND verification_source <> ?",
			string(endpoint.Actor),
			string(endpoint.Device),
			signingKeyID,
			0,
		).
		First(&device).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return conversationports.DeviceSignatureVerification{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeActorKeyUnavailable,
			"identity.verify_device_signature",
			"signing_key_id",
			"is unavailable",
		)
	}
	if err != nil {
		return conversationports.DeviceSignatureVerification{}, fmt.Errorf(
			"conversation identity directory: load device key: %w",
			err,
		)
	}
	if len(device.PublicKey) != ed25519.PublicKeySize ||
		len(signature) != ed25519.SignatureSize ||
		!ed25519.Verify(ed25519.PublicKey(device.PublicKey), payload, signature) {
		return conversationports.DeviceSignatureVerification{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalSignature,
			"identity.verify_device_signature",
			"signature",
			"is invalid",
		)
	}
	return conversationports.DeviceSignatureVerification{KeyRevoked: device.Revoked}, nil
}

func (d *Directory) ListActiveEndpoints(
	ctx context.Context,
	actors []valueobject.PTID,
) ([]conversationports.EndpointRoute, error) {
	if len(actors) == 0 {
		return []conversationports.EndpointRoute{}, nil
	}
	values := make([]string, 0, len(actors))
	for _, actor := range actors {
		if actor != "" {
			values = append(values, string(actor))
		}
	}
	var devices []actoridentity.ActorDeviceModel
	if err := d.db.WithContext(ctx).
		Where(
			"ptid IN ? AND revoked = ? AND verification_source <> ? AND length(public_key) = ?",
			values,
			false,
			0,
			ed25519.PublicKeySize,
		).
		Find(&devices).Error; err != nil {
		return nil, fmt.Errorf("conversation identity directory: list active endpoints: %w", err)
	}
	routes := make([]conversationports.EndpointRoute, 0, len(devices))
	for _, device := range devices {
		routes = append(routes, conversationports.EndpointRoute{
			Endpoint: valueobject.Endpoint{
				Actor:  valueobject.PTID(device.PTID),
				Device: valueobject.DeviceID(device.DeviceID),
			},
			HomeStation: valueobject.StationID(device.HomeStationPeerID),
		})
	}
	sort.Slice(routes, func(left, right int) bool {
		return routes[left].Endpoint.Key() < routes[right].Endpoint.Key()
	})
	return routes, nil
}

// ResolveVerifiedActorDeviceSigningKey reads the same Actor Identity truth in
// the shared Federation receiver transaction.
func (d *Directory) ResolveVerifiedActorDeviceSigningKey(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	actorPTID string,
	expectedHomeStationPeerID string,
	deviceID string,
	signingKeyID string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	if transaction == nil || transaction.DB() == nil {
		return nil, fmt.Errorf("conversation identity directory: federation transaction is required")
	}
	var device actoridentity.ActorDeviceModel
	err := transaction.DB().WithContext(ctx).
		Where(
			"ptid = ? AND device_id = ? AND signing_key_id = ? AND verification_source <> ?",
			actorPTID,
			deviceID,
			signingKeyID,
			0,
		).
		First(&device).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if device.HomeStationPeerID != expectedHomeStationPeerID ||
		len(device.PublicKey) != ed25519.PublicKeySize {
		return nil, nil
	}
	result := &actormodel.VerifiedActorDeviceSigningKey{
		ActorPtid:          device.PTID,
		ActorDeviceId:      device.DeviceID,
		HomeStationPeerId:  device.HomeStationPeerID,
		SigningKeyId:       device.SigningKeyID,
		Ed25519PublicKey:   append([]byte(nil), device.PublicKey...),
		ProfileVersion:     device.ProfileVersion,
		VerificationSource: actormodel.ActorSigningKeyVerificationSource(device.VerificationSource),
		ValidFromUnixMs:    device.CreatedAt.UTC().UnixMilli(),
	}
	if device.RevokedAt != nil {
		result.RevokedAtUnixMs = device.RevokedAt.UTC().UnixMilli()
	}
	return result, nil
}

var _ conversationports.IdentityDirectory = (*Directory)(nil)
