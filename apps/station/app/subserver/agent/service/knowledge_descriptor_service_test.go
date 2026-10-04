package service

import (
	"bytes"
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const knowledgeTestActor = "ptid:person:knowledge-owner"

func TestKnowledgeResourceCreateStoresBoundedContentAndManifestAtomically(t *testing.T) {
	resourceService, authority := newKnowledgeResourceTestService(t, "knowledge-create")
	seedCapabilityAuthorityAgent(t, authority.db, "agent-knowledge", knowledgeTestActor, 1)

	content := bytes.Repeat([]byte("k"), maxKnowledgeStationContentBytes)
	request := stationKnowledgeCreateRequest("create-1", "Architecture", content)
	descriptor, manifest, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		request,
	)
	if err != nil {
		t.Fatalf("create knowledge resource: %v", err)
	}
	if descriptor.GetRevision() != 1 ||
		descriptor.GetAvailability() !=
			model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_READY {
		t.Fatalf("unexpected descriptor: %+v", descriptor)
	}
	if descriptor.GetStationContentRef() == nil ||
		descriptor.GetStationContentRef().GetContentRef() == "" {
		t.Fatalf("station content ref was not returned: %+v", descriptor)
	}
	if manifest.GetCapabilityId() != knowledgeCapabilityID(descriptor.GetResourceId()) ||
		manifest.GetVersion() != "1" ||
		manifest.GetSourceKind() !=
			model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_KNOWLEDGE ||
		manifest.GetOwnerPtid() != knowledgeTestActor {
		t.Fatalf("unexpected knowledge manifest: %+v", manifest)
	}

	var stored persistence.KnowledgeContentRevision
	if err := authority.db.Where(
		"content_ref = ? AND ptid = ?",
		descriptor.GetStationContentRef().GetContentRef(),
		knowledgeTestActor,
	).First(&stored).Error; err != nil {
		t.Fatalf("load stored content: %v", err)
	}
	if !bytes.Equal(stored.Content, content) {
		t.Fatal("stored content does not match the accepted payload")
	}
	replayedDescriptor, replayedManifest, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		request,
	)
	if err != nil {
		t.Fatalf("replay knowledge create: %v", err)
	}
	if replayedDescriptor.GetResourceId() != descriptor.GetResourceId() ||
		replayedManifest.GetCapabilityId() != manifest.GetCapabilityId() {
		t.Fatalf("idempotent replay changed result: %+v %+v", replayedDescriptor, replayedManifest)
	}
	conflicting := stationKnowledgeCreateRequest("create-1", "Different", content)
	if _, _, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		conflicting,
	); !isCapabilityError(err, errcode.AgentIdempotencyConflict) {
		t.Fatalf("expected idempotency payload conflict, got %v", err)
	}
}

func TestKnowledgeResourceCreateRollsBackManifestWhenPersistenceFails(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "knowledge-rollback")
	if err := authority.db.Migrator().DropTable(
		&persistence.KnowledgeContentRevision{},
	); err != nil {
		t.Fatalf("drop content table: %v", err)
	}
	resourceService := NewKnowledgeResourceService(authority.db, authority)
	request := stationKnowledgeCreateRequest("rollback-1", "Rollback", []byte("content"))

	if _, _, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		request,
	); err == nil {
		t.Fatal("expected missing knowledge table failure")
	}
	var count int64
	if err := authority.db.Model(&persistence.CapabilityManifest{}).Count(&count).Error; err != nil {
		t.Fatalf("count rolled-back manifests: %v", err)
	}
	if count != 0 {
		t.Fatalf("manifest escaped failed descriptor transaction: %d", count)
	}
}

