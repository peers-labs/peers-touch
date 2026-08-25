package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func openTurnAdmissionDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open admission db: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.Conversation{},
		&persistence.AgentTurn{},
		&persistence.TurnQueueEntry{},
	); err != nil {
		t.Fatalf("migrate admission db: %v", err)
	}
	return db
}

func seedAdmissionConversation(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.Create(&persistence.Conversation{
		ID:         "conversation-1",
		AgentID:    "agent-1",
		Ptid:       "ptid:actor-1",
		Title:      "Queue",
		ProviderID: "provider-1",
		Status:     "active",
		Version:    1,
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
}

func admissionRequest(key string, input string) *model.ExecuteTurnRequest {
	return &model.ExecuteTurnRequest{
		ConversationId:       "conversation-1",
		AgentId:              "agent-1",
		UserInput:            input,
		ClientIdempotencyKey: key,
	}
}

func TestTurnAdmissionStartsOneAndQueuesFIFO(t *testing.T) {
	db := openTurnAdmissionDB(t, "turn_admission_fifo")
	seedAdmissionConversation(t, db)
	svc := newTurnAdmissionServiceWithDB(db)

	first, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("first", "one"),
	)
	if err != nil {
		t.Fatalf("admit first: %v", err)
	}
	if first.GetStatus() != model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_STARTED ||
		first.GetTurnId() == "" {
		t.Fatalf("first turn was not started: %+v", first)
	}

	second, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("second", "two"),
	)
	if err != nil {
		t.Fatalf("queue second: %v", err)
	}
	if second.GetStatus() != model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_QUEUED ||
		second.GetQueueEntry().GetQueuePosition() != 1 {
		t.Fatalf("second turn was not queued first: %+v", second)
	}

	third, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("third", "three"),
	)
	if err != nil {
		t.Fatalf("queue third: %v", err)
	}
	if third.GetQueueEntry().GetQueuePosition() != 2 ||
		third.GetQueueEntry().GetQueueSequence() <= second.GetQueueEntry().GetQueueSequence() {
		t.Fatalf("queue order is not monotonic: second=%+v third=%+v", second, third)
	}

	listed, err := svc.List(context.Background(), "ptid:actor-1", "conversation-1")
	if err != nil {
		t.Fatalf("list queue: %v", err)
	}
	if len(listed.GetEntries()) != 2 ||
		listed.GetEntries()[0].GetQueueEntryId() != second.GetQueueEntry().GetQueueEntryId() ||
		listed.GetEntries()[1].GetQueueEntryId() != third.GetQueueEntry().GetQueueEntryId() {
		t.Fatalf("unexpected FIFO projection: %+v", listed)
	}
}

func TestTurnAdmissionIdempotencyAndCapacity(t *testing.T) {
	db := openTurnAdmissionDB(t, "turn_admission_capacity")
	seedAdmissionConversation(t, db)
	svc := newTurnAdmissionServiceWithDB(db)
	if _, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("active", "active"),
	); err != nil {
		t.Fatalf("admit active: %v", err)
	}
	for index := uint32(0); index < turnQueueCapacity; index++ {
		key := fmt.Sprintf("queued-%d", index)
		if _, err := svc.Admit(
			context.Background(),
			"ptid:actor-1",
			admissionRequest(key, key),
		); err != nil {
			t.Fatalf("queue %d: %v", index, err)
		}
	}

	replayed, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("queued-0", "queued-0"),
	)
	if err != nil ||
		replayed.GetStatus() != model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_REPLAYED ||
		replayed.GetQueueEntry().GetQueuePosition() != 1 {
		t.Fatalf("same-payload replay failed: admission=%+v err=%v", replayed, err)
	}
	if _, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("queued-0", "different"),
	); !hasAdmissionCode(err, errcode.AgentIdempotencyConflict) {
		t.Fatalf("different-payload replay did not conflict: %v", err)
	}
	if _, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("overflow", "overflow"),
	); !hasAdmissionCode(err, errcode.AgentQueueFull) {
		t.Fatalf("queue overflow did not fail with queue-full: %v", err)
	}
}

func TestTurnAdmissionCancelAndAdmitNext(t *testing.T) {
	db := openTurnAdmissionDB(t, "turn_admission_cancel_dequeue")
	seedAdmissionConversation(t, db)
	svc := newTurnAdmissionServiceWithDB(db)
	active, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("active", "active"),
	)
	if err != nil {
		t.Fatalf("admit active: %v", err)
	}
	queued, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("queued", "queued"),
	)
	if err != nil {
		t.Fatalf("queue turn: %v", err)
	}
	var conversation persistence.Conversation
	if err := db.First(&conversation, "id = ?", "conversation-1").Error; err != nil {
		t.Fatalf("load conversation: %v", err)
	}
	cancelled, err := svc.Cancel(
		context.Background(),
		"ptid:actor-1",
		&model.CancelQueuedTurnRequest{
			ConversationId:              "conversation-1",
			QueueEntryId:                queued.GetQueueEntry().GetQueueEntryId(),
			IdempotencyKey:              "cancel-1",
			ExpectedConversationVersion: conversation.Version,
		},
	)
	if err != nil || cancelled.GetEntry().GetStatus() != model.TurnQueueStatus_TURN_QUEUE_STATUS_CANCELLED {
		t.Fatalf("cancel queued turn: response=%+v err=%v", cancelled, err)
	}
	replayedCancel, err := svc.Cancel(
		context.Background(),
		"ptid:actor-1",
		&model.CancelQueuedTurnRequest{
			ConversationId:              "conversation-1",
			QueueEntryId:                queued.GetQueueEntry().GetQueueEntryId(),
			IdempotencyKey:              "cancel-1",
			ExpectedConversationVersion: conversation.Version,
		},
	)
	if err != nil || !replayedCancel.GetReplayed() {
		t.Fatalf("cancel replay must ignore the advanced version: response=%+v err=%v", replayedCancel, err)
	}

	nextQueued, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("next", "next"),
	)
	if err != nil {
		t.Fatalf("queue next turn: %v", err)
	}
	if err := db.Model(&persistence.AgentTurn{}).
		Where("id = ?", active.GetTurnId()).
		Updates(map[string]interface{}{
			"status":   "completed",
			"ended_at": time.Now().UTC(),
		}).Error; err != nil {
		t.Fatalf("complete active turn: %v", err)
	}
	next, err := svc.AdmitNext(
		context.Background(),
		"ptid:actor-1",
		"conversation-1",
	)
	if err != nil {
		t.Fatalf("admit next: %v", err)
	}
	if next == nil ||
		next.Admission.GetTurnId() == "" ||
		next.Admission.GetQueueEntry().GetQueueEntryId() != nextQueued.GetQueueEntry().GetQueueEntryId() ||
		next.Request.GetUserInput() != "next" {
		t.Fatalf("unexpected next admission: %+v", next)
	}
}

func hasAdmissionCode(err error, code errcode.Code) bool {
	var biz *errcode.BizError
	return errors.As(err, &biz) && biz.Code == code
}
