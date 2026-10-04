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

func TestGoalUpdateAndReviewUseRevisionAndIdempotency(t *testing.T) {
	db := openGoalServiceTestDB(t)
	svc := NewGoalService(db)
	svc.newID = func() string { return "goal-contract-1" }
	created, err := svc.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          "Ship the contract",
			Outcome:        "Initial outcome",
			IdempotencyKey: "goal-create-contract",
		},
	)
	if err != nil {
		t.Fatalf("create Goal: %v", err)
	}
	maxCost := 12.5
	update := &model.UpdateAgentGoalRequest{
		GoalId:      created.GetGoalId(),
		Outcome:     "A reviewed, durable Goal contract",
		NonGoals:    []string{"Do not start execution"},
		Constraints: []string{"Preserve Station ownership"},
		Budget: &model.AgentGoalBudget{
			MaxTokens:        120_000,
			MaxCost:          &maxCost,
			WallTimeMs:       3_600_000,
			MaxParallelTasks: 2,
		},
		AcceptanceCriteria: []*model.AgentGoalAcceptanceCriterion{{
			CriterionId: "criterion-1",
			Description: "Station readback matches the reviewed contract",
			Evaluator:   "deterministic",
			Required:    true,
		}},
		ExpectedRevision: created.GetRevision(),
		IdempotencyKey:   "goal-update-1",
	}

	updated, err := svc.UpdateContract(context.Background(), "ptid:actor-1", update)
	if err != nil {
		t.Fatalf("update Goal contract: %v", err)
	}
	if updated.GetRevision() != 2 ||
		updated.GetOutcome() != update.GetOutcome() ||
		len(updated.GetNonGoals()) != 1 ||
		len(updated.GetConstraints()) != 1 ||
		updated.GetBudget().GetMaxTokens() != 120_000 ||
		len(updated.GetAcceptanceCriteria()) != 1 {
		t.Fatalf("updated Goal = %+v", updated)
	}

	replayed, err := svc.UpdateContract(context.Background(), "ptid:actor-1", update)
	if err != nil {
		t.Fatalf("replay Goal update: %v", err)
	}
	if replayed.GetRevision() != updated.GetRevision() ||
		replayed.GetOutcome() != updated.GetOutcome() {
		t.Fatalf("replayed Goal = %+v, want %+v", replayed, updated)
	}

	changed := *update
	changed.Outcome = "A conflicting payload"
	_, err = svc.UpdateContract(context.Background(), "ptid:actor-1", &changed)
	assertGoalErrorCode(t, err, errcode.AgentIdempotencyConflict)

	review := &model.ReviewAgentGoalRequest{
		GoalId:           updated.GetGoalId(),
		ExpectedRevision: updated.GetRevision(),
		IdempotencyKey:   "goal-review-1",
	}
	reviewed, err := svc.Review(context.Background(), "ptid:actor-1", review)
	if err != nil {
		t.Fatalf("review Goal: %v", err)
	}
	if reviewed.GetStatus() !=
		model.AgentGoalStatus_AGENT_GOAL_STATUS_REVIEWING ||
		reviewed.GetRevision() != 3 {
		t.Fatalf("reviewed Goal = %+v", reviewed)
	}
	replayedReview, err := svc.Review(
		context.Background(),
		"ptid:actor-1",
		review,
	)
	if err != nil {
		t.Fatalf("replay Goal review: %v", err)
	}
	if replayedReview.GetRevision() != reviewed.GetRevision() ||
		replayedReview.GetStatus() != reviewed.GetStatus() {
		t.Fatalf(
			"replayed reviewed Goal = %+v, want %+v",
			replayedReview,
			reviewed,
		)
	}
	historicReplay, err := svc.UpdateContract(
		context.Background(),
		"ptid:actor-1",
		update,
	)
	if err != nil {
		t.Fatalf("replay historic Goal update: %v", err)
	}
	if historicReplay.GetRevision() != 2 ||
		historicReplay.GetStatus() !=
			model.AgentGoalStatus_AGENT_GOAL_STATUS_DRAFT {
		t.Fatalf("historic Goal replay changed with current state: %+v", historicReplay)
	}

	var commands []persistence.RevisionCommand
	if err := db.Where("ptid = ?", "ptid:actor-1").
		Find(&commands).Error; err != nil {
		t.Fatalf("load Goal commands: %v", err)
	}
	if len(commands) != 2 {
		t.Fatalf("Goal command count = %d, want 2", len(commands))
	}
	for _, command := range commands {
		if len(command.ID) > 36 {
			t.Fatalf("Goal command ID %q exceeds persistence width", command.ID)
		}
	}
	var taskRuns int64
	if err := db.Model(&persistence.TaskRun{}).Count(&taskRuns).Error; err != nil {
		t.Fatalf("count TaskRuns: %v", err)
	}
	if taskRuns != 0 {
		t.Fatalf("contract review wrote %d TaskRuns, want 0", taskRuns)
	}
}

