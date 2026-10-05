package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const goalDirectModelSource = "goal.direct_model.v1"

type goalDirectModelInput struct {
	GoalID             string                 `json:"goal_id"`
	GoalNodeID         string                 `json:"goal_node_id"`
	TaskID             string                 `json:"task_id"`
	StepID             string                 `json:"step_id"`
	AttemptID          string                 `json:"attempt_id"`
	AgentID            string                 `json:"agent_id"`
	Title              string                 `json:"title"`
	Outcome            string                 `json:"outcome"`
	ProviderID         string                 `json:"provider_id"`
	Model              string                 `json:"model"`
	Effort             string                 `json:"effort"`
	ThinkingMode       domain.ThinkingMode    `json:"thinking_mode"`
	Budget             *model.AgentGoalBudget `json:"budget"`
	AcceptanceCriteria int                    `json:"acceptance_criteria"`
}

type goalDirectModelRuntime struct {
	Run   persistence.DirectRun
	Task  persistence.TaskRun
	Step  persistence.ExecutionStep
	Node  persistence.AgentGoalNode
	Input goalDirectModelInput
}

type GoalDirectModelExecutor struct {
	db         *gorm.DB
	provider   directRunProviderExecutor
	writer     *TaskEventWriter
	onTerminal goalTaskTerminalObserver
	now        func() time.Time
}

type goalTaskTerminalObserver interface {
	OnTaskTerminal(
		context.Context,
		string,
		string,
	) error
}

func NewGoalDirectModelExecutor(
	db *gorm.DB,
	provider *ProviderService,
) *GoalDirectModelExecutor {
	var executor directRunProviderExecutor
	if provider != nil {
		executor = providerServiceDirectRunExecutor{providerService: provider}
	}
	return &GoalDirectModelExecutor{
		db:       db,
		provider: executor,
		writer:   NewTaskEventWriter(),
		now:      time.Now,
	}
}

func (e *GoalDirectModelExecutor) SetGoalTerminalObserver(
	observer goalTaskTerminalObserver,
) {
	if e == nil {
		return
	}
	e.onTerminal = observer
}

