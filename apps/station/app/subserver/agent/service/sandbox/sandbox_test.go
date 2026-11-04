package sandbox

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestResolvePlacement(t *testing.T) {
	ready := func(id string) ResolvedCapability {
		return ResolvedCapability{
			CapabilityID: id, BindingID: "bind-1", Revision: 3, Ready: true,
			SandboxRef: "wbox-1", WorkspaceRoot: "/workspace",
		}
	}

	t.Run("local only -> desktop device", func(t *testing.T) {
		p, err := ResolvePlacement([]ResolvedCapability{ready(CapabilityShellAllowlist)})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if p.Target != model.ExecutionTarget_EXECUTION_TARGET_DESKTOP_DEVICE {
			t.Fatalf("target = %v", p.Target)
		}
	})

	t.Run("sandbox ready -> workspace sandbox placement", func(t *testing.T) {
		p, err := ResolvePlacement([]ResolvedCapability{ready(SandboxExecuteCapability)})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if p.Target != model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX || p.SandboxRef != "wbox-1" ||
			p.BindingId != "bind-1" || p.BindingRevision != 3 || p.WorkspaceRoot != "/workspace" {
			t.Fatalf("bad placement: %+v", p)
		}
	})

	t.Run("mixed families -> forbidden", func(t *testing.T) {
		_, err := ResolvePlacement([]ResolvedCapability{
			ready(SandboxExecuteCapability), ready(CapabilityFilesystemWrite),
		})
		if bizErr(t, err).Code != errcode.AgentSandboxExecutionTargetForbidden {
			t.Fatalf("code = %v", bizErr(t, err).Code)
		}
	})

	t.Run("sandbox not ready -> not ready", func(t *testing.T) {
		c := ready(SandboxExecuteCapability)
		c.Ready = false
		_, err := ResolvePlacement([]ResolvedCapability{c})
		if bizErr(t, err).Code != errcode.AgentSandboxNotReady {
			t.Fatalf("code = %v", bizErr(t, err).Code)
		}
	})

	t.Run("sandbox ready but no ref -> not ready", func(t *testing.T) {
		c := ready(SandboxPtyCapability)
		c.SandboxRef = ""
		_, err := ResolvePlacement([]ResolvedCapability{c})
		if bizErr(t, err).Code != errcode.AgentSandboxNotReady {
			t.Fatalf("code = %v", bizErr(t, err).Code)
		}
	})

	t.Run("no executional caps -> unspecified", func(t *testing.T) {
		p, err := ResolvePlacement(nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if p.Target != model.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED {
			t.Fatalf("target = %v", p.Target)
		}
	})
}

func TestGuardFailClosed(t *testing.T) {
	placement := &model.ExecutionPlacement{
		Target:     model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX,
		SandboxRef: "wbox-1", BindingId: "bind-1",
	}

	t.Run("probe unavailable -> SANDBOX_UNAVAILABLE", func(t *testing.T) {
		g := NewGuard(func() (bool, string, string) { return false, "", "no-runtime" })
		err := g.Admit(placement)
		if bizErr(t, err).Code != errcode.AgentSandboxUnavailable {
			t.Fatalf("code = %v", bizErr(t, err).Code)
		}
	})

	t.Run("no probe configured -> unavailable (never desktop)", func(t *testing.T) {
		g := NewGuard(nil)
		if err := g.Admit(placement); bizErr(t, err).Code != errcode.AgentSandboxUnavailable {
			t.Fatalf("code = %v", bizErr(t, err).Code)
		}
	})

	t.Run("probe available -> admitted", func(t *testing.T) {
		g := NewGuard(func() (bool, string, string) { return true, "oci_linux", "" })
		if err := g.Admit(placement); err != nil {
			t.Fatalf("err: %v", err)
		}
	})

	t.Run("missing binding -> not ready", func(t *testing.T) {
		g := NewGuard(func() (bool, string, string) { return true, "oci_linux", "" })
		missingBinding := &model.ExecutionPlacement{
			Target:     model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX,
			SandboxRef: "wbox-1", // BindingId intentionally empty
		}
		if err := g.Admit(missingBinding); bizErr(t, err).Code != errcode.AgentSandboxNotReady {
			t.Fatalf("code = %v", bizErr(t, err).Code)
		}
	})

	t.Run("desktop placement passes untouched", func(t *testing.T) {
		g := NewGuard(nil)
		if err := g.Admit(&model.ExecutionPlacement{Target: model.ExecutionTarget_EXECUTION_TARGET_DESKTOP_DEVICE}); err != nil {
			t.Fatalf("err: %v", err)
		}
	})
}

func TestAllocatorIdempotentQuotaAndState(t *testing.T) {
	store := newFakeStore()
	clk := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	seq := 0
	idGen := func() string { seq++; return fmt.Sprintf("wbox-%d", seq) }
	alloc := NewAllocator(store, Quota{MaxActivePerActor: 2}, idGen, func() time.Time { return clk })

	in := AllocateInput{ActorPTID: "actor-1", AgentID: "agent-a", WorkspaceRoot: "/ws", ImageRef: "img@sha256:abc", BackendKind: "oci_linux"}

	first, err := alloc.Allocate(context.Background(), in)
	if err != nil {
		t.Fatalf("allocate: %v", err)
	}
	if first.State != StateRequested || first.Ref == "" {
		t.Fatalf("first = %+v", first)
	}
	second, err := alloc.Allocate(context.Background(), in)
	if err != nil {
		t.Fatalf("re-allocate: %v", err)
	}
	if second.Ref != first.Ref {
		t.Fatalf("idempotency broken: %s != %s", second.Ref, first.Ref)
	}

	// Second distinct workspace -> within quota.
	if _, err := alloc.Allocate(context.Background(), AllocateInput{ActorPTID: "actor-1", AgentID: "agent-a", WorkspaceRoot: "/ws2", ImageRef: "img@sha256:abc"}); err != nil {
		t.Fatalf("allocate ws2: %v", err)
	}
	// Third active workspace -> quota exceeded.
	if _, err := alloc.Allocate(context.Background(), AllocateInput{ActorPTID: "actor-1", AgentID: "agent-a", WorkspaceRoot: "/ws3", ImageRef: "img@sha256:abc"}); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("want ErrQuotaExceeded, got %v", err)
	}

	// REQUESTED -> ALLOCATED requires live proof (volume attached).
	got, err := alloc.MarkAllocated(context.Background(), first.Ref, "vol-1")
	if err != nil {
		t.Fatalf("mark allocated: %v", err)
	}
	if got.State != StateAllocated || got.VolumeRef != "vol-1" || got.Revision != 2 {
		t.Fatalf("allocated row = %+v rev=%d", got, got.Revision)
	}

	// While ALLOCATED, a lookup for the same workspace returns the same ref.
	again, err := alloc.Allocate(context.Background(), in)
	if err != nil || again.Ref != first.Ref {
		t.Fatalf("lookup: %v %v", err, again)
	}

	// Reconcile marks a claimed-live but actually dead ALLOCATED ref FAILED.
	if err := alloc.Reconcile(context.Background(), map[string]bool{first.Ref: false}); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	row, _ := store.Get(context.Background(), first.Ref)
	if row.State != StateFailed {
		t.Fatalf("state = %v, want failed", row.State)
	}

	// Release with volume deletion clears volume_ref.
	rel, err := alloc.Release(context.Background(), first.Ref, false)
	if err != nil {
		t.Fatalf("release: %v", err)
	}
	if rel.State != StateReleased || rel.VolumeRef != "" || rel.ReleasedAt == nil {
		t.Fatalf("release row = %+v", rel)
	}
	// After release the same workspace allocates a fresh ref.
	fresh, err := alloc.Allocate(context.Background(), in)
	if err != nil {
		t.Fatalf("post-release allocate: %v", err)
	}
	if fresh.Ref == first.Ref {
		t.Fatalf("expected a new ref after release")
	}
}

