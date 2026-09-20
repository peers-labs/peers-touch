package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCapabilityManifestVersionIsImmutableAndRetirable(t *testing.T) {
	service := newCapabilityAuthorityTestService(t, "manifest")
	ctx := context.Background()
	manifest := capabilityAuthorityTestManifest()

	created, err := service.RegisterManifest(ctx, manifest)
	if err != nil {
		t.Fatalf("register manifest: %v", err)
	}
	service.now = func() time.Time {
		return time.Date(2026, time.August, 28, 12, 0, 0, 0, time.UTC)
	}
	replayed, err := service.RegisterManifest(ctx, manifest)
	if err != nil {
		t.Fatalf("replay manifest registration: %v", err)
	}
	if replayed.GetCapabilityId() != created.GetCapabilityId() {
		t.Fatalf("replayed manifest mismatch: got %q", replayed.GetCapabilityId())
	}

	conflicting := capabilityAuthorityTestManifest()
	conflicting.RiskClass = "high"
	if _, err := service.RegisterManifest(ctx, conflicting); !isCapabilityError(
		err, errcode.AgentIdempotencyConflict,
	) {
		t.Fatalf("expected immutable version conflict, got %v", err)
	}

	retire := &model.RetireCapabilityManifestRequest{
		CapabilityId:   manifest.GetCapabilityId(),
		Version:        manifest.GetVersion(),
		IdempotencyKey: "retire-1",
		Reason:         "source removed",
	}
	retired, err := service.RetireManifest(ctx, "ptid:person:owner", retire)
	if err != nil {
		t.Fatalf("retire manifest: %v", err)
	}
	if retired.GetRetiredAt() == nil ||
		retired.GetAvailability() != model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED {
		t.Fatalf("retired manifest did not become blocked: %+v", retired)
	}
	replayedRetirement, err := service.RetireManifest(ctx, "ptid:person:owner", retire)
	if err != nil {
		t.Fatalf("replay retirement: %v", err)
	}
	if replayedRetirement.GetRetirementReason() != "source removed" {
		t.Fatalf("retirement replay mismatch: %+v", replayedRetirement)
	}
}

func TestAgentCapabilityBindingUsesAgentAndBindingCAS(t *testing.T) {
	service := newCapabilityAuthorityTestService(t, "binding-cas")
	ctx := context.Background()
	seedCapabilityAuthorityAgent(t, service.db, "agent-1", "ptid:person:owner", 4)
	if _, err := service.RegisterManifest(ctx, capabilityAuthorityTestManifest()); err != nil {
		t.Fatalf("register manifest: %v", err)
	}

	create := capabilityAuthorityBindingRequest("", 0, 4, "create-1")
	created, err := service.UpsertBinding(ctx, "ptid:person:owner", create)
	if err != nil {
		t.Fatalf("create binding: %v", err)
	}
	if created.GetRevision() != 1 {
		t.Fatalf("expected revision 1, got %d", created.GetRevision())
	}
	replayed, err := service.UpsertBinding(ctx, "ptid:person:owner", create)
	if err != nil {
		t.Fatalf("replay binding create: %v", err)
	}
	if replayed.GetBindingId() != created.GetBindingId() {
		t.Fatalf("idempotency replay changed binding: %q != %q",
			replayed.GetBindingId(), created.GetBindingId())
	}

	staleBinding := capabilityAuthorityBindingRequest(created.GetBindingId(), 9, 4, "update-stale")
	if _, err := service.UpsertBinding(
		ctx, "ptid:person:owner", staleBinding,
	); !isCapabilityError(err, errcode.AgentVersionConflict) {
		t.Fatalf("expected binding revision conflict, got %v", err)
	}

	staleAgent := capabilityAuthorityBindingRequest(created.GetBindingId(), 1, 3, "agent-stale")
	if _, err := service.UpsertBinding(
		ctx, "ptid:person:owner", staleAgent,
	); !isCapabilityError(err, errcode.AgentVersionConflict) {
		t.Fatalf("expected agent version conflict, got %v", err)
	}

	update := capabilityAuthorityBindingRequest(created.GetBindingId(), 1, 4, "update-1")
	update.Binding.Enabled = false
	updated, err := service.UpsertBinding(ctx, "ptid:person:owner", update)
	if err != nil {
		t.Fatalf("update binding: %v", err)
	}
	if updated.GetRevision() != 2 || updated.GetEnabled() {
		t.Fatalf("binding update mismatch: %+v", updated)
	}
	replayedCreate, err := service.UpsertBinding(ctx, "ptid:person:owner", create)
	if err != nil {
		t.Fatalf("replay binding create after update: %v", err)
	}
	if replayedCreate.GetRevision() != created.GetRevision() ||
		replayedCreate.GetEnabled() != created.GetEnabled() {
		t.Fatalf("binding replay did not preserve original result: %+v", replayedCreate)
	}
}

func TestAgentCapabilityBindingIsActorScopedAndTombstoned(t *testing.T) {
	service := newCapabilityAuthorityTestService(t, "binding-delete")
	ctx := context.Background()
	seedCapabilityAuthorityAgent(t, service.db, "agent-1", "ptid:person:owner", 1)
	if _, err := service.RegisterManifest(ctx, capabilityAuthorityTestManifest()); err != nil {
		t.Fatalf("register manifest: %v", err)
	}
	created, err := service.UpsertBinding(
		ctx,
		"ptid:person:owner",
		capabilityAuthorityBindingRequest("", 0, 1, "create-1"),
	)
	if err != nil {
		t.Fatalf("create binding: %v", err)
	}
	if _, err := service.ListBindings(
		ctx, "ptid:person:other", "agent-1",
	); !isCapabilityError(err, errcode.AgentNotFound) {
		t.Fatalf("expected cross-actor read rejection, got %v", err)
	}

	deleteRequest := &model.DeleteAgentCapabilityBindingRequest{
		BindingId:               created.GetBindingId(),
		ExpectedBindingRevision: 1,
		IdempotencyKey:          "delete-1",
		Reason:                  "agent policy removed",
	}
	deleted, err := service.DeleteBinding(ctx, "ptid:person:owner", deleteRequest)
	if err != nil {
		t.Fatalf("delete binding: %v", err)
	}
	if deleted.GetRevision() != 2 || deleted.GetTombstonedAt() == nil {
		t.Fatalf("binding was not tombstoned: %+v", deleted)
	}
	replayed, err := service.DeleteBinding(ctx, "ptid:person:owner", deleteRequest)
	if err != nil {
		t.Fatalf("replay binding delete: %v", err)
	}
	if replayed.GetRevision() != 2 {
		t.Fatalf("delete replay changed revision: %d", replayed.GetRevision())
	}
	active, err := service.ListBindings(ctx, "ptid:person:owner", "agent-1")
	if err != nil {
		t.Fatalf("list active bindings: %v", err)
	}
	if len(active) != 0 {
		t.Fatalf("tombstoned binding remained active: %d", len(active))
	}
}

func TestCapabilityBindingMutationsPublishTypedInvalidationsOnce(t *testing.T) {
	service := newCapabilityAuthorityTestService(t, "binding-events")
	eventBus := &recordingAgentEventBus{}
	ctx := context.Background()
	seedCapabilityAuthorityAgent(t, service.db, "agent-1", "ptid:person:owner", 1)
	if _, err := service.RegisterManifest(ctx, capabilityAuthorityTestManifest()); err != nil {
		t.Fatalf("register manifest: %v", err)
	}
	service.SetEventBus(eventBus)

	createRequest := capabilityAuthorityBindingRequest("", 0, 1, "create-event")
	created, err := service.UpsertBinding(ctx, "ptid:person:owner", createRequest)
	if err != nil {
		t.Fatalf("create binding: %v", err)
	}
	if _, err := service.UpsertBinding(ctx, "ptid:person:owner", createRequest); err != nil {
		t.Fatalf("replay binding create: %v", err)
	}
	deleteRequest := &model.DeleteAgentCapabilityBindingRequest{
		BindingId:               created.GetBindingId(),
		ExpectedBindingRevision: created.GetRevision(),
		IdempotencyKey:          "delete-event",
		Reason:                  "policy removed",
	}
	deleted, err := service.DeleteBinding(ctx, "ptid:person:owner", deleteRequest)
	if err != nil {
		t.Fatalf("delete binding: %v", err)
	}
	if _, err := service.DeleteBinding(ctx, "ptid:person:owner", deleteRequest); err != nil {
		t.Fatalf("replay binding delete: %v", err)
	}

	events := eventBus.snapshot()
	if len(events) != 2 {
		t.Fatalf("binding invalidation event count = %d, want 2", len(events))
	}
	assertAgentAuthorityInvalidation(
		t,
		events[0],
		domain.AgentAuthorityInvalidationBindingUpsert,
		created.GetAgentId(),
		created.GetExpectedAgentVersion(),
		created.GetBindingId(),
		created.GetRevision(),
	)
	assertAgentAuthorityInvalidation(
		t,
		events[1],
		domain.AgentAuthorityInvalidationBindingDelete,
		deleted.GetAgentId(),
		deleted.GetExpectedAgentVersion(),
		deleted.GetBindingId(),
		deleted.GetRevision(),
	)
}

func TestCapabilityManifestMutationsPublishCatalogInvalidationsOncePerAgent(t *testing.T) {
	service := newCapabilityAuthorityTestService(t, "manifest-events")
	eventBus := &recordingAgentEventBus{}
	service.SetEventBus(eventBus)
	ctx := context.Background()
	seedCapabilityAuthorityAgent(t, service.db, "agent-1", "ptid:person:owner", 3)
	seedCapabilityAuthorityAgent(t, service.db, "agent-2", "ptid:person:other", 5)

	manifest := capabilityAuthorityTestManifest()
	if _, err := service.RegisterManifest(ctx, manifest); err != nil {
		t.Fatalf("register manifest: %v", err)
	}
	if _, err := service.RegisterManifest(ctx, manifest); err != nil {
		t.Fatalf("replay manifest registration: %v", err)
	}
	retire := &model.RetireCapabilityManifestRequest{
		CapabilityId:   manifest.GetCapabilityId(),
		Version:        manifest.GetVersion(),
		IdempotencyKey: "retire-event",
		Reason:         "catalog retirement",
	}
	if _, err := service.RetireManifest(ctx, "ptid:person:owner", retire); err != nil {
		t.Fatalf("retire manifest: %v", err)
	}
	if _, err := service.RetireManifest(ctx, "ptid:person:owner", retire); err != nil {
		t.Fatalf("replay manifest retirement: %v", err)
	}

	events := eventBus.snapshot()
	if len(events) != 4 {
		t.Fatalf("manifest invalidation event count = %d, want 4", len(events))
	}
	for index, event := range events {
		payload, ok := event.Payload.(domain.AgentAuthorityInvalidation)
		if !ok {
			t.Fatalf("event %d payload type = %T", index, event.Payload)
		}
		expectedReason := domain.AgentAuthorityInvalidationManifestRegistered
		if index >= 2 {
			expectedReason = domain.AgentAuthorityInvalidationManifestRetired
		}
		if payload.Reason != expectedReason ||
			payload.CapabilityID != manifest.GetCapabilityId() ||
			payload.CapabilityVersion != manifest.GetVersion() {
			t.Fatalf("unexpected manifest invalidation %d: %+v", index, payload)
		}
		if event.Metadata["agent_id"] != payload.AgentID {
			t.Fatalf("event %d metadata does not target payload agent: %+v", index, event)
		}
	}
}

