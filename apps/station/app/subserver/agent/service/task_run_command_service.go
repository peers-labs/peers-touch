package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const taskRunCommandWriterVersion = "task-run-command-v1"

// TaskRunCommandService is the canonical writer for one-step Home and promoted
// Chat work. It creates execution state only in TaskRun-owned tables.
type TaskRunCommandService struct {
	db          *gorm.DB
	eventWriter *TaskEventWriter
	now         func() time.Time
}

func NewTaskRunCommandService(db *gorm.DB) *TaskRunCommandService {
	return &TaskRunCommandService{
		db:          db,
		eventWriter: NewTaskEventWriter(),
		now:         time.Now,
	}
}

func (s *TaskRunCommandService) Create(
	ctx context.Context,
	ownerPTID string,
	req *model.CreateTaskRunRequest,
) (*model.CreateTaskRunResponse, error) {
	ownerPTID = strings.TrimSpace(ownerPTID)
	if err := validateTaskRunCommand(ownerPTID, req); err != nil {
		return nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	taskID := taskRunCommandID("task", ownerPTID, req.GetClientIdempotencyKey())
	var task persistence.TaskRun
	var step persistence.ExecutionStep
	created := false
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		replayed, replayedStep, replayErr := loadTaskRunCommandReplayTx(
			tx,
			ownerPTID,
			taskID,
			req,
		)
		if replayErr != nil {
			return replayErr
		}
		if replayed != nil {
			task = *replayed
			step = *replayedStep
			return nil
		}

		now := s.now().UTC()
		stepID := taskRunCommandID("step", ownerPTID, req.GetClientIdempotencyKey())
		attemptID := taskRunCommandID(
			"attempt",
			ownerPTID,
			req.GetClientIdempotencyKey(),
		)
		meta := copyStringMap(req.GetMeta())
		meta["agent_id"] = strings.TrimSpace(req.GetAgentId())
		meta["attempt_id"] = attemptID
		meta["client_idempotency_key"] = strings.TrimSpace(
			req.GetClientIdempotencyKey(),
		)
		meta["command_payload_hash"] = strings.TrimSpace(
			req.GetCommandPayloadHash(),
		)
		meta["root_step_id"] = stepID
		meta["source_ref"] = strings.TrimSpace(req.GetSourceRef())
		meta["writer"] = taskRunCommandWriterVersion
		metaJSON, marshalErr := json.Marshal(meta)
		if marshalErr != nil {
			return marshalErr
		}

		stepStatus := model.TaskNodeStatus_TASK_NODE_STATUS_PENDING
		if req.GetInitialStatus() ==
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING {
			stepStatus = model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING
		}
		task = persistence.TaskRun{
			TaskID:         taskID,
			Title:          strings.TrimSpace(req.GetTitle()),
			Description:    firstNonEmptyString(req.GetDescription(), req.GetTitle()),
			Surface:        int32(req.GetSurface()),
			Status:         int32(req.GetInitialStatus()),
			OwnerActorPTID: ownerPTID,
			MetaJSON:       string(metaJSON),
			CreatedAt:      now,
			StartedAt:      now,
			UpdatedAt:      now,
			RootStepID:     stepID,
		}
		step = persistence.ExecutionStep{
			StepID:            stepID,
			TaskID:            taskID,
			AgentID:           strings.TrimSpace(req.GetAgentId()),
			Role:              "executor",
			Description:       task.Description,
			Status:            int32(stepStatus),
			Attempt:           1,
			AttemptID:         attemptID,
			EligibleExecutors: model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED.String(),
			StartedAt:         now,
		}
		if err := tx.Create(&task).Error; err != nil {
			return err
		}
		if err := tx.Create(&step).Error; err != nil {
			return err
		}
		writer := s.eventWriter
		if writer == nil {
			writer = NewTaskEventWriter()
		}
		_, err := writer.appendTx(
			ctx,
			tx,
			taskRunCommandID("event", ownerPTID, req.GetClientIdempotencyKey()),
			task.TaskID,
			step.StepID,
			"",
			string(domain.EventTypeCollaborationTaskCreated),
			taskRunCommandCreatedPayload(&task, &step, meta),
		)
		if err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		var businessError *errcode.BizError
		if errors.As(err, &businessError) {
			return nil, err
		}
		replayed, replayedStep, replayErr := loadTaskRunCommandReplayTx(
			db.WithContext(ctx),
			ownerPTID,
			taskID,
			req,
		)
		if replayErr == nil && replayed != nil {
			return taskRunCommandResponse(replayed, replayedStep, false), nil
		}
		return nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to create canonical TaskRun",
			err,
		)
	}
	return taskRunCommandResponse(&task, &step, created), nil
}

func (s *TaskRunCommandService) getDB(ctx context.Context) (*gorm.DB, error) {
	if s != nil && s.db != nil {
		return s.db, nil
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to open agent db",
			err,
		)
	}
	return db, nil
}

