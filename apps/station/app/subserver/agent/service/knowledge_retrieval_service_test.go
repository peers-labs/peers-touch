package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type knowledgeAuthorityFixture struct {
	db           *gorm.DB
	now          time.Time
	actorID      string
	agentID      string
	conversation string
	turnID       string
	attemptID    string
	readiness    []*model.CapabilityReadiness
}

func TestKnowledgeRetrievalChunksEmbedsAndRanksAuthorizedResources(t *testing.T) {
	fixture := newKnowledgeAuthorityFixture(t)
	fixture.addStationKnowledge(
		t,
		"knowledge-trace",
		"Trace diagnostics",
		"Agent memory: use postgres jsonb indexes for turn trace diagnostics.",
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
	)
	authorized := fixture.loadAuthorized(t, time.Now().UTC().Add(time.Hour))

	result, err := NewKnowledgeRetrievalService(nil).Retrieve(
		context.Background(),
		fixture.db,
		authorized,
		"How should turn trace diagnostics use jsonb?",
	)
	if err != nil {
		t.Fatalf("retrieve authorized Knowledge: %v", err)
	}
	if len(result.Chunks) != 1 {
		t.Fatalf("expected one retrieved chunk, got %d", len(result.Chunks))
	}
	if result.Chunks[0].ResourceID != "knowledge-trace" {
		t.Fatalf("expected authorized resource id, got %q", result.Chunks[0].ResourceID)
	}
	if result.Chunks[0].Score <= 0 {
		t.Fatalf("expected positive retrieval score, got %f", result.Chunks[0].Score)
	}
	if !strings.Contains(result.PromptBlock, "<knowledge_context>") {
		t.Fatalf("expected prompt block to include knowledge tag, got %q", result.PromptBlock)
	}
}

func TestKnowledgeRetrievalOmitsNonReadyResources(t *testing.T) {
	fixture := newKnowledgeAuthorityFixture(t)
	fixture.addStationKnowledge(
		t,
		"knowledge-disabled",
		"Disabled",
		"disabled resource content",
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
	)
	authorized := fixture.loadAuthorized(t, time.Now().UTC().Add(time.Hour))

	result, err := NewKnowledgeRetrievalService(nil).Retrieve(
		context.Background(),
		fixture.db,
		authorized,
		"disabled",
	)
	if err != nil {
		t.Fatalf("retrieve without READY Knowledge: %v", err)
	}
	if len(result.Chunks) != 0 || result.PromptBlock != "" {
		t.Fatalf("expected unavailable resource omission, got chunks=%d block=%q", len(result.Chunks), result.PromptBlock)
	}
}

func TestLoadAuthorizedCapabilitySetRejectsExpiredSnapshot(t *testing.T) {
	fixture := newKnowledgeAuthorityFixture(t)
	fixture.addStationKnowledge(
		t,
		"knowledge-expired",
		"Expired",
		"expired content",
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
	)

	_, err := fixture.tryLoadAuthorized(t, time.Now().UTC().Add(-time.Hour))
	if !isCapabilityError(err, errcode.AgentInvalidSourceState) {
		t.Fatalf("expected expired readiness rejection, got %v", err)
	}
}

func TestPromptAssemblyUsesAuthorizedKnowledge(t *testing.T) {
	fixture := newKnowledgeAuthorityFixture(t)
	fixture.addStationKnowledge(
		t,
		"knowledge-prompt",
		"Prompt authority",
		"Authorized prompt context is loaded from immutable Station content.",
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
	)
	authorized := fixture.loadAuthorized(t, time.Now().UTC().Add(time.Hour))

	result, err := NewPromptAssemblyService(nil, nil).Assemble(
		context.Background(),
		fixture.agentID,
		"identity",
		"",
		authorized.ToolNames(),
		"Where is prompt context loaded from?",
		fixture.db,
		authorized,
		true,
	)
	if err != nil {
		t.Fatalf("assemble authorized prompt: %v", err)
	}
	if len(result.KnowledgeChunks) != 1 ||
		result.KnowledgeChunks[0].ResourceID != "knowledge-prompt" {
		t.Fatalf("prompt assembly lost authorized Knowledge lineage: %+v", result.KnowledgeChunks)
	}
	if !strings.Contains(result.SystemPrompt, "immutable Station content") {
		t.Fatalf("prompt omitted authorized Station content: %q", result.SystemPrompt)
	}
}

