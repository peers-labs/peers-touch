package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

func TestPersistRuntimeAuthorityStoresBindingAndAttemptSnapshot(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "runtime_authority_persist")
	seedRuntimeAuthorityRows(t, db, "turn-1", "attempt-1")

	admission := runtimeAuthorityAdmission("provider-1", "model-1", 1)
	config := runtimeAuthorityConfig("turn-1", "attempt-1")
	if err := (&TurnService{}).persistRuntimeAuthority(context.Background(), config, admission); err != nil {
		t.Fatalf("persist runtime authority: %v", err)
	}

	var conversation persistence.Conversation
	if err := db.First(&conversation, "id = ?", config.ConversationID).Error; err != nil {
		t.Fatalf("load conversation: %v", err)
	}
	binding, err := persistence.UnmarshalConversationRuntimeBinding(conversation.RuntimeBinding)
	if err != nil {
		t.Fatalf("decode runtime binding: %v", err)
	}
	if binding.GetRuntimeKind() != model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL ||
		binding.GetProviderId() != admission.ProviderID ||
		binding.GetModelId() != admission.ModelID ||
		binding.GetRuntimeProfileId() != modernChatAgentProfileID ||
		binding.GetExternalSessionId() != "" ||
		binding.GetExternalSessionEpoch() != 0 ||
		binding.GetRuntimeHomeRef() != "" {
		t.Fatalf("unexpected direct-model binding: %+v", binding)
	}
	readback, err := NewConversationService().GetConversation(
		context.Background(),
		"ptid:person:owner",
		config.ConversationID,
	)
	if err != nil {
		t.Fatalf("read back conversation authority: %v", err)
	}
	if readback.RuntimeBinding.GetCapabilitySnapshotHash() != binding.GetCapabilitySnapshotHash() {
		t.Fatalf("domain readback lost runtime binding: %+v", readback.RuntimeBinding)
	}

	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", config.AttemptID).Error; err != nil {
		t.Fatalf("load attempt: %v", err)
	}
	snapshot, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
	if err != nil {
		t.Fatalf("decode attempt snapshot: %v", err)
	}
	if snapshot.GetProviderId() != admission.ProviderID ||
		snapshot.GetModelId() != admission.ModelID ||
		snapshot.GetThinkingMode() != string(domain.ThinkingModeDisabled) ||
		snapshot.GetProviderConfigVersion() != "7" ||
		snapshot.GetAgentConfigVersion() != "11" ||
		snapshot.GetExternalSessionId() != "" ||
		snapshot.GetExternalSessionEpoch() != 0 ||
		attempt.ReadinessSnapshotID != admission.SnapshotID {
		t.Fatalf("unexpected attempt runtime snapshot: snapshot=%+v attempt=%+v", snapshot, attempt)
	}
	expectedHash, err := runtimeSnapshotHash(snapshot)
	if err != nil {
		t.Fatalf("hash persisted snapshot: %v", err)
	}
	if attempt.RuntimeSnapshotHash != expectedHash {
		t.Fatalf("runtime snapshot hash=%q, want %q", attempt.RuntimeSnapshotHash, expectedHash)
	}
}

func TestPersistRuntimeAuthorityRejectsTupleMismatchWithoutOverwrite(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "runtime_authority_conflict")
	seedRuntimeAuthorityRows(t, db, "turn-1", "attempt-1")
	service := &TurnService{}

	first := runtimeAuthorityAdmission("provider-1", "model-1", 1)
	if err := service.persistRuntimeAuthority(
		context.Background(),
		runtimeAuthorityConfig("turn-1", "attempt-1"),
		first,
	); err != nil {
		t.Fatalf("persist first runtime authority: %v", err)
	}
	var original persistence.Conversation
	if err := db.First(&original, "id = ?", "conversation-1").Error; err != nil {
		t.Fatalf("load original binding: %v", err)
	}

	seedRuntimeAuthorityAttempt(t, db, "turn-2", "attempt-2")
	mismatched := runtimeAuthorityAdmission("provider-1", "model-2", 2)
	err := service.persistRuntimeAuthority(
		context.Background(),
		runtimeAuthorityConfig("turn-2", "attempt-2"),
		mismatched,
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentVersionConflict {
		t.Fatalf("expected runtime binding conflict, got %T: %v", err, err)
	}

	var after persistence.Conversation
	if err := db.First(&after, "id = ?", "conversation-1").Error; err != nil {
		t.Fatalf("load binding after conflict: %v", err)
	}
	if string(after.RuntimeBinding) != string(original.RuntimeBinding) {
		t.Fatal("runtime binding was overwritten after tuple conflict")
	}
	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", "attempt-2").Error; err != nil {
		t.Fatalf("load rejected attempt: %v", err)
	}
	if len(attempt.RuntimeSnapshot) != 0 || attempt.RuntimeSnapshotHash != "" {
		t.Fatal("rejected tuple persisted a partial attempt runtime snapshot")
	}
}

