package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type EvaluationTurnSpec struct {
	PTID                 string
	RunID                string
	AttemptID            string
	CaseID               string
	ConversationID       string
	Input                string
	AgentID              string
	Identity             string
	AgentConfigPrompt    string
	ProviderID           string
	ModelID              string
	Effort               string
	ThinkingMode         string
	ReadinessSnapshotID  string
	RuntimeSnapshot      *model.RuntimeSnapshot
	TargetAgentRevision  uint64
	ClientIdempotencyKey string
}

type EvaluationTurnAdmission struct {
	PTID              string
	Request           *model.ExecuteTurnRequest
	Admission         *model.TurnAdmission
	RuntimeSnapshot   *model.RuntimeSnapshot
	ReadinessSnapshot *model.CapabilityReadinessSnapshot
	AgentRevision     uint64
}

type EvaluationTurnReadback struct {
	TurnID         string
	Status         domain.TurnStatus
	Output         string
	TerminalReason string
	TraceID        string
	StartedAt      time.Time
	EndedAt        *time.Time
}

type EvaluationTurnKernel interface {
	Admit(
		context.Context,
		EvaluationTurnSpec,
	) (*EvaluationTurnAdmission, error)
	Start(*EvaluationTurnAdmission) error
	Recover(context.Context, string, string) error
	Cancel(context.Context, string, string) error
	Interrupt(context.Context, string, string, string) error
	Read(context.Context, string, string) (*EvaluationTurnReadback, error)
}

type CanonicalEvaluationTurnKernel struct {
	admission *TurnAdmissionService
	turns     *TurnService
	db        *gorm.DB
}

func NewCanonicalEvaluationTurnKernel(
	admission *TurnAdmissionService,
	turns *TurnService,
	db *gorm.DB,
) *CanonicalEvaluationTurnKernel {
	return &CanonicalEvaluationTurnKernel{
		admission: admission,
		turns:     turns,
		db:        db,
	}
}

func (k *CanonicalEvaluationTurnKernel) Admit(
	ctx context.Context,
	spec EvaluationTurnSpec,
) (*EvaluationTurnAdmission, error) {
	if k == nil || k.admission == nil || k.turns == nil || k.db == nil ||
		spec.RuntimeSnapshot == nil || spec.TargetAgentRevision == 0 {
		return nil, evaluationTargetInvalid(
			spec.AgentID,
			spec.ReadinessSnapshotID,
			"canonical_turn_kernel_unavailable",
			nil,
		)
	}
	var readinessRecord persistence.CapabilityReadinessSnapshot
	if err := k.db.WithContext(ctx).
		Where(
			"snapshot_id = ? AND ptid = ? AND agent_id = ?",
			spec.ReadinessSnapshotID,
			spec.PTID,
			spec.AgentID,
		).
		First(&readinessRecord).Error; err != nil {
		return nil, evaluationTargetInvalid(
			spec.AgentID,
			spec.ReadinessSnapshotID,
			"readiness_snapshot_unavailable",
			err,
		)
	}
	readiness := &model.CapabilityReadinessSnapshot{}
	if err := proto.Unmarshal(readinessRecord.Payload, readiness); err != nil {
		return nil, evaluationTargetInvalid(
			spec.AgentID,
			spec.ReadinessSnapshotID,
			"readiness_snapshot_decode_failed",
			err,
		)
	}
	providerID := strings.TrimSpace(spec.ProviderID)
	modelID := strings.TrimSpace(spec.ModelID)
	identity := spec.Identity
	agentPrompt := spec.AgentConfigPrompt
	effort := strings.TrimSpace(spec.Effort)
	request := &model.ExecuteTurnRequest{
		ConversationId:       spec.ConversationID,
		AgentId:              spec.AgentID,
		UserInput:            spec.Input,
		Provider:             &providerID,
		Model:                &modelID,
		Identity:             &identity,
		AgentConfigPrompt:    &agentPrompt,
		Effort:               &effort,
		ClientIdempotencyKey: spec.ClientIdempotencyKey,
		ThinkingMode:         spec.ThinkingMode,
	}
	if selectedSessionID := readiness.GetSelectedClientSessionId(); selectedSessionID != "" {
		request.ClientCapabilitySessionId = &selectedSessionID
	}
	if spec.RuntimeSnapshot != nil && spec.RuntimeSnapshot.GetBudget() != nil {
		request.RequestedBudget = proto.Clone(
			spec.RuntimeSnapshot.GetBudget(),
		).(*model.RuntimeBudget)
	}
	admission, _, err := k.admission.AdmitNewConversation(
		ctx,
		spec.PTID,
		request,
		NewConversationAdmission{
			ConversationID: spec.ConversationID,
			Title:          "Evaluation " + spec.CaseID,
			ProviderID:     providerID,
			ModelName:      modelID,
		},
		evaluationTurnPayloadHash(spec),
	)
	if err != nil {
		return nil, err
	}
	if admission.GetStatus() !=
		model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_STARTED &&
		admission.GetStatus() !=
			model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_REPLAYED {
		return nil, evaluationTargetInvalid(
			spec.AgentID,
			spec.ReadinessSnapshotID,
			"evaluation_turn_was_queued",
			nil,
		)
	}
	return &EvaluationTurnAdmission{
		PTID:              spec.PTID,
		Request:           request,
		Admission:         admission,
		RuntimeSnapshot:   proto.Clone(spec.RuntimeSnapshot).(*model.RuntimeSnapshot),
		ReadinessSnapshot: readiness,
		AgentRevision:     spec.TargetAgentRevision,
	}, nil
}