func TestKnowledgeResourceUpdateUsesActorScopedRevisionCAS(t *testing.T) {
	resourceService, _ := newKnowledgeResourceTestService(t, "knowledge-update")
	created, _, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		stationKnowledgeCreateRequest("create-1", "Original", []byte("v1")),
	)
	if err != nil {
		t.Fatalf("create knowledge resource: %v", err)
	}

	update := &model.UpdateKnowledgeResourceDescriptorRequest{
		ResourceId:       created.GetResourceId(),
		ExpectedRevision: 1,
		ResourceKind:     created.GetResourceKind(),
		Source: &model.UpdateKnowledgeResourceDescriptorRequest_StationContent{
			StationContent: []byte("v2"),
		},
		IdempotencyKey: "update-1",
		Title:          "Updated",
	}
	updated, manifest, err := resourceService.Update(
		context.Background(),
		knowledgeTestActor,
		update,
	)
	if err != nil {
		t.Fatalf("update knowledge resource: %v", err)
	}
	if updated.GetRevision() != 2 || manifest.GetVersion() != "2" {
		t.Fatalf("update did not advance descriptor and manifest: %+v %+v", updated, manifest)
	}
	if _, _, err := resourceService.Update(
		context.Background(),
		knowledgeTestActor,
		&model.UpdateKnowledgeResourceDescriptorRequest{
			ResourceId:       created.GetResourceId(),
			ExpectedRevision: 1,
			ResourceKind:     created.GetResourceKind(),
			Source: &model.UpdateKnowledgeResourceDescriptorRequest_StationContent{
				StationContent: []byte("stale"),
			},
			IdempotencyKey: "update-stale",
			Title:          "Stale",
		},
	); !isCapabilityError(err, errcode.AgentVersionConflict) {
		t.Fatalf("expected stale revision rejection, got %v", err)
	}
	if _, _, err := resourceService.Update(
		context.Background(),
		"ptid:person:other",
		&model.UpdateKnowledgeResourceDescriptorRequest{
			ResourceId:       created.GetResourceId(),
			ExpectedRevision: 2,
			ResourceKind:     created.GetResourceKind(),
			Source: &model.UpdateKnowledgeResourceDescriptorRequest_StationContent{
				StationContent: []byte("cross-actor"),
			},
			IdempotencyKey: "update-other",
			Title:          "Other",
		},
	); !isCapabilityError(err, errcode.AgentNotFound) {
		t.Fatalf("expected cross-actor update rejection, got %v", err)
	}
}

func TestKnowledgeResourceListIsActorScopedAndCursorPaginated(t *testing.T) {
	resourceService, _ := newKnowledgeResourceTestService(t, "knowledge-list")
	for index := 0; index < 3; index++ {
		if _, _, err := resourceService.Create(
			context.Background(),
			knowledgeTestActor,
			stationKnowledgeCreateRequest(
				"create-"+string(rune('a'+index)),
				"Resource",
				[]byte{byte(index + 1)},
			),
		); err != nil {
			t.Fatalf("create resource %d: %v", index, err)
		}
	}
	if _, _, err := resourceService.Create(
		context.Background(),
		"ptid:person:other",
		stationKnowledgeCreateRequest("create-other", "Other", []byte("other")),
	); err != nil {
		t.Fatalf("create other actor resource: %v", err)
	}

	first, cursor, err := resourceService.List(
		context.Background(),
		knowledgeTestActor,
		&model.ListKnowledgeResourceDescriptorsRequest{PageSize: 2},
	)
	if err != nil {
		t.Fatalf("list first page: %v", err)
	}
	if len(first) != 2 || cursor == "" {
		t.Fatalf("unexpected first page: len=%d cursor=%q", len(first), cursor)
	}
	second, nextCursor, err := resourceService.List(
		context.Background(),
		knowledgeTestActor,
		&model.ListKnowledgeResourceDescriptorsRequest{PageSize: 2, Cursor: cursor},
	)
	if err != nil {
		t.Fatalf("list second page: %v", err)
	}
	if len(second) != 1 || nextCursor != "" {
		t.Fatalf("unexpected second page: len=%d cursor=%q", len(second), nextCursor)
	}
	for _, descriptor := range append(first, second...) {
		if descriptor.GetPtid() != knowledgeTestActor {
			t.Fatalf("cross-actor descriptor leaked: %+v", descriptor)
		}
	}
	if _, _, err := resourceService.List(
		context.Background(),
		knowledgeTestActor,
		&model.ListKnowledgeResourceDescriptorsRequest{Cursor: "not-base64!"},
	); !isCapabilityError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("expected invalid cursor rejection, got %v", err)
	}
}

