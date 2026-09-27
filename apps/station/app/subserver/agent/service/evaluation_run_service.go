package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

func (s *EvaluationService) CreateRun(
	ctx context.Context,
	ptid string,
	req *model.CreateEvaluationRunRequest,
) (*model.EvaluationRun, error) {
	if req == nil ||
		strings.TrimSpace(req.GetDatasetId()) == "" ||
		req.GetDatasetRevision() == 0 ||
		strings.TrimSpace(req.GetReadinessSnapshotId()) == "" ||
		strings.TrimSpace(req.GetTargetAgentId()) == "" ||
		req.GetExpectedAgentRevision() == 0 {
		return nil, evaluationInvalid(
			"dataset_id, dataset_revision, readiness_snapshot_id, target_agent_id and expected_agent_revision are required",
		)
	}
	response := &model.CreateEvaluationRunResponse{}
	err := s.executeMutation(
		ctx,
		ptid,
		evaluationCommandCreateRun,
		fmt.Sprintf(
			"dataset:%s:%d:target:%s:%d",
			req.GetDatasetId(),
			req.GetDatasetRevision(),
			req.GetTargetAgentId(),
			req.GetExpectedAgentRevision(),
		),
		req.GetIdempotencyKey(),
		req,
		response,
		func(tx *persistence.EvaluationRepository) error {
			dataset, err := tx.GetDataset(
				ctx,
				ptid,
				req.GetDatasetId(),
				false,
				true,
			)
			if err != nil {
				return evaluationRecordError("dataset", req.GetDatasetId(), err)
			}
			if dataset.Revision != req.GetDatasetRevision() {
				return evaluationRevisionConflict(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_DATASET_REVISION_CONFLICT,
					"dataset_id",
					dataset.DatasetID,
					req.GetDatasetRevision(),
					dataset.Revision,
				)
			}
			benchmark, err := tx.GetBenchmark(
				ctx,
				ptid,
				dataset.BenchmarkID,
				false,
				true,
			)
			if err != nil {
				return evaluationRecordError(
					"benchmark",
					dataset.BenchmarkID,
					err,
				)
			}
			benchmarkRubric, err := normalizeEvaluationRubric(benchmark.Rubric)
			if err != nil {
				return evaluationInvalid(err.Error())
			}
			cases, err := tx.ListTestCases(ctx, ptid, dataset.DatasetID)
			if err != nil {
				return evaluationInternal("load run test cases", err)
			}
			if len(cases) == 0 {
				return evaluationInvalid("evaluation dataset has no active test cases")
			}
			targetSnapshot, targetConfig, err := s.targetResolver(
				ctx,
				tx,
				ptid,
				req,
				true,
			)
			if err != nil {
				return err
			}
			snapshotPayload, err := proto.MarshalOptions{
				Deterministic: true,
			}.Marshal(targetSnapshot)
			if err != nil {
				return evaluationInternal("encode target runtime snapshot", err)
			}
			snapshotHash := sha256.Sum256(snapshotPayload)
			configPayload, err := json.Marshal(targetConfig)
			if err != nil {
				return evaluationInternal("encode target agent config snapshot", err)
			}
			now := s.now()
			run := &persistence.EvaluationRun{
				RunID:               evaluationID("evalrun"),
				PTID:                ptid,
				IdempotencyKey:      strings.TrimSpace(req.GetIdempotencyKey()),
				PayloadHash:         evaluationProtoHash(req),
				Revision:            1,
				CommandKind:         int32(model.EvaluationCommandKind_EVALUATION_COMMAND_KIND_CREATE_RUN),
				MutationScope:       fmt.Sprintf("dataset:%s:%d", dataset.DatasetID, dataset.Revision),
				DatasetID:           dataset.DatasetID,
				DatasetRevision:     dataset.Revision,
				TargetSnapshot:      snapshotPayload,
				TargetSnapshotHash:  hex.EncodeToString(snapshotHash[:]),
				TargetConfig:        configPayload,
				ReadinessSnapshotID: req.GetReadinessSnapshotId(),
				Status:              int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PENDING),
				TotalCases:          uint32(len(cases)),
				TargetAgentID:       req.GetTargetAgentId(),
				TargetAgentRevision: req.GetExpectedAgentRevision(),
				CreatedAt:           now,
				UpdatedAt:           now,
			}
			runCases := make([]persistence.EvaluationRunCase, 0, len(cases))
			for index := range cases {
				testCase := cases[index]
				caseRubric := benchmarkRubric
				if testCase.RubricOverride != nil {
					caseRubric, err = normalizeEvaluationRubric(
						*testCase.RubricOverride,
					)
					if err != nil {
						return evaluationInvalid(err.Error())
					}
				}
				runCases = append(runCases, persistence.EvaluationRunCase{
					RunID:          run.RunID,
					CaseID:         testCase.CaseID,
					PTID:           ptid,
					Ordinal:        uint32(index + 1),
					SourceRevision: testCase.Revision,
					Input:          testCase.Input,
					Expected:       testCase.Expected,
					RubricOverride: cloneOptionalString(testCase.RubricOverride),
					Rubric:         caseRubric.name,
					RubricVersion:  caseRubric.version,
					TagsJSON:       append([]byte(nil), testCase.TagsJSON...),
				})
			}
			if err := tx.CreateRun(ctx, run, runCases); err != nil {
				return evaluationInternal("create evaluation run", err)
			}
			if err := tx.AppendEvent(ctx, newEvaluationRunEvent(run, "", "", "", nil, now)); err != nil {
				return evaluationInternal("append run-created event", err)
			}
			response.Run, err = evaluationRunModel(run)
			return err
		},
	)
	if err == nil && response.GetRun() != nil && s.acceptance != nil {
		err = s.acceptance.BindEvaluationRun(ptid, response.GetRun().GetRunId())
	}
	return response.GetRun(), err
}

