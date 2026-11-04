package sandbox

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// State mirrors model.SandboxState but is expressed as the service-layer
// vocabulary so the allocator does not depend on a GORM row shape.
type State string

const (
	StateRequested State = "requested"
	StateAllocated State = "allocated"
	StateDormant   State = "dormant"
	StateFailed    State = "failed"
	StateReleased  State = "released"
)

func (s State) toProto() model.SandboxState {
	switch s {
	case StateRequested:
		return model.SandboxState_SANDBOX_STATE_REQUESTED
	case StateAllocated:
		return model.SandboxState_SANDBOX_STATE_ALLOCATED
	case StateDormant:
		return model.SandboxState_SANDBOX_STATE_DORMANT
	case StateFailed:
		return model.SandboxState_SANDBOX_STATE_FAILED
	case StateReleased:
		return model.SandboxState_SANDBOX_STATE_RELEASED
	default:
		return model.SandboxState_SANDBOX_STATE_UNSPECIFIED
	}
}

// Sandbox is the service-layer allocation record.
type Sandbox struct {
	Ref           string
	ActorPTID     string
	AgentID       string
	WorkspaceRoot string
	ImageRef      string
	State         State
	BackendKind   string
	VolumeRef     string
	Revision      uint64
	CreatedAt     time.Time
	LastLiveAt    time.Time
	ReleasedAt    *time.Time
}

func (s Sandbox) Proto() *model.WorkspaceSandbox {
	pb := &model.WorkspaceSandbox{
		SandboxRef:    s.Ref,
		ActorPtid:     s.ActorPTID,
		AgentId:       s.AgentID,
		WorkspaceRoot: s.WorkspaceRoot,
		ImageRef:      s.ImageRef,
		State:         s.State.toProto(),
		BackendKind:   s.BackendKind,
		VolumeRef:     s.VolumeRef,
		Revision:      s.Revision,
	}
	if !s.CreatedAt.IsZero() {
		pb.CreatedAt = timestamppb.New(s.CreatedAt)
	}
	if !s.LastLiveAt.IsZero() {
		pb.LastLiveAt = timestamppb.New(s.LastLiveAt)
	}
	if s.ReleasedAt != nil {
		pb.ReleasedAt = timestamppb.New(*s.ReleasedAt)
	}
	return pb
}

// Quota limits live sandboxes per actor (REQUESTED+ALLOCATED+DORMANT count).
type Quota struct {
	MaxActivePerActor int
}

// ErrQuotaExceeded signals the caller should queue rather than start another
// sandbox (it is not a fail-closed sandbox error).
var ErrQuotaExceeded = errors.New("sandbox: per-actor active quota exceeded")

// AllocateInput requests an idempotent workspace sandbox allocation.
type AllocateInput struct {
	ActorPTID     string
	AgentID       string
	WorkspaceRoot string
	ImageRef      string
	BackendKind   string
}

// Store is the persistence boundary; GORM implementation lives in
// infrastructure/persistence. All methods must be safe for concurrent callers
// (the idempotency guarantee is enforced at the store key).
type Store interface {
	// FindActive returns the non-released sandbox for (actor, agent, root),
	// or (nil,nil) when none exists.
	FindActive(ctx context.Context, actor, agent, root string) (*Sandbox, error)
	// CountActive counts REQUESTED/ALLOCATED/DORMANT sandboxes for an actor.
	CountActive(ctx context.Context, actor string) (int, error)
	Insert(ctx context.Context, s *Sandbox) error
	Update(ctx context.Context, ref string, mutate func(s *Sandbox) error) (*Sandbox, error)
	Get(ctx context.Context, ref string) (*Sandbox, error)
}

// Allocator owns the allocation state machine and idempotency. It never starts
// a container; callers (S3/S4) reconcile REQUESTED rows with the provisioner.
type Allocator struct {
	store  Store
	quota  Quota
	now    func() time.Time
	newRef func() string
}

func NewAllocator(store Store, quota Quota, idGen func() string, now func() time.Time) *Allocator {
	if now == nil {
		now = time.Now
	}
	return &Allocator{store: store, quota: quota, now: now, newRef: idGen}
}