func (k *CanonicalEvaluationTurnKernel) Start(
	admission *EvaluationTurnAdmission,
) error {
	if admission == nil || admission.Request == nil || admission.Admission == nil {
		return evaluationInvalid("evaluation Turn admission is required")
	}
	if k.turns.StartEvaluationTurn(
		admission.PTID,
		admission.Request,
		admission.Admission,
		admission.RuntimeSnapshot,
		admission.ReadinessSnapshot,
		admission.AgentRevision,
	) {
		return nil
	}
	err := fmt.Errorf("Agent execution lifecycle is not accepting work")
	if settleErr := k.turns.FailAdmittedTurnStart(
		context.Background(),
		admission.Request.GetAgentId(),
		admission.Admission.GetTurnId(),
		"evaluation Turn start rejected",
		err,
	); settleErr != nil {
		return fmt.Errorf("start evaluation Turn: %v; settle rejection: %w", err, settleErr)
	}
	return err
}

func (k *CanonicalEvaluationTurnKernel) Recover(
	ctx context.Context,
	ptid string,
	turnID string,
) error {
	if k == nil || k.turns == nil {
		return fmt.Errorf("canonical Turn recovery is unavailable")
	}
	return k.turns.InterruptTurn(
		ctx,
		ptid,
		turnID,
		"station_restart_interrupted",
	)
}

func (k *CanonicalEvaluationTurnKernel) Cancel(
	ctx context.Context,
	ptid string,
	turnID string,
) error {
	if k == nil || k.turns == nil {
		return fmt.Errorf("canonical Turn cancellation is unavailable")
	}
	_, err := k.turns.RequestCancelTurn(ctx, ptid, turnID)
	return err
}

func (k *CanonicalEvaluationTurnKernel) Interrupt(
	ctx context.Context,
	ptid string,
	turnID string,
	reasonCode string,
) error {
	if k == nil || k.turns == nil {
		return fmt.Errorf("canonical Turn interruption is unavailable")
	}
	return k.turns.InterruptTurn(ctx, ptid, turnID, reasonCode)
}

func (k *CanonicalEvaluationTurnKernel) Read(
	ctx context.Context,
	ptid string,
	turnID string,
) (*EvaluationTurnReadback, error) {
	if k == nil || k.db == nil {
		return nil, fmt.Errorf("canonical Turn readback is unavailable")
	}
	var turn persistence.AgentTurn
	err := k.db.WithContext(ctx).
		Table("agent_turns AS turns").
		Select("turns.*").
		Joins(
			"JOIN agent_conversations AS conversations ON conversations.id = turns.conversation_id",
		).
		Where("turns.id = ? AND conversations.actor_ptid = ?", turnID, ptid).
		First(&turn).Error
	if err != nil {
		return nil, err
	}
	var trace persistence.TurnTrace
	traceID := ""
	if err := k.db.WithContext(ctx).
		Where("turn_id = ?", turn.ID).
		First(&trace).Error; err == nil {
		traceID = trace.ID
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("read evaluation Turn trace: %w", err)
	}
	return &EvaluationTurnReadback{
		TurnID:         turn.ID,
		Status:         domain.TurnStatus(turn.Status),
		Output:         stringValue(turn.FinalResponse),
		TerminalReason: turn.TerminalReason,
		TraceID:        traceID,
		StartedAt:      turn.StartedAt,
		EndedAt:        turn.EndedAt,
	}, nil
}

func (s *EvaluationService) RunWorker(ctx context.Context) {
	if s == nil {
		return
	}
	ticker := time.NewTicker(evaluationWorkerInterval)
	defer ticker.Stop()
	for {
		if err := s.ReconcileEvaluationRuns(ctx); err != nil {
			logger.Errorf(ctx, "reconcile evaluation runs failed: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.wake:
		}
	}
}

func (s *EvaluationService) ReconcileEvaluationRuns(ctx context.Context) error {
	if s == nil || s.turns == nil {
		return nil
	}
	runs, err := s.repository.ListActiveRuns(
		ctx,
		[]int32{
			int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING),
			int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING),
		},
		evaluationWorkerBatch,
	)
	if err != nil {
		return err
	}
	for index := range runs {
		run := runs[index]
		var reconcileErr error
		switch model.EvaluationRunStatus(run.Status) {
		case model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING:
			reconcileErr = s.reconcileRunningEvaluationRun(ctx, &run)
		case model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING:
			reconcileErr = s.reconcileCancellingEvaluationRun(ctx, &run)
		}
		if reconcileErr != nil {
			logger.Errorf(
				ctx,
				"reconcile evaluation run failed: run_id=%s err=%v",
				run.RunID,
				reconcileErr,
			)
		}
	}
	return nil
}