func (s *EvaluationService) StartRun(
	ctx context.Context,
	ptid string,
	req *model.StartEvaluationRunRequest,
) (*model.EvaluationRun, error) {
	if req == nil || strings.TrimSpace(req.GetRunId()) == "" ||
		req.GetExpectedRevision() == 0 {
		return nil, evaluationInvalid("run_id and expected_revision are required")
	}
	response := &model.StartEvaluationRunResponse{}
	err := s.executeMutation(
		ctx,
		ptid,
		evaluationCommandStartRun,
		"run:"+req.GetRunId(),
		req.GetIdempotencyKey(),
		req,
		response,
		func(tx *persistence.EvaluationRepository) error {
			run, err := tx.GetRun(ctx, ptid, req.GetRunId(), false, true)
			if err != nil {
				return evaluationRecordError("run", req.GetRunId(), err)
			}
			if run.Revision != req.GetExpectedRevision() {
				return evaluationRunRevisionConflict(run, req.GetExpectedRevision())
			}
			if model.EvaluationRunStatus(run.Status) !=
				model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PENDING {
				return evaluationFailure(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_EVALUATOR_UNAVAILABLE,
					http.StatusConflict,
					"evaluation run is not pending",
					false,
					true,
					"reload",
					map[string]string{
						"run_id":     run.RunID,
						"run_status": model.EvaluationRunStatus(run.Status).String(),
					},
					nil,
				)
			}
			if err := s.targetValidator(ctx, tx, run); err != nil {
				return err
			}
			now := s.now()
			updated, err := tx.UpdateRunCAS(
				ctx,
				ptid,
				run.RunID,
				run.Revision,
				[]int32{int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PENDING)},
				"cancel_intent_fence = ''",
				map[string]interface{}{
					"status":     int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING),
					"revision":   run.Revision + 1,
					"updated_at": now,
				},
			)
			if err != nil {
				return evaluationInternal("start evaluation run", err)
			}
			if !updated {
				return evaluationRunRevisionConflict(run, req.GetExpectedRevision())
			}
			run.Status = int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING)
			run.Revision++
			run.UpdatedAt = now
			if err := tx.AppendEvent(ctx, newEvaluationRunEvent(run, "", "", "", nil, now)); err != nil {
				return evaluationInternal("append run-started event", err)
			}
			response.Run, err = evaluationRunModel(run)
			return err
		},
	)
	if err == nil {
		s.signalWorker()
	}
	return response.GetRun(), err
}

func (s *EvaluationService) CancelRun(
	ctx context.Context,
	ptid string,
	req *model.CancelEvaluationRunRequest,
) (*model.EvaluationRun, error) {
	if req == nil || strings.TrimSpace(req.GetRunId()) == "" ||
		req.GetExpectedRevision() == 0 {
		return nil, evaluationInvalid("run_id and expected_revision are required")
	}
	response := &model.CancelEvaluationRunResponse{}
	if err := s.reachAcceptanceBarrier(
		ctx,
		ptid,
		req.GetRunId(),
		capabilityBarrierEvaluationCancel,
	); err != nil {
		return nil, err
	}
	err := s.executeMutation(
		ctx,
		ptid,
		evaluationCommandCancelRun,
		"run:"+req.GetRunId(),
		req.GetIdempotencyKey(),
		req,
		response,
		func(tx *persistence.EvaluationRepository) error {
			run, err := tx.GetRun(ctx, ptid, req.GetRunId(), false, true)
			if err != nil {
				return evaluationRecordError("run", req.GetRunId(), err)
			}
			if run.Revision != req.GetExpectedRevision() {
				return evaluationRunRevisionConflict(run, req.GetExpectedRevision())
			}
			status := model.EvaluationRunStatus(run.Status)
			if status != model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PENDING &&
				status != model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING {
				return evaluationFailure(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_RUN_NOT_CANCELLABLE,
					http.StatusConflict,
					"evaluation run is not cancellable",
					false,
					true,
					"reload",
					map[string]string{
						"run_id":     run.RunID,
						"run_status": status.String(),
					},
					nil,
				)
			}
			now := s.now()
			nextRevision := run.Revision + 1
			updates := map[string]interface{}{
				"revision":   nextRevision,
				"updated_at": now,
			}
			if status == model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PENDING {
				metrics := &model.EvaluationMetrics{
					TotalCases:     run.TotalCases,
					MetricsVersion: evaluationMetricsVersion,
					Comparable:     false,
				}
				metricsPayload, err := marshalEvaluationMessage(metrics)
				if err != nil {
					return evaluationInternal("encode cancelled run metrics", err)
				}
				run.Status = int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLED)
				run.TerminalFence = evaluationID("evalterminal")
				run.TerminalAt = &now
				run.MetricsPayload = metricsPayload
				updates["status"] = run.Status
				updates["terminal_fence"] = run.TerminalFence
				updates["terminal_at"] = now
				updates["metrics_payload"] = metricsPayload
			} else {
				deadline := now.Add(evaluationCancelTimeout)
				run.Status = int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING)
				run.CancelIntentFence = evaluationID("evalcancel")
				run.CancelAckDeadline = &deadline
				updates["status"] = run.Status
				updates["cancel_intent_fence"] = run.CancelIntentFence
				updates["cancel_ack_deadline"] = deadline
			}
			updated, err := tx.UpdateRunCAS(
				ctx,
				ptid,
				run.RunID,
				run.Revision,
				[]int32{int32(status)},
				"cancel_intent_fence = ''",
				updates,
			)
			if err != nil {
				return evaluationInternal("commit evaluation cancellation intent", err)
			}
			if !updated {
				return evaluationFailure(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_RUN_NOT_CANCELLABLE,
					http.StatusConflict,
					"evaluation cancellation lost its compare-and-swap",
					true,
					true,
					"reload",
					map[string]string{"run_id": run.RunID},
					nil,
				)
			}
			run.Revision = nextRevision
			run.UpdatedAt = now
			if err := tx.AppendEvent(ctx, newEvaluationRunEvent(run, "", "", "", nil, now)); err != nil {
				return evaluationInternal("append run-cancelling event", err)
			}
			response.Run, err = evaluationRunModel(run)
			return err
		},
	)
	if err == nil {
		s.signalWorker()
	}
	return response.GetRun(), err
}