func (e *GoalDirectModelExecutor) PrepareTx(
	ctx context.Context,
	tx *gorm.DB,
	goal *persistence.AgentGoal,
	execution *GoalExecutionSnapshot,
) error {
	if e == nil || tx == nil || goal == nil || execution == nil ||
		execution.Node == nil || execution.Task == nil || execution.Step == nil {
		return goalInternal("Prepare Goal Direct Model execution", nil)
	}

	var agent persistence.Agent
	err := tx.WithContext(ctx).
		Where(
			"owner_actor_ptid = ? AND provider_id <> '' AND model_name <> ''",
			goal.OwnerPTID,
		).
		Order("updated_at DESC, id ASC").
		First(&agent).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return goalInternal("Resolve Goal Direct Model Agent", err)
	}
	if err == gorm.ErrRecordNotFound {
		return goalAdmissionRejected(goal.GoalID, "executor_unavailable")
	}
	provider, err := loadOwnedGoalDirectModelProvider(
		ctx,
		tx,
		goal.OwnerPTID,
		agent.ProviderID,
	)
	if err != nil || isCLIProviderRecord(provider) {
		return goalAdmissionRejected(goal.GoalID, "executor_unavailable")
	}

	budget := &model.AgentGoalBudget{}
	if err := json.Unmarshal(goal.BudgetJSON, budget); err != nil {
		return goalInternal("Decode Goal Direct Model budget", err)
	}
	var criteria []json.RawMessage
	if err := json.Unmarshal(goal.AcceptanceCriteriaJSON, &criteria); err != nil {
		return goalInternal("Decode Goal Direct Model acceptance criteria", err)
	}

	runID := stableGoalDirectRunID(goal.GoalID, execution.Node.NodeID)
	input := goalDirectModelInput{
		GoalID:             goal.GoalID,
		GoalNodeID:         execution.Node.NodeID,
		TaskID:             execution.Task.TaskID,
		StepID:             execution.Step.StepID,
		AttemptID:          execution.Step.AttemptID,
		AgentID:            agent.ID,
		Title:              firstNonEmptyString(execution.Task.Title, goal.Title),
		Outcome:            firstNonEmptyString(execution.Task.Description, goal.Outcome),
		ProviderID:         agent.ProviderID,
		Model:              agent.ModelName,
		Effort:             agent.Effort,
		ThinkingMode:       domain.ThinkingMode(agent.ThinkingMode),
		Budget:             budget,
		AcceptanceCriteria: len(criteria),
	}
	inputJSON, err := json.Marshal(input)
	if err != nil {
		return goalInternal("Encode Goal Direct Model input", err)
	}

	now := e.now().UTC()
	run := &persistence.DirectRun{
		DirectRunID:       runID,
		TaskID:            execution.Task.TaskID,
		GoalID:            goal.GoalID,
		GoalNodeID:        execution.Node.NodeID,
		StepID:            execution.Step.StepID,
		AttemptID:         execution.Step.AttemptID,
		ProviderID:        agent.ProviderID,
		ModelIntent:       agent.ModelName,
		InputSnapshotJSON: string(inputJSON),
		BudgetRef:         "goal:" + goal.GoalID + ":budget",
		PolicyRef:         "goal:" + goal.GoalID + ":direct-model-policy",
		TraceID:           "trace:" + runID,
		State:             "pending_station_provider_route",
		Source:            goalDirectModelSource,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := tx.WithContext(ctx).Create(run).Error; err != nil {
		return goalInternal("Create Goal DirectRun", err)
	}

	execution.Step.AgentID = agent.ID
	if err := tx.WithContext(ctx).Model(&persistence.ExecutionStep{}).
		Where("step_id = ?", execution.Step.StepID).
		Updates(map[string]any{
			"agent_id": execution.Step.AgentID,
		}).Error; err != nil {
		return goalInternal("Bind Goal Direct Model Agent", err)
	}
	taskMeta := make(map[string]string)
	if raw := strings.TrimSpace(execution.Task.MetaJSON); raw != "" {
		if err := json.Unmarshal([]byte(raw), &taskMeta); err != nil {
			return goalInternal("Decode Goal TaskRun metadata", err)
		}
	}
	for key, value := range map[string]string{
		"attempt_id":       execution.Step.AttemptID,
		"direct_run_id":    run.DirectRunID,
		"goal_id":          goal.GoalID,
		"goal_node_id":     execution.Node.NodeID,
		"provider_id":      run.ProviderID,
		"model_intent":     run.ModelIntent,
		"root_step_id":     execution.Step.StepID,
		"runtime_kind":     "direct_model",
		"runtime_source":   run.Source,
		"runtime_trace_id": run.TraceID,
	} {
		taskMeta[key] = value
	}
	meta, err := json.Marshal(taskMeta)
	if err != nil {
		return goalInternal("Encode Goal Direct Model metadata", err)
	}
	execution.Task.MetaJSON = string(meta)
	if err := tx.WithContext(ctx).Model(&persistence.TaskRun{}).
		Where("task_id = ?", execution.Task.TaskID).
		Update("meta_json", execution.Task.MetaJSON).Error; err != nil {
		return goalInternal("Bind Goal TaskRun Direct Model metadata", err)
	}

	writer := e.writer
	if writer == nil {
		writer = NewTaskEventWriter()
	}
	_, err = writer.appendTx(
		ctx,
		tx,
		"",
		execution.Task.TaskID,
		execution.Step.StepID,
		"",
		string(domain.EventTypeCollaborationTaskCreated),
		goalDirectModelEventPayload(run, execution, "pending"),
	)
	if err != nil {
		return goalInternal("Append Goal Direct Model creation event", err)
	}
	return nil
}

func (e *GoalDirectModelExecutor) IsPreparedTx(
	ctx context.Context,
	tx *gorm.DB,
	execution *GoalExecutionSnapshot,
) (bool, error) {
	if e == nil || tx == nil || execution == nil || execution.Task == nil {
		return false, goalInternal("Inspect Goal Direct Model preparation", nil)
	}
	var count int64
	err := tx.WithContext(ctx).
		Model(&persistence.DirectRun{}).
		Where(
			"task_id = ? AND state IN ?",
			execution.Task.TaskID,
			[]string{"pending_station_provider_route", "running"},
		).
		Count(&count).Error
	return count > 0, err
}

func (e *GoalDirectModelExecutor) Start(
	ownerPTID string,
	taskID string,
) {
	ownerPTID = strings.TrimSpace(ownerPTID)
	taskID = strings.TrimSpace(taskID)
	if e == nil || ownerPTID == "" || taskID == "" {
		return
	}
	go func() {
		if err := e.Execute(context.Background(), ownerPTID, taskID); err != nil {
			logger.Errorf(
				context.Background(),
				"Goal Direct Model execution failed: task_id=%s actor_ptid=%s err=%v",
				taskID,
				ownerPTID,
				err,
			)
		}
	}()
}