func (s *EvaluationService) reconcileRunningEvaluationRun(
	ctx context.Context,
	run *persistence.EvaluationRun,
) error {
	runCases, err := s.repository.ListRunCases(ctx, run.RunID)
	if err != nil {
		return err
	}
	if len(runCases) == 0 {
		return s.failEvaluationRunWithoutTurns(
			ctx,
			run,
			"evaluation run has no case snapshots",
		)
	}
	attempts, err := s.ensureEvaluationAttempts(ctx, run, runCases)
	if err != nil {
		return err
	}
	caseByID := make(map[string]persistence.EvaluationRunCase, len(runCases))
	for index := range runCases {
		caseByID[runCases[index].CaseID] = runCases[index]
	}
	for index := range attempts {
		attempt := attempts[index]
		runCase := caseByID[attempt.CaseID]
		switch {
		case model.EvaluationAttemptStatus(attempt.Status) ==
			model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING &&
			attempt.TurnID == nil:
			if err := s.scheduleEvaluationAttempt(ctx, run, &runCase, &attempt); err != nil {
				if settleErr := s.failEvaluationAttempt(
					ctx,
					run,
					&runCase,
					&attempt,
					"evaluation Turn admission failed",
					err,
				); settleErr != nil {
					return settleErr
				}
			}
		case model.EvaluationAttemptStatus(attempt.Status) ==
			model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING &&
			attempt.TurnID != nil:
			if err := s.reconcileEvaluationTurn(ctx, run, &runCase, &attempt); err != nil &&
				!errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
	}
	return nil
}

func (s *EvaluationService) ensureEvaluationAttempts(
	ctx context.Context,
	run *persistence.EvaluationRun,
	runCases []persistence.EvaluationRunCase,
) ([]persistence.EvaluationCaseAttempt, error) {
	now := s.now()
	for index := range runCases {
		runCase := runCases[index]
		attemptNumber := runCase.SourceAttemptNo + 1
		if attemptNumber == 0 {
			attemptNumber = 1
		}
		_, _, err := s.repository.EnsureAttempt(
			ctx,
			&persistence.EvaluationCaseAttempt{
				AttemptID: evaluationID("evalattempt"),
				RunID:     run.RunID,
				CaseID:    runCase.CaseID,
				Attempt:   attemptNumber,
				PTID:      run.PTID,
				IdempotencyKey: evaluationAttemptIdempotencyKey(
					run.RunID,
					runCase.CaseID,
					attemptNumber,
				),
				SourceAttemptID: cloneOptionalString(runCase.SourceAttemptID),
				SourceResultID:  cloneOptionalString(runCase.SourceResultID),
				Status:          int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING),
				CreatedAt:       now,
				UpdatedAt:       now,
			},
		)
		if err != nil {
			return nil, err
		}
	}
	return s.repository.ListAttempts(ctx, run.RunID)
}

func (s *EvaluationService) scheduleEvaluationAttempt(
	ctx context.Context,
	run *persistence.EvaluationRun,
	runCase *persistence.EvaluationRunCase,
	attempt *persistence.EvaluationCaseAttempt,
) error {
	now := s.now()
	claim := evaluationID("evalclaim")
	claimed, err := s.repository.ClaimAttempt(
		ctx,
		attempt.AttemptID,
		claim,
		now,
		now.Add(evaluationSchedulerLease),
		int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING),
	)
	if err != nil || !claimed {
		return err
	}
	spec, err := evaluationTurnSpec(run, runCase, attempt)
	if err != nil {
		return err
	}
	admission, err := s.turns.Admit(ctx, spec)
	if err != nil {
		return err
	}
	turnID := admission.Admission.GetTurnId()
	bound, err := s.repository.BindAttemptTurn(
		ctx,
		attempt.AttemptID,
		claim,
		turnID,
		spec.ConversationID,
		now,
		int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING),
		int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING),
	)
	if err != nil {
		return err
	}
	if !bound {
		if cancelErr := s.turns.Cancel(ctx, run.PTID, turnID); cancelErr != nil {
			return fmt.Errorf(
				"evaluation attempt %s lost scheduler claim and failed to cancel admitted Turn %s: %w",
				attempt.AttemptID,
				turnID,
				cancelErr,
			)
		}
		return fmt.Errorf(
			"evaluation attempt %s lost scheduler claim before Turn binding",
			attempt.AttemptID,
		)
	}
	if err := s.turns.Start(admission); err != nil {
		return err
	}
	return nil
}

func (s *EvaluationService) reconcileEvaluationTurn(
	ctx context.Context,
	run *persistence.EvaluationRun,
	runCase *persistence.EvaluationRunCase,
	attempt *persistence.EvaluationCaseAttempt,
) error {
	readback, err := s.turns.Read(ctx, run.PTID, stringValue(attempt.TurnID))
	if err != nil {
		return err
	}
	if !evaluationTerminalTurnStatus(readback.Status) {
		return nil
	}
	return s.settleEvaluationAttempt(ctx, runCase, attempt, readback)
}