func (s *EvaluationService) RetryCases(
	ctx context.Context,
	ptid string,
	req *model.RetryEvaluationCasesRequest,
) (*model.EvaluationRun, error) {
	if req == nil || strings.TrimSpace(req.GetParentRunId()) == "" ||
		len(req.GetCaseIds()) == 0 || req.GetExpectedParentRevision() == 0 {
		return nil, evaluationInvalid(
			"parent_run_id, case_ids and expected_parent_revision are required",
		)
	}
	selectedCaseIDs := sortedUniqueStrings(req.GetCaseIds())
	canonicalRequest := proto.Clone(req).(*model.RetryEvaluationCasesRequest)
	canonicalRequest.CaseIds = selectedCaseIDs
	response := &model.RetryEvaluationCasesResponse{}
	if err := s.reachAcceptanceBarrier(
		ctx,
		ptid,
		req.GetParentRunId(),
		capabilityBarrierEvaluationRetryCreate,
	); err != nil {
		return nil, err
	}
	err := s.executeMutation(
		ctx,
		ptid,
		evaluationCommandRetryCases,
		"parent-run:"+req.GetParentRunId(),
		req.GetIdempotencyKey(),
		canonicalRequest,
		response,
		func(tx *persistence.EvaluationRepository) error {
			parent, err := tx.GetRun(ctx, ptid, req.GetParentRunId(), false, true)
			if err != nil {
				return evaluationRecordError("parent run", req.GetParentRunId(), err)
			}
			if parent.Revision != req.GetExpectedParentRevision() {
				return evaluationRunRevisionConflict(
					parent,
					req.GetExpectedParentRevision(),
				)
			}
			parentStatus := model.EvaluationRunStatus(parent.Status)
			if parentStatus != model.EvaluationRunStatus_EVALUATION_RUN_STATUS_FAILED &&
				parentStatus != model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PARTIAL &&
				parentStatus != model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLED {
				return evaluationFailure(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_CASE_RETRY_CONFLICT,
					http.StatusConflict,
					"only failed, partial, or cancelled evaluation runs can be retried",
					false,
					true,
					"reload",
					map[string]string{
						"parent_run_id": parent.RunID,
						"run_status":    parentStatus.String(),
					},
					nil,
				)
			}
			runCases, err := tx.ListRunCases(ctx, parent.RunID)
			if err != nil {
				return evaluationInternal("load parent run cases", err)
			}
			attempts, err := tx.ListAttempts(ctx, parent.RunID)
			if err != nil {
				return evaluationInternal("load parent run attempts", err)
			}
			results, err := tx.ListResults(ctx, parent.RunID)
			if err != nil {
				return evaluationInternal("load parent run results", err)
			}
			caseByID := make(map[string]persistence.EvaluationRunCase, len(runCases))
			for index := range runCases {
				caseByID[runCases[index].CaseID] = runCases[index]
			}
			attemptByCase := latestEvaluationAttemptByCase(attempts)
			resultByAttempt := make(map[string]persistence.EvaluationResult, len(results))
			for index := range results {
				resultByAttempt[results[index].AttemptID] = results[index]
			}
			childCases := make([]persistence.EvaluationRunCase, 0, len(selectedCaseIDs))
			for index, caseID := range selectedCaseIDs {
				sourceCase, ok := caseByID[caseID]
				if !ok {
					return evaluationRetryConflict(
						parent.RunID,
						"",
						"selected case is not in the parent run",
					)
				}
				sourceAttempt, ok := attemptByCase[caseID]
				if !ok || !evaluationTerminalAttemptStatus(sourceAttempt.Status) {
					return evaluationRetryConflict(
						parent.RunID,
						"",
						"selected case has no terminal source attempt",
					)
				}
				sourceResult, hasResult := resultByAttempt[sourceAttempt.AttemptID]
				if model.EvaluationAttemptStatus(sourceAttempt.Status) ==
					model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_COMPLETED &&
					hasResult && sourceResult.Score >= 1 {
					return evaluationRetryConflict(
						parent.RunID,
						"",
						"selected case already passed",
					)
				}
				sourceAttemptID := sourceAttempt.AttemptID
				var sourceResultID *string
				if hasResult {
					value := sourceResult.ResultID
					sourceResultID = &value
				}
				sourceCase.RunID = ""
				sourceCase.Ordinal = uint32(index + 1)
				sourceCase.SourceAttemptID = &sourceAttemptID
				sourceCase.SourceResultID = sourceResultID
				sourceCase.SourceAttemptNo = sourceAttempt.Attempt
				childCases = append(childCases, sourceCase)
			}
			now := s.now()
			parentRunID := parent.RunID
			child := &persistence.EvaluationRun{
				RunID:               evaluationID("evalrun"),
				PTID:                ptid,
				IdempotencyKey:      strings.TrimSpace(req.GetIdempotencyKey()),
				PayloadHash:         evaluationProtoHash(canonicalRequest),
				Revision:            1,
				ParentRunID:         &parentRunID,
				CommandKind:         int32(model.EvaluationCommandKind_EVALUATION_COMMAND_KIND_RETRY_CASES),
				MutationScope:       "parent-run:" + parent.RunID,
				DatasetID:           parent.DatasetID,
				DatasetRevision:     parent.DatasetRevision,
				TargetSnapshot:      append([]byte(nil), parent.TargetSnapshot...),
				TargetSnapshotHash:  parent.TargetSnapshotHash,
				TargetConfig:        append([]byte(nil), parent.TargetConfig...),
				ReadinessSnapshotID: parent.ReadinessSnapshotID,
				Status:              int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PENDING),
				TotalCases:          uint32(len(childCases)),
				TargetAgentID:       parent.TargetAgentID,
				TargetAgentRevision: parent.TargetAgentRevision,
				CreatedAt:           now,
				UpdatedAt:           now,
			}
			for index := range childCases {
				childCases[index].RunID = child.RunID
				childCases[index].PTID = ptid
			}
			if err := tx.CreateRun(ctx, child, childCases); err != nil {
				return evaluationInternal("create retry run", err)
			}
			if err := tx.AppendEvent(ctx, newEvaluationRunEvent(child, "", "", "", nil, now)); err != nil {
				return evaluationInternal("append retry run event", err)
			}
			response.ChildRun, err = evaluationRunModel(child)
			return err
		},
	)
	if err == nil {
		if err = s.reachAcceptanceBarrier(
			ctx,
			ptid,
			req.GetParentRunId(),
			capabilityBarrierEvaluationRetryReturn,
		); err != nil {
			return nil, err
		}
		if response.GetChildRun() != nil && s.acceptance != nil {
			err = s.acceptance.BindEvaluationRun(
				ptid,
				response.GetChildRun().GetRunId(),
			)
		}
	}
	return response.GetChildRun(), err
}

