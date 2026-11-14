package service

import (
	"context"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// newMemoryLifecycleService opens an isolated sqlite store with only the
// agent_memories table migrated and binds the package test store to it.
func newMemoryLifecycleService(t *testing.T) (*MemoryService, *gorm.DB) {
	t.Helper()
	dsn := "file:" + t.Name() + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&persistence.Memory{}); err != nil {
		t.Fatalf("automigrate memory: %v", err)
	}
	injectOrchestrationServiceTestStore(t, db)
	return NewMemoryService(nil), db
}

func searchMemoryContent(t *testing.T, svc *MemoryService, agentID, query string) []domain.ScoredMemory {
	t.Helper()
	results, err := svc.Search(context.Background(), domain.MemorySearchOptions{
		AgentID: agentID,
		Query:   query,
		Limit:   10,
	})
	if err != nil {
		t.Fatalf("search memories: %v", err)
	}
	return results
}

// Extracted candidates must never reach a Turn until a human confirms them.
func TestMemoryCandidateGatedUntilConfirmed(t *testing.T) {
	ctx := context.Background()
	svc, _ := newMemoryLifecycleService(t)
	const agentID = "agent-gate"

	candidate, err := svc.AddMemory(ctx, domain.MemoryItem{
		AgentID: agentID,
		Target:  domain.MemoryTargetUser,
		Layer:   domain.MemoryLayerPreference,
		Content: "alphaturn preference candidate marker",
		Status:  domain.MemoryStatusCandidate,
	})
	if err != nil {
		t.Fatalf("add candidate: %v", err)
	}

	// Candidate is visible to the review list but invisible to consumption.
	pending, _, err := svc.ListWithOptions(ctx, domain.MemoryListOptions{
		AgentID: agentID,
		Status:  domain.MemoryStatusCandidate,
	})
	if err != nil || len(pending) != 1 {
		t.Fatalf("candidate review list = %d items, err=%v", len(pending), err)
	}
	if got := searchMemoryContent(t, svc, agentID, "alphaturn"); len(got) != 0 {
		t.Fatalf("candidate must not be retrievable before confirmation, got %d", len(got))
	}
	snapshot, err := svc.BuildRelevantSnapshot(ctx, agentID, "alphaturn marker")
	if err != nil {
		t.Fatalf("build snapshot: %v", err)
	}
	if snapshot.Degraded || len(snapshot.RelevantItems) != 0 {
		t.Fatalf("fresh candidate should yield an empty (non-degraded) snapshot, got degraded=%v items=%d",
			snapshot.Degraded, len(snapshot.RelevantItems))
	}

	// Confirm → it now influences future Turns.
	if _, err := svc.ReviewMemory(ctx, agentID, candidate.MemoryID, domain.MemoryStatusConfirmed); err != nil {
		t.Fatalf("confirm candidate: %v", err)
	}
	if got := searchMemoryContent(t, svc, agentID, "alphaturn"); len(got) != 1 {
		t.Fatalf("confirmed memory must be retrievable, got %d", len(got))
	}
}

