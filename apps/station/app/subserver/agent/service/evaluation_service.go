package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const (
	evaluationMetricsVersion = "evaluation-metrics-v1"
	evaluationPageSize       = 50
	evaluationMaxPageSize    = 200
	evaluationCommandKeyMax  = 128
	evaluationWorkerBatch    = 32
	evaluationWorkerInterval = 250 * time.Millisecond
	evaluationSchedulerLease = 30 * time.Second
	evaluationCancelTimeout  = 15 * time.Second
)

const (
	evaluationCommandCreateBenchmark = "benchmark.create"
	evaluationCommandUpdateBenchmark = "benchmark.update"
	evaluationCommandDeleteBenchmark = "benchmark.delete"
	evaluationCommandCreateDataset   = "dataset.create"
	evaluationCommandUpdateDataset   = "dataset.update"
	evaluationCommandDeleteDataset   = "dataset.delete"
	evaluationCommandCreateCase      = "case.create"
	evaluationCommandUpdateCase      = "case.update"
	evaluationCommandDeleteCase      = "case.delete"
	evaluationCommandCreateRun       = "run.create"
	evaluationCommandStartRun        = "run.start"
	evaluationCommandCancelRun       = "run.cancel"
	evaluationCommandRetryCases      = "run.retry"
	evaluationCommandDeleteRun       = "run.delete"
)

type EvaluationFailure struct {
	HTTPStatus int
	Message    string
	Detail     *model.EvaluationError
	Cause      error
}

func (e *EvaluationFailure) Error() string {
	if e == nil {
		return ""
	}
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Cause)
	}
	return e.Message
}

func (e *EvaluationFailure) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

type frozenEvaluationAgentConfig struct {
	Identity          string `json:"identity"`
	AgentConfigPrompt string `json:"agent_config_prompt"`
	Effort            string `json:"effort"`
	ThinkingMode      string `json:"thinking_mode"`
	ProviderID        string `json:"provider_id"`
	ModelID           string `json:"model_id"`
}

// EvaluationService owns the complete Station Evaluation aggregate.
type EvaluationService struct {
	repository      *persistence.EvaluationRepository
	admission       *RuntimeAdmissionResolver
	turns           EvaluationTurnKernel
	now             func() time.Time
	wake            chan struct{}
	targetResolver  func(context.Context, *persistence.EvaluationRepository, string, *model.CreateEvaluationRunRequest, bool) (*model.RuntimeSnapshot, frozenEvaluationAgentConfig, error)
	targetValidator func(context.Context, *persistence.EvaluationRepository, *persistence.EvaluationRun) error
}

func NewEvaluationService(
	db *gorm.DB,
	admission *RuntimeAdmissionResolver,
	turns EvaluationTurnKernel,
) *EvaluationService {
	evaluationService := &EvaluationService{
		repository: persistence.NewEvaluationRepository(db),
		admission:  admission,
		turns:      turns,
		now: func() time.Time {
			return time.Now().UTC()
		},
		wake: make(chan struct{}, 1),
	}
	evaluationService.targetResolver = evaluationService.resolveEvaluationTarget
	evaluationService.targetValidator = evaluationService.validateFrozenEvaluationTarget
	return evaluationService
}

func (s *EvaluationService) CreateBenchmark(
	ctx context.Context,
	ptid string,
	req *model.CreateEvaluationBenchmarkRequest,
) (*model.EvaluationBenchmark, error) {
	if req == nil || strings.TrimSpace(req.GetName()) == "" {
		return nil, evaluationInvalid("benchmark name is required")
	}
	rubric, err := normalizeEvaluationRubric(req.GetRubric())
	if err != nil {
		return nil, evaluationInvalid(err.Error())
	}
	canonicalRequest := proto.Clone(req).(*model.CreateEvaluationBenchmarkRequest)
	canonicalRequest.Rubric = rubric.name
	response := &model.CreateEvaluationBenchmarkResponse{}
	err = s.executeMutation(
		ctx,
		ptid,
		evaluationCommandCreateBenchmark,
		"benchmark:create",
		req.GetIdempotencyKey(),
		canonicalRequest,
		response,
		func(tx *persistence.EvaluationRepository) error {
			now := s.now()
			record := &persistence.EvaluationBenchmark{
				BenchmarkID: evaluationID("benchmark"),
				PTID:        ptid,
				Name:        strings.TrimSpace(req.GetName()),
				Rubric:      rubric.name,
				Revision:    1,
				CreatedAt:   now,
				UpdatedAt:   now,
			}
			if err := tx.CreateBenchmark(ctx, record); err != nil {
				return evaluationInternal("create benchmark", err)
			}
			response.Benchmark = evaluationBenchmarkModel(record)
			return nil
		},
	)
	return response.GetBenchmark(), err
}

