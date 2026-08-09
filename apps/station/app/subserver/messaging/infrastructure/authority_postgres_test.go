package infrastructure_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestPostgresConcurrentAuthorityAndLaneSequences(t *testing.T) {
	db := openIsolatedPostgres(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(8)

	limits := messaging.QueueLimits{MaxUnackedItems: 100, MaxUnackedBytes: 1024 * 1024}
	uow, err := infrastructure.NewAuthorityUnitOfWork(db, limits)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&touchactor.ActorIdentityRecord{},
		&touchactor.DeviceRecord{},
	); err != nil {
		t.Fatal(err)
	}
	if err := uow.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	service, err := application.NewAuthorityService(uow, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}

	suffix := uuid.NewString()
	conversationID := "pg-conversation-" + suffix
	alice := "pg-alice-" + suffix
	bob := "pg-bob-" + suffix
	aliceIdentityKey := bytes.Repeat([]byte{1}, 32)
	aliceIdentityFingerprint := sha256.Sum256(aliceIdentityKey)
	bobIdentityKey := bytes.Repeat([]byte{2}, 32)
	bobIdentityFingerprint := sha256.Sum256(bobIdentityKey)
	if err := db.Create(&[]touchactor.ActorIdentityRecord{
		{
			PTID:           alice,
			PublicKey:      aliceIdentityKey,
			Fingerprint:    aliceIdentityFingerprint[:],
			ProfileVersion: 1,
			CreatedAt:      now,
			UpdatedAt:      now,
		},
		{
			PTID:           bob,
			PublicKey:      bobIdentityKey,
			Fingerprint:    bobIdentityFingerprint[:],
			ProfileVersion: 1,
			CreatedAt:      now,
			UpdatedAt:      now,
		},
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&infrastructure.AuthorityConversationModel{
		ConversationID:  conversationID,
		Kind:            int32(messaging.AuthorityConversationKindDirect),
		MembershipEpoch: 1,
		Active:          true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]touchactor.DeviceRecord{
		verifiedDeviceRecord(alice, "device-1", now),
		verifiedDeviceRecord(alice, "device-2", now),
		verifiedDeviceRecord(bob, "device-1", now),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]infrastructure.AuthorityMemberDeviceModel{
		{ConversationID: conversationID, PTID: alice, DeviceID: "device-1", Active: true},
		{ConversationID: conversationID, PTID: alice, DeviceID: "device-2", Active: true},
		{ConversationID: conversationID, PTID: bob, DeviceID: "device-1", Active: true},
	}).Error; err != nil {
		t.Fatal(err)
	}

	command := func(commandID string) *chat.ChatCommand {
		value := func(ptid, deviceID string) *chat.PreparedEndpointPayload {
			payload := []byte(commandID + ":" + ptid + ":" + deviceID)
			hash := sha256.Sum256(payload)
			return &chat.PreparedEndpointPayload{
				Recipient:     &chat.CryptoEndpoint{Ptid: ptid, DeviceId: deviceID},
				Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_CIPHERTEXT,
				OpaquePayload: payload,
				PayloadSha256: hash[:],
			}
		}
		return &chat.ChatCommand{
			CommandId:       commandID,
			ConversationId:  conversationID,
			Sender:          &chat.CryptoEndpoint{Ptid: alice, DeviceId: "device-1"},
			ClientTimestamp: timestamppb.New(now),
			Payload: &chat.ChatCommand_SendMessage{SendMessage: &chat.SendMessageIntent{
				MessageId:   "message-" + commandID,
				ContentKind: chat.MessagingContentKind_MESSAGING_CONTENT_KIND_TEXT,
				DirectPayloads: []*chat.PreparedEndpointPayload{
					value(alice, "device-2"),
					value(bob, "device-1"),
				},
			}},
		}
	}

	events := make([]*chat.ConversationEvent, 2)
	errs := make([]error, 2)
	commands := []*chat.ChatCommand{command("command-0"), command("command-1")}
	for _, prepared := range commands {
		bindSendPlan(t, service, prepared)
	}
	var wait sync.WaitGroup
	for index := range events {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			events[index], errs[index] = service.Submit(
				context.Background(),
				commands[index],
			)
		}(index)
	}
	wait.Wait()
	staleIndex := -1
	for index, err := range errs {
		if errors.Is(err, messaging.ErrStaleDeliveryPlan) {
			staleIndex = index
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if staleIndex < 0 {
		t.Fatalf("competing prepared commands did not fence a stale plan: %v", errs)
	}
	bindSendPlan(t, service, commands[staleIndex])
	events[staleIndex], errs[staleIndex] = service.Submit(
		context.Background(),
		commands[staleIndex],
	)
	if errs[staleIndex] != nil {
		t.Fatal(errs[staleIndex])
	}
	sequences := []int64{events[0].Sequence, events[1].Sequence}
	sort.Slice(sequences, func(i, j int) bool { return sequences[i] < sequences[j] })
	if sequences[0] != 1 || sequences[1] != 2 {
		t.Fatalf("authority sequences = %v, want [1 2]", sequences)
	}
	for _, endpoint := range [][2]string{{alice, "device-2"}, {bob, "device-1"}} {
		var lane infrastructure.DeviceQueueLaneModel
		if err := db.First(
			&lane,
			"recipient_ptid = ? AND recipient_device_id = ?",
			endpoint[0],
			endpoint[1],
		).Error; err != nil {
			t.Fatal(err)
		}
		if lane.NextSequence != 2 {
			t.Fatalf("lane %v next sequence = %d, want 2", endpoint, lane.NextSequence)
		}
	}
}