func TestAllocatorDormantAndIllegalTransitions(t *testing.T) {
	store := newFakeStore()
	seq := 0
	alloc := NewAllocator(store, Quota{MaxActivePerActor: 10},
		func() string { seq++; return "wbox" },
		func() time.Time { return time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC) })

	s, err := alloc.Allocate(context.Background(), AllocateInput{ActorPTID: "a", AgentID: "g", WorkspaceRoot: "/w", ImageRef: "img@d"})
	if err != nil {
		t.Fatalf("allocate: %v", err)
	}
	// REQUESTED cannot go DORMANT directly.
	if _, err := alloc.MarkDormant(context.Background(), s.Ref); err == nil {
		t.Fatalf("expected REQUESTED->DORMANT to be rejected")
	}
	if _, err := alloc.MarkAllocated(context.Background(), s.Ref, "vol"); err != nil {
		t.Fatalf("allocate mark: %v", err)
	}
	d, err := alloc.MarkDormant(context.Background(), s.Ref)
	if err != nil || d.State != StateDormant {
		t.Fatalf("dormant: %v %+v", err, d)
	}
	// DORMANT is not expected live: reconcile leaves it untouched.
	if err := alloc.Reconcile(context.Background(), map[string]bool{s.Ref: false}); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if got, _ := store.Get(context.Background(), s.Ref); got.State != StateDormant {
		t.Fatalf("dormant changed to %v", got.State)
	}
	// Releasing a dormant sandbox is allowed; FAILED cannot be re-allocated live.
	if _, err := alloc.Release(context.Background(), s.Ref, true); err != nil {
		t.Fatalf("release: %v", err)
	}
	if _, err := alloc.MarkAllocated(context.Background(), s.Ref, "vol"); err == nil {
		t.Fatalf("expected allocating a released sandbox to fail")
	}
}