func (s *EvaluationService) UpdateBenchmark(
	ctx context.Context,
	ptid string,
	req *model.UpdateEvaluationBenchmarkRequest,
) (*model.EvaluationBenchmark, error) {
	if req == nil || strings.TrimSpace(req.GetBenchmarkId()) == "" ||
		strings.TrimSpace(req.GetName()) == "" || req.GetExpectedRevision() == 0 {
		return nil, evaluationInvalid(
			"benchmark_id, name and expected_revision are required",
		)
	}
	rubric, err := normalizeEvaluationRubric(req.GetRubric())
	if err != nil {
		return nil, evaluationInvalid(err.Error())
	}
	canonicalRequest := proto.Clone(req).(*model.UpdateEvaluationBenchmarkRequest)
	canonicalRequest.Rubric = rubric.name
	response := &model.UpdateEvaluationBenchmarkResponse{}
	err = s.executeMutation(
		ctx,
		ptid,
		evaluationCommandUpdateBenchmark,
		"benchmark:"+req.GetBenchmarkId(),
		req.GetIdempotencyKey(),
		canonicalRequest,
		response,
		func(tx *persistence.EvaluationRepository) error {
			current, err := tx.GetBenchmark(
				ctx,
				ptid,
				req.GetBenchmarkId(),
				false,
				true,
			)
			if err != nil {
				return evaluationRecordError("benchmark", req.GetBenchmarkId(), err)
			}
			if current.Revision != req.GetExpectedRevision() {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_BENCHMARK_REVISION_CONFLICT,
					"benchmark_id",
					current.BenchmarkID,
					req.GetExpectedRevision(),
					current.Revision,
				)
			}
			now := s.now()
			updated, err := tx.UpdateBenchmarkCAS(
				ctx,
				ptid,
				current.BenchmarkID,
				current.Revision,
				map[string]interface{}{
					"name":       strings.TrimSpace(req.GetName()),
					"rubric":     rubric.name,
					"revision":   current.Revision + 1,
					"updated_at": now,
				},
			)
			if err != nil {
				return evaluationInternal("update benchmark", err)
			}
			if !updated {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_BENCHMARK_REVISION_CONFLICT,
					"benchmark_id",
					current.BenchmarkID,
					current.Revision,
					current.Revision+1,
				)
			}
			current.Name = strings.TrimSpace(req.GetName())
			current.Rubric = rubric.name
			current.Revision++
			current.UpdatedAt = now
			response.Benchmark = evaluationBenchmarkModel(current)
			return nil
		},
	)
	return response.GetBenchmark(), err
}

func (s *EvaluationService) DeleteBenchmark(
	ctx context.Context,
	ptid string,
	req *model.DeleteEvaluationBenchmarkRequest,
) (bool, error) {
	if req == nil || strings.TrimSpace(req.GetBenchmarkId()) == "" ||
		req.GetExpectedRevision() == 0 {
		return false, evaluationInvalid(
			"benchmark_id and expected_revision are required",
		)
	}
	response := &model.DeleteEvaluationBenchmarkResponse{}
	err := s.executeMutation(
		ctx,
		ptid,
		evaluationCommandDeleteBenchmark,
		"benchmark:"+req.GetBenchmarkId(),
		req.GetIdempotencyKey(),
		req,
		response,
		func(tx *persistence.EvaluationRepository) error {
			current, err := tx.GetBenchmark(
				ctx,
				ptid,
				req.GetBenchmarkId(),
				false,
				true,
			)
			if err != nil {
				return evaluationRecordError("benchmark", req.GetBenchmarkId(), err)
			}
			if current.Revision != req.GetExpectedRevision() {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_BENCHMARK_REVISION_CONFLICT,
					"benchmark_id",
					current.BenchmarkID,
					req.GetExpectedRevision(),
					current.Revision,
				)
			}
			active, err := tx.CountActiveRunsForBenchmark(
				ctx,
				ptid,
				current.BenchmarkID,
				evaluationActiveRunStatuses(),
			)
			if err != nil {
				return evaluationInternal("check benchmark retention", err)
			}
			if active > 0 {
				return evaluationFailure(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_RETENTION_CONFLICT,
					http.StatusConflict,
					"benchmark has active evaluation runs",
					false,
					false,
					"wait_for_terminal_runs",
					map[string]string{
						"benchmark_id": current.BenchmarkID,
						"active_runs":  strconv.FormatInt(active, 10),
					},
					nil,
				)
			}
			now := s.now()
			updated, err := tx.UpdateBenchmarkCAS(
				ctx,
				ptid,
				current.BenchmarkID,
				current.Revision,
				map[string]interface{}{
					"deleted_at": now,
					"revision":   current.Revision + 1,
					"updated_at": now,
				},
			)
			if err != nil {
				return evaluationInternal("delete benchmark", err)
			}
			if !updated {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_BENCHMARK_REVISION_CONFLICT,
					"benchmark_id",
					current.BenchmarkID,
					current.Revision,
					current.Revision+1,
				)
			}
			if err := tx.TombstoneCasesByBenchmark(
				ctx,
				ptid,
				current.BenchmarkID,
				now,
			); err != nil {
				return evaluationInternal("tombstone benchmark cases", err)
			}
			if err := tx.TombstoneDatasetsByBenchmark(
				ctx,
				ptid,
				current.BenchmarkID,
				now,
			); err != nil {
				return evaluationInternal("tombstone benchmark datasets", err)
			}
			response.Deleted = true
			return nil
		},
	)
	return response.GetDeleted(), err
}

