package persistence

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// EvaluationRepository is the persistence boundary for the Station Evaluation
// aggregate. A transaction creates a scoped repository so service code never
// mixes writes from different database handles.
type EvaluationRepository struct {
	db *gorm.DB
}

func NewEvaluationRepository(db *gorm.DB) *EvaluationRepository {
	return &EvaluationRepository{db: db}
}

func (r *EvaluationRepository) Transaction(
	ctx context.Context,
	fn func(*EvaluationRepository) error,
) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("evaluation repository requires database")
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return fn(NewEvaluationRepository(tx))
	})
}

func (r *EvaluationRepository) FindCommand(
	ctx context.Context,
	ptid string,
	commandKind string,
	idempotencyKey string,
) (*EvaluationCommand, error) {
	var record EvaluationCommand
	err := r.db.WithContext(ctx).
		Where(
			"ptid = ? AND command_kind = ? AND idempotency_key = ?",
			ptid,
			commandKind,
			idempotencyKey,
		).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find evaluation command: %w", err)
	}
	return &record, nil
}

func (r *EvaluationRepository) CreateCommand(
	ctx context.Context,
	command *EvaluationCommand,
) error {
	if err := r.db.WithContext(ctx).Create(command).Error; err != nil {
		return fmt.Errorf("create evaluation command: %w", err)
	}
	return nil
}

func (r *EvaluationRepository) CreateBenchmark(
	ctx context.Context,
	benchmark *EvaluationBenchmark,
) error {
	if err := r.db.WithContext(ctx).Create(benchmark).Error; err != nil {
		return fmt.Errorf("create evaluation benchmark: %w", err)
	}
	return nil
}

func (r *EvaluationRepository) GetBenchmark(
	ctx context.Context,
	ptid string,
	benchmarkID string,
	includeDeleted bool,
	lock bool,
) (*EvaluationBenchmark, error) {
	query := r.db.WithContext(ctx)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	query = query.Where("benchmark_id = ? AND ptid = ?", benchmarkID, ptid)
	if !includeDeleted {
		query = query.Where("deleted_at IS NULL")
	}
	var record EvaluationBenchmark
	if err := query.First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *EvaluationRepository) ListBenchmarks(
	ctx context.Context,
	ptid string,
) ([]EvaluationBenchmark, error) {
	var records []EvaluationBenchmark
	if err := r.db.WithContext(ctx).
		Where("ptid = ? AND deleted_at IS NULL", ptid).
		Order("created_at ASC, benchmark_id ASC").
		Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list evaluation benchmarks: %w", err)
	}
	return records, nil
}

