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

func TestGoalCancelDraftReviewingAndReadyIsAuthoritativeAndIdempotent(
	t *testing.T,
) {
	tests := []struct {
		name    string
		prepare func(*testing.T, *GoalService) *model.AgentGoal
	}{
		{
			name: "draft",
			prepare: func(t *testing.T, goals *GoalService) *model.AgentGoal {
				t.Helper()
				created, err := goals.CreateDraft(
					context.Background(),
					"ptid:actor-1",
					&model.CreateAgentGoalRequest{
						Title:          "Cancellable draft",
						Outcome:        "Cancel before review",
						IdempotencyKey: "goal-create-cancel-draft",
					},
				)
				if err != nil {
					t.Fatalf("create draft Goal: %v", err)
				}
				return created
			},
		},
		{
			name: "reviewing",
			prepare: func(t *testing.T, goals *GoalService) *model.AgentGoal {
				t.Helper()
				return createReviewedGoal(t, goals, "ptid:actor-1")
			},
		},
		{
			name: "ready",
			prepare: func(t *testing.T, goals *GoalService) *model.AgentGoal {
				t.Helper()
				reviewed := createReviewedGoal(t, goals, "ptid:actor-1")
				ready, err := NewGoalAdmissionService(goals).Admit(
					context.Background(),
					"ptid:actor-1",
					&model.AdmitAgentGoalRequest{
						GoalId:           reviewed.GetGoalId(),
						ExpectedRevision: reviewed.GetRevision(),
						IdempotencyKey:   "goal-admit-before-cancel",
					},
				)
				if err != nil {
					t.Fatalf("admit Goal before cancel: %v", err)
				}
				return ready
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := openGoalServiceTestDB(t)
			goals := NewGoalService(db)
			goals.newID = func() string { return "goal-cancel-" + test.name }
			before := test.prepare(t, goals)
			request := &model.CancelAgentGoalRequest{
				GoalId:           before.GetGoalId(),
				ExpectedRevision: before.GetRevision(),
				IdempotencyKey:   "goal-cancel-" + test.name,
			}

			cancelled, err := goals.Cancel(
				context.Background(),
				"ptid:actor-1",
				request,
			)
			if err != nil {
				t.Fatalf("cancel %s Goal: %v", test.name, err)
			}
			if cancelled.GetStatus() !=
				model.AgentGoalStatus_AGENT_GOAL_STATUS_CANCELLED ||
				cancelled.GetRevision() != before.GetRevision()+1 {
				t.Fatalf("cancelled Goal = %+v", cancelled)
			}

			replayed, err := goals.Cancel(
				context.Background(),
				"ptid:actor-1",
				request,
			)
			if err != nil {
				t.Fatalf("replay %s Goal cancellation: %v", test.name, err)
			}
			if replayed.GetStatus() != cancelled.GetStatus() ||
				replayed.GetRevision() != cancelled.GetRevision() {
				t.Fatalf("replayed cancellation = %+v, want %+v", replayed, cancelled)
			}

			reopened, err := goals.Get(
				context.Background(),
				"ptid:actor-1",
				before.GetGoalId(),
			)
			if err != nil {
				t.Fatalf("read cancelled Goal: %v", err)
			}
			if reopened.GetStatus() != cancelled.GetStatus() ||
				reopened.GetRevision() != cancelled.GetRevision() {
				t.Fatalf("readback Goal = %+v, want %+v", reopened, cancelled)
			}

			var taskRuns int64
			if err := db.Model(&persistence.TaskRun{}).
				Count(&taskRuns).Error; err != nil {
				t.Fatalf("count TaskRuns: %v", err)
			}
			if taskRuns != 0 {
				t.Fatalf("Goal cancellation wrote %d TaskRuns, want 0", taskRuns)
			}
		})
	}
}

