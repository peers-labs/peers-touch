package actor_identity

import (
	"context"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	actoridentityinfrastructure "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type verifiedProfileDeviceKeyHydrator interface {
	Hydrate(
		ctx context.Context,
		actorPTID string,
		claimedHomeStationPeerID string,
	) ([]*actormodel.VerifiedActorDeviceSigningKey, error)
}

type verifiedProfileDeviceKeyHydratorFactory func(
	*gorm.DB,
) (verifiedProfileDeviceKeyHydrator, error)

type actorHomeStationResolver interface {
	ResolveActorHomeStationPeerID(context.Context, string) (string, error)
}

type actorCapabilities struct {
	endpointManifests *application.EndpointManifestService
	homeStations      actorHomeStationResolver
	localStationID    string
	hydratorFactory   verifiedProfileDeviceKeyHydratorFactory
}

func newActorCapabilities(
	endpointManifests *application.EndpointManifestService,
	homeStations actorHomeStationResolver,
	localStationID string,
	hydratorFactory verifiedProfileDeviceKeyHydratorFactory,
) (*actorCapabilities, error) {
	const operation = "actor_identity.new_capability_provider"

	if endpointManifests == nil || homeStations == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"identity_repository",
			"endpoint manifest and Home Station resolvers are required",
		)
	}
	if localStationID == "" || localStationID != strings.TrimSpace(localStationID) {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"local_station_peer_id",
			"is required and must be canonical",
		)
	}
	if hydratorFactory == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"verified_profile_hydrator_factory",
			"is required",
		)
	}

	return &actorCapabilities{
		endpointManifests: endpointManifests,
		homeStations:      homeStations,
		localStationID:    localStationID,
		hydratorFactory:   hydratorFactory,
	}, nil
}

func productionVerifiedProfileDeviceKeyHydratorFactory(
	db *gorm.DB,
) (verifiedProfileDeviceKeyHydrator, error) {
	return actoridentityinfrastructure.NewVerifiedProfileDeviceKeyHydrator(db)
}

func (c *actorCapabilities) GetEndpointManifest(
	ctx context.Context,
	sourceStationPeerID string,
	request *actormodel.GetActorEndpointManifestRequest,
) (*actormodel.GetActorEndpointManifestResponse, error) {
	if c == nil || c.endpointManifests == nil {
		return nil, domain.NewError(
			domain.ErrorCodeIdentityUnavailable,
			"actor_identity.get_endpoint_manifest",
			"capability_provider",
			"is not initialized",
		)
	}

	return c.endpointManifests.GetEndpointManifest(
		ctx,
		sourceStationPeerID,
		request,
	)
}

// ResolveActorHomeStationPeerID exposes Actor Identity-owned routing without
// assigning Actor lifecycle truth to a consuming subserver.
func (c *actorCapabilities) ResolveActorHomeStationPeerID(
	ctx context.Context,
	actorPTID string,
) (string, error) {
	if c == nil || c.homeStations == nil {
		return "", domain.NewError(
			domain.ErrorCodeIdentityUnavailable,
			"actor_identity.resolve_actor_home_station",
			"capability_provider",
			"is not initialized",
		)
	}

	return c.homeStations.ResolveActorHomeStationPeerID(ctx, actorPTID)
}

// ValidateEndpointManifest keeps Actor-owned manifest shape and freshness
// semantics behind the capability boundary.
func (c *actorCapabilities) ValidateEndpointManifest(
	manifest *actormodel.ActorEndpointManifest,
	expectedActorPTID string,
	expectedHomeStationPeerID string,
	now time.Time,
) error {
	if c == nil {
		return domain.NewError(
			domain.ErrorCodeIdentityUnavailable,
			"actor_identity.validate_endpoint_manifest",
			"capability_provider",
			"is not initialized",
		)
	}

	return application.ValidateEndpointManifest(
		manifest,
		expectedActorPTID,
		expectedHomeStationPeerID,
		now,
	)
}

// AcceptVerifiedEndpointManifest persists the verified Actor identity
// continuity key and routing fence after Station signature verification.
func (c *actorCapabilities) AcceptVerifiedEndpointManifest(
	ctx context.Context,
	manifest *actormodel.ActorEndpointManifest,
) error {
	if c == nil || c.endpointManifests == nil {
		return domain.NewError(
			domain.ErrorCodeIdentityUnavailable,
			"actor_identity.accept_endpoint_manifest",
			"capability_provider",
			"is not initialized",
		)
	}

	return c.endpointManifests.AcceptVerifiedEndpointManifest(ctx, manifest)
}

