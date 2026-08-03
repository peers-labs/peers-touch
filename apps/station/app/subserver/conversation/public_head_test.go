package conversation

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/follower"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func TestConversationPublicHeadExposesAuthorityStateToActiveMembers(t *testing.T) {
	db := newTransitionTestDB(t)
	repo := newPostgresConversationRepo(db)
	service := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)
	genesis := testTransition(
		"public-head-genesis",
		0,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "ptid:test:alice",
			ActorHomeStationPeerId: "station-a",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_OWNER,
			DeviceId:               "alice-device",
		}},
	)
	conversation, event, err := service.CreateGroup(
		context.Background(),
		"public head",
		"ptid:test:alice",
		"station-a",
		"alice-device",
		"federation-1",
		"public-head-authority",
		genesis,
	)
	if err != nil {
		t.Fatal(err)
	}

	subserver := &subServer{
		repo:           repo,
		localStationID: "station-a",
		db:             db,
	}
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:test:alice"},
	)
	response, err := subserver.handleGetConversationPublicHead(
		ctx,
		&chat.GetConversationPublicHeadRequest{
			ConversationId: conversation.ConversationId,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	head := response.Head
	if head.Source != chat.ConversationPublicHeadSource_CONVERSATION_PUBLIC_HEAD_SOURCE_AUTHORITY ||
		head.ConversationId != conversation.ConversationId ||
		head.FederationId != conversation.FederationId ||
		head.AuthorityStationPeerId != "station-a" ||
		head.GroupSeq != event.GroupSeq ||
		head.MembershipEpoch != conversation.MembershipEpoch ||
		head.MlsEpoch != conversation.MlsEpoch ||
		head.TransitionId != genesis.TransitionId ||
		!bytesEqual(head.EventHash, event.EventHash) ||
		!bytesEqual(head.CommitSha256, genesis.CommitSha256) {
		t.Fatalf("unexpected authority public head: %+v", head)
	}

	inactiveCtx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:test:mallory"},
	)
	if _, err := subserver.handleGetConversationPublicHead(
		inactiveCtx,
		&chat.GetConversationPublicHeadRequest{
			ConversationId: conversation.ConversationId,
		},
	); err == nil {
		t.Fatal("non-member read of authority public head succeeded")
	}
}

func TestConversationPublicHeadExposesFollowerStateToActiveMembers(t *testing.T) {
	db := newTransitionTestDB(t)
	followerService := follower.NewService(db)
	if err := followerService.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	expected := follower.Head{
		ConversationID:         "public-head-follower",
		FederationID:           "federation-1",
		AuthorityStationPeerID: "station-a",
		AuthorityEpoch:         3,
		GroupSeq:               9,
		EventHash:              []byte("event-hash"),
		MembershipEpoch:        4,
		MlsEpoch:               4,
		TransitionID:           "transition-4",
		CommitSHA256:           []byte("commit-hash"),
		Status:                 "active",
	}
	if err := db.Create(&expected).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&follower.Member{
		ConversationID: expected.ConversationID,
		Ptid:           "ptid:test:bob",
		Status:         int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE),
	}).Error; err != nil {
		t.Fatal(err)
	}

	subserver := &subServer{
		repo: newPostgresConversationRepo(db),
		db:   db,
	}
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:test:bob"},
	)
	response, err := subserver.handleGetConversationPublicHead(
		ctx,
		&chat.GetConversationPublicHeadRequest{
			ConversationId: expected.ConversationID,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	head := response.Head
	if head.Source != chat.ConversationPublicHeadSource_CONVERSATION_PUBLIC_HEAD_SOURCE_FOLLOWER ||
		head.ConversationId != expected.ConversationID ||
		head.FederationId != expected.FederationID ||
		head.AuthorityStationPeerId != expected.AuthorityStationPeerID ||
		head.AuthorityEpoch != expected.AuthorityEpoch ||
		head.GroupSeq != expected.GroupSeq ||
		head.MembershipEpoch != expected.MembershipEpoch ||
		head.MlsEpoch != expected.MlsEpoch ||
		head.TransitionId != expected.TransitionID ||
		head.Status != expected.Status ||
		!bytesEqual(head.EventHash, expected.EventHash) ||
		!bytesEqual(head.CommitSha256, expected.CommitSHA256) {
		t.Fatalf("unexpected follower public head: %+v", head)
	}
}
