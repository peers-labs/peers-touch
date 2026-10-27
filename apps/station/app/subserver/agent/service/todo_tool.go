package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

const (
	todoMaxItems   = 50
	todoMaxContent = 1000
	todoStatusOpen = "pending"
	todoStatusDone = "completed"
)

var todoAllowedStatuses = map[string]bool{
	todoStatusOpen: true,
	"in_progress":  true,
	todoStatusDone: true,
}

// TodoService owns the Agent's per-turn task checklist. It is a
// Station-executed builtin tool: writes are bounded to the checklist
// semantics only (no files, no network) and therefore auto-approved.
type TodoService struct{}

func NewTodoService() *TodoService { return &TodoService{} }

type todoItem struct {
	ID       string `json:"id"`
	Content  string `json:"content"`
	Status   string `json:"status"`
	Position int    `json:"position"`
}

func (s *TodoService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, err
	}
	return db, nil
}

func newTodoID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("todo-%d", time.Now().UnixNano())
	}
	return "todo-" + hex.EncodeToString(buf)
}

// Write replaces the conversation checklist with the supplied items.
// Existing completed identities are preserved when the model resends the
// same list (matching by position then content).
func (s *TodoService) Write(
	ctx context.Context,
	meta *domain.ToolCallMeta,
	items []todoItem,
) ([]todoItem, error) {
	if err := validateTodoItems(items); err != nil {
		return nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var existing []persistence.AgentTurnTodo
	if err := db.WithContext(ctx).
		Where("conversation_id = ?", meta.ConversationID).
		Order("position ASC").
		Find(&existing).Error; err != nil {
		return nil, fmt.Errorf("load todo list: %w", err)
	}
	completedByPosition := map[int]bool{}
	completedByContent := map[string]bool{}
	for _, row := range existing {
		if row.Status == todoStatusDone {
			completedByPosition[row.Position] = true
			completedByContent[row.Content] = true
		}
	}
	now := time.Now().UTC()
	rows := make([]persistence.AgentTurnTodo, 0, len(items))
	for index, item := range items {
		status := strings.TrimSpace(item.Status)
		if status == "" {
			status = todoStatusOpen
		}
		// Preserve completion for resubmitted identical lists.
		if status == todoStatusOpen &&
			(completedByPosition[index] || completedByContent[item.Content]) {
			status = todoStatusDone
		}
		id := strings.TrimSpace(item.ID)
		if id == "" {
			id = newTodoID()
		}
		rows = append(rows, persistence.AgentTurnTodo{
			ID:             id,
			TurnID:         meta.TurnID,
			ActorPTID:      meta.ActorID,
			ConversationID: meta.ConversationID,
			AgentID:        meta.AgentID,
			Position:       index,
			Content:        item.Content,
			Status:         status,
			CreatedAt:      now,
			UpdatedAt:      now,
		})
	}
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("conversation_id = ?", meta.ConversationID).
			Delete(&persistence.AgentTurnTodo{}).Error; err != nil {
			return err
		}
		if len(rows) > 0 {
			return tx.Create(&rows).Error
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("persist todo list: %w", err)
	}
	return todoRowsToItems(rows), nil
}

// Update changes the status of one checklist item by id or position.
func (s *TodoService) Update(
	ctx context.Context,
	meta *domain.ToolCallMeta,
	id string,
	position *int,
	status string,
) ([]todoItem, error) {
	status = strings.TrimSpace(status)
	if !todoAllowedStatuses[status] {
		return nil, fmt.Errorf("todo status must be one of pending, in_progress, completed")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	tx := db.WithContext(ctx).Model(&persistence.AgentTurnTodo{}).
		Where("conversation_id = ?", meta.ConversationID)
	switch {
	case strings.TrimSpace(id) != "":
		tx = tx.Where("id = ?", strings.TrimSpace(id))
	case position != nil:
		tx = tx.Where("position = ?", *position)
	default:
		return nil, fmt.Errorf("todo_update requires id or position")
	}
	result := tx.UpdateColumn("status", status)
	if result.Error != nil {
		return nil, fmt.Errorf("update todo item: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return nil, fmt.Errorf("todo item not found")
	}
	return s.List(ctx, meta)
}

// List returns the current checklist for a conversation.
func (s *TodoService) List(ctx context.Context, meta *domain.ToolCallMeta) ([]todoItem, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []persistence.AgentTurnTodo
	if err := db.WithContext(ctx).
		Where("conversation_id = ?", meta.ConversationID).
		Order("position ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("load todo list: %w", err)
	}
	return todoRowsToItems(rows), nil
}

func validateTodoItems(items []todoItem) error {
	if len(items) == 0 {
		return fmt.Errorf("todo list must contain at least one item")
	}
	if len(items) > todoMaxItems {
		return fmt.Errorf("todo list cannot exceed %d items", todoMaxItems)
	}
	seen := map[string]bool{}
	for index, item := range items {
		content := strings.TrimSpace(item.Content)
		if content == "" {
			return fmt.Errorf("todo item %d content is required", index)
		}
		if len([]rune(content)) > todoMaxContent {
			return fmt.Errorf("todo item %d exceeds %d characters", index, todoMaxContent)
		}
		if item.Status != "" && !todoAllowedStatuses[item.Status] {
			return fmt.Errorf("todo item %d has invalid status %q", index, item.Status)
		}
		if seen[content] {
			return fmt.Errorf("todo item %q is duplicated", content)
		}
		seen[content] = true
	}
	return nil
}

func todoRowsToItems(rows []persistence.AgentTurnTodo) []todoItem {
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i].Position < rows[j].Position
	})
	items := make([]todoItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, todoItem{
			ID:       row.ID,
			Content:  row.Content,
			Status:   row.Status,
			Position: row.Position,
		})
	}
	return items
}

