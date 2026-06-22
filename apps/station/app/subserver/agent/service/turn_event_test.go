package service

import (
	"context"
	"testing"
	"time"
)

func TestEmitTurnEventAppliesTurnContext(t *testing.T) {
	var captured TurnEvent
	config := &TurnConfig{
		AgentID:        "agent_1",
		ConversationID: "conv_1",
		EventSink: func(ctx context.Context, event TurnEvent) {
			captured = event
		},
	}

	var svc TurnService
	svc.emitTurnEvent(context.Background(), config, "turn_1", TurnEvent{
		Type:  "tool_call",
		Stage: "dispatch",
	})

	if captured.Type != "tool_call" {
		t.Fatalf("expected tool_call event, got %q", captured.Type)
	}
	if captured.TurnID != "turn_1" {
		t.Fatalf("expected turn id to be applied, got %q", captured.TurnID)
	}
	if captured.AgentID != "agent_1" {
		t.Fatalf("expected agent id to be applied, got %q", captured.AgentID)
	}
	if captured.ConversationID != "conv_1" {
		t.Fatalf("expected conversation id to be applied, got %q", captured.ConversationID)
	}
}

func TestDesktopLocalBuiltinToolUsesLocalBridge(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	events := make(chan TurnEvent, 1)
	svc := TurnService{localToolBroker: NewLocalToolBroker()}
	config := &TurnConfig{
		AgentID:        "agent_1",
		ConversationID: "conv_1",
		WorkspaceRoot:  "/workspace/project",
		EventSink: func(ctx context.Context, event TurnEvent) {
			if event.Type == "local_tool_request" {
				events <- event
			}
		},
	}

	resultCh := make(chan struct {
		content string
		err     error
	}, 1)
	go func() {
		content, err := svc.executeDesktopLocalBuiltinTool(ctx, config, "turn_1", "call_1", toolCallEntry{
			ToolName:  "local_file_read",
			Arguments: `{"path":"README.md"}`,
		})
		resultCh <- struct {
			content string
			err     error
		}{content: content, err: err}
	}()

	var event TurnEvent
	select {
	case event = <-events:
	case <-ctx.Done():
		t.Fatal("timed out waiting for local tool request")
	}

	if event.Source != "builtin" {
		t.Fatalf("expected builtin source, got %q", event.Source)
	}
	if event.ToolName != "local_file_read" {
		t.Fatalf("expected local_file_read request, got %q", event.ToolName)
	}
	if event.WorkspaceRoot != "/workspace/project" {
		t.Fatalf("expected workspace root to be forwarded, got %q", event.WorkspaceRoot)
	}

	if err := svc.SubmitLocalToolResult(LocalToolResult{
		TurnID:  "turn_1",
		CallID:  "call_1",
		Content: `{"ok":true}`,
	}); err != nil {
		t.Fatalf("submit local tool result failed: %v", err)
	}

	select {
	case result := <-resultCh:
		if result.err != nil {
			t.Fatalf("expected local builtin result, got err %v", result.err)
		}
		if result.content != `{"ok":true}` {
			t.Fatalf("unexpected local builtin result: %s", result.content)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for local builtin result")
	}
}

func TestDesktopLocalBuiltinToolRejectsInvalidArguments(t *testing.T) {
	svc := TurnService{localToolBroker: NewLocalToolBroker()}
	_, err := svc.executeDesktopLocalBuiltinTool(context.Background(), &TurnConfig{}, "turn_1", "call_1", toolCallEntry{
		ToolName:  "local_file_read",
		Arguments: `{`,
	})
	if err == nil {
		t.Fatal("expected invalid JSON arguments error")
	}
}

func TestIsDesktopLocalBuiltinTool(t *testing.T) {
	if !isDesktopLocalBuiltinTool("local_clipboard_read") {
		t.Fatal("expected clipboard read to be a Desktop local builtin tool")
	}
	if !isDesktopLocalBuiltinTool("oauth_connector_call") {
		t.Fatal("expected OAuth connector call to be a Desktop local builtin tool")
	}
	if isDesktopLocalBuiltinTool("memory") {
		t.Fatal("memory must stay Station-owned")
	}
}