func TestCapabilityReadinessSnapshotIsImmutable(t *testing.T) {
	service := newCapabilityAuthorityTestService(t, "readiness")
	ctx := context.Background()
	now := time.Date(2026, time.August, 27, 12, 0, 0, 123456789, time.UTC)
	snapshot := &model.CapabilityReadinessSnapshot{
		SnapshotId: "readiness-1",
		Ptid:       "ptid:person:owner",
		AgentId:    "agent-1",
		CreatedAt:  timestamppb.New(now),
		ExpiresAt:  timestamppb.New(now.Add(time.Minute)),
	}
	stored, err := service.StoreReadinessSnapshot(ctx, snapshot)
	if err != nil {
		t.Fatalf("store readiness snapshot: %v", err)
	}
	expectedCreatedAt := now.Truncate(time.Microsecond)
	expectedExpiresAt := now.Add(time.Minute).Truncate(time.Microsecond)
	if !stored.GetCreatedAt().AsTime().Equal(expectedCreatedAt) ||
		!stored.GetExpiresAt().AsTime().Equal(expectedExpiresAt) {
		t.Fatalf(
			"readiness timestamps were not canonicalized: created=%s expires=%s",
			stored.GetCreatedAt().AsTime(),
			stored.GetExpiresAt().AsTime(),
		)
	}
	var record persistence.CapabilityReadinessSnapshot
	if err := service.db.Where("snapshot_id = ?", snapshot.GetSnapshotId()).
		First(&record).Error; err != nil {
		t.Fatalf("load readiness snapshot record: %v", err)
	}
	if !record.CreatedAt.Equal(expectedCreatedAt) ||
		!record.ExpiresAt.Equal(expectedExpiresAt) {
		t.Fatalf(
			"readiness record timestamps differ from payload: created=%s expires=%s",
			record.CreatedAt,
			record.ExpiresAt,
		)
	}
	if _, err := service.StoreReadinessSnapshot(ctx, snapshot); err != nil {
		t.Fatalf("replay readiness snapshot: %v", err)
	}
	conflicting := &model.CapabilityReadinessSnapshot{
		SnapshotId: "readiness-1",
		Ptid:       "ptid:person:other",
		AgentId:    "agent-1",
		CreatedAt:  timestamppb.New(now),
		ExpiresAt:  timestamppb.New(now.Add(time.Minute)),
	}
	if _, err := service.StoreReadinessSnapshot(
		ctx, conflicting,
	); !isCapabilityError(err, errcode.AgentIdempotencyConflict) {
		t.Fatalf("expected immutable snapshot conflict, got %v", err)
	}
}

func TestCapabilityBackfillReconcilesAllAcceptedSourcesDeterministically(t *testing.T) {
	service := newCapabilityAuthorityTestService(t, "backfill")
	ctx := context.Background()
	if err := service.db.AutoMigrate(
		&persistence.Skill{},
		&persistence.AgentSkillBinding{},
		&persistence.AgentKnowledgeBinding{},
		&persistence.AgentMcpBinding{},
		&persistence.ClientCapabilityLease{},
		&persistence.EcosystemCustomPlugin{},
	); err != nil {
		t.Fatalf("migrate backfill sources: %v", err)
	}
	seedCapabilityAuthorityAgent(t, service.db, "agent-1", "ptid:person:owner", 2)
	legacyConfig := `{
			"tools":["memory","missing_tool"],
			"skills":["research"],
			"mcpServers":["local-files"],
			"connectors":[{"connectorId":"github","enabledTools":["profile"]}],
			"knowledgeResources":"[{\"id\":\"knowledge-1\",\"type\":\"document\",\"title\":\"Reference\",\"source\":\"reference content\",\"policy\":\"manual\",\"status\":\"indexed\"},{\"id\":\"knowledge-url\",\"type\":\"url\",\"title\":\"Live URL\",\"source\":\"https://example.invalid/live\",\"policy\":\"auto\",\"status\":\"bound\"},{\"id\":\"knowledge-folder\",\"type\":\"folder\",\"title\":\"Local folder\",\"source\":\"/Users/example/private\",\"policy\":\"manual\",\"status\":\"bound\"}]"
		}`
	if err := service.db.Model(&persistence.Agent{}).
		Where("id = ?", "agent-1").
		Update("config_json", legacyConfig).Error; err != nil {
		t.Fatalf("seed agent config: %v", err)
	}
	if err := service.db.Create(&persistence.Skill{
		ID:          "skill-1",
		AgentID:     "agent-1",
		Name:        "research",
		Description: "Research skill",
		Content:     "# Research",
		TrustLevel:  "community",
		Enabled:     true,
		Version:     3,
	}).Error; err != nil {
		t.Fatalf("seed skill: %v", err)
	}
	if err := service.db.Create(&persistence.AgentSkillBinding{
		ID: "skill-binding-1", AgentID: "agent-1", SkillID: "skill-1", Enabled: true,
	}).Error; err != nil {
		t.Fatalf("seed skill binding: %v", err)
	}
	if err := service.db.Create(&persistence.AgentKnowledgeBinding{
		ID: "knowledge-binding-1", AgentID: "agent-1", ResourceID: "knowledge-1",
		Policy: "auto", Enabled: true,
	}).Error; err != nil {
		t.Fatalf("seed knowledge binding: %v", err)
	}
	legacyKnowledgeManifest := legacyManifestSeed(
		"knowledge_binding",
		"knowledge-binding-1",
		"knowledge:knowledge-1",
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_KNOWLEDGE,
		"knowledge-1",
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION,
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE,
	).manifest
	if _, err := service.RegisterManifest(ctx, legacyKnowledgeManifest); err != nil {
		t.Fatalf("seed legacy knowledge manifest: %v", err)
	}
	if _, err := upsertBackfillBinding(
		service.db,
		capabilityBindingSeed{
			source:            "knowledge_binding",
			sourceID:          "knowledge-binding-1",
			ptid:              "ptid:person:owner",
			agentID:           "agent-1",
			agentVersion:      2,
			capabilityID:      legacyKnowledgeManifest.GetCapabilityId(),
			capabilityVersion: legacyKnowledgeManifest.GetVersion(),
			enabled:           true,
			approvalPolicy:    model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		},
		service.now(),
	); err != nil {
		t.Fatalf("seed legacy knowledge authority binding: %v", err)
	}
	if err := service.db.Create(&persistence.AgentMcpBinding{
		ID: "mcp-binding-1", AgentID: "agent-1", ServerName: "local-files", Enabled: true,
	}).Error; err != nil {
		t.Fatalf("seed MCP binding: %v", err)
	}
	leasePayload, err := proto.Marshal(&model.ClientCapabilityLease{
		CapabilitySessionId: "session-1",
		Ptid:                "ptid:person:owner",
		DeviceId:            "device-1",
		Capabilities: []*model.ClientCapability{{
			CapabilityId:  "client.camera",
			SchemaVersion: "1",
			Permission:    model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_GRANTED,
		}},
	})
	if err != nil {
		t.Fatalf("encode client capability lease: %v", err)
	}
	if err := service.db.Create(&persistence.ClientCapabilityLease{
		SessionID: "session-1", ActorID: "ptid:person:owner", DeviceID: "device-1",
		AuthSessionID: "auth-1", ConnectionID: "connection-1", LeaseID: "lease-1",
		LeasePayload: leasePayload, ExpiresAt: time.Now().Add(time.Hour),
	}).Error; err != nil {
		t.Fatalf("seed client capability lease: %v", err)
	}
	if err := service.db.Create(&persistence.EcosystemCustomPlugin{
		ID: "plugin-1", Name: "Rejected", Endpoint: "https://example.invalid",
		OwnerActorPTID: "ptid:person:owner", Enabled: true,
	}).Error; err != nil {
		t.Fatalf("seed rejected plugin: %v", err)
	}

	registry := NewToolRegistryService(nil, nil)
	RegisterSessionSearchTool(registry, NewSessionSearchService())
	backfill := NewCapabilityBackfillService(service.db, registry)
	backfill.now = service.now
	first, err := backfill.Run(ctx)
	if err != nil {
		t.Fatalf("first backfill: %v", err)
	}
	second, err := backfill.Run(ctx)
	if err != nil {
		t.Fatalf("second backfill: %v", err)
	}
	third, err := backfill.Run(ctx)
	if err != nil {
		t.Fatalf("third backfill: %v", err)
	}
	if first.PayloadHash == second.PayloadHash || first.RunID == second.RunID {
		t.Fatalf("initial import was not distinguished from reconciliation")
	}
	if second.PayloadHash != third.PayloadHash || second.RunID != third.RunID {
		t.Fatalf("reconciliation evidence changed across replay: second=%+v third=%+v", second, third)
	}
	if len(first.KnowledgeMigrations) != 1 {
		t.Fatalf("knowledge migration lineage count = %d", len(first.KnowledgeMigrations))
	}
	knowledgeLineage := first.KnowledgeMigrations[0]
	if knowledgeLineage.SourceID == "" ||
		knowledgeLineage.ResourceID == "" ||
		knowledgeLineage.Revision != 1 ||
		knowledgeLineage.CapabilityID != knowledgeCapabilityID(knowledgeLineage.ResourceID) ||
		knowledgeLineage.CapabilityVersion != "1" ||
		knowledgeLineage.BindingID == "" ||
		knowledgeLineage.Outcome != "resolved" {
		t.Fatalf("knowledge migration lineage is incomplete: %+v", knowledgeLineage)
	}

	var runCount int64
	if err := service.db.Model(&persistence.CapabilityBackfillRun{}).
		Count(&runCount).Error; err != nil {
		t.Fatalf("count backfill reports: %v", err)
	}
	if runCount != 2 {
		t.Fatalf("expected import and reconciliation reports, got %d", runCount)
	}
	var bindingCount int64
	if err := service.db.Model(&persistence.AgentCapabilityBinding{}).
		Where(
			"ptid = ? AND agent_id = ? AND tombstoned_at IS NULL",
			"ptid:person:owner",
			"agent-1",
		).
		Count(&bindingCount).Error; err != nil {
		t.Fatalf("count capability bindings: %v", err)
	}
	if bindingCount != 5 {
		t.Fatalf("expected five deduplicated bindings, got %d", bindingCount)
	}
	assertCapabilityBackfillRejection(t, first, "custom_http_plugin", "source_kind_not_accepted")
	assertCapabilityBackfillRejection(t, first, "agent_config", "unknown_tool")
	assertCapabilityBackfillRejection(
		t, first, "knowledge_resource", "mutable_url_not_migratable",
	)
	assertCapabilityBackfillRejection(
		t, first, "knowledge_resource", "client_local_resource_not_migratable",
	)

	var pluginManifestCount int64
	if err := service.db.Model(&persistence.CapabilityManifest{}).
		Where("source_instance_id = ?", "plugin-1").
		Count(&pluginManifestCount).Error; err != nil {
		t.Fatalf("count plugin manifests: %v", err)
	}
	if pluginManifestCount != 0 {
		t.Fatalf("custom HTTP plugin was imported as a manifest")
	}
	var descriptor persistence.KnowledgeResourceRevision
	if err := service.db.Where(
		"ptid = ? AND title = ?",
		"ptid:person:owner",
		"Reference",
	).First(&descriptor).Error; err != nil {
		t.Fatalf("load migrated knowledge descriptor: %v", err)
	}
	if descriptor.StationContentRef == "" ||
		descriptor.ContentHash == "" ||
		descriptor.Availability != int32(
			model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_READY,
		) {
		t.Fatalf("migrated descriptor is incomplete: %+v", descriptor)
	}
	var knowledgeManifest persistence.CapabilityManifest
	if err := service.db.Where(
		"capability_id = ? AND version = ?",
		knowledgeCapabilityID(descriptor.ResourceID),
		"1",
	).First(&knowledgeManifest).Error; err != nil {
		t.Fatalf("load migrated knowledge manifest: %v", err)
	}
	if knowledgeManifest.OwnerPtid != "ptid:person:owner" {
		t.Fatalf("knowledge manifest owner = %q", knowledgeManifest.OwnerPtid)
	}
	var retainedLegacyBindingCount int64
	if err := service.db.Model(&persistence.AgentKnowledgeBinding{}).
		Where("id = ?", "knowledge-binding-1").
		Count(&retainedLegacyBindingCount).Error; err != nil {
		t.Fatalf("count retained legacy input: %v", err)
	}
	if retainedLegacyBindingCount != 1 {
		t.Fatalf("legacy migration input was deleted before K4/K5: %d", retainedLegacyBindingCount)
	}
	var storedAgent persistence.Agent
	if err := service.db.Where("id = ?", "agent-1").First(&storedAgent).Error; err != nil {
		t.Fatalf("reload Agent config: %v", err)
	}
	if storedAgent.ConfigJSON != legacyConfig {
		t.Fatal("backfill mutated read-only embedded Knowledge input")
	}
	var retiredLegacyManifest persistence.CapabilityManifest
	if err := service.db.Where(
		"capability_id = ? AND version = ?",
		"knowledge:knowledge-1",
		capabilityLegacyVersion,
	).First(&retiredLegacyManifest).Error; err != nil {
		t.Fatalf("load retired legacy knowledge manifest: %v", err)
	}
	if retiredLegacyManifest.RetiredAt == nil {
		t.Fatal("legacy Knowledge manifest remained active")
	}
	var activeLegacyBindingCount int64
	if err := service.db.Model(&persistence.AgentCapabilityBinding{}).
		Where(
			"agent_id = ? AND capability_id = ? AND tombstoned_at IS NULL",
			"agent-1",
			"knowledge:knowledge-1",
		).
		Count(&activeLegacyBindingCount).Error; err != nil {
		t.Fatalf("count active legacy Knowledge bindings: %v", err)
	}
	if activeLegacyBindingCount != 0 {
		t.Fatalf("legacy Knowledge binding remained active: %d", activeLegacyBindingCount)
	}
	reportPayload, err := json.Marshal(first)
	if err != nil {
		t.Fatalf("encode backfill report: %v", err)
	}
	if bytes.Contains(reportPayload, []byte("example.invalid")) ||
		bytes.Contains(reportPayload, []byte("/Users/example/private")) {
		t.Fatal("backfill report leaked a legacy Knowledge locator")
	}
}