func (e *GoalDirectModelExecutor) Execute(
	ctx context.Context,
	ownerPTID string,
	taskID string,
) error {
	if e == nil || e.db == nil {
		return goalInternal("Goal Direct Model persistence is unavailable", nil)
	}
	if e.provider == nil {
		return goalInternal("Goal Direct Model provider runtime is unavailable", nil)
	}

	runtime, claimed, _, err := e.claim(ctx, ownerPTID, taskID)
	if err != nil || !claimed {
		return err
	}

	if runtime.Run.ProviderID == "" || runtime.Run.ModelIntent == "" ||
		runtime.Step.AgentID == "" {
		_, finishErr := e.finish(
			ctx,
			runtime,
			nil,
			nil,
			false,
			"No configured Agent is available for this Goal.",
		)
		return finishErr
	}

	provider, err := loadOwnedGoalDirectModelProvider(
		ctx,
		e.db,
		ownerPTID,
		runtime.Run.ProviderID,
	)
	if err != nil {
		_, finishErr := e.finish(
			ctx,
			runtime,
			nil,
			nil,
			false,
			"Direct Model provider is unavailable.",
		)
		if finishErr != nil {
			return finishErr
		}
		return err
	}
	if isCLIProviderRecord(provider) {
		_, finishErr := e.finish(
			ctx,
			runtime,
			provider,
			nil,
			false,
			"Direct Model requires a Station-hosted provider.",
		)
		return finishErr
	}

	callCtx := ctx
	cancel := func() {}
	if runtime.Input.Budget != nil && runtime.Input.Budget.GetWallTimeMs() > 0 {
		callCtx, cancel = context.WithTimeout(
			ctx,
			time.Duration(runtime.Input.Budget.GetWallTimeMs())*time.Millisecond,
		)
	}
	defer cancel()

	resp, callErr := e.provider.CallDirectRunProvider(
		callCtx,
		&ProviderCallRequest{
			ProviderID:   runtime.Run.ProviderID,
			AgentID:      runtime.Step.AgentID,
			Model:        runtime.Run.ModelIntent,
			SystemPrompt: goalDirectModelSystemPrompt(),
			Messages: []domain.Message{{
				Role:    domain.MessageRoleUser,
				Content: goalDirectModelUserPrompt(runtime),
			}},
			UserID:          ownerPTID,
			Effort:          runtime.Input.Effort,
			ThinkingMode:    runtime.Input.ThinkingMode,
			MaxOutputTokens: goalDirectModelMaxOutputTokens(runtime.Input.Budget),
		},
	)
	if callErr != nil {
		_, finishErr := e.finish(
			ctx,
			runtime,
			provider,
			nil,
			false,
			"Direct Model provider execution failed.",
		)
		if finishErr != nil {
			return finishErr
		}
		return callErr
	}
	if budgetFailure := goalDirectModelBudgetFailure(
		runtime.Input.Budget,
		provider,
		resp,
	); budgetFailure != "" {
		_, finishErr := e.finish(
			ctx,
			runtime,
			provider,
			resp,
			false,
			budgetFailure,
		)
		return finishErr
	}

	content := strings.TrimSpace(respContent(resp))
	if content == "" {
		content = "Direct Model completed without a final response."
	}
	_, err = e.finish(ctx, runtime, provider, resp, true, content)
	return err
}

func (e *GoalDirectModelExecutor) claim(
	ctx context.Context,
	ownerPTID string,
	taskID string,
) (*goalDirectModelRuntime, bool, []committedTaskEvent, error) {
	var runtime *goalDirectModelRuntime
	var events []committedTaskEvent
	err := e.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loaded, err := loadGoalDirectModelRuntimeTx(
			ctx,
			tx,
			ownerPTID,
			taskID,
		)
		if err != nil {
			return err
		}
		if loaded.Task.Status != int32(
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING,
		) || loaded.Step.Status != int32(
			model.TaskNodeStatus_TASK_NODE_STATUS_PENDING,
		) || loaded.Run.State != "pending_station_provider_route" {
			return nil
		}

		now := e.now().UTC()
		update := tx.WithContext(ctx).Model(&persistence.DirectRun{}).
			Where(
				"direct_run_id = ? AND state = ?",
				loaded.Run.DirectRunID,
				"pending_station_provider_route",
			).
			Updates(map[string]any{
				"state":      "running",
				"updated_at": now,
			})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return nil
		}
		if err := tx.WithContext(ctx).Model(&persistence.TaskRun{}).
			Where("task_id = ?", loaded.Task.TaskID).
			Updates(map[string]any{
				"status":     int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
				"updated_at": now,
			}).Error; err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Model(&persistence.ExecutionStep{}).
			Where("step_id = ?", loaded.Step.StepID).
			Updates(map[string]any{
				"status":     int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
				"started_at": now,
			}).Error; err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Model(&persistence.AgentGoalNode{}).
			Where(
				"goal_id = ? AND node_id = ? AND task_id = ?",
				loaded.Node.GoalID,
				loaded.Node.NodeID,
				loaded.Node.TaskID,
			).
			Updates(map[string]any{
				"status":     int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
				"updated_at": now,
			}).Error; err != nil {
			return err
		}

		loaded.Run.State = "running"
		loaded.Run.UpdatedAt = now
		loaded.Task.Status = int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING)
		loaded.Task.UpdatedAt = now
		loaded.Step.Status = int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING)
		loaded.Step.StartedAt = now
		loaded.Node.Status = int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING)
		loaded.Node.UpdatedAt = now
		record, err := e.appendEventTx(
			ctx,
			tx,
			loaded,
			domain.EventTypeCollaborationNodeRunning,
			goalDirectModelEventPayload(&loaded.Run, goalExecutionSnapshot(loaded), "running"),
		)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{
			AgentID:   loaded.Step.AgentID,
			EventType: string(domain.EventTypeCollaborationNodeRunning),
			Payload:   goalDirectModelEventPayload(&loaded.Run, goalExecutionSnapshot(loaded), "running"),
			Record:    record,
		})
		runtime = loaded
		return nil
	})
	if err != nil || runtime == nil {
		return runtime, false, events, err
	}
	return runtime, true, events, nil
}

