package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func newScheduledJobDB(t *testing.T, name string) (*gorm.DB, *ScheduledJobService) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open scheduled job db: %v", err)
	}
	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatalf("migrate scheduled job db: %v", err)
	}
	if err := db.Create(&persistence.Agent{
		ID:             "agent-1",
		Name:           "Assistant",
		OwnerActorPTID: "ptid:person:test",
		Version:        1,
	}).Error; err != nil {
		t.Fatalf("seed agent: %v", err)
	}
	admission := newTurnAdmissionServiceWithDB(db)
	return db, NewScheduledJobServiceWithDB(admission, db)
}

func ptrStringScheduled(value string) *string {
	return &value
}

func TestScheduledJobCreateProjectsDueAndConversation(t *testing.T) {
	_, svc := newScheduledJobDB(t, "sched_create")
	ctx := context.Background()

	job, conversationID, err := svc.CreateScheduledJob(ctx, "ptid:person:test", &model.CreateScheduledJobRequest{
		AgentId:        "agent-1",
		Name:           "Daily brief",
		Description:    "summary",
		ScheduleKind:   model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_INTERVAL,
		IntervalSec:    900,
		Timezone:       "UTC",
		Prompt:         "summarize my tasks",
		Enabled:        true,
		IdempotencyKey: "sched-create-1",
	})
	if err != nil {
		t.Fatalf("create scheduled job: %v", err)
	}
	if job.GetJobId() == "" || job.GetConversationId() == "" || conversationID != job.GetConversationId() {
		t.Fatalf("job/conversation binding incomplete: %+v", job)
	}
	if job.GetNextDueAt() == nil {
		t.Fatal("interval job must project next_due_at")
	}
	gap := job.GetNextDueAt().AsTime().Sub(time.Now().UTC())
	if gap < 14*time.Minute || gap > 16*time.Minute {
		t.Fatalf("interval due gap = %v, want ~15m", gap)
	}
	if job.GetScheduleKind() != model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_INTERVAL {
		t.Fatalf("unexpected schedule kind: %v", job.GetScheduleKind())
	}

	replay, _, err := svc.CreateScheduledJob(ctx, "ptid:person:test", &model.CreateScheduledJobRequest{
		AgentId:        "agent-1",
		Name:           "Daily brief",
		ScheduleKind:   model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_INTERVAL,
		IntervalSec:    900,
		Prompt:         "summarize my tasks",
		Enabled:        true,
		IdempotencyKey: "sched-create-1",
	})
	if err != nil || replay.GetJobId() != job.GetJobId() {
		t.Fatalf("idempotent create replay failed: replay=%+v err=%v", replay, err)
	}
}

func TestScheduledJobCreateValidation(t *testing.T) {
	_, svc := newScheduledJobDB(t, "sched_validate")
	ctx := context.Background()
	base := func() *model.CreateScheduledJobRequest {
		return &model.CreateScheduledJobRequest{
			AgentId:      "agent-1",
			Name:         "Job",
			ScheduleKind: model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_INTERVAL,
			IntervalSec:  900,
			Prompt:       "do work",
			Enabled:      true,
		}
	}

	noPrompt := base()
	noPrompt.Prompt = " "
	if _, _, err := svc.CreateScheduledJob(ctx, "ptid:person:test", noPrompt); err == nil {
		t.Fatal("expected empty prompt rejection")
	}

	shortInterval := base()
	shortInterval.IntervalSec = 30
	if _, _, err := svc.CreateScheduledJob(ctx, "ptid:person:test", shortInterval); err == nil {
		t.Fatal("expected sub-minute interval rejection")
	}

	pastOnce := base()
	pastOnce.ScheduleKind = model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_ONCE
	pastOnce.RunAt = time.Now().Add(-time.Hour).Format(time.RFC3339)
	if _, _, err := svc.CreateScheduledJob(ctx, "ptid:person:test", pastOnce); err == nil {
		t.Fatal("expected past once schedule rejection")
	}

	foreignAgent := base()
	foreignAgent.AgentId = "agent-other"
	if _, _, err := svc.CreateScheduledJob(ctx, "ptid:person:test", foreignAgent); err == nil {
		t.Fatal("expected foreign agent rejection")
	}
}