func (s *EvaluationService) GetRun(
	ctx context.Context,
	ptid string,
	runID string,
) (*model.GetEvaluationRunResponse, error) {
	if strings.TrimSpace(ptid) == "" || strings.TrimSpace(runID) == "" {
		return nil, evaluationInvalid("ptid and run_id are required")
	}
	run, err := s.repository.GetRun(ctx, ptid, runID, false, false)
	if err != nil {
		return nil, evaluationRecordError("run", runID, err)
	}
	attempts, err := s.repository.ListAttempts(ctx, run.RunID)
	if err != nil {
		return nil, evaluationInternal("list run attempts", err)
	}
	results, err := s.repository.ListResults(ctx, run.RunID)
	if err != nil {
		return nil, evaluationInternal("list run results", err)
	}
	runCases, err := s.repository.ListRunCases(ctx, run.RunID)
	if err != nil {
		return nil, evaluationInternal("list run case snapshots", err)
	}
	runModel, err := evaluationRunModel(run)
	if err != nil {
		return nil, err
	}
	response := &model.GetEvaluationRunResponse{
		Run:      runModel,
		Attempts: make([]*model.EvaluationCaseAttempt, 0, len(attempts)),
		Results:  make([]*model.EvaluationResult, 0, len(results)),
		Cases:    make([]*model.EvaluationRunCaseSnapshot, 0, len(runCases)),
	}
	for index := range attempts {
		attempt, err := evaluationAttemptModel(&attempts[index])
		if err != nil {
			return nil, err
		}
		response.Attempts = append(response.Attempts, attempt)
	}
	for index := range results {
		response.Results = append(
			response.Results,
			evaluationResultModel(&results[index]),
		)
	}
	for index := range runCases {
		runCase, err := evaluationRunCaseSnapshotModel(&runCases[index])
		if err != nil {
			return nil, err
		}
		response.Cases = append(response.Cases, runCase)
	}
	return response, nil
}

func (s *EvaluationService) ListRuns(
	ctx context.Context,
	ptid string,
	req *model.ListEvaluationRunsRequest,
) (*model.ListEvaluationRunsResponse, error) {
	if strings.TrimSpace(ptid) == "" {
		return nil, evaluationUnauthorized()
	}
	if req == nil {
		req = &model.ListEvaluationRunsRequest{}
	}
	page := int(req.GetPage())
	if page < 1 {
		page = 1
	}
	pageSize := int(req.GetPageSize())
	if pageSize < 1 {
		pageSize = evaluationPageSize
	}
	if pageSize > evaluationMaxPageSize {
		pageSize = evaluationMaxPageSize
	}
	var parentRunID *string
	if req.ParentRunId != nil {
		value := strings.TrimSpace(req.GetParentRunId())
		parentRunID = &value
	}
	records, total, err := s.repository.ListRuns(
		ctx,
		ptid,
		parentRunID,
		page,
		pageSize,
	)
	if err != nil {
		return nil, evaluationInternal("list runs", err)
	}
	response := &model.ListEvaluationRunsResponse{
		Runs:  make([]*model.EvaluationRun, 0, len(records)),
		Total: uint64(total),
	}
	for index := range records {
		run, err := evaluationRunModel(&records[index])
		if err != nil {
			return nil, err
		}
		response.Runs = append(response.Runs, run)
	}
	return response, nil
}

func (s *EvaluationService) ListRunEvents(
	ctx context.Context,
	ptid string,
	req *model.ListEvaluationRunEventsRequest,
) (*model.ListEvaluationRunEventsResponse, error) {
	if req == nil || strings.TrimSpace(req.GetRunId()) == "" {
		return nil, evaluationInvalid("run_id is required")
	}
	if _, err := s.repository.GetRun(
		ctx,
		ptid,
		req.GetRunId(),
		false,
		false,
	); err != nil {
		return nil, evaluationRecordError("run", req.GetRunId(), err)
	}
	records, latest, err := s.repository.ListEvents(
		ctx,
		ptid,
		req.GetRunId(),
		req.GetAfterSequence(),
	)
	if err != nil {
		return nil, evaluationInternal("list run events", err)
	}
	response := &model.ListEvaluationRunEventsResponse{
		Events:         make([]*model.EvaluationRunEvent, 0, len(records)),
		LatestSequence: latest,
	}
	for index := range records {
		event, err := evaluationRunEventModel(&records[index])
		if err != nil {
			return nil, err
		}
		response.Events = append(response.Events, event)
	}
	return response, nil
}

