package conversation

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	envinf "github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newTransitionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "file:" + uuid.NewString() + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&conversationModel{},
		&conversationMemberModel{},
		&conversationMemberDeviceModel{},
		&conversationEventModel{},
		&conversationCommandReceiptModel{},
		&mlsLeaveIntentModel{},
	); err != nil {
		t.Fatalf("migrate conversation: %v", err)
	}
	if err := envinf.NewPostgresRepository(db).AutoMigrate(); err != nil {
		t.Fatalf("migrate envelope: %v", err)
	}
	return db
}

func transitionTestConversation(id string) *chat.Conversation {
	now := timestamppb.New(time.Now())
	return &chat.Conversation{
		ConversationId:         id,
		Kind:                   chat.ConversationKind_CONVERSATION_KIND_GROUP,
		AuthorityStationPeerId: "station-a",
		MembershipEpoch:        1,
		MlsEpoch:               1,
		Status:                 chat.ConversationStatus_CONVERSATION_STATUS_ACTIVE,
		CreatedAt:              now,
		UpdatedAt:              now,
	}
}

func TestTransitionUnitOfWorkRollsBackConversationAndOutbox(t *testing.T) {
	ctx := context.Background()
	db := newTransitionTestDB(t)
	uow := NewPostgresTransitionUnitOfWork(db)
	sentinel := errors.New("inject failure")

	err := uow.Execute(ctx, func(repos TransitionRepositories) error {
		if err := repos.Conversation.UpsertConversation(ctx, transitionTestConversation("group-rollback")); err != nil {
			return err
		}
		_, err := repos.Envelope.EnqueueOutbox(ctx, &chat.OutboxItem{
			OutboxItemId:        "outbox-rollback",
			TargetStationPeerId: "station-b",
			Envelope: &chat.StationEnvelope{
				EnvelopeId:     "envelope-rollback",
				IdempotencyKey: "transition-rollback:station-b",
			},
		})
		if err != nil {
			return err
		}
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("execute error = %v, want sentinel", err)
	}

	var conversations int64
	if err := db.Model(&conversationModel{}).Count(&conversations).Error; err != nil {
		t.Fatal(err)
	}
	var outbox int64
	if err := db.Model(&envinf.OutboxModel{}).Count(&outbox).Error; err != nil {
		t.Fatal(err)
	}
	if conversations != 0 || outbox != 0 {
		t.Fatalf("partial transaction persisted: conversations=%d outbox=%d", conversations, outbox)
	}
}

func TestTransitionUnitOfWorkCommitsEpochEventAndOutbox(t *testing.T) {
	ctx := context.Background()
	db := newTransitionTestDB(t)
	uow := NewPostgresTransitionUnitOfWork(db)
	const conversationID = "group-success"
	const transitionID = "transition-success"

	err := uow.Execute(ctx, func(repos TransitionRepositories) error {
		if err := repos.Conversation.UpsertConversation(ctx, transitionTestConversation(conversationID)); err != nil {
			return err
		}
		if err := repos.Conversation.SetMembershipAndMlsEpoch(ctx, conversationID, 2, 2); err != nil {
			return err
		}
		now := timestamppb.New(time.Now())
		event := &chat.CommittedConversationEvent{
			EventId:         "event-success",
			ConversationId:  conversationID,
			GroupSeq:        1,
			MembershipEpoch: 2,
			CommittedAt:     now,
			EventHash:       []byte("event-hash"),
			Payload: &chat.CommittedConversationEvent_MembershipTransitionCommitted{
				MembershipTransitionCommitted: &chat.MembershipTransitionCommittedEvent{
					TransitionId:        transitionID,
					FromMembershipEpoch: 1,
					ToMembershipEpoch:   2,
					FromMlsEpoch:        1,
					ToMlsEpoch:          2,
					CommitSha256:        []byte("commit-hash"),
				},
			},
		}
		if err := repos.Conversation.AppendEvent(ctx, event); err != nil {
			return err
		}
		_, err := repos.Envelope.EnqueueOutbox(ctx, &chat.OutboxItem{
			OutboxItemId:        "outbox-success",
			TargetStationPeerId: "station-b",
			Envelope: &chat.StationEnvelope{
				EnvelopeId:     "envelope-success",
				IdempotencyKey: transitionID + ":station-b",
			},
		})
		return err
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}

	repo := newPostgresConversationRepo(db)
	conversation, err := repo.GetConversation(ctx, conversationID)
	if err != nil {
		t.Fatal(err)
	}
	if conversation.MembershipEpoch != 2 || conversation.MlsEpoch != 2 {
		t.Fatalf("epochs = (%d,%d), want (2,2)", conversation.MembershipEpoch, conversation.MlsEpoch)
	}
	event, err := repo.GetEventByTransitionID(ctx, conversationID, transitionID)
	if err != nil {
		t.Fatal(err)
	}
	if event.GetMembershipTransitionCommitted().GetCommitSha256() == nil {
		t.Fatal("transition event lost commit hash")
	}
	var outbox int64
	if err := db.Model(&envinf.OutboxModel{}).Count(&outbox).Error; err != nil {
		t.Fatal(err)
	}
	if outbox != 1 {
		t.Fatalf("outbox rows = %d, want 1", outbox)
	}
}

func TestMembershipTransitionRollsBackAtEveryWriteBoundary(t *testing.T) {
	writeCount := runInjectedTransition(t, 0)
	if writeCount == 0 {
		t.Fatal("transition executed without observed writes")
	}
	for failAt := 1; failAt <= writeCount; failAt++ {
		t.Run(fmt.Sprintf("write_%02d", failAt), func(t *testing.T) {
			runInjectedTransition(t, failAt)
		})
	}
}

func TestOrdinaryCommandRollsBackAtEveryWriteBoundary(t *testing.T) {
	writeCount := runInjectedOrdinaryCommand(t, 0)
	if writeCount == 0 {
		t.Fatal("ordinary command executed without observed writes")
	}
	for failAt := 1; failAt <= writeCount; failAt++ {
		t.Run(fmt.Sprintf("write_%02d", failAt), func(t *testing.T) {
			runInjectedOrdinaryCommand(t, failAt)
		})
	}
}

func runInjectedOrdinaryCommand(t *testing.T, failAt int) int {
	t.Helper()
	ctx := context.Background()
	db := newTransitionTestDB(t)
	repo := newPostgresConversationRepo(db)
	bootstrap := NewConversationService(repo, nil, "station-a")
	conversation, err := bootstrap.CreateDirect(
		ctx,
		"alice",
		"bob",
		"station-a",
		"station-b",
	)
	if err != nil {
		t.Fatal(err)
	}
	service := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)

	count := func(model any) int64 {
		t.Helper()
		var value int64
		if err := db.Model(model).Count(&value).Error; err != nil {
			t.Fatal(err)
		}
		return value
	}
	eventsBefore := count(&conversationEventModel{})
	receiptsBefore := count(&conversationCommandReceiptModel{})
	inboxBefore := count(&envinf.InboxModel{})
	outboxBefore := count(&envinf.OutboxModel{})
	idempotencyBefore := count(&envinf.IdempotencyModel{})
	var headBefore conversationModel
	if err := db.Where("conversation_id = ?", conversation.ConversationId).
		First(&headBefore).Error; err != nil {
		t.Fatal(err)
	}

	sentinel := errors.New("injected ordinary command write failure")
	writes := 0
	inject := func(tx *gorm.DB) {
		writes++
		if failAt > 0 && writes == failAt {
			tx.AddError(sentinel)
		}
	}
	if err := db.Callback().Create().
		Before("gorm:create").
		Register("d17_inject_create", inject); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Update().
		Before("gorm:update").
		Register("d17_inject_update", inject); err != nil {
		t.Fatal(err)
	}

	_, err = service.SubmitCommand(ctx, &chat.ConversationCommand{
		CommandId:      "ordinary-command",
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				DevicePayloads: []*chat.DeviceEncryptedPayload{{
					RecipientPtid:     "bob",
					RecipientDeviceId: "bob-device",
					SessionId:         "alice-device:bob-device",
					EncryptedEnvelope: []byte("opaque-ciphertext"),
				}},
				ContentType: chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	})
	if failAt == 0 {
		if err != nil {
			t.Fatalf("baseline ordinary command: %v", err)
		}
		return writes
	}
	if !errors.Is(err, sentinel) {
		t.Fatalf("write %d error = %v, want injected failure", failAt, err)
	}

	var headAfter conversationModel
	if err := db.Where("conversation_id = ?", conversation.ConversationId).
		First(&headAfter).Error; err != nil {
		t.Fatal(err)
	}
	if headAfter.CurrentSeq != headBefore.CurrentSeq {
		t.Fatalf(
			"write %d leaked sequence: %d -> %d",
			failAt,
			headBefore.CurrentSeq,
			headAfter.CurrentSeq,
		)
	}
	assertCount := func(name string, model any, before int64) {
		t.Helper()
		if after := count(model); after != before {
			t.Fatalf("write %d leaked %s rows: %d -> %d", failAt, name, before, after)
		}
	}
	assertCount("event", &conversationEventModel{}, eventsBefore)
	assertCount("receipt", &conversationCommandReceiptModel{}, receiptsBefore)
	assertCount("inbox", &envinf.InboxModel{}, inboxBefore)
	assertCount("outbox", &envinf.OutboxModel{}, outboxBefore)
	assertCount("idempotency", &envinf.IdempotencyModel{}, idempotencyBefore)
	return writes
}

func runInjectedTransition(t *testing.T, failAt int) int {
	t.Helper()
	ctx := context.Background()
	db := newTransitionTestDB(t)
	repo := newPostgresConversationRepo(db)
	service := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)
	genesis := testTransition(
		"failure-genesis",
		0,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "alice",
			ActorHomeStationPeerId: "station-a",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_OWNER,
		}},
	)
	conversation, _, err := service.CreateGroup(
		ctx,
		"family",
		"alice",
		"station-a",
		"alice-device",
		"",
		"",
		genesis,
	)
	if err != nil {
		t.Fatal(err)
	}

	var inboxBefore, outboxBefore, idempotencyBefore, receiptsBefore int64
	if err := db.Model(&envinf.InboxModel{}).Count(&inboxBefore).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&envinf.OutboxModel{}).Count(&outboxBefore).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&envinf.IdempotencyModel{}).Count(&idempotencyBefore).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&conversationCommandReceiptModel{}).Count(&receiptsBefore).Error; err != nil {
		t.Fatal(err)
	}

	sentinel := errors.New("injected transition write failure")
	writes := 0
	inject := func(tx *gorm.DB) {
		writes++
		if failAt > 0 && writes == failAt {
			tx.AddError(sentinel)
		}
	}
	if err := db.Callback().Create().
		Before("gorm:create").
		Register("d13_inject_create", inject); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Update().
		Before("gorm:update").
		Register("d13_inject_update", inject); err != nil {
		t.Fatal(err)
	}

	transition := testTransition(
		"failure-add-bob",
		1,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "bob",
			ActorHomeStationPeerId: "station-b",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		}},
		testWelcome("bob", "bob-device", "station-b", "welcome-bob"),
	)
	_, err = service.SubmitCommand(ctx, &chat.ConversationCommand{
		CommandId:      nextTestCommandID(),
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_MembershipTransition{
			MembershipTransition: transition,
		},
	})
	if failAt == 0 {
		if err != nil {
			t.Fatalf("baseline transition: %v", err)
		}
		return writes
	}
	if !errors.Is(err, sentinel) {
		t.Fatalf("write %d error = %v, want injected failure", failAt, err)
	}

	persistedConversation, err := repo.GetConversation(ctx, conversation.ConversationId)
	if err != nil {
		t.Fatal(err)
	}
	if persistedConversation.MembershipEpoch != 1 || persistedConversation.MlsEpoch != 1 {
		t.Fatalf(
			"write %d leaked epochs (%d,%d)",
			failAt,
			persistedConversation.MembershipEpoch,
			persistedConversation.MlsEpoch,
		)
	}
	if _, err := repo.GetMember(ctx, conversation.ConversationId, "bob"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("write %d leaked bob membership: %v", failAt, err)
	}
	if _, err := repo.GetEventByTransitionID(
		ctx,
		conversation.ConversationId,
		transition.TransitionId,
	); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("write %d leaked transition event: %v", failAt, err)
	}

	var inboxAfter, outboxAfter, idempotencyAfter, receiptsAfter int64
	if err := db.Model(&envinf.InboxModel{}).Count(&inboxAfter).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&envinf.OutboxModel{}).Count(&outboxAfter).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&envinf.IdempotencyModel{}).Count(&idempotencyAfter).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&conversationCommandReceiptModel{}).Count(&receiptsAfter).Error; err != nil {
		t.Fatal(err)
	}
	if inboxAfter != inboxBefore ||
		outboxAfter != outboxBefore ||
		idempotencyAfter != idempotencyBefore ||
		receiptsAfter != receiptsBefore {
		t.Fatalf(
			"write %d leaked rows: inbox %d/%d outbox %d/%d idempotency %d/%d receipts %d/%d",
			failAt,
			inboxAfter,
			inboxBefore,
			outboxAfter,
			outboxBefore,
			idempotencyAfter,
			idempotencyBefore,
			receiptsAfter,
			receiptsBefore,
		)
	}
	return writes
}
