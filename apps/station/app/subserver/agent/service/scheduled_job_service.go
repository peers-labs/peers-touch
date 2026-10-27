package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const (
	scheduledRunStatusPending = "pending"
	scheduledRunStatusRunning = "running"
	scheduledRunStatusSuccess = "success"
	scheduledRunStatusFailed  = "failed"

	scheduledTriggerSchedule = "schedule"
	scheduledTriggerManual   = "manual"

	scheduledSweepInterval    = 2 * time.Second
	scheduledSettleInterval   = 2 * time.Second
	scheduledSettleMaxWait    = 30 * time.Minute
	scheduledSweepBatchSize   = 32
	scheduledRunsDefaultLimit = 20
	scheduledRunsMaxLimit     = 100
	scheduledPromptMaxBytes   = 64 * 1024
)

// ScheduledJobService owns CRUD and due-time execution of user-visible
// persistent scheduled jobs. Triggered turns go through the same
// TurnAdmissionService as interactive turns, so budgets and capability
// policy are never bypassed.
type ScheduledJobService struct {
	admission *TurnAdmissionService
	db        *gorm.DB

	nowMu sync.RWMutex
	nowFn func() time.Time

	workerOnce sync.Once
}

func NewScheduledJobService(admission *TurnAdmissionService) *ScheduledJobService {
	return &ScheduledJobService{admission: admission}
}

// NewScheduledJobServiceWithDB wires an explicit database handle. It exists
// so deterministic in-memory tests exercise the same service path without
// requiring the production RDS resolver.
func NewScheduledJobServiceWithDB(admission *TurnAdmissionService, db *gorm.DB) *ScheduledJobService {
	return &ScheduledJobService{admission: admission, db: db}
}

func (s *ScheduledJobService) SetClockForTest(now func() time.Time) {
	s.nowMu.Lock()
	defer s.nowMu.Unlock()
	s.nowFn = now
}

func (s *ScheduledJobService) now() time.Time {
	s.nowMu.RLock()
	fn := s.nowFn
	s.nowMu.RUnlock()
	if fn != nil {
		return fn().UTC()
	}
	return time.Now().UTC()
}

func (s *ScheduledJobService) getDB(ctx context.Context) (*gorm.DB, error) {
	if s.db != nil {
		return s.db.WithContext(ctx), nil
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		logger.Warnf(ctx, "scheduled job database unavailable: %v", err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "database unavailable", err)
	}
	return db, nil
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

type validatedSchedule struct {
	kind     string
	cronExpr string
	timezone string
	runAt    string
	interval int64
	nextDue  *time.Time
}

func validateScheduledFields(name, prompt string) error {
	if strings.TrimSpace(name) == "" {
		return scheduledJobInvalid("job name is required")
	}
	if len([]rune(name)) > 200 {
		return scheduledJobInvalid("job name must be at most 200 characters")
	}
	if strings.TrimSpace(prompt) == "" {
		return scheduledJobInvalid("prompt is required")
	}
	if len(prompt) > scheduledPromptMaxBytes {
		return scheduledJobInvalid("prompt must be at most 64 KiB")
	}
	return nil
}

func validateSchedule(
	kind model.ScheduledJobScheduleKind,
	cronExpr string,
	intervalSec int64,
	runAt, timezone string,
	reference time.Time,
) (validatedSchedule, error) {
	kindText := map[model.ScheduledJobScheduleKind]string{
		model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_CRON:     scheduledKindCron,
		model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_INTERVAL: scheduledKindInterval,
		model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_ONCE:     scheduledKindOnce,
	}[kind]
	if kindText == "" {
		return validatedSchedule{}, scheduledJobInvalid("schedule_kind is required")
	}
	zone := strings.TrimSpace(timezone)
	if zone == "" {
		zone = "UTC"
	}
	schedule, err := parseJobSchedule(kindText, cronExpr, intervalSec, runAt, zone)
	if err != nil {
		return validatedSchedule{}, scheduledJobInvalid(err.Error())
	}
	next, ok, err := schedule.nextAfter(reference)
	if err != nil {
		return validatedSchedule{}, scheduledJobInvalid(err.Error())
	}
	if !ok {
		return validatedSchedule{}, scheduledJobInvalid("schedule has no future occurrence")
	}
	return validatedSchedule{
		kind:     kindText,
		cronExpr: strings.TrimSpace(cronExpr),
		timezone: zone,
		runAt:    strings.TrimSpace(runAt),
		interval: intervalSec,
		nextDue:  &next,
	}, nil
}

func scheduledJobInvalid(message string) error {
	return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, message, nil)
}