func (s *EvaluationService) settleEvaluationAttempt(
	ctx context.Context,
	runCase *persistence.EvaluationRunCase,
	attempt *persistence.EvaluationCaseAttempt,
	readback *EvaluationTurnReadback,
) error {
	return s.repository.Transaction(
		ctx,
		func(tx *persistence.EvaluationRepository) error {
			run, err := tx.GetRunByID(ctx, attempt.RunID, true)
			if err != nil {
				return err
			}
			if model.EvaluationRunStatus(run.Status) !=
				model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING ||
				run.CancelIntentFence != "" {
				return nil
			}
			current, err := tx.GetAttempt(ctx, attempt.AttemptID, true)
			if err != nil {
				return err
			}
			if evaluationTerminalAttemptStatus(current.Status) {
				return nil
			}
			status := evaluationAttemptStatusFromTurn(readback.Status)
			rubric, err := frozenEvaluationRubric(
				runCase.Rubric,
				runCase.RubricVersion,
			)
			if err != nil {
				return err
			}
			score := 0.0
			if status ==
				model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_COMPLETED {
				score, _, err = evaluateEvaluationRubric(
					rubric.name,
					readback.Output,
					runCase.Expected,
				)
				if err != nil {
					return err
				}
			}
			now := s.now()
			endedAt := now
			if readback.EndedAt != nil {
				endedAt = readback.EndedAt.UTC()
			}
			latency := uint64(0)
			if !readback.StartedAt.IsZero() && endedAt.After(readback.StartedAt) {
				latency = uint64(endedAt.Sub(readback.StartedAt).Milliseconds())
			}
			var attemptError *model.EvaluationError
			if status != model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_COMPLETED {
				attemptError = &model.EvaluationError{
					Code:           model.EvaluationErrorCode_EVALUATION_ERROR_CODE_EVALUATOR_UNAVAILABLE,
					Retryable:      true,
					RecoveryAction: "retry_case",
					LocaleKey:      evaluationLocaleKey(model.EvaluationErrorCode_EVALUATION_ERROR_CODE_EVALUATOR_UNAVAILABLE),
					Terminal:       true,
					Details: map[string]string{
						"turn_id":     readback.TurnID,
						"turn_status": string(readback.Status),
					},
				}
			}
			errorPayload, err := marshalEvaluationMessage(attemptError)
			if err != nil {
				return err
			}
			result := &persistence.EvaluationResult{
				ResultID:       evaluationID("evalresult"),
				RunID:          run.RunID,
				CaseID:         current.CaseID,
				AttemptID:      current.AttemptID,
				PTID:           run.PTID,
				OutputRef:      "turn:" + readback.TurnID,
				Output:         readback.Output,
				Score:          score,
				RubricVersion:  rubric.version,
				TerminalStatus: int32(status),
				LatencyMS:      latency,
				TurnTraceID:    readback.TraceID,
				CreatedAt:      endedAt,
			}
			if _, err := tx.CreateResult(ctx, result); err != nil {
				return err
			}
			updated, err := tx.UpdateAttempt(
				ctx,
				current.AttemptID,
				[]int32{
					int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING),
					int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING),
				},
				map[string]interface{}{
					"status":        int32(status),
					"output_ref":    result.OutputRef,
					"score":         score,
					"error_payload": errorPayload,
					"terminal_at":   endedAt,
					"updated_at":    now,
				},
			)
			if err != nil {
				return err
			}
			if !updated {
				return nil
			}
			return s.refreshEvaluationRunTerminalStateTx(
				ctx,
				tx,
				run,
				current.CaseID,
				current.AttemptID,
				result.ResultID,
				attemptError,
				false,
			)
		},
	)
}

func (s *EvaluationService) failEvaluationAttempt(
	ctx context.Context,
	run *persistence.EvaluationRun,
	runCase *persistence.EvaluationRunCase,
	attempt *persistence.EvaluationCaseAttempt,
	reason string,
	cause error,
) error {
	rubric, err := frozenEvaluationRubric(
		runCase.Rubric,
		runCase.RubricVersion,
	)
	if err != nil {
		return err
	}
	detail := &model.EvaluationError{
		Code:           model.EvaluationErrorCode_EVALUATION_ERROR_CODE_EVALUATOR_UNAVAILABLE,
		Retryable:      true,
		RecoveryAction: "retry_case",
		LocaleKey:      evaluationLocaleKey(model.EvaluationErrorCode_EVALUATION_ERROR_CODE_EVALUATOR_UNAVAILABLE),
		Terminal:       true,
		Details: map[string]string{
			"run_id":      run.RunID,
			"attempt_id":  attempt.AttemptID,
			"reason_code": reason,
		},
	}
	errorPayload, err := marshalEvaluationMessage(detail)
	if err != nil {
		return err
	}
	now := s.now()
	return s.repository.Transaction(
		ctx,
		func(tx *persistence.EvaluationRepository) error {
			currentRun, err := tx.GetRunByID(ctx, run.RunID, true)
			if err != nil {
				return err
			}
			if model.EvaluationRunStatus(currentRun.Status) !=
				model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING ||
				currentRun.CancelIntentFence != "" {
				return nil
			}
			result := &persistence.EvaluationResult{
				ResultID:       evaluationID("evalresult"),
				RunID:          currentRun.RunID,
				CaseID:         attempt.CaseID,
				AttemptID:      attempt.AttemptID,
				PTID:           currentRun.PTID,
				OutputRef:      evaluationTurnOutputRef(stringValue(attempt.TurnID)),
				RubricVersion:  rubric.version,
				TerminalStatus: int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_FAILED),
				CreatedAt:      now,
			}
			if _, err := tx.CreateResult(ctx, result); err != nil {
				return err
			}
			updated, err := tx.UpdateAttempt(
				ctx,
				attempt.AttemptID,
				[]int32{
					int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING),
					int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING),
				},
				map[string]interface{}{
					"status":        int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_FAILED),
					"error_payload": errorPayload,
					"terminal_at":   now,
					"updated_at":    now,
				},
			)
			if err != nil || !updated {
				return err
			}
			return s.refreshEvaluationRunTerminalStateTx(
				ctx,
				tx,
				currentRun,
				attempt.CaseID,
				attempt.AttemptID,
				result.ResultID,
				detail,
				false,
			)
		},
	)
}