func (r *EvaluationRepository) UpdateBenchmarkCAS(
	ctx context.Context,
	ptid string,
	benchmarkID string,
	expectedRevision uint64,
	updates map[string]interface{},
) (bool, error) {
	result := r.db.WithContext(ctx).
		Model(&EvaluationBenchmark{}).
		Where(
			"benchmark_id = ? AND ptid = ? AND revision = ? AND deleted_at IS NULL",
			benchmarkID,
			ptid,
			expectedRevision,
		).
		Updates(updates)
	if result.Error != nil {
		return false, fmt.Errorf("update evaluation benchmark: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

func (r *EvaluationRepository) TombstoneDatasetsByBenchmark(
	ctx context.Context,
	ptid string,
	benchmarkID string,
	now time.Time,
) error {
	if err := r.db.WithContext(ctx).
		Model(&EvaluationDataset{}).
		Where(
			"ptid = ? AND benchmark_id = ? AND deleted_at IS NULL",
			ptid,
			benchmarkID,
		).
		Updates(map[string]interface{}{
			"deleted_at": now,
			"revision":   gorm.Expr("revision + 1"),
			"updated_at": now,
		}).Error; err != nil {
		return fmt.Errorf("tombstone evaluation datasets: %w", err)
	}
	return nil
}

func (r *EvaluationRepository) TombstoneCasesByBenchmark(
	ctx context.Context,
	ptid string,
	benchmarkID string,
	now time.Time,
) error {
	if err := r.db.WithContext(ctx).
		Model(&EvaluationTestCase{}).
		Where(
			"ptid = ? AND dataset_id IN (?) AND deleted_at IS NULL",
			ptid,
			r.db.WithContext(ctx).
				Model(&EvaluationDataset{}).
				Select("dataset_id").
				Where("ptid = ? AND benchmark_id = ?", ptid, benchmarkID),
		).
		Updates(map[string]interface{}{
			"deleted_at": now,
			"revision":   gorm.Expr("revision + 1"),
			"updated_at": now,
		}).Error; err != nil {
		return fmt.Errorf("tombstone evaluation test cases: %w", err)
	}
	return nil
}

func (r *EvaluationRepository) CountActiveRunsForBenchmark(
	ctx context.Context,
	ptid string,
	benchmarkID string,
	activeStatuses []int32,
) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Table("agent_evaluation_runs AS runs").
		Joins(
			"JOIN agent_evaluation_datasets AS datasets ON datasets.dataset_id = runs.dataset_id",
		).
		Where(
			"runs.ptid = ? AND datasets.ptid = ? AND datasets.benchmark_id = ? AND runs.deleted_at IS NULL AND runs.status IN ?",
			ptid,
			ptid,
			benchmarkID,
			activeStatuses,
		).
		Count(&count).Error
	if err != nil {
		return 0, fmt.Errorf("count active benchmark runs: %w", err)
	}
	return count, nil
}

func (r *EvaluationRepository) CreateDataset(
	ctx context.Context,
	dataset *EvaluationDataset,
) error {
	if err := r.db.WithContext(ctx).Create(dataset).Error; err != nil {
		return fmt.Errorf("create evaluation dataset: %w", err)
	}
	return nil
}

func (r *EvaluationRepository) GetDataset(
	ctx context.Context,
	ptid string,
	datasetID string,
	includeDeleted bool,
	lock bool,
) (*EvaluationDataset, error) {
	query := r.db.WithContext(ctx)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	query = query.Where("dataset_id = ? AND ptid = ?", datasetID, ptid)
	if !includeDeleted {
		query = query.Where("deleted_at IS NULL")
	}
	var record EvaluationDataset
	if err := query.First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *EvaluationRepository) ListDatasets(
	ctx context.Context,
	ptid string,
	benchmarkID string,
) ([]EvaluationDataset, error) {
	query := r.db.WithContext(ctx).
		Where("ptid = ? AND deleted_at IS NULL", ptid)
	if benchmarkID != "" {
		query = query.Where("benchmark_id = ?", benchmarkID)
	}
	var records []EvaluationDataset
	if err := query.Order("created_at ASC, dataset_id ASC").Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list evaluation datasets: %w", err)
	}
	return records, nil
}

func (r *EvaluationRepository) UpdateDatasetCAS(
	ctx context.Context,
	ptid string,
	datasetID string,
	expectedRevision uint64,
	updates map[string]interface{},
) (bool, error) {
	result := r.db.WithContext(ctx).
		Model(&EvaluationDataset{}).
		Where(
			"dataset_id = ? AND ptid = ? AND revision = ? AND deleted_at IS NULL",
			datasetID,
			ptid,
			expectedRevision,
		).
		Updates(updates)
	if result.Error != nil {
		return false, fmt.Errorf("update evaluation dataset: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

func (r *EvaluationRepository) TombstoneCasesByDataset(
	ctx context.Context,
	ptid string,
	datasetID string,
	now time.Time,
) error {
	if err := r.db.WithContext(ctx).
		Model(&EvaluationTestCase{}).
		Where(
			"ptid = ? AND dataset_id = ? AND deleted_at IS NULL",
			ptid,
			datasetID,
		).
		Updates(map[string]interface{}{
			"deleted_at": now,
			"revision":   gorm.Expr("revision + 1"),
			"updated_at": now,
		}).Error; err != nil {
		return fmt.Errorf("tombstone evaluation test cases: %w", err)
	}
	return nil
}

func (r *EvaluationRepository) CreateTestCase(
	ctx context.Context,
	testCase *EvaluationTestCase,
) error {
	if err := r.db.WithContext(ctx).Create(testCase).Error; err != nil {
		return fmt.Errorf("create evaluation test case: %w", err)
	}
	return nil
}

func (r *EvaluationRepository) GetTestCase(
	ctx context.Context,
	ptid string,
	caseID string,
	includeDeleted bool,
	lock bool,
) (*EvaluationTestCase, error) {
	query := r.db.WithContext(ctx)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	query = query.Where("case_id = ? AND ptid = ?", caseID, ptid)
	if !includeDeleted {
		query = query.Where("deleted_at IS NULL")
	}
	var record EvaluationTestCase
	if err := query.First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *EvaluationRepository) ListTestCases(
	ctx context.Context,
	ptid string,
	datasetID string,
) ([]EvaluationTestCase, error) {
	var records []EvaluationTestCase
	if err := r.db.WithContext(ctx).
		Where(
			"ptid = ? AND dataset_id = ? AND deleted_at IS NULL",
			ptid,
			datasetID,
		).
		Order("created_at ASC, case_id ASC").
		Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list evaluation test cases: %w", err)
	}
	return records, nil
}

func (r *EvaluationRepository) UpdateTestCaseCAS(
	ctx context.Context,
	ptid string,
	caseID string,
	expectedRevision uint64,
	updates map[string]interface{},
) (bool, error) {
	result := r.db.WithContext(ctx).
		Model(&EvaluationTestCase{}).
		Where(
			"case_id = ? AND ptid = ? AND revision = ? AND deleted_at IS NULL",
			caseID,
			ptid,
			expectedRevision,
		).
		Updates(updates)
	if result.Error != nil {
		return false, fmt.Errorf("update evaluation test case: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

func (r *EvaluationRepository) CreateRun(
	ctx context.Context,
	run *EvaluationRun,
	cases []EvaluationRunCase,
) error {
	if err := r.db.WithContext(ctx).Create(run).Error; err != nil {
		return fmt.Errorf("create evaluation run: %w", err)
	}
	if len(cases) > 0 {
		if err := r.db.WithContext(ctx).Create(&cases).Error; err != nil {
			return fmt.Errorf("create evaluation run case snapshots: %w", err)
		}
	}
	return nil
}

func (r *EvaluationRepository) GetRun(
	ctx context.Context,
	ptid string,
	runID string,
	includeDeleted bool,
	lock bool,
) (*EvaluationRun, error) {
	query := r.db.WithContext(ctx)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	query = query.Where("run_id = ? AND ptid = ?", runID, ptid)
	if !includeDeleted {
		query = query.Where("deleted_at IS NULL")
	}
	var record EvaluationRun
	if err := query.First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *EvaluationRepository) GetRunByID(
	ctx context.Context,
	runID string,
	lock bool,
) (*EvaluationRun, error) {
	query := r.db.WithContext(ctx)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var record EvaluationRun
	if err := query.Where("run_id = ? AND deleted_at IS NULL", runID).
		First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *EvaluationRepository) ListRuns(
	ctx context.Context,
	ptid string,
	parentRunID *string,
	page int,
	pageSize int,
) ([]EvaluationRun, int64, error) {
	query := r.db.WithContext(ctx).
		Model(&EvaluationRun{}).
		Where("ptid = ? AND deleted_at IS NULL", ptid)
	if parentRunID != nil {
		query = query.Where("parent_run_id = ?", *parentRunID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count evaluation runs: %w", err)
	}
	var records []EvaluationRun
	if err := query.
		Order("created_at DESC, run_id DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&records).Error; err != nil {
		return nil, 0, fmt.Errorf("list evaluation runs: %w", err)
	}
	return records, total, nil
}

func (r *EvaluationRepository) ListActiveRuns(
	ctx context.Context,
	statuses []int32,
	limit int,
) ([]EvaluationRun, error) {
	var records []EvaluationRun
	query := r.db.WithContext(ctx).
		Where("status IN ? AND deleted_at IS NULL", statuses).
		Order("created_at ASC, run_id ASC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list active evaluation runs: %w", err)
	}
	return records, nil
}

func (r *EvaluationRepository) UpdateRunCAS(
	ctx context.Context,
	ptid string,
	runID string,
	expectedRevision uint64,
	expectedStatuses []int32,
	extraPredicate string,
	updates map[string]interface{},
) (bool, error) {
	query := r.db.WithContext(ctx).
		Model(&EvaluationRun{}).
		Where(
			"run_id = ? AND ptid = ? AND revision = ? AND deleted_at IS NULL",
			runID,
			ptid,
			expectedRevision,
		)
	if len(expectedStatuses) > 0 {
		query = query.Where("status IN ?", expectedStatuses)
	}
	if extraPredicate != "" {
		query = query.Where(extraPredicate)
	}
	result := query.Updates(updates)
	if result.Error != nil {
		return false, fmt.Errorf("update evaluation run: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

func (r *EvaluationRepository) UpdateRun(
	ctx context.Context,
	runID string,
	updates map[string]interface{},
) error {
	if err := r.db.WithContext(ctx).
		Model(&EvaluationRun{}).
		Where("run_id = ? AND deleted_at IS NULL", runID).
		Updates(updates).Error; err != nil {
		return fmt.Errorf("update evaluation run: %w", err)
	}
	return nil
}

func (r *EvaluationRepository) ListRunCases(
	ctx context.Context,
	runID string,
) ([]EvaluationRunCase, error) {
	var records []EvaluationRunCase
	if err := r.db.WithContext(ctx).
		Where("run_id = ?", runID).
		Order("ordinal ASC, case_id ASC").
		Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list evaluation run cases: %w", err)
	}
	return records, nil
}

func (r *EvaluationRepository) EnsureAttempt(
	ctx context.Context,
	attempt *EvaluationCaseAttempt,
) (*EvaluationCaseAttempt, bool, error) {
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(attempt)
	if result.Error != nil {
		return nil, false, fmt.Errorf("create evaluation case attempt: %w", result.Error)
	}
	if result.RowsAffected == 1 {
		return attempt, true, nil
	}
	var existing EvaluationCaseAttempt
	if err := r.db.WithContext(ctx).
		Where(
			"run_id = ? AND case_id = ? AND attempt = ?",
			attempt.RunID,
			attempt.CaseID,
			attempt.Attempt,
		).
		First(&existing).Error; err != nil {
		return nil, false, fmt.Errorf("load evaluation case attempt: %w", err)
	}
	return &existing, false, nil
}

func (r *EvaluationRepository) ClaimAttempt(
	ctx context.Context,
	attemptID string,
	claim string,
	now time.Time,
	expiresAt time.Time,
	pendingStatus int32,
) (bool, error) {
	result := r.db.WithContext(ctx).
		Model(&EvaluationCaseAttempt{}).
		Where(
			"attempt_id = ? AND status = ? AND turn_id IS NULL AND (scheduler_claim IS NULL OR scheduler_claim = ? OR scheduler_claim_expires_at <= ?)",
			attemptID,
			pendingStatus,
			claim,
			now,
		).
		Updates(map[string]interface{}{
			"scheduler_claim":            claim,
			"scheduler_claimed_at":       now,
			"scheduler_claim_expires_at": expiresAt,
			"updated_at":                 now,
		})
	if result.Error != nil {
		return false, fmt.Errorf("claim evaluation case attempt: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

func (r *EvaluationRepository) BindAttemptTurn(
	ctx context.Context,
	attemptID string,
	claim string,
	turnID string,
	conversationID string,
	startedAt time.Time,
	pendingStatus int32,
	runningStatus int32,
) (bool, error) {
	result := r.db.WithContext(ctx).
		Model(&EvaluationCaseAttempt{}).
		Where(
			"attempt_id = ? AND scheduler_claim = ? AND turn_id IS NULL AND status = ?",
			attemptID,
			claim,
			pendingStatus,
		).
		Updates(map[string]interface{}{
			"turn_id":         turnID,
			"conversation_id": conversationID,
			"status":          runningStatus,
			"started_at":      startedAt,
			"updated_at":      startedAt,
		})
	if result.Error != nil {
		return false, fmt.Errorf("bind evaluation attempt turn: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

func (r *EvaluationRepository) GetAttempt(
	ctx context.Context,
	attemptID string,
	lock bool,
) (*EvaluationCaseAttempt, error) {
	query := r.db.WithContext(ctx)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var record EvaluationCaseAttempt
	if err := query.Where("attempt_id = ?", attemptID).First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *EvaluationRepository) ListAttempts(
	ctx context.Context,
	runID string,
) ([]EvaluationCaseAttempt, error) {
	var records []EvaluationCaseAttempt
	if err := r.db.WithContext(ctx).
		Where("run_id = ?", runID).
		Order("case_id ASC, attempt ASC").
		Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list evaluation attempts: %w", err)
	}
	return records, nil
}

func (r *EvaluationRepository) UpdateAttempt(
	ctx context.Context,
	attemptID string,
	expectedStatuses []int32,
	updates map[string]interface{},
) (bool, error) {
	query := r.db.WithContext(ctx).
		Model(&EvaluationCaseAttempt{}).
		Where("attempt_id = ?", attemptID)
	if len(expectedStatuses) > 0 {
		query = query.Where("status IN ?", expectedStatuses)
	}
	result := query.Updates(updates)
	if result.Error != nil {
		return false, fmt.Errorf("update evaluation attempt: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

func (r *EvaluationRepository) CreateResult(
	ctx context.Context,
	result *EvaluationResult,
) (bool, error) {
	write := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(result)
	if write.Error != nil {
		return false, fmt.Errorf("create evaluation result: %w", write.Error)
	}
	return write.RowsAffected == 1, nil
}

func (r *EvaluationRepository) ListResults(
	ctx context.Context,
	runID string,
) ([]EvaluationResult, error) {
	var records []EvaluationResult
	if err := r.db.WithContext(ctx).
		Where("run_id = ?", runID).
		Order("case_id ASC, created_at ASC").
		Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list evaluation results: %w", err)
	}
	return records, nil
}

func (r *EvaluationRepository) AppendEvent(
	ctx context.Context,
	event *EvaluationRunEvent,
) error {
	var maxSequence uint64
	if err := r.db.WithContext(ctx).
		Model(&EvaluationRunEvent{}).
		Where("run_id = ?", event.RunID).
		Select("COALESCE(MAX(sequence), 0)").
		Scan(&maxSequence).Error; err != nil {
		return fmt.Errorf("allocate evaluation event sequence: %w", err)
	}
	event.Sequence = maxSequence + 1
	if err := r.db.WithContext(ctx).Create(event).Error; err != nil {
		return fmt.Errorf("append evaluation run event: %w", err)
	}
	return nil
}

func (r *EvaluationRepository) ListEvents(
	ctx context.Context,
	ptid string,
	runID string,
	afterSequence uint64,
) ([]EvaluationRunEvent, uint64, error) {
	var records []EvaluationRunEvent
	if err := r.db.WithContext(ctx).
		Where("ptid = ? AND run_id = ? AND sequence > ?", ptid, runID, afterSequence).
		Order("sequence ASC").
		Find(&records).Error; err != nil {
		return nil, 0, fmt.Errorf("list evaluation run events: %w", err)
	}
	var latest uint64
	if err := r.db.WithContext(ctx).
		Model(&EvaluationRunEvent{}).
		Where("ptid = ? AND run_id = ?", ptid, runID).
		Select("COALESCE(MAX(sequence), 0)").
		Scan(&latest).Error; err != nil {
		return nil, 0, fmt.Errorf("load evaluation event cursor: %w", err)
	}
	return records, latest, nil
}

func (r *EvaluationRepository) CountChildren(
	ctx context.Context,
	ptid string,
	parentRunID string,
) (int64, error) {
	var count int64
	if err := r.db.WithContext(ctx).
		Model(&EvaluationRun{}).
		Where(
			"ptid = ? AND parent_run_id = ? AND deleted_at IS NULL",
			ptid,
			parentRunID,
		).
		Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count evaluation child runs: %w", err)
	}
	return count, nil
}

func (r *EvaluationRepository) GetOwnedAgent(
	ctx context.Context,
	ptid string,
	agentID string,
	lock bool,
) (*Agent, error) {
	query := r.db.WithContext(ctx)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var record Agent
	if err := query.Where(
		"id = ? AND owner_actor_ptid = ?",
		agentID,
		ptid,
	).First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *EvaluationRepository) GetReadinessSnapshot(
	ctx context.Context,
	ptid string,
	agentID string,
	snapshotID string,
	lock bool,
) (*CapabilityReadinessSnapshot, error) {
	query := r.db.WithContext(ctx)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var record CapabilityReadinessSnapshot
	if err := query.Where(
		"snapshot_id = ? AND ptid = ? AND agent_id = ?",
		snapshotID,
		ptid,
		agentID,
	).First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}