func bizErr(t *testing.T, err error) *errcode.BizError {
	t.Helper()
	var be *errcode.BizError
	if errors.As(err, &be) {
		return be
	}
	t.Fatalf("not a BizError: %v", err)
	return nil
}

// ── fake store ──────────────────────────────────────────────────────────────

type fakeStore struct {
	mu   sync.Mutex
	rows map[string]*Sandbox
}

func newFakeStore() *fakeStore { return &fakeStore{rows: map[string]*Sandbox{}} }

func (f *fakeStore) FindActive(_ context.Context, actor, agent, root string) (*Sandbox, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, s := range f.rows {
		if s.ActorPTID == actor && s.AgentID == agent && s.WorkspaceRoot == root && s.State != StateReleased {
			cp := *s
			return &cp, nil
		}
	}
	return nil, nil
}

func (f *fakeStore) CountActive(_ context.Context, actor string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, s := range f.rows {
		if s.ActorPTID == actor && (s.State == StateRequested || s.State == StateAllocated || s.State == StateDormant) {
			n++
		}
	}
	return n, nil
}

func (f *fakeStore) ListActiveForActor(_ context.Context, actor string) ([]*Sandbox, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*Sandbox
	for _, s := range f.rows {
		if s.ActorPTID == actor && s.State != StateReleased && s.State != StateFailed {
			cp := *s
			out = append(out, &cp)
		}
	}
	return out, nil
}

func (f *fakeStore) Insert(_ context.Context, s *Sandbox) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.rows[s.Ref]; ok {
		return errors.New("duplicate ref")
	}
	cp := *s
	f.rows[s.Ref] = &cp
	return nil
}

func (f *fakeStore) Update(_ context.Context, ref string, mutate func(s *Sandbox) error) (*Sandbox, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.rows[ref]
	if !ok {
		return nil, errors.New("not found")
	}
	if err := mutate(s); err != nil {
		return nil, err
	}
	cp := *s
	return &cp, nil
}

func (f *fakeStore) Get(_ context.Context, ref string) (*Sandbox, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.rows[ref]
	if !ok {
		return nil, nil
	}
	cp := *s
	return &cp, nil
}

func (f *fakeStore) GetActiveForActor(_ context.Context, actor, ref string) (*Sandbox, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.rows[ref]
	if !ok || s.ActorPTID != actor {
		return nil, nil
	}
	switch s.State {
	case StateRequested, StateAllocated, StateDormant:
	default:
		return nil, nil
	}
	cp := *s
	return &cp, nil
}