func (s *EvaluationService) reconcileCancellingEvaluationRun(
	ctx context.Context,
	run *persistence.EvaluationRun,
) error {
	runCases, err := s.repository.ListRunCases(ctx, run.RunID)
	if err != nil {
		return err
	}
	attempts, err := s.ensureEvaluationAttempts(ctx, run, runCases)
	if err != nil {
		return err
	}
	caseByID := make(map[string]persistence.EvaluationRunCase, len(runCases))
	for index := range runCases {
		caseByID[runCases[index].CaseID] = runCases[index]
	}
	now := s.now()
	for index := range attempts {
		attempt := attempts[index]
		runCase, exists := caseByID[attempt.CaseID]
		if !exists {
			return fmt.Errorf(
				"evaluation run case %s is missing for attempt %s",
				attempt.CaseID,
				attempt.AttemptID,
			)
		}
		if evaluationTerminalAttemptStatus(attempt.Status) {
			continue
		}
		if attempt.TurnID == nil {
			if err := s.acknowledgeEvaluationCancellation(
				ctx,
				run,
				&runCase,
				&attempt,
				false,
			); err != nil {
				return err
			}
			continue
		}
		turnID := stringValue(attempt.TurnID)
		if err := s.turns.Cancel(ctx, run.PTID, turnID); err != nil {
			readback, readErr := s.turns.Read(ctx, run.PTID, turnID)
			if readErr != nil || !evaluationTerminalTurnStatus(readback.Status) {
				continue
			}
		}
		readback, err := s.turns.Read(ctx, run.PTID, turnID)
		if err == nil && evaluationTerminalTurnStatus(readback.Status) {
			if err := s.acknowledgeEvaluationCancellation(
				ctx,
				run,
				&runCase,
				&attempt,
				false,
			); err != nil {
				return err
			}
		}
	}
	current, err := s.repository.GetRunByID(ctx, run.RunID, false)
	if err != nil {
		return err
	}
	if current.CancelAckDeadline != nil &&
		!s.now().Before(current.CancelAckDeadline.UTC()) {
		attempts, err = s.repository.ListAttempts(ctx, run.RunID)
		if err != nil {
			return err
		}
		for index := range attempts {
			if evaluationTerminalAttemptStatus(attempts[index].Status) {
				continue
			}
			runCase, exists := caseByID[attempts[index].CaseID]
			if !exists {
				return fmt.Errorf(
					"evaluation run case %s is missing for attempt %s",
					attempts[index].CaseID,
					attempts[index].AttemptID,
				)
			}
			timedOut := false
			if attempts[index].TurnID != nil {
				turnID := stringValue(attempts[index].TurnID)
				if err := s.turns.Interrupt(
					ctx,
					run.PTID,
					turnID,
					"evaluation_cancel_ack_timeout",
				); err != nil {
					return err
				}
				readback, err := s.turns.Read(ctx, run.PTID, turnID)
				if err != nil {
					return err
				}
				if !evaluationTerminalTurnStatus(readback.Status) {
					return fmt.Errorf(
						"evaluation Turn %s remained non-terminal after interruption fence",
						turnID,
					)
				}
				timedOut = readback.Status == domain.TurnStatusInterrupted
			}
			if err := s.acknowledgeEvaluationCancellation(
				ctx,
				run,
				&runCase,
				&attempts[index],
				timedOut,
			); err != nil {
				return err
			}
		}
	}
	return s.finalizeEvaluationCancellationIfReady(ctx, run.RunID, now)
}

func (s *EvaluationService) acknowledgeEvaluationCancellation(
	ctx context.Context,
	run *persistence.EvaluationRun,
	runCase *persistence.EvaluationRunCase,
	attempt *persistence.EvaluationCaseAttempt,
	timedOut bool,
) error {
	rubric, err := frozenEvaluationRubric(
		runCase.Rubric,
		runCase.RubricVersion,
	)
	if err != nil {
		return err
	}
	now := s.now()
	status := model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_CANCELLED
	var detail *model.EvaluationError
	if timedOut {
		status = model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_INTERRUPTED
		detail = &model.EvaluationError{
			Code:           model.EvaluationErrorCode_EVALUATION_ERROR_CODE_CANCEL_ACK_TIMEOUT,
			Retryable:      true,
			RecoveryAction: "retry_case",
			LocaleKey:      evaluationLocaleKey(model.EvaluationErrorCode_EVALUATION_ERROR_CODE_CANCEL_ACK_TIMEOUT),
			Terminal:       true,
			Details: map[string]string{
				"run_id":     run.RunID,
				"attempt_id": attempt.AttemptID,
			},
		}
	}
	errorPayload, err := marshalEvaluationMessage(detail)
	if err != nil {
		return err
	}
	return s.repository.Transaction(
		ctx,
		func(tx *persistence.EvaluationRepository) error {
			current, err := tx.GetAttempt(ctx, attempt.AttemptID, true)
			if err != nil {
				return err
			}
			if evaluationTerminalAttemptStatus(current.Status) {
				return nil
			}
			result := &persistence.EvaluationResult{
				ResultID:       evaluationID("evalresult"),
				RunID:          run.RunID,
				CaseID:         current.CaseID,
				AttemptID:      current.AttemptID,
				PTID:           run.PTID,
				OutputRef:      evaluationTurnOutputRef(stringValue(current.TurnID)),
				RubricVersion:  rubric.version,
				TerminalStatus: int32(status),
				CreatedAt:      now,
			}
			if _, err := tx.CreateResult(ctx, result); err != nil {
				return err
			}
			updates := map[string]interface{}{
				"status":                     int32(status),
				"error_payload":              errorPayload,
				"terminal_at":                now,
				"scheduler_claim_expires_at": now,
				"updated_at":                 now,
			}
			if !timedOut {
				updates["cancellation_ack_at"] = now
			}
			_, err = tx.UpdateAttempt(
				ctx,
				current.AttemptID,
				[]int32{
					int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING),
					int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING),
				},
				updates,
			)
			return err
		},
	)
}