// Reject and delete both stop future consumption; rejected rows are retained.
func TestMemoryRejectAndDeleteStopConsumption(t *testing.T) {
	ctx := context.Background()
	svc, db := newMemoryLifecycleService(t)
	const agentID = "agent-revoke"

	rejectable, err := svc.AddMemory(ctx, domain.MemoryItem{
		AgentID: agentID,
		Target:  domain.MemoryTargetUser,
		Layer:   domain.MemoryLayerPreference,
		Content: "betaturn rejectable marker",
		Status:  domain.MemoryStatusCandidate,
	})
	if err != nil {
		t.Fatalf("add rejectable: %v", err)
	}
	deletable, err := svc.AddMemory(ctx, domain.MemoryItem{
		AgentID: agentID,
		Target:  domain.MemoryTargetUser,
		Layer:   domain.MemoryLayerContext,
		Content: "gammaturn deletable marker",
	})
	if err != nil {
		t.Fatalf("add deletable: %v", err)
	}
	if _, err := svc.ReviewMemory(ctx, agentID, deletable.MemoryID, domain.MemoryStatusConfirmed); err != nil {
		t.Fatalf("confirm deletable: %v", err)
	}

	if _, err := svc.ReviewMemory(ctx, agentID, rejectable.MemoryID, domain.MemoryStatusRejected); err != nil {
		t.Fatalf("reject candidate: %v", err)
	}
	if err := svc.DeleteMemoryByID(ctx, agentID, deletable.MemoryID); err != nil {
		t.Fatalf("delete confirmed memory: %v", err)
	}

	if got := searchMemoryContent(t, svc, agentID, "betaturn"); len(got) != 0 {
		t.Fatalf("rejected memory must not be consumed, got %d", len(got))
	}
	if got := searchMemoryContent(t, svc, agentID, "gammaturn"); len(got) != 0 {
		t.Fatalf("deleted memory must not be consumed, got %d", len(got))
	}

	// Rejected rows are retained for audit; deleted rows are gone.
	var rejectedCount int64
	if err := db.Model(&persistence.Memory{}).
		Where("id = ? AND status = ?", rejectable.MemoryID, string(domain.MemoryStatusRejected)).
		Count(&rejectedCount).Error; err != nil {
		t.Fatalf("count rejected row: %v", err)
	}
	if rejectedCount != 1 {
		t.Fatalf("rejected row should be retained for audit, got %d", rejectedCount)
	}
	var deletedCount int64
	if err := db.Model(&persistence.Memory{}).Where("id = ?", deletable.MemoryID).
		Count(&deletedCount).Error; err != nil {
		t.Fatalf("count deleted row: %v", err)
	}
	if deletedCount != 0 {
		t.Fatalf("deleted row should be physically removed, got %d", deletedCount)
	}
}

// Explicit writes without a lifecycle status default to confirmed and are
// immediately consumable (pre-gate behaviour is preserved).
func TestMemoryExplicitWriteDefaultsConfirmed(t *testing.T) {
	ctx := context.Background()
	svc, _ := newMemoryLifecycleService(t)
	const agentID = "agent-explicit"

	if _, err := svc.AddMemory(ctx, domain.MemoryItem{
		AgentID: agentID,
		Target:  domain.MemoryTargetUser,
		Layer:   domain.MemoryLayerIdentity,
		Content: "deltaturn explicit remember marker",
	}); err != nil {
		t.Fatalf("explicit add: %v", err)
	}
	if got := searchMemoryContent(t, svc, agentID, "deltaturn"); len(got) != 1 {
		t.Fatalf("explicit write should default to confirmed and be retrievable, got %d", len(got))
	}
}

// Retrieval failure must degrade to an empty snapshot rather than dumping a
// full arbitrary snapshot that would inject unrelated memory (R03).
func TestMemoryRetrievalFailureDegradesWithoutFullSnapshot(t *testing.T) {
	ctx := context.Background()
	svc, db := newMemoryLifecycleService(t)
	const agentID = "agent-degraded"

	if _, err := svc.AddMemory(ctx, domain.MemoryItem{
		AgentID: agentID,
		Target:  domain.MemoryTargetUser,
		Layer:   domain.MemoryLayerIdentity,
		Content: "epsilonturn unrelated secret marker",
	}); err != nil {
		t.Fatalf("seed confirmed memory: %v", err)
	}

	// Force every subsequent query on this handle to fail.
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get underlying sql db: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close db to force retrieval failure: %v", err)
	}

	snapshot, err := svc.BuildRelevantSnapshot(ctx, agentID, "epsilonturn marker")
	if err != nil {
		t.Fatalf("degraded snapshot must not surface an error: %v", err)
	}
	if !snapshot.Degraded {
		t.Fatalf("snapshot must be flagged degraded on retrieval failure")
	}
	if snapshot.MemoryContent != "" || snapshot.UserContent != "" || snapshot.PersonaContent != "" {
		t.Fatalf("degraded snapshot must inject no memory, got memory=%q user=%q persona=%q",
			snapshot.MemoryContent, snapshot.UserContent, snapshot.PersonaContent)
	}
	if len(snapshot.RelevantItems) != 0 {
		t.Fatalf("degraded snapshot must carry no relevant items, got %d", len(snapshot.RelevantItems))
	}
}

