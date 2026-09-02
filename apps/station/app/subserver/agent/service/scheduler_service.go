package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Scheduled job types
// ---------------------------------------------------------------------------

type ScheduledJobKind string

const (
	JobKindReview                  ScheduledJobKind = "silent_review"
	JobKindDogfood                 ScheduledJobKind = "dogfood"
	JobKindCollaborationSupervisor ScheduledJobKind = "collaboration_supervisor"
)

// ScheduledJobConfig describes a repeating job.
type ScheduledJobConfig struct {
	Kind     ScheduledJobKind `json:"kind"`
	AgentID  string           `json:"agent_id"`
	Interval time.Duration    `json:"interval"`
	Enabled  bool             `json:"enabled"`
	Tiers    []DogfoodTier    `json:"tiers,omitempty"`
}

// SchedulerStatus is returned by the status endpoint.
type SchedulerStatus struct {
	Running   bool               `json:"running"`
	Jobs      []ScheduledJobInfo `json:"jobs"`
	StartedAt *time.Time         `json:"started_at,omitempty"`
}

// ScheduledJobInfo is a snapshot of a running job's state.
type ScheduledJobInfo struct {
	Kind       ScheduledJobKind `json:"kind"`
	AgentID    string           `json:"agent_id"`
	Enabled    bool             `json:"enabled"`
	Interval   string           `json:"interval"`
	LastRunAt  *time.Time       `json:"last_run_at,omitempty"`
	LastStatus string           `json:"last_status,omitempty"`
	RunCount   int              `json:"run_count"`
}

// ---------------------------------------------------------------------------
// SchedulerService
// ---------------------------------------------------------------------------

// SchedulerService manages periodic background tasks for agent self-growth:
// - SILENT review: periodically triggers review without user interaction
// - Dogfood: periodically runs self-verification scenarios
type SchedulerService struct {
	mu sync.Mutex

	reviewService  *ReviewService
	dogfoodService *DogfoodService
	memoryService  *MemoryService
	growthMetrics  *GrowthMetricsService
	orchestration  *OrchestrationService

	running   bool
	startedAt *time.Time
	rootCtx   context.Context
	cancel    context.CancelFunc
	jobs      []*scheduledJob
}

type scheduledJob struct {
	config    ScheduledJobConfig
	lastRunAt *time.Time
	lastErr   string
	runCount  int
	cancel    context.CancelFunc
	stopCh    chan struct{}
}

func NewSchedulerService(
	reviewSvc *ReviewService,
	dogfoodSvc *DogfoodService,
	memorySvc *MemoryService,
	growthMetrics *GrowthMetricsService,
) *SchedulerService {
	return &SchedulerService{
		reviewService:  reviewSvc,
		dogfoodService: dogfoodSvc,
		memoryService:  memorySvc,
		growthMetrics:  growthMetrics,
	}
}

func (s *SchedulerService) SetOrchestrationService(orchestrationSvc *OrchestrationService) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.orchestration = orchestrationSvc
}

// Start begins all registered scheduled jobs. It's idempotent — calling Start
// while already running is a no-op.
func (s *SchedulerService) Start(ctx context.Context, configs []ScheduledJobConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return
	}

	bgCtx, cancel := context.WithCancel(context.Background())
	s.rootCtx = bgCtx
	s.cancel = cancel
	s.running = true
	now := time.Now()
	s.startedAt = &now

	for _, cfg := range configs {
		if !cfg.Enabled {
			continue
		}
		if cfg.Interval < 30*time.Second {
			cfg.Interval = 30 * time.Second
		}
		jobCtx, jobCancel := context.WithCancel(bgCtx)
		j := &scheduledJob{
			config: cfg,
			cancel: jobCancel,
			stopCh: make(chan struct{}),
		}
		s.jobs = append(s.jobs, j)
		go s.runJobLoop(jobCtx, j)
	}

	logger.Infof(ctx, "scheduler: started with %d jobs", len(s.jobs))
}

// Stop gracefully shuts down the scheduler and all running jobs.
func (s *SchedulerService) Stop(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return
	}

	s.cancel()
	for _, j := range s.jobs {
		j.cancel()
		close(j.stopCh)
	}
	s.jobs = nil
	s.running = false
	s.rootCtx = nil
	s.startedAt = nil
	logger.Infof(ctx, "scheduler: stopped")
}

// Status returns the current scheduler state.
func (s *SchedulerService) Status() SchedulerStatus {
	s.mu.Lock()
	defer s.mu.Unlock()

	status := SchedulerStatus{
		Running:   s.running,
		StartedAt: s.startedAt,
	}
	for _, j := range s.jobs {
		info := ScheduledJobInfo{
			Kind:      j.config.Kind,
			AgentID:   j.config.AgentID,
			Enabled:   j.config.Enabled,
			Interval:  j.config.Interval.String(),
			LastRunAt: j.lastRunAt,
			RunCount:  j.runCount,
		}
		if j.lastErr != "" {
			info.LastStatus = "error: " + j.lastErr
		} else if j.runCount > 0 {
			info.LastStatus = "ok"
		}
		status.Jobs = append(status.Jobs, info)
	}
	return status
}