func (s *EvaluationService) ListBenchmarks(
	ctx context.Context,
	ptid string,
) ([]*model.EvaluationBenchmark, error) {
	if strings.TrimSpace(ptid) == "" {
		return nil, evaluationUnauthorized()
	}
	records, err := s.repository.ListBenchmarks(ctx, ptid)
	if err != nil {
		return nil, evaluationInternal("list benchmarks", err)
	}
	result := make([]*model.EvaluationBenchmark, 0, len(records))
	for index := range records {
		result = append(result, evaluationBenchmarkModel(&records[index]))
	}
	return result, nil
}

func (s *EvaluationService) CreateDataset(
	ctx context.Context,
	ptid string,
	req *model.CreateEvaluationDatasetRequest,
) (*model.EvaluationDataset, *model.EvaluationBenchmark, error) {
	if req == nil || strings.TrimSpace(req.GetBenchmarkId()) == "" ||
		strings.TrimSpace(req.GetName()) == "" ||
		req.GetExpectedBenchmarkRevision() == 0 {
		return nil, nil, evaluationInvalid(
			"benchmark_id, name and expected_benchmark_revision are required",
		)
	}
	response := &model.CreateEvaluationDatasetResponse{}
	err := s.executeMutation(
		ctx,
		ptid,
		evaluationCommandCreateDataset,
		"benchmark:"+req.GetBenchmarkId()+":dataset:create",
		req.GetIdempotencyKey(),
		req,
		response,
		func(tx *persistence.EvaluationRepository) error {
			benchmark, err := tx.GetBenchmark(
				ctx,
				ptid,
				req.GetBenchmarkId(),
				false,
				true,
			)
			if err != nil {
				return evaluationRecordError("benchmark", req.GetBenchmarkId(), err)
			}
			if benchmark.Revision != req.GetExpectedBenchmarkRevision() {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_BENCHMARK_REVISION_CONFLICT,
					"benchmark_id",
					benchmark.BenchmarkID,
					req.GetExpectedBenchmarkRevision(),
					benchmark.Revision,
				)
			}
			now := s.now()
			record := &persistence.EvaluationDataset{
				DatasetID:   evaluationID("dataset"),
				BenchmarkID: benchmark.BenchmarkID,
				PTID:        ptid,
				Name:        strings.TrimSpace(req.GetName()),
				Description: strings.TrimSpace(req.GetDescription()),
				Revision:    1,
				CreatedAt:   now,
				UpdatedAt:   now,
			}
			if err := tx.CreateDataset(ctx, record); err != nil {
				return evaluationInternal("create dataset", err)
			}
			updated, err := tx.UpdateBenchmarkCAS(
				ctx,
				ptid,
				benchmark.BenchmarkID,
				benchmark.Revision,
				map[string]interface{}{
					"revision":   benchmark.Revision + 1,
					"updated_at": now,
				},
			)
			if err != nil {
				return evaluationInternal("advance benchmark revision", err)
			}
			if !updated {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_BENCHMARK_REVISION_CONFLICT,
					"benchmark_id",
					benchmark.BenchmarkID,
					benchmark.Revision,
					benchmark.Revision+1,
				)
			}
			benchmark.Revision++
			benchmark.UpdatedAt = now
			response.Dataset = evaluationDatasetModel(record)
			response.Benchmark = evaluationBenchmarkModel(benchmark)
			return nil
		},
	)
	return response.GetDataset(), response.GetBenchmark(), err
}

func (s *EvaluationService) UpdateDataset(
	ctx context.Context,
	ptid string,
	req *model.UpdateEvaluationDatasetRequest,
) (*model.EvaluationDataset, error) {
	if req == nil || strings.TrimSpace(req.GetDatasetId()) == "" ||
		strings.TrimSpace(req.GetName()) == "" || req.GetExpectedRevision() == 0 {
		return nil, evaluationInvalid(
			"dataset_id, name and expected_revision are required",
		)
	}
	response := &model.UpdateEvaluationDatasetResponse{}
	err := s.executeMutation(
		ctx,
		ptid,
		evaluationCommandUpdateDataset,
		"dataset:"+req.GetDatasetId(),
		req.GetIdempotencyKey(),
		req,
		response,
		func(tx *persistence.EvaluationRepository) error {
			current, err := tx.GetDataset(ctx, ptid, req.GetDatasetId(), false, true)
			if err != nil {
				return evaluationRecordError("dataset", req.GetDatasetId(), err)
			}
			if current.Revision != req.GetExpectedRevision() {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_DATASET_REVISION_CONFLICT,
					"dataset_id",
					current.DatasetID,
					req.GetExpectedRevision(),
					current.Revision,
				)
			}
			now := s.now()
			updated, err := tx.UpdateDatasetCAS(
				ctx,
				ptid,
				current.DatasetID,
				current.Revision,
				map[string]interface{}{
					"name":        strings.TrimSpace(req.GetName()),
					"description": strings.TrimSpace(req.GetDescription()),
					"revision":    current.Revision + 1,
					"updated_at":  now,
				},
			)
			if err != nil {
				return evaluationInternal("update dataset", err)
			}
			if !updated {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_DATASET_REVISION_CONFLICT,
					"dataset_id",
					current.DatasetID,
					current.Revision,
					current.Revision+1,
				)
			}
			current.Name = strings.TrimSpace(req.GetName())
			current.Description = strings.TrimSpace(req.GetDescription())
			current.Revision++
			current.UpdatedAt = now
			response.Dataset = evaluationDatasetModel(current)
			return nil
		},
	)
	return response.GetDataset(), err
}

