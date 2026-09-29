//go:build !windows

package cli

import (
	"context"
	"errors"
	"os"
	"os/exec"
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

func TestExecutorNormalExitTerminatesRemainingProcessGroup(t *testing.T) {
	root := t.TempDir()
	childPIDPath := filepath.Join(root, "child.pid")
	commandPath := writeExecutable(t, root, "provider", `#!/bin/sh
sleep 30 </dev/null >/dev/null 2>&1 &
child_pid=$!
printf '%s\n' "$child_pid" > "$1"
printf '%s\n' '{"type":"done","content":"complete"}'
`)
	executor := NewExecutor(&WorkspaceManager{BaseDir: filepath.Join(root, "workspaces")})
	executor.TerminationGrace = 20 * time.Millisecond

	result, err := executor.Execute(context.Background(), &ExecuteRequest{
		ActorPTID:  "actor-1",
		CliCommand: commandPath + " " + childPIDPath,
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

	childPID := readProcessID(t, childPIDPath)
	t.Cleanup(func() {
		_ = syscall.Kill(childPID, syscall.SIGKILL)
	})
	waitForProcessExit(t, childPID, time.Second)
}

func TestSuperviseProcessStopsGraceWaitWhenProcessCompletes(t *testing.T) {
	command := exec.Command("sh", "-c", "trap '' TERM; sleep 30")
	configureProcessGroup(command)
	if err := command.Start(); err != nil {
		t.Fatalf("start process: %v", err)
	}
	t.Cleanup(func() {
		_ = killProcessGroup(command.Process)
		_ = command.Wait()
	})

	ctx, cancel := context.WithCancel(context.Background())
	processDone := make(chan struct{})
	supervisorDone := superviseProcess(
		ctx,
		command.Process,
		processDone,
		2*time.Second,
	)
	cancel()
	close(processDone)

	select {
	case <-supervisorDone:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("supervisor did not stop when process completed during grace wait")
	}
	if err := syscall.Kill(command.Process.Pid, 0); err != nil {
		t.Fatalf("process received a post-completion kill: %v", err)
	}
}

func readProcessID(t *testing.T, path string) int {
	t.Helper()
	rawPID, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read child pid: %v", err)
	}
	processID, err := strconv.Atoi(strings.TrimSpace(string(rawPID)))
	if err != nil {
		t.Fatalf("parse child pid: %v", err)
	}

	return processID
}

func waitForProcessExit(t *testing.T, processID int, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		err := syscall.Kill(processID, 0)
		if errors.Is(err, syscall.ESRCH) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("child process %d survived process-group teardown", processID)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
