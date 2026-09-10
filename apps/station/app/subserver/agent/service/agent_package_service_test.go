package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	agentPackageTestOwner = "ptid:person:package-owner"
	agentPackageTestOther = "ptid:person:package-other"
)

// These tests lock the actor-scoped, portable, and transactional package contract to real SQLite behavior.
func TestAgentPackageServiceExport(t *testing.T) {
	t.Run("rejects export by another actor", func(t *testing.T) {
		dbPath := filepath.Join(t.TempDir(), "actor-isolation.db")
		db := openAgentPackageTestDB(t, dbPath)
		defer closeAgentPackageTestDB(t, db)

		seedAgentPackageTestAgent(
			t,
			db,
			"agent-private",
			agentPackageTestOwner,
			`{"temperature":0.2}`,
		)
		service := NewAgentPackageService(db, nil, nil, nil)

		exported, err := service.Export(
			context.Background(),
			agentPackageTestOther,
			&model.ExportAgentPackageRequest{AgentId: "agent-private"},
		)
		if !isCapabilityError(err, errcode.AgentSecurityViolation) {
			t.Fatalf("expected actor isolation error, got response=%+v err=%v", exported, err)
		}
		if exported != nil {
			t.Fatalf("cross-actor export returned package data: %+v", exported)
		}
	})

	t.Run("includes portable Station content", func(t *testing.T) {
		dbPath := filepath.Join(t.TempDir(), "portable-export.db")
		db := openAgentPackageTestDB(t, dbPath)
		defer closeAgentPackageTestDB(t, db)

		service := NewAgentPackageService(db, nil, nil, nil)
		seedAgentPackageTestAgent(
			t,
			db,
			"agent-portable",
			agentPackageTestOwner,
			`{"temperature":0.4,"tools":["legacy"],"chatConfig":{"keep":true,"mcpServers":{"local":{}}}}`,
		)
		content := []byte("portable Station knowledge")
		descriptor, manifest, err := service.knowledge.Create(
			context.Background(),
			agentPackageTestOwner,
			stationKnowledgeCreateRequest("package-export-knowledge", "Portable", content),
		)
		if err != nil {
			t.Fatalf("create Station Knowledge resource: %v", err)
		}
		if _, err := service.authority.UpsertBinding(
			context.Background(),
			agentPackageTestOwner,
			agentPackageBindingRequest(
				"agent-portable",
				manifest.GetCapabilityId(),
				manifest.GetVersion(),
				"package-export-binding",
			),
		); err != nil {
			t.Fatalf("bind Station Knowledge resource: %v", err)
		}

		exported, err := service.Export(
			context.Background(),
			agentPackageTestOwner,
			&model.ExportAgentPackageRequest{AgentId: "agent-portable"},
		)
		if err != nil {
			t.Fatalf("export Agent package: %v", err)
		}
		if exported.GetPackage().GetSchemaVersion() != agentPackageSchemaVersion {
			t.Fatalf("schema version = %q", exported.GetPackage().GetSchemaVersion())
		}
		if len(exported.GetUnresolvedDependencies()) != 0 {
			t.Fatalf("portable export reported unresolved dependencies: %+v",
				exported.GetUnresolvedDependencies())
		}
		if len(exported.GetPackage().GetBindings()) != 1 {
			t.Fatalf("binding count = %d, want 1", len(exported.GetPackage().GetBindings()))
		}
		if len(exported.GetPackage().GetKnowledgeResources()) != 1 {
			t.Fatalf("Knowledge resource count = %d, want 1",
				len(exported.GetPackage().GetKnowledgeResources()))
		}
		resource := exported.GetPackage().GetKnowledgeResources()[0]
		if resource.GetPackageResourceId() != descriptor.GetResourceId() ||
			resource.GetContentHash() != descriptor.GetContentHash() ||
			resource.GetIndexRevision() != descriptor.GetIndexRevision() ||
			!bytes.Equal(resource.GetStationContent(), content) {
			t.Fatalf("portable Knowledge resource mismatch: %+v", resource)
		}
		assertPortableAgentPackageConfig(t, exported.GetPackage().GetAgent().GetConfigJson())
	})
}