func (s *EvaluationService) DeleteRun(
	ctx context.Context,
	ptid string,
	req *model.DeleteEvaluationRunRequest,
) (bool, error) {
	if req == nil || strings.TrimSpace(req.GetRunId()) == "" ||
		req.GetExpectedRevision() == 0 {
		return false, evaluationInvalid("run_id and expected_revision are required")
	}
	response := &model.DeleteEvaluationRunResponse{}
	err := s.executeMutation(
		ctx,
		ptid,
		evaluationCommandDeleteRun,
		"run:"+req.GetRunId(),
		req.GetIdempotencyKey(),
		req,
		response,
		func(tx *persistence.EvaluationRepository) error {
			run, err := tx.GetRun(ctx, ptid, req.GetRunId(), false, true)
			if err != nil {
				return evaluationRecordError("run", req.GetRunId(), err)
			}
			if run.Revision != req.GetExpectedRevision() {
				return evaluationRunRevisionConflict(run, req.GetExpectedRevision())
			}
			if !evaluationTerminalRunStatus(run.Status) {
				return evaluationFailure(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_RETENTION_CONFLICT,
					http.StatusConflict,
					"active evaluation runs cannot be deleted",
					false,
					true,
					"cancel_or_wait",
					map[string]string{"run_id": run.RunID},
					nil,
				)
			}
			children, err := tx.CountChildren(ctx, ptid, run.RunID)
			if err != nil {
				return evaluationInternal("check retry lineage retention", err)
			}
			if children > 0 {
				return evaluationFailure(
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_RETENTION_CONFLICT,
					http.StatusConflict,
					"evaluation run has retained child retry lineage",
					false,
					true,
					"delete_child_runs_first",
					map[string]string{
						"run_id":          run.RunID,
						"child_run_count": strconv.FormatInt(children, 10),
					},
					nil,
				)
			}
			now := s.now()
			updated, err := tx.UpdateRunCAS(
				ctx,
				ptid,
				run.RunID,
				run.Revision,
				[]int32{run.Status},
				"",
				map[string]interface{}{
					"deleted_at": now,
					"revision":   run.Revision + 1,
					"updated_at": now,
				},
			)
			if err != nil {
				return evaluationInternal("tombstone evaluation run", err)
			}
			if !updated {
				return evaluationRunRevisionConflict(run, req.GetExpectedRevision())
			}
			response.Deleted = true
			return nil
		},
	)
	return response.GetDeleted(), err
}

func (s *EvaluationService) resolveEvaluationTarget(
	ctx context.Context,
	repository *persistence.EvaluationRepository,
	ptid string,
	req *model.CreateEvaluationRunRequest,
	lock bool,
) (*model.RuntimeSnapshot, frozenEvaluationAgentConfig, error) {
	agent, err := repository.GetOwnedAgent(
		ctx,
		ptid,
		req.GetTargetAgentId(),
		lock,
	)
	if err != nil {
		return nil, frozenEvaluationAgentConfig{}, evaluationTargetInvalid(
			req.GetTargetAgentId(),
			"",
			"owned_agent_unavailable",
			err,
		)
	}
	if uint64(agent.Version) != req.GetExpectedAgentRevision() {
		return nil, frozenEvaluationAgentConfig{}, evaluationTargetInvalid(
			agent.ID,
			"",
			"agent_revision_conflict",
			nil,
		)
	}
	runtimeProfileID := strings.TrimSpace(req.GetRuntimeProfileId())
	if runtimeProfileID == "" {
		runtimeProfileID = modernChatAgentProfileID
	}
	if runtimeProfileID != modernChatAgentProfileID {
		return nil, frozenEvaluationAgentConfig{}, evaluationTargetInvalid(
			agent.ID,
			"",
			"runtime_profile_unsupported",
			nil,
		)
	}
	providerID := strings.TrimSpace(agent.ProviderID)
	modelID := strings.TrimSpace(req.GetModelId())
	if modelID == "" {
		modelID = strings.TrimSpace(agent.ModelName)
	}
	if providerID == "" || modelID == "" || s.admission == nil {
		return nil, frozenEvaluationAgentConfig{}, evaluationTargetInvalid(
			agent.ID,
			"",
			"runtime_configuration_unavailable",
			nil,
		)
	}
	admission, err := s.admission.Resolve(ctx, ptid, providerID, modelID)
	if err != nil {
		return nil, frozenEvaluationAgentConfig{}, evaluationTargetInvalid(
			agent.ID,
			"",
			"runtime_admission_rejected",
			err,
		)
	}
	if admission.Capabilities == nil {
		return nil, frozenEvaluationAgentConfig{}, evaluationTargetInvalid(
			agent.ID,
			admission.SnapshotID,
			"runtime_capabilities_missing",
			nil,
		)
	}
	if err := validateRuntimeCapabilityProvenance(admission.Capabilities, s.now()); err != nil {
		return nil, frozenEvaluationAgentConfig{}, evaluationTargetInvalid(
			agent.ID,
			admission.SnapshotID,
			"runtime_capability_provenance_invalid",
			err,
		)
	}
	readiness, err := repository.GetReadinessSnapshot(
		ctx,
		ptid,
		agent.ID,
		req.GetReadinessSnapshotId(),
		lock,
	)
	if err != nil {
		return nil, frozenEvaluationAgentConfig{}, evaluationTargetInvalid(
			agent.ID,
			req.GetReadinessSnapshotId(),
			"readiness_snapshot_unavailable",
			err,
		)
	}
	if err := validateEvaluationReadiness(
		readiness,
		ptid,
		agent.ID,
		uint64(agent.Version),
		admission,
		s.now(),
	); err != nil {
		return nil, frozenEvaluationAgentConfig{}, err
	}
	thinkingMode, err := normalizeThinkingMode(
		evaluationThinkingMode(agent.ThinkingMode),
	)
	if err != nil {
		return nil, frozenEvaluationAgentConfig{}, evaluationTargetInvalid(
			agent.ID,
			admission.SnapshotID,
			"thinking_mode_invalid",
			err,
		)
	}
	snapshot := newDirectRuntimeSnapshot(
		admission,
		strconv.FormatInt(agent.Version, 10),
		thinkingMode,
	)
	snapshot.RuntimeProfileId = runtimeProfileID
	identity, agentPrompt := frozenEvaluationPrompts(agent.ConfigJSON)
	return snapshot, frozenEvaluationAgentConfig{
		Identity:          identity,
		AgentConfigPrompt: agentPrompt,
		Effort:            strings.TrimSpace(agent.Effort),
		ThinkingMode:      string(thinkingMode),
		ProviderID:        providerID,
		ModelID:           modelID,
	}, nil
}