func scheduledJobNotFound(message string) error {
	return errcode.New(errcode.AgentNotFound, http.StatusNotFound, message, nil)
}

func (s *ScheduledJobService) assertOwnedAgent(ctx context.Context, tx *gorm.DB, actorPTID, agentID string) error {
	var agent persistence.Agent
	if err := tx.WithContext(ctx).Where(
		"id = ? AND owner_actor_ptid = ?", agentID, actorPTID,
	).First(&agent).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return scheduledJobInvalid("agent is not available for this actor")
		}
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load agent", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

func (s *ScheduledJobService) CreateScheduledJob(
	ctx context.Context,
	actorPTID string,
	req *model.CreateScheduledJobRequest,
) (*model.ScheduledJob, string, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" || req == nil {
		return nil, "", scheduledJobInvalid("actor and request are required")
	}
	agentID := strings.TrimSpace(req.GetAgentId())
	if agentID == "" {
		return nil, "", scheduledJobInvalid("agent_id is required")
	}
	name := strings.TrimSpace(req.GetName())
	prompt := strings.TrimSpace(req.GetPrompt())
	if err := validateScheduledFields(name, prompt); err != nil {
		return nil, "", err
	}
	now := s.now()
	validated, err := validateSchedule(
		req.GetScheduleKind(), req.GetCronExpr(), req.GetIntervalSec(),
		req.GetRunAt(), req.GetTimezone(), now,
	)
	if err != nil {
		return nil, "", err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, "", err
	}

	if key := strings.TrimSpace(req.GetIdempotencyKey()); key != "" {
		if replay, ok := s.findReplay(ctx, db, actorPTID, key); ok {
			return replay, replay.GetConversationId(), nil
		}
	}

	var override *model.ScheduledRuntimeOverride
	if req.GetRuntimeOverride() != nil {
		override = req.GetRuntimeOverride()
	}

	row := persistence.ScheduledJob{}
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.assertOwnedAgent(ctx, tx, actorPTID, agentID); err != nil {
			return err
		}
		if key := strings.TrimSpace(req.GetIdempotencyKey()); key != "" {
			var duplicate int64
			if err := tx.Model(&persistence.ScheduledJob{}).
				Where("create_idempotency_key = ?", key).
				Count(&duplicate).Error; err != nil {
				return err
			}
			if duplicate > 0 {
				return scheduledJobInvalid("idempotency key is already in use")
			}
		}
		conversationID := generateID("conv")
		conversation := persistence.Conversation{
			ID:        conversationID,
			AgentID:   agentID,
			ActorPTID: actorPTID,
			Title:     name,
			Status:    string(domain.ConversationStatusActive),
			Version:   2,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if override != nil {
			if provider := strings.TrimSpace(override.GetProvider()); provider != "" {
				conversation.ProviderID = provider
			}
			if modelName := strings.TrimSpace(override.GetModel()); modelName != "" {
				conversation.ModelName = stringPointerValue(modelName)
			}
		}
		if err := tx.Create(&conversation).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "create scheduled job conversation", err)
		}
		row = persistence.ScheduledJob{
			ID:             generateID("schedjob"),
			AgentID:        agentID,
			ActorPTID:      actorPTID,
			Name:           name,
			Description:    strings.TrimSpace(req.GetDescription()),
			ScheduleKind:   validated.kind,
			CronExpr:       validated.cronExpr,
			IntervalSec:    validated.interval,
			RunAt:          validated.runAt,
			Timezone:       validated.timezone,
			Prompt:         prompt,
			TimeoutSec:     timeoutSecFromOverride(override),
			DeleteAfterRun: req.GetDeleteAfterRun(),
			Enabled:        req.GetEnabled(),
			ConversationID: conversationID,
			NextDueAt:      validated.nextDue,
			LastStatus:     "",
			Revision:       1,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		applyOverrideToRow(&row, override)
		if key := strings.TrimSpace(req.GetIdempotencyKey()); key != "" {
			row.CreateIdempotencyKey = stringPointerValue(key)
		}
		if err := tx.Create(&row).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "create scheduled job", err)
		}
		return nil
	})
	if err != nil {
		if key := strings.TrimSpace(req.GetIdempotencyKey()); key != "" {
			if replay, ok := s.findReplay(ctx, db, actorPTID, key); ok {
				return replay, replay.GetConversationId(), nil
			}
		}
		return nil, "", err
	}
	return scheduledJobModel(&row), row.ConversationID, nil
}

