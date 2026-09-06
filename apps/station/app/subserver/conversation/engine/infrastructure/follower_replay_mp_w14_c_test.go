package infrastructure_test

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFollowerReplayRepositoryReadGrantedFollowerEvents(t *testing.T) {
	t.Run("returns only the requesting Home Station grant", func(t *testing.T) {
		db, repository := newMPW14CReplayRepository(t)
		event := seedMPW14CReplayEvent(t, db)
		if err := db.Create(&infrastructure.EventProjectionGrantModel{
			ConversationID:      event.ConversationId,
			EventID:             event.EventId,
			TargetHomeStationID: "station:follower",
			EntitlementReason:   "conversation_create",
		}).Error; err != nil {
			t.Fatal(err)
		}

		granted, nextSequence, hasMore, err := repository.ReadGrantedFollowerEvents(
			context.Background(),
			mpW14CReplayRequest(event.ConversationId, "station:follower"),
		)
		if err != nil {
			t.Fatal(err)
		}
		if hasMore ||
			nextSequence != event.Sequence ||
			len(granted) != 1 ||
			granted[0].Event.EventId != event.EventId ||
			granted[0].Grant.TargetHomeStationID != "station:follower" {
			t.Fatalf(
				"granted=%+v next=%d hasMore=%v",
				granted,
				nextSequence,
				hasMore,
			)
		}
	})

	t.Run("rejects an ungranted Home Station", func(t *testing.T) {
		db, repository := newMPW14CReplayRepository(t)
		event := seedMPW14CReplayEvent(t, db)
		if err := db.Create(&infrastructure.EventProjectionGrantModel{
			ConversationID:      event.ConversationId,
			EventID:             event.EventId,
			TargetHomeStationID: "station:follower",
			EntitlementReason:   "conversation_create",
		}).Error; err != nil {
			t.Fatal(err)
		}

		_, _, _, err := repository.ReadGrantedFollowerEvents(
			context.Background(),
			mpW14CReplayRequest(event.ConversationId, "station:other"),
		)
		if !errors.Is(err, messaging.ErrFollowerReplayNotGranted) {
			t.Fatalf("ungranted target error = %v", err)
		}
	})

	t.Run("reports a missing authority source", func(t *testing.T) {
		_, repository := newMPW14CReplayRepository(t)

		_, _, _, err := repository.ReadGrantedFollowerEvents(
			context.Background(),
			mpW14CReplayRequest("conversation:missing", "station:follower"),
		)
		if !errors.Is(err, messaging.ErrFollowerReplayUnavailable) {
			t.Fatalf("missing source error = %v", err)
		}
	})

	t.Run("reports event loss behind a retained grant", func(t *testing.T) {
		db, repository := newMPW14CReplayRepository(t)
		event := seedMPW14CReplayEvent(t, db)
		if err := db.Create(&infrastructure.EventProjectionGrantModel{
			ConversationID:      event.ConversationId,
			EventID:             event.EventId,
			TargetHomeStationID: "station:follower",
			EntitlementReason:   "conversation_create",
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Delete(
			&infrastructure.AuthorityEventModel{},
			"event_id = ?",
			event.EventId,
		).Error; err != nil {
			t.Fatal(err)
		}

		_, _, _, err := repository.ReadGrantedFollowerEvents(
			context.Background(),
			mpW14CReplayRequest(event.ConversationId, "station:follower"),
		)
		if !errors.Is(err, messaging.ErrFollowerReplayUnavailable) {
			t.Fatalf("orphaned grant error = %v", err)
		}
	})
}

func newMPW14CReplayRepository(
	t *testing.T,
) (*gorm.DB, *infrastructure.FollowerReplayRepository) {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:mp-w14-c-replay-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&infrastructure.AuthorityConversationModel{},
		&infrastructure.AuthorityEventModel{},
		&infrastructure.EventProjectionGrantModel{},
	); err != nil {
		t.Fatal(err)
	}
	repository, err := infrastructure.NewFollowerReplayRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	return db, repository
}

func seedMPW14CReplayEvent(
	t *testing.T,
	db *gorm.DB,
) *chat.ConversationEvent {
	t.Helper()
	event := &chat.ConversationEvent{
		EventId:            "event:create",
		ConversationId:     "conversation:mp-w14-c",
		Sequence:           1,
		CommandId:          "command:create",
		EventHash:          bytes.Repeat([]byte{1}, 32),
		AuthorityStationId: "station:authority",
	}
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&infrastructure.AuthorityConversationModel{
		ConversationID:  event.ConversationId,
		Kind:            int32(chat.ConversationKind_CONVERSATION_KIND_GROUP),
		OwnerPTID:       "ptid:alice",
		CurrentSequence: event.Sequence,
		MembershipEpoch: 1,
		MlsEpoch:        1,
		Active:          true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&infrastructure.AuthorityEventModel{
		EventID:        event.EventId,
		ConversationID: event.ConversationId,
		Sequence:       event.Sequence,
		CommandID:      event.CommandId,
		EventHash:      append([]byte(nil), event.EventHash...),
		EventBytes:     eventBytes,
		CommittedAt:    time.Unix(1_800_000_000, 0).UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	return event
}

func mpW14CReplayRequest(
	conversationID string,
	targetHomeStationID string,
) *chat.GetMessagingFollowerEventsRequest {
	return &chat.GetMessagingFollowerEventsRequest{
		FormatVersion:       application.MessagingFollowerReplayFormatVersion,
		ConversationId:      conversationID,
		AuthorityStationId:  "station:authority",
		TargetHomeStationId: targetHomeStationID,
		RequestNonce:        bytes.Repeat([]byte{7}, 32),
		PageLimit:           32,
	}
}