func TestGoalUpdateRejectsStaleRevisionWithLatestRevision(t *testing.T) {
	db := openGoalServiceTestDB(t)
	svc := NewGoalService(db)
	svc.newID = func() string { return "goal-stale-1" }
	created, err := svc.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          "Stale Goal",
			Outcome:        "Initial outcome",
			IdempotencyKey: "goal-create-stale",
		},
	)
	if err != nil {
		t.Fatalf("create Goal: %v", err)
	}
	first := &model.UpdateAgentGoalRequest{
		GoalId:           created.GetGoalId(),
		Outcome:          "Authoritative outcome",
		Budget:           &model.AgentGoalBudget{},
		ExpectedRevision: 1,
		IdempotencyKey:   "goal-update-authoritative",
	}
	if _, err := svc.UpdateContract(
		context.Background(),
		"ptid:actor-1",
		first,
	); err != nil {
		t.Fatalf("update Goal: %v", err)
	}

	_, err = svc.UpdateContract(
		context.Background(),
		"ptid:actor-1",
		&model.UpdateAgentGoalRequest{
			GoalId:           created.GetGoalId(),
			Outcome:          "Stale local outcome",
			Budget:           &model.AgentGoalBudget{},
			ExpectedRevision: 1,
			IdempotencyKey:   "goal-update-stale",
		},
	)
	var biz *errcode.BizError
	if !errors.As(err, &biz) ||
		biz.Code != errcode.AgentLifecycleStaleVersion ||
		biz.Payload.GetDetails()["expected_revision"] != "1" ||
		biz.Payload.GetDetails()["actual_revision"] != "2" {
		t.Fatalf("stale Goal error = %+v", err)
	}

	reopened, err := svc.Get(
		context.Background(),
		"ptid:actor-1",
		created.GetGoalId(),
	)
	if err != nil {
		t.Fatalf("read Goal after stale update: %v", err)
	}
	if reopened.GetOutcome() != "Authoritative outcome" ||
		reopened.GetRevision() != 2 {
		t.Fatalf("Goal mutated by stale request: %+v", reopened)
	}
}

func TestGoalMutationRejectsAnotherActorWithoutRetry(t *testing.T) {
	db := openGoalServiceTestDB(t)
	svc := NewGoalService(db)
	svc.newID = func() string { return "goal-private-mutation" }
	created, err := svc.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          "Private Goal",
			Outcome:        "Only the owner can mutate it",
			IdempotencyKey: "goal-create-private-mutation",
		},
	)
	if err != nil {
		t.Fatalf("create Goal: %v", err)
	}

	_, err = svc.UpdateContract(
		context.Background(),
		"ptid:actor-2",
		&model.UpdateAgentGoalRequest{
			GoalId:           created.GetGoalId(),
			Outcome:          "Unauthorized replacement",
			Budget:           &model.AgentGoalBudget{},
			ExpectedRevision: created.GetRevision(),
			IdempotencyKey:   "goal-update-other-actor",
		},
	)
	var biz *errcode.BizError
	if !errors.As(err, &biz) ||
		biz.Code != errcode.AgentOwnershipForbiddenActor ||
		biz.Payload.GetRetryable() {
		t.Fatalf("unauthorized Goal error = %+v", err)
	}

	reopened, err := svc.Get(
		context.Background(),
		"ptid:actor-1",
		created.GetGoalId(),
	)
	if err != nil {
		t.Fatalf("read private Goal: %v", err)
	}
	if reopened.GetOutcome() != created.GetOutcome() ||
		reopened.GetRevision() != created.GetRevision() {
		t.Fatalf("unauthorized request mutated Goal: %+v", reopened)
	}
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
		&persistence.RevisionCommand{},
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
