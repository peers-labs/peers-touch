package key_exchange

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// ContentPreKeyCapabilities is the internal Key Exchange boundary used by
// domain-owned prepare workflows. It intentionally registers no public route.
type ContentPreKeyCapabilities interface {
	PublishContentPreKeys(
		context.Context,
		*actormodel.ActorDeviceRef,
		*securecontentpb.PublishContentPreKeysRequest,
	) (*securecontentpb.PublishContentPreKeysResponse, error)
	GetContentPreKeyInventory(
		context.Context,
		*actormodel.ActorDeviceRef,
		*securecontentpb.GetContentPreKeyInventoryRequest,
	) (*securecontentpb.GetContentPreKeyInventoryResponse, error)
	ClaimContentPreKeys(
		context.Context,
		*securecontentpb.ClaimContentPreKeysRequest,
	) (*securecontentpb.ClaimContentPreKeysResponse, error)
	ValidateContentPreKeyClaims(
		context.Context,
		federationdelivery.Transaction,
		*securecontentpb.ClaimContentPreKeysRequest,
		*securecontentpb.ClaimContentPreKeysResponse,
	) error
}

func (s *subServer) PublishContentPreKeys(
	ctx context.Context,
	authenticatedPublisher *actormodel.ActorDeviceRef,
	request *securecontentpb.PublishContentPreKeysRequest,
) (*securecontentpb.PublishContentPreKeysResponse, error) {
	service, err := s.requireContentPreKeyService()
	if err != nil {
		return nil, err
	}
	publisher, err := contentPreKeyEndpoint(
		"key_exchange.capability.publish_content_prekeys",
		authenticatedPublisher,
	)
	if err != nil {
		return nil, err
	}
	inventory, err := service.PublishContentPreKeys(ctx, publisher, request)
	if err != nil {
		return nil, err
	}
	return &securecontentpb.PublishContentPreKeysResponse{
		Inventory: contentPreKeyInventoryWire(inventory),
	}, nil
}

func (s *subServer) GetContentPreKeyInventory(
	ctx context.Context,
	authenticatedPublisher *actormodel.ActorDeviceRef,
	request *securecontentpb.GetContentPreKeyInventoryRequest,
) (*securecontentpb.GetContentPreKeyInventoryResponse, error) {
	const operation = "key_exchange.capability.inventory_content_prekeys"

	service, err := s.requireContentPreKeyService()
	if err != nil {
		return nil, err
	}
	publisher, err := contentPreKeyEndpoint(
		operation,
		authenticatedPublisher,
	)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"request",
			"is required",
		)
	}
	requestPublisher, err := contentPreKeyEndpoint(
		operation,
		request.GetPublisher(),
	)
	if err != nil {
		return nil, err
	}
	if requestPublisher != publisher {
		return nil, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"publisher",
			"does not match the authenticated endpoint",
		)
	}
	inventory, err := service.ContentPreKeyInventory(
		ctx,
		publisher,
		request.GetTarget(),
	)
	if err != nil {
		return nil, err
	}
	return &securecontentpb.GetContentPreKeyInventoryResponse{
		Inventory: contentPreKeyInventoryWire(inventory),
	}, nil
}

func (s *subServer) ClaimContentPreKeys(
	ctx context.Context,
	request *securecontentpb.ClaimContentPreKeysRequest,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	service, err := s.requireContentPreKeyService()
	if err != nil {
		return nil, err
	}
	return service.ClaimContentPreKeys(ctx, request)
}

// ValidateContentPreKeyClaims revalidates a completed exact claim inside the
// caller's transaction. It registers no route and performs no mutation.
func (s *subServer) ValidateContentPreKeyClaims(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	request *securecontentpb.ClaimContentPreKeysRequest,
	response *securecontentpb.ClaimContentPreKeysResponse,
) error {
	service, err := s.requireContentPreKeyService()
	if err != nil {
		return err
	}

	return service.ValidateContentPreKeyClaims(
		ctx,
		transaction,
		request,
		response,
	)
}

func (s *subServer) requireContentPreKeyService() (
	*application.ContentPreKeyService,
	error,
) {
	if s == nil ||
		s.composition == nil ||
		s.composition.contentPreKeyService == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInternal,
			"key_exchange.content_prekey_capability",
			"service",
			"is not initialized",
		)
	}
	return s.composition.contentPreKeyService, nil
}

func contentPreKeyEndpoint(
	operation string,
	value *actormodel.ActorDeviceRef,
) (domain.Endpoint, error) {
	if value == nil || value.GetActor() == nil {
		return domain.Endpoint{}, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"authenticated_publisher",
			"is required",
		)
	}
	endpoint := domain.Endpoint{
		ActorPTID: value.GetActor().GetPtid(),
		DeviceID:  value.GetDeviceId(),
	}
	if err := endpoint.Validate(operation); err != nil {
		return domain.Endpoint{}, err
	}
	return endpoint, nil
}

func contentPreKeyInventoryWire(
	inventory domain.ContentPreKeyInventory,
) *securecontentpb.ContentPreKeyInventory {
	return &securecontentpb.ContentPreKeyInventory{
		Target:             inventory.Principal.ClaimTarget(),
		CurrentEpoch:       inventory.CurrentEpoch,
		Available:          uint32(inventory.Available),
		Capacity:           uint32(inventory.Capacity),
		ReplenishAtOrBelow: uint32(inventory.ReplenishAtOrBelow),
		NeedsReplenishment: inventory.NeedsReplenishment,
	}
}

var _ ContentPreKeyCapabilities = (*subServer)(nil)