func TestCapabilityBackfillKeepsKnowledgeResourcesActorScoped(t *testing.T) {
	service := newCapabilityAuthorityTestService(t, "backfill-knowledge-actors")
	if err := service.db.AutoMigrate(
		&persistence.Skill{},
		&persistence.AgentSkillBinding{},
		&persistence.AgentKnowledgeBinding{},
		&persistence.AgentMcpBinding{},
		&persistence.ClientCapabilityLease{},
		&persistence.EcosystemCustomPlugin{},
	); err != nil {
		t.Fatalf("migrate backfill sources: %v", err)
	}
	actors := []struct {
		agentID string
		ptid    string
		config  string
	}{
		{
			agentID: "agent-owner-a",
			ptid:    "ptid:person:owner-a",
			config: `{"knowledgeResources":[{"id":"shared","type":"document",` +
				`"title":"Shared A","source":"content a","policy":"auto","status":"indexed"}]}`,
		},
		{
			agentID: "agent-owner-b",
			ptid:    "ptid:person:owner-b",
			config: `{"knowledgeResources":"[{\"id\":\"shared\",\"type\":\"document\",` +
				`\"title\":\"Shared B\",\"source\":\"content b\",\"policy\":\"manual\",` +
				`\"status\":\"bound\"}]"}`,
		},
	}
	for _, actor := range actors {
		seedCapabilityAuthorityAgent(t, service.db, actor.agentID, actor.ptid, 1)
		if err := service.db.Model(&persistence.Agent{}).
			Where("id = ?", actor.agentID).
			Update("config_json", actor.config).Error; err != nil {
			t.Fatalf("seed %s config: %v", actor.agentID, err)
		}
	}

	backfill := NewCapabilityBackfillService(service.db, nil)
	backfill.now = service.now
	if _, err := backfill.Run(context.Background()); err != nil {
		t.Fatalf("run Knowledge backfill: %v", err)
	}

	var descriptors []persistence.KnowledgeResourceRevision
	if err := service.db.Order("ptid").Find(&descriptors).Error; err != nil {
		t.Fatalf("list migrated descriptors: %v", err)
	}
	if len(descriptors) != 2 ||
		descriptors[0].Ptid == descriptors[1].Ptid ||
		descriptors[0].ResourceID == descriptors[1].ResourceID {
		t.Fatalf("actor-scoped descriptors collapsed: %+v", descriptors)
	}
	for _, actor := range actors {
		manifests, err := service.ListManifests(
			context.Background(),
			actor.ptid,
			[]model.CapabilitySourceKind{
				model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_KNOWLEDGE,
			},
		)
		if err != nil {
			t.Fatalf("list %s manifests: %v", actor.ptid, err)
		}
		if len(manifests) != 1 || manifests[0].GetOwnerPtid() != actor.ptid {
			t.Fatalf("actor %s observed wrong manifests: %+v", actor.ptid, manifests)
		}
		var bindingCount int64
		if err := service.db.Model(&persistence.AgentCapabilityBinding{}).
			Where(
				"ptid = ? AND agent_id = ? AND tombstoned_at IS NULL",
				actor.ptid,
				actor.agentID,
			).
			Count(&bindingCount).Error; err != nil {
			t.Fatalf("count %s bindings: %v", actor.agentID, err)
		}
		if bindingCount != 1 {
			t.Fatalf("agent %s binding count = %d", actor.agentID, bindingCount)
		}
	}
}

func TestCapabilityBackfillKnowledgeSurvivesDatabaseRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "capability-backfill.db")
	openBackfillDB := func() *gorm.DB {
		db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
		if err != nil {
			t.Fatalf("open backfill database: %v", err)
		}
		if err := db.AutoMigrate(
			&persistence.Agent{},
			&persistence.CapabilityManifest{},
			&persistence.CapabilityManifestCommand{},
			&persistence.AgentCapabilityBinding{},
			&persistence.CapabilityBindingCommand{},
			&persistence.CapabilityReadinessSnapshot{},
			&persistence.CapabilityBackfillRun{},
			&persistence.KnowledgeResourceHead{},
			&persistence.KnowledgeResourceRevision{},
			&persistence.KnowledgeContentRevision{},
			&persistence.KnowledgeDescriptorCommand{},
			&persistence.Skill{},
			&persistence.AgentSkillBinding{},
			&persistence.AgentKnowledgeBinding{},
			&persistence.AgentMcpBinding{},
			&persistence.ClientCapabilityLease{},
			&persistence.EcosystemCustomPlugin{},
		); err != nil {
			t.Fatalf("migrate backfill database: %v", err)
		}
		return db
	}

	db := openBackfillDB()
	seedCapabilityAuthorityAgent(
		t,
		db,
		"agent-restart",
		"ptid:person:restart",
		1,
	)
	legacyConfig := `{"knowledgeResources":"[{\"id\":\"restart-resource\",` +
		`\"type\":\"document\",\"title\":\"Restart\",\"source\":\"durable content\",` +
		`\"policy\":\"auto\",\"status\":\"indexed\"}]"}`
	if err := db.Model(&persistence.Agent{}).
		Where("id = ?", "agent-restart").
		Update("config_json", legacyConfig).Error; err != nil {
		t.Fatalf("seed restart config: %v", err)
	}
	firstService := NewCapabilityBackfillService(db, nil)
	firstService.now = func() time.Time {
		return time.Date(2026, time.August, 28, 14, 0, 0, 0, time.UTC)
	}
	first, err := firstService.Run(context.Background())
	if err != nil {
		t.Fatalf("run backfill before restart: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("access backfill database: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close backfill database: %v", err)
	}

	restartedDB := openBackfillDB()
	restartedService := NewCapabilityBackfillService(restartedDB, nil)
	restartedService.now = firstService.now
	second, err := restartedService.Run(context.Background())
	if err != nil {
		t.Fatalf("run backfill after restart: %v", err)
	}
	third, err := restartedService.Run(context.Background())
	if err != nil {
		t.Fatalf("replay backfill after restart: %v", err)
	}
	if first.RunID == second.RunID || first.PayloadHash == second.PayloadHash {
		t.Fatalf("restart did not report reconciliation separately from import")
	}
	if second.RunID != third.RunID || second.PayloadHash != third.PayloadHash {
		t.Fatalf("restart reconciliation was not deterministic: second=%+v third=%+v", second, third)
	}
	var descriptorCount int64
	if err := restartedDB.Model(&persistence.KnowledgeResourceRevision{}).
		Where("ptid = ?", "ptid:person:restart").
		Count(&descriptorCount).Error; err != nil {
		t.Fatalf("count restarted descriptors: %v", err)
	}
	if descriptorCount != 1 {
		t.Fatalf("restart descriptor count = %d", descriptorCount)
	}
	var bindingCount int64
	if err := restartedDB.Model(&persistence.AgentCapabilityBinding{}).
		Where(
			"ptid = ? AND agent_id = ? AND tombstoned_at IS NULL",
			"ptid:person:restart",
			"agent-restart",
		).
		Count(&bindingCount).Error; err != nil {
		t.Fatalf("count restarted bindings: %v", err)
	}
	if bindingCount != 1 {
		t.Fatalf("restart binding count = %d", bindingCount)
	}
}

