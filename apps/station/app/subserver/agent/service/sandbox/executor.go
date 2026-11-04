package sandbox

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

// Executor runs one-shot commands inside an allocated workspace sandbox. It
// never executes locally and never falls back to the desktop: provisioner
// unavailability is a hard error surfaced to the caller/user.
type Executor struct {
	alloc        *Allocator
	client       Client
	probe        func(ctx context.Context) (bool, string, string, error)
	defaultImage string
	now          func() time.Time
}

// ExecutorConfig wires the seam. DefaultImage must be an allowlisted,
// digest-pinned image (the provisioner enforces this; Station only names it).
type ExecutorConfig struct {
	Allocator    *Allocator
	Client       Client
	DefaultImage string
}

func NewExecutor(cfg ExecutorConfig) *Executor {
	return &Executor{
		alloc:        cfg.Allocator,
		client:       cfg.Client,
		probe:        cfg.Client.Probe,
		defaultImage: cfg.DefaultImage,
		now:          time.Now,
	}
}

// EnsureSandbox lazily allocates (idempotent) the workspace sandbox and brings
// the container live. REQUESTED/DORMANT -> backend Allocate -> ALLOCATED.
// FAILED is terminal here (no silent retry-to-desktop); the caller must release
// or have the binding re-readied out of band.
func (e *Executor) EnsureSandbox(ctx context.Context, actorPTID, agentID, workspaceRoot string) (*Sandbox, error) {
	row, err := e.alloc.Allocate(ctx, AllocateInput{
		ActorPTID:     actorPTID,
		AgentID:       agentID,
		WorkspaceRoot: workspaceRoot,
		ImageRef:      e.defaultImage,
		BackendKind:   "oci_linux",
	})
	if err != nil {
		return nil, err
	}
	if row.State == StateAllocated {
		return row, nil
	}
	if row.State == StateFailed {
		return nil, newUnavailable("sandbox is FAILED; requires out-of-band readiness reset")
	}
	// REQUESTED or DORMANT: bring the container up (idempotent on backend).
	volume, err := e.client.EnsureAllocated(ctx, row.Ref, row.ImageRef, row.VolumeRef)
	if err != nil {
		if _, fm := e.alloc.MarkFailed(ctx, row.Ref); fm != nil {
			return nil, fm
		}
		return nil, newUnavailable("provisioner allocate failed: " + err.Error())
	}
	return e.alloc.MarkAllocated(ctx, row.Ref, volume)
}

// EnsureByRef cold-starts (or re-attaches) an already-allocated sandbox
// addressed by its ref. The PTY proxy uses it when the client names an
// explicitly allocated sandbox rather than a (actor, agent, workspace) key.
func (e *Executor) EnsureByRef(ctx context.Context, ref string) (*Sandbox, error) {
	available, _, reason, err := e.probe(ctx)
	if err != nil || !available {
		if err == nil {
			err = errors.New(reason)
		}
		return nil, newUnavailable("provisioner probe failed: " + err.Error())
	}
	row, err := e.alloc.store.Get(ctx, ref)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, newNotReady("unknown sandbox_ref " + ref)
	}
	if row.State == StateFailed {
		return nil, newUnavailable("sandbox is FAILED; requires out-of-band readiness reset")
	}
	volume, err := e.client.EnsureAllocated(ctx, row.Ref, row.ImageRef, row.VolumeRef)
	if err != nil {
		if _, fm := e.alloc.MarkFailed(ctx, row.Ref); fm != nil {
			return nil, fm
		}
		return nil, newUnavailable("provisioner allocate failed: " + err.Error())
	}
	return e.alloc.MarkAllocated(ctx, row.Ref, volume)
}

// Run executes one command in the sandbox named by the already-authorized
// placement. A command that exits non-zero or is refused by the OS is a normal
// ExecOutcome; only infrastructure failures become errors.
func (e *Executor) Run(ctx context.Context, placement *model.ExecutionPlacement, call ExecCall) (*ExecOutcome, error) {
	if placement.Target != model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX {
		return nil, newTargetForbidden("sandbox executor received a non-sandbox placement")
	}
	if placement.SandboxRef == "" {
		return nil, newNotReady("placement has no sandbox_ref")
	}
	available, _, reason, err := e.probe(ctx)
	if err != nil || !available {
		if err == nil {
			err = errors.New(reason)
		}
		return nil, newUnavailable("provisioner probe failed: " + err.Error())
	}
	call.SandboxRef = placement.SandboxRef
	if call.Cwd == "" {
		call.Cwd = placement.WorkspaceRoot
	}
	return e.client.Exec(ctx, call)
}

