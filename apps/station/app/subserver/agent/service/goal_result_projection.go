package service

import (
	"encoding/json"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/gorm"
)

type GoalResultProjection struct {
	DirectRunID       string
	State             string
	Summary           string
	ArtifactID        string
	ArtifactURI       string
	ArtifactKind      string
	ArtifactBodyRef   string
	FailureArtifactID string
	TraceID           string
	InputTokens       int64
	OutputTokens      int64
	TotalTokens       int64
	UsedMoney         float64
}

func loadGoalResultProjectionTx(
	tx *gorm.DB,
	task *persistence.TaskRun,
	step *persistence.ExecutionStep,
) (*GoalResultProjection, error) {
	if tx == nil || task == nil || step == nil {
		return nil, nil
	}
	var run persistence.DirectRun
	if err := tx.
		Where("task_id = ? AND source = ?", task.TaskID, goalDirectModelSource).
		Order("created_at DESC, direct_run_id DESC").
		First(&run).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}

	result := &GoalResultProjection{
		DirectRunID: run.DirectRunID,
		State:       strings.TrimSpace(run.State),
		Summary:     strings.TrimSpace(step.ResultSummary),
		TraceID:     strings.TrimSpace(run.TraceID),
	}
	var artifact persistence.TaskArtifact
	if err := tx.
		Where(
			"task_id = ? AND step_id = ? AND produced_by = ?",
			task.TaskID,
			step.StepID,
			"station.goal.direct_model",
		).
		Order("event_seq DESC, created_at DESC").
		First(&artifact).Error; err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	} else if err == nil && artifactRefsDirectRun(artifact, run.DirectRunID) {
		result.ArtifactID = artifact.ArtifactID
		result.ArtifactURI = artifact.URI
		result.ArtifactKind = artifact.Kind
		result.ArtifactBodyRef = goalResultArtifactBodyRef(artifact.PayloadJSON)
		if strings.Contains(strings.ToLower(artifact.Kind), "failure") {
			result.FailureArtifactID = artifact.ArtifactID
		}
	}

	var usage persistence.TaskBudgetUsage
	if err := tx.
		Where("task_id = ? AND direct_run_id = ?", task.TaskID, run.DirectRunID).
		Order("created_at DESC, budget_usage_id DESC").
		First(&usage).Error; err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	} else if err == nil {
		result.InputTokens = usage.InputTokens
		result.OutputTokens = usage.OutputTokens
		result.TotalTokens = usage.TotalTokens
		result.UsedMoney = usage.UsedMoney
	}
	return result, nil
}

func homeGoalResultBriefID(execution *GoalExecutionSnapshot) string {
	if execution != nil && execution.Result != nil &&
		strings.TrimSpace(execution.Result.ArtifactID) != "" {
		return "goal-result:" + strings.TrimSpace(execution.Result.ArtifactID)
	}
	if execution != nil && execution.Task != nil {
		return "goal-result:task:" + strings.TrimSpace(execution.Task.TaskID)
	}
	return "goal-result:unknown"
}

func homeGoalResultSummary(
	execution *GoalExecutionSnapshot,
	fallback string,
) string {
	if execution != nil && execution.Result != nil &&
		strings.TrimSpace(execution.Result.Summary) != "" {
		return strings.TrimSpace(execution.Result.Summary)
	}
	if execution != nil && execution.Step != nil &&
		strings.TrimSpace(execution.Step.ResultSummary) != "" {
		return strings.TrimSpace(execution.Step.ResultSummary)
	}
	return fallback
}

func goalResultArtifactBodyRef(payloadJSON string) string {
	var payload map[string]any
	if strings.TrimSpace(payloadJSON) == "" ||
		json.Unmarshal([]byte(payloadJSON), &payload) != nil {
		return ""
	}
	value, _ := payload["body_ref"].(string)
	return strings.TrimSpace(value)
}