func TestCapabilityToolManifestSeedUsesCanonicalExecutionRequirements(t *testing.T) {
	builtin := capabilityToolManifestSeed(&domain.ToolDefinition{
		Name:        "skills_list",
		Description: "List available skills",
		JSONSchema:  json.RawMessage(`{"type":"object"}`),
	}).manifest
	if builtin.GetSourceKind() !=
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL ||
		len(builtin.GetRequiredRuntimeCapabilities()) != 1 ||
		builtin.GetRequiredRuntimeCapabilities()[0] != "native-tools" {
		t.Fatalf("builtin tool manifest must require native-tools: %+v", builtin)
	}

	fileRead := capabilityToolManifestSeed(&domain.ToolDefinition{
		Name:        "local_file_read",
		Description: "Read one local file",
		JSONSchema:  json.RawMessage(`{"type":"object"}`),
	}).manifest
	if fileRead.GetCapabilityId() != "filesystem.read" ||
		fileRead.GetVersion() != "1" ||
		fileRead.GetExecutionOwner() !=
			model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY ||
		len(fileRead.GetRequiredRuntimeCapabilities()) != 0 ||
		fileRead.GetAvailability() !=
			model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE {
		t.Fatalf("local tool manifest does not match executor protocol: %+v", fileRead)
	}

	mcp := capabilityToolManifestSeed(&domain.ToolDefinition{
		Name:        "local_mcp",
		Description: "Invoke local MCP",
		JSONSchema:  json.RawMessage(`{"type":"object"}`),
	}).manifest
	if mcp.GetCapabilityId() != "mcp.invoke" ||
		mcp.GetVersion() != "2" ||
		len(mcp.GetRequiredRuntimeCapabilities()) != 0 ||
		mcp.GetAvailability() !=
			model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE {
		t.Fatalf("MCP must be available after the J04 lifecycle cutover: %+v", mcp)
	}
}

func TestCapabilityBackfillKeepsKnownManifestAuthorityOverLegacyLeaseVersion(
	t *testing.T,
) {
	authority := newCapabilityAuthorityTestService(t, "known-manifest-lease-version")
	if err := authority.db.AutoMigrate(
		&persistence.Skill{},
		&persistence.AgentSkillBinding{},
		&persistence.AgentKnowledgeBinding{},
		&persistence.AgentMcpBinding{},
		&persistence.ClientCapabilityLease{},
		&persistence.EcosystemCustomPlugin{},
	); err != nil {
		t.Fatalf("migrate capability backfill sources: %v", err)
	}
	registry := NewToolRegistryService(nil, nil)
	definitions := registry.Definitions([]string{"local_mcp"})
	if len(definitions) != 1 {
		t.Fatalf("local_mcp definitions = %d, want 1", len(definitions))
	}
	current := capabilityToolManifestSeed(definitions[0]).manifest
	historical := proto.Clone(current).(*model.CapabilityManifest)
	historical.Version = "1"
	historical.Availability =
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_UNAVAILABLE
	if _, err := upsertBackfillManifest(
		authority.db,
		historical,
		authority.now(),
	); err != nil {
		t.Fatalf("seed historical MCP manifest: %v", err)
	}
	leasePayload := operationCapabilityLeasePayloadFor(
		t,
		current.GetCapabilityId(),
		historical.GetVersion(),
	)
	if err := authority.db.Create(&persistence.ClientCapabilityLease{
		SessionID:     "legacy-mcp-session",
		ActorID:       "ptid:person:owner",
		DeviceID:      "device-1",
		AuthSessionID: "auth-1",
		ConnectionID:  "connection-1",
		LeaseID:       "lease-1",
		LeasePayload:  leasePayload,
		ExpiresAt:     authority.now().Add(time.Hour),
	}).Error; err != nil {
		t.Fatalf("seed legacy MCP capability lease: %v", err)
	}

	backfill := NewCapabilityBackfillService(authority.db, registry)
	backfill.now = authority.now
	report, err := backfill.Run(context.Background())
	if err != nil {
		t.Fatalf("backfill known manifest with legacy lease version: %v", err)
	}
	for _, rejection := range report.Rejections {
		if rejection.Source == "client_capability" &&
			rejection.SourceID == "legacy-mcp-session:mcp.invoke" {
			t.Fatalf("known MCP advertisement became a manifest source: %+v", rejection)
		}
	}
	var manifestCount int64
	if err := authority.db.Model(&persistence.CapabilityManifest{}).
		Where("capability_id = ?", current.GetCapabilityId()).
		Count(&manifestCount).Error; err != nil {
		t.Fatalf("count MCP manifest versions: %v", err)
	}
	if manifestCount != 2 {
		t.Fatalf("MCP manifest version count = %d, want 2", manifestCount)
	}
}

func TestCapabilityBackfillKeepsPersistedConnectorManifestAuthority(
	t *testing.T,
) {
	authority := newCapabilityAuthorityTestService(t, "persisted-connector-manifest")
	if err := authority.db.AutoMigrate(
		&persistence.Skill{},
		&persistence.AgentSkillBinding{},
		&persistence.AgentKnowledgeBinding{},
		&persistence.AgentMcpBinding{},
		&persistence.ClientCapabilityLease{},
		&persistence.EcosystemCustomPlugin{},
	); err != nil {
		t.Fatalf("migrate capability backfill sources: %v", err)
	}
	manifest := capabilityAuthorityTestManifest()
	manifest.CapabilityId = "connector.resource.persisted"
	manifest.Version = "connector-version-1"
	manifest.SourceKind =
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CONNECTOR
	manifest.SourceInstanceId = "connector_resource_persisted"
	manifest.ExecutionOwner =
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY
	manifest.RiskClass = "connector"
	manifest.SecretBoundary = "oauth-owner"
	manifest.OwnerPtid = "ptid:person:owner"
	_, err := authority.RegisterManifest(
		context.Background(),
		manifest,
	)
	if err != nil {
		t.Fatalf("register Connector manifest: %v", err)
	}
	leasePayload := operationCapabilityLeasePayloadFor(
		t,
		manifest.GetCapabilityId(),
		manifest.GetVersion(),
	)
	if err := authority.db.Create(&persistence.ClientCapabilityLease{
		SessionID:     "connector-session",
		ActorID:       "ptid:person:owner",
		DeviceID:      "device-1",
		AuthSessionID: "auth-1",
		ConnectionID:  "connection-1",
		LeaseID:       "lease-1",
		LeasePayload:  leasePayload,
		ExpiresAt:     authority.now().Add(time.Hour),
	}).Error; err != nil {
		t.Fatalf("seed Connector capability lease: %v", err)
	}

	backfill := NewCapabilityBackfillService(authority.db, nil)
	backfill.now = authority.now
	if _, err := backfill.Run(context.Background()); err != nil {
		t.Fatalf("backfill persisted Connector manifest: %v", err)
	}

	var persisted persistence.CapabilityManifest
	if err := authority.db.Where(
		"capability_id = ? AND version = ?",
		manifest.GetCapabilityId(),
		manifest.GetVersion(),
	).First(&persisted).Error; err != nil {
		t.Fatalf("load persisted Connector manifest: %v", err)
	}
	if persisted.SourceKind != int32(model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CONNECTOR) ||
		persisted.SourceInstanceID != manifest.GetSourceInstanceId() ||
		persisted.RiskClass != "connector" ||
		persisted.SecretBoundary != "oauth-owner" {
		t.Fatalf("persisted Connector authority changed: %+v", persisted)
	}
}

func TestCapabilityBackfillRebindsBuiltinToolToNewManifestVersion(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "builtin-tool-manifest-upgrade")
	seedCapabilityAuthorityAgent(
		t,
		authority.db,
		"agent-1",
		"ptid:person:owner",
		1,
	)
	definition := &domain.ToolDefinition{
		Name:        "skills_list",
		Description: "List available skills",
		JSONSchema:  json.RawMessage(`{"type":"object"}`),
	}
	current := capabilityToolManifestSeed(definition).manifest
	previous := proto.Clone(current).(*model.CapabilityManifest)
	previous.Version = shortCapabilityHash(
		definition.Name,
		definition.Description,
		string(definition.JSONSchema),
		strconv.Itoa(
			int(model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL),
		),
	)
	previous.RequiredRuntimeCapabilities = nil
	if previous.GetVersion() == current.GetVersion() {
		t.Fatal("runtime requirement did not advance the builtin manifest version")
	}
	if _, err := upsertBackfillManifest(
		authority.db,
		previous,
		authority.now(),
	); err != nil {
		t.Fatalf("seed previous builtin manifest: %v", err)
	}
	binding := capabilityBindingSeed{
		source:            "agent_config",
		sourceID:          "agent-1:tool:skills_list",
		ptid:              "ptid:person:owner",
		agentID:           "agent-1",
		agentVersion:      1,
		capabilityID:      current.GetCapabilityId(),
		capabilityVersion: previous.GetVersion(),
		enabled:           true,
		approvalPolicy:    current.GetDefaultApprovalPolicy(),
		reconcileVersion:  true,
	}
	if _, err := upsertBackfillBinding(
		authority.db,
		binding,
		authority.now(),
	); err != nil {
		t.Fatalf("seed previous builtin binding: %v", err)
	}
	if _, err := upsertBackfillManifest(
		authority.db,
		current,
		authority.now(),
	); err != nil {
		t.Fatalf("persist current builtin manifest: %v", err)
	}
	binding.capabilityVersion = current.GetVersion()
	if _, err := upsertBackfillBinding(
		authority.db,
		binding,
		authority.now(),
	); err != nil {
		t.Fatalf("reconcile builtin binding version: %v", err)
	}

	var reloaded persistence.AgentCapabilityBinding
	if err := authority.db.First(
		&reloaded,
		"ptid = ? AND agent_id = ? AND capability_id = ?",
		binding.ptid,
		binding.agentID,
		binding.capabilityID,
	).Error; err != nil {
		t.Fatalf("load reconciled builtin binding: %v", err)
	}
	if reloaded.CapabilityVersion != current.GetVersion() ||
		reloaded.Revision != 2 ||
		!reloaded.Enabled ||
		reloaded.ApprovalPolicy != int32(current.GetDefaultApprovalPolicy()) {
		t.Fatalf("reconciled builtin binding = %+v", reloaded)
	}
	var manifestCount int64
	if err := authority.db.Model(&persistence.CapabilityManifest{}).
		Where("capability_id = ?", current.GetCapabilityId()).
		Count(&manifestCount).Error; err != nil {
		t.Fatalf("count builtin manifest versions: %v", err)
	}
	if manifestCount != 2 {
		t.Fatalf("builtin manifest version count = %d, want 2", manifestCount)
	}
}

