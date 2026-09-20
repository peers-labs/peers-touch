package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestEvaluationServiceCreateBenchmark(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-benchmark")
	service := NewEvaluationService(db, nil, nil)
	service.now = func() time.Time {
		return time.Date(2026, 9, 17, 9, 0, 0, 0, time.UTC)
	}
	ctx := context.Background()
	request := &model.CreateEvaluationBenchmarkRequest{
		Name:           "Exact output",
		Rubric:         "exact_match",
		IdempotencyKey: "benchmark-key",
	}

	created, err := service.CreateBenchmark(ctx, "ptid:actor-1", request)
	if err != nil {
		t.Fatalf("create benchmark: %v", err)
	}
	replayed, err := service.CreateBenchmark(ctx, "ptid:actor-1", request)
	if err != nil {
		t.Fatalf("replay benchmark creation: %v", err)
	}
	if replayed.GetBenchmarkId() != created.GetBenchmarkId() {
		t.Fatalf(
			"replayed benchmark ID = %q, want %q",
			replayed.GetBenchmarkId(),
			created.GetBenchmarkId(),
		)
	}

	_, err = service.CreateBenchmark(
		ctx,
		"ptid:actor-1",
		&model.CreateEvaluationBenchmarkRequest{
			Name:           "Different",
			Rubric:         "exact_match",
			IdempotencyKey: request.GetIdempotencyKey(),
		},
	)
	var failure *EvaluationFailure
	if !errors.As(err, &failure) ||
		failure.Detail.GetCode() !=
			model.EvaluationErrorCode_EVALUATION_ERROR_CODE_IDEMPOTENCY_CONFLICT {
		t.Fatalf("expected idempotency conflict, got %v", err)
	}

	otherActor, err := service.CreateBenchmark(
		ctx,
		"ptid:actor-2",
		request,
	)
	if err != nil {
		t.Fatalf("reuse actor-scoped key for another actor: %v", err)
	}
	if otherActor.GetBenchmarkId() == created.GetBenchmarkId() {
		t.Fatal("different actors received the same benchmark")
	}

	containsBenchmark, err := service.CreateBenchmark(
		ctx,
		"ptid:actor-1",
		&model.CreateEvaluationBenchmarkRequest{
			Name:           "Contains output",
			Rubric:         legacyEvaluationContainsRubric,
			IdempotencyKey: "benchmark-contains-key",
		},
	)
	if err != nil {
		t.Fatalf("create current-data contains benchmark: %v", err)
	}
	if containsBenchmark.GetRubric() != evaluationRubricCaseInsensitiveContains {
		t.Fatalf(
			"contains rubric = %q, want %q",
			containsBenchmark.GetRubric(),
			evaluationRubricCaseInsensitiveContains,
		)
	}

	_, err = service.CreateBenchmark(
		ctx,
		"ptid:actor-1",
		&model.CreateEvaluationBenchmarkRequest{
			Name:           "Unsupported",
			Rubric:         "semantic_similarity",
			IdempotencyKey: "benchmark-unsupported-create",
		},
	)
	if !isAgentServiceError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("unsupported create rubric error = %v", err)
	}
	_, err = service.UpdateBenchmark(
		ctx,
		"ptid:actor-1",
		&model.UpdateEvaluationBenchmarkRequest{
			BenchmarkId:      created.GetBenchmarkId(),
			Name:             created.GetName(),
			Rubric:           "semantic_similarity",
			ExpectedRevision: created.GetRevision(),
			IdempotencyKey:   "benchmark-unsupported-update",
		},
	)
	if !isAgentServiceError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("unsupported update rubric error = %v", err)
	}
}

func TestEvaluationServiceRejectsUnsupportedCaseRubrics(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-case-rubric-validation")
	service := NewEvaluationService(db, nil, nil)
	now := time.Date(2026, 9, 17, 9, 5, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	seedEvaluationDatasetAndCases(
		t,
		db,
		"ptid:actor-1",
		"dataset-rubric",
		1,
		now,
		0,
	)
	unsupported := "semantic_similarity"
	_, _, err := service.CreateTestCase(
		context.Background(),
		"ptid:actor-1",
		&model.CreateEvaluationTestCaseRequest{
			DatasetId:               "dataset-rubric",
			Input:                   "question",
			Expected:                "answer",
			RubricOverride:          &unsupported,
			ExpectedDatasetRevision: 1,
			IdempotencyKey:          "case-unsupported-create",
		},
	)
	if !isAgentServiceError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("unsupported case create rubric error = %v", err)
	}

	contains := "case-insensitive contains"
	created, dataset, err := service.CreateTestCase(
		context.Background(),
		"ptid:actor-1",
		&model.CreateEvaluationTestCaseRequest{
			DatasetId:               "dataset-rubric",
			Input:                   "question",
			Expected:                "answer",
			RubricOverride:          &contains,
			ExpectedDatasetRevision: 1,
			IdempotencyKey:          "case-supported-create",
		},
	)
	if err != nil {
		t.Fatalf("create case with contains rubric: %v", err)
	}
	if created.GetRubricOverride() != evaluationRubricCaseInsensitiveContains {
		t.Fatalf("canonical case rubric = %q", created.GetRubricOverride())
	}
	if dataset.GetRevision() != 2 {
		t.Fatalf("authoritative dataset revision = %d, want 2", dataset.GetRevision())
	}

	_, _, err = service.UpdateTestCase(
		context.Background(),
		"ptid:actor-1",
		&model.UpdateEvaluationTestCaseRequest{
			CaseId:           created.GetCaseId(),
			Input:            created.GetInput(),
			Expected:         created.GetExpected(),
			RubricOverride:   &unsupported,
			ExpectedRevision: created.GetRevision(),
			IdempotencyKey:   "case-unsupported-update",
		},
	)
	if !isAgentServiceError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("unsupported case update rubric error = %v", err)
	}
}

