package publishing

import (
	"context"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/credential"
)

const DefaultRateLimitPerMinute = uint32(120)

type ActorMinter interface {
	MintServiceActor(ctx context.Context, handle, displayName, namespace string) (valueobject.PTID, error)
}

type CreatedGrant struct {
	Grant  entity.PublishingGrant
	Secret string
}

type ManagementService struct {
	store      ports.PublishingStore
	unitOfWork ports.UnitOfWork
	minter     ActorMinter
	clock      Clock
	ids        IDGenerator
}

func NewManagementService(
	store ports.PublishingStore,
	unitOfWork ports.UnitOfWork,
	minter ActorMinter,
	clock Clock,
	ids IDGenerator,
) (*ManagementService, error) {
	if store == nil || unitOfWork == nil || minter == nil || clock == nil || ids == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"publishing.new_management_service",
			"dependencies",
			"store, unit of work, Actor minter, clock, and ID generator are required",
		)
	}
	return &ManagementService{
		store:      store,
		unitOfWork: unitOfWork,
		minter:     minter,
		clock:      clock,
		ids:        ids,
	}, nil
}

func (s *ManagementService) Create(
	ctx context.Context,
	owner valueobject.PTID,
	name string,
	expiresAt *time.Time,
) (CreatedGrant, error) {
	name = strings.TrimSpace(name)
	if owner == "" || name == "" || len([]rune(name)) > 100 {
		return CreatedGrant{}, invalid("name", "a bounded grant name and owner are required")
	}
	now := s.clock.Now().UTC()
	if expiresAt != nil {
		normalized := expiresAt.UTC()
		if !normalized.After(now) {
			return CreatedGrant{}, invalid("expires_at", "expiration must be in the future")
		}
		expiresAt = &normalized
	}
	id := s.ids.NewID()
	handleSuffix := strings.ReplaceAll(id, "-", "")
	if len(handleSuffix) > 22 {
		handleSuffix = handleSuffix[:22]
	}
	sender, err := s.minter.MintServiceActor(
		ctx,
		"publisher-"+handleSuffix,
		name,
		"peers",
	)
	if err != nil {
		return CreatedGrant{}, err
	}
	return s.createForSender(ctx, owner, sender, name, "publisher."+id, expiresAt, id)
}

// CreateForSender binds an already-minted optional product actor (for example
// a Bot) to the same generic publishing capability.
func (s *ManagementService) CreateForSender(
	ctx context.Context,
	owner valueobject.PTID,
	sender valueobject.PTID,
	name string,
	sourceNamespace string,
	expiresAt *time.Time,
) (CreatedGrant, error) {
	return s.createForSender(
		ctx,
		owner,
		sender,
		name,
		sourceNamespace,
		expiresAt,
		s.ids.NewID(),
	)
}

func (s *ManagementService) createForSender(
	ctx context.Context,
	owner valueobject.PTID,
	sender valueobject.PTID,
	name string,
	sourceNamespace string,
	expiresAt *time.Time,
	id string,
) (CreatedGrant, error) {
	name = strings.TrimSpace(name)
	sourceNamespace = strings.TrimSpace(sourceNamespace)
	if owner == "" || sender == "" || owner == sender || name == "" ||
		len([]rune(name)) > 100 || sourceNamespace == "" ||
		len(sourceNamespace) > 255 {
		return CreatedGrant{}, invalid("grant", "sender delegation is incomplete")
	}
	now := s.clock.Now().UTC()
	if expiresAt != nil {
		normalized := expiresAt.UTC()
		if !normalized.After(now) {
			return CreatedGrant{}, invalid("expires_at", "expiration must be in the future")
		}
		expiresAt = &normalized
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return CreatedGrant{}, invalid("publishing_id", "publishing identity is required")
	}
	target, err := valueobject.DirectConversationID(sender, owner)
	if err != nil {
		return CreatedGrant{}, err
	}
	secret, err := credential.Generate()
	if err != nil {
		return CreatedGrant{}, err
	}
	grant := entity.PublishingGrant{
		ID:              id,
		Owner:           owner,
		Sender:          sender,
		Name:            name,
		SourceNamespace: sourceNamespace,
		DefaultTarget:   target,
		AllowedTargets:  []valueobject.ConversationID{target},
		SecretHash:      credential.Hash(secret),
		SecretHint:      credential.Hint(secret),
		CreatedAt:       now,
		ExpiresAt:       expiresAt,
		RatePerMinute:   DefaultRateLimitPerMinute,
	}
	if err := s.store.CreateGrant(ctx, grant); err != nil {
		return CreatedGrant{}, err
	}
	return CreatedGrant{Grant: grant, Secret: secret}, nil
}

