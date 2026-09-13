package service

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
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
		&persistence.AgentMessage{},
		&persistence.AgentTurn{},
		&persistence.TurnAttempt{},
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
		ActorPTID:  "ptid:actor-1",
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

func TestTurnAdmissionRejectsAttachmentBeforePersistence(t *testing.T) {
	db := openTurnAdmissionDB(t, "turn_admission_attachment_preflight")
	seedAdmissionConversation(t, db)
	svc := newTurnAdmissionServiceWithDB(db)
	svc.SetRequestPreflight(func(context.Context, string, *model.ExecuteTurnRequest) error {
		return attachmentRejected("attachment-1", "attachment checksum mismatch")
	})
	request := admissionRequest("attachment-rejected", "inspect")
	request.Attachments = []*model.AgentAttachmentRef{{
		AttachmentId: "attachment-1",
		ObjectRef:    "oss:cas/01/object",
	}}

	_, err := svc.Admit(context.Background(), "ptid:actor-1", request)
	if err == nil {
		t.Fatal("expected attachment preflight rejection")
	}
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentAttachmentRejected ||
		bizErr.Payload == nil ||
		bizErr.Payload.GetDetails()["attachment_id"] != "attachment-1" ||
		bizErr.Payload.GetDetails()["reason_code"] != "attachment_checksum_mismatch" {
		t.Fatalf("attachment preflight rejection lost typed details: %T %v", err, err)
	}
	var turnCount int64
	if err := db.Model(&persistence.AgentTurn{}).Count(&turnCount).Error; err != nil {
		t.Fatalf("count turns: %v", err)
	}
	var attemptCount int64
	if err := db.Model(&persistence.TurnAttempt{}).Count(&attemptCount).Error; err != nil {
		t.Fatalf("count attempts: %v", err)
	}
	var queueEntryCount int64
	if err := db.Model(&persistence.TurnQueueEntry{}).Count(&queueEntryCount).Error; err != nil {
		t.Fatalf("count queue entries: %v", err)
	}
	var messageCount int64
	if err := db.Model(&persistence.AgentMessage{}).Count(&messageCount).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	var conversation persistence.Conversation
	if err := db.First(&conversation, "id = ?", "conversation-1").Error; err != nil {
		t.Fatalf("read conversation: %v", err)
	}
	if turnCount != 0 ||
		attemptCount != 0 ||
		queueEntryCount != 0 ||
		messageCount != 0 ||
		conversation.Version != 1 {
		t.Fatalf(
			"rejected attachment produced persistence side effects: turns=%d attempts=%d queue=%d messages=%d conversation_version=%d",
			turnCount,
			attemptCount,
			queueEntryCount,
			messageCount,
			conversation.Version,
		)
	}
}

func TestTurnAdmissionRejectsRetiredContextReferenceBeforePersistence(t *testing.T) {
	db := openTurnAdmissionDB(t, "turn_admission_invalid_reference_preflight")
	seedAdmissionConversation(t, db)
	svc := newTurnAdmissionServiceWithDB(db)
	turnService := &TurnService{}
	svc.SetRequestPreflight(turnService.PreflightTurn)
	const token = "@file:private/notes.txt"

	_, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("invalid-reference", "Inspect "+token),
	)
	assertContextInvalidReferenceError(t, err, "file", token)

	for name, record := range map[string]interface{}{
		"turn":        &persistence.AgentTurn{},
		"attempt":     &persistence.TurnAttempt{},
		"queue entry": &persistence.TurnQueueEntry{},
		"message":     &persistence.AgentMessage{},
	} {
		var count int64
		if err := db.Model(record).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows: %v", name, err)
		}
		if count != 0 {
			t.Fatalf("invalid reference persisted %d %s rows", count, name)
		}
	}
	var conversation persistence.Conversation
	if err := db.First(&conversation, "id = ?", "conversation-1").Error; err != nil {
		t.Fatalf("read conversation: %v", err)
	}
	if conversation.Version != 1 {
		t.Fatalf(
			"invalid reference changed conversation version to %d",
			conversation.Version,
		)
	}
}

