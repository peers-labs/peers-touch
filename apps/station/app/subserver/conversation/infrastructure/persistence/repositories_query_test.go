package persistence

import (
	"context"
	"fmt"
	"testing"
	"time"

	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestEventRepositoryCanonicalMessageQueries(t *testing.T) {
	ctx := context.Background()
	db, err := gorm.Open(
		sqlite.Open("file:conversation-query-"+time.Now().Format("150405.000000000")+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&ConversationEventModel{}); err != nil {
		t.Fatal(err)
	}

	repository := newEventRepository(db, domainevent.CanonicalSealer{})
	conversationID := valueobject.ConversationID("conversation-query")
	baseTime := time.Date(2026, time.September, 7, 12, 0, 0, 0, time.UTC)
	var previous valueobject.Hash
	appendEvent := func(event domainevent.Record) {
		t.Helper()
		if err := repository.Append(ctx, event); err != nil {
			t.Fatalf("Append(sequence=%d) error = %v", event.Sequence, err)
		}
		previous = event.Hash
	}

	appendEvent(canonicalMessageQueryEvent(
		t,
		conversationID,
		1,
		previous,
		"message-root-a",
		"thread-a",
		baseTime.Add(time.Second),
	))
	appendEvent(canonicalNonMessageQueryEvent(
		t,
		conversationID,
		2,
		previous,
		baseTime.Add(2*time.Second),
	))
	for sequence := 3; sequence < 3+messageQueryBatchSize; sequence++ {
		appendEvent(canonicalMessageQueryEvent(
			t,
			conversationID,
			valueobject.Sequence(sequence),
			previous,
			valueobject.MessageID(fmt.Sprintf("message-b-%03d", sequence)),
			"thread-b",
			baseTime.Add(time.Duration(sequence)*time.Second),
		))
	}
	lastThreadA := canonicalMessageQueryEvent(
		t,
		conversationID,
		valueobject.Sequence(3+messageQueryBatchSize),
		previous,
		"message-latest-a",
		"thread-a",
		baseTime.Add(time.Duration(3+messageQueryBatchSize)*time.Second),
	)
	appendEvent(lastThreadA)

	t.Run("filters before applying the message page limit", func(t *testing.T) {
		events, err := repository.ListMessages(ctx, conversationID, 1, 2)
		if err != nil {
			t.Fatalf("ListMessages() error = %v", err)
		}
		if len(events) != 2 || events[0].Sequence != 3 || events[1].Sequence != 4 {
			t.Fatalf("ListMessages() sequences = %v, want [3 4]", eventSequences(events))
		}
	})

	t.Run("continues keyset scans until a sparse thread page is full", func(t *testing.T) {
		events, err := repository.ListThreadMessages(ctx, conversationID, "thread-a", 1, 1)
		if err != nil {
			t.Fatalf("ListThreadMessages() error = %v", err)
		}
		if len(events) != 1 || events[0].Fact.MessageID != lastThreadA.Fact.MessageID {
			t.Fatalf("ListThreadMessages() = %v, want %s", messageIDs(events), lastThreadA.Fact.MessageID)
		}
	})

	t.Run("returns deterministic counts and latest replies", func(t *testing.T) {
		counts, err := repository.ThreadCounts(
			ctx,
			conversationID,
			[]valueobject.MessageID{"thread-b", "thread-a", "thread-b", "thread-empty"},
		)
		if err != nil {
			t.Fatalf("ThreadCounts() error = %v", err)
		}
		if len(counts) != 3 {
			t.Fatalf("ThreadCounts() len = %d, want 3", len(counts))
		}
		if counts[0].RootMessageID != "thread-a" ||
			counts[0].ReplyCount != 2 ||
			counts[0].LatestReplyID != lastThreadA.Fact.MessageID ||
			!counts[0].LatestReplyAt.Equal(lastThreadA.CommittedAt) {
			t.Fatalf("thread-a count = %+v", counts[0])
		}
		if counts[1].RootMessageID != "thread-b" ||
			counts[1].ReplyCount != int64(messageQueryBatchSize) ||
			counts[1].LatestReplyID != valueobject.MessageID(
				fmt.Sprintf("message-b-%03d", 2+messageQueryBatchSize),
			) {
			t.Fatalf("thread-b count = %+v", counts[1])
		}
		if counts[2].RootMessageID != "thread-empty" || counts[2].ReplyCount != 0 {
			t.Fatalf("empty thread count = %+v", counts[2])
		}
	})
}

func canonicalMessageQueryEvent(
	t *testing.T,
	conversationID valueobject.ConversationID,
	sequence valueobject.Sequence,
	previous valueobject.Hash,
	messageID valueobject.MessageID,
	threadRootID valueobject.MessageID,
	committedAt time.Time,
) domainevent.Record {
	t.Helper()
	commandID := valueobject.CommandID(fmt.Sprintf("command-%d", sequence))
	actor := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-device"}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(&chat.ChatCommand{
		ConversationId: string(conversationID),
		CommandId:      string(commandID),
		Sender: &chat.CryptoEndpoint{
			Ptid:     string(actor.Actor),
			DeviceId: string(actor.Device),
		},
		Payload: &chat.ChatCommand_SendMessage{
			SendMessage: &chat.SendMessageIntent{
				MessageId:           string(messageID),
				ThreadRootMessageId: string(threadRootID),
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal message command: %v", err)
	}
	event, err := domainevent.NewRecord(domainevent.RecordInput{
		ID:               valueobject.EventID(fmt.Sprintf("event-%d", sequence)),
		ConversationID:   conversationID,
		Sequence:         sequence,
		CommandID:        commandID,
		Actor:            actor,
		PreviousHash:     previous,
		CommittedAt:      committedAt,
		MembershipEpoch:  1,
		AuthorityStation: "station-a",
		Fact: domainevent.NewCommandCommittedFact(
			domainevent.KindMessageCommitted,
			messageID,
			payload,
		),
	})
	if err != nil {
		t.Fatalf("NewRecord(message sequence=%d) error = %v", sequence, err)
	}
	return event
}

func canonicalNonMessageQueryEvent(
	t *testing.T,
	conversationID valueobject.ConversationID,
	sequence valueobject.Sequence,
	previous valueobject.Hash,
	committedAt time.Time,
) domainevent.Record {
	t.Helper()
	event, err := domainevent.NewRecord(domainevent.RecordInput{
		ID:               valueobject.EventID(fmt.Sprintf("event-%d", sequence)),
		ConversationID:   conversationID,
		Sequence:         sequence,
		CommandID:        valueobject.CommandID(fmt.Sprintf("command-%d", sequence)),
		Actor:            valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-device"},
		PreviousHash:     previous,
		CommittedAt:      committedAt,
		MembershipEpoch:  1,
		AuthorityStation: "station-a",
		Fact: domainevent.NewCommandCommittedFact(
			domainevent.KindReactionCommitted,
			"message-root-a",
			[]byte("reaction"),
		),
	})
	if err != nil {
		t.Fatalf("NewRecord(non-message sequence=%d) error = %v", sequence, err)
	}
	return event
}

func eventSequences(events []domainevent.Record) []valueobject.Sequence {
	sequences := make([]valueobject.Sequence, 0, len(events))
	for _, event := range events {
		sequences = append(sequences, event.Sequence)
	}
	return sequences
}

func messageIDs(events []domainevent.Record) []valueobject.MessageID {
	ids := make([]valueobject.MessageID, 0, len(events))
	for _, event := range events {
		ids = append(ids, event.Fact.MessageID)
	}
	return ids
}