func TestCapabilityReadinessAdmissionError(t *testing.T) {
	tests := []struct {
		name       string
		state      model.CapabilityReadinessState
		reasonCode string
		wantError  bool
	}{
		{
			name:       "ready",
			state:      model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
			reasonCode: "capability_ready",
		},
		{
			name:       "disabled binding",
			state:      model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			reasonCode: bindingDisabledReasonCode,
		},
		{
			name:       "degraded manifest",
			state:      model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_DEGRADED,
			reasonCode: manifestDegradedReasonCode,
		},
		{
			name:       "stale binding",
			state:      model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			reasonCode: "binding_agent_revision_stale",
			wantError:  true,
		},
		{
			name:       "missing manifest",
			state:      model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNKNOWN,
			reasonCode: "manifest_missing",
			wantError:  true,
		},
		{
			name:       "retired manifest",
			state:      model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			reasonCode: "manifest_retired",
			wantError:  true,
		},
		{
			name:       "client session required",
			state:      model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
			reasonCode: "client_session_required",
			wantError:  true,
		},
		{
			name:       "client capability unavailable",
			state:      model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
			reasonCode: "client_capability_unavailable",
			wantError:  true,
		},
		{
			name:       "runtime capability unavailable",
			state:      model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
			reasonCode: runtimeCapabilityUnavailableReasonCode,
			wantError:  true,
		},
		{
			name:       "unspecified readiness",
			state:      model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNSPECIFIED,
			reasonCode: "manifest_availability_unknown",
			wantError:  true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := capabilityReadinessAdmissionError(
				&model.CapabilityReadinessSnapshot{
					Capabilities: []*model.CapabilityReadiness{{
						CapabilityId: "tool:skills_list",
						State:        test.state,
						ReasonCode:   test.reasonCode,
					}},
				},
			)
			if !test.wantError {
				if err != nil {
					t.Fatalf("admitted readiness returned error: %v", err)
				}
				return
			}

			var bizErr *errcode.BizError
			if !errors.As(err, &bizErr) {
				t.Fatalf("readiness admission error = %T: %v", err, err)
			}
			if bizErr.Code != errcode.AgentRuntimeIncompatibleCapability ||
				bizErr.Payload == nil ||
				bizErr.Payload.GetError() != errcode.AgentRuntimeIncompatibleCapabilityLocaleKey ||
				bizErr.Payload.GetErrorType() != string(errcode.AgentRuntimeIncompatibleCapability) ||
				bizErr.Payload.GetLocaleKey() != errcode.AgentRuntimeIncompatibleCapabilityLocaleKey ||
				bizErr.Payload.GetRetryable() ||
				!bizErr.Payload.GetTerminal() ||
				len(bizErr.Payload.GetDetails()) != 2 ||
				bizErr.Payload.GetDetails()["capability_id"] != "tool:skills_list" ||
				bizErr.Payload.GetDetails()["reason_code"] != test.reasonCode {
				t.Fatalf("runtime incompatibility payload = %+v", bizErr)
			}
		})
	}
}

func TestCapabilityAuthorityReadinessCombinesBindingRuntimeAndClientFacts(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "authority-readiness")
	ctx := context.Background()
	seedCapabilityAuthorityAgent(t, authority.db, "agent-1", "ptid:person:owner", 2)

	stationManifest := capabilityAuthorityTestManifest()
	stationManifest.RequiredRuntimeCapabilities = []string{"runtime.tools"}
	if _, err := authority.RegisterManifest(ctx, stationManifest); err != nil {
		t.Fatalf("register station manifest: %v", err)
	}
	clientManifest := capabilityAuthorityTestManifest()
	clientManifest.CapabilityId = "client.camera"
	clientManifest.SourceInstanceId = "client.camera"
	clientManifest.SourceKind = model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CLIENT_NATIVE
	clientManifest.ExecutionOwner = model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY
	clientManifest.DefaultApprovalPolicy =
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL
	if _, err := authority.RegisterManifest(ctx, clientManifest); err != nil {
		t.Fatalf("register client manifest: %v", err)
	}
	if _, err := authority.UpsertBinding(
		ctx,
		"ptid:person:owner",
		capabilityReadinessBindingRequest(stationManifest, 2, "station-binding"),
	); err != nil {
		t.Fatalf("bind station capability: %v", err)
	}
	if _, err := authority.UpsertBinding(
		ctx,
		"ptid:person:owner",
		capabilityReadinessBindingRequest(clientManifest, 2, "client-binding"),
	); err != nil {
		t.Fatalf("bind client capability: %v", err)
	}

	runtimeCapabilities := &model.RuntimeCapabilitySnapshot{
		Resolution: []*model.RuntimeCapability{{
			CapabilityId: "runtime.tools",
			Resolution:   model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE,
		}},
	}
	withoutClient, err := authority.ResolveReadiness(
		ctx,
		"ptid:person:owner",
		"agent-1",
		2,
		"runtime-1",
		runtimeCapabilities,
		nil,
		authority.now(),
	)
	if err != nil {
		t.Fatalf("resolve without client: %v", err)
	}
	assertCapabilityReadiness(
		t, withoutClient, stationManifest.GetCapabilityId(),
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		"capability_ready",
	)
	assertCapabilityReadiness(
		t, withoutClient, clientManifest.GetCapabilityId(),
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
		"client_session_required",
	)

	withClient, err := authority.ResolveReadiness(
		ctx,
		"ptid:person:owner",
		"agent-1",
		2,
		"runtime-1",
		runtimeCapabilities,
		&model.ClientCapabilitySession{
			SessionId:     "session-1",
			ConnectionId:  "connection-1",
			LeaseRevision: 3,
			TypedCapabilities: []*model.ClientCapability{{
				CapabilityId:  "client.camera",
				SchemaVersion: "1",
				Permission:    model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_GRANTED,
			}},
		},
		authority.now().Add(time.Second),
	)
	if err != nil {
		t.Fatalf("resolve with client: %v", err)
	}
	assertCapabilityReadiness(
		t, withClient, clientManifest.GetCapabilityId(),
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		"capability_ready",
	)
	if withClient.GetSelectedClientSessionId() != "session-1" ||
		len(withClient.GetConnectionRevisions()) != 1 {
		t.Fatalf("client session lineage missing: %+v", withClient)
	}
}

func TestCapabilityAuthorityReadinessFailsClosedForStaleBinding(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "authority-stale-binding")
	ctx := context.Background()
	seedCapabilityAuthorityAgent(t, authority.db, "agent-1", "ptid:person:owner", 2)
	manifest := capabilityAuthorityTestManifest()
	if _, err := authority.RegisterManifest(ctx, manifest); err != nil {
		t.Fatalf("register manifest: %v", err)
	}
	if err := authority.db.Create(&persistence.AgentCapabilityBinding{
		BindingID: "binding-stale", Ptid: "ptid:person:owner", AgentID: "agent-1",
		CapabilityID: manifest.GetCapabilityId(), CapabilityVersion: manifest.GetVersion(),
		Enabled: true, ApprovalPolicy: int32(manifest.GetDefaultApprovalPolicy()),
		AgentVersion: 1, Revision: 1, UpdatedAt: authority.now(),
	}).Error; err != nil {
		t.Fatalf("seed stale binding: %v", err)
	}
	snapshot, err := authority.ResolveReadiness(
		ctx,
		"ptid:person:owner",
		"agent-1",
		2,
		"runtime-1",
		&model.RuntimeCapabilitySnapshot{},
		nil,
		authority.now(),
	)
	if err != nil {
		t.Fatalf("resolve stale binding: %v", err)
	}
	assertCapabilityReadiness(
		t, snapshot, manifest.GetCapabilityId(),
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
		"binding_agent_revision_stale",
	)
}

func TestCapabilityOperationStartAndCancelAreAtomicAndIdempotent(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "capability-operation")
	ctx := context.Background()
	if err := authority.db.AutoMigrate(
		&persistence.ClientCapabilityLease{},
		&persistence.CapabilityOperation{},
		&persistence.CapabilityOperationCommand{},
		&persistence.CapabilityOperationEvent{},
		&persistence.CapabilityOperationEventRejection{},
		&persistence.CapabilityOperationOutbox{},
		&persistence.CapabilityOperationLease{},
		&persistence.CapabilityCleanupLease{},
	); err != nil {
		t.Fatalf("migrate operation substrate: %v", err)
	}
	manifest := capabilityAuthorityTestManifest()
	manifest.ExecutionOwner = model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY
	if _, err := authority.RegisterManifest(ctx, manifest); err != nil {
		t.Fatalf("register operation manifest: %v", err)
	}
	now := authority.now()
	if err := authority.db.Create(&persistence.ClientCapabilityLease{
		SessionID: "session-1", ActorID: "ptid:person:owner", AuthSessionID: "auth-1",
		DeviceID: "device-1", ConnectionID: "connection-1", LeaseID: "capability-lease-1",
		LeaseRevision: 1, LeasePayload: operationCapabilityLeasePayload(t), ExpiresAt: now.Add(time.Minute),
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed capability lease: %v", err)
	}
	operations := NewCapabilityOperationService(authority.db)
	operations.now = authority.now
	start := &model.StartCapabilityOperationRequest{
		CapabilityId:        manifest.GetCapabilityId(),
		CapabilityVersion:   manifest.GetVersion(),
		OperationKind:       "test",
		TargetDeviceId:      "device-1",
		CapabilitySessionId: "session-1",
		BoundedArguments:    []byte(`{"probe":true}`),
		IdempotencyKey:      "operation-start-1",
		Deadline:            timestamppb.New(now.Add(time.Minute)),
	}
	created, err := operations.Start(ctx, "ptid:person:owner", start)
	if err != nil {
		t.Fatalf("start operation: %v", err)
	}
	if created.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISPATCHED ||
		created.GetAttemptEpoch() != 1 || created.GetFencingToken() != 1 {
		t.Fatalf("unexpected created operation: %+v", created)
	}
	replayed, err := operations.Start(ctx, "ptid:person:owner", start)
	if err != nil {
		t.Fatalf("replay operation start: %v", err)
	}
	if replayed.GetOperationId() != created.GetOperationId() {
		t.Fatalf("operation replay changed identity")
	}
	assertCapabilityOperationRowCount(
		t, authority.db, &persistence.CapabilityOperation{}, 1,
	)
	assertCapabilityOperationRowCount(
		t, authority.db, &persistence.CapabilityOperationOutbox{}, 1,
	)
	assertCapabilityOperationRowCount(
		t, authority.db, &persistence.CapabilityOperationLease{}, 1,
	)

	cancel := &model.CancelCapabilityOperationRequest{
		OperationId:      created.GetOperationId(),
		ExpectedRevision: 1,
		IdempotencyKey:   "operation-cancel-1",
	}
	cancelled, err := operations.Cancel(ctx, "ptid:person:owner", cancel)
	if err != nil {
		t.Fatalf("cancel operation: %v", err)
	}
	if cancelled.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP ||
		cancelled.GetDesiredTerminalOutcome() !=
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CANCELLED ||
		cancelled.GetCleanupLeaseId() == "" {
		t.Fatalf("operation did not enter cleanup settlement: %+v", cancelled)
	}
	replayedCancel, err := operations.Cancel(ctx, "ptid:person:owner", cancel)
	if err != nil {
		t.Fatalf("replay operation cancel: %v", err)
	}
	if replayedCancel.GetRevision() != cancelled.GetRevision() {
		t.Fatalf("cancel replay changed revision")
	}
	assertCapabilityOperationRowCount(
		t, authority.db, &persistence.CapabilityCleanupLease{}, 1,
	)
}

