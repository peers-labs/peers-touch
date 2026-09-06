package domain

import (
	"context"
	"errors"
)

var ErrMemberSettingsInvalid = errors.New("messaging: member settings are invalid")

type MemberSettings struct {
	Nickname            string
	Muted               bool
	AlertEnabled        bool
	Pinned              bool
	Background          string
	BackgroundImage     string
	ClearedAtUnixMillis int64
}

type MemberSettingsPatch struct {
	Nickname            *string
	Muted               *bool
	AlertEnabled        *bool
	Pinned              *bool
	Background          *string
	BackgroundImage     *string
	ClearedAtUnixMillis *int64
}

type MemberSettingsRepository interface {
	Get(
		ctx context.Context,
		conversationID string,
		ptid string,
	) (MemberSettings, error)
	Update(
		ctx context.Context,
		conversationID string,
		ptid string,
		patch MemberSettingsPatch,
	) (MemberSettings, error)
}
