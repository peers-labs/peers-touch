package sandbox

import (
	"context"
	"errors"
	"strings"
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
	reconcile  func(refs []string) []LiveProof
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
func (f *fakeClient) Dormant(_ context.Context, _ string) error { return f.allocErr }
func (f *fakeClient) Reconcile(_ context.Context, refs []string) ([]LiveProof, error) {
	if f.reconcile != nil {
		return f.reconcile(refs), nil
	}
	proofs := make([]LiveProof, 0, len(refs))
	for _, ref := range refs {
		proofs = append(proofs, LiveProof{SandboxRef: ref, Exists: true, Running: true})
	}
	return proofs, nil
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

func placementFor(ref string) *model.ExecutionPlacement {
	return &model.ExecutionPlacement{
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

func TestExecutorReconcileMarksGoneFailed(t *testing.T) {
	fc := &fakeClient{
		probeOK: true, outcome: &ExecOutcome{ExitCode: 0},
		reconcile: func([]string) []LiveProof { return nil }, // absent -> gone
	}
	ex, store := newTestExecutor(fc)
	if _, err := ex.EnsureSandbox(context.Background(), "a", "g", "/ws"); err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if _, err := ex.ReconcileForActor(context.Background(), "a"); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	rows, _ := store.FindActive(context.Background(), "a", "g", "/ws")
	if rows == nil || rows.State != StateFailed {
		t.Fatalf("row=%v, want FAILED after backend reports gone", rows)
	}
}

func TestExecutorReconcileMarksStoppedDormant(t *testing.T) {
	fc := &fakeClient{
		probeOK: true, outcome: &ExecOutcome{ExitCode: 0},
		reconcile: func(refs []string) []LiveProof {
			return []LiveProof{{SandboxRef: refs[0], Exists: true, Running: false}}
		},
	}
	ex, store := newTestExecutor(fc)
	row, err := ex.EnsureSandbox(context.Background(), "a", "g", "/ws")
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	out, err := ex.ReconcileForActor(context.Background(), "a")
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(out) != 1 || out[0].State != StateDormant {
		t.Fatalf("reconciled=%+v", out)
	}
	stored, _ := store.Get(context.Background(), row.Ref)
	if stored.State != StateDormant {
		t.Fatalf("stored=%v", stored.State)
	}
}

func TestExecutorParkKeepsVolume(t *testing.T) {
	fc := &fakeClient{probeOK: true, outcome: &ExecOutcome{ExitCode: 0}}
	ex, store := newTestExecutor(fc)
	row, err := ex.EnsureSandbox(context.Background(), "a", "g", "/ws")
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	parked, err := ex.Park(context.Background(), "a", "g", "/ws")
	if err != nil {
		t.Fatalf("park: %v", err)
	}
	if parked.State != StateDormant {
		t.Fatalf("parked=%v", parked.State)
	}
	stored, _ := store.Get(context.Background(), row.Ref)
	if stored.State != StateDormant || stored.VolumeRef == "" {
		t.Fatalf("stored=%+v must be dormant with volume retained", stored)
	}
}

func seedSandbox(t *testing.T, store Store, ref, actor string, state State) {
	t.Helper()
	if err := store.Insert(context.Background(), &Sandbox{
		Ref: ref, ActorPTID: actor, AgentID: "g", WorkspaceRoot: "/workspace",
		ImageRef: "r/u@sha256:" + strings.Repeat("a", 64), State: state,
		VolumeRef: "wbox-vol-" + ref, BackendKind: "oci_linux",
	}); err != nil {
		t.Fatalf("seed %s: %v", ref, err)
	}
}

// The PTY open path must authorize (actor, ref) against an ACTIVE owned
// allocation: foreign owners, unknown refs, and RELEASED sandboxes are refused
// before any provisioner call. Only the actor's own active sandbox is opened.
func TestEnsureByRefForActorAuthorization(t *testing.T) {
	fc := &fakeClient{probeOK: true}
	ex, store := newTestExecutor(fc)
	seedSandbox(t, store, "wbox-own", "actor-1", StateAllocated)
	seedSandbox(t, store, "wbox-other", "actor-2", StateAllocated)
	seedSandbox(t, store, "wbox-dead", "actor-1", StateReleased)

	forbidden := func(ref, actor, label string) {
		t.Helper()
		fc.allocCalls = 0
		_, err := ex.EnsureByRefForActor(context.Background(), actor, ref)
		var biz *errcode.BizError
		if !errors.As(err, &biz) || biz.Code != errcode.AgentSandboxExecutionTargetForbidden {
			t.Fatalf("%s: want target-forbidden, got %v", label, err)
		}
		if fc.allocCalls != 0 {
			t.Fatalf("%s: forbidden ref must not contact provisioner (calls=%d)", label, fc.allocCalls)
		}
	}
	forbidden("wbox-other", "actor-1", "foreign owner")
	forbidden("wbox-dead", "actor-1", "released sandbox")
	forbidden("wbox-missing", "actor-1", "unknown ref")

	// The actor's own active sandbox cold-starts via the provisioner.
	got, err := ex.EnsureByRefForActor(context.Background(), "actor-1", "wbox-own")
	if err != nil {
		t.Fatalf("owned active sandbox must open: %v", err)
	}
	if got.Ref != "wbox-own" || fc.allocCalls == 0 {
		t.Fatalf("owned open ref=%s allocCalls=%d", got.Ref, fc.allocCalls)
	}
}