func TestAgentPackageServiceImport(t *testing.T) {
	t.Run("returns client-local dependency before any writes", func(t *testing.T) {
		dbPath := filepath.Join(t.TempDir(), "client-local-unresolved.db")
		db := openAgentPackageTestDB(t, dbPath)
		defer closeAgentPackageTestDB(t, db)

		service := NewAgentPackageService(db, nil, nil, nil)
		request := &model.ImportAgentPackageRequest{
			Package:        agentPackageTestDocument(nil),
			Name:           "Client Local Import",
			IdempotencyKey: "client-local-import",
		}
		request.Package.Bindings = []*model.AgentPackageBindingRef{{
			CapabilityId:      knowledgeCapabilityID("client-local-resource"),
			CapabilityVersion: "1",
			Enabled:           true,
			ApprovalPolicy:    model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		}}

		imported, err := service.Import(context.Background(), agentPackageTestOwner, request)
		if err != nil {
			t.Fatalf("preflight client-local package: %v", err)
		}
		if imported.GetAgent() != nil || len(imported.GetUnresolvedDependencies()) != 1 {
			t.Fatalf("unexpected unresolved response: %+v", imported)
		}
		unresolved := imported.GetUnresolvedDependencies()[0]
		if unresolved.GetPackageResourceId() != "client-local-resource" ||
			unresolved.GetReasonCode() != packageReasonClientResourceRequired {
			t.Fatalf("unexpected unresolved dependency: %+v", unresolved)
		}
		assertAgentPackageZeroMutationRows(t, db)
	})

	t.Run("imports resolved package atomically", func(t *testing.T) {
		dbPath := filepath.Join(t.TempDir(), "resolved-import.db")
		db := openAgentPackageTestDB(t, dbPath)
		defer closeAgentPackageTestDB(t, db)

		service := NewAgentPackageService(db, nil, nil, nil)
		request := &model.ImportAgentPackageRequest{
			Package:        agentPackageTestDocument([]byte("resolved portable content")),
			Name:           "Resolved Import",
			IdempotencyKey: "resolved-import",
		}
		imported, err := service.Import(context.Background(), agentPackageTestOwner, request)
		if err != nil {
			t.Fatalf("import resolved Agent package: %v", err)
		}
		if imported.GetAgent() == nil ||
			imported.GetAgent().GetOwnerActorPtid() != agentPackageTestOwner ||
			imported.GetAgent().GetName() != "Resolved Import" {
			t.Fatalf("unexpected imported Agent: %+v", imported.GetAgent())
		}
		assertImportedAgentPackageRows(t, db, imported.GetAgent().GetAgentId(), []byte("resolved portable content"))
	})

	t.Run("rolls back every mutation when a late write fails", func(t *testing.T) {
		dbPath := filepath.Join(t.TempDir(), "rollback.db")
		db := openAgentPackageTestDB(t, dbPath)
		defer closeAgentPackageTestDB(t, db)

		if err := db.Exec(`
			CREATE TRIGGER reject_agent_package_binding
			BEFORE INSERT ON agent_capability_bindings
			BEGIN
				SELECT RAISE(ABORT, 'binding insert rejected');
			END
		`).Error; err != nil {
			t.Fatalf("create binding failure trigger: %v", err)
		}
		service := NewAgentPackageService(db, nil, nil, nil)
		request := &model.ImportAgentPackageRequest{
			Package:        agentPackageTestDocument([]byte("must roll back")),
			Name:           "Rollback Import",
			IdempotencyKey: "rollback-import",
		}

		if imported, err := service.Import(
			context.Background(),
			agentPackageTestOwner,
			request,
		); err == nil {
			t.Fatalf("expected binding failure, got response %+v", imported)
		}
		assertAgentPackageZeroMutationRows(t, db)
	})

	t.Run("replays the stored result without duplicate writes", func(t *testing.T) {
		dbPath := filepath.Join(t.TempDir(), "idempotent-replay.db")
		db := openAgentPackageTestDB(t, dbPath)
		defer closeAgentPackageTestDB(t, db)

		service := NewAgentPackageService(db, nil, nil, nil)
		request := &model.ImportAgentPackageRequest{
			Package:        agentPackageTestDocument([]byte("idempotent content")),
			Name:           "Idempotent Import",
			IdempotencyKey: "idempotent-import",
		}
		first, err := service.Import(context.Background(), agentPackageTestOwner, request)
		if err != nil {
			t.Fatalf("first package import: %v", err)
		}
		before := readAgentPackageMutationCounts(t, db)

		second, err := service.Import(context.Background(), agentPackageTestOwner, request)
		if err != nil {
			t.Fatalf("replay package import: %v", err)
		}
		if !proto.Equal(first, second) {
			t.Fatalf("replay response changed: first=%+v second=%+v", first, second)
		}
		after := readAgentPackageMutationCounts(t, db)
		if before != after {
			t.Fatalf("replay changed mutation counts: before=%+v after=%+v", before, after)
		}
	})

	t.Run("rejects legacy config before any writes", func(t *testing.T) {
		dbPath := filepath.Join(t.TempDir(), "legacy-config.db")
		db := openAgentPackageTestDB(t, dbPath)
		defer closeAgentPackageTestDB(t, db)

		service := NewAgentPackageService(db, nil, nil, nil)
		request := &model.ImportAgentPackageRequest{
			Package:        agentPackageTestDocument(nil),
			Name:           "Legacy Import",
			IdempotencyKey: "legacy-import",
		}
		request.Package.Agent.ConfigJson =
			`{"temperature":0.2,"chatConfig":"{\"tools\":[\"legacy\"]}"}`

		imported, err := service.Import(context.Background(), agentPackageTestOwner, request)
		if !isCapabilityError(err, errcode.AgentInvalidRequest) {
			t.Fatalf("expected legacy config rejection, got response=%+v err=%v", imported, err)
		}
		assertAgentPackageZeroMutationRows(t, db)
	})

	t.Run("reads imported package and receipt after database restart", func(t *testing.T) {
		dbPath := filepath.Join(t.TempDir(), "restart-readback.db")
		db := openAgentPackageTestDB(t, dbPath)
		service := NewAgentPackageService(db, nil, nil, nil)
		request := &model.ImportAgentPackageRequest{
			Package:        agentPackageTestDocument([]byte("durable package content")),
			Name:           "Restart Import",
			IdempotencyKey: "restart-import",
		}
		first, err := service.Import(context.Background(), agentPackageTestOwner, request)
		if err != nil {
			t.Fatalf("import package before restart: %v", err)
		}
		closeAgentPackageTestDB(t, db)

		restartedDB := openAgentPackageTestDB(t, dbPath)
		defer closeAgentPackageTestDB(t, restartedDB)
		restarted := NewAgentPackageService(restartedDB, nil, nil, nil)
		replayed, err := restarted.Import(context.Background(), agentPackageTestOwner, request)
		if err != nil {
			t.Fatalf("replay package import after restart: %v", err)
		}
		if !proto.Equal(first, replayed) {
			t.Fatalf("restart replay changed result: first=%+v replayed=%+v", first, replayed)
		}

		exported, err := restarted.Export(
			context.Background(),
			agentPackageTestOwner,
			&model.ExportAgentPackageRequest{AgentId: first.GetAgent().GetAgentId()},
		)
		if err != nil {
			t.Fatalf("export imported Agent after restart: %v", err)
		}
		if len(exported.GetPackage().GetKnowledgeResources()) != 1 ||
			!bytes.Equal(
				exported.GetPackage().GetKnowledgeResources()[0].GetStationContent(),
				[]byte("durable package content"),
			) {
			t.Fatalf("restart export lost portable content: %+v", exported)
		}
		assertImportedAgentPackageRows(
			t,
			restartedDB,
			first.GetAgent().GetAgentId(),
			[]byte("durable package content"),
		)
	})
}