func newKnowledgeAuthorityFixture(t *testing.T) *knowledgeAuthorityFixture {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open Knowledge authority database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.Conversation{},
		&persistence.AgentTurn{},
		&persistence.TurnAttempt{},
		&persistence.CapabilityManifest{},
		&persistence.AgentCapabilityBinding{},
		&persistence.CapabilityReadinessSnapshot{},
		&persistence.KnowledgeResourceRevision{},
		&persistence.KnowledgeContentRevision{},
	); err != nil {
		t.Fatalf("migrate Knowledge authority database: %v", err)
	}

	fixture := &knowledgeAuthorityFixture{
		db:           db,
		now:          time.Date(2026, time.August, 28, 12, 0, 0, 0, time.UTC),
		actorID:      "ptid:person:knowledge-owner",
		agentID:      "agent-knowledge",
		conversation: "conversation-knowledge",
		turnID:       "turn-knowledge",
		attemptID:    "attempt-knowledge",
	}
	if err := db.Create(&persistence.Conversation{
		ID:        fixture.conversation,
		AgentID:   fixture.agentID,
		Ptid:      fixture.actorID,
		Title:     "Knowledge",
		Status:    "active",
		CreatedAt: fixture.now,
		UpdatedAt: fixture.now,
	}).Error; err != nil {
		t.Fatalf("seed Knowledge conversation: %v", err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID:             fixture.turnID,
		ConversationID: fixture.conversation,
		AgentID:        fixture.agentID,
		Status:         "running",
		StartedAt:      fixture.now,
	}).Error; err != nil {
		t.Fatalf("seed Knowledge turn: %v", err)
	}
	return fixture
}

func (f *knowledgeAuthorityFixture) addStationKnowledge(
	t *testing.T,
	resourceID string,
	title string,
	content string,
	state model.CapabilityReadinessState,
) {
	t.Helper()
	revision := uint64(1)
	version := "1"
	capabilityID := "knowledge." + resourceID
	bindingID := "binding." + resourceID
	contentBytes := []byte(content)
	contentSum := sha256.Sum256(contentBytes)
	contentHash := hex.EncodeToString(contentSum[:])
	contentRef := "station-content://" + resourceID + "/1"

	if err := f.db.Create(&persistence.CapabilityManifest{
		CapabilityID:             capabilityID,
		Version:                  version,
		SourceKind:               int32(model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_KNOWLEDGE),
		SourceInstanceID:         resourceID,
		DisplayMetadataJSON:      "{}",
		InputSchemaRef:           "peers_touch.model.agent.v1.KnowledgeResourceDescriptor",
		OutputSchemaRef:          "peers_touch.model.agent.v1.KnowledgeResourceDescriptor",
		ExecutionOwner:           int32(model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION),
		RequiredCapabilitiesJSON: "[]",
		RiskClass:                "read",
		DefaultApprovalPolicy:    int32(model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO),
		SecretBoundary:           "station",
		Availability:             int32(model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE),
		PayloadHash:              contentHash,
		OwnerPtid:                f.actorID,
		CreatedAt:                f.now,
	}).Error; err != nil {
		t.Fatalf("seed Knowledge manifest: %v", err)
	}
	if err := f.db.Create(&persistence.AgentCapabilityBinding{
		BindingID:         bindingID,
		Ptid:              f.actorID,
		AgentID:           f.agentID,
		CapabilityID:      capabilityID,
		CapabilityVersion: version,
		Enabled:           true,
		ApprovalPolicy:    int32(model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO),
		AgentVersion:      1,
		Revision:          1,
		UpdatedAt:         f.now,
	}).Error; err != nil {
		t.Fatalf("seed Knowledge binding: %v", err)
	}
	if err := f.db.Create(&persistence.KnowledgeResourceRevision{
		ResourceID:        resourceID,
		Revision:          revision,
		Ptid:              f.actorID,
		Title:             title,
		ResourceKind:      int32(model.KnowledgeResourceKind_KNOWLEDGE_RESOURCE_KIND_DOCUMENT),
		LocatorKind:       "station",
		StationContentRef: contentRef,
		ContentHash:       contentHash,
		IndexRevision:     "index-1",
		Availability:      int32(model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_READY),
		ReasonCode:        "ready",
		CreatedAt:         f.now,
		UpdatedAt:         f.now,
	}).Error; err != nil {
		t.Fatalf("seed Knowledge descriptor: %v", err)
	}
	if err := f.db.Create(&persistence.KnowledgeContentRevision{
		ContentRef:    contentRef,
		ResourceID:    resourceID,
		Revision:      revision,
		Ptid:          f.actorID,
		Content:       contentBytes,
		ContentHash:   contentHash,
		IndexRevision: "index-1",
		CreatedAt:     f.now,
	}).Error; err != nil {
		t.Fatalf("seed Knowledge content: %v", err)
	}
	f.readiness = append(f.readiness, &model.CapabilityReadiness{
		CapabilityId:      capabilityID,
		CapabilityVersion: version,
		BindingId:         bindingID,
		BindingRevision:   1,
		State:             state,
		Authority:         "station",
	})
}

