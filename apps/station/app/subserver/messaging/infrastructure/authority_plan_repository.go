package infrastructure

import (
	"bytes"
	"context"
	"fmt"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"gorm.io/gorm"
)

type AuthorityPlanModel struct {
	PlanID              string     `gorm:"column:plan_id;size:64;primaryKey"`
	PlanKind            int32      `gorm:"column:plan_kind;not null;index"`
	ConversationID      string     `gorm:"column:conversation_id;size:128;not null;index"`
	RequesterPTID       string     `gorm:"column:requester_ptid;size:255;not null"`
	RequesterDeviceID   string     `gorm:"column:requester_device_id;size:255;not null"`
	IntentBytes         []byte     `gorm:"column:intent_bytes;type:bytea;not null"`
	SnapshotBytes       []byte     `gorm:"column:authority_snapshot_bytes;type:bytea;not null"`
	AuthorityPlanSHA256 []byte     `gorm:"column:authority_plan_sha256;type:bytea;not null"`
	State               string     `gorm:"column:state;size:32;not null;index"`
	ExpiresAt           time.Time  `gorm:"column:expires_at;not null;index"`
	ConsumedAt          *time.Time `gorm:"column:consumed_at"`
}

func (*AuthorityPlanModel) TableName() string {
	return "messaging_authority_plans"
}

type AuthorityPlanRepository struct {
	db *gorm.DB
}

func NewAuthorityPlanRepository(db *gorm.DB) *AuthorityPlanRepository {
	return &AuthorityPlanRepository{db: db}
}

func (r *AuthorityPlanRepository) AutoMigrate() error {
	return r.db.AutoMigrate(&AuthorityPlanModel{})
}

func (r *AuthorityPlanRepository) Create(
	ctx context.Context,
	plan *messaging.AuthorityPlan,
) error {
	if plan == nil ||
		plan.PlanID == "" ||
		plan.PlanKind == 0 ||
		plan.ConversationID == "" ||
		plan.RequesterPTID == "" ||
		plan.RequesterDeviceID == "" ||
		len(plan.IntentBytes) == 0 ||
		len(plan.SnapshotBytes) == 0 ||
		len(plan.AuthorityPlanSHA256) != 32 ||
		plan.State != messaging.AuthorityPlanStatePrepared ||
		plan.ExpiresAt.IsZero() {
		return fmt.Errorf("messaging: authority plan is incomplete")
	}
	return r.db.WithContext(ctx).Create(authorityPlanModel(plan)).Error
}

func (r *AuthorityPlanRepository) Get(
	ctx context.Context,
	planID string,
) (*messaging.AuthorityPlan, error) {
	var model AuthorityPlanModel
	if err := r.db.WithContext(ctx).
		Where("plan_id = ?", planID).
		First(&model).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return authorityPlanFromModel(model), nil
}

func (r *AuthorityPlanRepository) MarkConsumed(
	ctx context.Context,
	planID string,
	authorityPlanSHA256 []byte,
	consumedAt time.Time,
) error {
	if len(authorityPlanSHA256) != 32 || consumedAt.IsZero() {
		return fmt.Errorf("messaging: authority plan consumption identity is invalid")
	}
	var model AuthorityPlanModel
	if err := r.db.WithContext(ctx).
		Where("plan_id = ?", planID).
		First(&model).Error; err != nil {
		return mapNotFound(err)
	}
	if !bytes.Equal(model.AuthorityPlanSHA256, authorityPlanSHA256) {
		return messaging.ErrCommandConflict
	}
	if !model.ExpiresAt.After(consumedAt) {
		return messaging.ErrAuthorityPlanExpired
	}
	if model.State != string(messaging.AuthorityPlanStatePrepared) {
		return messaging.ErrAuthorityPlanStale
	}
	result := r.db.WithContext(ctx).
		Model(&AuthorityPlanModel{}).
		Where("plan_id = ? AND state = ? AND expires_at > ?",
			planID,
			string(messaging.AuthorityPlanStatePrepared),
			consumedAt,
		).
		Updates(map[string]any{
			"state":       string(messaging.AuthorityPlanStateConsumed),
			"consumed_at": consumedAt.UTC(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return messaging.ErrAuthorityPlanStale
	}
	return nil
}

func (r *AuthorityPlanRepository) MarkSuperseded(
	ctx context.Context,
	planID string,
	authorityPlanSHA256 []byte,
) error {
	if len(authorityPlanSHA256) != 32 {
		return fmt.Errorf("messaging: authority plan supersede identity is invalid")
	}
	result := r.db.WithContext(ctx).
		Model(&AuthorityPlanModel{}).
		Where(
			"plan_id = ? AND authority_plan_sha256 = ? AND state = ?",
			planID,
			authorityPlanSHA256,
			string(messaging.AuthorityPlanStatePrepared),
		).
		Update("state", string(messaging.AuthorityPlanStateSuperseded))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return messaging.ErrAuthorityPlanStale
	}
	return nil
}

func (r *AuthorityPlanRepository) ExpirePrepared(
	ctx context.Context,
	now time.Time,
) error {
	return r.db.WithContext(ctx).
		Model(&AuthorityPlanModel{}).
		Where("state = ? AND expires_at <= ?",
			string(messaging.AuthorityPlanStatePrepared),
			now.UTC(),
		).
		Update("state", string(messaging.AuthorityPlanStateExpired)).Error
}

func authorityPlanModel(plan *messaging.AuthorityPlan) *AuthorityPlanModel {
	return &AuthorityPlanModel{
		PlanID:              plan.PlanID,
		PlanKind:            plan.PlanKind,
		ConversationID:      plan.ConversationID,
		RequesterPTID:       plan.RequesterPTID,
		RequesterDeviceID:   plan.RequesterDeviceID,
		IntentBytes:         append([]byte(nil), plan.IntentBytes...),
		SnapshotBytes:       append([]byte(nil), plan.SnapshotBytes...),
		AuthorityPlanSHA256: append([]byte(nil), plan.AuthorityPlanSHA256...),
		State:               string(plan.State),
		ExpiresAt:           plan.ExpiresAt.UTC(),
		ConsumedAt:          plan.ConsumedAt,
	}
}

func authorityPlanFromModel(model AuthorityPlanModel) *messaging.AuthorityPlan {
	return &messaging.AuthorityPlan{
		PlanID:              model.PlanID,
		PlanKind:            model.PlanKind,
		ConversationID:      model.ConversationID,
		RequesterPTID:       model.RequesterPTID,
		RequesterDeviceID:   model.RequesterDeviceID,
		IntentBytes:         append([]byte(nil), model.IntentBytes...),
		SnapshotBytes:       append([]byte(nil), model.SnapshotBytes...),
		AuthorityPlanSHA256: append([]byte(nil), model.AuthorityPlanSHA256...),
		State:               messaging.AuthorityPlanState(model.State),
		ExpiresAt:           model.ExpiresAt.UTC(),
		ConsumedAt:          model.ConsumedAt,
	}
}

var _ messaging.AuthorityPlanRepository = (*AuthorityPlanRepository)(nil)