func openAgentPackageTestDB(t *testing.T, dbPath string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		t.Fatalf("open Agent package SQLite database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.Agent{},
		&persistence.CapabilityManifest{},
		&persistence.CapabilityManifestCommand{},
		&persistence.AgentCapabilityBinding{},
		&persistence.CapabilityBindingCommand{},
		&persistence.KnowledgeResourceHead{},
		&persistence.KnowledgeResourceRevision{},
		&persistence.KnowledgeContentRevision{},
		&persistence.KnowledgeDescriptorCommand{},
		&persistence.AgentPackageImportReceipt{},
	); err != nil {
		t.Fatalf("migrate Agent package SQLite database: %v", err)
	}
	return db
}

func closeAgentPackageTestDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("access Agent package SQL database: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close Agent package SQLite database: %v", err)
	}
}

func seedAgentPackageTestAgent(
	t *testing.T,
	db *gorm.DB,
	agentID string,
	ptid string,
	configJSON string,
) {
	t.Helper()
	now := time.Date(2026, time.August, 28, 12, 0, 0, 0, time.UTC)
	if err := db.Create(&persistence.Agent{
		ID:             agentID,
		Name:           "Package Agent",
		Title:          "Portable Agent",
		Description:    "Agent package test fixture",
		ProviderID:     "provider-test",
		ModelName:      "model-test",
		Effort:         "medium",
		ThinkingMode:   string(domain.ThinkingModeAuto),
		Visibility:     string(domain.AgentVisibilityPrivate),
		OwnerActorPTID: ptid,
		ConfigJSON:     configJSON,
		Version:        1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed Agent package Agent: %v", err)
	}
}

func agentPackageBindingRequest(
	agentID string,
	capabilityID string,
	capabilityVersion string,
	idempotencyKey string,
) *model.UpsertAgentCapabilityBindingRequest {
	return &model.UpsertAgentCapabilityBindingRequest{
		Binding: &model.AgentCapabilityBinding{
			AgentId:              agentID,
			CapabilityId:         capabilityID,
			CapabilityVersion:    capabilityVersion,
			Enabled:              true,
			ApprovalPolicy:       model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
			ExpectedAgentVersion: 1,
		},
		IdempotencyKey: idempotencyKey,
	}
}

func agentPackageTestDocument(content []byte) *model.AgentPackageDocument {
	document := &model.AgentPackageDocument{
		SchemaVersion: agentPackageSchemaVersion,
		Agent: &model.Agent{
			AgentId:        "source-agent",
			Name:           "Source Agent",
			Title:          "Portable Agent",
			Description:    "Portable Agent package",
			ProviderId:     "provider-test",
			ModelName:      "model-test",
			Effort:         "medium",
			Visibility:     model.AgentVisibility_AGENT_VISIBILITY_PRIVATE,
			OwnerActorPtid: "ptid:person:source",
			ConfigJson:     `{"temperature":0.2}`,
			Version:        9,
			ThinkingMode:   string(domain.ThinkingModeAuto),
		},
	}
	if len(content) == 0 {
		return document
	}

	const resourceID = "portable-resource"
	sum := sha256.Sum256(content)
	contentHash := hex.EncodeToString(sum[:])
	document.Bindings = []*model.AgentPackageBindingRef{{
		CapabilityId:      knowledgeCapabilityID(resourceID),
		CapabilityVersion: "1",
		Enabled:           true,
		ApprovalPolicy:    model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
	}}
	document.KnowledgeResources = []*model.AgentPackageKnowledgeResource{{
		PackageResourceId: resourceID,
		ResourceKind:      model.KnowledgeResourceKind_KNOWLEDGE_RESOURCE_KIND_DOCUMENT,
		Title:             "Portable resource",
		StationContent:    append([]byte(nil), content...),
		ContentHash:       contentHash,
		IndexRevision:     knowledgeIndexRevision(resourceID, 1, contentHash),
	}}
	return document
}

func assertPortableAgentPackageConfig(t *testing.T, raw string) {
	t.Helper()
	var config map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &config); err != nil {
		t.Fatalf("decode portable Agent config: %v", err)
	}
	if _, exists := config["tools"]; exists {
		t.Fatalf("legacy tools authority escaped into package config: %s", raw)
	}
	var chatConfig map[string]json.RawMessage
	if err := json.Unmarshal(config["chatConfig"], &chatConfig); err != nil {
		t.Fatalf("decode portable chat config: %v", err)
	}
	if _, exists := chatConfig["mcpServers"]; exists {
		t.Fatalf("legacy MCP authority escaped into package config: %s", raw)
	}
	if _, exists := chatConfig["keep"]; !exists {
		t.Fatalf("portable chat config field was removed: %s", raw)
	}
}