func (c *actorCapabilities) ResolveVerifiedActorDeviceSigningKey(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	actorPTID string,
	expectedHomeStationPeerID string,
	deviceID string,
	signingKeyID string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	const operation = "actor_identity.resolve_verified_actor_device_signing_key"

	if c == nil || transaction == nil || transaction.DB() == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"transaction",
			"is required",
		)
	}
	if err := domain.ValidatePTID(operation, actorPTID); err != nil {
		return nil, err
	}
	if err := domain.ValidateDeviceID(operation, deviceID); err != nil {
		return nil, err
	}
	if expectedHomeStationPeerID == "" ||
		expectedHomeStationPeerID != strings.TrimSpace(expectedHomeStationPeerID) {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"home_station_peer_id",
			"is required and must be canonical",
		)
	}
	if signingKeyID == "" || signingKeyID != strings.TrimSpace(signingKeyID) {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"signing_key_id",
			"is required and must be canonical",
		)
	}

	repository, err := persistence.NewRepository(transaction.DB())
	if err != nil {
		return nil, err
	}
	current, found, err := repository.ResolveVerifiedActorDeviceSigningKey(
		ctx,
		actorPTID,
		deviceID,
	)
	if err != nil {
		return nil, err
	}
	if found && current.GetSigningKeyId() != signingKeyID {
		return nil, domain.NewError(
			domain.ErrorCodeDeviceConflict,
			operation,
			"signing_key_id",
			"does not match the established Actor device",
		)
	}

	if found {
		if current.GetHomeStationPeerId() != expectedHomeStationPeerID {
			return nil, domain.NewError(
				domain.ErrorCodeIdentityConflict,
				operation,
				"home_station_peer_id",
				"does not match the established Actor device",
			)
		}
	}
	if expectedHomeStationPeerID == c.localStationID {
		if !found {
			return nil, nil
		}
		if current.GetVerificationSource() !=
			actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION {
			return nil, domain.NewError(
				domain.ErrorCodeInvalidProof,
				operation,
				"verification_source",
				"does not prove a local Actor device registration",
			)
		}

		return proto.Clone(current).(*actormodel.VerifiedActorDeviceSigningKey), nil
	}
	if found &&
		current.GetVerificationSource() !=
			actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE &&
		current.GetVerificationSource() !=
			actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_LOCATOR {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidProof,
			operation,
			"verification_source",
			"does not prove a remote Actor profile or locator",
		)
	}

	hydrator, err := c.hydratorFactory(transaction.DB())
	if err != nil {
		if domain.CodeOf(err) != "" {
			return nil, err
		}

		return nil, domain.WrapError(
			domain.ErrorCodeIdentityUnavailable,
			operation,
			err,
		)
	}
	if hydrator == nil {
		return nil, domain.NewError(
			domain.ErrorCodeIdentityUnavailable,
			operation,
			"verified_profile_hydrator",
			"is not configured",
		)
	}
	hydrated, err := hydrator.Hydrate(
		ctx,
		actorPTID,
		expectedHomeStationPeerID,
	)
	if err != nil {
		return nil, err
	}
	if err := repository.UpsertVerifiedRemoteDeviceSigningKeys(
		ctx,
		actorPTID,
		expectedHomeStationPeerID,
		hydrated,
	); err != nil {
		return nil, err
	}

	for _, key := range hydrated {
		if key != nil &&
			key.GetActorDeviceId() == deviceID &&
			key.GetSigningKeyId() == signingKeyID {
			persisted, persistedFound, resolveErr :=
				repository.ResolveVerifiedActorDeviceSigningKey(
					ctx,
					actorPTID,
					deviceID,
				)
			if resolveErr != nil {
				return nil, resolveErr
			}
			if !persistedFound ||
				persisted.GetSigningKeyId() != signingKeyID {
				return nil, domain.NewError(
					domain.ErrorCodePersistence,
					operation,
					"device_signing_key",
					"was not visible after verified profile persistence",
				)
			}

			return proto.Clone(persisted).(*actormodel.VerifiedActorDeviceSigningKey), nil
		}
	}

	return nil, nil
}