func (e *GoalDirectModelExecutor) finish(
	ctx context.Context,
	runtime *goalDirectModelRuntime,
	provider *persistence.AgentProvider,
	resp *ProviderCallResponse,
	succeeded bool,
	detail string,
) ([]committedTaskEvent, error) {
	if runtime == nil {
		return nil, goalInternal("Finish Goal Direct Model execution", nil)
	}
	detail = strings.TrimSpace(detail)
	if detail == "" {
		detail = "Direct Model execution failed."
	}
	summary := goalDirectModelSummary(detail)
	state := "failed"
	taskStatus := model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED
	stepStatus := model.TaskNodeStatus_TASK_NODE_STATUS_FAILED
	artifactKind := "direct_run.failure"
	artifactName := "Direct Model failure report"
	nodeEvent := domain.EventTypeCollaborationNodeFailed
	taskEvent := domain.EventTypeCollaborationTaskFailed
	if succeeded {
		state = "succeeded"
		taskStatus = model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED
		stepStatus = model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED
		artifactKind = "direct_run.provider_response"
		artifactName = "Direct Model result"
		nodeEvent = domain.EventTypeCollaborationNodeCompleted
		taskEvent = domain.EventTypeCollaborationTaskCompleted
	}

	artifactID := generateID("goal_direct_artifact")
	gateID := generateID("goal_direct_gate")
	now := e.now().UTC()
	var events []committedTaskEvent
	err := e.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := updateGoalDirectModelTerminalStateTx(
			ctx,
			tx,
			runtime,
			state,
			taskStatus,
			stepStatus,
			summary,
			now,
		); err != nil {
			return err
		}
		runtime.Run.State = state
		runtime.Run.UpdatedAt = now
		runtime.Task.Status = int32(taskStatus)
		runtime.Task.UpdatedAt = now
		runtime.Task.EndedAt = &now
		runtime.Step.Status = int32(stepStatus)
		runtime.Step.ResultSummary = summary
		runtime.Step.EndedAt = &now
		runtime.Node.Status = int32(stepStatus)
		runtime.Node.UpdatedAt = now

		artifactPayload := goalDirectModelArtifactPayload(
			runtime,
			resp,
			artifactID,
			artifactName,
			artifactKind,
			detail,
		)
		artifactRecord, err := e.appendEventTx(
			ctx,
			tx,
			runtime,
			domain.EventTypeCollaborationArtifactCreated,
			artifactPayload,
		)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{
			AgentID:   runtime.Step.AgentID,
			EventType: string(domain.EventTypeCollaborationArtifactCreated),
			Payload:   artifactPayload,
			Record:    artifactRecord,
		})
		if err := createGoalDirectModelBudgetUsageTx(
			ctx,
			tx,
			runtime,
			provider,
			resp,
			artifactRecord,
		); err != nil {
			return err
		}

		nodePayload := goalDirectModelEventPayload(
			&runtime.Run,
			goalExecutionSnapshot(runtime),
			state,
		)
		nodePayload["summary"] = summary
		nodePayload["artifact_ids"] = []string{artifactID}
		nodeRecord, err := e.appendEventTx(
			ctx,
			tx,
			runtime,
			nodeEvent,
			nodePayload,
		)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{
			AgentID:   runtime.Step.AgentID,
			EventType: string(nodeEvent),
			Payload:   nodePayload,
			Record:    nodeRecord,
		})

		gatePayload := goalDirectModelGatePayload(
			runtime,
			gateID,
			artifactID,
			succeeded,
			summary,
		)
		gateRecord, err := e.appendEventTx(
			ctx,
			tx,
			runtime,
			domain.EventTypeCollaborationGateResult,
			gatePayload,
		)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{
			AgentID:   runtime.Step.AgentID,
			EventType: string(domain.EventTypeCollaborationGateResult),
			Payload:   gatePayload,
			Record:    gateRecord,
		})

		taskPayload := goalDirectModelEventPayload(
			&runtime.Run,
			goalExecutionSnapshot(runtime),
			state,
		)
		taskPayload["summary"] = summary
		taskPayload["artifact_ids"] = []string{artifactID}
		taskRecord, err := e.appendEventTx(
			ctx,
			tx,
			runtime,
			taskEvent,
			taskPayload,
		)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{
			AgentID:   runtime.Step.AgentID,
			EventType: string(taskEvent),
			Payload:   taskPayload,
			Record:    taskRecord,
		})
		return nil
	})
	if err == nil && e.onTerminal != nil {
		if advanceErr := e.onTerminal.OnTaskTerminal(
			ctx,
			runtime.Task.OwnerActorPTID,
			runtime.Task.GoalID,
		); advanceErr != nil {
			logger.Warnf(
				ctx,
				"Goal coordinator advance failed: goal_id=%s task_id=%s err=%v",
				runtime.Task.GoalID,
				runtime.Task.TaskID,
				advanceErr,
			)
		}
	}
	return events, err
}