func (s *ScheduledJobService) findReplay(ctx context.Context, db *gorm.DB, actorPTID, key string) (*model.ScheduledJob, bool) {
	var row persistence.ScheduledJob
	if err := db.WithContext(ctx).Where(
		"actor_ptid = ? AND create_idempotency_key = ?", actorPTID, key,
	).First(&row).Error; err != nil {
		return nil, false
	}
	return scheduledJobModel(&row), true
}

func (s *ScheduledJobService) UpdateScheduledJob(
	ctx context.Context,
	actorPTID string,
	req *model.UpdateScheduledJobRequest,
) (*model.ScheduledJob, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	jobID := strings.TrimSpace(req.GetJobId())
	if actorPTID == "" || jobID == "" {
		return nil, scheduledJobInvalid("actor and job_id are required")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var updated persistence.ScheduledJob
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row persistence.ScheduledJob
		if err := tx.Where(
			"id = ? AND actor_ptid = ?", jobID, actorPTID,
		).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return scheduledJobNotFound("scheduled job not found")
			}
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load scheduled job", err)
		}
		if req.GetExpectedRevision() != 0 && row.Revision != req.GetExpectedRevision() {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "scheduled job revision conflict", nil)
		}

		if req.Name != nil {
			name := strings.TrimSpace(req.GetName())
			if name == "" {
				return scheduledJobInvalid("job name is required")
			}
			row.Name = name
		}
		if req.Description != nil {
			row.Description = strings.TrimSpace(req.GetDescription())
		}
		if req.Prompt != nil {
			prompt := strings.TrimSpace(req.GetPrompt())
			if prompt == "" {
				return scheduledJobInvalid("prompt is required")
			}
			if len(prompt) > scheduledPromptMaxBytes {
				return scheduledJobInvalid("prompt must be at most 64 KiB")
			}
			row.Prompt = prompt
		}
		if req.DeleteAfterRun != nil {
			row.DeleteAfterRun = req.GetDeleteAfterRun()
		}
		if req.Enabled != nil {
			row.Enabled = req.GetEnabled()
		}
		if req.RuntimeOverride != nil {
			applyOverrideToRow(&row, req.GetRuntimeOverride())
			row.TimeoutSec = timeoutSecFromOverride(req.GetRuntimeOverride())
		}

		scheduleChanged := req.ScheduleKind != nil || req.CronExpr != nil ||
			req.IntervalSec != nil || req.RunAt != nil || req.Timezone != nil
		if scheduleChanged {
			kind := req.GetScheduleKind()
			if req.ScheduleKind == nil {
				kind = scheduledKindModelFromText(row.ScheduleKind)
			}
			cronExpr := row.CronExpr
			if req.CronExpr != nil {
				cronExpr = req.GetCronExpr()
			}
			interval := row.IntervalSec
			if req.IntervalSec != nil {
				interval = req.GetIntervalSec()
			}
			runAt := row.RunAt
			if req.RunAt != nil {
				runAt = req.GetRunAt()
			}
			timezone := row.Timezone
			if req.Timezone != nil {
				timezone = req.GetTimezone()
			}
			validated, err := validateSchedule(kind, cronExpr, interval, runAt, timezone, s.now())
			if err != nil {
				return err
			}
			row.ScheduleKind = validated.kind
			row.CronExpr = validated.cronExpr
			row.IntervalSec = validated.interval
			row.RunAt = validated.runAt
			row.Timezone = validated.timezone
			if row.Enabled {
				row.NextDueAt = validated.nextDue
			}
		}
		if !row.Enabled {
			row.NextDueAt = nil
		}
		row.Revision++
		row.UpdatedAt = s.now()
		if err := tx.Save(&row).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "update scheduled job", err)
		}
		updated = row
		return nil
	})
	if err != nil {
		return nil, err
	}
	return scheduledJobModel(&updated), nil
}