func TestCapabilityOperationRejectsActorAndRevisionMismatch(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "capability-operation-reject")
	if err := authority.db.AutoMigrate(
		&persistence.ClientCapabilityLease{},
		&persistence.CapabilityOperation{},
		&persistence.CapabilityOperationCommand{},
		&persistence.CapabilityOperationEvent{},
		&persistence.CapabilityOperationEventRejection{},
		&persistence.CapabilityOperationOutbox{},
		&persistence.CapabilityOperationLease{},
		&persistence.CapabilityCleanupLease{},
	); err != nil {
		t.Fatalf("migrate operation substrate: %v", err)
	}
	ctx := context.Background()
	manifest := capabilityAuthorityTestManifest()
	if _, err := authority.RegisterManifest(ctx, manifest); err != nil {
		t.Fatalf("register manifest: %v", err)
	}
	now := authority.now()
	if err := authority.db.Create(&persistence.ClientCapabilityLease{
		SessionID: "session-1", ActorID: "ptid:person:owner", AuthSessionID: "auth-1",
		DeviceID: "device-1", ConnectionID: "connection-1", LeaseID: "lease-1",
		LeaseRevision: 1, LeasePayload: operationCapabilityLeasePayload(t), ExpiresAt: now.Add(time.Minute),
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed lease: %v", err)
	}
	operations := NewCapabilityOperationService(authority.db)
	operations.now = authority.now
	start := &model.StartCapabilityOperationRequest{
		CapabilityId: manifest.GetCapabilityId(), CapabilityVersion: manifest.GetVersion(),
		OperationKind: "test", TargetDeviceId: "device-1",
		CapabilitySessionId: "session-1", IdempotencyKey: "start-1",
		Deadline: timestamppb.New(now.Add(time.Minute)),
	}
	if _, err := operations.Start(
		ctx, "ptid:person:other", start,
	); !isCapabilityError(err, errcode.AgentNotFound) {
		t.Fatalf("expected actor-scoped lease rejection, got %v", err)
	}
	created, err := operations.Start(ctx, "ptid:person:owner", start)
	if err != nil {
		t.Fatalf("start operation: %v", err)
	}
	_, err = operations.Cancel(ctx, "ptid:person:owner", &model.CancelCapabilityOperationRequest{
		OperationId: created.GetOperationId(), ExpectedRevision: 9,
		IdempotencyKey: "cancel-stale",
	})
	if !isCapabilityError(err, errcode.AgentVersionConflict) {
		t.Fatalf("expected stale revision conflict, got %v", err)
	}
}

func TestCapabilityOperationEventSequenceAndCleanupSettlement(t *testing.T) {
	operations, db, created, now := newCapabilityOperationTestFixture(t, "operation-events")
	ctx := context.Background()
	runningRequest := capabilityOperationEventRequest(
		created, 1,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RUNNING,
	)
	running, replayed, err := operations.ReportEvent(
		ctx, "ptid:person:owner", runningRequest,
	)
	if err != nil || replayed {
		t.Fatalf("report running event: replayed=%v err=%v", replayed, err)
	}
	if running.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RUNNING {
		t.Fatalf("operation did not enter running: %+v", running)
	}
	_, replayed, err = operations.ReportEvent(ctx, "ptid:person:owner", runningRequest)
	if err != nil || !replayed {
		t.Fatalf("identical event did not replay: replayed=%v err=%v", replayed, err)
	}

	stale := capabilityOperationEventRequest(
		created, 2,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SUCCEEDED,
	)
	stale.Event.FencingToken = 9
	if _, _, err := operations.ReportEvent(
		ctx, "ptid:person:owner", stale,
	); !isCapabilityError(err, errcode.AgentVersionConflict) {
		t.Fatalf("expected stale fence rejection, got %v", err)
	}
	assertCapabilityOperationRowCount(
		t, db, &persistence.CapabilityOperationEventRejection{}, 1,
	)

	succeededRequest := capabilityOperationEventRequest(
		created, 2,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SUCCEEDED,
	)
	settling, _, err := operations.ReportEvent(
		ctx, "ptid:person:owner", succeededRequest,
	)
	if err != nil {
		t.Fatalf("report terminal intent: %v", err)
	}
	if settling.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP {
		t.Fatalf("terminal intent bypassed cleanup: %+v", settling)
	}
	cleanup := capabilityOperationEventRequest(
		created, 3,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SUCCEEDED,
	)
	cleanup.CleanupLeaseId = settling.GetCleanupLeaseId()
	cleanup.CleanupEpoch = settling.GetCleanupEpoch()
	cleanup.CleanupFencingToken = settling.GetCleanupFencingToken()
	cleanup.CleanupOutcome = "clean"
	terminal, _, err := operations.ReportEvent(ctx, "ptid:person:owner", cleanup)
	if err != nil {
		t.Fatalf("settle cleanup: %v", err)
	}
	if terminal.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SUCCEEDED ||
		terminal.GetTerminalAt() == nil {
		t.Fatalf("cleanup did not commit terminal result: %+v", terminal)
	}
	reconciled, err := operations.Reconcile(
		ctx,
		"ptid:person:owner",
		&model.ReconcileCapabilityOperationRequest{OperationId: created.GetOperationId()},
	)
	if err != nil {
		t.Fatalf("reconcile events: %v", err)
	}
	if len(reconciled.GetEvents()) != 3 {
		t.Fatalf("event count = %d, want 3", len(reconciled.GetEvents()))
	}
	assertCapabilityOperationRowCount(t, db, &persistence.CapabilityCleanupLease{}, 1)
	_ = now
}