// AddJob dynamically registers a new job while the scheduler is running.
func (s *SchedulerService) AddJob(ctx context.Context, cfg ScheduledJobConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return fmt.Errorf("scheduler is not running")
	}

	if cfg.Interval < 30*time.Second {
		cfg.Interval = 30 * time.Second
	}

	jobCtx, jobCancel := context.WithCancel(s.rootCtx)
	j := &scheduledJob{
		config: cfg,
		cancel: jobCancel,
		stopCh: make(chan struct{}),
	}
	s.jobs = append(s.jobs, j)

	go s.runJobLoop(jobCtx, j)

	logger.Infof(ctx, "scheduler: added job kind=%s agent=%s interval=%s",
		cfg.Kind, cfg.AgentID, cfg.Interval)
	return nil
}

// ---------------------------------------------------------------------------
// Job loop
// ---------------------------------------------------------------------------

func (s *SchedulerService) runJobLoop(ctx context.Context, j *scheduledJob) {
	ticker := time.NewTicker(j.config.Interval)
	defer ticker.Stop()

	logger.Infof(ctx, "scheduler: job loop started kind=%s agent=%s interval=%s",
		j.config.Kind, j.config.AgentID, j.config.Interval)

	for {
		select {
		case <-ctx.Done():
			return
		case <-j.stopCh:
			return
		case <-ticker.C:
			s.executeJob(ctx, j)
		}
	}
}

func (s *SchedulerService) executeJob(ctx context.Context, j *scheduledJob) {
	now := time.Now()
	j.lastRunAt = &now
	j.runCount++

	logger.Infof(ctx, "scheduler: executing job kind=%s agent=%s run=#%d",
		j.config.Kind, j.config.AgentID, j.runCount)

	var err error

	switch j.config.Kind {
	case JobKindReview:
		err = s.executeSilentReview(ctx, j.config.AgentID)
	case JobKindDogfood:
		err = s.executeDogfood(ctx, j.config.AgentID, j.config.Tiers)
	case JobKindCollaborationSupervisor:
		err = s.executeCollaborationSupervisorSweep(ctx, j.config.AgentID)
	default:
		err = fmt.Errorf("unknown job kind: %s", j.config.Kind)
	}

	if err != nil {
		j.lastErr = err.Error()
		logger.Warnf(ctx, "scheduler: job failed kind=%s agent=%s err=%v",
			j.config.Kind, j.config.AgentID, err)
	} else {
		j.lastErr = ""
		logger.Infof(ctx, "scheduler: job completed kind=%s agent=%s",
			j.config.Kind, j.config.AgentID)
	}

	s.persistJobRun(ctx, j, err)
}

// ---------------------------------------------------------------------------
// SILENT review execution
// ---------------------------------------------------------------------------

// executeSilentReview triggers a background review for an agent without any
// active user turn. It synthesizes a review by loading the most recent
// conversation and checking if there's un-reviewed content.
func (s *SchedulerService) executeSilentReview(ctx context.Context, agentID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return fmt.Errorf("db unavailable: %w", err)
	}

	var conv persistence.Conversation
	if qErr := db.WithContext(ctx).
		Where("agent_id = ?", agentID).
		Order("updated_at DESC").
		First(&conv).Error; qErr != nil {
		return fmt.Errorf("no conversations found for agent %s: %w", agentID, qErr)
	}

	var lastReview persistence.Review
	hasReview := db.WithContext(ctx).
		Where("agent_id = ? AND conversation_id = ?", agentID, conv.ID).
		Order("completed_at DESC").
		First(&lastReview).Error == nil

	if hasReview && lastReview.CompletedAt != nil && lastReview.CompletedAt.After(conv.UpdatedAt) {
		return nil
	}

	var messages []persistence.AgentMessage
	if msgErr := db.WithContext(ctx).
		Where("conversation_id = ?", conv.ID).
		Order("created_at ASC").
		Find(&messages).Error; msgErr != nil {
		return fmt.Errorf("failed to load messages: %w", msgErr)
	}

	if len(messages) < 2 {
		return nil
	}

	domainMsgs := make([]domain.Message, 0, len(messages))
	for _, m := range messages {
		content := ""
		if m.Content != nil {
			content = *m.Content
		}
		domainMsgs = append(domainMsgs, domain.Message{
			MessageID:      m.ID,
			ConversationID: m.ConversationID,
			Role:           domain.MessageRole(m.Role),
			Content:        content,
			CreatedAt:      m.CreatedAt,
			UpdatedAt:      m.UpdatedAt,
		})
	}

	nudge := domain.NewNudgeState()
	nudge.ForceMemoryReview()

	lastTurnID := ""
	if tid := messages[len(messages)-1].TurnID; tid != nil {
		lastTurnID = *tid
	}

	provider, model := s.resolveDefaultProvider(ctx, agentID)
	if provider == "" || model == "" {
		return fmt.Errorf("no default provider/model configured for agent %s", agentID)
	}

	s.reviewService.CheckAndTriggerReview(
		ctx, nudge,
		lastTurnID, conv.ID, agentID,
		provider, model,
		domainMsgs,
		false,
	)

	if s.growthMetrics != nil {
		s.growthMetrics.RecordEvent(ctx, agentID, "silent_review_triggered",
			CategoryReview, lastTurnID, "scheduler", "success")
	}

	return nil
}

