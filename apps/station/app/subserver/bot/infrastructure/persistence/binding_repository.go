package persistence

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	"gorm.io/gorm"
)

func toBindingModel(b *domain.AgentBinding) *BotAgentBindingModel {
	return &BotAgentBindingModel{
		BotPtid:   b.BotPtid,
		OwnerPtid: b.OwnerPtid,
		AgentID:   b.AgentID,
		Enabled:   b.Enabled,
		Version:   b.Version,
		CreatedAt: b.CreatedAt,
		UpdatedAt: b.UpdatedAt,
	}
}

func fromBindingModel(m *BotAgentBindingModel) *domain.AgentBinding {
	return &domain.AgentBinding{
		BotPtid:   m.BotPtid,
		OwnerPtid: m.OwnerPtid,
		AgentID:   m.AgentID,
		Enabled:   m.Enabled,
		Version:   m.Version,
		CreatedAt: m.CreatedAt,
		UpdatedAt: m.UpdatedAt,
	}
}

// CreateAgentBinding inserts the first binding revision. A concurrent create
// for the same bot conflicts instead of silently overwriting it.
func (r *GormRepo) CreateAgentBinding(ctx context.Context, binding *domain.AgentBinding) error {
	err := r.db.WithContext(ctx).Create(toBindingModel(binding)).Error
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return domain.NewError(
			domain.CodeStateConflict,
			"bot %s already has an agent binding; update it with its version",
			binding.BotPtid,
		)
	}
	return err
}

// UpdateAgentBinding applies the next revision under optimistic concurrency.
// A zero affected row count is reported back to the service for the
// not-found/conflict decision.
func (r *GormRepo) UpdateAgentBinding(
	ctx context.Context,
	binding *domain.AgentBinding,
) (bool, error) {
	result := r.db.WithContext(ctx).
		Model(&BotAgentBindingModel{}).
		Where("bot_ptid = ? AND version = ?", binding.BotPtid, binding.Version-1).
		Updates(map[string]any{
			"agent_id":   binding.AgentID,
			"enabled":    binding.Enabled,
			"version":    binding.Version,
			"updated_at": binding.UpdatedAt,
		})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *GormRepo) GetAgentBinding(
	ctx context.Context,
	botPtid string,
) (*domain.AgentBinding, bool, error) {
	var m BotAgentBindingModel
	err := r.db.WithContext(ctx).
		Where("bot_ptid = ?", botPtid).
		First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return fromBindingModel(&m), true, nil
}

func (r *GormRepo) ListAgentBindings(
	ctx context.Context,
	ownerPtid string,
) ([]*domain.AgentBinding, error) {
	var rows []BotAgentBindingModel
	if err := r.db.WithContext(ctx).
		Where("owner_ptid = ?", ownerPtid).
		Order("created_at DESC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.AgentBinding, 0, len(rows))
	for i := range rows {
		out = append(out, fromBindingModel(&rows[i]))
	}
	return out, nil
}

// DeleteAgentBinding removes a binding under its expected revision. The
// boolean reports whether the row matched both identity and version.
func (r *GormRepo) DeleteAgentBinding(
	ctx context.Context,
	botPtid string,
	expectedVersion int64,
) (bool, error) {
	result := r.db.WithContext(ctx).
		Where("bot_ptid = ? AND version = ?", botPtid, expectedVersion).
		Delete(&BotAgentBindingModel{})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

// AgentBindingRevision returns the current version (zero when unbound) so the
// service can distinguish a missing row from an optimistic-lock conflict.
func (r *GormRepo) AgentBindingRevision(
	ctx context.Context,
	botPtid string,
) (int64, error) {
	var m BotAgentBindingModel
	err := r.db.WithContext(ctx).
		Select("version").
		Where("bot_ptid = ?", botPtid).
		First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return m.Version, nil
}