func TestCapabilityOperationTakeoverIncrementsIndependentFences(t *testing.T) {
	operations, db, created, now := newCapabilityOperationTestFixture(t, "operation-takeover")
	ctx := context.Background()
	if err := db.Create(&persistence.ClientCapabilityLease{
		SessionID: "session-2", ActorID: "ptid:person:owner", AuthSessionID: "auth-2",
		DeviceID: "device-2", ConnectionID: "connection-2", LeaseID: "capability-lease-2",
		LeaseRevision: 1, LeasePayload: operationCapabilityLeasePayload(t), ExpiresAt: now.Add(5 * time.Minute),
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed takeover capability lease: %v", err)
	}
	operations.now = func() time.Time { return now.Add(defaultOperationLeaseTTL + time.Second) }
	taken, err := operations.TakeOver(
		ctx,
		"ptid:person:owner",
		&model.TakeOverCapabilityOperationRequest{
			OperationId: created.GetOperationId(), ExpectedRevision: created.GetRevision(),
			TargetDeviceId: "device-2", CapabilitySessionId: "session-2",
		},
	)
	if err != nil {
		t.Fatalf("take over operation: %v", err)
	}
	if taken.GetAttemptEpoch() != 2 || taken.GetFencingToken() != 2 ||
		taken.GetTargetDeviceId() != "device-2" {
		t.Fatalf("business takeover did not advance fence: %+v", taken)
	}
	oldEvent := capabilityOperationEventRequest(
		created, 1,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RUNNING,
	)
	if _, _, err := operations.ReportEvent(
		ctx, "ptid:person:owner", oldEvent,
	); !isCapabilityError(err, errcode.AgentVersionConflict) {
		t.Fatalf("old business fence was accepted: %v", err)
	}
}

func TestCapabilityOperationTakeoverRequiresCompatibleCapabilityLease(t *testing.T) {
	operations, db, created, now := newCapabilityOperationTestFixture(
		t,
		"operation-takeover-capability",
	)
	if err := db.Create(&persistence.ClientCapabilityLease{
		SessionID: "session-2", ActorID: "ptid:person:owner", AuthSessionID: "auth-2",
		DeviceID: "device-2", ConnectionID: "connection-2", LeaseID: "capability-lease-2",
		LeaseRevision: 1,
		LeasePayload: operationCapabilityLeasePayloadFor(
			t,
			"clipboard.read",
			"1",
		),
		ExpiresAt: now.Add(5 * time.Minute), CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed incompatible takeover capability lease: %v", err)
	}
	operations.now = func() time.Time {
		return now.Add(defaultOperationLeaseTTL + time.Second)
	}

	_, err := operations.TakeOver(
		context.Background(),
		"ptid:person:owner",
		&model.TakeOverCapabilityOperationRequest{
			OperationId: created.GetOperationId(), ExpectedRevision: created.GetRevision(),
			TargetDeviceId: "device-2", CapabilitySessionId: "session-2",
		},
	)
	if !isCapabilityError(err, errcode.AgentInvalidSourceState) {
		t.Fatalf("expected incompatible capability lease rejection, got %v", err)
	}
}

func TestCapabilityOperationTakeoverDoesNotTrustCallerIdempotencyAfterSideEffect(t *testing.T) {
	operations, db, created, now := newCapabilityOperationTestFixture(
		t,
		"operation-takeover-side-effect",
	)
	running, _, err := operations.ReportEvent(
		context.Background(),
		"ptid:person:owner",
		capabilityOperationEventRequest(
			created,
			1,
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RUNNING,
		),
	)
	if err != nil {
		t.Fatalf("report running operation: %v", err)
	}
	if err := db.Create(&persistence.ClientCapabilityLease{
		SessionID: "session-2", ActorID: "ptid:person:owner", AuthSessionID: "auth-2",
		DeviceID: "device-2", ConnectionID: "connection-2", LeaseID: "capability-lease-2",
		LeaseRevision: 1, LeasePayload: operationCapabilityLeasePayload(t),
		ExpiresAt: now.Add(5 * time.Minute), CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed takeover capability lease: %v", err)
	}
	operations.now = func() time.Time {
		return now.Add(defaultOperationLeaseTTL + time.Second)
	}

	taken, err := operations.TakeOver(
		context.Background(),
		"ptid:person:owner",
		&model.TakeOverCapabilityOperationRequest{
			OperationId: created.GetOperationId(), ExpectedRevision: running.GetRevision(),
			TargetDeviceId: "device-2", CapabilitySessionId: "session-2",
			ExternalIdempotencyKey: "caller-asserted-key",
		},
	)
	if err != nil {
		t.Fatalf("fence ambiguous operation: %v", err)
	}
	if taken.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP ||
		taken.GetDesiredTerminalOutcome() !=
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_UNKNOWN_SIDE_EFFECT {
		t.Fatalf("caller idempotency bypassed unknown-side-effect fencing: %+v", taken)
	}
}

func TestCapabilityOperationLeaseExpiryProjectsDisconnectedBeforeDeadline(t *testing.T) {
	operations, db, created, now := newCapabilityOperationTestFixture(
		t,
		"operation-lease-disconnect",
	)
	if err := db.Create(&persistence.ClientCapabilityLease{
		SessionID: "session-2", ActorID: "ptid:person:owner", AuthSessionID: "auth-2",
		DeviceID: "device-2", ConnectionID: "connection-2", LeaseID: "capability-lease-2",
		LeaseRevision: 1, LeasePayload: operationCapabilityLeasePayload(t),
		ExpiresAt: now.Add(5 * time.Minute), CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed takeover capability lease: %v", err)
	}
	operations.now = func() time.Time {
		return now.Add(defaultOperationLeaseTTL + time.Second)
	}

	count, err := operations.SweepExecutorLeaseDisconnects(context.Background())
	if err != nil {
		t.Fatalf("sweep disconnected operation lease: %v", err)
	}
	if count != 1 {
		t.Fatalf("disconnected operations = %d, want 1", count)
	}
	projected, err := operations.Get(
		context.Background(),
		"ptid:person:owner",
		created.GetOperationId(),
	)
	if err != nil {
		t.Fatalf("read disconnected operation: %v", err)
	}
	if projected.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISCONNECTED ||
		projected.GetError().GetCode() !=
			model.CapabilityOperationErrorCode_CAPABILITY_OPERATION_ERROR_CODE_DISCONNECTED ||
		!projected.GetError().GetRetryable() {
		t.Fatalf("unexpected disconnected operation projection: %+v", projected)
	}
	taken, err := operations.TakeOver(
		context.Background(),
		"ptid:person:owner",
		&model.TakeOverCapabilityOperationRequest{
			OperationId: created.GetOperationId(), ExpectedRevision: projected.GetRevision(),
			TargetDeviceId: "device-2", CapabilitySessionId: "session-2",
		},
	)
	if err != nil {
		t.Fatalf("take over disconnected operation: %v", err)
	}
	if taken.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISPATCHED ||
		taken.GetError() != nil || taken.GetProgressPercent() != 0 ||
		taken.GetResultRef() != "" {
		t.Fatalf("takeover retained stale terminal projection: %+v", taken)
	}
}

func TestCapabilityCleanupTakeoverAndDeadlineSweep(t *testing.T) {
	operations, db, created, now := newCapabilityOperationTestFixture(t, "cleanup-takeover")
	ctx := context.Background()
	cancelled, err := operations.Cancel(
		ctx,
		"ptid:person:owner",
		&model.CancelCapabilityOperationRequest{
			OperationId: created.GetOperationId(), ExpectedRevision: created.GetRevision(),
			IdempotencyKey: "cancel-1",
		},
	)
	if err != nil {
		t.Fatalf("cancel operation: %v", err)
	}
	expiredAt := now.Add(-time.Second)
	if err := db.Model(&persistence.CapabilityCleanupLease{}).
		Where("lease_id = ?", cancelled.GetCleanupLeaseId()).
		Update("expires_at", expiredAt).Error; err != nil {
		t.Fatalf("expire cleanup lease: %v", err)
	}
	operations.now = func() time.Time { return now.Add(time.Second) }
	taken, err := operations.TakeOverCleanup(
		ctx,
		"ptid:person:owner",
		&model.TakeOverCapabilityCleanupRequest{
			OperationId: created.GetOperationId(), ExpectedCleanupEpoch: 1,
			TargetDeviceId: "device-1", CapabilitySessionId: "session-1",
		},
	)
	if err != nil {
		t.Fatalf("take over cleanup: %v", err)
	}
	if taken.GetCleanupEpoch() != 2 || taken.GetCleanupFencingToken() != 2 ||
		taken.GetCleanupLeaseId() == cancelled.GetCleanupLeaseId() {
		t.Fatalf("cleanup takeover did not advance independent fence: %+v", taken)
	}
	oldCleanup := capabilityOperationEventRequest(
		created, 1,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CANCELLED,
	)
	oldCleanup.CleanupLeaseId = cancelled.GetCleanupLeaseId()
	oldCleanup.CleanupEpoch = cancelled.GetCleanupEpoch()
	oldCleanup.CleanupFencingToken = cancelled.GetCleanupFencingToken()
	oldCleanup.CleanupOutcome = "clean"
	if _, _, err := operations.ReportEvent(
		ctx, "ptid:person:owner", oldCleanup,
	); !isCapabilityError(err, errcode.AgentVersionConflict) {
		t.Fatalf("old cleanup fence was accepted: %v", err)
	}
	cleanup := capabilityOperationEventRequest(
		created, 1,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CANCELLED,
	)
	cleanup.CleanupLeaseId = taken.GetCleanupLeaseId()
	cleanup.CleanupEpoch = taken.GetCleanupEpoch()
	cleanup.CleanupFencingToken = taken.GetCleanupFencingToken()
	cleanup.CleanupOutcome = "clean"
	terminal, _, err := operations.ReportEvent(ctx, "ptid:person:owner", cleanup)
	if err != nil {
		t.Fatalf("settle takeover cleanup: %v", err)
	}
	if terminal.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CANCELLED {
		t.Fatalf("cleanup takeover terminal status: %+v", terminal)
	}

	sweepOps, _, sweepCreated, sweepNow := newCapabilityOperationTestFixture(
		t, "cleanup-sweep",
	)
	sweepCancelled, err := sweepOps.Cancel(
		ctx,
		"ptid:person:owner",
		&model.CancelCapabilityOperationRequest{
			OperationId:      sweepCreated.GetOperationId(),
			ExpectedRevision: sweepCreated.GetRevision(),
			IdempotencyKey:   "cancel-sweep",
		},
	)
	if err != nil {
		t.Fatalf("cancel operation for sweep: %v", err)
	}
	sweepOps.now = func() time.Time {
		return sweepNow.Add(defaultOperationCleanupTTL + time.Second)
	}
	count, err := sweepOps.SweepCleanupDeadlines(ctx)
	if err != nil {
		t.Fatalf("sweep cleanup deadline: %v", err)
	}
	if count != 1 {
		t.Fatalf("swept operations = %d, want 1", count)
	}
	swept, err := sweepOps.Get(
		ctx, "ptid:person:owner", sweepCancelled.GetOperationId(),
	)
	if err != nil {
		t.Fatalf("read swept operation: %v", err)
	}
	if swept.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CLEANUP_FAILED {
		t.Fatalf("cleanup deadline did not fail terminally: %+v", swept)
	}

	timeoutOps, _, timeoutCreated, timeoutNow := newCapabilityOperationTestFixture(
		t, "execution-timeout",
	)
	timeoutOps.now = func() time.Time { return timeoutNow.Add(6 * time.Minute) }
	count, err = timeoutOps.SweepExecutionDeadlines(ctx)
	if err != nil {
		t.Fatalf("sweep execution deadline: %v", err)
	}
	if count != 1 {
		t.Fatalf("timed out operations = %d, want 1", count)
	}
	timedOut, err := timeoutOps.Get(
		ctx, "ptid:person:owner", timeoutCreated.GetOperationId(),
	)
	if err != nil {
		t.Fatalf("read timed out operation: %v", err)
	}
	if timedOut.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP ||
		timedOut.GetDesiredTerminalOutcome() !=
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_TIMED_OUT {
		t.Fatalf("execution timeout did not enter cleanup: %+v", timedOut)
	}
}

func TestCapabilityOperationCancelAndResultOrderingIsDeterministic(t *testing.T) {
	ctx := context.Background()
	cancelFirst, _, cancelFirstOperation, _ :=
		newCapabilityOperationTestFixture(t, "cancel-before-result")
	cancelled, err := cancelFirst.Cancel(
		ctx,
		"ptid:person:owner",
		&model.CancelCapabilityOperationRequest{
			OperationId:      cancelFirstOperation.GetOperationId(),
			ExpectedRevision: cancelFirstOperation.GetRevision(),
			IdempotencyKey:   "cancel-first",
		},
	)
	if err != nil {
		t.Fatalf("commit cancellation first: %v", err)
	}
	if _, _, err := cancelFirst.ReportEvent(
		ctx,
		"ptid:person:owner",
		capabilityOperationEventRequest(
			cancelFirstOperation,
			1,
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SUCCEEDED,
		),
	); !isCapabilityError(err, errcode.AgentVersionConflict) {
		t.Fatalf("result after cancellation fence was accepted: %v", err)
	}
	if cancelled.GetDesiredTerminalOutcome() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CANCELLED {
		t.Fatalf("cancellation did not retain terminal intent")
	}

	resultFirst, _, resultFirstOperation, _ :=
		newCapabilityOperationTestFixture(t, "result-before-cancel")
	settling, _, err := resultFirst.ReportEvent(
		ctx,
		"ptid:person:owner",
		capabilityOperationEventRequest(
			resultFirstOperation,
			1,
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SUCCEEDED,
		),
	)
	if err != nil {
		t.Fatalf("commit result first: %v", err)
	}
	if _, err := resultFirst.Cancel(
		ctx,
		"ptid:person:owner",
		&model.CancelCapabilityOperationRequest{
			OperationId:      settling.GetOperationId(),
			ExpectedRevision: settling.GetRevision(),
			IdempotencyKey:   "cancel-after-result",
		},
	); !isCapabilityError(err, errcode.AgentVersionConflict) {
		t.Fatalf("cancellation overwrote result fence: %v", err)
	}
	if settling.GetDesiredTerminalOutcome() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SUCCEEDED {
		t.Fatalf("result-first ordering lost terminal intent")
	}
}

func TestCapabilityOperationTimeoutAndReconnectOrderingIsDeterministic(t *testing.T) {
	ctx := context.Background()
	timeoutFirst, _, timeoutFirstOperation, timeoutNow :=
		newCapabilityOperationTestFixture(t, "timeout-before-reconnect")
	timeoutFirst.now = func() time.Time { return timeoutNow.Add(6 * time.Minute) }
	if count, err := timeoutFirst.SweepExecutionDeadlines(ctx); err != nil || count != 1 {
		t.Fatalf("commit timeout first: count=%d err=%v", count, err)
	}
	reconnect := capabilityOperationEventRequest(
		timeoutFirstOperation,
		1,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISCONNECTED,
	)
	if _, _, err := timeoutFirst.ReportEvent(
		ctx, "ptid:person:owner", reconnect,
	); !isCapabilityError(err, errcode.AgentVersionConflict) {
		t.Fatalf("reconnect after timeout fence was accepted: %v", err)
	}

	reconnectFirst, _, reconnectFirstOperation, reconnectNow :=
		newCapabilityOperationTestFixture(t, "reconnect-before-timeout")
	disconnected, _, err := reconnectFirst.ReportEvent(
		ctx,
		"ptid:person:owner",
		capabilityOperationEventRequest(
			reconnectFirstOperation,
			1,
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISCONNECTED,
		),
	)
	if err != nil {
		t.Fatalf("disconnect before timeout: %v", err)
	}
	reconnecting, _, err := reconnectFirst.ReportEvent(
		ctx,
		"ptid:person:owner",
		capabilityOperationEventRequest(
			disconnected,
			2,
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RECONNECTING,
		),
	)
	if err != nil {
		t.Fatalf("reconnect before timeout: %v", err)
	}
	reconnectFirst.now = func() time.Time { return reconnectNow.Add(6 * time.Minute) }
	if count, err := reconnectFirst.SweepExecutionDeadlines(ctx); err != nil || count != 1 {
		t.Fatalf("timeout after reconnect: count=%d err=%v", count, err)
	}
	timedOut, err := reconnectFirst.Get(
		ctx, "ptid:person:owner", reconnecting.GetOperationId(),
	)
	if err != nil {
		t.Fatalf("read reconnect-first timeout: %v", err)
	}
	if timedOut.GetDesiredTerminalOutcome() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_TIMED_OUT {
		t.Fatalf("reconnect escaped deadline: %+v", timedOut)
	}
}

func newCapabilityAuthorityTestService(
	t *testing.T,
	name string,
) *CapabilityAuthorityService {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+name+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.Agent{},
		&persistence.CapabilityManifest{},
		&persistence.CapabilityManifestCommand{},
		&persistence.AgentCapabilityBinding{},
		&persistence.CapabilityBindingCommand{},
		&persistence.CapabilityReadinessSnapshot{},
		&persistence.CapabilityBackfillRun{},
		&persistence.KnowledgeResourceHead{},
		&persistence.KnowledgeResourceRevision{},
		&persistence.KnowledgeContentRevision{},
		&persistence.KnowledgeDescriptorCommand{},
	); err != nil {
		t.Fatalf("migrate test db: %v", err)
	}
	service := NewCapabilityAuthorityService(db)
	service.now = func() time.Time {
		return time.Date(2026, time.August, 27, 12, 0, 0, 0, time.UTC)
	}
	return service
}

func seedCapabilityAuthorityAgent(
	t *testing.T,
	db *gorm.DB,
	agentID string,
	ptid string,
	version int64,
) {
	t.Helper()
	if err := db.Create(&persistence.Agent{
		ID:             agentID,
		Name:           "Test Agent",
		OwnerActorPTID: ptid,
		ThinkingMode:   "auto",
		Visibility:     "private",
		Version:        version,
	}).Error; err != nil {
		t.Fatalf("seed agent: %v", err)
	}
}

func capabilityAuthorityTestManifest() *model.CapabilityManifest {
	return &model.CapabilityManifest{
		CapabilityId:          "builtin.search",
		Version:               "1",
		SourceKind:            model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL,
		SourceInstanceId:      "tool-registry",
		InputSchemaRef:        "schema://builtin.search/input",
		OutputSchemaRef:       "schema://builtin.search/output",
		ExecutionOwner:        model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION,
		RiskClass:             "read",
		DefaultApprovalPolicy: model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		SecretBoundary:        "station",
		Availability:          model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE,
	}
}

func capabilityAuthorityBindingRequest(
	bindingID string,
	expectedBindingRevision uint64,
	expectedAgentVersion uint64,
	idempotencyKey string,
) *model.UpsertAgentCapabilityBindingRequest {
	return &model.UpsertAgentCapabilityBindingRequest{
		Binding: &model.AgentCapabilityBinding{
			BindingId:            bindingID,
			AgentId:              "agent-1",
			CapabilityId:         "builtin.search",
			CapabilityVersion:    "1",
			Enabled:              true,
			ApprovalPolicy:       model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
			ExpectedAgentVersion: expectedAgentVersion,
		},
		IdempotencyKey:          idempotencyKey,
		ExpectedBindingRevision: expectedBindingRevision,
	}
}

func isCapabilityError(err error, code errcode.Code) bool {
	var bizErr *errcode.BizError
	return errors.As(err, &bizErr) && bizErr.Code == code
}

func assertCapabilityBackfillRejection(
	t *testing.T,
	report *CapabilityBackfillReport,
	source string,
	reason string,
) {
	t.Helper()
	for _, rejection := range report.Rejections {
		if rejection.Source == source && rejection.ReasonCode == reason {
			return
		}
	}
	t.Fatalf("missing rejection source=%s reason=%s: %+v", source, reason, report.Rejections)
}

func capabilityReadinessBindingRequest(
	manifest *model.CapabilityManifest,
	agentVersion uint64,
	idempotencyKey string,
) *model.UpsertAgentCapabilityBindingRequest {
	return &model.UpsertAgentCapabilityBindingRequest{
		Binding: &model.AgentCapabilityBinding{
			AgentId:              "agent-1",
			CapabilityId:         manifest.GetCapabilityId(),
			CapabilityVersion:    manifest.GetVersion(),
			Enabled:              true,
			ApprovalPolicy:       manifest.GetDefaultApprovalPolicy(),
			ExpectedAgentVersion: agentVersion,
		},
		IdempotencyKey: idempotencyKey,
	}
}

func assertCapabilityReadiness(
	t *testing.T,
	snapshot *model.CapabilityReadinessSnapshot,
	capabilityID string,
	state model.CapabilityReadinessState,
	reason string,
) {
	t.Helper()
	for _, readiness := range snapshot.GetCapabilities() {
		if readiness.GetCapabilityId() != capabilityID {
			continue
		}
		if readiness.GetState() != state || readiness.GetReasonCode() != reason {
			t.Fatalf(
				"unexpected readiness for %s: state=%s reason=%s",
				capabilityID,
				readiness.GetState(),
				readiness.GetReasonCode(),
			)
		}
		return
	}
	t.Fatalf("readiness missing for capability %s", capabilityID)
}

func assertCapabilityOperationRowCount(
	t *testing.T,
	db *gorm.DB,
	modelValue interface{},
	expected int64,
) {
	t.Helper()
	var count int64
	if err := db.Model(modelValue).Count(&count).Error; err != nil {
		t.Fatalf("count operation rows: %v", err)
	}
	if count != expected {
		t.Fatalf("operation row count = %d, want %d", count, expected)
	}
}

func newCapabilityOperationTestFixture(
	t *testing.T,
	name string,
) (*CapabilityOperationService, *gorm.DB, *model.CapabilityOperation, time.Time) {
	t.Helper()
	authority := newCapabilityAuthorityTestService(t, name)
	if err := authority.db.AutoMigrate(
		&persistence.ClientCapabilityLease{},
		&persistence.CapabilityOperation{},
		&persistence.CapabilityOperationCommand{},
		&persistence.CapabilityOperationEvent{},
		&persistence.CapabilityOperationEventRejection{},
		&persistence.CapabilityOperationOutbox{},
		&persistence.CapabilityOperationLease{},
		&persistence.CapabilityCleanupLease{},
	); err != nil {
		t.Fatalf("migrate operation fixture: %v", err)
	}
	ctx := context.Background()
	manifest := capabilityAuthorityTestManifest()
	if _, err := authority.RegisterManifest(ctx, manifest); err != nil {
		t.Fatalf("register fixture manifest: %v", err)
	}
	now := authority.now()
	if err := authority.db.Create(&persistence.ClientCapabilityLease{
		SessionID: "session-1", ActorID: "ptid:person:owner", AuthSessionID: "auth-1",
		DeviceID: "device-1", ConnectionID: "connection-1", LeaseID: "capability-lease-1",
		LeaseRevision: 1, LeasePayload: operationCapabilityLeasePayload(t), ExpiresAt: now.Add(5 * time.Minute),
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed fixture capability lease: %v", err)
	}
	operations := NewCapabilityOperationService(authority.db)
	operations.now = authority.now
	created, err := operations.Start(ctx, "ptid:person:owner", &model.StartCapabilityOperationRequest{
		CapabilityId: manifest.GetCapabilityId(), CapabilityVersion: manifest.GetVersion(),
		OperationKind: "test", TargetDeviceId: "device-1",
		CapabilitySessionId: "session-1", IdempotencyKey: "start-1",
		Deadline: timestamppb.New(now.Add(5 * time.Minute)),
	})
	if err != nil {
		t.Fatalf("start fixture operation: %v", err)
	}
	return operations, authority.db, created, now
}

func capabilityOperationEventRequest(
	operation *model.CapabilityOperation,
	sequence uint64,
	status model.CapabilityOperationStatus,
) *model.ReportCapabilityOperationEventRequest {
	return &model.ReportCapabilityOperationEventRequest{
		Event: &model.CapabilityOperationEvent{
			OperationId: operation.GetOperationId(), AttemptEpoch: operation.GetAttemptEpoch(),
			Sequence: sequence, Status: status, FencingToken: operation.GetFencingToken(),
		},
		TargetDeviceId:      operation.GetTargetDeviceId(),
		CapabilitySessionId: operation.GetCapabilitySessionId(),
		ExecutorLeaseId:     operation.GetExecutorLeaseId(),
	}
}

func operationCapabilityLeasePayload(t *testing.T) []byte {
	t.Helper()
	manifest := capabilityAuthorityTestManifest()
	return operationCapabilityLeasePayloadFor(
		t,
		manifest.GetCapabilityId(),
		manifest.GetVersion(),
	)
}

func operationCapabilityLeasePayloadFor(
	t *testing.T,
	capabilityID string,
	version string,
) []byte {
	t.Helper()
	payload, err := proto.Marshal(&model.ClientCapabilityLease{
		Capabilities: []*model.ClientCapability{{
			CapabilityId:  capabilityID,
			SchemaVersion: version,
			Permission:    model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_GRANTED,
		}},
	})
	if err != nil {
		t.Fatalf("encode capability operation lease payload: %v", err)
	}
	return payload
}
