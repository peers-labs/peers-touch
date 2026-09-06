package conversation

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
	enginedomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	engineinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newSettingsAuthorityTestServer(
	t *testing.T,
	active bool,
) *subServer {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	authority := engineinfra.NewAuthorityRepository(db)
	if err := authority.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&conversationMemberSettingsModel{}); err != nil {
		t.Fatal(err)
	}
	if _, err := authority.CreateConversation(
		context.Background(),
		&enginedomain.AuthorityConversation{
			ConversationID:  "group-1",
			Kind:            enginedomain.AuthorityConversationKindGroup,
			OwnerPTID:       "ptid:alice",
			CurrentSequence: 1,
			MembershipEpoch: 1,
			MlsEpoch:        1,
			Active:          active,
		},
	); err != nil {
		t.Fatal(err)
	}
	if err := authority.AddMember(
		context.Background(),
		"group-1",
		"ptid:alice",
		"owner",
		1,
	); err != nil {
		t.Fatal(err)
	}
	return &subServer{
		conversationAuthority: authority,
		memberSettings:        newMemberSettingsStore(db),
	}
}

func TestSettingsMembershipUsesMessagingAuthority(t *testing.T) {
	subserver := newSettingsAuthorityTestServer(t, true)
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:alice"},
	)

	conversation, err := subserver.requireActiveConversationMembership(
		ctx,
		"group-1",
	)
	if err != nil {
		t.Fatalf("canonical messaging member should be allowed: %v", err)
	}
	if conversation.ConversationID != "group-1" ||
		conversation.Kind != enginedomain.AuthorityConversationKindGroup {
		t.Fatalf("unexpected authority conversation: %+v", conversation)
	}
}

func TestSettingsMembershipRejectsMissingOrInactiveAuthority(t *testing.T) {
	tests := []struct {
		name      string
		active    bool
		subjectID string
	}{
		{name: "missing member", active: true, subjectID: "ptid:bob"},
		{name: "inactive conversation", active: false, subjectID: "ptid:alice"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			subserver := newSettingsAuthorityTestServer(t, test.active)
			ctx := coreauth.WithSubject(
				context.Background(),
				&coreauth.Subject{ID: test.subjectID},
			)

			_, err := subserver.requireActiveConversationMembership(ctx, "group-1")
			handlerErr, ok := err.(*server.HandlerError)
			if !ok || handlerErr.Code != http.StatusForbidden {
				t.Fatalf("expected HTTP 403, got %v", err)
			}
		})
	}
}

func TestUpdateMemberSettingsReturnsCommittedStateWhenRealtimeUnavailable(t *testing.T) {
	subserver := newSettingsAuthorityTestServer(t, true)
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:alice"},
	)
	nickname := "Committed nickname"
	muted := true

	response, err := subserver.handleUpdateMemberSettings(
		ctx,
		&updateMemberSettingsRequest{
			ConversationID: "group-1",
			Nickname:       &nickname,
			Muted:          &muted,
		},
	)
	if err != nil {
		t.Fatalf("committed settings returned an error when realtime was unavailable: %v", err)
	}
	if response.Nickname != nickname || !response.Muted || response.AlertEnabled {
		t.Fatalf("unexpected committed response: %+v", response)
	}

	persisted, err := subserver.memberSettings.Get(ctx, "group-1", "ptid:alice")
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Nickname != nickname || !persisted.Muted || persisted.AlertEnabled {
		t.Fatalf("unexpected persisted settings: %+v", persisted)
	}
}