func (s *ScheduledJobService) DeleteScheduledJob(
	ctx context.Context,
	actorPTID, jobID string,
) (bool, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	jobID = strings.TrimSpace(jobID)
	if actorPTID == "" || jobID == "" {
		return false, scheduledJobInvalid("actor and job_id are required")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return false, err
	}
	resultErr := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row persistence.ScheduledJob
		if err := tx.Where(
			"id = ? AND actor_ptid = ?", jobID, actorPTID,
		).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return scheduledJobNotFound("scheduled job not found")
			}
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load scheduled job", err)
		}
		// Run history is job-scoped; the dedicated conversation and turns
		// remain the durable evidence and are intentionally retained.
		if err := tx.Where("job_id = ?", jobID).
			Delete(&persistence.ScheduledJobRun{}).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "delete scheduled job runs", err)
		}
		if err := tx.Delete(&persistence.ScheduledJob{}, "id = ?", jobID).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "delete scheduled job", err)
		}
		return nil
	})
	if resultErr != nil {
		return false, resultErr
	}
	return true, nil
}

func (s *ScheduledJobService) ToggleScheduledJob(
	ctx context.Context,
	actorPTID, jobID string,
	enabled bool,
) (*model.ScheduledJob, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	jobID = strings.TrimSpace(jobID)
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var updated persistence.ScheduledJob
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row persistence.ScheduledJob
		if err := tx.Where(
			"id = ? AND actor_ptid = ?", jobID, actorPTID,
		).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return scheduledJobNotFound("scheduled job not found")
			}
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load scheduled job", err)
		}
		now := s.now()
		row.Enabled = enabled
		row.Revision++
		row.UpdatedAt = now
		if enabled {
			schedule, err := parseJobSchedule(row.ScheduleKind, row.CronExpr, row.IntervalSec, row.RunAt, row.Timezone)
			if err != nil {
				return scheduledJobInvalid(err.Error())
			}
			next, ok, err := schedule.nextAfter(now)
			if err != nil {
				return scheduledJobInvalid(err.Error())
			}
			if ok {
				row.NextDueAt = &next
			} else {
				row.NextDueAt = nil
			}
		} else {
			row.NextDueAt = nil
		}
		if err := tx.Save(&row).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "toggle scheduled job", err)
		}
		updated = row
		return nil
	})
	if err != nil {
		return nil, err
	}
	return scheduledJobModel(&updated), nil
}

func (s *ScheduledJobService) ListScheduledJobs(
	ctx context.Context,
	actorPTID, agentID string,
	includePaused bool,
) ([]*model.ScheduledJob, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	query := db.WithContext(ctx).Where("actor_ptid = ?", strings.TrimSpace(actorPTID))
	if strings.TrimSpace(agentID) != "" {
		query = query.Where("agent_id = ?", strings.TrimSpace(agentID))
	}
	if !includePaused {
		query = query.Where("enabled = ?", true)
	}
	var rows []persistence.ScheduledJob
	if err := query.Order("next_due_at ASC NULLS LAST, created_at DESC").
		Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "list scheduled jobs", err)
	}
	result := make([]*model.ScheduledJob, 0, len(rows))
	for i := range rows {
		result = append(result, scheduledJobModel(&rows[i]))
	}
	return result, nil
}

func (s *ScheduledJobService) ListScheduledJobRuns(
	ctx context.Context,
	actorPTID, jobID string,
	limit int,
) ([]*model.ScheduledJobRun, error) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" {
		return nil, scheduledJobInvalid("job_id is required")
	}
	if limit <= 0 {
		limit = scheduledRunsDefaultLimit
	}
	if limit > scheduledRunsMaxLimit {
		limit = scheduledRunsMaxLimit
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var job persistence.ScheduledJob
	if err := db.WithContext(ctx).Where(
		"id = ? AND actor_ptid = ?", jobID, strings.TrimSpace(actorPTID),
	).First(&job).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, scheduledJobNotFound("scheduled job not found")
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load scheduled job", err)
	}
	var rows []persistence.ScheduledJobRun
	if err := db.WithContext(ctx).Where("job_id = ?", jobID).
		Order("created_at DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "list scheduled job runs", err)
	}
	result := make([]*model.ScheduledJobRun, 0, len(rows))
	for i := range rows {
		result = append(result, scheduledJobRunModel(&rows[i]))
	}
	return result, nil
}

