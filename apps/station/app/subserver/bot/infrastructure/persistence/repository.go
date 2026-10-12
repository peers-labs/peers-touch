package persistence

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	"gorm.io/gorm"
)

// GormRepo is the bot registry repository.
type GormRepo struct {
	db *gorm.DB
}

func NewGormRepo(db *gorm.DB) *GormRepo { return &GormRepo{db: db} }

func (r *GormRepo) AutoMigrate() error {
	return r.db.AutoMigrate(&BotRegistrationModel{})
}

func toModel(b *domain.Bot) *BotRegistrationModel {
	return &BotRegistrationModel{
		BotPtid:            b.BotPtid,
		OwnerPtid:          b.OwnerPtid,
		Name:               b.Name,
		State:              int32(b.State),
		WebhookID:          b.WebhookID,
		SecretHash:         b.SecretHash,
		SecretHint:         b.SecretHint,
		SecretDelivered:    b.SecretDelivered,
		DeliveryScope:      int32(b.DeliveryScope),
		RateLimitPerMinute: b.RateLimitPerMin,
		CreatedAt:          b.CreatedAt,
		DisabledAt:         b.DisabledAt,
		RevokedAt:          b.RevokedAt,
	}
}

func fromModel(m *BotRegistrationModel) *domain.Bot {
	return &domain.Bot{
		BotPtid:         m.BotPtid,
		OwnerPtid:       m.OwnerPtid,
		Name:            m.Name,
		State:           domain.State(m.State),
		WebhookID:       m.WebhookID,
		SecretHash:      m.SecretHash,
		SecretHint:      m.SecretHint,
		SecretDelivered: m.SecretDelivered,
		DeliveryScope:   domain.DeliveryScope(m.DeliveryScope),
		RateLimitPerMin: m.RateLimitPerMinute,
		CreatedAt:       m.CreatedAt,
		DisabledAt:      m.DisabledAt,
		RevokedAt:       m.RevokedAt,
	}
}

// Create inserts a new registration. A conflicting ptid/webhook id maps to a
// typed conflict by the caller via IsDuplicateKey.
func (r *GormRepo) Create(ctx context.Context, b *domain.Bot) error {
	return r.db.WithContext(ctx).Create(toModel(b)).Error
}

func (r *GormRepo) Update(ctx context.Context, b *domain.Bot) error {
	res := r.db.WithContext(ctx).
		Model(&BotRegistrationModel{}).
		Where("bot_ptid = ?", b.BotPtid).
		Updates(map[string]any{
			"name":                  b.Name,
			"state":                 int32(b.State),
			"secret_hash":           b.SecretHash,
			"secret_hint":           b.SecretHint,
			"secret_delivered":      b.SecretDelivered,
			"delivery_scope":        int32(b.DeliveryScope),
			"rate_limit_per_minute": b.RateLimitPerMin,
			"disabled_at":           b.DisabledAt,
			"revoked_at":            b.RevokedAt,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return domain.NewNotFound(b.BotPtid)
	}
	return nil
}

func (r *GormRepo) GetByPtid(ctx context.Context, botPtid string) (*domain.Bot, error) {
	var m BotRegistrationModel
	if err := r.db.WithContext(ctx).Where("bot_ptid = ?", botPtid).First(&m).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.NewNotFound(botPtid)
		}
		return nil, err
	}
	return fromModel(&m), nil
}

func (r *GormRepo) GetByWebhookID(ctx context.Context, webhookID string) (*domain.Bot, error) {
	var m BotRegistrationModel
	if err := r.db.WithContext(ctx).Where("webhook_id = ?", webhookID).First(&m).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.NewNotFound(webhookID)
		}
		return nil, err
	}
	return fromModel(&m), nil
}

func (r *GormRepo) ListByOwner(ctx context.Context, ownerPtid string) ([]*domain.Bot, error) {
	var rows []BotRegistrationModel
	if err := r.db.WithContext(ctx).
		Where("owner_ptid = ?", ownerPtid).
		Order("created_at DESC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.Bot, 0, len(rows))
	for i := range rows {
		out = append(out, fromModel(&rows[i]))
	}
	return out, nil
}

// ActiveByName returns a non-revoked bot owned by ownerPtid with the given
// name, used to enforce the per-owner unique-active-name rule.
func (r *GormRepo) ActiveByName(ctx context.Context, ownerPtid, name string) (*domain.Bot, error) {
	var m BotRegistrationModel
	err := r.db.WithContext(ctx).
		Where("owner_ptid = ? AND name = ? AND state <> ?", ownerPtid, name, int32(domain.StateRevoked)).
		First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return fromModel(&m), nil
}

// Now is overridable in tests for deterministic timestamps.
var now = func() time.Time { return time.Now().UTC() }
