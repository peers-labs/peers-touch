package conversationengine

import (
	"bytes"
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messagingdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type memberSettingsFixture struct {
	server      *subServer
	memberships *application.MembershipReader
	followers   *infrastructure.FollowerRepository
	settings    *infrastructure.MemberSettingsRepository
}

func newMemberSettingsFixture(t *testing.T) memberSettingsFixture {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	uow, err := infrastructure.NewAuthorityUnitOfWork(
		db,
		messagingdomain.QueueLimits{
			MaxUnackedItems: 100,
			MaxUnackedBytes: 1 << 20,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := uow.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	followers, err := infrastructure.NewFollowerRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	memberships, err := application.NewMembershipReader(
		uow,
		followers,
		"station:local",
	)
	if err != nil {
		t.Fatal(err)
	}
	settings, err := infrastructure.NewMemberSettingsRepository(
		db,
		func() time.Time { return time.Unix(1_800_000_000, 0).UTC() },
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := settings.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	service, err := application.NewMemberSettingsService(memberships, settings)
	if err != nil {
		t.Fatal(err)
	}
	if err := uow.Execute(
		context.Background(),
		func(repositories messagingdomain.AuthorityRepositories) error {
			if _, err := repositories.Authority.CreateConversation(
				context.Background(),
				&messagingdomain.AuthorityConversation{
					ConversationID:  "local-group",
					Kind:            messagingdomain.AuthorityConversationKindGroup,
					OwnerPTID:       "ptid:alice",
					CurrentSequence: 1,
					MembershipEpoch: 1,
					MlsEpoch:        1,
					Active:          true,
				},
			); err != nil {
				return err
			}
			return repositories.Authority.AddMember(
				context.Background(),
				"local-group",
				"ptid:alice",
				"station:local",
				"owner",
				1,
			)
		},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := followers.CreateConversation(
		context.Background(),
		&messagingdomain.FollowerConversation{
			ConversationID:        "remote-group",
			AuthorityStationID:    "station:remote",
			AuthoritySigningKeyID: "remote-key",
			Kind:                  messagingdomain.AuthorityConversationKindGroup,
			Name:                  "Remote group",
			OwnerPTID:             "ptid:bob",
			CurrentSequence:       3,
			CurrentEventHash:      bytes.Repeat([]byte{3}, 32),
			MembershipEpoch:       2,
			MlsEpoch:              1,
			State:                 messagingdomain.FollowerConversationStateActive,
			UpdatedAt:             time.Unix(1_800_000_000, 0).UTC(),
		},
	); err != nil {
		t.Fatal(err)
	}
	for _, member := range []*messagingdomain.FollowerMember{
		{
			ConversationID: "remote-group",
			PTID:           "ptid:alice",
			HomeStationID:  "station:local",
			Role:           "member",
			Active:         true,
			JoinedSequence: 1,
		},
		{
			ConversationID: "remote-group",
			PTID:           "ptid:bob",
			HomeStationID:  "station:remote",
			Role:           "owner",
			Active:         true,
			JoinedSequence: 1,
		},
	} {
		if err := followers.UpsertMember(context.Background(), member); err != nil {
			t.Fatal(err)
		}
	}
	return memberSettingsFixture{
		server: &subServer{
			composition: &Composition{
				MembershipReader:      memberships,
				MemberSettingsService: service,
			},
		},
		memberships: memberships,
		followers:   followers,
		settings:    settings,
	}
}

func TestCanonicalMembershipReaderListsLocalAndVerifiedRemoteConversations(t *testing.T) {
	fixture := newMemberSettingsFixture(t)

	conversations, err := fixture.memberships.ListActiveForActor(
		context.Background(),
		"ptid:alice",
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 2 ||
		conversations[0].ConversationId != "local-group" ||
		conversations[0].AuthorityStationId != "station:local" ||
		conversations[1].ConversationId != "remote-group" ||
		conversations[1].AuthorityStationId != "station:remote" {
		t.Fatalf("canonical conversation list = %+v", conversations)
	}
	local, err := fixture.memberships.RequireActive(
		context.Background(),
		"local-group",
		"ptid:alice",
	)
	if err != nil {
		t.Fatal(err)
	}
	if local.AuthorityStationId != "station:local" {
		t.Fatalf("local membership authority = %q", local.AuthorityStationId)
	}
}

func TestMessagingMemberSettingsUseActorLocalPersistenceForRemoteAuthority(t *testing.T) {
	fixture := newMemberSettingsFixture(t)
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:alice"},
	)
	muted := true
	pinned := true
	background := "mint"
	backgroundImage := "oss://station/background"
	updated, err := fixture.server.handleUpdateMemberSettings(
		ctx,
		&chat.UpdateMessagingMemberSettingsRequest{
			ConversationId:  "remote-group",
			Muted:           &muted,
			Pinned:          &pinned,
			Background:      &background,
			BackgroundImage: &backgroundImage,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Settings == nil ||
		!updated.Settings.Muted ||
		updated.Settings.AlertEnabled ||
		!updated.Settings.Pinned ||
		updated.Settings.Background != "mint" ||
		updated.Settings.BackgroundImage != backgroundImage {
		t.Fatalf("updated settings = %+v", updated.Settings)
	}
	read, err := fixture.server.handleGetMemberSettings(
		ctx,
		&chat.GetMessagingMemberSettingsRequest{ConversationId: "remote-group"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if read.Settings == nil || read.Settings.String() != updated.Settings.String() {
		t.Fatalf("settings readback = %+v, want %+v", read.Settings, updated.Settings)
	}
}

func TestMessagingMemberSettingsRejectRemovedFollowerMember(t *testing.T) {
	fixture := newMemberSettingsFixture(t)
	if err := fixture.followers.UpsertMember(
		context.Background(),
		&messagingdomain.FollowerMember{
			ConversationID: "remote-group",
			PTID:           "ptid:alice",
			HomeStationID:  "station:local",
			Role:           "member",
			Active:         false,
			JoinedSequence: 1,
			LeftSequence:   4,
		},
	); err != nil {
		t.Fatal(err)
	}
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:alice"},
	)
	_, err := fixture.server.handleGetMemberSettings(
		ctx,
		&chat.GetMessagingMemberSettingsRequest{ConversationId: "remote-group"},
	)
	handlerError, ok := err.(*server.HandlerError)
	if !ok || handlerError.Code != http.StatusForbidden {
		t.Fatalf("removed follower member error = %v, want HTTP 403", err)
	}
}