func (s *EvaluationService) DeleteDataset(
	ctx context.Context,
	ptid string,
	req *model.DeleteEvaluationDatasetRequest,
) (bool, error) {
	if req == nil || strings.TrimSpace(req.GetDatasetId()) == "" ||
		req.GetExpectedRevision() == 0 {
		return false, evaluationInvalid(
			"dataset_id and expected_revision are required",
		)
	}
	response := &model.DeleteEvaluationDatasetResponse{}
	err := s.executeMutation(
		ctx,
		ptid,
		evaluationCommandDeleteDataset,
		"dataset:"+req.GetDatasetId(),
		req.GetIdempotencyKey(),
		req,
		response,
		func(tx *persistence.EvaluationRepository) error {
			current, err := tx.GetDataset(ctx, ptid, req.GetDatasetId(), false, true)
			if err != nil {
				return evaluationRecordError("dataset", req.GetDatasetId(), err)
			}
			if current.Revision != req.GetExpectedRevision() {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_DATASET_REVISION_CONFLICT,
					"dataset_id",
					current.DatasetID,
					req.GetExpectedRevision(),
					current.Revision,
				)
			}
			now := s.now()
			updated, err := tx.UpdateDatasetCAS(
				ctx,
				ptid,
				current.DatasetID,
				current.Revision,
				map[string]interface{}{
					"deleted_at": now,
					"revision":   current.Revision + 1,
					"updated_at": now,
				},
			)
			if err != nil {
				return evaluationInternal("delete dataset", err)
			}
			if !updated {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_DATASET_REVISION_CONFLICT,
					"dataset_id",
					current.DatasetID,
					current.Revision,
					current.Revision+1,
				)
			}
			if err := tx.TombstoneCasesByDataset(
				ctx,
				ptid,
				current.DatasetID,
				now,
			); err != nil {
				return evaluationInternal("tombstone dataset cases", err)
			}
			response.Deleted = true
			return nil
		},
	)
	return response.GetDeleted(), err
}

func (s *EvaluationService) ListDatasets(
	ctx context.Context,
	ptid string,
	benchmarkID string,
) ([]*model.EvaluationDataset, error) {
	if strings.TrimSpace(ptid) == "" {
		return nil, evaluationUnauthorized()
	}
	records, err := s.repository.ListDatasets(
		ctx,
		ptid,
		strings.TrimSpace(benchmarkID),
	)
	if err != nil {
		return nil, evaluationInternal("list datasets", err)
	}
	result := make([]*model.EvaluationDataset, 0, len(records))
	for index := range records {
		result = append(result, evaluationDatasetModel(&records[index]))
	}
	return result, nil
}

func (s *EvaluationService) CreateTestCase(
	ctx context.Context,
	ptid string,
	req *model.CreateEvaluationTestCaseRequest,
) (*model.EvaluationTestCase, *model.EvaluationDataset, error) {
	if req == nil || strings.TrimSpace(req.GetDatasetId()) == "" ||
		strings.TrimSpace(req.GetInput()) == "" ||
		req.GetExpectedDatasetRevision() == 0 {
		return nil, nil, evaluationInvalid(
			"dataset_id, input and expected_dataset_revision are required",
		)
	}
	rubricOverride, err := normalizeEvaluationRubricOverride(req.RubricOverride)
	if err != nil {
		return nil, nil, evaluationInvalid(err.Error())
	}
	canonicalRequest := proto.Clone(req).(*model.CreateEvaluationTestCaseRequest)
	canonicalRequest.RubricOverride = rubricOverride
	response := &model.CreateEvaluationTestCaseResponse{}
	err = s.executeMutation(
		ctx,
		ptid,
		evaluationCommandCreateCase,
		"dataset:"+req.GetDatasetId()+":case:create",
		req.GetIdempotencyKey(),
		canonicalRequest,
		response,
		func(tx *persistence.EvaluationRepository) error {
			dataset, err := tx.GetDataset(ctx, ptid, req.GetDatasetId(), false, true)
			if err != nil {
				return evaluationRecordError("dataset", req.GetDatasetId(), err)
			}
			if dataset.Revision != req.GetExpectedDatasetRevision() {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_DATASET_REVISION_CONFLICT,
					"dataset_id",
					dataset.DatasetID,
					req.GetExpectedDatasetRevision(),
					dataset.Revision,
				)
			}
			tagsJSON, err := json.Marshal(sortedUniqueStrings(req.GetTags()))
			if err != nil {
				return evaluationInternal("encode test case tags", err)
			}
			now := s.now()
			record := &persistence.EvaluationTestCase{
				CaseID:         evaluationID("case"),
				DatasetID:      dataset.DatasetID,
				PTID:           ptid,
				Input:          strings.TrimSpace(req.GetInput()),
				Expected:       req.GetExpected(),
				RubricOverride: cloneOptionalString(rubricOverride),
				TagsJSON:       tagsJSON,
				Revision:       1,
				CreatedAt:      now,
				UpdatedAt:      now,
			}
			if err := tx.CreateTestCase(ctx, record); err != nil {
				return evaluationInternal("create test case", err)
			}
			updated, err := tx.UpdateDatasetCAS(
				ctx,
				ptid,
				dataset.DatasetID,
				dataset.Revision,
				map[string]interface{}{
					"revision":   dataset.Revision + 1,
					"updated_at": now,
				},
			)
			if err != nil {
				return evaluationInternal("advance dataset revision", err)
			}
			if !updated {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_DATASET_REVISION_CONFLICT,
					"dataset_id",
					dataset.DatasetID,
					dataset.Revision,
					dataset.Revision+1,
				)
			}
			dataset.Revision++
			dataset.UpdatedAt = now
			response.TestCase = evaluationTestCaseModel(record)
			response.Dataset = evaluationDatasetModel(dataset)
			return nil
		},
	)
	return response.GetTestCase(), response.GetDataset(), err
}