func (s *EvaluationService) validateFrozenEvaluationTarget(
	ctx context.Context,
	repository *persistence.EvaluationRepository,
	run *persistence.EvaluationRun,
) error {
	if run == nil {
		return evaluationTargetInvalid("", "", "run_snapshot_missing", nil)
	}
	if s.acceptance != nil &&
		s.acceptance.EvaluationTargetInvalid(run.PTID, run.RunID) {
		return evaluationTargetInvalid(
			run.TargetAgentID,
			run.ReadinessSnapshotID,
			"acceptance_target_snapshot_invalid",
			nil,
		)
	}
	agent, err := repository.GetOwnedAgent(
		ctx,
		run.PTID,
		run.TargetAgentID,
		true,
	)
	if err != nil || uint64(agent.Version) != run.TargetAgentRevision {
		return evaluationTargetInvalid(
			run.TargetAgentID,
			run.ReadinessSnapshotID,
			"agent_revision_conflict",
			err,
		)
	}
	snapshot, err := decodeEvaluationRuntimeSnapshot(run)
	if err != nil {
		return err
	}
	if s.admission == nil {
		return evaluationTargetInvalid(
			run.TargetAgentID,
			run.ReadinessSnapshotID,
			"runtime_admission_unavailable",
			nil,
		)
	}
	current, err := s.admission.Resolve(
		ctx,
		run.PTID,
		snapshot.GetProviderId(),
		snapshot.GetModelId(),
	)
	if err != nil {
		return evaluationTargetInvalid(
			run.TargetAgentID,
			run.ReadinessSnapshotID,
			"runtime_admission_rejected",
			err,
		)
	}
	currentHash, err := runtimeCapabilitySemanticHash(current.Capabilities)
	if err != nil {
		return evaluationInternal("hash current evaluation runtime capabilities", err)
	}
	frozenHash, err := runtimeCapabilitySemanticHash(snapshot.GetCapabilities())
	if err != nil {
		return evaluationInternal("hash frozen evaluation runtime capabilities", err)
	}
	if current.ProviderID != snapshot.GetProviderId() ||
		current.ModelID != snapshot.GetModelId() ||
		current.ProviderConfigVersion != snapshot.GetProviderConfigVersion() ||
		currentHash != frozenHash {
		return evaluationTargetInvalid(
			run.TargetAgentID,
			run.ReadinessSnapshotID,
			"runtime_snapshot_stale",
			nil,
		)
	}
	readiness, err := repository.GetReadinessSnapshot(
		ctx,
		run.PTID,
		run.TargetAgentID,
		run.ReadinessSnapshotID,
		true,
	)
	if err != nil {
		return evaluationTargetInvalid(
			run.TargetAgentID,
			run.ReadinessSnapshotID,
			"readiness_snapshot_unavailable",
			err,
		)
	}
	return validateEvaluationReadiness(
		readiness,
		run.PTID,
		run.TargetAgentID,
		run.TargetAgentRevision,
		current,
		s.now(),
	)
}

func validateEvaluationReadiness(
	record *persistence.CapabilityReadinessSnapshot,
	ptid string,
	agentID string,
	agentRevision uint64,
	admission *AdmissionSnapshot,
	now time.Time,
) error {
	if record == nil || admission == nil {
		return evaluationTargetInvalid(
			agentID,
			"",
			"readiness_snapshot_missing",
			nil,
		)
	}
	if !record.ExpiresAt.After(now) {
		return evaluationTargetInvalid(
			agentID,
			record.SnapshotID,
			"readiness_snapshot_expired",
			nil,
		)
	}
	sum := sha256.Sum256(record.Payload)
	if record.PayloadHash != hex.EncodeToString(sum[:]) {
		return evaluationTargetInvalid(
			agentID,
			record.SnapshotID,
			"readiness_snapshot_integrity_failed",
			nil,
		)
	}
	snapshot := &model.CapabilityReadinessSnapshot{}
	if err := proto.Unmarshal(record.Payload, snapshot); err != nil {
		return evaluationTargetInvalid(
			agentID,
			record.SnapshotID,
			"readiness_snapshot_decode_failed",
			err,
		)
	}
	expectedAgentRevision := fmt.Sprintf("agent:%s:%d", agentID, agentRevision)
	if snapshot.GetSnapshotId() != record.SnapshotID ||
		snapshot.GetPtid() != ptid ||
		snapshot.GetAgentId() != agentID ||
		snapshot.GetRuntimeSnapshotId() != admission.SnapshotID ||
		!containsString(snapshot.GetBindingRevisions(), expectedAgentRevision) {
		return evaluationTargetInvalid(
			agentID,
			record.SnapshotID,
			"readiness_snapshot_mismatch",
			nil,
		)
	}
	readinessHash, err := runtimeCapabilitySemanticHash(
		snapshot.GetModelCapabilities(),
	)
	if err != nil {
		return evaluationInternal("hash readiness runtime capabilities", err)
	}
	admissionHash, err := runtimeCapabilitySemanticHash(admission.Capabilities)
	if err != nil {
		return evaluationInternal("hash admitted runtime capabilities", err)
	}
	if readinessHash != admissionHash {
		return evaluationTargetInvalid(
			agentID,
			record.SnapshotID,
			"readiness_capabilities_mismatch",
			nil,
		)
	}
	for _, capability := range snapshot.GetCapabilities() {
		switch capability.GetState() {
		case model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
			model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNKNOWN,
			model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNSPECIFIED:
			return evaluationTargetInvalid(
				agentID,
				record.SnapshotID,
				"readiness_unresolved:"+capability.GetReasonCode(),
				nil,
			)
		}
	}
	return nil
}

