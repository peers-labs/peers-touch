package service

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

// Each confirmed memory adopted into a Turn must freeze its own id+content
// version in the memory context segment, so TurnAttribution can show exactly
// which memories were used.
func TestMemoryAdoptionRefsFreezeEachConfirmedItem(t *testing.T) {
	snapshot := &domain.MemorySnapshot{
		AgentID: "assistant",
		RelevantItems: []domain.MemoryItem{
			{MemoryID: "mem_a", Content: "alpha content"},
			{MemoryID: "mem_b", Content: "beta content"},
			{MemoryID: "mem_a", Content: "alpha content"}, // duplicate id de-duped
		},
	}
	refs := memoryAdoptionRefs(snapshot)
	if len(refs) != 2 {
		t.Fatalf("expected one ref per unique adopted memory, got %d: %v", len(refs), refs)
	}
	for _, ref := range refs {
		sourceID, version, ok := parseAttributionSourceRef(model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_MEMORY, ref)
		if !ok || version == "" {
			t.Fatalf("adoption ref must parse to id+version: %q -> (%q,%q,%v)", ref, sourceID, version, ok)
		}
		if sourceID != "mem_a" && sourceID != "mem_b" {
			t.Fatalf("unexpected memory source id %q", sourceID)
		}
	}

	// Empty adoption falls back to the aggregate section ref, not per-item ids.
	empty := memoryAdoptionRefs(&domain.MemorySnapshot{AgentID: "assistant"})
	if len(empty) != 1 {
		t.Fatalf("expected single aggregate ref for empty adoption, got %v", empty)
	}
	sourceID, version, ok := parseAttributionSourceRef(model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_MEMORY, empty[0])
	if !ok || sourceID != "memory" || version != "" {
		t.Fatalf("aggregate ref should resolve to pseudo-id memory, got (%q,%q,%v)", sourceID, version, ok)
	}
}

// The attribution projection resolves a frozen memory ref to its stored
// summary and content version, proving the per-turn lineage is reviewable.
func TestAttributionMemoryEntryResolvesNameAndVersion(t *testing.T) {
	ctx := context.Background()
	svc, db := newMemoryLifecycleService(t)
	item, err := svc.AddMemory(ctx, domain.MemoryItem{
		AgentID: "agent-attribution",
		Target:  domain.MemoryTargetUser,
		Layer:   domain.MemoryLayerPreference,
		Content: "thetaturn attribution preference marker",
		Summary: "theta preference summary",
	})
	if err != nil {
		t.Fatalf("add confirmed memory: %v", err)
	}

	refs := memoryAdoptionRefs(&domain.MemorySnapshot{
		AgentID:       "agent-attribution",
		RelevantItems: []domain.MemoryItem{{MemoryID: item.MemoryID, Content: item.Content}},
	})
	if len(refs) != 1 {
		t.Fatalf("expected one adoption ref, got %v", refs)
	}
	segment := &model.ContextSegment{
		Type:        model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_MEMORY,
		SourceRefs:  refs,
		ContentHash: sha256Hex(item.Content),
		Decision:    model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
	}
	entries, err := attributionEntriesForSegment(ctx, db, "ptid-x", segment, nil, nil)
	if err != nil {
		t.Fatalf("build memory attribution entries: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected one memory attribution entry, got %d", len(entries))
	}
	entry := entries[0]
	if entry.GetKind() != model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_MEMORY {
		t.Fatalf("unexpected attribution kind: %v", entry.GetKind())
	}
	if entry.GetSourceId() != item.MemoryID {
		t.Fatalf("attribution source id = %q, want %q", entry.GetSourceId(), item.MemoryID)
	}
	if entry.GetVersion() == "" {
		t.Fatalf("attribution must freeze a memory content version")
	}
	if entry.GetName() != "theta preference summary" {
		t.Fatalf("attribution name should resolve to memory summary, got %q", entry.GetName())
	}
	if entry.GetOutcome() != model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_INCLUDED {
		t.Fatalf("adopted memory must be marked included, got %v", entry.GetOutcome())
	}

	// Sanity: persistence.Memory is the table the name resolver reads.
	var row persistence.Memory
	if err := db.Where("id = ?", item.MemoryID).First(&row).Error; err != nil {
		t.Fatalf("reload memory row: %v", err)
	}
}