func TestGoalCancelRejectsRunningGoalWithoutMutation(t *testing.T) {
	db := openGoalServiceTestDB(t)
	goals := NewGoalService(db)
	goals.newID = func() string { return "goal-cancel-running" }
	reviewed := createReviewedGoal(t, goals, "ptid:actor-1")
	admission := NewGoalAdmissionService(goals)
	ready, err := admission.Admit(
		context.Background(),
		"ptid:actor-1",
		&model.AdmitAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-admit-cancel-running",
		},
	)
	if err != nil {
		t.Fatalf("admit Goal: %v", err)
	}
	running, err := admission.Start(
		context.Background(),
		"ptid:actor-1",
		&model.StartAgentGoalRequest{
			GoalId:           ready.GetGoalId(),
			ExpectedRevision: ready.GetRevision(),
			IdempotencyKey:   "goal-start-cancel-running",
		},
	)
	if err != nil {
		t.Fatalf("start Goal: %v", err)
	}

	_, err = goals.Cancel(
		context.Background(),
		"ptid:actor-1",
		&model.CancelAgentGoalRequest{
			GoalId:           running.GetGoalId(),
			ExpectedRevision: running.GetRevision(),
			IdempotencyKey:   "goal-cancel-running",
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentInvalidSourceState)

	reopened, err := goals.Get(
		context.Background(),
		"ptid:actor-1",
		running.GetGoalId(),
	)
	if err != nil {
		t.Fatalf("read running Goal: %v", err)
	}
	if reopened.GetStatus() != model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING ||
		reopened.GetRevision() != running.GetRevision() {
		t.Fatalf("rejected cancellation mutated Goal: %+v", reopened)
	}
}

func TestGoalCancelRejectsAnotherActorAndStaleRevisionWithoutMutation(
	t *testing.T,
) {
	db := openGoalServiceTestDB(t)
	goals := NewGoalService(db)
	goals.newID = func() string { return "goal-cancel-guarded" }
	reviewed := createReviewedGoal(t, goals, "ptid:actor-1")

	_, err := goals.Cancel(
		context.Background(),
		"ptid:actor-2",
		&model.CancelAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-cancel-other-actor",
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentOwnershipForbiddenActor)

	_, err = goals.Cancel(
		context.Background(),
		"ptid:actor-1",
		&model.CancelAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision() - 1,
			IdempotencyKey:   "goal-cancel-stale",
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentLifecycleStaleVersion)

	reopened, err := goals.Get(
		context.Background(),
		"ptid:actor-1",
		reviewed.GetGoalId(),
	)
	if err != nil {
		t.Fatalf("read guarded Goal: %v", err)
	}
	if reopened.GetStatus() !=
		model.AgentGoalStatus_AGENT_GOAL_STATUS_REVIEWING ||
		reopened.GetRevision() != reviewed.GetRevision() {
		t.Fatalf("rejected cancellation mutated Goal: %+v", reopened)
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

func TestGoalDomainCommitIncludesOrderedRealtimeOutbox(t *testing.T) {
	db := openGoalServiceTestDB(t)
	goals := NewGoalService(db)
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	goals.now = func() time.Time { return now }
	goals.newID = func() string { return "goal-domain-commit" }

	created, err := goals.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          "Durable progress",
			Outcome:        "Every revision has a committed event",
			WorkspaceId:    goalStringPointer("workspace-1"),
			IdempotencyKey: "goal-domain-create",
		},
	)
	if err != nil {
		t.Fatalf("create Goal: %v", err)
	}

	var event persistence.AgentGoalEvent
	if err := db.First(&event, "goal_id = ?", created.GetGoalId()).Error; err != nil {
		t.Fatalf("load Goal event: %v", err)
	}
	var outbox persistence.AgentRealtimeOutbox
	if err := db.First(
		&outbox,
		"domain_event_id = ?",
		event.DomainEventID,
	).Error; err != nil {
		t.Fatalf("load realtime outbox: %v", err)
	}
	if event.EventSeq != 1 || event.GoalRevision != created.GetRevision() ||
		event.EventType != goalCreatedEvent ||
		outbox.ActorSequence != 1 ||
		outbox.TargetActorPTID != created.GetOwnerPtid() ||
		outbox.State != persistence.AgentRealtimeOutboxPending {
		t.Fatalf("committed event/outbox mismatch: event=%+v outbox=%+v", event, outbox)
	}

	if outbox.DomainEventID != event.DomainEventID ||
		outbox.DomainSequence != event.EventSeq ||
		outbox.GoalID != created.GetGoalId() ||
		outbox.GoalRevision != created.GetRevision() {
		t.Fatalf("realtime outbox = %+v, event=%+v", outbox, event)
	}
}

