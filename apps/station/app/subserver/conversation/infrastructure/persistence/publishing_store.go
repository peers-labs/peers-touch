package persistence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type PublishingStore struct {
	db *gorm.DB
}

func NewPublishingStore(db *gorm.DB) *PublishingStore {
	return &PublishingStore{db: db}
}

func (s *PublishingStore) GetGrant(ctx context.Context, id string) (entity.PublishingGrant, error) {
	var model MessagePublishingGrantModel
	err := s.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("publishing_id = ?", id).
		First(&model).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return entity.PublishingGrant{}, publishingNotFound("publishing_store.get_grant", "publishing_id")
	}
	if err != nil {
		return entity.PublishingGrant{}, fmt.Errorf("load publishing grant: %w", err)
	}
	return publishingGrantFromModel(model)
}

func (s *PublishingStore) CreateGrant(ctx context.Context, grant entity.PublishingGrant) error {
	model, err := publishingGrantModel(grant)
	if err != nil {
		return err
	}
	if err := s.db.WithContext(ctx).Create(&model).Error; err != nil {
		return fmt.Errorf("create publishing grant: %w", err)
	}
	return nil
}

func (s *PublishingStore) SaveGrant(ctx context.Context, grant entity.PublishingGrant) error {
	model, err := publishingGrantModel(grant)
	if err != nil {
		return err
	}
	result := s.db.WithContext(ctx).
		Model(&MessagePublishingGrantModel{}).
		Where("publishing_id = ? AND owner_ptid = ? AND sender_ptid = ?",
			grant.ID, grant.Owner, grant.Sender).
		Updates(map[string]any{
			"name":                  model.Name,
			"source_namespace":      model.SourceNamespace,
			"default_target":        model.DefaultTarget,
			"allowed_targets":       model.AllowedTargets,
			"secret_hash":           model.SecretHash,
			"secret_hint":           model.SecretHint,
			"disabled":              model.Disabled,
			"revoked":               model.Revoked,
			"expires_at":            model.ExpiresAt,
			"rate_limit_per_minute": model.RateLimitPerMinute,
		})
	if result.Error != nil {
		return fmt.Errorf("save publishing grant: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return publishingNotFound("publishing_store.save_grant", "publishing_id")
	}
	return nil
}

func (s *PublishingStore) ListGrants(ctx context.Context, owner valueobject.PTID) ([]entity.PublishingGrant, error) {
	var models []MessagePublishingGrantModel
	if err := s.db.WithContext(ctx).
		Where("owner_ptid = ?", owner).
		Order("created_at DESC, publishing_id ASC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("list publishing grants: %w", err)
	}
	result := make([]entity.PublishingGrant, 0, len(models))
	for _, model := range models {
		grant, err := publishingGrantFromModel(model)
		if err != nil {
			return nil, err
		}
		result = append(result, grant)
	}
	return result, nil
}

func (s *PublishingStore) GetPublication(
	ctx context.Context,
	id string,
	commandID string,
) (entity.PublicationReceipt, bool, error) {
	var model MessagePublicationReceiptModel
	err := s.db.WithContext(ctx).
		Where("publishing_id = ? AND command_id = ?", id, commandID).
		First(&model).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return entity.PublicationReceipt{}, false, nil
	}
	if err != nil {
		return entity.PublicationReceipt{}, false, fmt.Errorf("load publication receipt: %w", err)
	}
	if len(model.RequestHash) != len(valueobject.Hash{}) {
		return entity.PublicationReceipt{}, false, fmt.Errorf("publication receipt request hash is malformed")
	}
	var requestHash valueobject.Hash
	copy(requestHash[:], model.RequestHash)
	return entity.PublicationReceipt{
		PublishingID:  model.PublishingID,
		CommandID:     model.CommandID,
		RequestHash:   requestHash,
		Sender:        valueobject.PTID(model.SenderPTID),
		Recipient:     valueobject.PTID(model.RecipientPTID),
		Conversation:  valueobject.ConversationID(model.ConversationID),
		MessageID:     valueobject.MessageID(model.MessageID),
		EventID:       valueobject.EventID(model.EventID),
		EventSequence: valueobject.Sequence(model.EventSequence),
		CreatedAt:     model.CreatedAt,
	}, true, nil
}

func (s *PublishingStore) RecordPublication(ctx context.Context, receipt entity.PublicationReceipt) error {
	model := MessagePublicationReceiptModel{
		PublishingID:   receipt.PublishingID,
		CommandID:      receipt.CommandID,
		RequestHash:    receipt.RequestHash.Bytes(),
		SenderPTID:     string(receipt.Sender),
		RecipientPTID:  string(receipt.Recipient),
		ConversationID: string(receipt.Conversation),
		MessageID:      string(receipt.MessageID),
		EventID:        string(receipt.EventID),
		EventSequence:  uint64(receipt.EventSequence),
		CreatedAt:      receipt.CreatedAt.UTC(),
	}
	if err := s.db.WithContext(ctx).Create(&model).Error; err != nil {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"publishing_store.record_publication",
			"command_id",
			"a publication receipt already exists or conflicts",
		)
	}
	return nil
}