func (s *EvaluationService) finalizeEvaluationCancellationIfReady(
	ctx context.Context,
	runID string,
	now time.Time,
) error {
	return s.repository.Transaction(
		ctx,
		func(tx *persistence.EvaluationRepository) error {
			run, err := tx.GetRunByID(ctx, runID, true)
			if err != nil {
				return err
			}
			if model.EvaluationRunStatus(run.Status) !=
				model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING {
				return nil
			}
			attempts, err := tx.ListAttempts(ctx, run.RunID)
			if err != nil {
				return err
			}
			for index := range attempts {
				if !evaluationTerminalAttemptStatus(attempts[index].Status) {
					return nil
				}
			}
			timedOut := false
			for index := range attempts {
				detail, err := decodeEvaluationError(attempts[index].ErrorPayload)
				if err != nil {
					return err
				}
				if detail.GetCode() ==
					model.EvaluationErrorCode_EVALUATION_ERROR_CODE_CANCEL_ACK_TIMEOUT {
					timedOut = true
					break
				}
			}
			return s.refreshEvaluationRunTerminalStateTx(
				ctx,
				tx,
				run,
				"",
				"",
				"",
				nil,
				timedOut,
			)
		},
	)
}

func (s *EvaluationService) refreshEvaluationRunTerminalStateTx(
	ctx context.Context,
	tx *persistence.EvaluationRepository,
	run *persistence.EvaluationRun,
	caseID string,
	attemptID string,
	resultID string,
	eventError *model.EvaluationError,
	cancelTimedOut bool,
) error {
	attempts, err := tx.ListAttempts(ctx, run.RunID)
	if err != nil {
		return err
	}
	terminalCount := uint32(0)
	completedCount := uint32(0)
	failedCount := uint32(0)
	cancelledCount := uint32(0)
	for index := range attempts {
		if !evaluationTerminalAttemptStatus(attempts[index].Status) {
			continue
		}
		terminalCount++
		switch model.EvaluationAttemptStatus(attempts[index].Status) {
		case model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_COMPLETED:
			completedCount++
		case model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_FAILED:
			failedCount++
		case model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_CANCELLED,
			model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_INTERRUPTED:
			cancelledCount++
		}
	}
	now := s.now()
	run.CompletedCases = terminalCount
	run.Revision++
	run.UpdatedAt = now
	updates := map[string]interface{}{
		"completed_cases": terminalCount,
		"revision":        run.Revision,
		"updated_at":      now,
	}
	terminal := terminalCount == run.TotalCases
	if model.EvaluationRunStatus(run.Status) ==
		model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING {
		terminal = len(attempts) == int(run.TotalCases) &&
			terminalCount == uint32(len(attempts))
	}
	if terminal {
		results, err := tx.ListResults(ctx, run.RunID)
		if err != nil {
			return err
		}
		metrics := evaluationMetrics(run.TotalCases, attempts, results)
		status := model.EvaluationRunStatus_EVALUATION_RUN_STATUS_COMPLETED
		switch {
		case model.EvaluationRunStatus(run.Status) ==
			model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING &&
			cancelTimedOut:
			status = model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PARTIAL
			metrics.Comparable = false
			eventError = &model.EvaluationError{
				Code:           model.EvaluationErrorCode_EVALUATION_ERROR_CODE_CANCEL_ACK_TIMEOUT,
				Retryable:      true,
				RecoveryAction: "retry_incomplete_cases",
				LocaleKey:      evaluationLocaleKey(model.EvaluationErrorCode_EVALUATION_ERROR_CODE_CANCEL_ACK_TIMEOUT),
				Terminal:       true,
				Details:        map[string]string{"run_id": run.RunID},
			}
		case model.EvaluationRunStatus(run.Status) ==
			model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING:
			status = model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLED
			metrics.Comparable = false
		case failedCount > 0 && completedCount == 0:
			status = model.EvaluationRunStatus_EVALUATION_RUN_STATUS_FAILED
			metrics.Comparable = false
		case failedCount > 0 || cancelledCount > 0:
			status = model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PARTIAL
			metrics.Comparable = false
		}
		metricsPayload, err := marshalEvaluationMessage(metrics)
		if err != nil {
			return err
		}
		errorPayload, err := marshalEvaluationMessage(eventError)
		if err != nil {
			return err
		}
		run.Status = int32(status)
		run.TerminalFence = evaluationID("evalterminal")
		run.TerminalAt = &now
		run.MetricsPayload = metricsPayload
		run.ErrorPayload = errorPayload
		updates["status"] = run.Status
		updates["terminal_fence"] = run.TerminalFence
		updates["terminal_at"] = now
		updates["metrics_payload"] = metricsPayload
		updates["error_payload"] = errorPayload
	}
	expectedStatuses := []int32{
		int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING),
	}
	extraPredicate := "cancel_intent_fence = ''"
	if model.EvaluationRunStatus(run.Status) ==
		model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLED ||
		(model.EvaluationRunStatus(run.Status) ==
			model.EvaluationRunStatus_EVALUATION_RUN_STATUS_PARTIAL &&
			run.CancelIntentFence != "") {
		expectedStatuses = []int32{
			int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_CANCELLING),
		}
		extraPredicate = "cancel_intent_fence <> ''"
	}
	expectedRevision := run.Revision - 1
	updated, err := tx.UpdateRunCAS(
		ctx,
		run.PTID,
		run.RunID,
		expectedRevision,
		expectedStatuses,
		extraPredicate,
		updates,
	)
	if err != nil {
		return err
	}
	if !updated {
		return nil
	}
	return tx.AppendEvent(
		ctx,
		newEvaluationRunEvent(
			run,
			caseID,
			attemptID,
			resultID,
			eventError,
			now,
		),
	)
}