func TestTurnAdmissionRejectsInputOverflowBeforePersistence(t *testing.T) {
	db := openTurnAdmissionDB(t, "turn_admission_input_overflow")
	seedAdmissionConversation(t, db)
	svc := newTurnAdmissionServiceWithDB(db)
	svc.SetRequestPreflight(func(
		context.Context,
		string,
		*model.ExecuteTurnRequest,
	) error {
		return errcode.NewContextOverflow(1, 2)
	})

	_, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("input-overflow", "oversized"),
	)
	if err == nil {
		t.Fatal("expected input overflow rejection")
	}
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentContextOverflow ||
		bizErr.Payload == nil ||
		bizErr.Payload.GetLocaleKey() != errcode.AgentContextOverflowLocaleKey ||
		bizErr.Payload.GetRetryable() ||
		!bizErr.Payload.GetTerminal() ||
		len(bizErr.Payload.GetDetails()) != 2 ||
		bizErr.Payload.GetDetails()["limit_tokens"] != "1" ||
		bizErr.Payload.GetDetails()["actual_tokens"] != "2" {
		t.Fatalf("input overflow rejection lost typed details: %T %v", err, err)
	}
	for name, record := range map[string]interface{}{
		"turn":        &persistence.AgentTurn{},
		"attempt":     &persistence.TurnAttempt{},
		"queue entry": &persistence.TurnQueueEntry{},
		"message":     &persistence.AgentMessage{},
	} {
		var count int64
		if err := db.Model(record).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows: %v", name, err)
		}
		if count != 0 {
			t.Fatalf("input overflow persisted %d %s rows", count, name)
		}
	}
	var conversation persistence.Conversation
	if err := db.First(&conversation, "id = ?", "conversation-1").Error; err != nil {
		t.Fatalf("read conversation: %v", err)
	}
	if conversation.Version != 1 {
		t.Fatalf(
			"input overflow changed conversation version to %d",
			conversation.Version,
		)
	}
}

func TestTurnAdmissionReplaysBeforeAttachmentRevalidation(t *testing.T) {
	db := openTurnAdmissionDB(t, "turn_admission_attachment_replay")
	seedAdmissionConversation(t, db)
	svc := newTurnAdmissionServiceWithDB(db)
	preflightCalls := 0
	svc.SetRequestPreflight(func(context.Context, string, *model.ExecuteTurnRequest) error {
		preflightCalls++
		if preflightCalls > 1 {
			return attachmentRejected("attachment-1", "attachment expired after admission")
		}
		return nil
	})
	request := admissionRequest("attachment-replay", "inspect")
	request.Attachments = []*model.AgentAttachmentRef{{
		AttachmentId: "attachment-1",
		ObjectRef:    "oss:cas/01/object",
	}}

	first, err := svc.Admit(context.Background(), "ptid:actor-1", request)
	if err != nil {
		t.Fatalf("initial attachment admission: %v", err)
	}
	replayed, err := svc.Admit(context.Background(), "ptid:actor-1", request)
	if err != nil {
		t.Fatalf("replay must not depend on mutable attachment state: %v", err)
	}
	if replayed.GetStatus() != model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_REPLAYED ||
		replayed.GetTurnId() != first.GetTurnId() ||
		preflightCalls != 1 {
		t.Fatalf("unexpected attachment replay: first=%+v replay=%+v preflights=%d", first, replayed, preflightCalls)
	}
}

