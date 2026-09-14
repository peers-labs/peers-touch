package application

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	"google.golang.org/protobuf/proto"
)

const (
	publishContentPreKeysOperation   = "key_exchange.publish_content_prekeys"
	inventoryContentPreKeysOperation = "key_exchange.inventory_content_prekeys"
	claimContentPreKeysOperation     = "key_exchange.claim_content_prekeys"
)

// ContentPreKeyStore owns the durable Content-only pool and exact claim
// receipt lifecycle. Direct and MLS material never implements this port.
type ContentPreKeyStore interface {
	PublishContentPreKeys(
		ctx context.Context,
		publication domain.ContentPreKeyPublication,
		publishedAt time.Time,
	) (domain.ContentPreKeyInventory, error)
	ContentPreKeyInventory(
		ctx context.Context,
		publisher domain.Endpoint,
		principal domain.ContentPreKeyPrincipal,
		observedAt time.Time,
	) (domain.ContentPreKeyInventory, error)
	ClaimContentPreKeys(
		ctx context.Context,
		request *securecontentpb.ClaimContentPreKeysRequest,
		principals []domain.ContentPreKeyPrincipal,
		claimedAt time.Time,
	) (*securecontentpb.ClaimContentPreKeysResponse, error)
}

// ContentPreKeyService is the Key Exchange application boundary consumed by
// Social prepare and by the operational Development driver.
type ContentPreKeyService struct {
	store ContentPreKeyStore
	clock Clock
}

func NewContentPreKeyService(
	store ContentPreKeyStore,
	clock Clock,
) (*ContentPreKeyService, error) {
	if store == nil || clock == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"key_exchange.new_content_prekey_service",
			"dependencies",
			"store and clock are required",
		)
	}
	return &ContentPreKeyService{
		store: store,
		clock: clock,
	}, nil
}

func (s *ContentPreKeyService) PublishContentPreKeys(
	ctx context.Context,
	authenticatedPublisher domain.Endpoint,
	request *securecontentpb.PublishContentPreKeysRequest,
) (domain.ContentPreKeyInventory, error) {
	publication, err := domain.NormalizePublishContentPreKeysRequest(
		publishContentPreKeysOperation,
		authenticatedPublisher,
		request,
	)
	if err != nil {
		return domain.ContentPreKeyInventory{}, err
	}
	inventory, err := s.store.PublishContentPreKeys(
		ctx,
		publication,
		s.now(),
	)
	if err != nil {
		return domain.ContentPreKeyInventory{},
			wrapStoreError(publishContentPreKeysOperation, err)
	}
	if err := validateContentPreKeyInventory(
		publishContentPreKeysOperation,
		inventory,
		publication.Principal,
	); err != nil {
		return domain.ContentPreKeyInventory{}, err
	}
	return inventory, nil
}

func (s *ContentPreKeyService) ContentPreKeyInventory(
	ctx context.Context,
	authenticatedPublisher domain.Endpoint,
	target *securecontentpb.ContentPreKeyClaimTarget,
) (domain.ContentPreKeyInventory, error) {
	if err := authenticatedPublisher.Validate(
		inventoryContentPreKeysOperation,
	); err != nil {
		return domain.ContentPreKeyInventory{}, err
	}
	principal, err := domain.ContentPreKeyPrincipalFromTarget(
		inventoryContentPreKeysOperation,
		target,
	)
	if err != nil {
		return domain.ContentPreKeyInventory{}, err
	}
	if principal.ActorPTID != authenticatedPublisher.ActorPTID ||
		(principal.Kind ==
			securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT &&
			principal.DeviceID != authenticatedPublisher.DeviceID) {
		return domain.ContentPreKeyInventory{}, domain.NewError(
			domain.ErrorCodeUnauthorized,
			inventoryContentPreKeysOperation,
			"principal",
			"does not belong to the authenticated endpoint",
		)
	}
	inventory, err := s.store.ContentPreKeyInventory(
		ctx,
		authenticatedPublisher,
		principal,
		s.now(),
	)
	if err != nil {
		return domain.ContentPreKeyInventory{},
			wrapStoreError(inventoryContentPreKeysOperation, err)
	}
	if err := validateContentPreKeyInventory(
		inventoryContentPreKeysOperation,
		inventory,
		principal,
	); err != nil {
		return domain.ContentPreKeyInventory{}, err
	}
	return inventory, nil
}