func (e *GoalDirectModelExecutor) appendEventTx(
	ctx context.Context,
	tx *gorm.DB,
	runtime *goalDirectModelRuntime,
	eventType domain.EventType,
	payload map[string]any,
) (*persistence.TaskEvent, error) {
	writer := e.writer
	if writer == nil {
		writer = NewTaskEventWriter()
	}
	taskID := ""
	stepID := ""
	if runtime != nil {
		taskID = runtime.Task.TaskID
		stepID = runtime.Step.StepID
	}
	return writer.appendTx(
		ctx,
		tx,
		"",
		taskID,
		stepID,
		"",
		string(eventType),
		payload,
	)
}

func loadGoalDirectModelRuntimeTx(
	ctx context.Context,
	tx *gorm.DB,
	ownerPTID string,
	taskID string,
) (*goalDirectModelRuntime, error) {
	ownerPTID = strings.TrimSpace(ownerPTID)
	taskID = strings.TrimSpace(taskID)
	var task persistence.TaskRun
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"task_id = ? AND owner_actor_ptid = ? AND goal_id <> ''",
			taskID,
			ownerPTID,
		).
		First(&task).Error; err != nil {
		return nil, err
	}
	var run persistence.DirectRun
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("task_id = ? AND source = ?", taskID, goalDirectModelSource).
		First(&run).Error; err != nil {
		return nil, err
	}
	var step persistence.ExecutionStep
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("task_id = ? AND step_id = ?", taskID, task.RootStepID).
		First(&step).Error; err != nil {
		return nil, err
	}
	var node persistence.AgentGoalNode
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"goal_id = ? AND node_id = ? AND task_id = ?",
			task.GoalID,
			task.GoalNodeID,
			task.TaskID,
		).
		First(&node).Error; err != nil {
		return nil, err
	}
	if run.GoalID != task.GoalID ||
		run.GoalNodeID != node.NodeID ||
		run.StepID != step.StepID ||
		run.AttemptID != step.AttemptID {
		return nil, goalInternal("Goal Direct Model identity mismatch", nil)
	}
	var input goalDirectModelInput
	if err := json.Unmarshal([]byte(run.InputSnapshotJSON), &input); err != nil {
		return nil, goalInternal("Decode Goal Direct Model input", err)
	}
	return &goalDirectModelRuntime{
		Run:   run,
		Task:  task,
		Step:  step,
		Node:  node,
		Input: input,
	}, nil
}

