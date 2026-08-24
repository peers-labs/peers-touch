package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openConversationAuthorityDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open conversation authority database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.Conversation{},
		&persistence.AgentMessage{},
		&persistence.AgentTurn{},
		&persistence.TurnEvent{},
	); err != nil {
		t.Fatalf("migrate conversation authority database: %v", err)
	}
	injectOrchestrationServiceTestStore(t, db)
	return db
}

func TestConversationTurnEventReplayAndSnapshot(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_turn_event_replay")
	ctx := context.Background()
	service := NewConversationService()
	owner := "ptid:person:owner"
	now := time.Now()

	conversation := persistence.Conversation{
		ID:        "conversation-events",
		AgentID:   "agent-1",
		Ptid:      owner,
		Title:     "Events",
		Status:    "active",
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}
	turns := []persistence.AgentTurn{
		{ID: "turn-1", ConversationID: conversation.ID, AgentID: conversation.AgentID, Status: "running", StartedAt: now},
		{ID: "turn-2", ConversationID: conversation.ID, AgentID: conversation.AgentID, Status: "running", StartedAt: now},
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&turns).Error; err != nil {
		t.Fatalf("seed turns: %v", err)
	}

	for _, event := range []struct {
		turnID string
		text   string
		want   int64
	}{
		{turnID: "turn-1", text: "hello ", want: 1},
		{turnID: "turn-1", text: "world", want: 2},
		{turnID: "turn-2", text: "other", want: 1},
	} {
		seq, err := service.PersistTurnEvent(ctx, conversation.ID, event.turnID, "text", map[string]interface{}{"text": event.text})
		if err != nil {
			t.Fatalf("persist %s event: %v", event.turnID, err)
		}
		if seq != event.want {
			t.Fatalf("%s sequence=%d, want %d", event.turnID, seq, event.want)
		}
	}

	replayed, err := service.ReplayTurnEvents(ctx, owner, conversation.ID, "turn-1", 1)
	if err != nil {
		t.Fatalf("replay turn events: %v", err)
	}
	if len(replayed) != 1 || replayed[0].EventSeq != 2 {
		t.Fatalf("unexpected replay: %+v", replayed)
	}
	if _, err := service.ReplayTurnEvents(ctx, "ptid:person:other", conversation.ID, "turn-1", 0); err != nil {
		t.Fatalf("foreign replay should be an empty actor-scoped result, got %v", err)
	}

	snapshot, err := service.GetTurnEventSnapshot(ctx, owner, conversation.ID, "turn-1")
	if err != nil {
		t.Fatalf("get running snapshot: %v", err)
	}
	if snapshot.LastSequence != 2 || snapshot.Text != "hello world" || snapshot.Status != "running" {
		t.Fatalf("unexpected running snapshot: %+v", snapshot)
	}
}

func requireBizCode(t *testing.T, err error, code errcode.Code) {
	t.Helper()
	var biz *errcode.BizError
	if !errors.As(err, &biz) || biz.Code != code {
		t.Fatalf("expected %s, got %T: %v", code, err, err)
	}
}

func TestConversationAuthorityIsActorScopedAndVersioned(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_authority")
	ctx := context.Background()
	service := NewConversationService()
	owner := "ptid:person:owner"
	other := "ptid:person:other"

	conversation, err := service.CreateConversation(
		ctx,
		"agent-1",
		owner,
		"Owner topic",
		"",
		"model-1",
		"provider-1",
	)
	if err != nil {
		t.Fatalf("create owner conversation: %v", err)
	}
	if conversation.Ptid != owner || conversation.Version != 1 {
		t.Fatalf("unexpected conversation readback: %+v", conversation)
	}

	if _, err := service.GetConversation(ctx, other, conversation.ConversationID); err == nil {
		t.Fatal("other actor read owner conversation")
	} else {
		requireBizCode(t, err, errcode.AgentNotFound)
	}
	if messages, _, _, err := service.ListMessages(
		ctx,
		other,
		conversation.ConversationID,
		0,
		0,
		20,
	); err != nil || len(messages) != 0 {
		t.Fatalf("other actor message projection leaked: messages=%+v err=%v", messages, err)
	}

	activeBranch := "message-branch-1"
	updated, err := service.UpdateConversation(
		ctx,
		owner,
		conversation.ConversationID,
		1,
		"Renamed topic",
		"",
		"",
		map[string]string{"pinned": "true"},
		&activeBranch,
	)
	if err != nil {
		t.Fatalf("update owner conversation: %v", err)
	}
	if updated.Version != 2 ||
		updated.Title != "Renamed topic" ||
		updated.ActiveBranchMessageID != activeBranch {
		t.Fatalf("unexpected updated conversation: %+v", updated)
	}

	if _, err := service.UpdateConversation(
		ctx,
		owner,
		conversation.ConversationID,
		1,
		"Stale overwrite",
		"",
		"",
		nil,
		nil,
	); err == nil {
		t.Fatal("stale version update succeeded")
	} else {
		requireBizCode(t, err, errcode.AgentVersionConflict)
	}

	if err := service.ArchiveConversation(
		ctx,
		other,
		conversation.ConversationID,
		false,
		2,
	); err == nil {
		t.Fatal("other actor archived owner conversation")
	} else {
		requireBizCode(t, err, errcode.AgentVersionConflict)
	}

	var row persistence.Conversation
	if err := db.First(&row, "id = ?", conversation.ConversationID).Error; err != nil {
		t.Fatalf("read conversation row: %v", err)
	}
	if row.Title != "Renamed topic" || row.Status != "active" || row.Version != 2 {
		t.Fatalf("unauthorized/stale mutation changed row: %+v", row)
	}
}