func (s *PublishingStore) CheckRate(ctx context.Context, id string, limit uint32, at time.Time) error {
	if limit == 0 {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeRateLimited,
			"publishing_store.check_rate",
			"rate_limit",
			"publishing is disabled by its rate limit",
		)
	}
	var model MessagePublishingRateModel
	err := s.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("publishing_id = ?", id).
		First(&model).Error
	now := at.UTC()
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s.db.WithContext(ctx).Create(&MessagePublishingRateModel{
			PublishingID: id,
			WindowStart:  now,
			Count:        1,
		}).Error
	}
	if err != nil {
		return fmt.Errorf("load publishing rate: %w", err)
	}
	if !now.Before(model.WindowStart.Add(time.Minute)) {
		model.WindowStart = now
		model.Count = 1
		return s.db.WithContext(ctx).Save(&model).Error
	}
	if model.Count >= limit {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeRateLimited,
			"publishing_store.check_rate",
			"rate_limit",
			"the per-minute publication limit is exhausted",
		)
	}
	return s.db.WithContext(ctx).
		Model(&MessagePublishingRateModel{}).
		Where("publishing_id = ?", id).
		UpdateColumn("request_count", gorm.Expr("request_count + 1")).Error
}

func (s *PublishingStore) AuthorizeSystemMessage(
	ctx context.Context,
	publishingID string,
	sender valueobject.PTID,
	conversation valueobject.ConversationID,
	at time.Time,
) error {
	grant, err := s.GetGrant(ctx, publishingID)
	if err != nil {
		return err
	}
	return grant.Authorize(sender, conversation, at)
}

func publishingGrantModel(grant entity.PublishingGrant) (MessagePublishingGrantModel, error) {
	if grant.ID == "" || grant.Owner == "" || grant.Sender == "" ||
		grant.Name == "" || grant.SourceNamespace == "" ||
		grant.DefaultTarget == "" || len(grant.AllowedTargets) == 0 ||
		(grant.SecretHash == "" && !grant.Revoked) || grant.CreatedAt.IsZero() {
		return MessagePublishingGrantModel{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"publishing_store.map_grant",
			"grant",
			"grant is incomplete",
		)
	}
	targets := make([]string, 0, len(grant.AllowedTargets))
	for _, target := range grant.AllowedTargets {
		targets = append(targets, string(target))
	}
	encoded, err := json.Marshal(targets)
	if err != nil {
		return MessagePublishingGrantModel{}, err
	}
	return MessagePublishingGrantModel{
		PublishingID:       grant.ID,
		OwnerPTID:          string(grant.Owner),
		SenderPTID:         string(grant.Sender),
		Name:               grant.Name,
		SourceNamespace:    grant.SourceNamespace,
		DefaultTarget:      string(grant.DefaultTarget),
		AllowedTargets:     encoded,
		SecretHash:         grant.SecretHash,
		SecretHint:         grant.SecretHint,
		Disabled:           grant.Disabled,
		Revoked:            grant.Revoked,
		CreatedAt:          grant.CreatedAt.UTC(),
		ExpiresAt:          grant.ExpiresAt,
		RateLimitPerMinute: grant.RatePerMinute,
	}, nil
}

func publishingGrantFromModel(model MessagePublishingGrantModel) (entity.PublishingGrant, error) {
	var encoded []string
	if err := json.Unmarshal(model.AllowedTargets, &encoded); err != nil {
		return entity.PublishingGrant{}, fmt.Errorf("decode publishing targets: %w", err)
	}
	targets := make([]valueobject.ConversationID, 0, len(encoded))
	for _, target := range encoded {
		conversationID, err := valueobject.NewConversationID(target)
		if err != nil {
			return entity.PublishingGrant{}, err
		}
		targets = append(targets, conversationID)
	}
	return entity.PublishingGrant{
		ID:              model.PublishingID,
		Owner:           valueobject.PTID(model.OwnerPTID),
		Sender:          valueobject.PTID(model.SenderPTID),
		Name:            model.Name,
		SourceNamespace: model.SourceNamespace,
		DefaultTarget:   valueobject.ConversationID(model.DefaultTarget),
		AllowedTargets:  targets,
		SecretHash:      model.SecretHash,
		SecretHint:      model.SecretHint,
		Disabled:        model.Disabled,
		Revoked:         model.Revoked,
		CreatedAt:       model.CreatedAt,
		ExpiresAt:       model.ExpiresAt,
		RatePerMinute:   model.RateLimitPerMinute,
	}, nil
}

func publishingNotFound(operation, field string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeNotFound,
		operation,
		field,
		"was not found",
	)
}

var (
	_ ports.PublishingStore           = (*PublishingStore)(nil)
	_ ports.SystemSenderAuthorization = (*PublishingStore)(nil)
)