func loadOwnedGoalDirectModelProvider(
	ctx context.Context,
	db *gorm.DB,
	ownerPTID string,
	providerID string,
) (*persistence.AgentProvider, error) {
	var provider persistence.AgentProvider
	err := db.WithContext(ctx).
		Where(
			"enabled = ? AND (id = ? OR (actor_ptid = ? AND name = ?))",
			true,
			strings.TrimSpace(providerID),
			strings.TrimSpace(ownerPTID),
			strings.TrimSpace(providerID),
		).
		Order(clause.Expr{
			SQL:  "CASE WHEN id = ? THEN 0 ELSE 1 END",
			Vars: []any{strings.TrimSpace(providerID)},
		}).
		First(&provider).Error
	if err != nil {
		return nil, err
	}
	if provider.ActorPTID != "" && provider.ActorPTID != strings.TrimSpace(ownerPTID) {
		return nil, gorm.ErrRecordNotFound
	}
	return &provider, nil
}

func updateGoalDirectModelTerminalStateTx(
	ctx context.Context,
	tx *gorm.DB,
	runtime *goalDirectModelRuntime,
	state string,
	taskStatus model.CollaborationTaskStatus,
	stepStatus model.TaskNodeStatus,
	summary string,
	now time.Time,
) error {
	endedAt := now
	update := tx.WithContext(ctx).Model(&persistence.DirectRun{}).
		Where("direct_run_id = ? AND state = ?", runtime.Run.DirectRunID, "running").
		Updates(map[string]any{
			"state":      state,
			"updated_at": now,
		})
	if update.Error != nil {
		return update.Error
	}
	if update.RowsAffected != 1 {
		return goalInternal("Goal Direct Model result lost execution authority", nil)
	}
	update = tx.WithContext(ctx).Model(&persistence.TaskRun{}).
		Where(
			"task_id = ? AND status = ?",
			runtime.Task.TaskID,
			int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		).
		Updates(map[string]any{
			"status":     int32(taskStatus),
			"updated_at": now,
			"ended_at":   &endedAt,
		})
	if update.Error != nil {
		return update.Error
	}
	if update.RowsAffected != 1 {
		return goalInternal("Goal TaskRun result lost execution authority", nil)
	}
	update = tx.WithContext(ctx).Model(&persistence.ExecutionStep{}).
		Where(
			"step_id = ? AND status = ?",
			runtime.Step.StepID,
			int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		).
		Updates(map[string]any{
			"status":         int32(stepStatus),
			"result_summary": summary,
			"ended_at":       &endedAt,
		})
	if update.Error != nil {
		return update.Error
	}
	if update.RowsAffected != 1 {
		return goalInternal("Goal ExecutionStep result lost execution authority", nil)
	}
	update = tx.WithContext(ctx).Model(&persistence.AgentGoalNode{}).
		Where(
			"goal_id = ? AND node_id = ? AND task_id = ? AND status = ?",
			runtime.Node.GoalID,
			runtime.Node.NodeID,
			runtime.Node.TaskID,
			int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		).
		Updates(map[string]any{
			"status":     int32(stepStatus),
			"updated_at": now,
		})
	if update.Error != nil {
		return update.Error
	}
	if update.RowsAffected != 1 {
		return goalInternal("Goal node result lost execution authority", nil)
	}
	return nil
}

func createGoalDirectModelBudgetUsageTx(
	ctx context.Context,
	tx *gorm.DB,
	runtime *goalDirectModelRuntime,
	provider *persistence.AgentProvider,
	resp *ProviderCallResponse,
	event *persistence.TaskEvent,
) error {
	if runtime == nil || resp == nil {
		return nil
	}
	inputTokens := int64(resp.InputTokens)
	outputTokens := int64(resp.OutputTokens)
	if inputTokens+outputTokens <= 0 {
		return nil
	}
	pricing := directRunProviderPricing(provider, firstNonEmptyString(
		resp.Model,
		runtime.Run.ModelIntent,
	))
	billing := directRunProviderBilling(resp)
	estimatedMoney := pricing.moneyUsage(inputTokens, outputTokens)
	usedMoney := estimatedMoney
	if billing.Present {
		usedMoney = billing.Money
	}
	record := &persistence.TaskBudgetUsage{
		BudgetUsageID:           generateID("goal_budget_usage"),
		TaskID:                  runtime.Task.TaskID,
		StepID:                  runtime.Step.StepID,
		BudgetID:                runtime.Run.BudgetRef,
		DirectRunID:             runtime.Run.DirectRunID,
		ProviderID:              runtime.Run.ProviderID,
		Model:                   firstNonEmptyString(resp.Model, runtime.Run.ModelIntent),
		InputTokens:             inputTokens,
		OutputTokens:            outputTokens,
		TotalTokens:             inputTokens + outputTokens,
		UsedMoney:               usedMoney,
		EstimatedMoney:          estimatedMoney,
		ProviderBilledMoney:     billing.Money,
		ProviderBillingSource:   billing.Source,
		ProviderBillingCurrency: billing.Currency,
		InputTokenPrice:         pricing.InputTokenPrice,
		OutputTokenPrice:        pricing.OutputTokenPrice,
		PricingSource:           pricing.Source,
		Source:                  "station.goal.direct_model",
		CreatedAt:               time.Now().UTC(),
	}
	if event != nil {
		record.EventID = event.ID
		record.EventSeq = event.EventSeq
		record.PayloadJSON = event.Payload
		record.CreatedAt = event.CreatedAt
	}
	return tx.WithContext(ctx).Create(record).Error
}

