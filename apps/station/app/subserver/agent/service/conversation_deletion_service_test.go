package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/externalruntime"
)

func TestConversationBatchDeletionIsAtomic(t *testing.T) {
	for _, failure := range []string{"stale", "foreign", "running", "success"} {
		t.Run(failure, func(t *testing.T) {
			db := openConversationAuthorityDB(t, "batch_delete_"+failure)
			now := time.Now()
			rows := []persistence.Conversation{
				{ID: "batch-a", AgentID: "agent", ActorPTID: "owner", Status: "active", Version: 1, CreatedAt: now, UpdatedAt: now},
				{ID: "batch-b", AgentID: "agent", ActorPTID: "owner", Status: "active", Version: 1, CreatedAt: now, UpdatedAt: now},
			}
			if failure == "foreign" {
				rows[1].ActorPTID = "another"
			}
			if err := db.Create(&rows).Error; err != nil {
				t.Fatal(err)
			}
			targets := []ConversationDeletionTarget{
				{ConversationID: rows[0].ID, ExpectedVersion: 1},
				{ConversationID: rows[1].ID, ExpectedVersion: 1},
			}
			if failure == "stale" {
				targets[1].ExpectedVersion = 2
			}
			if failure == "running" {
				if err := db.Create(&persistence.AgentTurn{
					ID: "active-turn", ConversationID: rows[1].ID, AgentID: "agent", Status: "running", StartedAt: now,
				}).Error; err != nil {
					t.Fatal(err)
				}
			}
			err := NewConversationService().DeleteConversations(context.Background(), "owner", targets, nil)
			if (err == nil) != (failure == "success") {
				t.Fatalf("deletion result: %v", err)
			}
			var deleted int64
			if err := db.Model(&persistence.Conversation{}).Where("status = ?", "deleted").Count(&deleted).Error; err != nil {
				t.Fatal(err)
			}
			expected := int64(0)
			if failure == "success" {
				expected = 2
			}
			if deleted != expected {
				t.Fatalf("partial deletion: deleted=%d expected=%d", deleted, expected)
			}
		})
	}
}

func TestConversationBatchExternalCleanupFailureRetainsAllTopicsAndRetries(t *testing.T) {
	db := openExternalRuntimeServiceDB(t, "batch-external-failure")
	injectOrchestrationServiceTestStore(t, db)
	seedExternalRuntimeConversation(t, db, "conversation-a", "session-a", 1, 3)
	seedExternalRuntimeConversation(t, db, "conversation-b", "session-b", 1, 3)
	failSecond := true
	manager := &externalRuntimeManagerStub{available: true}
	manager.cleanup = func(_ context.Context, request externalruntime.CleanupRequest) error {
		if request.SessionID == "session-b" && failSecond {
			return errors.New("cleanup failed")
		}
		return nil
	}
	runtime := NewExternalRuntimeService(db, manager, nil, nil)
	targets := []ConversationDeletionTarget{
		{ConversationID: "conversation-a", ExpectedVersion: 3},
		{ConversationID: "conversation-b", ExpectedVersion: 3},
	}
	conversations := NewConversationService()
	if err := conversations.DeleteConversations(context.Background(), "ptid:person:owner", targets, runtime); err == nil {
		t.Fatal("partial cleanup unexpectedly committed deletion")
	}
	for _, target := range targets {
		binding := loadExternalRuntimeBinding(t, db, target.ConversationID)
		if binding.State != model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_CLEANUP_FAILED {
			t.Fatalf("member lost recovery fence: %v", binding.State)
		}
	}
	var deleted int64
	if err := db.Model(&persistence.Conversation{}).Where("status = ?", "deleted").Count(&deleted).Error; err != nil {
		t.Fatal(err)
	}
	if deleted != 0 {
		t.Fatalf("partial external deletion: %d", deleted)
	}
	failSecond = false
	if err := runtime.RecoverPendingResets(context.Background()); err != nil {
		t.Fatalf("reset recovery: %v", err)
	}
	for _, target := range targets {
		binding := loadExternalRuntimeBinding(t, db, target.ConversationID)
		if binding.State != model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_CLEANUP_FAILED {
			t.Fatalf("standalone recovery released deletion fence: %v", binding.State)
		}
	}
	if err := conversations.DeleteConversations(context.Background(), "ptid:person:owner", targets, runtime); err != nil {
		t.Fatalf("retry fenced deletion: %v", err)
	}
	if err := db.Model(&persistence.Conversation{}).Where("status = ?", "deleted").Count(&deleted).Error; err != nil {
		t.Fatal(err)
	}
	if deleted != 2 {
		t.Fatalf("retry deleted %d topics", deleted)
	}
}

