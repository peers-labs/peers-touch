package service

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestRevisionExecutionUsesReconciledRuntimeContextWindow(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "revision_runtime_execution_policy")
	seedRuntimeAuthorityRows(t, db, "turn-1", "attempt-1")
	service := &TurnService{}

	initialAdmission := runtimeAuthorityAdmission("provider-1", "model-1", 1)
	initialConfig := runtimeAuthorityConfig("turn-1", "attempt-1")
	if err := service.persistRuntimeAuthority(
		context.Background(),
		initialConfig,
		initialAdmission,
		runtimeAuthorityReadiness(initialConfig, initialAdmission),
		11,
	); err != nil {
		t.Fatalf("persist initial runtime authority: %v", err)
	}

	seedRuntimeAuthorityAttempt(t, db, "turn-2", "attempt-2")
	revisionAdmission := runtimeAuthorityAdmission("provider-1", "model-1", 2)
	revisionConfig := runtimeAuthorityConfig("turn-2", "attempt-2")
	revisionConfig.ContextWindowSize = 0
	if err := service.persistRuntimeAuthority(
		context.Background(),
		revisionConfig,
		revisionAdmission,
		runtimeAuthorityReadiness(revisionConfig, revisionAdmission),
		11,
	); err != nil {
		t.Fatalf("persist reconciled revision runtime authority: %v", err)
	}

	for _, staleWindow := range []int{0, 4096} {
		revisionConfig.ContextWindowSize = staleWindow
		if err := service.applyPinnedRuntimeExecutionPolicy(
			context.Background(),
			db,
			revisionConfig,
		); err != nil {
			t.Fatalf("apply pinned execution policy for stale window %d: %v", staleWindow, err)
		}
		if revisionConfig.ContextWindowSize != 128000 {
			t.Fatalf(
				"revision context window = %d after stale value %d, want reconciled 128000",
				revisionConfig.ContextWindowSize,
				staleWindow,
			)
		}
		if NewCompressionService().ShouldCompress(190, revisionConfig.ContextWindowSize) {
			t.Fatalf(
				"revision execution forced compression for 190 tokens with reconciled window %d",
				revisionConfig.ContextWindowSize,
			)
		}
	}
}

func TestPinnedRuntimeExecutionPolicyRejectsInvalidContextWindow(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "invalid_runtime_execution_policy")
	seedRuntimeAuthorityRows(t, db, "turn-invalid", "attempt-invalid")
	encoded, err := persistence.MarshalRuntimeSnapshot(&model.RuntimeSnapshot{
		Capabilities: &model.RuntimeCapabilitySnapshot{
			Limits: &model.RuntimeCapabilityLimits{},
		},
	})
	if err != nil {
		t.Fatalf("encode invalid runtime snapshot: %v", err)
	}
	if err := db.Model(&persistence.TurnAttempt{}).
		Where("id = ?", "attempt-invalid").
		Update("runtime_snapshot", encoded).Error; err != nil {
		t.Fatalf("persist invalid runtime snapshot: %v", err)
	}

	config := runtimeAuthorityConfig("turn-invalid", "attempt-invalid")
	err = (&TurnService{}).applyPinnedRuntimeExecutionPolicy(
		context.Background(),
		db,
		config,
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentInvalidSourceState {
		t.Fatalf("expected invalid source state for zero context limit, got %T: %v", err, err)
	}
	if config.ContextWindowSize != 0 {
		t.Fatalf("invalid snapshot changed context window to %d", config.ContextWindowSize)
	}

	snapshot := &model.RuntimeSnapshot{
		Capabilities: &model.RuntimeCapabilitySnapshot{
			Limits: &model.RuntimeCapabilityLimits{
				ContextTokens: uint64(math.MaxInt32) + 1,
			},
		},
	}
	encoded, err = persistence.MarshalRuntimeSnapshot(snapshot)
	if err != nil {
		t.Fatalf("encode overflowing runtime snapshot: %v", err)
	}
	if err := db.Model(&persistence.TurnAttempt{}).
		Where("id = ?", "attempt-invalid").
		Update("runtime_snapshot", encoded).Error; err != nil {
		t.Fatalf("persist overflowing runtime snapshot: %v", err)
	}
	err = (&TurnService{}).applyPinnedRuntimeExecutionPolicy(
		context.Background(),
		db,
		config,
	)
	if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentInvalidSourceState {
		t.Fatalf("expected invalid source state for overflowing context limit, got %T: %v", err, err)
	}
}