type agentPackageMutationCounts struct {
	agents             int64
	manifests          int64
	manifestCommands   int64
	bindings           int64
	bindingCommands    int64
	knowledgeHeads     int64
	knowledgeRevisions int64
	knowledgeContents  int64
	knowledgeCommands  int64
	importReceipts     int64
}

func readAgentPackageMutationCounts(t *testing.T, db *gorm.DB) agentPackageMutationCounts {
	t.Helper()
	return agentPackageMutationCounts{
		agents:             countAgentPackageRows(t, db, &persistence.Agent{}),
		manifests:          countAgentPackageRows(t, db, &persistence.CapabilityManifest{}),
		manifestCommands:   countAgentPackageRows(t, db, &persistence.CapabilityManifestCommand{}),
		bindings:           countAgentPackageRows(t, db, &persistence.AgentCapabilityBinding{}),
		bindingCommands:    countAgentPackageRows(t, db, &persistence.CapabilityBindingCommand{}),
		knowledgeHeads:     countAgentPackageRows(t, db, &persistence.KnowledgeResourceHead{}),
		knowledgeRevisions: countAgentPackageRows(t, db, &persistence.KnowledgeResourceRevision{}),
		knowledgeContents:  countAgentPackageRows(t, db, &persistence.KnowledgeContentRevision{}),
		knowledgeCommands:  countAgentPackageRows(t, db, &persistence.KnowledgeDescriptorCommand{}),
		importReceipts:     countAgentPackageRows(t, db, &persistence.AgentPackageImportReceipt{}),
	}
}