func TestKnowledgeResourceTombstonePreservesImmutableRevision(t *testing.T) {
	resourceService, authority := newKnowledgeResourceTestService(t, "knowledge-tombstone")
	createRequest := stationKnowledgeCreateRequest("create-1", "Delete", []byte("content"))
	created, _, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		createRequest,
	)
	if err != nil {
		t.Fatalf("create knowledge resource: %v", err)
	}
	updated, _, err := resourceService.Update(
		context.Background(),
		knowledgeTestActor,
		&model.UpdateKnowledgeResourceDescriptorRequest{
			ResourceId:       created.GetResourceId(),
			ExpectedRevision: created.GetRevision(),
			ResourceKind:     created.GetResourceKind(),
			Source: &model.UpdateKnowledgeResourceDescriptorRequest_StationContent{
				StationContent: []byte("updated content"),
			},
			IdempotencyKey: "update-1",
			Title:          "Updated before delete",
		},
	)
	if err != nil {
		t.Fatalf("update knowledge resource: %v", err)
	}

	request := &model.TombstoneKnowledgeResourceDescriptorRequest{
		ResourceId:       created.GetResourceId(),
		ExpectedRevision: updated.GetRevision(),
		IdempotencyKey:   "delete-1",
		Reason:           "user removed resource",
	}
	tombstoned, manifest, err := resourceService.Tombstone(
		context.Background(),
		knowledgeTestActor,
		request,
	)
	if err != nil {
		t.Fatalf("tombstone knowledge resource: %v", err)
	}
	if tombstoned.GetTombstonedAt() == nil ||
		tombstoned.GetAvailability() !=
			model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_TOMBSTONED ||
		manifest.GetRetiredAt() == nil {
		t.Fatalf("tombstone result is incomplete: %+v %+v", tombstoned, manifest)
	}

	var immutable persistence.KnowledgeResourceRevision
	if err := authority.db.Where(
		"resource_id = ? AND revision = ?",
		created.GetResourceId(),
		created.GetRevision(),
	).First(&immutable).Error; err != nil {
		t.Fatalf("load immutable revision: %v", err)
	}
	if immutable.TombstonedAt != nil ||
		immutable.Availability != int32(
			model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_READY,
		) {
		t.Fatalf("tombstone mutated immutable revision: %+v", immutable)
	}
	var activeManifestCount int64
	if err := authority.db.Model(&persistence.CapabilityManifest{}).
		Where(
			"capability_id = ? AND retired_at IS NULL",
			knowledgeCapabilityID(created.GetResourceId()),
		).
		Count(&activeManifestCount).Error; err != nil {
		t.Fatalf("count active manifests: %v", err)
	}
	if activeManifestCount != 0 {
		t.Fatalf("tombstone left %d historical manifests active", activeManifestCount)
	}

	replayed, replayedManifest, err := resourceService.Tombstone(
		context.Background(),
		knowledgeTestActor,
		request,
	)
	if err != nil {
		t.Fatalf("replay tombstone: %v", err)
	}
	if replayed.GetTombstonedAt() == nil || replayedManifest.GetRetiredAt() == nil {
		t.Fatalf("tombstone replay lost lifecycle evidence: %+v %+v", replayed, replayedManifest)
	}
	replayedCreate, replayedCreateManifest, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		createRequest,
	)
	if err != nil {
		t.Fatalf("replay create after tombstone: %v", err)
	}
	if replayedCreate.GetRevision() != created.GetRevision() ||
		replayedCreate.GetTombstonedAt() != nil ||
		replayedCreate.GetAvailability() !=
			model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_READY ||
		replayedCreateManifest.GetRetiredAt() != nil ||
		replayedCreateManifest.GetAvailability() !=
			model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE {
		t.Fatalf(
			"create replay did not preserve its original result: %+v %+v",
			replayedCreate,
			replayedCreateManifest,
		)
	}

	active, _, err := resourceService.List(
		context.Background(),
		knowledgeTestActor,
		&model.ListKnowledgeResourceDescriptorsRequest{},
	)
	if err != nil {
		t.Fatalf("list active descriptors: %v", err)
	}
	if len(active) != 0 {
		t.Fatalf("tombstoned descriptor remained active: %d", len(active))
	}
	withTombstones, _, err := resourceService.List(
		context.Background(),
		knowledgeTestActor,
		&model.ListKnowledgeResourceDescriptorsRequest{IncludeTombstoned: true},
	)
	if err != nil {
		t.Fatalf("list tombstoned descriptors: %v", err)
	}
	if len(withTombstones) != 1 || withTombstones[0].GetTombstonedAt() == nil {
		t.Fatalf("tombstoned descriptor was not returned: %+v", withTombstones)
	}
}

