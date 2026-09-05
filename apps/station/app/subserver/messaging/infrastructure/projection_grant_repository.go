package infrastructure

import (
	"context"
	"fmt"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type EventProjectionGrantModel struct {
	ConversationID      string `gorm:"column:conversation_id;size:128;primaryKey"`
	EventID             string `gorm:"column:event_id;size:128;primaryKey"`
	TargetHomeStationID string `gorm:"column:target_home_station_id;size:255;primaryKey"`
	EntitlementReason   string `gorm:"column:entitlement_reason;size:64;not null"`
}

func (*EventProjectionGrantModel) TableName() string {
	return "messaging_event_projection_targets"
}

type EventProjectionGrantRepository struct {
	db *gorm.DB
}

func NewEventProjectionGrantRepository(
	db *gorm.DB,
) (*EventProjectionGrantRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("messaging: projection grant repository is not configured")
	}
	return &EventProjectionGrantRepository{db: db}, nil
}

func (r *EventProjectionGrantRepository) AutoMigrate() error {
	return r.db.AutoMigrate(&EventProjectionGrantModel{})
}

func (r *EventProjectionGrantRepository) AppendEventProjectionGrants(
	ctx context.Context,
	grants []messaging.EventProjectionGrant,
) error {
	for _, grant := range grants {
		if grant.ConversationID == "" ||
			grant.EventID == "" ||
			grant.TargetHomeStationID == "" ||
			grant.EntitlementReason == "" {
			return fmt.Errorf("messaging: complete event projection grant is required")
		}
		model := EventProjectionGrantModel{
			ConversationID:      grant.ConversationID,
			EventID:             grant.EventID,
			TargetHomeStationID: grant.TargetHomeStationID,
			EntitlementReason:   grant.EntitlementReason,
		}
		result := r.db.WithContext(ctx).
			Clauses(clause.OnConflict{DoNothing: true}).
			Create(&model)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			continue
		}
		var existing EventProjectionGrantModel
		if err := r.db.WithContext(ctx).
			Where(
				"conversation_id = ? AND event_id = ? AND target_home_station_id = ?",
				grant.ConversationID,
				grant.EventID,
				grant.TargetHomeStationID,
			).
			First(&existing).Error; err != nil {
			return err
		}
		if existing.EntitlementReason != grant.EntitlementReason {
			return messaging.ErrProjectionGrantConflict
		}
	}
	return nil
}

func (r *EventProjectionGrantRepository) ListEventProjectionGrants(
	ctx context.Context,
	conversationID string,
	eventID string,
) ([]messaging.EventProjectionGrant, error) {
	if conversationID == "" || eventID == "" {
		return nil, fmt.Errorf("messaging: projection grant event identity is required")
	}
	var models []EventProjectionGrantModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND event_id = ?", conversationID, eventID).
		Order("target_home_station_id ASC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	grants := make([]messaging.EventProjectionGrant, 0, len(models))
	for _, model := range models {
		grants = append(grants, messaging.EventProjectionGrant{
			ConversationID:      model.ConversationID,
			EventID:             model.EventID,
			TargetHomeStationID: model.TargetHomeStationID,
			EntitlementReason:   model.EntitlementReason,
		})
	}
	return grants, nil
}

var _ messaging.EventProjectionGrantRepository = (*EventProjectionGrantRepository)(nil)
