package sandbox

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

type fakeClient struct {
	probeOK    bool
	probeErr   error
	allocErr   error
	execErr    error
	outcome    *ExecOutcome
	allocCalls int
	execCalls  int
	gotVol     string
}

func (f *fakeClient) Probe(context.Context) (bool, string, string, error) {
	return f.probeOK, "oci_linux", "down", f.probeErr
}
func (f *fakeClient) EnsureAllocated(_ context.Context, _, _, vol string) (string, error) {
	f.allocCalls++
	if f.allocErr != nil {
		return "", f.allocErr
	}
	if vol != "" {
		f.gotVol = vol
		return vol, nil
	}
	return "vol-derived", nil
}
func (f *fakeClient) Exec(_ context.Context, in ExecCall) (*ExecOutcome, error) {
	f.execCalls++
	return f.outcome, f.execErr
}
func (f *fakeClient) Release(context.Context, string, string, bool) error { return nil }

func newTestExecutor(c Client) (*Executor, Store) {
	store := newFakeStore()
	seq := 0
	alloc := NewAllocator(store, Quota{MaxActivePerActor: 5},
		func() string { seq++; return "wbox" },
		func() time.Time { return time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC) })
	return NewExecutor(ExecutorConfig{Allocator: alloc, Client: c, DefaultImage: "r/u@sha256:" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}), store
}

func placementFor(ref string) model.ExecutionPlacement {
	return model.ExecutionPlacement{
		Target:     model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX,
		SandboxRef: ref, WorkspaceRoot: "/workspace",
		BindingId: "bind", BindingRevision: 1, CapabilityId: SandboxExecuteCapability,
	}
}

func TestExecutorColdStartThenRun(t *testing.T) {
	fc := &fakeClient{probeOK: true, outcome: &ExecOutcome{ExitCode: 0, Stdout: []byte("ok")}}
	ex, _ := newTestExecutor(fc)

	row, err := ex.EnsureSandbox(context.Background(), "actor", "agent", "/ws")
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if row.State != StateAllocated || fc.allocCalls != 1 {
		t.Fatalf("row=%+v allocCalls=%d", row, fc.allocCalls)
	}
	// Second ensure re-attaches without another backend allocate.
	if _, err := ex.EnsureSandbox(context.Background(), "actor", "agent", "/ws"); err != nil {
		t.Fatalf("re-ensure: %v", err)
	}
	if fc.allocCalls != 1 {
		t.Fatalf("expected idempotent allocate, calls=%d", fc.allocCalls)
	}

	out, err := ex.Run(context.Background(), placementFor(row.Ref), ExecCall{Command: "true"})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if out.ExitCode != 0 || string(out.Stdout) != "ok" {
		t.Fatalf("outcome=%+v", out)
	}
}

func TestExecutorProbeDownFailsClosed(t *testing.T) {
	fc := &fakeClient{probeOK: false}
	ex, _ := newTestExecutor(fc)
	_, err := ex.Run(context.Background(), placementFor("any"), ExecCall{Command: "ls"})
	if bizErr(t, err).Code != errcode.AgentSandboxUnavailable {
		t.Fatalf("code=%v", bizErr(t, err).Code)
	}
	if fc.execCalls != 0 {
		t.Fatalf("must not exec when probe down")
	}
}

func TestExecutorAllocateFailureMarksFailedAndCloses(t *testing.T) {
	fc := &fakeClient{probeOK: true, allocErr: errors.New("daemon rejected")}
	ex, store := newTestExecutor(fc)
	_, err := ex.EnsureSandbox(context.Background(), "a", "g", "/ws")
	if bizErr(t, err).Code != errcode.AgentSandboxUnavailable {
		t.Fatalf("code=%v", bizErr(t, err).Code)
	}
	// Row must be FAILED, never silently executed locally.
	rows, _ := store.FindActive(context.Background(), "a", "g", "/ws")
	if rows == nil || rows.State != StateFailed {
		t.Fatalf("row=%v", rows)
	}
	if fc.execCalls != 0 {
		t.Fatalf("no exec on allocation failure")
	}
}

func TestExecutorPermissionDeniedIsOutcomeNotError(t *testing.T) {
	// The OS refusal is an exit-1/EACCES result the agent/user can see and act
	// on (e.g. request owner grant), not a swallowed error or a fake success.
	fc := &fakeClient{probeOK: true, outcome: &ExecOutcome{ExitCode: 1, OSErrno: "EACCES", Stderr: []byte("mkdir /: Permission denied")}}
	ex, _ := newTestExecutor(fc)
	row, err := ex.EnsureSandbox(context.Background(), "a", "g", "/ws")
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	out, err := ex.Run(context.Background(), placementFor(row.Ref), ExecCall{Command: "mkdir", Args: []string{"/x"}})
	if err != nil {
		t.Fatalf("OS refusal must be an outcome, got error: %v", err)
	}
	if out.ExitCode != 1 || out.OSErrno != "EACCES" {
		t.Fatalf("outcome=%+v", out)
	}
}

func TestExecutorRefMismatchRejected(t *testing.T) {
	fc := &fakeClient{probeOK: true, outcome: &ExecOutcome{ExitCode: 0}}
	ex, _ := newTestExecutor(fc)
	row, err := ex.EnsureSandbox(context.Background(), "a", "g", "/ws")
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	bad := placementFor(row.Ref + "-other")
	if _, err := ex.EnsureAndRun(context.Background(), "a", "g", "/ws", bad, ExecCall{Command: "id"}); bizErr(t, err).Code != errcode.AgentSandboxExecutionTargetForbidden {
		t.Fatalf("code=%v", bizErr(t, err).Code)
	}
}