func (f *knowledgeAuthorityFixture) loadAuthorized(
	t *testing.T,
	expiresAt time.Time,
) *AuthorizedCapabilitySet {
	t.Helper()
	authorized, err := f.tryLoadAuthorized(t, expiresAt)
	if err != nil {
		t.Fatalf("load authorized capability set: %v", err)
	}
	return authorized
}

func (f *knowledgeAuthorityFixture) tryLoadAuthorized(
	t *testing.T,
	expiresAt time.Time,
) (*AuthorizedCapabilitySet, error) {
	t.Helper()
	snapshotID := "readiness-knowledge"
	snapshot := &model.CapabilityReadinessSnapshot{
		SnapshotId:   snapshotID,
		Ptid:         f.actorID,
		AgentId:      f.agentID,
		Capabilities: f.readiness,
		CreatedAt:    timestamppb.New(f.now.Add(-time.Minute)),
		ExpiresAt:    timestamppb.New(expiresAt),
	}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(snapshot)
	if err != nil {
		t.Fatalf("encode Knowledge readiness snapshot: %v", err)
	}
	payloadSum := sha256.Sum256(payload)
	if err := f.db.Create(&persistence.CapabilityReadinessSnapshot{
		SnapshotID:  snapshotID,
		Ptid:        f.actorID,
		AgentID:     f.agentID,
		Payload:     payload,
		PayloadHash: hex.EncodeToString(payloadSum[:]),
		CreatedAt:   f.now.Add(-time.Minute),
		ExpiresAt:   expiresAt,
	}).Error; err != nil {
		t.Fatalf("seed Knowledge readiness snapshot: %v", err)
	}
	if err := f.db.Create(&persistence.TurnAttempt{
		ID:                  f.attemptID,
		TurnID:              f.turnID,
		AttemptIndex:        1,
		Status:              "running",
		ReadinessSnapshotID: snapshotID,
		StartedAt:           f.now,
	}).Error; err != nil {
		t.Fatalf("seed Knowledge turn attempt: %v", err)
	}

	return LoadAuthorizedCapabilitySet(context.Background(), f.db, &TurnConfig{
		TurnID:    f.turnID,
		AttemptID: f.attemptID,
		ActorID:   f.actorID,
		AgentID:   f.agentID,
	})
}