func marshalTodoItems(items []todoItem) string {
	payload, err := json.Marshal(struct {
		Items []todoItem `json:"items"`
	}{Items: items})
	if err != nil {
		return `{"items":[]}`
	}
	return string(payload)
}

// RegisterTodoTools registers the Station-owned todo_write and
// todo_update builtin tools on the tool registry.
func RegisterTodoTools(registry *ToolRegistryService, svc *TodoService) {
	writeSchema := json.RawMessage(`{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "description": "Complete ordered task checklist for this turn. Replaces the previous list.",
      "items": {
        "type": "object",
        "properties": {
          "id": {"type": "string", "description": "Stable item id when updating an existing entry"},
          "content": {"type": "string", "description": "Single actionable task"},
          "status": {"type": "string", "enum": ["pending", "in_progress", "completed"]}
        },
        "required": ["content"]
      }
    }
  },
  "required": ["items"]
}`)
	updateSchema := json.RawMessage(`{
  "type": "object",
  "properties": {
    "id": {"type": "string", "description": "Item id returned by todo_write"},
    "position": {"type": "integer", "description": "Zero-based item position when id is unavailable"},
    "status": {"type": "string", "enum": ["pending", "in_progress", "completed"]}
  },
  "required": ["status"]
}`)

	registry.Register(&domain.ToolDefinition{
		Name: "todo_write",
		Description: "Maintain the task checklist for the current turn. " +
			"Send the full ordered list; completed identical entries are preserved. " +
			"Use it to plan and track multi-step work.",
		JSONSchema: writeSchema,
		Handler: func(ctx context.Context, meta *domain.ToolCallMeta, raw json.RawMessage) (*domain.ToolResult, error) {
			var args struct {
				Items []todoItem `json:"items"`
			}
			if err := json.Unmarshal(raw, &args); err != nil {
				return &domain.ToolResult{Content: "invalid todo_write arguments: " + err.Error(), IsError: true}, nil
			}
			items, err := svc.Write(ctx, meta, args.Items)
			if err != nil {
				return &domain.ToolResult{Content: "todo_write failed: " + err.Error(), IsError: true}, nil
			}
			return &domain.ToolResult{Content: marshalTodoItems(items)}, nil
		},
	})

	registry.Register(&domain.ToolDefinition{
		Name:        "todo_update",
		Description: "Mark one checklist item pending, in_progress, or completed by its id or position.",
		JSONSchema:  updateSchema,
		Handler: func(ctx context.Context, meta *domain.ToolCallMeta, raw json.RawMessage) (*domain.ToolResult, error) {
			var args struct {
				ID       string `json:"id"`
				Position *int   `json:"position"`
				Status   string `json:"status"`
			}
			if err := json.Unmarshal(raw, &args); err != nil {
				return &domain.ToolResult{Content: "invalid todo_update arguments: " + err.Error(), IsError: true}, nil
			}
			items, err := svc.Update(ctx, meta, args.ID, args.Position, args.Status)
			if err != nil {
				return &domain.ToolResult{Content: "todo_update failed: " + err.Error(), IsError: true}, nil
			}
			return &domain.ToolResult{Content: marshalTodoItems(items)}, nil
		},
	})
}