// TriggerScheduledJob admits one turn immediately without changing the
// recurring schedule.
func (s *ScheduledJobService) TriggerScheduledJob(
	ctx context.Context,
	actorPTID string,
	req *model.TriggerScheduledJobRequest,
) (*model.ScheduledJobRun, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	jobID := strings.TrimSpace(req.GetJobId())
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var row persistence.ScheduledJob
	if err := db.WithContext(ctx).Where(
		"id = ? AND actor_ptid = ?", jobID, actorPTID,
	).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, scheduledJobNotFound("scheduled job not found")
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load scheduled job", err)
	}
	now := s.now()
	occurrenceKey := strings.TrimSpace(req.GetIdempotencyKey())
	if occurrenceKey == "" {
		occurrenceKey = fmt.Sprintf("manual:%s:%d", row.ID, now.UnixNano())
	}
	run := s.startJobRun(ctx, db, &row, scheduledTriggerManual, occurrenceKey, &now)
	return scheduledJobRunModel(run), nil
}

// ---------------------------------------------------------------------------
// Sweep worker
// ---------------------------------------------------------------------------

// StartScheduledJobWorker runs the due sweep until ctx is cancelled. It is
// registered in the agent worker group alongside the turn queue workers.
func (s *ScheduledJobService) StartScheduledJobWorker(workerCtx context.Context) bool {
	started := false
	s.workerOnce.Do(func() {
		started = true
		go s.runSweepLoop(workerCtx)
		go s.runRecoveryLoop(workerCtx)
	})
	return started
}

func (s *ScheduledJobService) runSweepLoop(ctx context.Context) {
	ticker := time.NewTicker(scheduledSweepInterval)
	defer ticker.Stop()
	s.sweepDueJobs(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sweepDueJobs(ctx)
		}
	}
}

func (s *ScheduledJobService) sweepDueJobs(ctx context.Context) {
	db, err := s.getDB(ctx)
	if err != nil {
		return
	}
	var jobs []persistence.ScheduledJob
	if err := db.WithContext(ctx).
		Where("enabled = ? AND next_due_at IS NOT NULL AND next_due_at <= ?", true, s.now()).
		Order("next_due_at ASC").Limit(scheduledSweepBatchSize).
		Find(&jobs).Error; err != nil {
		logger.Warnf(ctx, "scheduled job sweep query failed: %v", err)
		return
	}
	for i := range jobs {
		s.claimDueJob(ctx, db, &jobs[i])
	}
}

func (s *ScheduledJobService) claimDueJob(ctx context.Context, db *gorm.DB, job *persistence.ScheduledJob) {
	scheduledFor := job.NextDueAt
	if scheduledFor == nil {
		return
	}
	schedule, err := parseJobSchedule(
		job.ScheduleKind, job.CronExpr, job.IntervalSec, job.RunAt, job.Timezone,
	)
	if err != nil {
		s.markJobScheduleInvalid(ctx, db, job, err)
		return
	}
	now := s.now()
	var nextDue *time.Time
	if job.ScheduleKind != scheduledKindOnce {
		next, ok, nextErr := schedule.nextAfter(*scheduledFor)
		for nextErr == nil && ok && !next.After(now) {
			next, ok, nextErr = schedule.nextAfter(next)
		}
		if nextErr != nil {
			s.markJobScheduleInvalid(ctx, db, job, nextErr)
			return
		}
		if ok {
			nextDue = &next
		}
	}
	occurrenceKey := fmt.Sprintf("schedule:%s:%d", job.ID, scheduledFor.Unix())
	result := db.WithContext(ctx).Model(&persistence.ScheduledJob{}).
		Where("id = ? AND revision = ? AND next_due_at = ?", job.ID, job.Revision, scheduledFor).
		Updates(map[string]interface{}{
			"next_due_at": nextDue,
			"last_run_at": now,
			"last_status": scheduledRunStatusRunning,
			"last_error":  "",
			"updated_at":  now,
			"revision":    gorm.Expr("revision + 1"),
		})
	if result.Error != nil || result.RowsAffected != 1 {
		return
	}
	claimed := *job
	claimed.Revision++
	claimed.NextDueAt = nextDue
	claimed.LastRunAt = &now
	claimed.LastStatus = scheduledRunStatusRunning
	s.startJobRun(ctx, db, &claimed, scheduledTriggerSchedule, occurrenceKey, scheduledFor)

	if job.ScheduleKind != scheduledKindOnce {
		return
	}
	if job.DeleteAfterRun {
		// Evidence of the fired trigger lives in the retained dedicated
		// conversation and its turn; the job and its run rows are removed.
		if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("job_id = ?", job.ID).
				Delete(&persistence.ScheduledJobRun{}).Error; err != nil {
				return err
			}
			return tx.Where("id = ? AND actor_ptid = ?", job.ID, job.ActorPTID).
				Delete(&persistence.ScheduledJob{}).Error
		}); err != nil {
			logger.Warnf(ctx, "delete-after-run scheduled job %s failed: %v", job.ID, err)
		}
		return
	}
	_ = db.WithContext(ctx).Model(&persistence.ScheduledJob{}).
		Where("id = ?", job.ID).
		Updates(map[string]interface{}{"enabled": false, "updated_at": s.now()})
}