func TestEvaluateEvaluationRubric(t *testing.T) {
	tests := []struct {
		name        string
		rubric      string
		output      string
		expected    string
		wantScore   float64
		wantVersion string
		wantError   bool
	}{
		{
			name:        "exact match",
			rubric:      evaluationRubricExactMatch,
			output:      "answer",
			expected:    "answer",
			wantScore:   1,
			wantVersion: evaluationRubricExactMatchVersion,
		},
		{
			name:        "exact mismatch",
			rubric:      evaluationRubricExactMatch,
			output:      "the answer",
			expected:    "answer",
			wantScore:   0,
			wantVersion: evaluationRubricExactMatchVersion,
		},
		{
			name:        "case insensitive contains",
			rubric:      evaluationRubricCaseInsensitiveContains,
			output:      "The ANSWER is present.",
			expected:    "answer",
			wantScore:   1,
			wantVersion: evaluationRubricCaseInsensitiveContainsVersion,
		},
		{
			name:      "unsupported",
			rubric:    "semantic_similarity",
			output:    "answer",
			expected:  "answer",
			wantError: true,
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			score, version, err := evaluateEvaluationRubric(
				test.rubric,
				test.output,
				test.expected,
			)
			if test.wantError {
				if err == nil {
					t.Fatal("unsupported rubric was accepted")
				}
				return
			}
			if err != nil {
				t.Fatalf("evaluate rubric: %v", err)
			}
			if score != test.wantScore || version != test.wantVersion {
				t.Fatalf(
					"score/version = %v/%q, want %v/%q",
					score,
					version,
					test.wantScore,
					test.wantVersion,
				)
			}
		})
	}
}