func TestPersistRuntimeAuthorityReusesBoundCapabilityObservation(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "runtime_authority_same_tuple")
	seedRuntimeAuthorityRows(t, db, "turn-1", "attempt-1")
	service := &TurnService{}

	first := runtimeAuthorityAdmission("provider-1", "model-1", 1)
	if err := service.persistRuntimeAuthority(
		context.Background(),
		runtimeAuthorityConfig("turn-1", "attempt-1"),
		first,
	); err != nil {
		t.Fatalf("persist first runtime authority: %v", err)
	}
	seedRuntimeAuthorityAttempt(t, db, "turn-2", "attempt-2")
	second := runtimeAuthorityAdmission("provider-1", "model-1", 2)
	if err := service.persistRuntimeAuthority(
		context.Background(),
		runtimeAuthorityConfig("turn-2", "attempt-2"),
		second,
	); err != nil {
		t.Fatalf("persist matching runtime authority: %v", err)
	}

	var attempts []persistence.TurnAttempt
	if err := db.Order("attempt_index ASC").Find(&attempts).Error; err != nil {
		t.Fatalf("load attempts: %v", err)
	}
	if len(attempts) != 2 || attempts[0].RuntimeSnapshotHash != attempts[1].RuntimeSnapshotHash {
		t.Fatalf("matching tuple did not retain pinned runtime facts: %+v", attempts)
	}
}

func TestCanonicalJSONHashMatchesAcceptanceValidator(t *testing.T) {
	hash, err := canonicalJSONHash(map[string]interface{}{
		"z": []interface{}{map[string]interface{}{"d": 4, "c": 3}},
		"a": map[string]interface{}{"b": 2, "a": 1},
	})
	if err != nil {
		t.Fatalf("hash canonical JSON: %v", err)
	}
	const pythonSortKeysCompactHash = "3733063eae4764a370f17cd1c3152dbc98f253d583b6437c2d54310550437799"
	if hash != pythonSortKeysCompactHash {
		t.Fatalf("canonical hash=%s, want acceptance validator hash=%s", hash, pythonSortKeysCompactHash)
	}
}

func TestResolveAgentDefaultsLoadsThinkingModeWithoutConfigJSON(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "thinking_mode_defaults")
	now := time.Now().UTC()
	if err := db.Create(&persistence.Agent{
		ID:           "agent-thinking",
		Name:         "Thinking",
		ProviderID:   "ark",
		ModelName:    "seed",
		Effort:       "high",
		ThinkingMode: string(domain.ThinkingModeDisabled),
		Visibility:   string(domain.AgentVisibilityPrivate),
		OwnerActorID: "ptid:person:owner",
		Version:      1,
		CreatedAt:    now,
		UpdatedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed agent: %v", err)
	}

	config := &TurnConfig{AgentID: "agent-thinking"}
	(&TurnService{}).resolveAgentDefaults(context.Background(), config)

	if config.ThinkingMode != domain.ThinkingModeDisabled {
		t.Fatalf("thinking mode = %q, want disabled", config.ThinkingMode)
	}
	if config.Provider != "ark" || config.Model != "seed" || config.Effort != "high" {
		t.Fatalf("structured Agent defaults were not loaded: %+v", config)
	}
}

