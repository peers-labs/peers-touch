package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

func todoTestMeta() *domain.ToolCallMeta {
	return &domain.ToolCallMeta{
		ActorID:        "ptid:person:owner",
		AgentID:        "agent-todo",
		ConversationID: "conversation-todo",
		TurnID:         "turn-todo",
	}
}

func setupTodoDB(t *testing.T) {
	t.Helper()
	db := openConversationAuthorityDB(t, "todo_tool_db")
	if err := db.AutoMigrate(&persistence.AgentTurnTodo{}); err != nil {
		t.Fatalf("migrate turn todos: %v", err)
	}
}

func TestTodoWriteUpdateListLifecycle(t *testing.T) {
	setupTodoDB(t)
	svc := NewTodoService()
	ctx := context.Background()
	meta := todoTestMeta()

	items, err := svc.Write(ctx, meta, []todoItem{
		{Content: "read materials"},
		{Content: "edit file"},
		{Content: "run checks"},
	})
	if err != nil {
		t.Fatalf("todo write: %v", err)
	}
	if len(items) != 3 || items[0].ID == "" || items[0].Status != todoStatusOpen {
		t.Fatalf("unexpected seeded items: %+v", items)
	}

	items, err = svc.Update(ctx, meta, items[1].ID, nil, todoStatusDone)
	if err != nil {
		t.Fatalf("todo update: %v", err)
	}
	if items[1].Status != todoStatusDone {
		t.Fatalf("item status = %q, want completed", items[1].Status)
	}
	if items[0].Status != todoStatusOpen || items[2].Status != todoStatusOpen {
		t.Fatalf("sibling items mutated: %+v", items)
	}

	// Resending the same list preserves the completed identity.
	items, err = svc.Write(ctx, meta, []todoItem{
		{Content: "read materials"},
		{Content: "edit file"},
		{Content: "run checks"},
	})
	if err != nil {
		t.Fatalf("todo rewrite: %v", err)
	}
	if items[1].Status != todoStatusDone {
		t.Fatalf("completed entry reset after rewrite: %+v", items)
	}

	loaded, err := svc.List(ctx, meta)
	if err != nil || len(loaded) != 3 || loaded[1].Status != todoStatusDone {
		t.Fatalf("persisted list mismatch: items=%+v err=%v", loaded, err)
	}
}

func TestTodoValidationRejectsBadLists(t *testing.T) {
	svc := NewTodoService()
	cases := [][]todoItem{
		nil,
		{{Content: ""}},
		{{Content: "a"}, {Content: "a"}},
	}
	for index, items := range cases {
		if _, err := svc.Write(context.Background(), todoTestMeta(), items); err == nil {
			t.Fatalf("case %d expected validation error", index)
		}
	}
	oversized := make([]todoItem, todoMaxItems+1)
	for i := range oversized {
		oversized[i] = todoItem{Content: "task"}
	}
	if _, err := svc.Write(context.Background(), todoTestMeta(), oversized); err == nil {
		t.Fatal("over-limit list must be rejected")
	}
}

func TestTodoRegisteredToolsDispatch(t *testing.T) {
	setupTodoDB(t)
	registry := NewToolRegistryService(nil, nil)
	RegisterTodoTools(registry, NewTodoService())
	meta := todoTestMeta()

	result := registry.Dispatch(context.Background(), meta, "todo_write", `{
		"items": [{"content":"first"},{"content":"second"}]
	}`)
	if result.IsError {
		t.Fatalf("todo_write dispatch failed: %s", result.Content)
	}
	var payload struct {
		Items []todoItem `json:"items"`
	}
	if err := json.Unmarshal([]byte(result.Content), &payload); err != nil {
		t.Fatalf("todo_write payload: %v", err)
	}
	if len(payload.Items) != 2 {
		t.Fatalf("items = %d, want 2", len(payload.Items))
	}

	result = registry.Dispatch(context.Background(), meta, "todo_update", `{
		"position": 0, "status": "completed"
	}`)
	if result.IsError {
		t.Fatalf("todo_update dispatch failed: %s", result.Content)
	}
	if result := registry.Dispatch(context.Background(), meta, "todo_update", `{
		"position": 9, "status": "completed"
	}`); !result.IsError {
		t.Fatal("updating missing item must return an error result")
	}
}

func TestWebFetchRegisteredToolRejectsInvalidArguments(t *testing.T) {
	registry := NewToolRegistryService(nil, nil)
	RegisterWebFetchTool(registry, NewWebFetchService())
	result := registry.Dispatch(
		context.Background(),
		todoTestMeta(),
		"web_fetch",
		`{"url":"http://127.0.0.1:8080"}`,
	)
	if !result.IsError {
		t.Fatal("web_fetch to loopback must fail closed")
	}

}
