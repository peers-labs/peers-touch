//go:build !windows

package externalruntime

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestManagerCreatesResumesAndCleansOneBoundSession(t *testing.T) {
	root := t.TempDir()
	script := writeExecutable(t, root, "session-runtime", `#!/bin/sh
action="$1"
session="$2"
home="$3"
if [ "$action" = "start" ]; then
  cat >/dev/null
  printf '%s\n' '{"type":"session.started","session_id":"session-1"}'
  printf '%s\n' '{"type":"activity","activity":{"id":"activity-1","kind":"command","status":"completed","title":"Inspect workspace"}}'
  printf '%s\n' '{"type":"text.delta","content":"first"}'
  exit 0
fi
if [ "$action" = "resume" ]; then
  cat >/dev/null
  printf '%s\n' "{\"type\":\"session.started\",\"session_id\":\"$session\"}"
  printf '%s\n' '{"type":"text.delta","content":"follow-up"}'
  exit 0
fi
if [ "$action" = "reset" ]; then
  printf '%s\n' "$session" > "$home/reset-session"
  exit 0
fi
exit 2
`)
	manager := newTestManager(t, root, script)
	homeRef, err := RuntimeHomeRef("ptid:person:alice", "conversation-1", 1)
	if err != nil {
		t.Fatalf("RuntimeHomeRef() error = %v", err)
	}
	var persisted []string
	var deltas []Delta
	var activities []ActivityKind
	result, err := manager.Execute(
		context.Background(),
		ExecuteRequest{
			ActorPTID:        "ptid:person:alice",
			AgentID:          "agent-1",
			ConversationID:   "conversation-1",
			RuntimeProfileID: "modern-chat-agent-v1",
			RuntimeHomeRef:   homeRef,
			SessionEpoch:     1,
			Prompt:           "first prompt",
		},
		func(_ context.Context, delta Delta) error {
			if len(persisted) != 1 {
				t.Fatal("runtime output arrived before the session was persisted")
			}
			deltas = append(deltas, delta)
			return nil
		},
		func(_ context.Context, sessionID string) error {
			persisted = append(persisted, sessionID)
			return nil
		},
		func(kind ActivityKind) { activities = append(activities, kind) },
	)
	if err != nil {
		t.Fatalf("Execute(start) error = %v", err)
	}
	if result.SessionID != "session-1" || result.Content != "first" {
		t.Fatalf("Execute(start) result = %+v", result)
	}
	if !reflect.DeepEqual(persisted, []string{"session-1"}) {
		t.Fatalf("persisted sessions = %#v", persisted)
	}
	if len(deltas) != 2 || deltas[0].Type != "external_activity" ||
		deltas[1].Type != "text" {
		t.Fatalf("deltas = %#v", deltas)
	}
	if !reflect.DeepEqual(
		activities,
		[]ActivityKind{
			ActivityRuntimeHomeCreated,
			ActivityProcessStarted,
			ActivitySessionCreated,
		},
	) {
		t.Fatalf("activities = %#v", activities)
	}

	resumed, err := manager.Execute(
		context.Background(),
		ExecuteRequest{
			ActorPTID:        "ptid:person:alice",
			AgentID:          "agent-1",
			ConversationID:   "conversation-1",
			RuntimeProfileID: "modern-chat-agent-v1",
			RuntimeHomeRef:   homeRef,
			SessionID:        result.SessionID,
			SessionEpoch:     1,
			Prompt:           "follow up",
		},
		nil,
		func(_ context.Context, _ string) error {
			t.Fatal("resume must not persist a replacement session")
			return nil
		},
		nil,
	)
	if err != nil {
		t.Fatalf("Execute(resume) error = %v", err)
	}
	if resumed.SessionID != result.SessionID ||
		resumed.Content != "follow-up" {
		t.Fatalf("Execute(resume) result = %+v", resumed)
	}

	if err := manager.Cleanup(context.Background(), CleanupRequest{
		RuntimeHomeRef: homeRef,
		SessionID:      result.SessionID,
	}); err != nil {
		t.Fatalf("Cleanup() error = %v", err)
	}
	home, _ := resolveRuntimeHome(manager.config.RuntimeRoot, homeRef)
	if _, err := os.Stat(home); !os.IsNotExist(err) {
		t.Fatalf("runtime home still exists after cleanup: %v", err)
	}
	if err := manager.Cleanup(context.Background(), CleanupRequest{
		RuntimeHomeRef: homeRef,
		SessionID:      result.SessionID,
	}); err != nil {
		t.Fatalf("Cleanup() replay error = %v", err)
	}
}

func TestManagerReturnsTypedResumeUnavailableWithoutStartingAnotherSession(
	t *testing.T,
) {
	root := t.TempDir()
	script := writeExecutable(t, root, "session-runtime", `#!/bin/sh
cat >/dev/null
printf '%s\n' '{"type":"turn.failed","code":"resume_unavailable"}'
exit 7
`)
	manager := newTestManager(t, root, script)
	homeRef, _ := RuntimeHomeRef("ptid:person:alice", "conversation-1", 2)
	_, err := manager.Execute(
		context.Background(),
		ExecuteRequest{
			ActorPTID:        "ptid:person:alice",
			AgentID:          "agent-1",
			ConversationID:   "conversation-1",
			RuntimeProfileID: "modern-chat-agent-v1",
			RuntimeHomeRef:   homeRef,
			SessionID:        "session-missing",
			SessionEpoch:     2,
			Prompt:           "resume",
		},
		nil,
		nil,
		nil,
	)
	if !IsFailureKind(err, FailureResumeUnavailable) {
		t.Fatalf("Execute() error = %v, want resume_unavailable", err)
	}
}