func (s *ScheduledJobService) markJobScheduleInvalid(ctx context.Context, db *gorm.DB, job *persistence.ScheduledJob, cause error) {
	_ = db.WithContext(ctx).Model(&persistence.ScheduledJob{}).
		Where("id = ?", job.ID).
		Updates(map[string]interface{}{
			"enabled":     false,
			"next_due_at": nil,
			"last_status": "invalid",
			"last_error":  cause.Error(),
			"updated_at":  s.now(),
		})
}

// startJobRun persists a pending run, admits the scheduled turn, and settles
// the run asynchronously against the turn's terminal status.
func (s *ScheduledJobService) startJobRun(
	ctx context.Context,
	db *gorm.DB,
	job *persistence.ScheduledJob,
	trigger, occurrenceKey string,
	scheduledFor *time.Time,
) *persistence.ScheduledJobRun {
	now := s.now()
	run := &persistence.ScheduledJobRun{
		ID:             generateID("schedrun"),
		JobID:          job.ID,
		AgentID:        job.AgentID,
		ConversationID: job.ConversationID,
		Status:         scheduledRunStatusPending,
		Trigger:        trigger,
		OccurrenceKey:  occurrenceKey,
		ScheduledFor:   scheduledFor,
		CreatedAt:      now,
	}
	if err := db.WithContext(ctx).Create(run).Error; err != nil {
		var existing persistence.ScheduledJobRun
		if loadErr := db.WithContext(ctx).Where(
			"occurrence_key = ?", occurrenceKey,
		).First(&existing).Error; loadErr == nil {
			return &existing
		}
		logger.Warnf(ctx, "persist scheduled job run %s failed: %v", occurrenceKey, err)
		return run
	}

	request := &model.ExecuteTurnRequest{
		ConversationId:       job.ConversationID,
		AgentId:              job.AgentID,
		UserInput:            job.Prompt,
		Stream:               false,
		ClientIdempotencyKey: occurrenceKey,
	}
	if job.OverrideModel != nil && strings.TrimSpace(*job.OverrideModel) != "" {
		request.Model = job.OverrideModel
	}
	if job.OverrideProvider != nil && strings.TrimSpace(*job.OverrideProvider) != "" {
		request.Provider = job.OverrideProvider
	}
	if job.OverrideEffort != nil && strings.TrimSpace(*job.OverrideEffort) != "" {
		request.Effort = job.OverrideEffort
	}

	admission, admitErr := s.admission.Admit(ctx, job.ActorPTID, request)
	if admitErr != nil {
		finished := s.now()
		_ = db.WithContext(ctx).Model(&persistence.ScheduledJobRun{}).
			Where("id = ?", run.ID).
			Updates(map[string]interface{}{
				"status":        scheduledRunStatusFailed,
				"error_message": admitErr.Error(),
				"started_at":    now,
				"finished_at":   finished,
				"duration_ms":   finished.Sub(now).Milliseconds(),
			})
		_ = db.WithContext(ctx).Model(&persistence.ScheduledJob{}).
			Where("id = ?", job.ID).
			Updates(map[string]interface{}{
				"last_status": scheduledRunStatusFailed,
				"last_error":  admitErr.Error(),
				"updated_at":  finished,
			})
		run.Status = scheduledRunStatusFailed
		run.ErrorMessage = admitErr.Error()
		run.TurnID = ""
		return run
	}

	turnID := admission.GetTurnId()
	_ = db.WithContext(ctx).Model(&persistence.ScheduledJobRun{}).
		Where("id = ?", run.ID).
		Updates(map[string]interface{}{
			"status":     scheduledRunStatusRunning,
			"turn_id":    turnID,
			"started_at": now,
		})
	_ = db.WithContext(ctx).Model(&persistence.ScheduledJob{}).
		Where("id = ?", job.ID).
		Updates(map[string]interface{}{
			"last_status": scheduledRunStatusRunning,
			"last_error":  "",
			"updated_at":  now,
		})
	run.Status = scheduledRunStatusRunning
	run.TurnID = turnID
	go s.settleRun(run.JobID, run.ID, turnID)
	return run
}

