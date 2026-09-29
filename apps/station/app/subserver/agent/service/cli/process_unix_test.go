//go:build !windows

package cli

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

func TestExecutorCancellationTerminatesProcessGroup(t *testing.T) {
	root := t.TempDir()
	childPIDPath := filepath.Join(root, "child.pid")
	commandPath := writeExecutable(t, root, "provider", `#!/bin/sh
trap '' TERM
sleep 30 &
child_pid=$!
printf '%s\n' "$child_pid" > "$1"
wait "$child_pid"
`)
	executor := NewExecutor(&WorkspaceManager{BaseDir: filepath.Join(root, "workspaces")})
	executor.Timeout = 5 * time.Second
	executor.TerminationGrace = 20 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := executor.Execute(ctx, &ExecuteRequest{
			ActorPTID:  "actor-1",
			CliCommand: commandPath + " " + childPIDPath,
			Messages: []domain.Message{
				{Role: domain.MessageRoleUser, Content: "hello"},
			},
		}, nil)
		result <- err
	}()

	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Stat(childPIDPath); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("child process did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Execute() error = %v, want cancellation", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Execute() did not return after cancellation")
	}

	rawPID, err := os.ReadFile(childPIDPath)
	if err != nil {
		t.Fatalf("read child pid: %v", err)
	}
	childPID, err := strconv.Atoi(strings.TrimSpace(string(rawPID)))
	if err != nil {
		t.Fatalf("parse child pid: %v", err)
	}
	deadline = time.Now().Add(time.Second)
	for {
		err = syscall.Kill(childPID, 0)
		if errors.Is(err, syscall.ESRCH) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("child process %d survived timeout", childPID)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
