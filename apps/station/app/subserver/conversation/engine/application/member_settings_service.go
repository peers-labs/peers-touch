package application

import (
	"context"
	"fmt"
	"strings"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type MemberSettingsService struct {
	memberships *MembershipReader
	settings    messaging.MemberSettingsRepository
}

type UpdatedMemberSettings struct {
	Conversation *chat.MessagingConversationView
	Response     *chat.UpdateMessagingMemberSettingsResponse
}

func NewMemberSettingsService(
	memberships *MembershipReader,
	settings messaging.MemberSettingsRepository,
) (*MemberSettingsService, error) {
	if memberships == nil || settings == nil {
		return nil, fmt.Errorf("messaging: member settings service dependencies are invalid")
	}
	return &MemberSettingsService{
		memberships: memberships,
		settings:    settings,
	}, nil
}

func (s *MemberSettingsService) Get(
	ctx context.Context,
	ptid string,
	request *chat.GetMessagingMemberSettingsRequest,
) (*chat.GetMessagingMemberSettingsResponse, error) {
	if request == nil || strings.TrimSpace(request.ConversationId) == "" || ptid == "" {
		return nil, messaging.ErrMemberSettingsInvalid
	}
	if _, err := s.memberships.RequireActive(ctx, request.ConversationId, ptid); err != nil {
		return nil, err
	}
	settings, err := s.settings.Get(ctx, request.ConversationId, ptid)
	if err != nil {
		return nil, err
	}
	return &chat.GetMessagingMemberSettingsResponse{
		Settings: memberSettingsProto(settings),
	}, nil
}

func (s *MemberSettingsService) Update(
	ctx context.Context,
	ptid string,
	request *chat.UpdateMessagingMemberSettingsRequest,
) (*UpdatedMemberSettings, error) {
	if request == nil || strings.TrimSpace(request.ConversationId) == "" || ptid == "" {
		return nil, messaging.ErrMemberSettingsInvalid
	}
	conversation, err := s.memberships.RequireActive(ctx, request.ConversationId, ptid)
	if err != nil {
		return nil, err
	}
	patch, err := memberSettingsPatch(request)
	if err != nil {
		return nil, err
	}
	settings, err := s.settings.Update(ctx, request.ConversationId, ptid, patch)
	if err != nil {
		return nil, err
	}
	return &UpdatedMemberSettings{
		Conversation: conversation,
		Response: &chat.UpdateMessagingMemberSettingsResponse{
			Settings: memberSettingsProto(settings),
		},
	}, nil
}

func memberSettingsPatch(
	request *chat.UpdateMessagingMemberSettingsRequest,
) (messaging.MemberSettingsPatch, error) {
	if request.Muted != nil &&
		request.AlertEnabled != nil &&
		*request.Muted == *request.AlertEnabled {
		return messaging.MemberSettingsPatch{}, messaging.ErrMemberSettingsInvalid
	}
	muted := request.Muted
	alertEnabled := request.AlertEnabled
	if muted != nil && alertEnabled == nil {
		value := !*muted
		alertEnabled = &value
	}
	if alertEnabled != nil && muted == nil {
		value := !*alertEnabled
		muted = &value
	}
	backgroundImage := request.BackgroundImage
	if backgroundImage != nil {
		normalized := strings.TrimSpace(*backgroundImage)
		if normalized != "" &&
			(!strings.HasPrefix(normalized, "oss://") || len(normalized) > 2048) {
			return messaging.MemberSettingsPatch{}, messaging.ErrMemberSettingsInvalid
		}
		backgroundImage = &normalized
	}
	return messaging.MemberSettingsPatch{
		Nickname:            request.Nickname,
		Muted:               muted,
		AlertEnabled:        alertEnabled,
		Pinned:              request.Pinned,
		Background:          request.Background,
		BackgroundImage:     backgroundImage,
		ClearedAtUnixMillis: request.ClearedAtUnixMs,
	}, nil
}

func memberSettingsProto(settings messaging.MemberSettings) *chat.MessagingMemberSettings {
	return &chat.MessagingMemberSettings{
		Nickname:        settings.Nickname,
		Muted:           settings.Muted,
		AlertEnabled:    settings.AlertEnabled,
		Pinned:          settings.Pinned,
		Background:      settings.Background,
		ClearedAtUnixMs: settings.ClearedAtUnixMillis,
		BackgroundImage: settings.BackgroundImage,
	}
}