func TestTurnAdmissionIdempotencyAndCapacity(t *testing.T) {
	db := openTurnAdmissionDB(t, "turn_admission_capacity")
	seedAdmissionConversation(t, db)
	svc := newTurnAdmissionServiceWithDB(db)
	first, err := svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("active", "active"),
	)
	if err != nil {
		t.Fatalf("admit active: %v", err)
	}
	_, err = svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("active", "different"),
	)
	requireAdmissionDuplicateConflict(t, err, "active", first.GetTurnId())

	var firstQueued *model.TurnAdmission
	for index := uint32(0); index < turnQueueCapacity; index++ {
		key := fmt.Sprintf("queued-%d", index)
		admission, err := svc.Admit(
			context.Background(),
			"ptid:actor-1",
			admissionRequest(key, key),
		)
		if err != nil {
			t.Fatalf("queue %d: %v", index, err)
		}
		if index == 0 {
			firstQueued = admission
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
	if firstQueued == nil || firstQueued.GetQueueEntry() == nil {
		t.Fatal("first queued admission is missing")
	}
	_, err = svc.Admit(
		context.Background(),
		"ptid:actor-1",
		admissionRequest("queued-0", "different"),
	)
	requireAdmissionDuplicateConflict(
		t,
		err,
		"queued-0",
		firstQueued.GetQueueEntry().GetQueueEntryId(),
	)
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

func TestTurnAdmissionCancelsQueuedEntryWhenAttachmentExpiresBeforeDequeue(t *testing.T) {
	db := openTurnAdmissionDB(t, "turn_admission_attachment_expiry")
	seedAdmissionConversation(t, db)
	svc := newTurnAdmissionServiceWithDB(db)
	reject := false
	svc.SetRequestPreflight(func(context.Context, string, *model.ExecuteTurnRequest) error {
		if reject {
			return attachmentRejected("attachment-1", "attachment expired before dequeue")
		}
		return nil
	})

	active, err := svc.Admit(context.Background(), "ptid:actor-1", admissionRequest("active", "active"))
	if err != nil {
		t.Fatalf("admit active: %v", err)
	}
	queuedRequest := admissionRequest("queued-attachment", "inspect")
	queuedRequest.Attachments = []*model.AgentAttachmentRef{{
		AttachmentId: "attachment-1",
		ObjectRef:    "oss:cas/01/object",
	}}
	queued, err := svc.Admit(context.Background(), "ptid:actor-1", queuedRequest)
	if err != nil {
		t.Fatalf("queue attachment turn: %v", err)
	}
	if err := db.Model(&persistence.AgentTurn{}).
		Where("id = ?", active.GetTurnId()).
		Updates(map[string]interface{}{
			"status":   string(domain.TurnStatusCompleted),
			"ended_at": time.Now().UTC(),
		}).Error; err != nil {
		t.Fatalf("complete active turn: %v", err)
	}

	reject = true
	if _, err := svc.AdmitNext(context.Background(), "ptid:actor-1", "conversation-1"); err == nil {
		t.Fatal("expected expired queued attachment to be rejected")
	}
	var entry persistence.TurnQueueEntry
	if err := db.First(&entry, "id = ?", queued.GetQueueEntry().GetQueueEntryId()).Error; err != nil {
		t.Fatalf("load rejected queue entry: %v", err)
	}
	if entry.Status != queueStatusCancelled {
		t.Fatalf("queue status = %q, want %q", entry.Status, queueStatusCancelled)
	}
	var turnCount int64
	if err := db.Model(&persistence.AgentTurn{}).Count(&turnCount).Error; err != nil {
		t.Fatalf("count turns: %v", err)
	}
	if turnCount != 1 {
		t.Fatalf("invalid queued attachment created a turn: count=%d", turnCount)
	}
	var conversation persistence.Conversation
	if err := db.First(&conversation, "id = ?", "conversation-1").Error; err != nil {
		t.Fatalf("load conversation: %v", err)
	}
	if conversation.QueuedTurnCount != 0 {
		t.Fatalf("queued turn count = %d, want 0", conversation.QueuedTurnCount)
	}
}

func hasAdmissionCode(err error, code errcode.Code) bool {
	var biz *errcode.BizError
	return errors.As(err, &biz) && biz.Code == code
}

func requireAdmissionDuplicateConflict(
	t *testing.T,
	err error,
	idempotencyKey string,
	existingCommandID string,
) {
	t.Helper()
	var biz *errcode.BizError
	if !errors.As(err, &biz) {
		t.Fatalf("expected duplicate conflict, got %v", err)
	}
	idempotencyKeyHash := fmt.Sprintf(
		"%x",
		sha256.Sum256([]byte(idempotencyKey)),
	)
	if biz.Code != errcode.AgentIdempotencyConflict ||
		biz.Payload == nil ||
		biz.Payload.GetError() != errcode.AgentAdmissionDuplicateConflictLocaleKey ||
		biz.Payload.GetErrorType() != string(errcode.AgentAdmissionDuplicateConflict) ||
		biz.Payload.GetLocaleKey() != errcode.AgentAdmissionDuplicateConflictLocaleKey ||
		biz.Payload.GetRetryable() ||
		!biz.Payload.GetTerminal() ||
		len(biz.Payload.GetDetails()) != 2 ||
		biz.Payload.GetDetails()["idempotency_key_hash"] != idempotencyKeyHash ||
		biz.Payload.GetDetails()["existing_command_id"] != existingCommandID {
		t.Fatalf("unexpected duplicate conflict: %+v", biz)
	}
}