// Heuristic post-turn extraction creates gated candidates, never active
// memory; confirmation is what makes them consumable.
func TestExtractFromTurnCreatesGatedCandidates(t *testing.T) {
	ctx := context.Background()
	svc, db := newMemoryLifecycleService(t)
	const agentID = "agent-extract"

	svc.ExtractFromTurn(ctx, agentID, "conv-1", "turn-1",
		"请记住 etaturn extraction marker 是我们项目的代号", "好的，我记住了")

	var candidates []persistence.Memory
	if err := db.Where("agent_id = ? AND status = ?", agentID, string(domain.MemoryStatusCandidate)).
		Find(&candidates).Error; err != nil {
		t.Fatalf("load extracted candidates: %v", err)
	}
	if len(candidates) == 0 {
		t.Fatalf("turn extraction must create at least one candidate")
	}
	if got := searchMemoryContent(t, svc, agentID, "etaturn"); len(got) != 0 {
		t.Fatalf("extracted candidates must not be consumed before confirmation, got %d", len(got))
	}

	if _, err := svc.ReviewMemory(ctx, agentID, candidates[0].ID, domain.MemoryStatusConfirmed); err != nil {
		t.Fatalf("confirm extracted candidate: %v", err)
	}
	if got := searchMemoryContent(t, svc, agentID, "etaturn"); len(got) != 1 {
		t.Fatalf("confirmed extracted memory must be retrievable, got %d", len(got))
	}
}

// A frozen memory cannot be rejected (protected from non-admin loss).
func TestMemoryRejectFrozenIsRefused(t *testing.T) {
	ctx := context.Background()
	svc, _ := newMemoryLifecycleService(t)
	const agentID = "agent-frozen"

	item, err := svc.AddMemory(ctx, domain.MemoryItem{
		AgentID: agentID,
		Target:  domain.MemoryTargetUser,
		Layer:   domain.MemoryLayerIdentity,
		Content: "zetaturn frozen critical marker",
		Status:  domain.MemoryStatusCandidate,
	})
	if err != nil {
		t.Fatalf("add candidate: %v", err)
	}
	if _, err := svc.ReviewMemory(ctx, agentID, item.MemoryID, domain.MemoryStatusConfirmed); err != nil {
		t.Fatalf("confirm candidate: %v", err)
	}
	if err := svc.FreezeMemory(ctx, agentID, item.MemoryID, true); err != nil {
		t.Fatalf("freeze memory: %v", err)
	}
	if _, err := svc.ReviewMemory(ctx, agentID, item.MemoryID, domain.MemoryStatusRejected); err == nil {
		t.Fatalf("rejecting a frozen memory must be refused")
	}
}

// The char budget bounds injected (confirmed-only) content: pending
// candidates and audit-retained rejected entries must not consume it, or an
// aging agent with zero confirmed memories could no longer extract anything.
func TestMemoryCharBudgetExcludesCandidatesAndRejected(t *testing.T) {
	ctx := context.Background()
	svc, _ := newMemoryLifecycleService(t)
	const agentID = "agent-budget"
	const target = domain.MemoryTargetUser

	filler := strings.Repeat("candidate filler line ", 12)
	for i := 0; i < 6; i++ {
		item, err := svc.AddMemory(ctx, domain.MemoryItem{
			AgentID: agentID,
			Target:  target,
			Layer:   domain.MemoryLayerContext,
			Content: filler,
			Status:  domain.MemoryStatusCandidate,
		})
		if err != nil {
			t.Fatalf("add candidate %d: %v", i, err)
		}
		if i%2 == 0 {
			if _, err := svc.ReviewMemory(ctx, agentID, item.MemoryID, domain.MemoryStatusRejected); err != nil {
				t.Fatalf("reject candidate %d: %v", i, err)
			}
		}
	}

	// With zero confirmed entries a near-limit confirmed write must fit.
	bigLive := strings.Repeat("confirmed live memory ", 55)
	if len([]rune(bigLive)) >= domain.MemoryCharLimitUser {
		t.Fatalf("test fixture broken: %d >= limit", len([]rune(bigLive)))
	}
	if _, err := svc.AddMemory(ctx, domain.MemoryItem{
		AgentID: agentID,
		Target:  target,
		Layer:   domain.MemoryLayerContext,
		Content: bigLive,
	}); err != nil {
		t.Fatalf("confirmed write must ignore candidate/rejected usage: %v", err)
	}

	// Confirmed content still enforces the budget.
	if _, err := svc.AddMemory(ctx, domain.MemoryItem{
		AgentID: agentID,
		Target:  target,
		Layer:   domain.MemoryLayerContext,
		Content: strings.Repeat("another confirmed entry ", 10),
	}); err == nil {
		t.Fatalf("confirmed usage past the char limit must be rejected")
	}
}
