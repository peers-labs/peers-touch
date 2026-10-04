package service

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// AgentTaskService keeps migrated legacy AgentTask rows readable and
// maintainable until the final authority deletion. New work is created only by
// TaskRunCommandService.
type AgentTaskService struct{}

func NewAgentTaskService() *AgentTaskService {
	return &AgentTaskService{}
}

func (s *AgentTaskService) getDB(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx, store.WithRDSDBName("agent"))
}

// Subtask mirrors the JSON element persisted in AgentTask.SubtasksJSON.
type Subtask struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Status      string `json:"status"`
	CompletedAt int64  `json:"completed_at,omitempty"`
}

func computeProgress(subtasks []Subtask) int {
	if len(subtasks) == 0 {
		return 0
	}
	completed := 0
	for _, st := range subtasks {
		if st.Status == "completed" {
			completed++
		}
	}
	return int(float64(completed) / float64(len(subtasks)) * 100.0)
}

func decodeSubtasks(raw string) []Subtask {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var out []Subtask
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	return out
}

func (s *AgentTaskService) ListTasks(ctx context.Context, ownerActorID, agentID string) ([]*persistence.AgentTask, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	query := db.WithContext(ctx).Where("owner_actor_id = ?", ownerActorID)
	if strings.TrimSpace(agentID) != "" {
		query = query.Where("agent_id = ?", agentID)
	}
	var rows []persistence.AgentTask
	if err := query.Order("created_at DESC").Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list tasks", err)
	}
	out := make([]*persistence.AgentTask, len(rows))
	for i := range rows {
		out[i] = &rows[i]
	}
	return out, nil
}

func (s *AgentTaskService) ListTaskMigrationReadbacks(
	ctx context.Context,
	ownerActorID string,
) ([]persistence.AgentTaskGoalMap, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	if err := persistence.MigrateAgentTasks(db); err != nil {
		return nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to migrate legacy Agent tasks",
			err,
		)
	}
	rows, err := persistence.ListAgentTaskGoalMaps(ctx, db, ownerActorID)
	if err != nil {
		return nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to read migrated Agent tasks",
			err,
		)
	}
	return rows, nil
}

func (s *AgentTaskService) loadOwned(ctx context.Context, db *gorm.DB, ownerActorID, id string) (*persistence.AgentTask, error) {
	var row persistence.AgentTask
	if err := db.WithContext(ctx).Where("id = ? AND owner_actor_id = ?", id, ownerActorID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusNotFound, "task not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load task", err)
	}
	return &row, nil
}

var validStatus = map[string]bool{
	"pending": true, "running": true, "paused": true,
	"completed": true, "failed": true, "cancelled": true,
}

// UpdateStatus drives the manual lifecycle (start/pause/cancel/complete/fail).
func (s *AgentTaskService) UpdateStatus(ctx context.Context, ownerActorID, id, status, result, taskError string) (*persistence.AgentTask, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	id = strings.TrimSpace(id)
	if id == "" || !validStatus[status] {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "id and a valid status are required", nil)
	}
	row, err := s.loadOwned(ctx, db, ownerActorID, id)
	if err != nil {
		return nil, err
	}
	updates := map[string]interface{}{"status": status, "updated_at": time.Now()}
	if status == "completed" {
		now := time.Now()
		updates["progress"] = 100
		updates["completed_at"] = &now
		if result != "" {
			updates["result"] = result
		}
	}
	if status == "failed" && taskError != "" {
		updates["error"] = taskError
	}
	if err := db.WithContext(ctx).Model(row).Updates(updates).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to update task status", err)
	}
	return s.loadOwned(ctx, db, ownerActorID, id)
}

func (s *AgentTaskService) DeleteTask(ctx context.Context, ownerActorID, id string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	if strings.TrimSpace(id) == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "id is required", nil)
	}
	if err := db.WithContext(ctx).Where("id = ? AND owner_actor_id = ?", id, ownerActorID).Delete(&persistence.AgentTask{}).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to delete task", err)
	}
	return nil
}

func (s *AgentTaskService) AddSubtask(ctx context.Context, ownerActorID, taskID, title string) (*persistence.AgentTask, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	title = strings.TrimSpace(title)
	if strings.TrimSpace(taskID) == "" || title == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task_id and title are required", nil)
	}
	row, err := s.loadOwned(ctx, db, ownerActorID, taskID)
	if err != nil {
		return nil, err
	}
	subtasks := decodeSubtasks(row.SubtasksJSON)
	subtasks = append(subtasks, Subtask{ID: generateID("sub"), Title: title, Status: "pending"})
	return s.persistSubtasks(ctx, db, ownerActorID, row, subtasks)
}

func (s *AgentTaskService) CompleteSubtask(ctx context.Context, ownerActorID, taskID, subtaskID string) (*persistence.AgentTask, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(taskID) == "" || strings.TrimSpace(subtaskID) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task_id and subtask_id are required", nil)
	}
	row, err := s.loadOwned(ctx, db, ownerActorID, taskID)
	if err != nil {
		return nil, err
	}
	subtasks := decodeSubtasks(row.SubtasksJSON)
	for i := range subtasks {
		if subtasks[i].ID == subtaskID {
			subtasks[i].Status = "completed"
			subtasks[i].CompletedAt = time.Now().UnixMilli()
		}
	}
	return s.persistSubtasks(ctx, db, ownerActorID, row, subtasks)
}

func (s *AgentTaskService) persistSubtasks(ctx context.Context, db *gorm.DB, ownerActorID string, row *persistence.AgentTask, subtasks []Subtask) (*persistence.AgentTask, error) {
	encoded, _ := json.Marshal(subtasks)
	updates := map[string]interface{}{
		"subtasks_json": string(encoded),
		"progress":      computeProgress(subtasks),
		"updated_at":    time.Now(),
	}
	if err := db.WithContext(ctx).Model(row).Updates(updates).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to update subtasks", err)
	}
	return s.loadOwned(ctx, db, ownerActorID, row.ID)
}