func (s *EvaluationService) failEvaluationRunWithoutTurns(
	ctx context.Context,
	run *persistence.EvaluationRun,
	reason string,
) error {
	detail := &model.EvaluationError{
		Code:           model.EvaluationErrorCode_EVALUATION_ERROR_CODE_EVALUATOR_UNAVAILABLE,
		Retryable:      true,
		RecoveryAction: "fix_dataset",
		LocaleKey:      evaluationLocaleKey(model.EvaluationErrorCode_EVALUATION_ERROR_CODE_EVALUATOR_UNAVAILABLE),
		Terminal:       true,
		Details: map[string]string{
			"run_id":      run.RunID,
			"reason_code": reason,
		},
	}
	return s.repository.Transaction(
		ctx,
		func(tx *persistence.EvaluationRepository) error {
			current, err := tx.GetRunByID(ctx, run.RunID, true)
			if err != nil {
				return err
			}
			if model.EvaluationRunStatus(current.Status) !=
				model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING {
				return nil
			}
			now := s.now()
			metrics := &model.EvaluationMetrics{
				TotalCases:     current.TotalCases,
				MetricsVersion: evaluationMetricsVersion,
				Comparable:     false,
				FailedCases:    current.TotalCases,
			}
			metricsPayload, err := marshalEvaluationMessage(metrics)
			if err != nil {
				return err
			}
			errorPayload, err := marshalEvaluationMessage(detail)
			if err != nil {
				return err
			}
			updated, err := tx.UpdateRunCAS(
				ctx,
				current.PTID,
				current.RunID,
				current.Revision,
				[]int32{int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING)},
				"cancel_intent_fence = ''",
				map[string]interface{}{
					"status":          int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_FAILED),
					"revision":        current.Revision + 1,
					"terminal_fence":  evaluationID("evalterminal"),
					"terminal_at":     now,
					"metrics_payload": metricsPayload,
					"error_payload":   errorPayload,
					"updated_at":      now,
				},
			)
			if err != nil || !updated {
				return err
			}
			current.Status = int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_FAILED)
			current.Revision++
			current.TerminalAt = &now
			current.MetricsPayload = metricsPayload
			current.ErrorPayload = errorPayload
			current.UpdatedAt = now
			return tx.AppendEvent(ctx, newEvaluationRunEvent(current, "", "", "", detail, now))
		},
	)
}

func (s *EvaluationService) RecoverInterruptedTurns(
	ctx context.Context,
) error {
	if s == nil || s.turns == nil {
		return nil
	}
	runs, err := s.repository.ListActiveRuns(
		ctx,
		[]int32{int32(model.EvaluationRunStatus_EVALUATION_RUN_STATUS_RUNNING)},
		0,
	)
	if err != nil {
		return err
	}
	for runIndex := range runs {
		run := runs[runIndex]
		attempts, err := s.repository.ListAttempts(ctx, run.RunID)
		if err != nil {
			return err
		}
		for attemptIndex := range attempts {
			attempt := attempts[attemptIndex]
			if model.EvaluationAttemptStatus(attempt.Status) !=
				model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING ||
				attempt.TurnID == nil {
				continue
			}
			turnID := stringValue(attempt.TurnID)
			readback, readErr := s.turns.Read(ctx, run.PTID, turnID)
			if readErr != nil {
				return fmt.Errorf(
					"read Evaluation Turn before restart recovery: run_id=%s attempt_id=%s turn_id=%s: %w",
					run.RunID,
					attempt.AttemptID,
					turnID,
					readErr,
				)
			}
			if evaluationTerminalTurnStatus(readback.Status) {
				continue
			}
			if err := s.turns.Recover(ctx, run.PTID, turnID); err != nil {
				return fmt.Errorf(
					"recover Evaluation Turn: run_id=%s attempt_id=%s turn_id=%s: %w",
					run.RunID,
					attempt.AttemptID,
					turnID,
					err,
				)
			}
		}
	}
	return nil
}