// Allocate is idempotent per (actor, agent, workspace_root): concurrent or
// retried requests return the single existing non-released sandbox. A fresh
// allocation starts in REQUESTED (never ALLOCATED without live provisioner
// proof).
func (a *Allocator) Allocate(ctx context.Context, in AllocateInput) (*Sandbox, error) {
	existing, err := a.store.FindActive(ctx, in.ActorPTID, in.AgentID, in.WorkspaceRoot)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	n, err := a.store.CountActive(ctx, in.ActorPTID)
	if err != nil {
		return nil, err
	}
	if a.quota.MaxActivePerActor > 0 && n >= a.quota.MaxActivePerActor {
		return nil, ErrQuotaExceeded
	}

	now := a.now().UTC()
	s := &Sandbox{
		Ref:           a.newRef(),
		ActorPTID:     in.ActorPTID,
		AgentID:       in.AgentID,
		WorkspaceRoot: in.WorkspaceRoot,
		ImageRef:      in.ImageRef,
		State:         StateRequested,
		BackendKind:   in.BackendKind,
		VolumeRef:     "",
		Revision:      1,
		CreatedAt:     now,
	}
	if err := a.store.Insert(ctx, s); err != nil {
		// A racing peer may have inserted the same key; re-read.
		if existing2, err2 := a.store.FindActive(ctx, in.ActorPTID, in.AgentID, in.WorkspaceRoot); err2 == nil && existing2 != nil {
			return existing2, nil
		}
		return nil, err
	}
	return s, nil
}

// MarkAllocated moves REQUESTED -> ALLOCATED only after live provisioner proof.
func (a *Allocator) MarkAllocated(ctx context.Context, ref, volumeRef string) (*Sandbox, error) {
	return a.store.Update(ctx, ref, func(s *Sandbox) error {
		if s.State == StateReleased {
			return errors.New("sandbox: cannot allocate a released sandbox")
		}
		if s.State != StateAllocated {
			s.Revision++
		}
		s.State = StateAllocated
		if volumeRef != "" {
			s.VolumeRef = volumeRef
		}
		s.LastLiveAt = a.now().UTC()
		return nil
	})
}

// MarkDormant parks a live sandbox (container stopped, volume retained).
func (a *Allocator) MarkDormant(ctx context.Context, ref string) (*Sandbox, error) {
	return a.store.Update(ctx, ref, func(s *Sandbox) error {
		if s.State != StateAllocated {
			return errors.New("sandbox: only ALLOCATED can become DORMANT")
		}
		s.Revision++
		s.State = StateDormant
		return nil
	})
}

// MarkFailed fail-closes a sandbox; execution must not fall back to desktop.
func (a *Allocator) MarkFailed(ctx context.Context, ref string) (*Sandbox, error) {
	return a.store.Update(ctx, ref, func(s *Sandbox) error {
		if s.State == StateReleased {
			return errors.New("sandbox: released sandbox cannot fail")
		}
		s.Revision++
		s.State = StateFailed
		return nil
	})
}

// Release terminates a sandbox; keepVolume=false records volume deletion (the
// provisioner performs the actual delete).
func (a *Allocator) Release(ctx context.Context, ref string, keepVolume bool) (*Sandbox, error) {
	return a.store.Update(ctx, ref, func(s *Sandbox) error {
		t := a.now().UTC()
		s.Revision++
		s.State = StateReleased
		s.ReleasedAt = &t
		if !keepVolume {
			s.VolumeRef = ""
		}
		return nil
	})
}

// Reconcile applies live provisioner proofs: refs not proven live are moved to
// FAILED only if they were REQUESTED/ALLOCATED (DORMANT/RELEASED are left).
func (a *Allocator) Reconcile(ctx context.Context, liveProofs map[string]bool) error {
	// The store exposes only ref-scoped Update; callers iterate the actor's
	// sandboxes through the repository. Reconcile is driven per-ref here.
	for ref, live := range liveProofs {
		if live {
			continue
		}
		if _, err := a.store.Update(ctx, ref, func(s *Sandbox) error {
			if s.State == StateRequested || s.State == StateAllocated {
				s.Revision++
				s.State = StateFailed
			}
			return nil
		}); err != nil {
			return err
		}
	}
	return nil
}