func goalDirectModelBudgetFailure(
	budget *model.AgentGoalBudget,
	provider *persistence.AgentProvider,
	resp *ProviderCallResponse,
) string {
	if budget == nil || resp == nil {
		return ""
	}
	totalTokens := uint64(max(resp.InputTokens+resp.OutputTokens, 0))
	if budget.GetMaxTokens() > 0 && totalTokens > budget.GetMaxTokens() {
		return fmt.Sprintf(
			"Direct Model exceeded the Goal token budget: used %d of %d tokens.",
			totalTokens,
			budget.GetMaxTokens(),
		)
	}
	if budget.MaxCost != nil {
		pricing := directRunProviderPricing(provider, resp.Model)
		usedMoney := pricing.moneyUsage(
			int64(resp.InputTokens),
			int64(resp.OutputTokens),
		)
		if billing := directRunProviderBilling(resp); billing.Present {
			usedMoney = billing.Money
		}
		if usedMoney > budget.GetMaxCost() {
			return fmt.Sprintf(
				"Direct Model exceeded the Goal cost budget: used %.6f of %.6f.",
				usedMoney,
				budget.GetMaxCost(),
			)
		}
	}
	return ""
}

func goalDirectModelMaxOutputTokens(budget *model.AgentGoalBudget) int {
	if budget == nil || budget.GetMaxTokens() == 0 {
		return 0
	}
	if budget.GetMaxTokens() > math.MaxInt32 {
		return math.MaxInt32
	}
	return int(budget.GetMaxTokens())
}

func goalDirectModelSystemPrompt() string {
	return "You are executing one Station-owned Goal TaskRun through Direct Model. " +
		"Return a concise markdown result grounded in the Goal outcome. " +
		"Do not claim tool, shell, file, or external runtime actions that did not occur."
}

func goalDirectModelUserPrompt(runtime *goalDirectModelRuntime) string {
	if runtime == nil {
		return ""
	}
	outcome := strings.TrimSpace(runtime.Input.Outcome)
	if outcome == "" {
		outcome = strings.TrimSpace(runtime.Task.Description)
	}
	return strings.TrimSpace(fmt.Sprintf(
		"Goal: %s\n\nExpected outcome:\n%s",
		firstNonEmptyString(runtime.Input.Title, runtime.Task.Title),
		outcome,
	))
}

func goalDirectModelSummary(value string) string {
	value = strings.TrimSpace(value)
	const maxBytes = 4096
	if len(value) <= maxBytes {
		return value
	}
	for len(value) > maxBytes {
		_, size := utf8.DecodeLastRuneInString(value)
		if size <= 0 {
			return value[:maxBytes]
		}
		value = value[:len(value)-size]
	}
	return strings.TrimSpace(value)
}

func stableGoalDirectRunID(goalID string, nodeID string) string {
	if strings.TrimSpace(nodeID) ==
		stableGoalExecutionID("gnode", strings.TrimSpace(goalID)) {
		return stableGoalExecutionID("direct_run", strings.TrimSpace(goalID))
	}
	return stableGoalExecutionID(
		"direct_run",
		strings.TrimSpace(goalID)+"\x00"+strings.TrimSpace(nodeID),
	)
}

func goalDirectModelEventPayload(
	run *persistence.DirectRun,
	execution *GoalExecutionSnapshot,
	state string,
) map[string]any {
	payload := map[string]any{
		"runtime_kind":  "direct_model",
		"runtime_owner": "station",
		"source":        goalDirectModelSource,
		"state":         strings.TrimSpace(state),
		"surface":       int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
		"surface_name":  model.TaskSurface_TASK_SURFACE_DIRECT_RUN.String(),
	}
	if run != nil {
		payload["direct_run_id"] = run.DirectRunID
		payload["provider_id"] = run.ProviderID
		payload["model_intent"] = run.ModelIntent
		payload["budget_ref"] = run.BudgetRef
		payload["policy_ref"] = run.PolicyRef
		payload["trace_id"] = run.TraceID
	}
	if execution != nil {
		if execution.CoordinatorLeaseGeneration > 0 {
			payload["coordinator_lease_generation"] =
				execution.CoordinatorLeaseGeneration
		}
		if execution.CoordinatorDispatchSequence > 0 {
			payload["coordinator_dispatch_sequence"] =
				execution.CoordinatorDispatchSequence
		}
		if execution.GoalGraphRevision > 0 {
			payload["goal_graph_revision"] = execution.GoalGraphRevision
		}
		if execution.Task != nil {
			payload["task_id"] = execution.Task.TaskID
			payload["goal_id"] = execution.Task.GoalID
			payload["actor_ptid"] = execution.Task.OwnerActorPTID
		}
		if execution.Node != nil {
			payload["goal_node_id"] = execution.Node.NodeID
		}
		if execution.Step != nil {
			payload["step_id"] = execution.Step.StepID
			payload["attempt_id"] = execution.Step.AttemptID
			payload["attempt"] = execution.Step.Attempt
			payload["agent_id"] = execution.Step.AgentID
		}
	}
	return payload
}