func TestMigrateRuntimeSnapshotThinkingModesBackfillsAutoAndHash(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "thinking_mode_snapshot_migration")
	seedRuntimeAuthorityRows(t, db, "turn-migration", "attempt-migration")
	legacySnapshot := newDirectRuntimeSnapshot(
		runtimeAuthorityAdmission("provider-1", "model-1", 1),
		"11",
		"",
	)
	encoded, err := persistence.MarshalRuntimeSnapshot(legacySnapshot)
	if err != nil {
		t.Fatalf("encode legacy runtime snapshot: %v", err)
	}
	if err := db.Model(&persistence.TurnAttempt{}).
		Where("id = ?", "attempt-migration").
		Updates(map[string]interface{}{
			"runtime_snapshot":      encoded,
			"runtime_snapshot_hash": "legacy-hash",
		}).Error; err != nil {
		t.Fatalf("seed legacy runtime snapshot: %v", err)
	}

	if err := MigrateRuntimeSnapshotThinkingModes(db); err != nil {
		t.Fatalf("migrate runtime snapshot thinking modes: %v", err)
	}

	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", "attempt-migration").Error; err != nil {
		t.Fatalf("load migrated attempt: %v", err)
	}
	snapshot, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
	if err != nil {
		t.Fatalf("decode migrated runtime snapshot: %v", err)
	}
	if snapshot.GetThinkingMode() != string(domain.ThinkingModeAuto) {
		t.Fatalf("thinking mode = %q, want auto", snapshot.GetThinkingMode())
	}
	expectedHash, err := runtimeSnapshotHash(snapshot)
	if err != nil {
		t.Fatalf("hash migrated runtime snapshot: %v", err)
	}
	if attempt.RuntimeSnapshotHash != expectedHash {
		t.Fatalf(
			"runtime snapshot hash = %q, want %q",
			attempt.RuntimeSnapshotHash,
			expectedHash,
		)
	}
	if err := MigrateRuntimeSnapshotThinkingModes(db); err != nil {
		t.Fatalf("repeat thinking-mode migration: %v", err)
	}
}

func openRuntimeAuthorityDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db := openConversationAuthorityDB(t, name)
	if err := db.AutoMigrate(
		&persistence.Agent{},
		&persistence.TurnAttempt{},
	); err != nil {
		t.Fatalf("migrate runtime authority database: %v", err)
	}
	return db
}

func seedRuntimeAuthorityRows(t *testing.T, db *gorm.DB, turnID string, attemptID string) {
	t.Helper()
	now := time.Now().UTC()
	if err := db.Create(&persistence.Agent{
		ID:           "agent-1",
		Name:         "Agent",
		OwnerActorID: "ptid:person:owner",
		Version:      11,
		CreatedAt:    now,
		UpdatedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed agent: %v", err)
	}
	if err := db.Create(&persistence.Conversation{
		ID:         "conversation-1",
		AgentID:    "agent-1",
		Ptid:       "ptid:person:owner",
		Title:      "Runtime authority",
		ProviderID: "provider-1",
		Status:     "active",
		Version:    1,
		CreatedAt:  now,
		UpdatedAt:  now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	seedRuntimeAuthorityAttempt(t, db, turnID, attemptID)
}

func seedRuntimeAuthorityAttempt(t *testing.T, db *gorm.DB, turnID string, attemptID string) {
	t.Helper()
	now := time.Now().UTC()
	if err := db.Create(&persistence.AgentTurn{
		ID:             turnID,
		ConversationID: "conversation-1",
		AgentID:        "agent-1",
		Status:         "running",
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID:           attemptID,
		TurnID:       turnID,
		AttemptIndex: 1,
		Status:       "running",
		StartedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed attempt: %v", err)
	}
}

func runtimeAuthorityConfig(turnID string, attemptID string) *TurnConfig {
	return &TurnConfig{
		TurnID:         turnID,
		AttemptID:      attemptID,
		ConversationID: "conversation-1",
		AgentID:        "agent-1",
		ActorID:        "ptid:person:owner",
		Provider:       "provider-1",
		Model:          "model-1",
		ThinkingMode:   domain.ThinkingModeDisabled,
	}
}

func runtimeAuthorityAdmission(providerID string, modelID string, observedDay int) *AdmissionSnapshot {
	return &AdmissionSnapshot{
		SnapshotID:            "readiness-1",
		ProviderID:            providerID,
		ModelID:               modelID,
		ProviderConfigVersion: "7",
		Capabilities: &model.RuntimeCapabilitySnapshot{
			SnapshotId: "readiness-1",
			Input:      &model.RuntimeInputCapabilities{Text: true},
			Output:     &model.RuntimeOutputCapabilities{Text: true, Structured: true},
			Runtime:    &model.RuntimeExecutionCapabilities{Streaming: true, PromptCache: true},
			Agentic:    &model.RuntimeAgenticCapabilities{NativeTools: true},
			Limits: &model.RuntimeCapabilityLimits{
				ContextTokens:   128000,
				OutputTokens:    8192,
				AttachmentCount: 10,
				AttachmentBytes: 10 * 1024 * 1024,
			},
			Resolution: []*model.RuntimeCapability{{
				CapabilityId: "provider",
				Resolution:   model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE,
				ReasonCode:   providerID,
			}},
			Provenance: &model.RuntimeCapabilityProvenance{
				DiscoverySource: "station-admission-resolver",
				SourceVersion:   "v1",
				ObservedAt: timestamppb.New(
					time.Date(2026, 8, observedDay, 0, 0, 0, 0, time.UTC),
				),
			},
		},
	}
}
