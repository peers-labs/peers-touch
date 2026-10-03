package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGoalCreateAndGetDraftRevision(t *testing.T) {
	db := openGoalServiceTestDB(t)
	svc := NewGoalService(db)
	now := time.Date(2026, 10, 3, 15, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	svc.newID = func() string { return "goal-draft-1" }

	created, err := svc.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          "Ship durable goals",
			Outcome:        "One saved Goal can be reopened",
			IdempotencyKey: "goal-create-1",
		},
	)
	if err != nil {
		t.Fatalf("create Goal draft: %v", err)
	}
	if created.GetGoalId() != "goal-draft-1" ||
		created.GetOwnerPtid() != "ptid:actor-1" ||
		created.GetStatus() != model.AgentGoalStatus_AGENT_GOAL_STATUS_DRAFT ||
		created.GetRevision() != 1 {
		t.Fatalf("created Goal = %+v", created)
	}

	reopened, err := NewGoalService(db).Get(
		context.Background(),
		"ptid:actor-1",
		created.GetGoalId(),
	)
	if err != nil {
		t.Fatalf("get Goal draft: %v", err)
	}
	if reopened.GetGoalId() != created.GetGoalId() ||
		reopened.GetTitle() != created.GetTitle() ||
		reopened.GetOutcome() != created.GetOutcome() ||
		reopened.GetRevision() != created.GetRevision() ||
		!reopened.GetCreatedAt().AsTime().Equal(now) {
		t.Fatalf("reopened Goal differs: created=%+v reopened=%+v", created, reopened)
	}

	var taskRuns int64
	if err := db.Model(&persistence.TaskRun{}).Count(&taskRuns).Error; err != nil {
		t.Fatalf("count TaskRuns: %v", err)
	}
	if taskRuns != 0 {
		t.Fatalf("draft creation wrote %d TaskRuns, want 0", taskRuns)
	}
}

func TestGoalCreateIsIdempotentAndRejectsPayloadChange(t *testing.T) {
	db := openGoalServiceTestDB(t)
	svc := NewGoalService(db)
	nextID := 0
	svc.newID = func() string {
		nextID++
		return "goal-draft-" + string(rune('0'+nextID))
	}
	request := &model.CreateAgentGoalRequest{
		Title:          "Prepare release",
		Outcome:        "A reviewable release candidate",
		IdempotencyKey: "goal-create-replay",
	}

	first, err := svc.CreateDraft(context.Background(), "ptid:actor-1", request)
	if err != nil {
		t.Fatalf("create Goal draft: %v", err)
	}
	replayed, err := svc.CreateDraft(context.Background(), "ptid:actor-1", request)
	if err != nil {
		t.Fatalf("replay Goal draft creation: %v", err)
	}
	if replayed.GetGoalId() != first.GetGoalId() ||
		replayed.GetRevision() != first.GetRevision() {
		t.Fatalf("replayed Goal = %+v, want identity %+v", replayed, first)
	}

	_, err = svc.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          "Changed title",
			Outcome:        request.GetOutcome(),
			IdempotencyKey: request.GetIdempotencyKey(),
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentIdempotencyConflict)

	var count int64
	if err := db.Model(&persistence.AgentGoal{}).Count(&count).Error; err != nil {
		t.Fatalf("count Goals: %v", err)
	}
	if count != 1 {
		t.Fatalf("Goal count = %d, want 1", count)
	}
}

func TestGoalCreateRequiresInitialRevision(t *testing.T) {
	db := openGoalServiceTestDB(t)
	svc := NewGoalService(db)

	_, err := svc.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:            "Invalid revision",
			Outcome:          "No record is written",
			IdempotencyKey:   "goal-invalid-revision",
			ExpectedRevision: 1,
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentInvalidRequest)

	var count int64
	if err := db.Model(&persistence.AgentGoal{}).Count(&count).Error; err != nil {
		t.Fatalf("count Goals: %v", err)
	}
	if count != 0 {
		t.Fatalf("Goal count = %d, want 0", count)
	}

	_, err = svc.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          "Invalid workspace",
			Outcome:        "No record is written",
			WorkspaceId:    goalStringPointer(strings.Repeat("w", 65)),
			IdempotencyKey: "goal-invalid-workspace",
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentInvalidRequest)
}

func TestGoalCreateEnforcesUTF8ByteLimits(t *testing.T) {
	db := openGoalServiceTestDB(t)
	svc := NewGoalService(db)
	svc.newID = func() string { return "goal-unicode-boundary" }

	accepted, err := svc.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          strings.Repeat("界", 85),
			Outcome:        "A valid multibyte Goal title",
			IdempotencyKey: "goal-unicode-accepted",
		},
	)
	if err != nil {
		t.Fatalf("create multibyte Goal at byte limit: %v", err)
	}
	if accepted.GetGoalId() != "goal-unicode-boundary" {
		t.Fatalf("accepted Goal ID = %q", accepted.GetGoalId())
	}

	_, err = svc.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          strings.Repeat("界", 86),
			Outcome:        "This title exceeds the UTF-8 byte limit",
			IdempotencyKey: "goal-unicode-rejected",
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentInvalidRequest)

	var count int64
	if err := db.Model(&persistence.AgentGoal{}).Count(&count).Error; err != nil {
		t.Fatalf("count Goals: %v", err)
	}
	if count != 1 {
		t.Fatalf("Goal count = %d, want 1", count)
	}
}

func TestGoalGetRejectsAnotherActor(t *testing.T) {
	db := openGoalServiceTestDB(t)
	svc := NewGoalService(db)
	svc.newID = func() string { return "goal-private-1" }
	created, err := svc.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          "Private Goal",
			Outcome:        "Only the owner can read it",
			IdempotencyKey: "goal-private",
		},
	)
	if err != nil {
		t.Fatalf("create Goal: %v", err)
	}

	_, err = svc.Get(context.Background(), "ptid:actor-2", created.GetGoalId())
	assertGoalErrorCode(t, err, errcode.AgentOwnershipForbiddenActor)

	_, err = svc.Get(context.Background(), "ptid:actor-1", "missing-goal")
	assertGoalErrorCode(t, err, errcode.AgentNotFound)
}

func openGoalServiceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	name := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name())
	db, err := gorm.Open(
		sqlite.Open("file:"+name+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open Goal test database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.AgentGoal{},
		&persistence.TaskRun{},
	); err != nil {
		t.Fatalf("migrate Goal test database: %v", err)
	}
	return db
}

func assertGoalErrorCode(t *testing.T, err error, code errcode.Code) {
	t.Helper()
	var biz *errcode.BizError
	if !errors.As(err, &biz) || biz.Code != code {
		t.Fatalf("Goal error = %v, want code %s", err, code)
	}
}

func goalStringPointer(value string) *string {
	return &value
}