func TestManagerDoesNotDuplicateCompletedContentAfterDeltas(t *testing.T) {
	root := t.TempDir()
	script := writeExecutable(t, root, "session-runtime", `#!/bin/sh
cat >/dev/null
printf '%s\n' '{"type":"session.started","session_id":"session-1"}'
printf '%s\n' '{"type":"text.delta","content":"hello"}'
printf '%s\n' '{"type":"turn.completed","content":"hello"}'
`)
	manager := newTestManager(t, root, script)
	homeRef, _ := RuntimeHomeRef("ptid:person:alice", "conversation-1", 1)
	result, err := manager.Execute(
		context.Background(),
		ExecuteRequest{
			ActorPTID:        "ptid:person:alice",
			AgentID:          "agent-1",
			ConversationID:   "conversation-1",
			RuntimeProfileID: "modern-chat-agent-v1",
			RuntimeHomeRef:   homeRef,
			SessionEpoch:     1,
			Prompt:           "hello",
		},
		nil,
		func(context.Context, string) error { return nil },
		nil,
	)
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if result.Content != "hello" {
		t.Fatalf("content = %q, want one completed response", result.Content)
	}
}

func TestManagerRejectsOutputBeforeFirstSessionIsPersisted(t *testing.T) {
	root := t.TempDir()
	script := writeExecutable(t, root, "session-runtime", `#!/bin/sh
cat >/dev/null
printf '%s\n' '{"type":"text.delta","content":"too early"}'
printf '%s\n' '{"type":"session.started","session_id":"session-1"}'
`)
	manager := newTestManager(t, root, script)
	homeRef, _ := RuntimeHomeRef("ptid:person:alice", "conversation-1", 1)
	_, err := manager.Execute(
		context.Background(),
		ExecuteRequest{
			ActorPTID:        "ptid:person:alice",
			AgentID:          "agent-1",
			ConversationID:   "conversation-1",
			RuntimeProfileID: "modern-chat-agent-v1",
			RuntimeHomeRef:   homeRef,
			SessionEpoch:     1,
			Prompt:           "hello",
		},
		nil,
		func(context.Context, string) error { return nil },
		nil,
	)
	if !IsFailureKind(err, FailureOutput) {
		t.Fatalf("Execute() error = %v, want output_failed", err)
	}
}

func TestManagerRejectsInvalidHomeReference(t *testing.T) {
	root := t.TempDir()
	script := writeExecutable(t, root, "session-runtime", "#!/bin/sh\nexit 0\n")
	manager := newTestManager(t, root, script)
	_, err := manager.Execute(
		context.Background(),
		ExecuteRequest{
			ActorPTID:        "ptid:person:alice",
			AgentID:          "agent-1",
			ConversationID:   "conversation-1",
			RuntimeProfileID: "modern-chat-agent-v1",
			RuntimeHomeRef:   "../escape",
			SessionEpoch:     1,
			Prompt:           "hello",
		},
		nil,
		nil,
		nil,
	)
	if !IsFailureKind(err, FailureInvalidConfig) {
		t.Fatalf("Execute() error = %v, want invalid_config", err)
	}
	if _, err := os.Stat(filepath.Join(root, "..", "escape")); !os.IsNotExist(err) {
		t.Fatalf("invalid runtime home escaped root: %v", err)
	}
}

func TestManagerRejectsUnconfiguredAdapter(t *testing.T) {
	_, err := NewManager(Config{RuntimeRoot: t.TempDir()})
	if !IsFailureKind(err, FailureInvalidConfig) {
		t.Fatalf("NewManager() error = %v, want invalid_config", err)
	}
}

func TestNormalizeCodexEvents(t *testing.T) {
	started, err := normalizeEvent(
		`{"type":"thread.started","thread_id":"thread-1"}`,
	)
	if err != nil || started.sessionID != "thread-1" {
		t.Fatalf("thread.started = %+v, %v", started, err)
	}
	message, err := normalizeEvent(
		`{"type":"item.completed","item":{"id":"item-1","type":"agent_message","text":"hello"}}`,
	)
	if err != nil || message.delta == nil ||
		message.delta.Type != "text" || message.delta.Content != "hello" {
		t.Fatalf("agent message = %+v, %v", message, err)
	}
	activity, err := normalizeEvent(
		`{"type":"item.completed","item":{"id":"item-2","type":"command_execution","command":"secret"}}`,
	)
	if err != nil || activity.delta == nil ||
		activity.delta.Type != "external_activity" ||
		strings.Contains(activity.delta.Content, "secret") {
		t.Fatalf("activity = %+v, %v", activity, err)
	}
}

func newTestManager(t *testing.T, root, script string) *Manager {
	t.Helper()
	manager, err := NewManager(Config{
		RuntimeRoot: filepath.Join(root, "homes"),
		StartArgv:   []string{script, "start", "{session_id}", "{runtime_home}"},
		ResumeArgv:  []string{script, "resume", "{session_id}", "{runtime_home}"},
		ResetArgv:   []string{script, "reset", "{session_id}", "{runtime_home}"},
		Timeout:     10 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	return manager
}

func writeExecutable(t *testing.T, root, name, content string) string {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.WriteFile(path, []byte(content), 0o700); err != nil {
		t.Fatalf("write executable: %v", err)
	}
	return path
}