func (s *ContentPreKeyService) ClaimContentPreKeys(
	ctx context.Context,
	request *securecontentpb.ClaimContentPreKeysRequest,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	normalized, principals, err := domain.NormalizeContentPreKeyClaimRequest(
		claimContentPreKeysOperation,
		request,
	)
	if err != nil {
		return nil, err
	}
	response, err := s.store.ClaimContentPreKeys(
		ctx,
		normalized,
		principals,
		s.now(),
	)
	if err != nil {
		return nil, wrapStoreError(claimContentPreKeysOperation, err)
	}
	if err := validateContentPreKeyClaims(
		claimContentPreKeysOperation,
		response,
		principals,
	); err != nil {
		return nil, err
	}
	return proto.Clone(response).(*securecontentpb.ClaimContentPreKeysResponse), nil
}

func (s *ContentPreKeyService) now() time.Time {
	return s.clock.Now().UTC().Truncate(time.Microsecond)
}

func validateContentPreKeyInventory(
	operation string,
	inventory domain.ContentPreKeyInventory,
	principal domain.ContentPreKeyPrincipal,
) error {
	if inventory.Principal != principal ||
		inventory.CurrentEpoch == 0 ||
		inventory.Available < 0 ||
		inventory.Available > domain.MaxContentPreKeysPerPool ||
		inventory.Capacity != domain.MaxContentPreKeysPerPool ||
		inventory.ReplenishAtOrBelow !=
			domain.ContentPreKeyReplenishThreshold ||
		inventory.NeedsReplenishment !=
			(inventory.Available <= domain.ContentPreKeyReplenishThreshold) {
		return domain.NewError(
			domain.ErrorCodeInternal,
			operation,
			"inventory",
			"store returned an invalid Content PreKey inventory",
		)
	}
	return nil
}

func validateContentPreKeyClaims(
	operation string,
	response *securecontentpb.ClaimContentPreKeysResponse,
	principals []domain.ContentPreKeyPrincipal,
) error {
	if response == nil || len(response.GetClaims()) != len(principals) {
		return domain.NewError(
			domain.ErrorCodeInternal,
			operation,
			"response",
			"does not contain exactly one claim per target",
		)
	}
	claimIDs := make(map[string]struct{}, len(response.GetClaims()))
	keyIDs := make(map[string]struct{}, len(response.GetClaims()))
	for index, claim := range response.GetClaims() {
		if err := domain.ValidateClaimedContentPreKey(operation, claim); err != nil {
			return err
		}
		principal, err := domain.ContentPreKeyPrincipalFromTarget(
			operation,
			claim.GetTarget(),
		)
		if err != nil {
			return err
		}
		if principal != principals[index] {
			return domain.NewError(
				domain.ErrorCodeInternal,
				operation,
				"claims",
				"are not in deterministic target order",
			)
		}
		if _, duplicate := claimIDs[claim.GetClaimId()]; duplicate {
			return domain.NewError(
				domain.ErrorCodeInternal,
				operation,
				"claims.claim_id",
				"contains a duplicate claim",
			)
		}
		claimIDs[claim.GetClaimId()] = struct{}{}
		keyIdentity := principal.Key() + "\x00" + claim.GetPrekey().GetKeyId()
		if _, duplicate := keyIDs[keyIdentity]; duplicate {
			return domain.NewError(
				domain.ErrorCodeInternal,
				operation,
				"claims.prekey.key_id",
				"contains a duplicate claimed key",
			)
		}
		keyIDs[keyIdentity] = struct{}{}
	}
	return nil
}