func (s *EvaluationService) UpdateTestCase(
	ctx context.Context,
	ptid string,
	req *model.UpdateEvaluationTestCaseRequest,
) (*model.EvaluationTestCase, *model.EvaluationDataset, error) {
	if req == nil || strings.TrimSpace(req.GetCaseId()) == "" ||
		strings.TrimSpace(req.GetInput()) == "" || req.GetExpectedRevision() == 0 {
		return nil, nil, evaluationInvalid(
			"case_id, input and expected_revision are required",
		)
	}
	rubricOverride, err := normalizeEvaluationRubricOverride(req.RubricOverride)
	if err != nil {
		return nil, nil, evaluationInvalid(err.Error())
	}
	canonicalRequest := proto.Clone(req).(*model.UpdateEvaluationTestCaseRequest)
	canonicalRequest.RubricOverride = rubricOverride
	response := &model.UpdateEvaluationTestCaseResponse{}
	err = s.executeMutation(
		ctx,
		ptid,
		evaluationCommandUpdateCase,
		"case:"+req.GetCaseId(),
		req.GetIdempotencyKey(),
		canonicalRequest,
		response,
		func(tx *persistence.EvaluationRepository) error {
			sourceCase, err := tx.GetTestCase(ctx, ptid, req.GetCaseId(), false, false)
			if err != nil {
				return evaluationRecordError("test_case", req.GetCaseId(), err)
			}
			dataset, err := tx.GetDataset(ctx, ptid, sourceCase.DatasetID, false, true)
			if err != nil {
				return evaluationRecordError("dataset", sourceCase.DatasetID, err)
			}
			current, err := tx.GetTestCase(ctx, ptid, req.GetCaseId(), false, true)
			if err != nil {
				return evaluationRecordError("test_case", req.GetCaseId(), err)
			}
			if current.Revision != req.GetExpectedRevision() {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_TEST_CASE_REVISION_CONFLICT,
					"case_id",
					current.CaseID,
					req.GetExpectedRevision(),
					current.Revision,
				)
			}
			tagsJSON, err := json.Marshal(sortedUniqueStrings(req.GetTags()))
			if err != nil {
				return evaluationInternal("encode test case tags", err)
			}
			now := s.now()
			updated, err := tx.UpdateTestCaseCAS(
				ctx,
				ptid,
				current.CaseID,
				current.Revision,
				map[string]interface{}{
					"input":           strings.TrimSpace(req.GetInput()),
					"expected":        req.GetExpected(),
					"rubric_override": cloneOptionalString(rubricOverride),
					"tags_json":       tagsJSON,
					"revision":        current.Revision + 1,
					"updated_at":      now,
				},
			)
			if err != nil {
				return evaluationInternal("update test case", err)
			}
			if !updated {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_TEST_CASE_REVISION_CONFLICT,
					"case_id",
					current.CaseID,
					current.Revision,
					current.Revision+1,
				)
			}
			datasetUpdated, err := tx.UpdateDatasetCAS(
				ctx,
				ptid,
				dataset.DatasetID,
				dataset.Revision,
				map[string]interface{}{
					"revision":   dataset.Revision + 1,
					"updated_at": now,
				},
			)
			if err != nil {
				return evaluationInternal("advance dataset revision", err)
			}
			if !datasetUpdated {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_DATASET_REVISION_CONFLICT,
					"dataset_id",
					dataset.DatasetID,
					dataset.Revision,
					dataset.Revision+1,
				)
			}
			current.Input = strings.TrimSpace(req.GetInput())
			current.Expected = req.GetExpected()
			current.RubricOverride = cloneOptionalString(rubricOverride)
			current.TagsJSON = tagsJSON
			current.Revision++
			current.UpdatedAt = now
			dataset.Revision++
			dataset.UpdatedAt = now
			response.TestCase = evaluationTestCaseModel(current)
			response.Dataset = evaluationDatasetModel(dataset)
			return nil
		},
	)
	return response.GetTestCase(), response.GetDataset(), err
}