func TestGoalDomainCommitRollsBackWhenRealtimeOutboxFails(t *testing.T) {
	db := openGoalServiceTestDB(t)
	goals := NewGoalService(db)
	goals.newID = func() string { return "goal-domain-rollback" }
	created, err := goals.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          "Atomic Goal",
			Outcome:        "No partial revision",
			IdempotencyKey: "goal-domain-rollback-create",
		},
	)
	if err != nil {
		t.Fatalf("create Goal: %v", err)
	}
	if err := db.Migrator().DropTable(&persistence.AgentRealtimeOutbox{}); err != nil {
		t.Fatalf("drop realtime outbox: %v", err)
	}

	_, err = goals.UpdateContract(
		context.Background(),
		"ptid:actor-1",
		&model.UpdateAgentGoalRequest{
			GoalId:           created.GetGoalId(),
			Outcome:          "This mutation must roll back",
			Budget:           &model.AgentGoalBudget{MaxTokens: 1},
			ExpectedRevision: created.GetRevision(),
			IdempotencyKey:   "goal-domain-rollback-update",
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentInternal)

	reopened, err := goals.Get(
		context.Background(),
		"ptid:actor-1",
		created.GetGoalId(),
	)
	if err != nil {
		t.Fatalf("read Goal after rollback: %v", err)
	}
	if reopened.GetRevision() != created.GetRevision() ||
		reopened.GetOutcome() != created.GetOutcome() {
		t.Fatalf("failed outbox write leaked Goal mutation: %+v", reopened)
	}
	var eventCount int64
	if err := db.Model(&persistence.AgentGoalEvent{}).
		Where("goal_id = ?", created.GetGoalId()).
		Count(&eventCount).Error; err != nil {
		t.Fatalf("count Goal events: %v", err)
	}
	if eventCount != 1 {
		t.Fatalf("failed mutation left %d Goal events, want 1", eventCount)
	}
}

func TestGoalRealtimeBacklogReservesTerminalCapacity(t *testing.T) {
	db := openGoalServiceTestDB(t)
	goals := NewGoalService(db)
	goals.realtimeLimits = persistence.AgentRealtimeBacklogLimits{
		PendingLimit:    3,
		TerminalReserve: 1,
	}
	nextID := 0
	goals.newID = func() string {
		nextID++
		return "goal-backlog-" + string(rune('0'+nextID))
	}
	create := func(key string) (*model.AgentGoal, error) {
		return goals.CreateDraft(
			context.Background(),
			"ptid:actor-1",
			&model.CreateAgentGoalRequest{
				Title:          "Backlog " + key,
				Outcome:        "Bound pending realtime work",
				WorkspaceId:    goalStringPointer("workspace-1"),
				IdempotencyKey: key,
			},
		)
	}

	first, err := create("goal-backlog-create-1")
	if err != nil {
		t.Fatalf("create first Goal: %v", err)
	}
	second, err := create("goal-backlog-create-2")
	if err != nil {
		t.Fatalf("create second Goal: %v", err)
	}
	_, err = create("goal-backlog-create-3")
	assertGoalErrorCode(t, err, errcode.AgentQueueFull)

	cancelled, err := goals.Cancel(
		context.Background(),
		"ptid:actor-1",
		&model.CancelAgentGoalRequest{
			GoalId:           first.GetGoalId(),
			ExpectedRevision: first.GetRevision(),
			IdempotencyKey:   "goal-backlog-cancel-1",
		},
	)
	if err != nil {
		t.Fatalf("terminal cancellation did not use reserved capacity: %v", err)
	}
	if cancelled.GetStatus() != model.AgentGoalStatus_AGENT_GOAL_STATUS_CANCELLED {
		t.Fatalf("cancelled Goal = %+v", cancelled)
	}

	_, err = goals.Cancel(
		context.Background(),
		"ptid:actor-1",
		&model.CancelAgentGoalRequest{
			GoalId:           second.GetGoalId(),
			ExpectedRevision: second.GetRevision(),
			IdempotencyKey:   "goal-backlog-cancel-2",
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentQueueFull)
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
		&persistence.AgentGoalEvent{},
		&persistence.AgentRealtimeActorCursor{},
		&persistence.AgentRealtimeOutbox{},
		&persistence.RevisionCommand{},
		&persistence.TaskRun{},
		&persistence.AgentGoalNode{},
		&persistence.ExecutionStep{},
		&persistence.DirectRun{},
		&persistence.AgentTask{},
		&persistence.CollaborationTask{},
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