// EnsureAndRun is the one-call convenience used by dispatch: make the
// workspace live, verify the authorized placement matches that sandbox, then
// execute.
func (e *Executor) EnsureAndRun(ctx context.Context, actorPTID, agentID, workspaceRoot string, placement *model.ExecutionPlacement, call ExecCall) (*ExecOutcome, error) {
	row, err := e.EnsureSandbox(ctx, actorPTID, agentID, workspaceRoot)
	if err != nil {
		return nil, err
	}
	if placement.Target != model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX ||
		placement.SandboxRef != row.Ref {
		return nil, newTargetForbidden("placement sandbox_ref does not match allocated workspace")
	}
	return e.Run(ctx, placement, call)
}

// Park stops the sandbox container for one workspace while retaining its
// volume (DORMANT). The next command cold-starts it with all data intact. It
// never falls back: a provisioner that cannot stop the container is an error.
func (e *Executor) Park(ctx context.Context, actorPTID, agentID, workspaceRoot string) (*Sandbox, error) {
	available, _, reason, err := e.probe(ctx)
	if err != nil || !available {
		if err == nil {
			err = errors.New(reason)
		}
		return nil, newUnavailable("provisioner probe failed: " + err.Error())
	}
	row, err := e.alloc.Active(ctx, actorPTID, agentID, workspaceRoot)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, newNotReady("no active sandbox to park")
	}
	if row.State != StateAllocated {
		// Already dormant/requested/failed: nothing live to stop.
		return row, nil
	}
	if err := e.client.Dormant(ctx, row.Ref); err != nil {
		return nil, newUnavailable("provisioner dormant failed: " + err.Error())
	}
	return e.alloc.MarkDormant(ctx, row.Ref)
}

// ReconcileForActor aligns the actor's allocation table with backend truth:
//   - container gone        -> FAILED (REQUESTED/ALLOCATED/DORMANT)
//   - exists but stopped    -> DORMANT (ALLOCATED only)
//   - exists and running    -> ALLOCATED (REQUESTED/DORMANT cold-proven)
//
// A provisioner that cannot be reached returns an error and changes nothing,
// so a transient outage cannot be misrecorded as FAILED.
func (e *Executor) ReconcileForActor(ctx context.Context, actorPTID string) ([]*Sandbox, error) {
	rows, err := e.alloc.store.ListActiveForActor(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	refs := make([]string, 0, len(rows))
	for _, row := range rows {
		refs = append(refs, row.Ref)
	}
	available, _, reason, err := e.probe(ctx)
	if err != nil || !available {
		if err == nil {
			err = errors.New(reason)
		}
		return nil, newUnavailable("provisioner probe failed during reconcile: " + err.Error())
	}
	proofs, err := e.client.Reconcile(ctx, refs)
	if err != nil {
		return nil, newUnavailable("provisioner reconcile failed: " + err.Error())
	}
	proofByRef := make(map[string]LiveProof, len(proofs))
	for _, proof := range proofs {
		proofByRef[proof.SandboxRef] = proof
	}
	reconciled := make([]*Sandbox, 0, len(rows))
	for _, row := range rows {
		proof, known := proofByRef[row.Ref]
		switch {
		case !known || !proof.Exists:
			if _, err := e.alloc.MarkFailed(ctx, row.Ref); err != nil {
				return nil, err
			}
		case proof.Running && row.State != StateAllocated:
			updated, err := e.alloc.MarkAllocated(ctx, row.Ref, row.VolumeRef)
			if err != nil {
				return nil, err
			}
			row = updated
		case !proof.Running && row.State == StateAllocated:
			updated, err := e.alloc.MarkDormant(ctx, row.Ref)
			if err != nil {
				return nil, err
			}
			row = updated
		}
		reconciled = append(reconciled, row)
	}
	return reconciled, nil
}