func TestKnowledgeResourceSourceValidation(t *testing.T) {
	resourceService, _ := newKnowledgeResourceTestService(t, "knowledge-validation")
	if _, _, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		stationKnowledgeCreateRequest(
			"too-large",
			"Too large",
			bytes.Repeat([]byte("x"), maxKnowledgeStationContentBytes+1),
		),
	); !isCapabilityError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("expected oversized content rejection, got %v", err)
	}

	invalidRefs := []string{
		"/Users/alice/secret.txt",
		"file:///tmp/secret.txt",
		"https://example.com/live",
		"folder/resource",
		`folder\resource`,
		"resource?token=secret",
		"resource id",
	}
	for _, opaqueRef := range invalidRefs {
		t.Run(opaqueRef, func(t *testing.T) {
			if _, _, err := resourceService.Create(
				context.Background(),
				knowledgeTestActor,
				clientKnowledgeCreateRequest("invalid-"+opaqueRef, opaqueRef),
			); !isCapabilityError(err, errcode.AgentInvalidRequest) {
				t.Fatalf("expected opaque ref rejection for %q, got %v", opaqueRef, err)
			}
		})
	}

	descriptor, manifest, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		clientKnowledgeCreateRequest("client-valid", "resource_01-opaque"),
	)
	if err != nil {
		t.Fatalf("create client knowledge resource: %v", err)
	}
	if descriptor.GetClientResourceRef() == nil ||
		descriptor.GetAvailability() !=
			model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_UNAVAILABLE ||
		manifest.GetExecutionOwner() !=
			model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY {
		t.Fatalf("unexpected client resource result: %+v %+v", descriptor, manifest)
	}

	tooLongKey := stationKnowledgeCreateRequest(
		strings.Repeat("k", maxKnowledgeIdempotencyKeyBytes+1),
		"Long key",
		[]byte("content"),
	)
	if _, _, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		tooLongKey,
	); !isCapabilityError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("expected oversized idempotency key rejection, got %v", err)
	}

	tooLongIntegrityHash := clientKnowledgeCreateRequest(
		"long-integrity-hash",
		"resource_02-opaque",
	)
	tooLongIntegrityHash.GetClientResourceRef().IntegrityHash =
		strings.Repeat("h", maxKnowledgeIntegrityHashBytes+1)
	if _, _, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		tooLongIntegrityHash,
	); !isCapabilityError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("expected oversized integrity hash rejection, got %v", err)
	}
}

func TestKnowledgeResourceManifestIsActorScoped(t *testing.T) {
	resourceService, authority := newKnowledgeResourceTestService(t, "knowledge-actor-scope")
	ownerDescriptor, ownerManifest, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		stationKnowledgeCreateRequest("owner-create", "Owner", []byte("owner")),
	)
	if err != nil {
		t.Fatalf("create owner knowledge resource: %v", err)
	}
	otherActor := "ptid:person:other"
	if _, _, err := resourceService.Create(
		context.Background(),
		otherActor,
		stationKnowledgeCreateRequest("other-create", "Other", []byte("other")),
	); err != nil {
		t.Fatalf("create other knowledge resource: %v", err)
	}

	ownerManifests, err := authority.ListManifests(
		context.Background(),
		knowledgeTestActor,
		[]model.CapabilitySourceKind{
			model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_KNOWLEDGE,
		},
	)
	if err != nil {
		t.Fatalf("list owner manifests: %v", err)
	}
	if len(ownerManifests) != 1 ||
		ownerManifests[0].GetSourceInstanceId() != ownerDescriptor.GetResourceId() {
		t.Fatalf("knowledge manifest actor filter failed: %+v", ownerManifests)
	}

	if _, err := authority.RetireManifest(
		context.Background(),
		otherActor,
		&model.RetireCapabilityManifestRequest{
			CapabilityId:   ownerManifest.GetCapabilityId(),
			Version:        ownerManifest.GetVersion(),
			IdempotencyKey: "cross-actor-retire",
			Reason:         "unauthorized",
		},
	); !isCapabilityError(err, errcode.AgentNotFound) {
		t.Fatalf("expected cross-actor retirement rejection, got %v", err)
	}

	seedCapabilityAuthorityAgent(t, authority.db, "agent-other", otherActor, 1)
	if _, err := authority.UpsertBinding(
		context.Background(),
		otherActor,
		&model.UpsertAgentCapabilityBindingRequest{
			Binding: &model.AgentCapabilityBinding{
				AgentId:              "agent-other",
				CapabilityId:         ownerManifest.GetCapabilityId(),
				CapabilityVersion:    ownerManifest.GetVersion(),
				Enabled:              true,
				ApprovalPolicy:       model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
				ExpectedAgentVersion: 1,
			},
			IdempotencyKey: "cross-actor-bind",
		},
	); !isCapabilityError(err, errcode.AgentNotFound) {
		t.Fatalf("expected cross-actor binding rejection, got %v", err)
	}
}

