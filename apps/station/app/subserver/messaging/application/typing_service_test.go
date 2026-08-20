package application_test

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type recordedTyping struct {
	recipientPTID string
	conversation  string
	senderPTID    string
	isTyping      bool
}

type recordingTypingPublisher struct {
	mu     sync.Mutex
	events []recordedTyping
}

func (publisher *recordingTypingPublisher) PublishTyping(
	_ context.Context,
	recipientPTID string,
	conversationID string,
	senderPTID string,
	isTyping bool,
) error {
	publisher.mu.Lock()
	defer publisher.mu.Unlock()
	publisher.events = append(publisher.events, recordedTyping{
		recipientPTID: recipientPTID,
		conversation:  conversationID,
		senderPTID:    senderPTID,
		isTyping:      isTyping,
	})
	return nil
}

func TestTypingServiceFansOutOnlyAfterActiveMembershipAdmission(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	db, err := gorm.Open(
		sqlite.Open("file:messaging-typing-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&touchactor.DeviceRecord{}, &touchactor.ActorIdentityRecord{}); err != nil {
		t.Fatal(err)
	}
	uow, err := infrastructure.NewAuthorityUnitOfWork(db, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1 << 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := uow.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&infrastructure.AuthorityConversationModel{
		ConversationID:  "conversation-1",
		Kind:            int32(messaging.AuthorityConversationKindGroup),
		MembershipEpoch: 1,
		Active:          true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	members := []infrastructure.AuthorityMemberModel{
		{ConversationID: "conversation-1", PTID: "alice", Role: "member", Active: true},
		{ConversationID: "conversation-1", PTID: "bob", Role: "member", Active: true},
		{ConversationID: "conversation-1", PTID: "carol", Role: "member", Active: true},
		{ConversationID: "conversation-1", PTID: "removed", Role: "member", Active: false},
	}
	if err := db.Create(&members).Error; err != nil {
		t.Fatal(err)
	}
	devices := []touchactor.DeviceRecord{
		typingDevice("alice", "alice-1", false, now),
		typingDevice("alice", "alice-revoked", true, now),
	}
	if err := db.Create(&devices).Error; err != nil {
		t.Fatal(err)
	}

	publisher := &recordingTypingPublisher{}
	service, err := application.NewTypingService(uow, publisher)
	if err != nil {
		t.Fatal(err)
	}
	err = service.BroadcastTyping(
		context.Background(),
		&chat.CryptoEndpoint{Ptid: "alice", DeviceId: "alice-1"},
		"conversation-1",
		true,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(publisher.events) != 2 {
		t.Fatalf("published events = %+v, want bob and carol", publisher.events)
	}
	recipients := map[string]bool{}
	for _, event := range publisher.events {
		recipients[event.recipientPTID] = true
		if event.conversation != "conversation-1" || event.senderPTID != "alice" || !event.isTyping {
			t.Fatalf("invalid typing event: %+v", event)
		}
	}
	if !recipients["bob"] || !recipients["carol"] || recipients["alice"] || recipients["removed"] {
		t.Fatalf("typing recipients = %+v", recipients)
	}

	err = service.BroadcastTyping(
		context.Background(),
		&chat.CryptoEndpoint{Ptid: "alice", DeviceId: "alice-revoked"},
		"conversation-1",
		true,
	)
	if !errors.Is(err, messaging.ErrSenderUnauthorized) {
		t.Fatalf("revoked sender error = %v, want ErrSenderUnauthorized", err)
	}
}

func typingDevice(ptid, deviceID string, revoked bool, now time.Time) touchactor.DeviceRecord {
	return touchactor.DeviceRecord{
		Ptid:               ptid,
		DeviceID:           deviceID,
		HomeStationPeerID:  "station:local",
		PublicKey:          bytes.Repeat([]byte{1}, 32),
		VerificationSource: 1,
		Revoked:            revoked,
		CreatedAt:          now,
	}
}