func TestConversationMessageMutationRequiresOwner(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_message_authority")
	ctx := context.Background()
	service := NewConversationService()
	owner := "ptid:person:owner"
	other := "ptid:person:other"
	now := time.Now()
	conversation := persistence.Conversation{
		ID:        "conversation-1",
		AgentID:   "agent-1",
		Ptid:      owner,
		Title:     "Owner topic",
		Status:    "active",
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}
	message := persistence.AgentMessage{
		ID:             "message-1",
		ConversationID: conversation.ID,
		Role:           "assistant",
		Seq:            1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&message).Error; err != nil {
		t.Fatalf("seed message: %v", err)
	}

	if err := service.SetMessageTranslation(ctx, other, message.ID, "leak"); err == nil {
		t.Fatal("other actor mutated message translation")
	}
	if err := service.SetMessageTranslation(ctx, owner, message.ID, "translated"); err != nil {
		t.Fatalf("owner translated message: %v", err)
	}

	var got persistence.AgentMessage
	if err := db.First(&got, "id = ?", message.ID).Error; err != nil {
		t.Fatalf("read message: %v", err)
	}
	if string(got.MetadataJSON) != `{"translation":"translated"}` {
		t.Fatalf("unexpected translation metadata: %s", got.MetadataJSON)
	}
}

func TestConversationMetadataUpdatesMergeAndBranchProjectionHidesTombstones(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_projection")
	ctx := context.Background()
	service := NewConversationService()
	now := time.Now()
	parent := "user-root"
	tombstonedAt := now
	conversation := persistence.Conversation{
		ID:                    "conversation-projection",
		AgentID:               "agent-1",
		Ptid:                  "ptid:person:owner",
		Title:                 "Projection",
		Status:                "active",
		ActiveBranchMessageID: "assistant-active",
		Version:               1,
		CreatedAt:             now,
		UpdatedAt:             now,
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	for _, message := range []persistence.AgentMessage{
		{
			ID:             "user-root",
			ConversationID: conversation.ID,
			Role:           "user",
			Status:         "completed",
			Seq:            1,
			CreatedAt:      now,
			UpdatedAt:      now,
		},
		{
			ID:              "assistant-active",
			ConversationID:  conversation.ID,
			Role:            "assistant",
			Status:          "completed",
			Seq:             2,
			ParentMessageID: &parent,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
		{
			ID:              "assistant-sibling",
			ConversationID:  conversation.ID,
			Role:            "assistant",
			Status:          "completed",
			Seq:             3,
			ParentMessageID: &parent,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
		{
			ID:              "assistant-tombstoned",
			ConversationID:  conversation.ID,
			Role:            "assistant",
			Status:          "completed",
			Seq:             4,
			ParentMessageID: &parent,
			TombstonedAt:    &tombstonedAt,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
	} {
		if err := db.Create(&message).Error; err != nil {
			t.Fatal(err)
		}
	}

	updated, err := service.UpdateConversation(
		ctx,
		conversation.Ptid,
		conversation.ID,
		1,
		"",
		"",
		"",
		map[string]string{"pinned": "true"},
		nil,
	)
	if err != nil {
		t.Fatalf("pin conversation: %v", err)
	}
	updated, err = service.UpdateConversation(
		ctx,
		conversation.Ptid,
		conversation.ID,
		updated.Version,
		"",
		"",
		"",
		map[string]string{"favorite": "true"},
		nil,
	)
	if err != nil {
		t.Fatalf("favorite conversation: %v", err)
	}
	if updated.Meta["pinned"] != "true" || updated.Meta["favorite"] != "true" {
		t.Fatalf("metadata update replaced prior keys: %+v", updated.Meta)
	}

	messages, _, hasMore, err := service.ListMessages(
		ctx,
		conversation.Ptid,
		conversation.ID,
		0,
		0,
		20,
	)
	if err != nil {
		t.Fatalf("list active branch: %v", err)
	}
	if hasMore || len(messages) != 2 ||
		messages[0].MessageID != "user-root" ||
		messages[1].MessageID != "assistant-active" {
		t.Fatalf("unexpected active branch projection: %+v", messages)
	}
}
