package sandbox

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

// GormStore adapts the agent GORM database to the sandbox.Store boundary.
type GormStore struct {
	db *gorm.DB
}

func NewGormStore(db *gorm.DB) *GormStore { return &GormStore{db: db} }

var activeStates = []string{string(StateRequested), string(StateAllocated), string(StateDormant)}

func (s *GormStore) FindActive(ctx context.Context, actor, agent, root string) (*Sandbox, error) {
	var row persistence.AgentWorkspaceSandbox
	err := s.db.WithContext(ctx).
		Where("actor_ptid = ? AND agent_id = ? AND workspace_root = ? AND state <> ?",
			actor, agent, root, string(StateReleased)).
		Order("created_at DESC").
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return rowToSandbox(row), nil
}

func (s *GormStore) CountActive(ctx context.Context, actor string) (int, error) {
	var n int64
	err := s.db.WithContext(ctx).
		Model(&persistence.AgentWorkspaceSandbox{}).
		Where("actor_ptid = ? AND state IN ?", actor, activeStates).
		Count(&n).Error
	return int(n), err
}

func (s *GormStore) Insert(ctx context.Context, snd *Sandbox) error {
	return s.db.WithContext(ctx).Create(sandboxToRow(snd)).Error
}

func (s *GormStore) Get(ctx context.Context, ref string) (*Sandbox, error) {
	var row persistence.AgentWorkspaceSandbox
	if err := s.db.WithContext(ctx).Where("sandbox_ref = ?", ref).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return rowToSandbox(row), nil
}

// Update applies a guarded in-place mutation inside a transaction so state
// transitions are atomic and revision bumps are not lost under concurrency.
func (s *GormStore) Update(ctx context.Context, ref string, mutate func(s *Sandbox) error) (*Sandbox, error) {
	var out *Sandbox
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row persistence.AgentWorkspaceSandbox
		if err := tx.Where("sandbox_ref = ?", ref).First(&row).Error; err != nil {
			return err
		}
		current := rowToSandbox(row)
		if err := mutate(current); err != nil {
			return err
		}
		updated := sandboxToRow(current)
		if err := tx.Save(updated).Error; err != nil {
			return err
		}
		out = current
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func rowToSandbox(r persistence.AgentWorkspaceSandbox) *Sandbox {
	return &Sandbox{
		Ref:           r.SandboxRef,
		ActorPTID:     r.ActorPtid,
		AgentID:       r.AgentID,
		WorkspaceRoot: r.WorkspaceRoot,
		ImageRef:      r.ImageRef,
		State:         State(r.State),
		BackendKind:   r.BackendKind,
		VolumeRef:     r.VolumeRef,
		Revision:      r.Revision,
		CreatedAt:     r.CreatedAt,
		LastLiveAt:    r.LastLiveAt,
		ReleasedAt:    r.ReleasedAt,
	}
}

func sandboxToRow(s *Sandbox) *persistence.AgentWorkspaceSandbox {
	lastLive := s.LastLiveAt
	if lastLive.IsZero() {
		lastLive = time.Now().UTC()
	}
	return &persistence.AgentWorkspaceSandbox{
		SandboxRef:    s.Ref,
		ActorPtid:     s.ActorPTID,
		AgentID:       s.AgentID,
		WorkspaceRoot: s.WorkspaceRoot,
		ImageRef:      s.ImageRef,
		State:         string(s.State),
		BackendKind:   s.BackendKind,
		VolumeRef:     s.VolumeRef,
		Revision:      s.Revision,
		CreatedAt:     s.CreatedAt,
		LastLiveAt:    lastLive,
		ReleasedAt:    s.ReleasedAt,
	}
}