func evaluationTurnSpec(
	run *persistence.EvaluationRun,
	runCase *persistence.EvaluationRunCase,
	attempt *persistence.EvaluationCaseAttempt,
) (EvaluationTurnSpec, error) {
	snapshot, err := decodeEvaluationRuntimeSnapshot(run)
	if err != nil {
		return EvaluationTurnSpec{}, err
	}
	var config frozenEvaluationAgentConfig
	if err := json.Unmarshal(run.TargetConfig, &config); err != nil {
		return EvaluationTurnSpec{}, evaluationTargetInvalid(
			run.TargetAgentID,
			run.ReadinessSnapshotID,
			"target_agent_config_decode_failed",
			err,
		)
	}
	return EvaluationTurnSpec{
		PTID:                run.PTID,
		RunID:               run.RunID,
		AttemptID:           attempt.AttemptID,
		CaseID:              runCase.CaseID,
		ConversationID:      evaluationConversationID(attempt.AttemptID),
		Input:               runCase.Input,
		AgentID:             run.TargetAgentID,
		Identity:            config.Identity,
		AgentConfigPrompt:   config.AgentConfigPrompt,
		ProviderID:          snapshot.GetProviderId(),
		ModelID:             snapshot.GetModelId(),
		Effort:              config.Effort,
		ThinkingMode:        snapshot.GetThinkingMode(),
		ReadinessSnapshotID: run.ReadinessSnapshotID,
		RuntimeSnapshot:     snapshot,
		TargetAgentRevision: run.TargetAgentRevision,
		ClientIdempotencyKey: evaluationAttemptIdempotencyKey(
			run.RunID,
			runCase.CaseID,
			attempt.Attempt,
		),
	}, nil
}

func evaluationConversationID(attemptID string) string {
	return "evalconv_" + evaluationShortHash(attemptID)
}

func evaluationAttemptIdempotencyKey(
	runID string,
	caseID string,
	attempt uint32,
) string {
	return fmt.Sprintf(
		"evaluation:%s:%s:%d",
		evaluationShortHash(runID),
		evaluationShortHash(caseID),
		attempt,
	)
}

func evaluationTurnOutputRef(turnID string) string {
	turnID = strings.TrimSpace(turnID)
	if turnID == "" {
		return ""
	}
	return "turn:" + turnID
}

func evaluationTurnPayloadHash(spec EvaluationTurnSpec) string {
	payload, _ := json.Marshal(map[string]interface{}{
		"run_id":      spec.RunID,
		"attempt_id":  spec.AttemptID,
		"case_id":     spec.CaseID,
		"agent_id":    spec.AgentID,
		"input":       spec.Input,
		"provider_id": spec.ProviderID,
		"model_id":    spec.ModelID,
		"snapshot_id": spec.ReadinessSnapshotID,
	})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func evaluationShortHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:12])
}

func evaluationTerminalTurnStatus(status domain.TurnStatus) bool {
	switch status {
	case domain.TurnStatusCompleted,
		domain.TurnStatusFailed,
		domain.TurnStatusCancelled,
		domain.TurnStatusInterrupted:
		return true
	default:
		return false
	}
}

func evaluationAttemptStatusFromTurn(
	status domain.TurnStatus,
) model.EvaluationAttemptStatus {
	switch status {
	case domain.TurnStatusCompleted:
		return model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_COMPLETED
	case domain.TurnStatusCancelled:
		return model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_CANCELLED
	case domain.TurnStatusInterrupted:
		return model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_INTERRUPTED
	default:
		return model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_FAILED
	}
}

func evaluationMetrics(
	totalCases uint32,
	attempts []persistence.EvaluationCaseAttempt,
	results []persistence.EvaluationResult,
) *model.EvaluationMetrics {
	metrics := &model.EvaluationMetrics{
		TotalCases:     totalCases,
		MetricsVersion: evaluationMetricsVersion,
		Comparable:     true,
	}
	scoreTotal := 0.0
	scored := uint32(0)
	for index := range attempts {
		if !evaluationTerminalAttemptStatus(attempts[index].Status) {
			continue
		}
		metrics.TerminalCases++
		switch model.EvaluationAttemptStatus(attempts[index].Status) {
		case model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_FAILED:
			metrics.FailedCases++
		case model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_CANCELLED,
			model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_INTERRUPTED:
			metrics.CancelledCases++
		}
	}
	for index := range results {
		if model.EvaluationAttemptStatus(results[index].TerminalStatus) !=
			model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_COMPLETED {
			continue
		}
		scoreTotal += results[index].Score
		scored++
		if results[index].Score >= 1 {
			metrics.PassedCases++
		}
	}
	if scored > 0 {
		metrics.AverageScore = scoreTotal / float64(scored)
	}
	if metrics.TerminalCases != totalCases ||
		metrics.FailedCases > 0 ||
		metrics.CancelledCases > 0 {
		metrics.Comparable = false
	}
	return metrics
}