func (s *ScheduledJobService) settleRun(jobID, runID, turnID string) {
	if turnID == "" {
		return
	}
	deadline := time.Now().Add(scheduledSettleMaxWait)
	ticker := time.NewTicker(scheduledSettleInterval)
	defer ticker.Stop()
	for range ticker.C {
		if time.Now().After(deadline) {
			return
		}
		status, reason, _, settled := s.turnTerminalStatus(context.Background(), turnID)
		if !settled {
			continue
		}
		s.completeRun(context.Background(), jobID, runID, status, reason)
		return
	}
}

func (s *ScheduledJobService) completeRun(
	ctx context.Context,
	jobID, runID, status, reason string,
) {
	db, err := s.getDB(ctx)
	if err != nil {
		return
	}
	var run persistence.ScheduledJobRun
	if err := db.WithContext(ctx).Where("id = ?", runID).First(&run).Error; err != nil {
		return
	}
	_, _, endedAt, settled := s.turnTerminalStatus(ctx, run.TurnID)
	if !settled {
		return
	}
	finished := endedAt
	now := s.now()
	duration := int64(0)
	if run.StartedAt != nil {
		duration = finished.Sub(*run.StartedAt).Milliseconds()
		if duration < 0 {
			duration = 0
		}
	}
	if err := db.WithContext(ctx).Model(&persistence.ScheduledJobRun{}).
		Where("id = ? AND status = ?", runID, scheduledRunStatusRunning).
		Updates(map[string]interface{}{
			"status":        status,
			"error_message": reason,
			"finished_at":   finished,
			"duration_ms":   duration,
		}).Error; err != nil {
		logger.Warnf(ctx, "settle scheduled job run %s failed: %v", runID, err)
	}
	_ = db.WithContext(ctx).Model(&persistence.ScheduledJob{}).
		Where("id = ?", jobID).
		Updates(map[string]interface{}{
			"last_status": status,
			"last_error":  reason,
			"updated_at":  now,
		})
}

func (s *ScheduledJobService) turnTerminalStatus(ctx context.Context, turnID string) (string, string, time.Time, bool) {
	db, err := s.getDB(ctx)
	if err != nil {
		return "", "", time.Time{}, false
	}
	var turn persistence.AgentTurn
	if err := db.WithContext(ctx).Where("id = ?", turnID).First(&turn).Error; err != nil {
		return "", "", time.Time{}, false
	}
	switch turn.Status {
	case string(domain.TurnStatusCompleted):
		return scheduledRunStatusSuccess, "", derefTimeOrNow(turn.EndedAt), true
	case string(domain.TurnStatusFailed):
		return scheduledRunStatusFailed, turn.TerminalReason, derefTimeOrNow(turn.EndedAt), true
	case string(domain.TurnStatusInterrupted), string(domain.TurnStatusCancelled):
		return scheduledRunStatusFailed, "turn " + strings.ToLower(turn.Status), derefTimeOrNow(turn.EndedAt), true
	default:
		return "", "", time.Time{}, false
	}
}

func derefTimeOrNow(value *time.Time) time.Time {
	if value != nil {
		return value.UTC()
	}
	return time.Now().UTC()
}