func TestEvaluationServiceCreateRun(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-create-run")
	service := NewEvaluationService(db, nil, nil)
	now := time.Date(2026, 9, 17, 9, 15, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	seedEvaluationDatasetAndCases(t, db, "ptid:actor-1", "dataset-1", 3, now, 2)
	if err := db.Model(&persistence.EvaluationTestCase{}).
		Where("case_id = ?", "case-2").
		Update(
			"rubric_override",
			evaluationRubricCaseInsensitiveContains,
		).Error; err != nil {
		t.Fatalf("seed case rubric override: %v", err)
	}
	service.targetResolver = func(
		_ context.Context,
		_ *persistence.EvaluationRepository,
		ptid string,
		req *model.CreateEvaluationRunRequest,
		_ bool,
	) (*model.RuntimeSnapshot, frozenEvaluationAgentConfig, error) {
		if ptid != "ptid:actor-1" ||
			req.GetTargetAgentId() != "agent-1" ||
			req.GetExpectedAgentRevision() != 7 {
			t.Fatalf("unexpected target resolution input: ptid=%q request=%+v", ptid, req)
		}
		return &model.RuntimeSnapshot{
				RuntimeKind:           model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
				ProviderId:            "provider-server",
				ModelId:               "model-server",
				RuntimeProfileId:      modernChatAgentProfileID,
				ProviderConfigVersion: "provider-version-4",
				AgentConfigVersion:    "7",
				ThinkingMode:          string(domain.ThinkingModeAuto),
				Capabilities:          &model.RuntimeCapabilitySnapshot{SnapshotId: "runtime-server"},
				Budget:                &model.RuntimeBudget{MaxAttempts: 2},
			}, frozenEvaluationAgentConfig{
				ProviderID:   "provider-server",
				ModelID:      "model-server",
				ThinkingMode: string(domain.ThinkingModeAuto),
			}, nil
	}
	request := &model.CreateEvaluationRunRequest{
		DatasetId:             "dataset-1",
		DatasetRevision:       3,
		ReadinessSnapshotId:   "readiness-server",
		IdempotencyKey:        "create-run-key",
		TargetAgentId:         "agent-1",
		ExpectedAgentRevision: 7,
	}

	created, err := service.CreateRun(context.Background(), "ptid:actor-1", request)
	if err != nil {
		t.Fatalf("create evaluation run: %v", err)
	}
	if created.GetTargetAgentSnapshot().GetProviderId() != "provider-server" ||
		created.GetTargetAgentSnapshot().GetModelId() != "model-server" ||
		created.GetTargetAgentRevision() != 7 {
		t.Fatalf("run did not carry server-authored target snapshot: %+v", created)
	}
	replayed, err := service.CreateRun(context.Background(), "ptid:actor-1", request)
	if err != nil {
		t.Fatalf("replay evaluation run creation: %v", err)
	}
	if replayed.GetRunId() != created.GetRunId() ||
		!proto.Equal(replayed.GetTargetAgentSnapshot(), created.GetTargetAgentSnapshot()) {
		t.Fatalf("run replay changed authoritative result: created=%+v replayed=%+v", created, replayed)
	}
	var runCases []persistence.EvaluationRunCase
	if err := db.
		Where("run_id = ?", created.GetRunId()).
		Order("case_id ASC").
		Find(&runCases).Error; err != nil {
		t.Fatalf("load frozen run cases: %v", err)
	}
	if len(runCases) != 2 {
		t.Fatalf("frozen run case count = %d, want 2", len(runCases))
	}
	if runCases[0].Rubric != evaluationRubricExactMatch ||
		runCases[0].RubricVersion != evaluationRubricExactMatchVersion ||
		runCases[1].Rubric != evaluationRubricCaseInsensitiveContains ||
		runCases[1].RubricVersion !=
			evaluationRubricCaseInsensitiveContainsVersion {
		t.Fatalf("run cases did not freeze effective rubrics: %+v", runCases)
	}
	readback, err := service.GetRun(
		context.Background(),
		"ptid:actor-1",
		created.GetRunId(),
	)
	if err != nil {
		t.Fatalf("read evaluation run: %v", err)
	}
	if len(readback.GetCases()) != 2 ||
		readback.GetCases()[0].GetInput() != runCases[0].Input ||
		readback.GetCases()[0].GetSourceRevision() != runCases[0].SourceRevision ||
		readback.GetCases()[1].GetRubricVersion() !=
			evaluationRubricCaseInsensitiveContainsVersion {
		t.Fatalf("run readback lost frozen case snapshots: %+v", readback.GetCases())
	}
}

func TestEvaluationServiceCancelRun(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-cancel-run")
	kernel := &recordingEvaluationTurnKernel{
		readbacks: map[string]*EvaluationTurnReadback{
			"turn-cancel-command": {
				TurnID:    "turn-cancel-command",
				Status:    domain.TurnStatusRunning,
				StartedAt: time.Date(2026, 9, 17, 9, 19, 0, 0, time.UTC),
			},
		},
	}
	service := NewEvaluationService(db, nil, kernel)
	now := time.Date(2026, 9, 17, 9, 20, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	run := seedEvaluationRun(t, db, "run-cancel-command", 1, model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING, now)
	if err := db.Create(&persistence.EvaluationRunCase{
		RunID:          run.RunID,
		CaseID:         "case-cancel-command",
		PTID:           run.PTID,
		Ordinal:        1,
		SourceRevision: 1,
		Input:          "question",
		Expected:       "answer",
		Rubric:         evaluationRubricExactMatch,
		RubricVersion:  evaluationRubricExactMatchVersion,
		TagsJSON:       []byte(`[]`),
	}).Error; err != nil {
		t.Fatalf("seed cancellation run case: %v", err)
	}
	if err := db.Create(&persistence.EvaluationCaseAttempt{
		AttemptID:      "attempt-cancel-command",
		RunID:          run.RunID,
		CaseID:         "case-cancel-command",
		Attempt:        1,
		PTID:           run.PTID,
		IdempotencyKey: "attempt-cancel-command-key",
		TurnID:         stringPointer("turn-cancel-command"),
		Status:         int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING),
		StartedAt:      &now,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed cancellation attempt: %v", err)
	}
	kernel.onInterrupt = func(turnID string) {
		if turnID != "turn-cancel-command" {
			t.Fatalf("interrupted Turn = %q", turnID)
		}
		var attempt persistence.EvaluationCaseAttempt
		if err := db.First(
			&attempt,
			"attempt_id = ?",
			"attempt-cancel-command",
		).Error; err != nil {
			t.Fatalf("load attempt before Turn fence: %v", err)
		}
		if model.EvaluationAttemptStatus(attempt.Status) !=
			model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING {
			t.Fatalf(
				"Evaluation attempt settled before canonical Turn fence: %+v",
				attempt,
			)
		}
	}
	request := &model.CancelEvaluationRunRequest{
		RunId:            run.RunID,
		ExpectedRevision: run.Revision,
		IdempotencyKey:   "cancel-run-key",
	}

	cancelled, err := service.CancelRun(context.Background(), run.PTID, request)
	if err != nil {
		t.Fatalf("cancel running evaluation: %v", err)
	}
	if cancelled.GetStatus() != model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING {
		t.Fatalf("cancel status = %v, want cancelling", cancelled.GetStatus())
	}
	wantDeadline := now.Add(evaluationCancelTimeout)
	if cancelled.GetCancelAckDeadline() == nil ||
		!cancelled.GetCancelAckDeadline().AsTime().Equal(wantDeadline) {
		t.Fatalf(
			"cancel deadline = %v, want %v",
			cancelled.GetCancelAckDeadline(),
			wantDeadline,
		)
	}
	replayed, err := service.CancelRun(context.Background(), run.PTID, request)
	if err != nil {
		t.Fatalf("replay run cancellation: %v", err)
	}
	if replayed.GetCancelIntentFence() != cancelled.GetCancelIntentFence() ||
		!replayed.GetCancelAckDeadline().AsTime().Equal(wantDeadline) {
		t.Fatalf("cancellation replay changed fence/deadline: %+v", replayed)
	}

	service.now = func() time.Time { return wantDeadline }
	if err := service.ReconcileEvaluationRuns(context.Background()); err != nil {
		t.Fatalf("reconcile cancellation deadline: %v", err)
	}
	readback, err := service.GetRun(context.Background(), run.PTID, run.RunID)
	if err != nil {
		t.Fatalf("read cancelled run: %v", err)
	}
	if readback.GetRun().GetStatus() !=
		model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PARTIAL ||
		readback.GetRun().GetError().GetCode() !=
			model.EvaluationErrorCode_EVALUATION_ERROR_CODE_CANCEL_ACK_TIMEOUT {
		t.Fatalf("unexpected cancellation timeout state: %+v", readback.GetRun())
	}
	if len(readback.GetResults()) != 1 ||
		readback.GetAttempts()[0].GetCancellationAckAt() != nil {
		t.Fatalf("unexpected timeout attempt/result readback: %+v", readback)
	}
	if kernel.cancelCount != 1 {
		t.Fatalf("canonical Turn cancel count = %d, want 1", kernel.cancelCount)
	}
	if kernel.interruptCount != 1 {
		t.Fatalf(
			"canonical Turn interrupt count = %d, want 1",
			kernel.interruptCount,
		)
	}
}

func TestEvaluationCancellationDeadlineDoesNotSettleBeforeTurnFence(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-cancel-fence-failure")
	now := time.Date(2026, 9, 17, 9, 21, 0, 0, time.UTC)
	kernel := &recordingEvaluationTurnKernel{
		interruptErr: errors.New("durable Turn fence unavailable"),
		readbacks: map[string]*EvaluationTurnReadback{
			"turn-cancel-fence-failure": {
				TurnID:    "turn-cancel-fence-failure",
				Status:    domain.TurnStatusRunning,
				StartedAt: now.Add(-time.Minute),
			},
		},
	}
	service := NewEvaluationService(db, nil, kernel)
	service.now = func() time.Time { return now }
	run := seedEvaluationRun(
		t,
		db,
		"run-cancel-fence-failure",
		1,
		model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING,
		now,
	)
	run.CancelIntentFence = "cancel-fence"
	run.CancelAckDeadline = &now
	if err := db.Model(run).Updates(map[string]interface{}{
		"cancel_intent_fence": run.CancelIntentFence,
		"cancel_ack_deadline": run.CancelAckDeadline,
	}).Error; err != nil {
		t.Fatalf("seed cancellation deadline: %v", err)
	}
	runCase := &persistence.EvaluationRunCase{
		RunID:          run.RunID,
		CaseID:         "case-cancel-fence-failure",
		PTID:           run.PTID,
		Ordinal:        1,
		SourceRevision: 1,
		Input:          "question",
		Expected:       "answer",
		Rubric:         evaluationRubricExactMatch,
		RubricVersion:  evaluationRubricExactMatchVersion,
		TagsJSON:       []byte(`[]`),
	}
	if err := db.Create(runCase).Error; err != nil {
		t.Fatalf("seed cancellation run case: %v", err)
	}
	attempt := &persistence.EvaluationCaseAttempt{
		AttemptID:      "attempt-cancel-fence-failure",
		RunID:          run.RunID,
		CaseID:         runCase.CaseID,
		Attempt:        1,
		PTID:           run.PTID,
		IdempotencyKey: "attempt-cancel-fence-failure-key",
		TurnID:         stringPointer("turn-cancel-fence-failure"),
		Status:         int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING),
		StartedAt:      &now,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := db.Create(attempt).Error; err != nil {
		t.Fatalf("seed cancellation attempt: %v", err)
	}

	if err := service.reconcileCancellingEvaluationRun(
		context.Background(),
		run,
	); err == nil {
		t.Fatal("cancellation deadline settled despite failed canonical Turn fence")
	}
	var persistedAttempt persistence.EvaluationCaseAttempt
	if err := db.First(
		&persistedAttempt,
		"attempt_id = ?",
		attempt.AttemptID,
	).Error; err != nil {
		t.Fatalf("reload Evaluation attempt: %v", err)
	}
	if model.EvaluationAttemptStatus(persistedAttempt.Status) !=
		model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING ||
		persistedAttempt.TerminalAt != nil {
		t.Fatalf("attempt settled before durable Turn fence: %+v", persistedAttempt)
	}
	var persistedRun persistence.EvaluationRun
	if err := db.First(&persistedRun, "run_id = ?", run.RunID).Error; err != nil {
		t.Fatalf("reload Evaluation run: %v", err)
	}
	if model.EvaluationRunStatus(persistedRun.Status) !=
		model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING {
		t.Fatalf("run left cancelling after failed Turn fence: %+v", persistedRun)
	}
}

func TestEvaluationServiceStartRun(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-start-run")
	service := NewEvaluationService(db, nil, nil)
	now := time.Date(2026, 9, 17, 9, 22, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	service.targetValidator = func(
		_ context.Context,
		_ *persistence.EvaluationRepository,
		run *persistence.EvaluationRun,
	) error {
		if run.TargetAgentID != "agent-1" {
			t.Fatalf("validated wrong target Agent: %+v", run)
		}
		return nil
	}
	run := seedEvaluationRun(t, db, "run-start", 1, model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PENDING, now)
	request := &model.StartEvaluationRunRequest{
		RunId:            run.RunID,
		ExpectedRevision: run.Revision,
		IdempotencyKey:   "start-run-key",
	}

	started, err := service.StartRun(context.Background(), run.PTID, request)
	if err != nil {
		t.Fatalf("start evaluation run: %v", err)
	}
	if started.GetStatus() != model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING ||
		started.GetRevision() != run.Revision+1 {
		t.Fatalf("unexpected started run: %+v", started)
	}
	replayed, err := service.StartRun(context.Background(), run.PTID, request)
	if err != nil {
		t.Fatalf("replay evaluation start: %v", err)
	}
	if replayed.GetStatus() != started.GetStatus() ||
		replayed.GetRevision() != started.GetRevision() {
		t.Fatalf("start replay changed response: %+v", replayed)
	}
}

func TestEvaluationServiceRetryCases(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-retry-lineage")
	service := NewEvaluationService(db, nil, nil)
	now := time.Date(2026, 9, 17, 9, 25, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	parent := seedEvaluationRun(t, db, "run-parent", 1, model.EvaluationRunStatus_EVALUATION_RUN_STATUS_FAILED, now)
	if err := db.Create(&persistence.EvaluationRunCase{
		RunID:          parent.RunID,
		CaseID:         "case-retry",
		PTID:           parent.PTID,
		Ordinal:        1,
		SourceRevision: 2,
		Input:          "question",
		Expected:       "answer",
		TagsJSON:       []byte(`[]`),
	}).Error; err != nil {
		t.Fatalf("seed parent run case: %v", err)
	}
	sourceAttempt := &persistence.EvaluationCaseAttempt{
		AttemptID:      "attempt-parent",
		RunID:          parent.RunID,
		CaseID:         "case-retry",
		Attempt:        1,
		PTID:           parent.PTID,
		IdempotencyKey: "parent-attempt-key",
		TurnID:         stringPointer("turn-parent"),
		Status:         int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_FAILED),
		TerminalAt:     &now,
		StartedAt:      &now,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := db.Create(sourceAttempt).Error; err != nil {
		t.Fatalf("seed parent attempt: %v", err)
	}
	if err := db.Create(&persistence.EvaluationResult{
		ResultID:       "result-parent",
		RunID:          parent.RunID,
		CaseID:         sourceAttempt.CaseID,
		AttemptID:      sourceAttempt.AttemptID,
		PTID:           parent.PTID,
		OutputRef:      "turn:turn-parent",
		Score:          0,
		RubricVersion:  evaluationRubricExactMatchVersion,
		TerminalStatus: sourceAttempt.Status,
		CreatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed parent result: %v", err)
	}
	request := &model.RetryEvaluationCasesRequest{
		ParentRunId:            parent.RunID,
		CaseIds:                []string{"case-retry"},
		IdempotencyKey:         "retry-key",
		ExpectedParentRevision: parent.Revision,
	}

	child, err := service.RetryCases(context.Background(), parent.PTID, request)
	if err != nil {
		t.Fatalf("retry failed case: %v", err)
	}
	if child.GetParentRunId() != parent.RunID ||
		child.GetStatus() != model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PENDING {
		t.Fatalf("unexpected child run: %+v", child)
	}
	var childCase persistence.EvaluationRunCase
	if err := db.First(
		&childCase,
		"run_id = ? AND case_id = ?",
		child.GetRunId(),
		sourceAttempt.CaseID,
	).Error; err != nil {
		t.Fatalf("load child run case: %v", err)
	}
	if childCase.SourceAttemptID == nil ||
		*childCase.SourceAttemptID != sourceAttempt.AttemptID ||
		childCase.SourceResultID == nil ||
		*childCase.SourceResultID != "result-parent" ||
		childCase.SourceAttemptNo != sourceAttempt.Attempt {
		t.Fatalf("child retry lineage = %+v", childCase)
	}
	var unchanged persistence.EvaluationRun
	if err := db.First(&unchanged, "run_id = ?", parent.RunID).Error; err != nil {
		t.Fatalf("reload parent run: %v", err)
	}
	if unchanged.Revision != parent.Revision ||
		model.EvaluationRunStatus(unchanged.Status) !=
			model.EvaluationRunStatus_EVALUATION_RUN_STATUS_FAILED {
		t.Fatalf("retry mutated terminal parent: %+v", unchanged)
	}
}

func TestEvaluationServiceDeleteRun(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-delete-run")
	service := NewEvaluationService(db, nil, nil)
	now := time.Date(2026, 9, 17, 9, 27, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	run := seedEvaluationRun(t, db, "run-delete", 1, model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING, now)

	_, err := service.DeleteRun(
		context.Background(),
		run.PTID,
		&model.DeleteEvaluationRunRequest{
			RunId:            run.RunID,
			ExpectedRevision: run.Revision,
			IdempotencyKey:   "delete-active",
		},
	)
	var failure *EvaluationFailure
	if !errors.As(err, &failure) ||
		failure.Detail.GetCode() !=
			model.EvaluationErrorCode_EVALUATION_ERROR_CODE_RETENTION_CONFLICT {
		t.Fatalf("expected active-run retention conflict, got %v", err)
	}

	if err := db.Model(&persistence.EvaluationRun{}).
		Where("run_id = ?", run.RunID).
		Update("status", int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_COMPLETED)).
		Error; err != nil {
		t.Fatalf("terminalize run fixture: %v", err)
	}
	deleted, err := service.DeleteRun(
		context.Background(),
		run.PTID,
		&model.DeleteEvaluationRunRequest{
			RunId:            run.RunID,
			ExpectedRevision: run.Revision,
			IdempotencyKey:   "delete-terminal",
		},
	)
	if err != nil || !deleted {
		t.Fatalf("delete terminal run: deleted=%t err=%v", deleted, err)
	}
	if _, err := service.GetRun(
		context.Background(),
		run.PTID,
		run.RunID,
	); err == nil {
		t.Fatal("tombstoned run remained visible")
	}
	var retained persistence.EvaluationRun
	if err := db.First(&retained, "run_id = ?", run.RunID).Error; err != nil {
		t.Fatalf("load retained tombstone: %v", err)
	}
	if retained.DeletedAt == nil {
		t.Fatal("run was hard-deleted instead of tombstoned")
	}
}

func TestEvaluationServiceSettleEvaluationAttempt(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-terminal-metrics")
	service := NewEvaluationService(db, nil, nil)
	now := time.Date(2026, 9, 17, 9, 30, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	run := seedEvaluationRun(t, db, "run-metrics", 2, model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING, now)
	score := 1.0
	firstAttempt := &persistence.EvaluationCaseAttempt{
		AttemptID:      "attempt-first",
		RunID:          run.RunID,
		CaseID:         "case-first",
		Attempt:        1,
		PTID:           run.PTID,
		IdempotencyKey: "attempt-first-key",
		TurnID:         stringPointer("turn-first"),
		Status:         int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_COMPLETED),
		OutputRef:      "turn:turn-first",
		Score:          &score,
		TerminalAt:     &now,
		StartedAt:      &now,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	secondAttempt := &persistence.EvaluationCaseAttempt{
		AttemptID:      "attempt-second",
		RunID:          run.RunID,
		CaseID:         "case-second",
		Attempt:        1,
		PTID:           run.PTID,
		IdempotencyKey: "attempt-second-key",
		TurnID:         stringPointer("turn-second"),
		Status:         int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING),
		StartedAt:      &now,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := db.Create(firstAttempt).Error; err != nil {
		t.Fatalf("seed first attempt: %v", err)
	}
	if err := db.Create(secondAttempt).Error; err != nil {
		t.Fatalf("seed second attempt: %v", err)
	}
	if err := db.Create(&persistence.EvaluationResult{
		ResultID:       "result-first",
		RunID:          run.RunID,
		CaseID:         firstAttempt.CaseID,
		AttemptID:      firstAttempt.AttemptID,
		PTID:           run.PTID,
		OutputRef:      firstAttempt.OutputRef,
		Output:         "yes",
		Score:          score,
		RubricVersion:  evaluationRubricExactMatchVersion,
		TerminalStatus: firstAttempt.Status,
		CreatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed first result: %v", err)
	}
	runCase := &persistence.EvaluationRunCase{
		RunID:         run.RunID,
		CaseID:        secondAttempt.CaseID,
		PTID:          run.PTID,
		Expected:      "yes",
		Rubric:        evaluationRubricCaseInsensitiveContains,
		RubricVersion: evaluationRubricCaseInsensitiveContainsVersion,
	}

	if err := service.settleEvaluationAttempt(
		context.Background(),
		runCase,
		secondAttempt,
		&EvaluationTurnReadback{
			TurnID:    stringValue(secondAttempt.TurnID),
			Status:    domain.TurnStatusCompleted,
			Output:    "The answer is YES.",
			TraceID:   "trace-second",
			StartedAt: now.Add(-2 * time.Second),
			EndedAt:   &now,
		},
	); err != nil {
		t.Fatalf("settle final attempt: %v", err)
	}

	var persistedRun persistence.EvaluationRun
	if err := db.First(&persistedRun, "run_id = ?", run.RunID).Error; err != nil {
		t.Fatalf("load terminal run: %v", err)
	}
	if model.EvaluationRunStatus(persistedRun.Status) !=
		model.EvaluationRunStatus_EVALUATION_RUN_STATUS_COMPLETED {
		t.Fatalf("run status = %v, want completed", model.EvaluationRunStatus(persistedRun.Status))
	}
	var metrics model.EvaluationMetrics
	if err := proto.Unmarshal(persistedRun.MetricsPayload, &metrics); err != nil {
		t.Fatalf("decode terminal metrics: %v", err)
	}
	if metrics.GetTerminalCases() != 2 ||
		metrics.GetPassedCases() != 2 ||
		metrics.GetAverageScore() != 1 ||
		!metrics.GetComparable() {
		t.Fatalf("unexpected terminal metrics: %+v", &metrics)
	}
	var resultCount int64
	if err := db.Model(&persistence.EvaluationResult{}).
		Where("run_id = ?", run.RunID).
		Count(&resultCount).Error; err != nil {
		t.Fatalf("count terminal results: %v", err)
	}
	if resultCount != 2 {
		t.Fatalf("terminal result count = %d, want 2", resultCount)
	}
	var secondResult persistence.EvaluationResult
	if err := db.First(
		&secondResult,
		"attempt_id = ?",
		secondAttempt.AttemptID,
	).Error; err != nil {
		t.Fatalf("load contains-rubric result: %v", err)
	}
	if secondResult.Score != 1 ||
		secondResult.RubricVersion !=
			evaluationRubricCaseInsensitiveContainsVersion {
		t.Fatalf("contains rubric result = %+v", secondResult)
	}
}

func TestEvaluationServiceFailEvaluationAttempt(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-failed-attempt")
	service := NewEvaluationService(db, nil, nil)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	run := seedEvaluationRun(t, db, "run-failed", 1, model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING, now)
	attempt := &persistence.EvaluationCaseAttempt{
		AttemptID:      "attempt-failed",
		RunID:          run.RunID,
		CaseID:         "case-failed",
		Attempt:        1,
		PTID:           run.PTID,
		IdempotencyKey: "attempt-failed-key",
		Status:         int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING),
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := db.Create(attempt).Error; err != nil {
		t.Fatalf("seed pending attempt: %v", err)
	}
	runCase := &persistence.EvaluationRunCase{
		RunID:         run.RunID,
		CaseID:        attempt.CaseID,
		PTID:          run.PTID,
		Rubric:        evaluationRubricExactMatch,
		RubricVersion: evaluationRubricExactMatchVersion,
	}

	if err := service.failEvaluationAttempt(
		context.Background(),
		run,
		runCase,
		attempt,
		"start rejected",
		errors.New("worker unavailable"),
	); err != nil {
		t.Fatalf("fail evaluation attempt: %v", err)
	}

	var results []persistence.EvaluationResult
	if err := db.Where("attempt_id = ?", attempt.AttemptID).Find(&results).Error; err != nil {
		t.Fatalf("load failed-attempt result: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("failed attempt result count = %d, want 1", len(results))
	}
	if model.EvaluationAttemptStatus(results[0].TerminalStatus) !=
		model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_FAILED {
		t.Fatalf("failed attempt result status = %v", results[0].TerminalStatus)
	}
}

func TestEvaluationServiceAcknowledgeEvaluationCancellation(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-cancel-timeout")
	service := NewEvaluationService(db, nil, nil)
	now := time.Date(2026, 9, 17, 10, 30, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	run := seedEvaluationRun(t, db, "run-cancel", 1, model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING, now)
	run.CancelIntentFence = "cancel-fence"
	deadline := now
	run.CancelAckDeadline = &deadline
	if err := db.Model(&persistence.EvaluationRun{}).
		Where("run_id = ?", run.RunID).
		Updates(map[string]interface{}{
			"cancel_intent_fence": run.CancelIntentFence,
			"cancel_ack_deadline": deadline,
		}).Error; err != nil {
		t.Fatalf("seed cancellation fence: %v", err)
	}
	attempt := &persistence.EvaluationCaseAttempt{
		AttemptID:      "attempt-timeout",
		RunID:          run.RunID,
		CaseID:         "case-timeout",
		Attempt:        1,
		PTID:           run.PTID,
		IdempotencyKey: "attempt-timeout-key",
		TurnID:         stringPointer("turn-timeout"),
		Status:         int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING),
		StartedAt:      &now,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := db.Create(attempt).Error; err != nil {
		t.Fatalf("seed running attempt: %v", err)
	}
	runCase := &persistence.EvaluationRunCase{
		RunID:         run.RunID,
		CaseID:        attempt.CaseID,
		PTID:          run.PTID,
		Rubric:        evaluationRubricExactMatch,
		RubricVersion: evaluationRubricExactMatchVersion,
	}

	if err := service.acknowledgeEvaluationCancellation(
		context.Background(),
		run,
		runCase,
		attempt,
		true,
	); err != nil {
		t.Fatalf("settle cancellation timeout: %v", err)
	}

	var persisted persistence.EvaluationCaseAttempt
	if err := db.First(&persisted, "attempt_id = ?", attempt.AttemptID).Error; err != nil {
		t.Fatalf("load timed-out attempt: %v", err)
	}
	if persisted.CancellationAckAt != nil {
		t.Fatalf("timed-out attempt has cancellation acknowledgement %v", persisted.CancellationAckAt)
	}
	var results []persistence.EvaluationResult
	if err := db.Where("attempt_id = ?", attempt.AttemptID).Find(&results).Error; err != nil {
		t.Fatalf("load timed-out result: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("timed-out attempt result count = %d, want 1", len(results))
	}
}

func TestTurnServiceResolveTurnRuntimeSnapshot(t *testing.T) {
	observedAt := time.Now().UTC().Add(-time.Minute)
	pinned := &model.RuntimeSnapshot{
		RuntimeKind:           model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
		ProviderId:            "provider-frozen",
		ModelId:               "model-frozen",
		RuntimeProfileId:      modernChatAgentProfileID,
		ProviderConfigVersion: "provider-revision-frozen",
		AgentConfigVersion:    "7",
		ThinkingMode:          string(domain.ThinkingModeAuto),
		Capabilities: &model.RuntimeCapabilitySnapshot{
			SnapshotId: "runtime-frozen",
			Provenance: &model.RuntimeCapabilityProvenance{
				DiscoverySource: runtimeCapabilityDiscoverySource,
				SourceVersion:   "source-frozen",
				ObservedAt:      timestamppb.New(observedAt),
			},
		},
		Budget: &model.RuntimeBudget{MaxAttempts: 2},
	}
	turnService := &TurnService{}
	admission, err := turnService.resolveTurnRuntimeSnapshot(
		context.Background(),
		&TurnConfig{
			Provider:              pinned.GetProviderId(),
			Model:                 pinned.GetModelId(),
			PinnedRuntimeSnapshot: pinned,
		},
	)
	if err != nil {
		t.Fatalf("resolve pinned runtime snapshot: %v", err)
	}
	if admission.ProviderID != pinned.GetProviderId() ||
		admission.ModelID != pinned.GetModelId() ||
		admission.ProviderConfigVersion != pinned.GetProviderConfigVersion() ||
		admission.SnapshotID != pinned.GetCapabilities().GetSnapshotId() {
		t.Fatalf("resolved admission drifted from frozen snapshot: %+v", admission)
	}
	pinned.ProviderId = "mutated-after-resolution"
	if admission.ProviderID != "provider-frozen" {
		t.Fatal("resolved admission aliases mutable caller snapshot")
	}
}

func TestTurnServiceResolveTurnReadiness(t *testing.T) {
	turnService := &TurnService{}
	readiness := &model.CapabilityReadinessSnapshot{
		SnapshotId:        "readiness-frozen",
		Ptid:              "ptid:actor-1",
		AgentId:           "agent-1",
		RuntimeSnapshotId: "runtime-frozen",
	}
	resolved, revision, err := turnService.resolveTurnReadiness(
		context.Background(),
		&TurnConfig{
			ActorID:                 "ptid:actor-1",
			AgentID:                 "agent-1",
			PinnedReadinessSnapshot: readiness,
			ExpectedAgentVersion:    7,
		},
		&AdmissionSnapshot{SnapshotID: "runtime-frozen"},
	)
	if err != nil {
		t.Fatalf("resolve pinned readiness: %v", err)
	}
	if revision != 7 || resolved.GetSnapshotId() != readiness.GetSnapshotId() {
		t.Fatalf("unexpected pinned readiness result: revision=%d snapshot=%+v", revision, resolved)
	}
	readiness.SnapshotId = "mutated-after-resolution"
	if resolved.GetSnapshotId() != "readiness-frozen" {
		t.Fatal("resolved readiness aliases mutable caller snapshot")
	}
}

func TestEvaluationServiceReconcileEvaluationRuns(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-worker-claims")
	kernel := &recordingEvaluationTurnKernel{
		readbacks: make(map[string]*EvaluationTurnReadback),
	}
	service := NewEvaluationService(db, nil, kernel)
	now := time.Date(2026, 9, 17, 11, 30, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	run := seedEvaluationRun(t, db, "run-worker", 2, model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING, now)
	for index, caseID := range []string{"case-a", "case-b"} {
		if err := db.Create(&persistence.EvaluationRunCase{
			RunID:          run.RunID,
			CaseID:         caseID,
			PTID:           run.PTID,
			Ordinal:        uint32(index + 1),
			SourceRevision: 1,
			Input:          "input-" + caseID,
			Expected:       "output-" + caseID,
			TagsJSON:       []byte(`[]`),
		}).Error; err != nil {
			t.Fatalf("seed run case %s: %v", caseID, err)
		}
	}

	if err := service.ReconcileEvaluationRuns(context.Background()); err != nil {
		t.Fatalf("first worker reconciliation: %v", err)
	}
	if err := service.ReconcileEvaluationRuns(context.Background()); err != nil {
		t.Fatalf("duplicate worker reconciliation: %v", err)
	}
	if kernel.admitCount != 2 || kernel.startCount != 2 {
		t.Fatalf(
			"duplicate scheduler work: admits=%d starts=%d, want 2/2",
			kernel.admitCount,
			kernel.startCount,
		)
	}
	var attempts []persistence.EvaluationCaseAttempt
	if err := db.Where("run_id = ?", run.RunID).Find(&attempts).Error; err != nil {
		t.Fatalf("load worker attempts: %v", err)
	}
	if len(attempts) != 2 {
		t.Fatalf("attempt count = %d, want 2", len(attempts))
	}
	for _, attempt := range attempts {
		if attempt.SchedulerClaim == nil || *attempt.SchedulerClaim == "" ||
			attempt.TurnID == nil || *attempt.TurnID == "" {
			t.Fatalf("attempt lacks scheduler/Turn identity: %+v", attempt)
		}
	}
}

func TestEvaluationServiceRestartRecoveryFencesTurnWithoutRedispatch(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-restart-fence")
	now := time.Date(2026, 9, 17, 11, 45, 0, 0, time.UTC)
	kernel := &recordingEvaluationTurnKernel{
		readbacks: map[string]*EvaluationTurnReadback{
			"turn-restart": {
				TurnID:    "turn-restart",
				Status:    domain.TurnStatusRunning,
				StartedAt: now.Add(-time.Minute),
			},
		},
	}
	service := NewEvaluationService(db, nil, kernel)
	service.now = func() time.Time { return now }
	run := seedEvaluationRun(
		t,
		db,
		"run-restart",
		1,
		model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING,
		now,
	)
	if err := db.Create(&persistence.EvaluationRunCase{
		RunID:          run.RunID,
		CaseID:         "case-restart",
		PTID:           run.PTID,
		Ordinal:        1,
		SourceRevision: 1,
		Input:          "question",
		Expected:       "answer",
		Rubric:         evaluationRubricExactMatch,
		RubricVersion:  evaluationRubricExactMatchVersion,
		TagsJSON:       []byte(`[]`),
	}).Error; err != nil {
		t.Fatalf("seed restart run case: %v", err)
	}
	if err := db.Create(&persistence.EvaluationCaseAttempt{
		AttemptID:      "attempt-restart",
		RunID:          run.RunID,
		CaseID:         "case-restart",
		Attempt:        1,
		PTID:           run.PTID,
		IdempotencyKey: "attempt-restart-key",
		TurnID:         stringPointer("turn-restart"),
		Status:         int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING),
		StartedAt:      &now,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed restart attempt: %v", err)
	}

	if err := service.RecoverInterruptedTurns(context.Background()); err != nil {
		t.Fatalf("recover interrupted Evaluation Turns: %v", err)
	}
	if kernel.recoverCount != 1 {
		t.Fatalf("canonical recovery count = %d, want 1", kernel.recoverCount)
	}
	if kernel.admitCount != 0 || kernel.startCount != 0 {
		t.Fatalf(
			"restart redispatched Evaluation Turn: admits=%d starts=%d",
			kernel.admitCount,
			kernel.startCount,
		)
	}
	if err := service.ReconcileEvaluationRuns(context.Background()); err != nil {
		t.Fatalf("reconcile interrupted Evaluation Turn: %v", err)
	}
	readback, err := service.GetRun(context.Background(), run.PTID, run.RunID)
	if err != nil {
		t.Fatalf("read recovered Evaluation run: %v", err)
	}
	if readback.GetRun().GetStatus() !=
		model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PARTIAL ||
		len(readback.GetAttempts()) != 1 ||
		readback.GetAttempts()[0].GetStatus() !=
			model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_INTERRUPTED {
		t.Fatalf("restart recovery did not expose retryable interruption: %+v", readback)
	}
}

func openEvaluationServiceTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+name+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open evaluation test database: %v", err)
	}
	if err := persistence.MigrateEvaluationAggregate(db); err != nil {
		t.Fatalf("migrate evaluation schema: %v", err)
	}
	return db
}

func seedEvaluationRun(
	t *testing.T,
	db *gorm.DB,
	runID string,
	totalCases uint32,
	status model.EvaluationRunStatus,
	now time.Time,
) *persistence.EvaluationRun {
	t.Helper()
	snapshotPayload, err := proto.Marshal(&model.RuntimeSnapshot{
		RuntimeKind:      model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
		ProviderId:       "provider",
		ModelId:          "model",
		RuntimeProfileId: modernChatAgentProfileID,
	})
	if err != nil {
		t.Fatalf("encode runtime snapshot: %v", err)
	}
	sum := sha256.Sum256(snapshotPayload)
	run := &persistence.EvaluationRun{
		RunID:               runID,
		PTID:                "ptid:actor-1",
		IdempotencyKey:      runID + "-key",
		PayloadHash:         hex.EncodeToString(sum[:]),
		Revision:            1,
		CommandKind:         int32(model.EvaluationCommandKind_EVALUATION_COMMAND_KIND_CREATE_RUN),
		MutationScope:       "dataset:dataset-1:1",
		DatasetID:           "dataset-1",
		DatasetRevision:     1,
		TargetSnapshot:      snapshotPayload,
		TargetSnapshotHash:  hex.EncodeToString(sum[:]),
		TargetConfig:        []byte(`{}`),
		ReadinessSnapshotID: "readiness-1",
		Status:              int32(status),
		TotalCases:          totalCases,
		TargetAgentID:       "agent-1",
		TargetAgentRevision: 1,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if err := db.Create(run).Error; err != nil {
		t.Fatalf("seed evaluation run: %v", err)
	}
	return run
}

func seedEvaluationDatasetAndCases(
	t *testing.T,
	db *gorm.DB,
	ptid string,
	datasetID string,
	revision uint64,
	now time.Time,
	count int,
) {
	t.Helper()
	if err := db.Create(&persistence.EvaluationBenchmark{
		BenchmarkID: "benchmark-1",
		PTID:        ptid,
		Name:        "Benchmark",
		Rubric:      evaluationRubricExactMatch,
		Revision:    1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("seed evaluation benchmark: %v", err)
	}
	if err := db.Create(&persistence.EvaluationDataset{
		DatasetID:   datasetID,
		BenchmarkID: "benchmark-1",
		PTID:        ptid,
		Name:        "Dataset",
		Revision:    revision,
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("seed evaluation dataset: %v", err)
	}
	for index := 0; index < count; index++ {
		caseID := fmt.Sprintf("case-%d", index+1)
		if err := db.Create(&persistence.EvaluationTestCase{
			CaseID:    caseID,
			DatasetID: datasetID,
			PTID:      ptid,
			Input:     "input-" + caseID,
			Expected:  "output-" + caseID,
			TagsJSON:  []byte(`[]`),
			Revision:  1,
			CreatedAt: now,
			UpdatedAt: now,
		}).Error; err != nil {
			t.Fatalf("seed evaluation case %s: %v", caseID, err)
		}
	}
}

func TestEvaluationServiceRestartRecoveryCoversMoreThanOneWorkerBatch(t *testing.T) {
	db := openEvaluationServiceTestDB(t, "evaluation-restart-all-runs")
	now := time.Date(2026, 9, 17, 11, 50, 0, 0, time.UTC)
	kernel := &recordingEvaluationTurnKernel{
		readbacks: make(map[string]*EvaluationTurnReadback),
	}
	service := NewEvaluationService(db, nil, kernel)
	service.now = func() time.Time { return now }

	const runCount = evaluationWorkerBatch + 1
	for index := 0; index < runCount; index++ {
		runID := fmt.Sprintf("run-restart-%02d", index)
		turnID := fmt.Sprintf("turn-restart-%02d", index)
		run := seedEvaluationRun(
			t,
			db,
			runID,
			1,
			model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING,
			now.Add(time.Duration(index)*time.Second),
		)
		if err := db.Create(&persistence.EvaluationCaseAttempt{
			AttemptID:      fmt.Sprintf("attempt-restart-%02d", index),
			RunID:          run.RunID,
			CaseID:         fmt.Sprintf("case-restart-%02d", index),
			Attempt:        1,
			PTID:           run.PTID,
			IdempotencyKey: fmt.Sprintf("attempt-restart-key-%02d", index),
			TurnID:         stringPointer(turnID),
			Status:         int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING),
			StartedAt:      &now,
			CreatedAt:      now,
			UpdatedAt:      now,
		}).Error; err != nil {
			t.Fatalf("seed restart attempt %d: %v", index, err)
		}
		kernel.readbacks[turnID] = &EvaluationTurnReadback{
			TurnID:    turnID,
			Status:    domain.TurnStatusRunning,
			StartedAt: now,
		}
	}

	if err := service.RecoverInterruptedTurns(context.Background()); err != nil {
		t.Fatalf("recover all interrupted Evaluation Turns: %v", err)
	}
	if kernel.recoverCount != runCount {
		t.Fatalf(
			"canonical recovery count = %d, want %d",
			kernel.recoverCount,
			runCount,
		)
	}
}

type recordingEvaluationTurnKernel struct {
	admitCount     int
	startCount     int
	recoverCount   int
	cancelCount    int
	interruptCount int
	interruptErr   error
	onInterrupt    func(string)
	readbacks      map[string]*EvaluationTurnReadback
}

func (k *recordingEvaluationTurnKernel) Admit(
	_ context.Context,
	spec EvaluationTurnSpec,
) (*EvaluationTurnAdmission, error) {
	k.admitCount++
	turnID := "turn-" + spec.AttemptID
	k.readbacks[turnID] = &EvaluationTurnReadback{
		TurnID:    turnID,
		Status:    domain.TurnStatusRunning,
		StartedAt: time.Now().UTC(),
	}
	return &EvaluationTurnAdmission{
		PTID: spec.PTID,
		Request: &model.ExecuteTurnRequest{
			ConversationId:       spec.ConversationID,
			AgentId:              spec.AgentID,
			UserInput:            spec.Input,
			ClientIdempotencyKey: spec.ClientIdempotencyKey,
		},
		Admission: &model.TurnAdmission{
			Status: model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_STARTED,
			TurnId: turnID,
		},
		RuntimeSnapshot: spec.RuntimeSnapshot,
		AgentRevision:   spec.TargetAgentRevision,
	}, nil
}

func (k *recordingEvaluationTurnKernel) Start(
	_ *EvaluationTurnAdmission,
) error {
	k.startCount++
	return nil
}

func (k *recordingEvaluationTurnKernel) Recover(
	_ context.Context,
	_ string,
	turnID string,
) error {
	k.recoverCount++
	if readback := k.readbacks[turnID]; readback != nil {
		readback.Status = domain.TurnStatusInterrupted
		readback.TerminalReason = "station_restart_interrupted"
		endedAt := time.Now().UTC()
		readback.EndedAt = &endedAt
	}
	return nil
}

func (k *recordingEvaluationTurnKernel) Cancel(
	_ context.Context,
	_ string,
	_ string,
) error {
	k.cancelCount++
	return nil
}

func (k *recordingEvaluationTurnKernel) Interrupt(
	_ context.Context,
	_ string,
	turnID string,
	reasonCode string,
) error {
	k.interruptCount++
	if k.onInterrupt != nil {
		k.onInterrupt(turnID)
	}
	if k.interruptErr != nil {
		return k.interruptErr
	}
	if readback := k.readbacks[turnID]; readback != nil {
		readback.Status = domain.TurnStatusInterrupted
		readback.TerminalReason = reasonCode
		endedAt := time.Now().UTC()
		readback.EndedAt = &endedAt
	}
	return nil
}

func (k *recordingEvaluationTurnKernel) Read(
	_ context.Context,
	_ string,
	turnID string,
) (*EvaluationTurnReadback, error) {
	readback, ok := k.readbacks[turnID]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	copy := *readback
	return &copy, nil
}
