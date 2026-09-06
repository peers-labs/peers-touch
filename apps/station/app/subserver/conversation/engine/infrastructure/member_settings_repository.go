package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type MemberSettingsModel struct {
	ID                  uint      `gorm:"column:id;primaryKey"`
	ConversationID      string    `gorm:"column:conversation_id;size:128;uniqueIndex:uidx_conversation_member_settings"`
	PTID                string    `gorm:"column:ptid;size:255;uniqueIndex:uidx_conversation_member_settings"`
	Nickname            string    `gorm:"column:nickname;size:255"`
	Muted               bool      `gorm:"column:muted"`
	Pinned              bool      `gorm:"column:pinned"`
	AlertEnabled        bool      `gorm:"column:alert_enabled"`
	Background          string    `gorm:"column:background;size:32;default:default"`
	BackgroundImage     string    `gorm:"column:background_image;size:2048"`
	ClearedAtUnixMillis int64     `gorm:"column:cleared_at_unix_ms"`
	UpdatedAt           time.Time `gorm:"column:updated_at"`
}

func (*MemberSettingsModel) TableName() string {
	return "conversation_member_settings"
}

type MemberSettingsRepository struct {
	db    *gorm.DB
	clock func() time.Time
}

func NewMemberSettingsRepository(
	db *gorm.DB,
	clock func() time.Time,
) (*MemberSettingsRepository, error) {
	if db == nil || clock == nil {
		return nil, fmt.Errorf("messaging: member settings repository dependencies are invalid")
	}
	return &MemberSettingsRepository{db: db, clock: clock}, nil
}

func (r *MemberSettingsRepository) AutoMigrate() error {
	return r.db.AutoMigrate(&MemberSettingsModel{})
}

func (r *MemberSettingsRepository) Get(
	ctx context.Context,
	conversationID string,
	ptid string,
) (messaging.MemberSettings, error) {
	if conversationID == "" || ptid == "" {
		return messaging.MemberSettings{}, messaging.ErrMemberSettingsInvalid
	}
	var model MemberSettingsModel
	err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND ptid = ?", conversationID, ptid).
		First(&model).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultMemberSettings(), nil
	}
	if err != nil {
		return messaging.MemberSettings{}, err
	}
	return memberSettingsFromModel(model), nil
}

func (r *MemberSettingsRepository) Update(
	ctx context.Context,
	conversationID string,
	ptid string,
	patch messaging.MemberSettingsPatch,
) (messaging.MemberSettings, error) {
	if conversationID == "" || ptid == "" {
		return messaging.MemberSettings{}, messaging.ErrMemberSettingsInvalid
	}
	now := r.clock().UTC()
	updates := map[string]any{"updated_at": now}
	if patch.Nickname != nil {
		updates["nickname"] = *patch.Nickname
	}
	if patch.Muted != nil {
		updates["muted"] = *patch.Muted
	}
	if patch.Pinned != nil {
		updates["pinned"] = *patch.Pinned
	}
	if patch.AlertEnabled != nil {
		updates["alert_enabled"] = *patch.AlertEnabled
	}
	if patch.Background != nil {
		updates["background"] = normalizeMemberSettingsBackground(*patch.Background)
	}
	if patch.BackgroundImage != nil {
		updates["background_image"] = strings.TrimSpace(*patch.BackgroundImage)
	}
	if patch.ClearedAtUnixMillis != nil {
		updates["cleared_at_unix_ms"] = *patch.ClearedAtUnixMillis
	}

	defaults := defaultMemberSettings()
	model := MemberSettingsModel{
		ConversationID: conversationID,
		PTID:           ptid,
		AlertEnabled:   defaults.AlertEnabled,
		Background:     defaults.Background,
		UpdatedAt:      now,
	}
	if patch.Nickname != nil {
		model.Nickname = *patch.Nickname
	}
	if patch.Muted != nil {
		model.Muted = *patch.Muted
	}
	if patch.Pinned != nil {
		model.Pinned = *patch.Pinned
	}
	if patch.AlertEnabled != nil {
		model.AlertEnabled = *patch.AlertEnabled
	}
	if patch.Background != nil {
		model.Background = normalizeMemberSettingsBackground(*patch.Background)
	}
	if patch.BackgroundImage != nil {
		model.BackgroundImage = strings.TrimSpace(*patch.BackgroundImage)
	}
	if patch.ClearedAtUnixMillis != nil {
		model.ClearedAtUnixMillis = *patch.ClearedAtUnixMillis
	}
	if err := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "conversation_id"}, {Name: "ptid"}},
			DoUpdates: clause.Assignments(updates),
		}).
		Create(&model).Error; err != nil {
		return messaging.MemberSettings{}, err
	}
	return r.Get(ctx, conversationID, ptid)
}

func defaultMemberSettings() messaging.MemberSettings {
	return messaging.MemberSettings{
		AlertEnabled: true,
		Background:   "default",
	}
}

func normalizeMemberSettingsBackground(value string) string {
	switch strings.TrimSpace(value) {
	case "paper", "mint", "dusk", "calm", "graphite":
		return strings.TrimSpace(value)
	default:
		return "default"
	}
}

func memberSettingsFromModel(model MemberSettingsModel) messaging.MemberSettings {
	return messaging.MemberSettings{
		Nickname:            model.Nickname,
		Muted:               model.Muted,
		AlertEnabled:        model.AlertEnabled,
		Pinned:              model.Pinned,
		Background:          normalizeMemberSettingsBackground(model.Background),
		BackgroundImage:     model.BackgroundImage,
		ClearedAtUnixMillis: model.ClearedAtUnixMillis,
	}
}

var _ messaging.MemberSettingsRepository = (*MemberSettingsRepository)(nil)