func goalDirectModelArtifactPayload(
	runtime *goalDirectModelRuntime,
	resp *ProviderCallResponse,
	artifactID string,
	name string,
	kind string,
	body string,
) map[string]any {
	payload := goalDirectModelEventPayload(
		&runtime.Run,
		goalExecutionSnapshot(runtime),
		runtime.Run.State,
	)
	payload["block_kind"] = "artifact"
	payload["artifact_id"] = artifactID
	payload["id"] = artifactID
	payload["run_id"] = runtime.Run.DirectRunID
	payload["kind"] = kind
	payload["name"] = name
	payload["uri"] = stationArtifactURI(runtime.Task.TaskID, artifactID)
	payload["checksum"] = artifactContentChecksum(body)
	payload["produced_by"] = "station.goal.direct_model"
	payload["body_kind"] = "markdown"
	payload["markdown"] = body
	payload["preview_hint"] = "safe_text"
	payload["retention_policy"] = "station_managed"
	payload["refs"] = []string{
		runtime.Run.DirectRunID,
		runtime.Task.GoalID,
		runtime.Node.NodeID,
		runtime.Step.AttemptID,
	}
	if resp != nil {
		payload["provider_type"] = strings.TrimSpace(resp.Provider)
		payload["response_model"] = strings.TrimSpace(resp.Model)
		payload["input_tokens"] = resp.InputTokens
		payload["output_tokens"] = resp.OutputTokens
		payload["finish_reason"] = strings.TrimSpace(resp.FinishReason)
		payload["streamed"] = resp.Streamed
	}
	return payload
}

func goalDirectModelGatePayload(
	runtime *goalDirectModelRuntime,
	gateID string,
	artifactID string,
	succeeded bool,
	summary string,
) map[string]any {
	status := "failed"
	if succeeded {
		status = "passed"
	}
	payload := goalDirectModelEventPayload(
		&runtime.Run,
		goalExecutionSnapshot(runtime),
		runtime.Run.State,
	)
	payload["block_kind"] = "gate_result"
	payload["gate_id"] = gateID
	payload["name"] = "Direct Model TaskRun result"
	payload["status"] = status
	payload["summary"] = summary
	payload["blocking"] = !succeeded
	payload["artifact_ids"] = []string{artifactID}
	payload["checks"] = []map[string]any{{
		"name":    "station_owned_direct_model_execution",
		"status":  status,
		"summary": "The TaskRun attempt produced durable Station evidence.",
	}}
	payload["produced_by"] = "station.goal.direct_model"
	return payload
}

func goalExecutionSnapshot(
	runtime *goalDirectModelRuntime,
) *GoalExecutionSnapshot {
	if runtime == nil {
		return nil
	}
	snapshot := &GoalExecutionSnapshot{
		Node: &runtime.Node,
		Task: &runtime.Task,
		Step: &runtime.Step,
	}
	meta := make(map[string]string)
	if json.Unmarshal([]byte(runtime.Task.MetaJSON), &meta) == nil {
		snapshot.CoordinatorLeaseGeneration, _ = strconv.ParseUint(
			meta["coordinator_lease_generation"],
			10,
			64,
		)
		snapshot.CoordinatorDispatchSequence, _ = strconv.ParseUint(
			meta["coordinator_dispatch_sequence"],
			10,
			64,
		)
		snapshot.GoalGraphRevision, _ = strconv.ParseUint(
			meta["goal_graph_revision"],
			10,
			64,
		)
	}
	return snapshot
}

func runtimeActorPTID(payload any) string {
	fields, ok := payload.(map[string]any)
	if !ok {
		return ""
	}
	value, _ := fields["actor_ptid"].(string)
	return strings.TrimSpace(value)
}