// runRecoveryLoop settles runs left RUNNING by a previous Station process.
func (s *ScheduledJobService) runRecoveryLoop(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		s.recoverScheduledRuns(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *ScheduledJobService) recoverScheduledRuns(ctx context.Context) {
	db, err := s.getDB(ctx)
	if err != nil {
		return
	}
	var runs []persistence.ScheduledJobRun
	if err := db.WithContext(ctx).
		Where("status = ? AND turn_id <> ''", scheduledRunStatusRunning).
		Order("created_at ASC").Limit(16).Find(&runs).Error; err != nil {
		return
	}
	for i := range runs {
		status, reason, _, settled := s.turnTerminalStatus(ctx, runs[i].TurnID)
		if settled {
			s.completeRun(ctx, runs[i].JobID, runs[i].ID, status, reason)
		}
	}
}

// ---------------------------------------------------------------------------
// Model mapping
// ---------------------------------------------------------------------------

func timeoutSecFromOverride(override *model.ScheduledRuntimeOverride) uint32 {
	if override == nil {
		return 0
	}
	return override.GetTimeoutSec()
}

func applyOverrideToRow(row *persistence.ScheduledJob, override *model.ScheduledRuntimeOverride) {
	row.OverrideModel = nil
	row.OverrideProvider = nil
	row.OverrideEffort = nil
	row.TimeoutSec = 0
	if override == nil {
		return
	}
	if value := strings.TrimSpace(override.GetModel()); value != "" {
		row.OverrideModel = stringPointerValue(value)
	}
	if value := strings.TrimSpace(override.GetProvider()); value != "" {
		row.OverrideProvider = stringPointerValue(value)
	}
	if value := strings.TrimSpace(override.GetEffort()); value != "" {
		row.OverrideEffort = stringPointerValue(value)
	}
	row.TimeoutSec = override.GetTimeoutSec()
}

func scheduledJobModel(row *persistence.ScheduledJob) *model.ScheduledJob {
	job := &model.ScheduledJob{
		JobId:          row.ID,
		AgentId:        row.AgentID,
		Name:           row.Name,
		Description:    row.Description,
		ScheduleKind:   scheduledKindModelFromText(row.ScheduleKind),
		CronExpr:       row.CronExpr,
		IntervalSec:    row.IntervalSec,
		Timezone:       row.Timezone,
		RunAt:          row.RunAt,
		Prompt:         row.Prompt,
		DeleteAfterRun: row.DeleteAfterRun,
		Enabled:        row.Enabled,
		ConversationId: row.ConversationID,
		LastStatus:     row.LastStatus,
		LastError:      row.LastError,
		Revision:       row.Revision,
		CreatedAt:      timestamppb.New(row.CreatedAt),
		UpdatedAt:      timestamppb.New(row.UpdatedAt),
	}
	if row.NextDueAt != nil {
		job.NextDueAt = timestamppb.New(*row.NextDueAt)
	}
	if row.LastRunAt != nil {
		job.LastRunAt = timestamppb.New(*row.LastRunAt)
	}
	if row.OverrideModel != nil || row.OverrideProvider != nil ||
		row.OverrideEffort != nil || row.TimeoutSec > 0 {
		timeoutSec := row.TimeoutSec
		job.RuntimeOverride = &model.ScheduledRuntimeOverride{
			Model:      row.OverrideModel,
			Provider:   row.OverrideProvider,
			Effort:     row.OverrideEffort,
			TimeoutSec: &timeoutSec,
		}
	}
	return job
}

func scheduledKindModelFromText(value string) model.ScheduledJobScheduleKind {
	switch value {
	case scheduledKindCron:
		return model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_CRON
	case scheduledKindInterval:
		return model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_INTERVAL
	case scheduledKindOnce:
		return model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_ONCE
	default:
		return model.ScheduledJobScheduleKind_SCHEDULED_JOB_SCHEDULE_KIND_UNSPECIFIED
	}
}

func scheduledRunStatusModel(value string) model.ScheduledJobRunStatus {
	switch value {
	case scheduledRunStatusPending:
		return model.ScheduledJobRunStatus_SCHEDULED_JOB_RUN_STATUS_PENDING
	case scheduledRunStatusRunning:
		return model.ScheduledJobRunStatus_SCHEDULED_JOB_RUN_STATUS_RUNNING
	case scheduledRunStatusSuccess:
		return model.ScheduledJobRunStatus_SCHEDULED_JOB_RUN_STATUS_SUCCESS
	case scheduledRunStatusFailed:
		return model.ScheduledJobRunStatus_SCHEDULED_JOB_RUN_STATUS_FAILED
	default:
		return model.ScheduledJobRunStatus_SCHEDULED_JOB_RUN_STATUS_UNSPECIFIED
	}
}

func scheduledJobRunModel(row *persistence.ScheduledJobRun) *model.ScheduledJobRun {
	run := &model.ScheduledJobRun{
		RunId:          row.ID,
		JobId:          row.JobID,
		AgentId:        row.AgentID,
		ConversationId: row.ConversationID,
		TurnId:         row.TurnID,
		Status:         scheduledRunStatusModel(row.Status),
		Trigger:        row.Trigger,
		ErrorMessage:   row.ErrorMessage,
		DurationMs:     row.DurationMs,
	}
	if row.ScheduledFor != nil {
		run.ScheduledFor = timestamppb.New(*row.ScheduledFor)
	}
	if row.StartedAt != nil {
		run.StartedAt = timestamppb.New(*row.StartedAt)
	}
	if row.FinishedAt != nil {
		run.FinishedAt = timestamppb.New(*row.FinishedAt)
	}
	return run
}
