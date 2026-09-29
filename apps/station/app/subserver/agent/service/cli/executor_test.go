package cli

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

func TestExecutorStreamsResponseAndReceivesCompleteConversation(t *testing.T) {
	root := t.TempDir()
	promptPath := filepath.Join(root, "prompt.txt")
	commandPath := writeExecutable(t, root, "provider", `#!/bin/sh
cat > "$1"
printf '%s\n' '{"type":"delta","content":"hello "}'
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"world"}}'
printf '%s\n' '{"type":"done"}'
`)
	executor := NewExecutor(&WorkspaceManager{BaseDir: filepath.Join(root, "workspaces")})

	var deltas []string
	result, err := executor.Execute(context.Background(), &ExecuteRequest{
		ActorPTID:      "actor-1",
		AgentID:        "agent-1",
		ConversationID: "conversation-1",
		Provider:       "test-cli",
		Model:          "default",
		CliCommand:     commandPath + " " + promptPath,
		SystemPrompt:   "system contract",
		Messages: []domain.Message{
			{Role: domain.MessageRoleUser, Content: "first question"},
			{Role: domain.MessageRoleAssistant, Content: "first answer"},
			{Role: domain.MessageRoleUser, Content: "follow up"},
		},
	}, func(_ context.Context, delta Delta) error {
		if delta.Type == "text" {
			deltas = append(deltas, delta.Content)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if result.Content != "hello world" || !result.Streamed {
		t.Fatalf("Execute() result = %+v", result)
	}
	if strings.Join(deltas, "") != "hello world" {
		t.Fatalf("streamed deltas = %#v", deltas)
	}
	prompt, err := os.ReadFile(promptPath)
	if err != nil {
		t.Fatalf("read prompt: %v", err)
	}
	for _, expected := range []string{
		"# System\nsystem contract",
		"## user\nfirst question",
		"## assistant\nfirst answer",
		"## user\nfollow up",
	} {
		if !strings.Contains(string(prompt), expected) {
			t.Fatalf("prompt does not contain %q: %s", expected, prompt)
		}
	}
}

func TestExecutorReturnsTypedMissingBinary(t *testing.T) {
	executor := NewExecutor(&WorkspaceManager{BaseDir: t.TempDir()})
	_, err := executor.Execute(context.Background(), &ExecuteRequest{
		ActorPTID:  "actor-1",
		CliCommand: "peers-touch-cli-that-does-not-exist",
		Messages: []domain.Message{
			{Role: domain.MessageRoleUser, Content: "hello"},
		},
	}, nil)
	if !IsFailureKind(err, FailureBinaryMissing) {
		t.Fatalf("Execute() error = %v, want binary_missing", err)
	}
	if strings.Contains(err.Error(), t.TempDir()) {
		t.Fatalf("typed error leaked a host path: %v", err)
	}
}

func TestExecutorReturnsTypedExitWithoutStderrLeak(t *testing.T) {
	root := t.TempDir()
	commandPath := writeExecutable(t, root, "provider", `#!/bin/sh
cat >/dev/null
printf '%s\n' 'secret-provider-detail' >&2
exit 7
`)
	executor := NewExecutor(&WorkspaceManager{BaseDir: filepath.Join(root, "workspaces")})
	_, err := executor.Execute(context.Background(), &ExecuteRequest{
		ActorPTID:  "actor-1",
		CliCommand: commandPath,
		Messages: []domain.Message{
			{Role: domain.MessageRoleUser, Content: "hello"},
		},
	}, nil)
	if !IsFailureKind(err, FailureExit) {
		t.Fatalf("Execute() error = %v, want execution_failed", err)
	}
	if strings.Contains(err.Error(), "secret-provider-detail") ||
		strings.Contains(err.Error(), root) {
		t.Fatalf("typed error leaked provider stderr or a host path: %v", err)
	}
}

func TestExecutorReturnsTypedStreamFailure(t *testing.T) {
	root := t.TempDir()
	commandPath := writeExecutable(t, root, "provider", `#!/bin/sh
cat >/dev/null
printf '%s\n' '{"type":"turn.failed","error":{"message":"expired credential"}}'
exit 1
`)
	executor := NewExecutor(&WorkspaceManager{BaseDir: filepath.Join(root, "workspaces")})
	_, err := executor.Execute(context.Background(), &ExecuteRequest{
		ActorPTID:  "actor-1",
		CliCommand: commandPath,
		Messages: []domain.Message{
			{Role: domain.MessageRoleUser, Content: "hello"},
		},
	}, nil)
	if !IsFailureKind(err, FailureExit) {
		t.Fatalf("Execute() error = %v, want execution_failed", err)
	}
	if strings.Contains(err.Error(), "expired credential") {
		t.Fatalf("typed error leaked CLI failure details: %v", err)
	}
}

func TestExecutorReturnsTypedTimeout(t *testing.T) {
	root := t.TempDir()
	commandPath := writeExecutable(t, root, "provider", `#!/bin/sh
sleep 5
`)
	executor := NewExecutor(&WorkspaceManager{BaseDir: filepath.Join(root, "workspaces")})
	executor.Timeout = 20 * time.Millisecond
	_, err := executor.Execute(context.Background(), &ExecuteRequest{
		ActorPTID:  "actor-1",
		CliCommand: commandPath,
		Messages: []domain.Message{
			{Role: domain.MessageRoleUser, Content: "hello"},
		},
	}, nil)
	if !IsFailureKind(err, FailureTimeout) {
		t.Fatalf("Execute() error = %v, want timeout", err)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Execute() error = %v, want deadline cause", err)
	}
}

func writeExecutable(t *testing.T, root, name, content string) string {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("write executable: %v", err)
	}
	return path
}
