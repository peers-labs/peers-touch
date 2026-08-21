package conversation

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type conversationMemberSettingsModel struct {
	ID                  uint      `gorm:"column:id;primaryKey"`
	ConversationID      string    `gorm:"column:conversation_id;size:128;uniqueIndex:uidx_conversation_member_settings"`
	Ptid                string    `gorm:"column:ptid;size:255;uniqueIndex:uidx_conversation_member_settings"`
	Muted               bool      `gorm:"column:muted"`
	Pinned              bool      `gorm:"column:pinned"`
	AlertEnabled        bool      `gorm:"column:alert_enabled"`
	Background          string    `gorm:"column:background;size:32;default:default"`
	BackgroundImage     string    `gorm:"column:background_image;size:2048"`
	ClearedAtUnixMillis int64     `gorm:"column:cleared_at_unix_ms"`
	UpdatedAt           time.Time `gorm:"column:updated_at"`
}

func (*conversationMemberSettingsModel) TableName() string {
	return "conversation_member_settings"
}

type memberSettingsProjection struct {
	Muted               bool
	Pinned              bool
	AlertEnabled        bool
	Background          string
	BackgroundImage     string
	ClearedAtUnixMillis int64
}

type memberSettingsPatch struct {
	Muted               *bool
	Pinned              *bool
	AlertEnabled        *bool
	Background          *string
	BackgroundImage     *string
	ClearedAtUnixMillis *int64
}

type memberSettingsStore struct {
	db *gorm.DB
}

func newMemberSettingsStore(db *gorm.DB) *memberSettingsStore {
	return &memberSettingsStore{db: db}
}

func (s *memberSettingsStore) Get(
	ctx context.Context,
	conversationID string,
	ptid string,
) (memberSettingsProjection, error) {
	var model conversationMemberSettingsModel
	err := s.db.WithContext(ctx).
		Where("conversation_id = ? AND ptid = ?", conversationID, ptid).
		First(&model).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return memberSettingsProjection{
			AlertEnabled: true,
			Background:   "default",
		}, nil
	}
	if err != nil {
		return memberSettingsProjection{}, err
	}
	return projectMemberSettings(model), nil
}

func (s *memberSettingsStore) Update(
	ctx context.Context,
	conversationID string,
	ptid string,
	patch memberSettingsPatch,
) (memberSettingsProjection, error) {
	updates := map[string]any{"updated_at": time.Now().UTC()}
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
		updates["background"] = normalizeConversationBackground(*patch.Background)
	}
	if patch.BackgroundImage != nil {
		updates["background_image"] = strings.TrimSpace(*patch.BackgroundImage)
	}
	if patch.ClearedAtUnixMillis != nil {
		updates["cleared_at_unix_ms"] = *patch.ClearedAtUnixMillis
	}

	model := conversationMemberSettingsModel{
		ConversationID: conversationID,
		Ptid:           ptid,
		AlertEnabled:   true,
		Background:     "default",
		UpdatedAt:      time.Now().UTC(),
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
		model.Background = normalizeConversationBackground(*patch.Background)
	}
	if patch.BackgroundImage != nil {
		model.BackgroundImage = strings.TrimSpace(*patch.BackgroundImage)
	}
	if patch.ClearedAtUnixMillis != nil {
		model.ClearedAtUnixMillis = *patch.ClearedAtUnixMillis
	}
	if err := s.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "conversation_id"}, {Name: "ptid"}},
			DoUpdates: clause.Assignments(updates),
		}).
		Create(&model).Error; err != nil {
		return memberSettingsProjection{}, err
	}
	return s.Get(ctx, conversationID, ptid)
}

func normalizeConversationBackground(value string) string {
	switch strings.TrimSpace(value) {
	case "paper", "mint", "dusk", "calm", "graphite":
		return strings.TrimSpace(value)
	default:
		return "default"
	}
}

func projectMemberSettings(model conversationMemberSettingsModel) memberSettingsProjection {
	background := normalizeConversationBackground(model.Background)
	return memberSettingsProjection{
		Muted:               model.Muted,
		Pinned:              model.Pinned,
		AlertEnabled:        model.AlertEnabled,
		Background:          background,
		BackgroundImage:     model.BackgroundImage,
		ClearedAtUnixMillis: model.ClearedAtUnixMillis,
	}
}