func TestScheduledJobToggleAndRevision(t *testing.T) {
	_, svc := newScheduledJobDB(t, "sched_toggle")
	ctx := context.Background()
	created, _, err := svc.CreateScheduledJob(ctx, "ptid:person:test", &model.CreateScheduledJobRequest{
		AgentId:      "agent-1",
		Name:         "Pause test",
		ScheduleKind: model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_CRON,
		CronExpr:     "0 9 * * *",
		Timezone:     "UTC",
		Prompt:       "morning",
		Enabled:      true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	paused, err := svc.ToggleScheduledJob(ctx, "ptid:person:test", created.JobId, false)
	if err != nil {
		t.Fatalf("pause: %v", err)
	}
	if paused.Enabled || paused.NextDueAt != nil || paused.Revision != 2 {
		t.Fatalf("paused job must clear due and bump revision: %+v", paused)
	}
	resumed, err := svc.ToggleScheduledJob(ctx, "ptid:person:test", created.JobId, true)
	if err != nil {
		t.Fatalf("resume: %v", err)
	}
	if !resumed.Enabled || resumed.NextDueAt == nil {
		t.Fatalf("resumed job must project due: %+v", resumed)
	}

	_, err = svc.UpdateScheduledJob(ctx, "ptid:person:test", &model.UpdateScheduledJobRequest{
		JobId:            created.JobId,
		ExpectedRevision: 999,
		Name:             ptrStringScheduled("Renamed"),
	})
	if err == nil || !strings.Contains(err.Error(), "revision") {
		t.Fatalf("expected revision conflict, got %v", err)
	}
	updated, err := svc.UpdateScheduledJob(ctx, "ptid:person:test", &model.UpdateScheduledJobRequest{
		JobId:            created.JobId,
		ExpectedRevision: resumed.Revision,
		Name:             ptrStringScheduled("Renamed"),
	})
	if err != nil {
		t.Fatalf("update with revision: %v", err)
	}
	if updated.Name != "Renamed" {
		t.Fatalf("update not applied: %+v", updated)
	}
}

func TestScheduledJobDeleteRetainsConversation(t *testing.T) {
	db, svc := newScheduledJobDB(t, "sched_delete")
	ctx := context.Background()
	created, conversationID, err := svc.CreateScheduledJob(ctx, "ptid:person:test", &model.CreateScheduledJobRequest{
		AgentId:      "agent-1",
		Name:         "Delete test",
		ScheduleKind: model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_INTERVAL,
		IntervalSec:  3600,
		Prompt:       "work",
		Enabled:      true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if ok, err := svc.DeleteScheduledJob(ctx, "ptid:person:test", created.JobId); err != nil || !ok {
		t.Fatalf("delete: ok=%v err=%v", ok, err)
	}
	var jobCount int64
	db.Model(&persistence.ScheduledJob{}).Count(&jobCount)
	if jobCount != 0 {
		t.Fatalf("job should be deleted, got %d", jobCount)
	}
	var conversation persistence.Conversation
	if err := db.Where("id = ?", conversationID).First(&conversation).Error; err != nil {
		t.Fatalf("dedicated conversation must be retained: %v", err)
	}
}

func TestScheduledJobSweepAdmitsTurnAndRecordsRun(t *testing.T) {
	db, svc := newScheduledJobDB(t, "sched_sweep")
	ctx := context.Background()
	created, _, err := svc.CreateScheduledJob(ctx, "ptid:person:test", &model.CreateScheduledJobRequest{
		AgentId:      "agent-1",
		Name:         "Sweep test",
		ScheduleKind: model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_INTERVAL,
		IntervalSec:  900,
		Prompt:       "run on schedule",
		Enabled:      true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	past := time.Now().UTC().Add(-time.Minute)
	if err := db.Model(&persistence.ScheduledJob{}).Where("id = ?", created.JobId).
		Updates(map[string]interface{}{"next_due_at": past}).Error; err != nil {
		t.Fatalf("force due: %v", err)
	}

	svc.sweepDueJobs(ctx)

	var job persistence.ScheduledJob
	if err := db.Where("id = ?", created.JobId).First(&job).Error; err != nil {
		t.Fatalf("reload job: %v", err)
	}
	if job.NextDueAt == nil || !job.NextDueAt.After(past) {
		t.Fatalf("sweep must advance due time: %+v", job.NextDueAt)
	}
	var run persistence.ScheduledJobRun
	if err := db.Where("job_id = ?", created.JobId).First(&run).Error; err != nil {
		t.Fatalf("scheduled run not recorded: %v", err)
	}
	if run.TurnID == "" || run.Status != scheduledRunStatusRunning {
		t.Fatalf("run must reference admitted turn and be running: %+v", run)
	}
	var turn persistence.AgentTurn
	if err := db.Where("id = ?", run.TurnID).First(&turn).Error; err != nil {
		t.Fatalf("admitted turn not persisted: %v", err)
	}
	if turn.ConversationID != created.ConversationId {
		t.Fatalf("turn must run in dedicated conversation: turn=%s job=%s", turn.ConversationID, created.ConversationId)
	}

	// Terminal turn settles the run through the same recovery path as restart.
	endedAt := time.Now().UTC()
	if err := db.Model(&persistence.AgentTurn{}).Where("id = ?", turn.ID).
		Updates(map[string]interface{}{
			"status":   string(domain.TurnStatusCompleted),
			"ended_at": endedAt,
		}).Error; err != nil {
		t.Fatalf("complete turn: %v", err)
	}
	svc.recoverScheduledRuns(ctx)

	if err := db.Where("id = ?", run.ID).First(&run).Error; err != nil {
		t.Fatalf("reload run: %v", err)
	}
	if run.Status != scheduledRunStatusSuccess || run.FinishedAt == nil {
		t.Fatalf("run must settle successful: %+v", run)
	}
}

func TestScheduledJobOnceRetiresOrDeletesAfterTrigger(t *testing.T) {
	db, svc := newScheduledJobDB(t, "sched_once")
	ctx := context.Background()
	runAt := time.Now().Add(30 * time.Minute).Format(time.RFC3339)
	retire, _, err := svc.CreateScheduledJob(ctx, "ptid:person:test", &model.CreateScheduledJobRequest{
		AgentId:      "agent-1",
		Name:         "Once retire",
		ScheduleKind: model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_ONCE,
		RunAt:        runAt,
		Prompt:       "one shot",
		Enabled:      true,
	})
	if err != nil {
		t.Fatalf("create once: %v", err)
	}
	if err := db.Model(&persistence.ScheduledJob{}).Where("id = ?", retire.JobId).
		Update("next_due_at", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatalf("force due: %v", err)
	}
	svc.sweepDueJobs(ctx)
	var retired persistence.ScheduledJob
	if err := db.Where("id = ?", retire.JobId).First(&retired).Error; err != nil {
		t.Fatalf("retired once job should still exist: %v", err)
	}
	if retired.Enabled || retired.NextDueAt != nil {
		t.Fatalf("once job must retire enabled=false with no due: %+v", retired)
	}

	deleteJob, _, err := svc.CreateScheduledJob(ctx, "ptid:person:test", &model.CreateScheduledJobRequest{
		AgentId:        "agent-1",
		Name:           "Once delete",
		ScheduleKind:   model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_ONCE,
		RunAt:          runAt,
		Prompt:         "one shot delete",
		Enabled:        true,
		DeleteAfterRun: true,
	})
	if err != nil {
		t.Fatalf("create delete-after-run: %v", err)
	}
	if err := db.Model(&persistence.ScheduledJob{}).Where("id = ?", deleteJob.JobId).
		Update("next_due_at", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatalf("force due: %v", err)
	}
	svc.sweepDueJobs(ctx)
	var count int64
	db.Model(&persistence.ScheduledJob{}).Where("id = ?", deleteJob.JobId).Count(&count)
	if count != 0 {
		t.Fatal("delete-after-run job should be removed after trigger")
	}
	var conversation persistence.Conversation
	if err := db.Where("id = ?", deleteJob.ConversationId).First(&conversation).Error; err != nil {
		t.Fatalf("dedicated conversation must survive delete-after-run: %v", err)
	}
}

func TestScheduledJobFailedAdmissionRecordedHonestly(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:sched_fail?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Create(&persistence.Agent{
		ID: "agent-1", Name: "Assistant", OwnerActorPTID: "ptid:person:test", Version: 1,
	}).Error; err != nil {
		t.Fatalf("seed agent: %v", err)
	}
	admission := newTurnAdmissionServiceWithDB(db)
	admission.SetRequestPreflight(func(context.Context, string, *model.ExecuteTurnRequest) error {
		return context.DeadlineExceeded
	})
	svc := NewScheduledJobServiceWithDB(admission, db)

	created, _, err := svc.CreateScheduledJob(context.Background(), "ptid:person:test", &model.CreateScheduledJobRequest{
		AgentId:      "agent-1",
		Name:         "Fail",
		ScheduleKind: model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_INTERVAL,
		IntervalSec:  900,
		Prompt:       "work",
		Enabled:      true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := db.Model(&persistence.ScheduledJob{}).Where("id = ?", created.JobId).
		Update("next_due_at", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatalf("force due: %v", err)
	}
	svc.sweepDueJobs(context.Background())

	var run persistence.ScheduledJobRun
	if err := db.Where("job_id = ?", created.JobId).First(&run).Error; err != nil {
		t.Fatalf("run record missing: %v", err)
	}
	if run.Status != scheduledRunStatusFailed || run.TurnID != "" || run.ErrorMessage == "" {
		t.Fatalf("admission failure must be recorded honestly: %+v", run)
	}
	var job persistence.ScheduledJob
	if err := db.Where("id = ?", created.JobId).First(&job).Error; err != nil {
		t.Fatalf("reload job: %v", err)
	}
	if job.LastStatus != scheduledRunStatusFailed || job.LastError == "" {
		t.Fatalf("job must surface failed last status: %+v", job)
	}
}