func frozenEvaluationPrompts(configJSON string) (string, string) {
	var config map[string]interface{}
	if json.Unmarshal([]byte(configJSON), &config) != nil {
		return "", ""
	}
	read := func(keys ...string) string {
		for _, key := range keys {
			if value, ok := config[key].(string); ok &&
				strings.TrimSpace(value) != "" {
				return value
			}
		}
		return ""
	}
	return read(
			"identity",
			"soulMd",
			"soul_md",
			"soul",
			"systemPrompt",
			"system_prompt",
		), read(
			"agentConfigPrompt",
			"agent_config_prompt",
			"agentsMd",
			"agents_md",
			"agents",
		)
}

func evaluationRunModel(
	record *persistence.EvaluationRun,
) (*model.EvaluationRun, error) {
	if record == nil {
		return nil, nil
	}
	snapshot, err := decodeEvaluationRuntimeSnapshot(record)
	if err != nil {
		return nil, err
	}
	var metrics *model.EvaluationMetrics
	if len(record.MetricsPayload) > 0 {
		metrics = &model.EvaluationMetrics{}
		if err := proto.Unmarshal(record.MetricsPayload, metrics); err != nil {
			return nil, evaluationInternal("decode evaluation metrics", err)
		}
	}
	evaluationError, err := decodeEvaluationError(record.ErrorPayload)
	if err != nil {
		return nil, err
	}
	return &model.EvaluationRun{
		RunId:               record.RunID,
		Ptid:                record.PTID,
		IdempotencyKey:      record.IdempotencyKey,
		PayloadHash:         record.PayloadHash,
		Revision:            record.Revision,
		ParentRunId:         cloneOptionalString(record.ParentRunID),
		CommandKind:         model.EvaluationCommandKind(record.CommandKind),
		MutationScope:       record.MutationScope,
		CancelIntentFence:   record.CancelIntentFence,
		CancelAckDeadline:   evaluationTimestamp(record.CancelAckDeadline),
		TerminalFence:       record.TerminalFence,
		DatasetId:           record.DatasetID,
		DatasetRevision:     record.DatasetRevision,
		TargetAgentSnapshot: snapshot,
		ReadinessSnapshotId: record.ReadinessSnapshotID,
		Status:              model.EvaluationRunStatus(record.Status),
		CompletedCases:      record.CompletedCases,
		TotalCases:          record.TotalCases,
		Metrics:             metrics,
		CreatedAt:           timestamppb.New(record.CreatedAt),
		TerminalAt:          evaluationTimestamp(record.TerminalAt),
		Error:               evaluationError,
		TargetAgentId:       record.TargetAgentID,
		TargetAgentRevision: record.TargetAgentRevision,
		UpdatedAt:           timestamppb.New(record.UpdatedAt),
		DeletedAt:           evaluationTimestamp(record.DeletedAt),
	}, nil
}

func evaluationAttemptModel(
	record *persistence.EvaluationCaseAttempt,
) (*model.EvaluationCaseAttempt, error) {
	if record == nil {
		return nil, nil
	}
	evaluationError, err := decodeEvaluationError(record.ErrorPayload)
	if err != nil {
		return nil, err
	}
	return &model.EvaluationCaseAttempt{
		AttemptId:         record.AttemptID,
		RunId:             record.RunID,
		CaseId:            record.CaseID,
		Attempt:           record.Attempt,
		IdempotencyKey:    record.IdempotencyKey,
		SourceAttemptId:   cloneOptionalString(record.SourceAttemptID),
		SourceResultId:    cloneOptionalString(record.SourceResultID),
		TurnId:            stringValue(record.TurnID),
		Status:            model.EvaluationAttemptStatus(record.Status),
		OutputRef:         record.OutputRef,
		Score:             cloneOptionalFloat64(record.Score),
		Error:             evaluationError,
		CancellationAckAt: evaluationTimestamp(record.CancellationAckAt),
		TerminalAt:        evaluationTimestamp(record.TerminalAt),
		StartedAt:         evaluationTimestamp(record.StartedAt),
		SchedulerClaim:    stringValue(record.SchedulerClaim),
	}, nil
}

func evaluationRunCaseSnapshotModel(
	record *persistence.EvaluationRunCase,
) (*model.EvaluationRunCaseSnapshot, error) {
	if record == nil {
		return nil, nil
	}
	var tags []string
	if len(record.TagsJSON) > 0 {
		if err := json.Unmarshal(record.TagsJSON, &tags); err != nil {
			return nil, evaluationInternal(
				"decode evaluation run case snapshot tags",
				err,
			)
		}
	}
	return &model.EvaluationRunCaseSnapshot{
		CaseId:         record.CaseID,
		Input:          record.Input,
		Expected:       record.Expected,
		Rubric:         record.Rubric,
		RubricVersion:  record.RubricVersion,
		Tags:           tags,
		SourceRevision: record.SourceRevision,
	}, nil
}