func TestAgentDeletionIncludesTopicsAndBindings(t *testing.T) {
	db := openAgentServiceTestDB(t, "agent-delete-topics")
	if err := persistence.MigrateEvaluationAggregate(db); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&persistence.AgentKnowledgeBinding{},
		&persistence.AgentWorkspace{}, &persistence.AgentWorkspaceFile{}); err != nil {
		t.Fatal(err)
	}
	if db.Migrator().HasTable(&persistence.AgentSkillBinding{}) {
		t.Fatal("legacy Agent Skill binding table must remain retired")
	}
	agent := seedAgentServiceTestAgent(t, db)
	now := time.Now()
	row := persistence.Conversation{ID: "owned-topic", AgentID: agent.ID,
		ActorPTID: agent.OwnerActorPTID, Status: "active", Version: 1, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	capabilityBinding := persistence.AgentCapabilityBinding{
		BindingID: "skill-bind", Ptid: agent.OwnerActorPTID, AgentID: agent.ID,
		CapabilityID: "skill.shared", CapabilityVersion: "1", Enabled: true,
		AgentVersion: 1, Revision: 1, UpdatedAt: now,
	}
	if err := db.Create(&capabilityBinding).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentKnowledgeBinding{
		ID: "knowledge-bind", AgentID: agent.ID, ResourceID: "shared-knowledge",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentWorkspace{ID: "owned-workspace", AgentID: agent.ID, Name: "Workspace"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentWorkspaceFile{ID: "owned-file", WorkspaceID: "owned-workspace", Path: "notes.md"}).Error; err != nil {
		t.Fatal(err)
	}
	service := NewAgentService()
	service.SetConversationDeletion(NewConversationService(), nil)
	if err := service.DeleteAgent(context.Background(), agent.OwnerActorPTID, agent.ID); err != nil {
		t.Fatal(err)
	}
	var retained int64
	if err := db.Model(&persistence.Agent{}).Where("id = ?", agent.ID).Count(&retained).Error; err != nil {
		t.Fatal(err)
	}
	if retained != 0 {
		t.Fatal("Agent survived committed deletion")
	}
	if err := db.First(&row, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "deleted" {
		t.Fatalf("Agent Topic survived: %s", row.Status)
	}
	var tombstoned persistence.AgentCapabilityBinding
	if err := db.First(&tombstoned, "binding_id = ?", capabilityBinding.BindingID).Error; err != nil {
		t.Fatal(err)
	}
	if tombstoned.TombstonedAt == nil || tombstoned.Revision != 2 {
		t.Fatalf("Agent capability binding was not tombstoned: %+v", tombstoned)
	}
	if err := db.Model(&persistence.AgentKnowledgeBinding{}).Where("agent_id = ?", agent.ID).Count(&retained).Error; err != nil {
		t.Fatal(err)
	}
	if retained != 0 {
		t.Fatal("Agent knowledge binding survived")
	}
	for _, resource := range []interface{}{&persistence.AgentWorkspace{}, &persistence.AgentWorkspaceFile{}} {
		if err := db.Model(resource).Count(&retained).Error; err != nil {
			t.Fatal(err)
		}
		if retained != 0 {
			t.Fatal("Agent workspace resources survived")
		}
	}
}
