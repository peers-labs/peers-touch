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

func TestExecutorDoesNotExposeStationSecrets(t *testing.T) {
	root := t.TempDir()
	envPath := filepath.Join(root, "environment.txt")
	commandPath := writeExecutable(t, root, "provider", `#!/bin/sh
cat >/dev/null
env > "$1"
printf '%s\n' '{"type":"done","content":"safe"}'
`)
	t.Setenv("PEERS_AUTH_SECRET", "must-not-reach-cli")
	t.Setenv("PEERS_DB_DSN", "must-not-reach-cli")
	t.Setenv("HOME", root)
	executor := NewExecutor(&WorkspaceManager{BaseDir: filepath.Join(root, "workspaces")})

	_, err := executor.Execute(context.Background(), &ExecuteRequest{
		ActorPTID:      "actor-1",
		AgentID:        "agent-1",
		ConversationID: "conversation-1",
		CliCommand:     commandPath + " " + envPath,
		Messages: []domain.Message{
			{Role: domain.MessageRoleUser, Content: "hello"},
		},
	}, nil)
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	environment, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("read child environment: %v", err)
	}
	value := string(environment)
	for _, forbidden := range []string{"PEERS_AUTH_SECRET=", "PEERS_DB_DSN="} {
		if strings.Contains(value, forbidden) {
			t.Fatalf("child environment contains %s", forbidden)
		}
	}
	for _, required := range []string{
		"HOME=" + root,
		"PEERS_TOUCH_AGENT_ID=agent-1",
		"PEERS_TOUCH_CONVERSATION_ID=conversation-1",
	} {
		if !strings.Contains(value, required) {
			t.Fatalf("child environment does not contain %q: %s", required, value)
		}
	}
}

func TestExecutorBoundsTotalStdout(t *testing.T) {
	root := t.TempDir()
	commandPath := writeExecutable(t, root, "provider", `#!/bin/sh
cat >/dev/null
i=0
while [ "$i" -lt 3000 ]; do
  printf '%01024d\n' 0
  i=$((i + 1))
done
`)
	executor := NewExecutor(&WorkspaceManager{BaseDir: filepath.Join(root, "workspaces")})

	_, err := executor.Execute(context.Background(), &ExecuteRequest{
		ActorPTID:  "actor-1",
		CliCommand: commandPath,
		Messages: []domain.Message{
			{Role: domain.MessageRoleUser, Content: "hello"},
		},
	}, nil)
	if !IsFailureKind(err, FailureOutput) {
		t.Fatalf("Execute() error = %v, want output_failed", err)
	}
}

func TestExecutorDrainsOutputAfterTerminalEvent(t *testing.T) {
	root := t.TempDir()
	commandPath := writeExecutable(t, root, "provider", `#!/bin/sh
cat >/dev/null
printf '%s\n' '{"type":"done","content":"complete"}'
dd if=/dev/zero bs=1024 count=128 2>/dev/null | tr '\000' x
`)
	executor := NewExecutor(&WorkspaceManager{BaseDir: filepath.Join(root, "workspaces")})
	executor.Timeout = 2 * time.Second

	result, err := executor.Execute(context.Background(), &ExecuteRequest{
		ActorPTID:  "actor-1",
		CliCommand: commandPath,
		Messages: []domain.Message{
			{Role: domain.MessageRoleUser, Content: "hello"},
		},
	}, nil)
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if result.Content != "complete" {
		t.Fatalf("Execute() content = %q, want complete", result.Content)
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