func evaluationResultModel(
	record *persistence.EvaluationResult,
) *model.EvaluationResult {
	if record == nil {
		return nil
	}
	return &model.EvaluationResult{
		ResultId:       record.ResultID,
		RunId:          record.RunID,
		CaseId:         record.CaseID,
		AttemptId:      record.AttemptID,
		OutputRef:      record.OutputRef,
		Score:          record.Score,
		RubricVersion:  record.RubricVersion,
		TerminalStatus: model.EvaluationAttemptStatus(record.TerminalStatus),
		CreatedAt:      timestamppb.New(record.CreatedAt),
		Output:         record.Output,
		LatencyMs:      record.LatencyMS,
		TurnTraceId:    record.TurnTraceID,
	}
}

func evaluationRunEventModel(
	record *persistence.EvaluationRunEvent,
) (*model.EvaluationRunEvent, error) {
	if record == nil {
		return nil, nil
	}
	evaluationError, err := decodeEvaluationError(record.ErrorPayload)
	if err != nil {
		return nil, err
	}
	return &model.EvaluationRunEvent{
		RunId:          record.RunID,
		Sequence:       record.Sequence,
		Status:         model.EvaluationRunStatus(record.Status),
		CompletedCases: record.CompletedCases,
		TotalCases:     record.TotalCases,
		CaseId:         record.CaseID,
		AttemptId:      record.AttemptID,
		Error:          evaluationError,
		OccurredAt:     timestamppb.New(record.OccurredAt),
		ResultId:       record.ResultID,
	}, nil
}

func decodeEvaluationRuntimeSnapshot(
	record *persistence.EvaluationRun,
) (*model.RuntimeSnapshot, error) {
	if record == nil || len(record.TargetSnapshot) == 0 {
		return nil, evaluationTargetInvalid(
			"",
			"",
			"target_snapshot_missing",
			nil,
		)
	}
	sum := sha256.Sum256(record.TargetSnapshot)
	if record.TargetSnapshotHash != hex.EncodeToString(sum[:]) {
		return nil, evaluationTargetInvalid(
			record.TargetAgentID,
			record.ReadinessSnapshotID,
			"target_snapshot_integrity_failed",
			nil,
		)
	}
	snapshot := &model.RuntimeSnapshot{}
	if err := proto.Unmarshal(record.TargetSnapshot, snapshot); err != nil {
		return nil, evaluationTargetInvalid(
			record.TargetAgentID,
			record.ReadinessSnapshotID,
			"target_snapshot_decode_failed",
			err,
		)
	}
	return snapshot, nil
}

func decodeEvaluationError(payload []byte) (*model.EvaluationError, error) {
	if len(payload) == 0 {
		return nil, nil
	}
	detail := &model.EvaluationError{}
	if err := proto.Unmarshal(payload, detail); err != nil {
		return nil, evaluationInternal("decode evaluation error", err)
	}
	return detail, nil
}

func marshalEvaluationMessage(message proto.Message) ([]byte, error) {
	if message == nil {
		return nil, nil
	}
	return proto.MarshalOptions{Deterministic: true}.Marshal(message)
}

func newEvaluationRunEvent(
	run *persistence.EvaluationRun,
	caseID string,
	attemptID string,
	resultID string,
	evaluationError *model.EvaluationError,
	now time.Time,
) *persistence.EvaluationRunEvent {
	errorPayload, _ := marshalEvaluationMessage(evaluationError)
	return &persistence.EvaluationRunEvent{
		EventID:        evaluationID("evalevt"),
		RunID:          run.RunID,
		PTID:           run.PTID,
		Status:         run.Status,
		CompletedCases: run.CompletedCases,
		TotalCases:     run.TotalCases,
		CaseID:         caseID,
		AttemptID:      attemptID,
		ErrorPayload:   errorPayload,
		ResultID:       resultID,
		OccurredAt:     now,
	}
}

func evaluationTargetInvalid(
	agentID string,
	snapshotID string,
	reasonCode string,
	cause error,
) error {
	return evaluationFailure(
		model.EvaluationErrorCode_EVALUATION_ERROR_CODE_TARGET_SNAPSHOT_INVALID,
		http.StatusConflict,
		"evaluation target snapshot is invalid",
		true,
		true,
		"refresh_target_snapshot",
		map[string]string{
			"agent_id":    strings.TrimSpace(agentID),
			"snapshot_id": strings.TrimSpace(snapshotID),
			"reason_code": reasonCode,
		},
		cause,
	)
}

func evaluationRunRevisionConflict(
	run *persistence.EvaluationRun,
	expected uint64,
) error {
	actual := uint64(0)
	runID := ""
	if run != nil {
		actual = run.Revision
		runID = run.RunID
	}
	return errcode.NewVersionConflict(
		"evaluation_run",
		runID,
		expected,
		actual,
	)
}

func evaluationRetryConflict(
	parentRunID string,
	existingChildRunID string,
	reason string,
) error {
	return evaluationFailure(
		model.EvaluationErrorCode_EVALUATION_ERROR_CODE_CASE_RETRY_CONFLICT,
		http.StatusConflict,
		"evaluation case retry conflict",
		false,
		true,
		"reload",
		map[string]string{
			"parent_run_id":         parentRunID,
			"existing_child_run_id": existingChildRunID,
			"reason_code":           reason,
		},
		nil,
	)
}

func evaluationProtoHash(message proto.Message) string {
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func cloneOptionalFloat64(value *float64) *float64 {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func latestEvaluationAttemptByCase(
	attempts []persistence.EvaluationCaseAttempt,
) map[string]persistence.EvaluationCaseAttempt {
	result := make(map[string]persistence.EvaluationCaseAttempt)
	for index := range attempts {
		attempt := attempts[index]
		current, exists := result[attempt.CaseID]
		if !exists || attempt.Attempt > current.Attempt {
			result[attempt.CaseID] = attempt
		}
	}
	return result
}

func (s *EvaluationService) signalWorker() {
	if s == nil || s.wake == nil {
		return
	}
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func isEvaluationNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}

var _ = errcode.AgentInternal