func TestKnowledgeResourcePersistsAcrossServiceRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "knowledge.db")
	resourceService, authority := openKnowledgeResourceTestService(t, dbPath)
	request := stationKnowledgeCreateRequest("restart-create", "Restart", []byte("durable"))
	created, manifest, err := resourceService.Create(
		context.Background(),
		knowledgeTestActor,
		request,
	)
	if err != nil {
		t.Fatalf("create knowledge resource: %v", err)
	}
	sqlDB, err := authority.db.DB()
	if err != nil {
		t.Fatalf("access test database: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close test database: %v", err)
	}

	restartedService, _ := openKnowledgeResourceTestService(t, dbPath)
	descriptors, _, err := restartedService.List(
		context.Background(),
		knowledgeTestActor,
		&model.ListKnowledgeResourceDescriptorsRequest{},
	)
	if err != nil {
		t.Fatalf("list after restart: %v", err)
	}
	if len(descriptors) != 1 ||
		descriptors[0].GetResourceId() != created.GetResourceId() ||
		descriptors[0].GetStationContentRef().GetContentRef() !=
			created.GetStationContentRef().GetContentRef() {
		t.Fatalf("restart readback changed descriptor: %+v", descriptors)
	}
	replayed, replayedManifest, err := restartedService.Create(
		context.Background(),
		knowledgeTestActor,
		request,
	)
	if err != nil {
		t.Fatalf("replay create after restart: %v", err)
	}
	if replayed.GetResourceId() != created.GetResourceId() ||
		replayedManifest.GetCapabilityId() != manifest.GetCapabilityId() {
		t.Fatalf("restart replay changed identity: %+v %+v", replayed, replayedManifest)
	}
}

func newKnowledgeResourceTestService(
	t *testing.T,
	name string,
) (*KnowledgeResourceService, *CapabilityAuthorityService) {
	t.Helper()
	authority := newCapabilityAuthorityTestService(t, name)
	if err := authority.db.AutoMigrate(
		&persistence.KnowledgeResourceHead{},
		&persistence.KnowledgeResourceRevision{},
		&persistence.KnowledgeContentRevision{},
		&persistence.KnowledgeDescriptorCommand{},
	); err != nil {
		t.Fatalf("migrate knowledge resource tables: %v", err)
	}
	resourceService := NewKnowledgeResourceService(authority.db, authority)
	resourceService.now = func() time.Time {
		return time.Date(2026, time.August, 28, 13, 0, 0, 0, time.UTC)
	}
	return resourceService, authority
}

func openKnowledgeResourceTestService(
	t *testing.T,
	dbPath string,
) (*KnowledgeResourceService, *CapabilityAuthorityService) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		t.Fatalf("open knowledge test database: %v", err)
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
		t.Fatalf("migrate knowledge test database: %v", err)
	}
	authority := NewCapabilityAuthorityService(db)
	authority.now = func() time.Time {
		return time.Date(2026, time.August, 28, 13, 0, 0, 0, time.UTC)
	}
	resourceService := NewKnowledgeResourceService(db, authority)
	resourceService.now = authority.now
	return resourceService, authority
}

func stationKnowledgeCreateRequest(
	idempotencyKey string,
	title string,
	content []byte,
) *model.CreateKnowledgeResourceDescriptorRequest {
	return &model.CreateKnowledgeResourceDescriptorRequest{
		ResourceKind: model.KnowledgeResourceKind_KNOWLEDGE_RESOURCE_KIND_DOCUMENT,
		Source: &model.CreateKnowledgeResourceDescriptorRequest_StationContent{
			StationContent: content,
		},
		IdempotencyKey: idempotencyKey,
		Title:          title,
	}
}

func clientKnowledgeCreateRequest(
	idempotencyKey string,
	opaqueRef string,
) *model.CreateKnowledgeResourceDescriptorRequest {
	return &model.CreateKnowledgeResourceDescriptorRequest{
		ResourceKind: model.KnowledgeResourceKind_KNOWLEDGE_RESOURCE_KIND_DOCUMENT,
		Source: &model.CreateKnowledgeResourceDescriptorRequest_ClientResourceRef{
			ClientResourceRef: &model.KnowledgeClientResourceRef{
				OpaqueResourceRef:         opaqueRef,
				RequiredCapabilityId:      "filesystem.read",
				RequiredCapabilityVersion: "1",
				DeviceId:                  "device-1",
				IntegrityHash:             "sha256:resource",
			},
		},
		IdempotencyKey: idempotencyKey,
		Title:          "Client resource",
	}
}
