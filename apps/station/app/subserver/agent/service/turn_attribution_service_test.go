package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestTurnAttributionUsesHistoricalLedgerAndToolLineage(t *testing.T) {
	db := openTurnEvidenceDB(t, "turn_attribution")
	if err := db.AutoMigrate(
		&persistence.CapabilityManifest{},
		&persistence.KnowledgeResourceRevision{},
	); err != nil {
		t.Fatalf("migrate attribution sources: %v", err)
	}
	now := time.Now().UTC()
	seedTurnEvidence(t, db, now)
	if err := db.Model(&persistence.AgentTurn{}).
		Where("id = ?", "turn-1").
		Update("status", string(domain.TurnStatusCompleted)).Error; err != nil {
		t.Fatalf("complete turn: %v", err)
	}

	skillManifest := &model.CapabilityManifest{
		CapabilityId:     "skill:skill-1",
		Version:          "3",
		SourceKind:       model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_SKILL,
		SourceInstanceId: "research",
		DisplayMetadata: &model.CapabilityDisplayMetadata{
			Name: "Research",
		},
	}
	skillRecord, err := capabilityManifestRecord(
		skillManifest,
		"skill-payload-hash",
		now,
	)
	if err != nil {
		t.Fatalf("build skill manifest record: %v", err)
	}
	if err := db.Create(skillRecord).Error; err != nil {
		t.Fatalf("seed skill manifest: %v", err)
	}
	if err := db.Create(&persistence.KnowledgeResourceRevision{
		ResourceID:   "knowledge-1",
		Revision:     7,
		Ptid:         "actor-1",
		Title:        "Architecture",
		ResourceKind: int32(model.KnowledgeResourceKind_KNOWLEDGE_RESOURCE_KIND_DOCUMENT),
		LocatorKind:  "station",
		Availability: int32(model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_READY),
		CreatedAt:    now,
		UpdatedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed knowledge revision: %v", err)
	}
	attachments, err := json.Marshal([]*model.AgentAttachmentRef{{
		AttachmentId: "attachment-1",
		Filename:     "brief.pdf",
		Checksum:     "1234567890abcdef",
	}})
	if err != nil {
		t.Fatalf("encode attachments: %v", err)
	}
	if err := db.Model(&persistence.AgentMessage{}).
		Where("id = ?", "user-1").
		Update("attachments_json", attachments).Error; err != nil {
		t.Fatalf("seed attachment lineage: %v", err)
	}

	ledgerJSON, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(
		&model.ContextLedger{
			ContextLedgerId: "context:attempt-1",
			TurnId:          "turn-1",
			AttemptId:       "attempt-1",
			PromptVersion:   "v1",
			Segments: []*model.ContextSegment{
				{
					SegmentId:  "context:attempt-1:1",
					Type:       model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_SKILL_BODY,
					SourceRefs: []string{"skill:skill-1:version=3"},
					Decision:   model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
				},
				{
					SegmentId:      "context:attempt-1:2",
					Type:           model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_MEMORY,
					ContentHash:    "memory-hash-1234567890",
					Decision:       model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_REJECTED,
					DecisionReason: "memory_disabled",
				},
				{
					SegmentId:  "context:attempt-1:3",
					Type:       model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_KNOWLEDGE,
					SourceRefs: []string{"knowledge:knowledge-1:version=7"},
					Decision:   model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
				},
				{
					SegmentId:      "context:attempt-1:4",
					Type:           model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_ATTACHMENT,
					SourceRefs:     []string{"attachment:attachment-1"},
					ContentHash:    "1234567890abcdef",
					Decision:       model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_TRUNCATED,
					DecisionReason: "attachment_budget_truncated",
				},
			},
		},
	)
	if err != nil {
		t.Fatalf("encode ledger: %v", err)
	}
	if err := db.Model(&persistence.TurnAttempt{}).
		Where("id = ?", "attempt-1").
		Update("context_ledger", string(ledgerJSON)).Error; err != nil {
		t.Fatalf("seed context ledger: %v", err)
	}
	if err := db.Create(&persistence.ToolCall{
		ID:               "tool-row-1",
		ActorID:          "actor-1",
		TurnID:           "turn-1",
		AttemptID:        "attempt-1",
		ToolBatchID:      "batch-1",
		ToolName:         "workspace_search",
		ToolCallID:       "tool-call-1",
		SchemaVersion:    "1",
		ManifestVersion:  "2",
		BoundedArguments: []byte(`{}`),
		ResourceRefs:     []byte{},
		Status:           persistence.ToolCallStatusSucceeded,
		CreatedAt:        now,
		UpdatedAt:        now,
	}).Error; err != nil {
		t.Fatalf("seed tool lineage: %v", err)
	}

	service := &TurnService{}
	projections, err := service.GetTurnAttributions(
		context.Background(),
		"actor-1",
		[]string{"turn-1"},
	)
	if err != nil {
		t.Fatalf("get turn attribution: %v", err)
	}
	if len(projections) != 1 ||
		projections[0].GetState() !=
			model.TurnAttributionState_TURN_ATTRIBUTION_STATE_AVAILABLE {
		t.Fatalf("unexpected projection: %+v", projections)
	}
	entries := projections[0].GetEntries()
	if len(entries) != 5 {
		t.Fatalf("attribution entries = %d, want 5: %+v", len(entries), entries)
	}
	assertTurnAttributionEntry(
		t,
		entries,
		model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_SKILL,
		"Research",
		"3",
		model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_INCLUDED,
	)
	assertTurnAttributionEntry(
		t,
		entries,
		model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_MEMORY,
		"",
		"memory-hash-",
		model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_OMITTED,
	)
	assertTurnAttributionEntry(
		t,
		entries,
		model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_KNOWLEDGE,
		"Architecture",
		"7",
		model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_INCLUDED,
	)
	assertTurnAttributionEntry(
		t,
		entries,
		model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_ATTACHMENT,
		"brief.pdf",
		"1234567890ab",
		model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_TRUNCATED,
	)
	assertTurnAttributionEntry(
		t,
		entries,
		model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_TOOL,
		"workspace_search",
		"2",
		model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_INCLUDED,
	)
}

func TestTurnAttributionFailsClosedForMissingLedger(t *testing.T) {
	db := openTurnEvidenceDB(t, "turn_attribution_unavailable")
	seedTurnEvidence(t, db, time.Now().UTC())
	if err := db.Model(&persistence.AgentTurn{}).
		Where("id = ?", "turn-1").
		Update("status", string(domain.TurnStatusCompleted)).Error; err != nil {
		t.Fatalf("complete turn: %v", err)
	}
	service := &TurnService{}

	projections, err := service.GetTurnAttributions(
		context.Background(),
		"actor-1",
		[]string{"turn-1"},
	)
	if err != nil {
		t.Fatalf("get unavailable projection: %v", err)
	}
	if len(projections) != 1 ||
		projections[0].GetState() !=
			model.TurnAttributionState_TURN_ATTRIBUTION_STATE_UNAVAILABLE ||
		projections[0].GetReasonCode() != "context_ledger_unavailable" {
		t.Fatalf("missing ledger fabricated attribution: %+v", projections)
	}
}

func TestTurnAttributionRejectsCrossActorRead(t *testing.T) {
	db := openTurnEvidenceDB(t, "turn_attribution_actor")
	seedTurnEvidence(t, db, time.Now().UTC())
	service := &TurnService{}

	if _, err := service.GetTurnAttributions(
		context.Background(),
		"actor-2",
		[]string{"turn-1"},
	); err == nil {
		t.Fatal("cross-actor attribution read must fail")
	}
}

func assertTurnAttributionEntry(
	t *testing.T,
	entries []*model.TurnAttributionEntry,
	kind model.TurnAttributionKind,
	name string,
	version string,
	outcome model.TurnAttributionOutcome,
) {
	t.Helper()
	for _, entry := range entries {
		if entry.GetKind() == kind {
			if entry.GetName() != name ||
				entry.GetVersion() != version ||
				entry.GetOutcome() != outcome {
				t.Fatalf("unexpected %s attribution: %+v", kind, entry)
			}
			return
		}
	}
	t.Fatalf("missing %s attribution: %+v", kind, entries)
}