func (s *EvaluationService) DeleteTestCase(
	ctx context.Context,
	ptid string,
	req *model.DeleteEvaluationTestCaseRequest,
) (bool, *model.EvaluationDataset, error) {
	if req == nil || strings.TrimSpace(req.GetCaseId()) == "" ||
		req.GetExpectedRevision() == 0 {
		return false, nil, evaluationInvalid(
			"case_id and expected_revision are required",
		)
	}
	response := &model.DeleteEvaluationTestCaseResponse{}
	err := s.executeMutation(
		ctx,
		ptid,
		evaluationCommandDeleteCase,
		"case:"+req.GetCaseId(),
		req.GetIdempotencyKey(),
		req,
		response,
		func(tx *persistence.EvaluationRepository) error {
			sourceCase, err := tx.GetTestCase(ctx, ptid, req.GetCaseId(), false, false)
			if err != nil {
				return evaluationRecordError("test_case", req.GetCaseId(), err)
			}
			dataset, err := tx.GetDataset(ctx, ptid, sourceCase.DatasetID, false, true)
			if err != nil {
				return evaluationRecordError("dataset", sourceCase.DatasetID, err)
			}
			current, err := tx.GetTestCase(ctx, ptid, req.GetCaseId(), false, true)
			if err != nil {
				return evaluationRecordError("test_case", req.GetCaseId(), err)
			}
			if current.Revision != req.GetExpectedRevision() {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_TEST_CASE_REVISION_CONFLICT,
					"case_id",
					current.CaseID,
					req.GetExpectedRevision(),
					current.Revision,
				)
			}
			now := s.now()
			updated, err := tx.UpdateTestCaseCAS(
				ctx,
				ptid,
				current.CaseID,
				current.Revision,
				map[string]interface{}{
					"deleted_at": now,
					"revision":   current.Revision + 1,
					"updated_at": now,
				},
			)
			if err != nil {
				return evaluationInternal("delete test case", err)
			}
			if !updated {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_TEST_CASE_REVISION_CONFLICT,
					"case_id",
					current.CaseID,
					current.Revision,
					current.Revision+1,
				)
			}
			datasetUpdated, err := tx.UpdateDatasetCAS(
				ctx,
				ptid,
				dataset.DatasetID,
				dataset.Revision,
				map[string]interface{}{
					"revision":   dataset.Revision + 1,
					"updated_at": now,
				},
			)
			if err != nil {
				return evaluationInternal("advance dataset revision", err)
			}
			if !datasetUpdated {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_DATASET_REVISION_CONFLICT,
					"dataset_id",
					dataset.DatasetID,
					dataset.Revision,
					dataset.Revision+1,
				)
			}
			dataset.Revision++
			dataset.UpdatedAt = now
			response.Deleted = true
			response.Dataset = evaluationDatasetModel(dataset)
			return nil
		},
	)
	return response.GetDeleted(), response.GetDataset(), err
}

func (s *EvaluationService) ListTestCases(
	ctx context.Context,
	ptid string,
	datasetID string,
) ([]*model.EvaluationTestCase, error) {
	if strings.TrimSpace(ptid) == "" || strings.TrimSpace(datasetID) == "" {
		return nil, evaluationInvalid("ptid and dataset_id are required")
	}
	if _, err := s.repository.GetDataset(
		ctx,
		ptid,
		datasetID,
		false,
		false,
	); err != nil {
		return nil, evaluationRecordError("dataset", datasetID, err)
	}
	records, err := s.repository.ListTestCases(ctx, ptid, datasetID)
	if err != nil {
		return nil, evaluationInternal("list test cases", err)
	}
	result := make([]*model.EvaluationTestCase, 0, len(records))
	for index := range records {
		result = append(result, evaluationTestCaseModel(&records[index]))
	}
	return result, nil
}

func (s *EvaluationService) executeMutation(
	ctx context.Context,
	ptid string,
	commandKind string,
	mutationScope string,
	idempotencyKey string,
	request proto.Message,
	response proto.Message,
	mutate func(*persistence.EvaluationRepository) error,
) error {
	ptid = strings.TrimSpace(ptid)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if ptid == "" {
		return evaluationUnauthorized()
	}
	if idempotencyKey == "" || len(idempotencyKey) > evaluationCommandKeyMax {
		return evaluationInvalid("a bounded idempotency_key is required")
	}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		return evaluationInternal("encode idempotent evaluation command", err)
	}
	sum := sha256.Sum256(payload)
	payloadHash := hex.EncodeToString(sum[:])
	if replayed, err := s.replayMutation(
		ctx,
		s.repository,
		ptid,
		commandKind,
		idempotencyKey,
		payloadHash,
		response,
	); replayed || err != nil {
		return err
	}

	err = s.repository.Transaction(
		ctx,
		func(tx *persistence.EvaluationRepository) error {
			if replayed, replayErr := s.replayMutation(
				ctx,
				tx,
				ptid,
				commandKind,
				idempotencyKey,
				payloadHash,
				response,
			); replayed || replayErr != nil {
				return replayErr
			}
			if err := mutate(tx); err != nil {
				return err
			}
			responsePayload, err := proto.MarshalOptions{
				Deterministic: true,
			}.Marshal(response)
			if err != nil {
				return evaluationInternal("encode evaluation command response", err)
			}
			return tx.CreateCommand(ctx, &persistence.EvaluationCommand{
				CommandID:       evaluationID("evalcmd"),
				PTID:            ptid,
				CommandKind:     commandKind,
				IdempotencyKey:  idempotencyKey,
				PayloadHash:     payloadHash,
				MutationScope:   mutationScope,
				ResourceID:      evaluationResponseResourceID(response),
				ResponsePayload: responsePayload,
				CreatedAt:       s.now(),
			})
		},
	)
	if err == nil {
		return nil
	}
	if replayed, replayErr := s.replayMutation(
		ctx,
		s.repository,
		ptid,
		commandKind,
		idempotencyKey,
		payloadHash,
		response,
	); replayed || replayErr != nil {
		return replayErr
	}
	return err
}