func assertAgentPackageZeroMutationRows(t *testing.T, db *gorm.DB) {
	t.Helper()
	if counts := readAgentPackageMutationCounts(t, db); counts != (agentPackageMutationCounts{}) {
		t.Fatalf("Agent package operation left partial rows: %+v", counts)
	}
}

func countAgentPackageRows(t *testing.T, db *gorm.DB, table interface{}) int64 {
	t.Helper()
	var count int64
	if err := db.Model(table).Count(&count).Error; err != nil {
		t.Fatalf("count Agent package rows for %T: %v", table, err)
	}
	return count
}

func assertImportedAgentPackageRows(
	t *testing.T,
	db *gorm.DB,
	agentID string,
	expectedContent []byte,
) {
	t.Helper()
	counts := readAgentPackageMutationCounts(t, db)
	want := agentPackageMutationCounts{
		agents:             1,
		manifests:          1,
		manifestCommands:   0,
		bindings:           1,
		bindingCommands:    1,
		knowledgeHeads:     1,
		knowledgeRevisions: 1,
		knowledgeContents:  1,
		knowledgeCommands:  1,
		importReceipts:     1,
	}
	if counts != want {
		t.Fatalf("imported Agent package row counts = %+v, want %+v", counts, want)
	}

	var descriptor persistence.KnowledgeResourceRevision
	if err := db.Where("ptid = ?", agentPackageTestOwner).First(&descriptor).Error; err != nil {
		t.Fatalf("load imported Knowledge descriptor: %v", err)
	}
	var content persistence.KnowledgeContentRevision
	if err := db.Where(
		"resource_id = ? AND revision = ? AND ptid = ?",
		descriptor.ResourceID,
		descriptor.Revision,
		agentPackageTestOwner,
	).First(&content).Error; err != nil {
		t.Fatalf("load imported Knowledge content: %v", err)
	}
	if !bytes.Equal(content.Content, expectedContent) {
		t.Fatalf("imported Knowledge content = %q, want %q", content.Content, expectedContent)
	}
	var binding persistence.AgentCapabilityBinding
	if err := db.Where(
		"ptid = ? AND agent_id = ?",
		agentPackageTestOwner,
		agentID,
	).First(&binding).Error; err != nil {
		t.Fatalf("load imported capability binding: %v", err)
	}
	if binding.CapabilityID != knowledgeCapabilityID(descriptor.ResourceID) ||
		binding.CapabilityVersion != "1" ||
		binding.AgentVersion != 1 {
		t.Fatalf("imported binding does not target imported Knowledge: %+v", binding)
	}
}