func (s *ManagementService) List(
	ctx context.Context,
	owner valueobject.PTID,
) ([]entity.PublishingGrant, error) {
	if owner == "" {
		return nil, unauthorized()
	}
	return s.store.ListGrants(ctx, owner)
}

func (s *ManagementService) Rotate(
	ctx context.Context,
	owner valueobject.PTID,
	publishingID string,
) (CreatedGrant, error) {
	var result CreatedGrant
	err := s.withGrant(ctx, owner, publishingID, func(store ports.PublishingStore, grant entity.PublishingGrant) error {
		if grant.Revoked {
			return conflict("publishing_id", "revoked grants cannot rotate credentials")
		}
		secret, err := credential.Generate()
		if err != nil {
			return err
		}
		grant.SecretHash = credential.Hash(secret)
		grant.SecretHint = credential.Hint(secret)
		if err := store.SaveGrant(ctx, grant); err != nil {
			return err
		}
		result = CreatedGrant{Grant: grant, Secret: secret}
		return nil
	})
	return result, err
}

func (s *ManagementService) Revoke(
	ctx context.Context,
	owner valueobject.PTID,
	publishingID string,
) (entity.PublishingGrant, error) {
	var result entity.PublishingGrant
	err := s.withGrant(ctx, owner, publishingID, func(store ports.PublishingStore, grant entity.PublishingGrant) error {
		grant.Revoked = true
		grant.Disabled = false
		grant.SecretHash = ""
		if err := store.SaveGrant(ctx, grant); err != nil {
			return err
		}
		result = grant
		return nil
	})
	return result, err
}

func (s *ManagementService) SetDisabled(
	ctx context.Context,
	owner valueobject.PTID,
	publishingID string,
	disabled bool,
) (entity.PublishingGrant, error) {
	var result entity.PublishingGrant
	err := s.withGrant(ctx, owner, publishingID, func(store ports.PublishingStore, grant entity.PublishingGrant) error {
		if grant.Revoked {
			return conflict(
				"publishing_id",
				"revoked grants cannot change disabled state",
			)
		}
		grant.Disabled = disabled
		if err := store.SaveGrant(ctx, grant); err != nil {
			return err
		}
		result = grant
		return nil
	})
	return result, err
}

func (s *ManagementService) GetOwned(
	ctx context.Context,
	owner valueobject.PTID,
	publishingID string,
) (entity.PublishingGrant, error) {
	var result entity.PublishingGrant
	err := s.withGrant(ctx, owner, publishingID, func(_ ports.PublishingStore, grant entity.PublishingGrant) error {
		result = grant
		return nil
	})
	return result, err
}

func (s *ManagementService) owned(
	ctx context.Context,
	store ports.PublishingStore,
	owner valueobject.PTID,
	publishingID string,
) (entity.PublishingGrant, error) {
	if owner == "" || strings.TrimSpace(publishingID) == "" {
		return entity.PublishingGrant{}, unauthorized()
	}
	grant, err := store.GetGrant(ctx, strings.TrimSpace(publishingID))
	if err != nil || grant.Owner != owner {
		return entity.PublishingGrant{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeNotFound,
			"publishing.management",
			"publishing_id",
			"grant was not found",
		)
	}
	return grant, nil
}

func (s *ManagementService) withGrant(
	ctx context.Context,
	owner valueobject.PTID,
	publishingID string,
	operation func(ports.PublishingStore, entity.PublishingGrant) error,
) error {
	id := strings.TrimSpace(publishingID)
	return s.unitOfWork.ExecuteSerialized(
		ctx,
		"message-publishing:"+id,
		func(tx ports.Transaction) error {
			if tx.Publishing == nil {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeInvalidArgument,
					"publishing.management",
					"store",
					"is not wired",
				)
			}
			grant, err := s.owned(ctx, tx.Publishing, owner, id)
			if err != nil {
				return err
			}
			return operation(tx.Publishing, grant)
		},
	)
}