// resolveDefaultProvider looks up the most recently used provider/model for
// an agent from the most recent conversation.
func (s *SchedulerService) resolveDefaultProvider(ctx context.Context, agentID string) (string, string) {
	db, err := s.getDB(ctx)
	if err != nil {
		return "", ""
	}

	var conv persistence.Conversation
	if qErr := db.WithContext(ctx).
		Where("agent_id = ?", agentID).
		Order("updated_at DESC").
		First(&conv).Error; qErr != nil {
		return "", ""
	}

	model := ""
	if conv.ModelName != nil {
		model = *conv.ModelName
	}
	return conv.ProviderID, model
}

// ---------------------------------------------------------------------------
// Dogfood execution
// ---------------------------------------------------------------------------

func (s *SchedulerService) executeDogfood(ctx context.Context, agentID string, tiers []DogfoodTier) error {
	if len(tiers) == 0 {
		tiers = []DogfoodTier{TierHealthCheck, TierBasicChain, TierGrowthLoop}
	}

	report, err := s.dogfoodService.RunScenarios(ctx, agentID, tiers)
	if err != nil {
		return err
	}

	if report.FailedScenarios > 0 {
		logger.Warnf(ctx, "scheduler: dogfood had failures agent=%s passed=%d/%d",
			agentID, report.PassedScenarios, report.TotalScenarios)
	}

	if s.growthMetrics != nil {
		outcome := "success"
		if report.FailedScenarios > 0 {
			outcome = "partial_failure"
		}
		s.growthMetrics.RecordEvent(ctx, agentID, "scheduled_dogfood_completed",
			"dogfood", report.RunID,
			fmt.Sprintf("passed=%d/%d", report.PassedScenarios, report.TotalScenarios),
			outcome)
	}

	return nil
}

func (s *SchedulerService) executeCollaborationSupervisorSweep(ctx context.Context, agentID string) error {
	if err := enforce_canvas_single_agent_readiness(); err != nil {
		return err
	}
	return s.executeCollaborationSupervisorSweepAfterCanvasReadiness(ctx, agentID)
}

func (s *SchedulerService) executeCollaborationSupervisorSweepAfterCanvasReadiness(ctx context.Context, agentID string) error {
	if s.orchestration == nil {
		return fmt.Errorf("orchestration service is not configured")
	}
	result, err := s.orchestration.runCollaborationSupervisorSweepAfterCanvasReadiness(ctx, agentID, 50)
	if err != nil {
		return err
	}
	logger.Infof(ctx, "scheduler: collaboration supervisor sweep agent=%s scanned=%d requested=%d skipped=%d",
		agentID, result.Scanned, result.Requested, result.Skipped)
	if s.growthMetrics != nil {
		s.growthMetrics.RecordEvent(ctx, agentID, "collaboration_supervisor_sweep",
			"scheduler", "supervisor_sweep",
			fmt.Sprintf("scanned=%d requested=%d skipped=%d", result.Scanned, result.Requested, result.Skipped),
			"success")
	}
	return nil
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

func (s *SchedulerService) persistJobRun(ctx context.Context, j *scheduledJob, runErr error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return
	}

	status := "success"
	var errMsg *string
	if runErr != nil {
		status = "failure"
		msg := runErr.Error()
		errMsg = &msg
	}

	now := time.Now()
	details := fmt.Sprintf("interval=%s run=#%d", j.config.Interval, j.runCount)
	if errMsg != nil {
		details += " error=" + *errMsg
	}
	record := &persistence.GrowthEvent{
		ID:        generateID("sched"),
		AgentID:   j.config.AgentID,
		EventType: fmt.Sprintf("scheduler_%s", j.config.Kind),
		Category:  "scheduler",
		Target:    fmt.Sprintf("run_%d", j.runCount),
		Details:   details,
		Outcome:   status,
		CreatedAt: now,
	}

	db.WithContext(ctx).Create(record)
}

func (s *SchedulerService) getDB(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx, store.WithRDSDBName("agent"))
}

// ---------------------------------------------------------------------------
// Default configurations
// ---------------------------------------------------------------------------

// DefaultSchedulerConfigs returns the standard set of scheduled jobs for an
// agent. The caller can override intervals before passing to Start().
func DefaultSchedulerConfigs(agentID string) []ScheduledJobConfig {
	return []ScheduledJobConfig{
		{
			Kind:     JobKindReview,
			AgentID:  agentID,
			Interval: 2 * time.Hour,
			Enabled:  true,
		},
		{
			Kind:     JobKindDogfood,
			AgentID:  agentID,
			Interval: 6 * time.Hour,
			Enabled:  true,
			Tiers:    []DogfoodTier{TierHealthCheck, TierBasicChain},
		},
		{
			Kind:     JobKindCollaborationSupervisor,
			AgentID:  agentID,
			Interval: 5 * time.Minute,
			Enabled:  true,
		},
	}
}