func validateTaskRunCommand(
	ownerPTID string,
	req *model.CreateTaskRunRequest,
) error {
	if req == nil {
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"TaskRun request is required",
			nil,
		)
	}
	if ownerPTID == "" ||
		strings.TrimSpace(req.GetTitle()) == "" ||
		strings.TrimSpace(req.GetAgentId()) == "" ||
		strings.TrimSpace(req.GetClientIdempotencyKey()) == "" ||
		strings.TrimSpace(req.GetCommandPayloadHash()) == "" {
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"actor, title, agent_id, client_idempotency_key and command_payload_hash are required",
			nil,
		)
	}
	switch req.GetSurface() {
	case model.TaskSurface_TASK_SURFACE_API,
		model.TaskSurface_TASK_SURFACE_DIRECT_RUN:
	default:
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"TaskRun command surface must be API or DIRECT_RUN",
			nil,
		)
	}
	switch req.GetInitialStatus() {
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING:
		return nil
	default:
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"TaskRun command initial_status must be PENDING or RUNNING",
			nil,
		)
	}
}

func loadTaskRunCommandReplayTx(
	tx *gorm.DB,
	ownerPTID string,
	taskID string,
	req *model.CreateTaskRunRequest,
) (*persistence.TaskRun, *persistence.ExecutionStep, error) {
	var task persistence.TaskRun
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("task_id = ?", taskID).
		First(&task).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	meta := map[string]string{}
	if err := json.Unmarshal([]byte(task.MetaJSON), &meta); err != nil {
		return nil, nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"canonical TaskRun metadata is invalid",
			err,
		)
	}
	if task.OwnerActorPTID != ownerPTID ||
		meta["writer"] != taskRunCommandWriterVersion ||
		meta["client_idempotency_key"] !=
			strings.TrimSpace(req.GetClientIdempotencyKey()) {
		return nil, nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"canonical TaskRun identity is owned by another command",
			nil,
		)
	}
	if meta["command_payload_hash"] != strings.TrimSpace(req.GetCommandPayloadHash()) {
		return nil, nil, errcode.NewAdmissionDuplicateConflict(
			req.GetClientIdempotencyKey(),
			task.TaskID,
		)
	}
	var step persistence.ExecutionStep
	if err := tx.Where(
		"task_id = ? AND step_id = ?",
		task.TaskID,
		task.RootStepID,
	).First(&step).Error; err != nil {
		return nil, nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"canonical TaskRun root step is missing",
			err,
		)
	}
	return &task, &step, nil
}

func taskRunCommandID(prefix string, ownerPTID string, idempotencyKey string) string {
	sum := sha256.Sum256([]byte(
		taskRunCommandWriterVersion + "\x00" +
			strings.TrimSpace(ownerPTID) + "\x00" +
			strings.TrimSpace(idempotencyKey) + "\x00" +
			prefix,
	))
	return prefix + "_" + hex.EncodeToString(sum[:12])
}

func taskRunCommandCreatedPayload(
	task *persistence.TaskRun,
	step *persistence.ExecutionStep,
	meta map[string]string,
) map[string]any {
	return map[string]any{
		"agent_id":        step.AgentID,
		"attempt":         step.Attempt,
		"attempt_id":      step.AttemptID,
		"source_ref":      meta["source_ref"],
		"step_id":         step.StepID,
		"step_status":     step.Status,
		"surface":         task.Surface,
		"surface_name":    model.TaskSurface(task.Surface).String(),
		"task_id":         task.TaskID,
		"task_status":     task.Status,
		"writer":          meta["writer"],
		"writer_contract": "TaskRun+ExecutionStep",
	}
}

func taskRunCommandResponse(
	task *persistence.TaskRun,
	step *persistence.ExecutionStep,
	created bool,
) *model.CreateTaskRunResponse {
	meta := map[string]string{}
	if task != nil && strings.TrimSpace(task.MetaJSON) != "" {
		_ = json.Unmarshal([]byte(task.MetaJSON), &meta)
	}
	response := &model.CreateTaskRunResponse{Created: created}
	if task != nil {
		response.Task = &model.TaskRun{
			TaskId:              task.TaskID,
			Title:               task.Title,
			Description:         task.Description,
			Surface:             model.TaskSurface(task.Surface),
			Status:              model.CollaborationTaskStatus(task.Status),
			OwnerActorPtid:      task.OwnerActorPTID,
			WorkspaceId:         task.WorkspaceID,
			RootTurnId:          task.RootTurnID,
			CurrentCheckpointId: task.CurrentCheckpointID,
			Meta:                meta,
			CreatedAt:           timestamppb.New(task.CreatedAt),
			StartedAt:           timestamppb.New(task.StartedAt),
			UpdatedAt:           timestamppb.New(task.UpdatedAt),
			GoalId:              task.GoalID,
			GoalNodeId:          task.GoalNodeID,
			RootStepId:          task.RootStepID,
		}
		if task.EndedAt != nil {
			response.Task.EndedAt = timestamppb.New(*task.EndedAt)
		}
	}
	if step != nil {
		response.RootStep = &model.ExecutionStep{
			StepId:       step.StepID,
			TaskId:       step.TaskID,
			ParentStepId: step.ParentStepID,
			AgentId:      step.AgentID,
			Role:         step.Role,
			Description:  step.Description,
			Status:       model.TaskNodeStatus(step.Status),
			EligibleExecutors: []model.ExecutorKind{
				model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED,
			},
			TurnId:        step.TurnID,
			Attempt:       step.Attempt,
			ResultSummary: step.ResultSummary,
			StartedAt:     timestamppb.New(step.StartedAt),
			AttemptId:     step.AttemptID,
		}
		if step.EndedAt != nil {
			response.RootStep.EndedAt = timestamppb.New(*step.EndedAt)
		}
	}
	return response
}