func (s *EvaluationService) replayMutation(
	ctx context.Context,
	repository *persistence.EvaluationRepository,
	ptid string,
	commandKind string,
	idempotencyKey string,
	payloadHash string,
	response proto.Message,
) (bool, error) {
	command, err := repository.FindCommand(
		ctx,
		ptid,
		commandKind,
		idempotencyKey,
	)
	if err != nil {
		return false, evaluationInternal("read evaluation command replay", err)
	}
	if command == nil {
		return false, nil
	}
	if command.PayloadHash != payloadHash {
		return true, evaluationFailure(
			model.EvaluationErrorCode_EVALUATION_ERROR_CODE_IDEMPOTENCY_CONFLICT,
			http.StatusConflict,
			"evaluation idempotency key was reused with different input",
			false,
			true,
			"use_new_idempotency_key",
			map[string]string{
				"command_kind":   commandKind,
				"mutation_scope": command.MutationScope,
			},
			nil,
		)
	}
	if err := proto.Unmarshal(command.ResponsePayload, response); err != nil {
		return true, evaluationInternal("decode evaluation command replay", err)
	}
	return true, nil
}

func evaluationResponseResourceID(response proto.Message) string {
	switch value := response.(type) {
	case *model.CreateEvaluationBenchmarkResponse:
		return value.GetBenchmark().GetBenchmarkId()
	case *model.UpdateEvaluationBenchmarkResponse:
		return value.GetBenchmark().GetBenchmarkId()
	case *model.CreateEvaluationDatasetResponse:
		return value.GetDataset().GetDatasetId()
	case *model.UpdateEvaluationDatasetResponse:
		return value.GetDataset().GetDatasetId()
	case *model.CreateEvaluationTestCaseResponse:
		return value.GetTestCase().GetCaseId()
	case *model.UpdateEvaluationTestCaseResponse:
		return value.GetTestCase().GetCaseId()
	case *model.CreateEvaluationRunResponse:
		return value.GetRun().GetRunId()
	case *model.StartEvaluationRunResponse:
		return value.GetRun().GetRunId()
	case *model.CancelEvaluationRunResponse:
		return value.GetRun().GetRunId()
	case *model.RetryEvaluationCasesResponse:
		return value.GetChildRun().GetRunId()
	default:
		return ""
	}
}

func evaluationBenchmarkModel(
	record *persistence.EvaluationBenchmark,
) *model.EvaluationBenchmark {
	if record == nil {
		return nil
	}
	return &model.EvaluationBenchmark{
		BenchmarkId: record.BenchmarkID,
		Ptid:        record.PTID,
		Name:        record.Name,
		Rubric:      record.Rubric,
		Revision:    record.Revision,
		CreatedAt:   timestamppb.New(record.CreatedAt),
		UpdatedAt:   timestamppb.New(record.UpdatedAt),
		DeletedAt:   evaluationTimestamp(record.DeletedAt),
	}
}

func evaluationDatasetModel(
	record *persistence.EvaluationDataset,
) *model.EvaluationDataset {
	if record == nil {
		return nil
	}
	return &model.EvaluationDataset{
		DatasetId:   record.DatasetID,
		BenchmarkId: record.BenchmarkID,
		Ptid:        record.PTID,
		Name:        record.Name,
		Revision:    record.Revision,
		Description: record.Description,
		CreatedAt:   timestamppb.New(record.CreatedAt),
		UpdatedAt:   timestamppb.New(record.UpdatedAt),
		DeletedAt:   evaluationTimestamp(record.DeletedAt),
	}
}

func evaluationTestCaseModel(
	record *persistence.EvaluationTestCase,
) *model.EvaluationTestCase {
	if record == nil {
		return nil
	}
	var tags []string
	if len(record.TagsJSON) > 0 {
		_ = json.Unmarshal(record.TagsJSON, &tags)
	}
	return &model.EvaluationTestCase{
		CaseId:         record.CaseID,
		DatasetId:      record.DatasetID,
		Input:          record.Input,
		Expected:       record.Expected,
		RubricOverride: cloneOptionalString(record.RubricOverride),
		Revision:       record.Revision,
		Tags:           tags,
		CreatedAt:      timestamppb.New(record.CreatedAt),
		UpdatedAt:      timestamppb.New(record.UpdatedAt),
		DeletedAt:      evaluationTimestamp(record.DeletedAt),
	}
}

func evaluationTimestamp(value *time.Time) *timestamppb.Timestamp {
	if value == nil {
		return nil
	}
	return timestamppb.New(value.UTC())
}

func cloneOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func sortedUniqueStrings(values []string) []string {
	unique := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			unique[value] = struct{}{}
		}
	}
	result := make([]string, 0, len(unique))
	for value := range unique {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func evaluationID(prefix string) string {
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%d", prefix, time.Now().UnixNano())))
		copy(random, sum[:12])
	}
	return prefix + "_" + hex.EncodeToString(random)
}

