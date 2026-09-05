package infrastructure_test

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFollowerRepositoryPersistsDuplicateSafeStateAcrossRestart(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	repository, err := infrastructure.NewFollowerRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	conversation := &messaging.FollowerConversation{
		ConversationID:        "conversation-1",
		AuthorityStationID:    "station:authority",
		AuthoritySigningKeyID: "authority-key",
		Kind:                  messaging.AuthorityConversationKindGroup,
		Name:                  "group",
		OwnerPTID:             "alice",
		CurrentSequence:       1,
		CurrentEventHash:      bytes.Repeat([]byte{1}, 32),
		MembershipEpoch:       1,
		MlsEpoch:              1,
		State:                 messaging.FollowerConversationStateActive,
		UpdatedAt:             now,
	}
	created, err := repository.CreateConversation(ctx, conversation)
	if err != nil || !created {
		t.Fatalf("create follower conversation: created=%v err=%v", created, err)
	}
	created, err = repository.CreateConversation(ctx, conversation)
	if err != nil || created {
		t.Fatalf("duplicate follower conversation: created=%v err=%v", created, err)
	}
	conflicting := *conversation
	conflicting.AuthorityStationID = "station:other"
	if _, err := repository.CreateConversation(ctx, &conflicting); !errors.Is(
		err,
		messaging.ErrFollowerProjectionConflict,
	) {
		t.Fatalf("conversation conflict error = %v", err)
	}

	member := &messaging.FollowerMember{
		ConversationID: "conversation-1",
		PTID:           "bob",
		HomeStationID:  "station:follower",
		Role:           "member",
		Active:         true,
		JoinedSequence: 1,
	}
	if err := repository.UpsertMember(ctx, member); err != nil {
		t.Fatal(err)
	}
	routeConflict := *member
	routeConflict.HomeStationID = "station:other"
	if err := repository.UpsertMember(ctx, &routeConflict); !errors.Is(
		err,
		messaging.ErrFollowerProjectionConflict,
	) {
		t.Fatalf("member route conflict error = %v", err)
	}

	receipt := &messaging.FollowerEventReceipt{
		ConversationID: "conversation-1",
		Sequence:       1,
		EventID:        "event-1",
		EventHash:      bytes.Repeat([]byte{1}, 32),
		PreviousHash:   []byte{},
		EventKind:      "conversation_created",
		AppliedAt:      now,
	}
	if err := repository.AppendEventReceipt(ctx, receipt); err != nil {
		t.Fatal(err)
	}
	if err := repository.AppendEventReceipt(ctx, receipt); err != nil {
		t.Fatalf("duplicate receipt: %v", err)
	}
	receiptConflict := *receipt
	receiptConflict.EventID = "event-conflict"
	if err := repository.AppendEventReceipt(ctx, &receiptConflict); !errors.Is(
		err,
		messaging.ErrFollowerProjectionConflict,
	) {
		t.Fatalf("receipt conflict error = %v", err)
	}

	pending := &messaging.FollowerPendingEvent{
		ConversationID:   "conversation-1",
		Sequence:         3,
		EventID:          "event-3",
		EventHash:        bytes.Repeat([]byte{3}, 32),
		PreviousHash:     bytes.Repeat([]byte{2}, 32),
		PublicEventBytes: []byte("public-event"),
		ExpiresAt:        now.Add(10 * time.Minute),
	}
	if err := repository.StorePendingEvent(ctx, pending); err != nil {
		t.Fatal(err)
	}
	if err := repository.StorePendingEvent(ctx, pending); err != nil {
		t.Fatalf("duplicate pending event: %v", err)
	}
	pendingConflict := *pending
	pendingConflict.PublicEventBytes = []byte("different-public-event")
	if err := repository.StorePendingEvent(ctx, &pendingConflict); !errors.Is(
		err,
		messaging.ErrFollowerProjectionConflict,
	) {
		t.Fatalf("pending conflict error = %v", err)
	}

	next := *conversation
	next.CurrentSequence = 2
	next.CurrentEventHash = bytes.Repeat([]byte{2}, 32)
	next.UpdatedAt = now.Add(time.Second)
	if err := repository.AdvanceConversationHead(
		ctx,
		conversation.CurrentSequence,
		conversation.CurrentEventHash,
		&next,
	); err != nil {
		t.Fatal(err)
	}

	restarted, err := infrastructure.NewFollowerRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := restarted.GetConversation(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	members, err := restarted.ListMembers(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	pendingEvents, err := restarted.ListPendingEvents(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.CurrentSequence != 2 ||
		!bytes.Equal(persisted.CurrentEventHash, next.CurrentEventHash) ||
		len(members) != 1 ||
		members[0].HomeStationID != "station:follower" ||
		len(pendingEvents) != 1 ||
		pendingEvents[0].EventID != pending.EventID {
		t.Fatalf(
			"restarted follower state: conversation=%+v members=%+v pending=%+v",
			persisted,
			members,
			pendingEvents,
		)
	}
}

func TestEventProjectionGrantRepositoryIsImmutable(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	repository, err := infrastructure.NewEventProjectionGrantRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	grant := messaging.EventProjectionGrant{
		ConversationID:      "conversation-1",
		EventID:             "event-1",
		TargetHomeStationID: "station:follower",
		EntitlementReason:   "active_member",
	}
	if err := repository.AppendEventProjectionGrants(ctx, []messaging.EventProjectionGrant{grant}); err != nil {
		t.Fatal(err)
	}
	if err := repository.AppendEventProjectionGrants(ctx, []messaging.EventProjectionGrant{grant}); err != nil {
		t.Fatalf("duplicate projection grant: %v", err)
	}
	conflict := grant
	conflict.EntitlementReason = "membership_pre_state"
	if err := repository.AppendEventProjectionGrants(
		ctx,
		[]messaging.EventProjectionGrant{conflict},
	); !errors.Is(err, messaging.ErrProjectionGrantConflict) {
		t.Fatalf("projection grant conflict error = %v", err)
	}
	grants, err := repository.ListEventProjectionGrants(
		ctx,
		grant.ConversationID,
		grant.EventID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 || grants[0] != grant {
		t.Fatalf("persisted projection grants = %+v", grants)
	}
}