func evaluationFailure(
	code model.EvaluationErrorCode,
	httpStatus int,
	message string,
	retryable bool,
	terminal bool,
	recoveryAction string,
	details map[string]string,
	cause error,
) *EvaluationFailure {
	return &EvaluationFailure{
		HTTPStatus: httpStatus,
		Message:    message,
		Cause:      cause,
		Detail: &model.EvaluationError{
			Code:           code,
			Retryable:      retryable,
			RecoveryAction: recoveryAction,
			LocaleKey:      evaluationLocaleKey(code),
			Terminal:       terminal,
			Details:        details,
		},
	}
}

func evaluationRevisionConflict(
	code model.EvaluationErrorCode,
	resourceKey string,
	resourceID string,
	expected uint64,
	actual uint64,
) error {
	return evaluationFailure(
		code,
		http.StatusConflict,
		"evaluation revision conflict",
		true,
		true,
		"reload",
		map[string]string{
			resourceKey:         resourceID,
			"expected_revision": strconv.FormatUint(expected, 10),
			"actual_revision":   strconv.FormatUint(actual, 10),
		},
		nil,
	)
}

func evaluationRecordError(resource string, resourceID string, cause error) error {
	if errors.Is(cause, gorm.ErrRecordNotFound) {
		return errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			resource+" not found",
			cause,
		)
	}
	return evaluationInternal("load "+resource+" "+resourceID, cause)
}

func evaluationInvalid(message string) error {
	return errcode.New(
		errcode.AgentInvalidRequest,
		http.StatusBadRequest,
		message,
		nil,
	)
}

func evaluationUnauthorized() error {
	return errcode.New(
		errcode.AgentUnauthorized,
		http.StatusUnauthorized,
		"authenticated actor PTID is required",
		nil,
	)
}

func evaluationInternal(message string, cause error) error {
	return errcode.New(
		errcode.AgentInternal,
		http.StatusInternalServerError,
		message,
		cause,
	)
}

func evaluationLocaleKey(code model.EvaluationErrorCode) string {
	switch code {
	case model.EvaluationErrorCode_EVALUATION_ERROR_CODE_DATASET_REVISION_CONFLICT:
		return "agent.errors.evaluationDatasetRevisionConflict"
	case model.EvaluationErrorCode_EVALUATION_ERROR_CODE_TARGET_SNAPSHOT_INVALID:
		return "agent.errors.evaluationTargetSnapshotInvalid"
	case model.EvaluationErrorCode_EVALUATION_ERROR_CODE_RUN_NOT_CANCELLABLE:
		return "agent.errors.evaluationRunNotCancellable"
	case model.EvaluationErrorCode_EVALUATION_ERROR_CODE_CASE_RETRY_CONFLICT:
		return "agent.errors.evaluationCaseRetryConflict"
	case model.EvaluationErrorCode_EVALUATION_ERROR_CODE_EVALUATOR_UNAVAILABLE:
		return "agent.errors.evaluationEvaluatorUnavailable"
	case model.EvaluationErrorCode_EVALUATION_ERROR_CODE_IDEMPOTENCY_CONFLICT:
		return "agent.errors.evaluationIdempotencyConflict"
	case model.EvaluationErrorCode_EVALUATION_ERROR_CODE_CANCEL_ACK_TIMEOUT:
		return "agent.errors.evaluationCancelAckTimeout"
	case model.EvaluationErrorCode_EVALUATION_ERROR_CODE_BENCHMARK_REVISION_CONFLICT:
		return "agent.errors.evaluationBenchmarkRevisionConflict"
	case model.EvaluationErrorCode_EVALUATION_ERROR_CODE_TEST_CASE_REVISION_CONFLICT:
		return "agent.errors.evaluationTestCaseRevisionConflict"
	case model.EvaluationErrorCode_EVALUATION_ERROR_CODE_RETENTION_CONFLICT:
		return "agent.errors.evaluationRetentionConflict"
	default:
		return "agent.errors.evaluationFailed"
	}
}

func evaluationActiveRunStatuses() []int32 {
	return []int32{
		int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_DRAFT),
		int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PENDING),
		int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING),
		int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCEL_INTENT_COMMITTED),
		int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING),
	}
}

func evaluationTerminalRunStatus(status int32) bool {
	switch model.EvaluationRunStatus(status) {
	case model.EvaluationRunStatus_EVALUATION_RUN_STATUS_COMPLETED,
		model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PARTIAL,
		model.EvaluationRunStatus_EVALUATION_RUN_STATUS_FAILED,
		model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLED:
		return true
	default:
		return false
	}
}

func evaluationTerminalAttemptStatus(status int32) bool {
	switch model.EvaluationAttemptStatus(status) {
	case model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_COMPLETED,
		model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_FAILED,
		model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_CANCELLED,
		model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_INTERRUPTED:
		return true
	default:
		return false
	}
}

func evaluationThinkingMode(value string) domain.ThinkingMode {
	mode := domain.ThinkingMode(strings.TrimSpace(value))
	if mode == "" {
		return domain.ThinkingModeAuto
	}
	return mode
}
