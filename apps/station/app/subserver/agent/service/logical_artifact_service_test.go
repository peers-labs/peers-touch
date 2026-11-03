package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openLogicalArtifactDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	for _, model := range []any{
		&persistence.Conversation{},
		&persistence.AgentMessage{},
		&persistence.TaskRun{},
		&persistence.LogicalArtifact{},
		&persistence.ArtifactVersion{},
		&persistence.ArtifactVersionBody{},
		&persistence.ArtifactFeedback{},
		&persistence.ArtifactCheck{},
		&persistence.ArtifactAcceptance{},
	} {
		if err := db.AutoMigrate(model); err != nil {
			t.Fatalf("migrate: %v", err)
		}
	}
	return db
}

func newLogicalArtifactSvc(db *gorm.DB) *LogicalArtifactService {
	svc := NewLogicalArtifactService()
	svc.SetDB(db)
	return svc
}

func seedArtifactConversation(t *testing.T, db *gorm.DB) {
	t.Helper()
	now := time.Now().UTC()
	if err := db.Create(&persistence.Conversation{
		ID:        "conv-art",
		AgentID:   "agent-1",
		ActorPTID: "ptid:actor-1",
		Title:     "artifact task",
		Version:   1,
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&persistence.TaskRun{
		TaskID:         "task-art",
		ConversationID: "conv-art",
		OwnerActorPTID: "ptid:actor-1",
		Surface:        int32(model.TaskSurface_TASK_SURFACE_CHAT),
		Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed task: %v", err)
	}
	content := "# Report v1\n\nintro"
	if err := db.Create(&persistence.AgentMessage{
		ID:             "msg-v1",
		ConversationID: "conv-art",
		TurnID:         stringPointerValue("turn-v1"),
		Role:           "assistant",
		Status:         "completed",
		Content:        &content,
		Seq:            1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed message: %v", err)
	}
	content2 := "# Report v2\n\nrevised"
	if err := db.Create(&persistence.AgentMessage{
		ID:             "msg-v2",
		ConversationID: "conv-art",
		TurnID:         stringPointerValue("turn-v2"),
		Role:           "assistant",
		Status:         "completed",
		Content:        &content2,
		Seq:            2,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed message v2: %v", err)
	}
}

func TestLogicalArtifactVersionSequenceAndImmutability(t *testing.T) {
	db := openLogicalArtifactDB(t, "logical_artifact_versions")
	seedArtifactConversation(t, db)
	svc := newLogicalArtifactSvc(db)
	ctx := context.Background()

	v1Artifact, v1, err := svc.ClaimVersion(ctx, "ptid:actor-1", &model.ClaimArtifactVersionRequest{
		ConversationId:       "conv-art",
		Kind:                 model.LogicalArtifactKind_LOGICAL_ARTIFACT_KIND_DOCUMENT,
		Name:                 "Site study",
		Origin:               model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT,
		SourceTurnId:         "turn-v1",
		SourceMessageId:      "msg-v1",
		ClientIdempotencyKey: "claim-1",
	})
	if err != nil {
		t.Fatalf("claim v1: %v", err)
	}
	if v1.Seq != 1 || v1Artifact.CurrentSeq != 1 || v1Artifact.TaskID != "task-art" {
		t.Fatalf("unexpected v1: artifact=%+v version=%+v", v1Artifact, v1)
	}

	// Idempotent replay returns the same version.
	replayedArtifact, replayed, err := svc.ClaimVersion(ctx, "ptid:actor-1", &model.ClaimArtifactVersionRequest{
		ConversationId:       "conv-art",
		ArtifactId:           v1Artifact.ID,
		Origin:               model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT,
		SourceTurnId:         "turn-v1",
		SourceMessageId:      "msg-v1",
		ClientIdempotencyKey: "claim-1",
	})
	if err != nil || replayed.ID != v1.ID || replayedArtifact.CurrentSeq != 1 {
		t.Fatalf("idempotent claim mismatch: %+v %+v err=%v", replayedArtifact, replayed, err)
	}

	// Feedback on v1, answered by a new turn's output becomes v2.
	feedback, err := svc.SubmitFeedback(ctx, "ptid:actor-1", &model.SubmitArtifactFeedbackRequest{
		ArtifactId:           v1Artifact.ID,
		BaseVersionId:        v1.ID,
		Kind:                 model.ArtifactFeedbackKind_ARTIFACT_FEEDBACK_KIND_SELECTION,
		AnchorText:           "intro",
		Instruction:          "expand the intro",
		ClientIdempotencyKey: "fb-1",
	})
	if err != nil {
		t.Fatalf("submit feedback: %v", err)
	}
	_, v2, err := svc.ClaimVersion(ctx, "ptid:actor-1", &model.ClaimArtifactVersionRequest{
		ConversationId:        "conv-art",
		ArtifactId:            v1Artifact.ID,
		ExpectedBaseVersionId: v1.ID,
		Origin:                model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_FEEDBACK_REVISION,
		SourceTurnId:          "turn-v2",
		SourceMessageId:       "msg-v2",
		FeedbackId:            feedback.ID,
	})
	if err != nil {
		t.Fatalf("claim v2: %v", err)
	}
	if v2.Seq != 2 || v2.ParentVersionID != v1.ID || v2.FeedbackID != feedback.ID {
		t.Fatalf("unexpected v2 lineage: %+v", v2)
	}
	var linked persistence.ArtifactFeedback
	if err := db.First(&linked, "id = ?", feedback.ID).Error; err != nil {
		t.Fatalf("reload feedback: %v", err)
	}
	if linked.ResultingVersionID != v2.ID {
		t.Fatalf("feedback not linked to v2: %+v", linked)
	}

	// Bodies are immutable: v1 bytes still readable and unchanged.
	_, body1, err := svc.GetVersionBody(ctx, "ptid:actor-1", v1.ID)
	if err != nil || string(body1.Body) != "# Report v1\n\nintro" {
		t.Fatalf("v1 body mutated: %q err=%v", string(body1.Body), err)
	}
	_, body2, err := svc.GetVersionBody(ctx, "ptid:actor-1", v2.ID)
	if err != nil || string(body2.Body) != "# Report v2\n\nrevised" {
		t.Fatalf("v2 body mismatch: %q err=%v", string(body2.Body), err)
	}

	// Stale human edit base returns 409 with current version.
	_, _, err = svc.ClaimVersion(ctx, "ptid:actor-1", &model.ClaimArtifactVersionRequest{
		ConversationId:        "conv-art",
		ArtifactId:            v1Artifact.ID,
		ExpectedBaseVersionId: v1.ID,
		Origin:                model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_HUMAN_EDIT,
		Body:                  "stale edit",
	})
	if !hasHTTPStatus(err, http.StatusConflict) {
		t.Fatalf("stale base must conflict: %v", err)
	}

	// Editing on the current base creates v3.
	_, v3, err := svc.ClaimVersion(ctx, "ptid:actor-1", &model.ClaimArtifactVersionRequest{
		ConversationId:        "conv-art",
		ArtifactId:            v1Artifact.ID,
		ExpectedBaseVersionId: v2.ID,
		Origin:                model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_HUMAN_EDIT,
		Body:                  "# Report v3\n\nmanual",
	})
	if err != nil || v3.Seq != 3 || v3.Origin != artifactOriginHumanEdit {
		t.Fatalf("human edit v3: %+v err=%v", v3, err)
	}

	// Identical bytes to current do not manufacture a revision.
	_, same, err := svc.ClaimVersion(ctx, "ptid:actor-1", &model.ClaimArtifactVersionRequest{
		ConversationId:        "conv-art",
		ArtifactId:            v1Artifact.ID,
		ExpectedBaseVersionId: v3.ID,
		Origin:                model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_HUMAN_EDIT,
		Body:                  "# Report v3\n\nmanual",
	})
	if err != nil || same.ID != v3.ID {
		t.Fatalf("identical bytes must resolve to current: %+v err=%v", same, err)
	}
}

func TestLogicalArtifactChecksAcceptanceAndInvalidation(t *testing.T) {
	db := openLogicalArtifactDB(t, "logical_artifact_review")
	seedArtifactConversation(t, db)
	svc := newLogicalArtifactSvc(db)
	ctx := context.Background()

	_, v1, err := svc.ClaimVersion(ctx, "ptid:actor-1", &model.ClaimArtifactVersionRequest{
		ConversationId:  "conv-art",
		Name:            "Site study",
		Origin:          model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT,
		SourceMessageId: "msg-v1",
	})
	if err != nil {
		t.Fatalf("claim v1: %v", err)
	}
	var artifact persistence.LogicalArtifact
	if err := db.First(&artifact, "current_version = ?", v1.ID).Error; err != nil {
		t.Fatalf("load artifact: %v", err)
	}

	// Failed checks keep the version pending; passing structural + human review.
	failedCheck, err := svc.RecordCheck(ctx, "ptid:actor-1", &model.RecordArtifactCheckRequest{
		ArtifactId: artifact.ID,
		VersionId:  v1.ID,
		CheckType:  model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_STRUCTURAL,
		Result:     model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_FAILED,
		Detail:     "missing section",
	})
	if err != nil {
		t.Fatalf("record failed check: %v", err)
	}
	if _, err := svc.AcceptVersion(ctx, "ptid:actor-1", &model.AcceptArtifactVersionRequest{
		ArtifactId: artifact.ID,
		VersionId:  v1.ID,
	}); err != nil {
		t.Fatalf("acceptance with failed checks should still be allowed (human gate decides): %v", err)
	}

	passStructural, err := svc.RecordCheck(ctx, "ptid:actor-1", &model.RecordArtifactCheckRequest{
		ArtifactId: artifact.ID,
		VersionId:  v1.ID,
		CheckType:  model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_STRUCTURAL,
		Result:     model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_PASSED,
		Detail:     "structure ok",
	})
	if err != nil {
		t.Fatalf("record structural pass: %v", err)
	}
	passHuman, err := svc.RecordCheck(ctx, "ptid:actor-1", &model.RecordArtifactCheckRequest{
		ArtifactId: artifact.ID,
		VersionId:  v1.ID,
		CheckType:  model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_HUMAN_REVIEW,
		Result:     model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_PASSED,
	})
	if err != nil {
		t.Fatalf("record human pass: %v", err)
	}
	_ = failedCheck

	acceptance, err := svc.AcceptVersion(ctx, "ptid:actor-1", &model.AcceptArtifactVersionRequest{
		ArtifactId: artifact.ID,
		VersionId:  v1.ID,
	})
	if err != nil {
		t.Fatalf("accept v1: %v", err)
	}
	if acceptance.VersionID != v1.ID {
		t.Fatalf("acceptance bound to wrong version: %+v", acceptance)
	}
	current, err := svc.IsAcceptanceCurrent(ctx, "ptid:actor-1", artifact.ID, acceptance.VersionID)
	if err != nil || !current {
		t.Fatalf("acceptance should be current: current=%v err=%v", current, err)
	}

	// New version invalidates the old acceptance; checks remain immutable facts.
	_, v2, err := svc.ClaimVersion(ctx, "ptid:actor-1", &model.ClaimArtifactVersionRequest{
		ConversationId:        "conv-art",
		ArtifactId:            artifact.ID,
		ExpectedBaseVersionId: v1.ID,
		Origin:                model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_FEEDBACK_REVISION,
		SourceMessageId:       "msg-v2",
	})
	if err != nil {
		t.Fatalf("claim v2: %v", err)
	}
	current, err = svc.IsAcceptanceCurrent(ctx, "ptid:actor-1", artifact.ID, acceptance.VersionID)
	if err != nil || current {
		t.Fatalf("v1 acceptance must be invalid after v2: current=%v err=%v", current, err)
	}
	checks, err := svc.ListChecks(ctx, "ptid:actor-1", artifact.ID)
	if err != nil || len(checks) != 3 {
		t.Fatalf("check facts must be retained: %d err=%v", len(checks), err)
	}

	// Only the current version can be accepted; accepting v1 again now fails.
	if _, err := svc.AcceptVersion(ctx, "ptid:actor-1", &model.AcceptArtifactVersionRequest{
		ArtifactId: artifact.ID,
		VersionId:  v1.ID,
	}); !hasHTTPStatus(err, http.StatusConflict) {
		t.Fatalf("accepting stale version must conflict: %v", err)
	}
	_ = v2
	_ = passStructural
	_ = passHuman
}

func TestLogicalArtifactOwnershipAndList(t *testing.T) {
	db := openLogicalArtifactDB(t, "logical_artifact_owner")
	seedArtifactConversation(t, db)
	svc := newLogicalArtifactSvc(db)
	ctx := context.Background()

	if _, _, err := svc.ClaimVersion(ctx, "ptid:other", &model.ClaimArtifactVersionRequest{
		ConversationId:  "conv-art",
		Name:            "x",
		Origin:          model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT,
		SourceMessageId: "msg-v1",
	}); !hasHTTPStatus(err, http.StatusNotFound) {
		t.Fatalf("foreign actor claim must be not-found: %v", err)
	}

	_, v1, err := svc.ClaimVersion(ctx, "ptid:actor-1", &model.ClaimArtifactVersionRequest{
		ConversationId:  "conv-art",
		Name:            "Owned",
		Origin:          model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT,
		SourceMessageId: "msg-v1",
	})
	if err != nil {
		t.Fatalf("owner claim: %v", err)
	}
	artifacts, err := svc.ListArtifacts(ctx, "ptid:actor-1", "conv-art")
	if err != nil || len(artifacts) != 1 || artifacts[0].Name != "Owned" {
		t.Fatalf("list artifacts: %+v err=%v", artifacts, err)
	}
	versions, err := svc.ListVersions(ctx, "ptid:actor-1", artifacts[0].ID)
	if err != nil || len(versions) != 1 || versions[0].ID != v1.ID {
		t.Fatalf("list versions: %+v err=%v", versions, err)
	}
}

func seedCommandCheckFixture(t *testing.T, db *gorm.DB, conversationID string, exitCode int) (*persistence.ToolCall, []byte) {
	t.Helper()
	now := time.Now().UTC()
	batch := &persistence.ToolBatch{
		ID:             "batch-" + conversationID,
		ActorID:        "ptid:actor-1",
		TurnID:         "turn-shell-" + conversationID,
		ConversationID: conversationID,
		AgentID:        "agent-1",
		Status:         "settled",
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := db.Create(batch).Error; err != nil {
		t.Fatalf("seed batch: %v", err)
	}
	envelope := []byte(
		`{"ok":true,"output":{"command":"ls","exit_code":` +
			map[bool]string{true: "0", false: "1"}[exitCode == 0] +
			`,"stdout":""}}`,
	)
	if exitCode != 0 {
		envelope = []byte(`{"ok":true,"output":{"command":"ls","exit_code":1,"stderr":"missing"}}`)
	}
	call := &persistence.ToolCall{
		ID:               "call-" + conversationID,
		ActorID:          "ptid:actor-1",
		ToolBatchID:      batch.ID,
		ToolName:         "local_shell_exec",
		ToolCallID:       "llm-call-" + conversationID,
		BoundedArguments: []byte(`{"command":"ls"}`),
		ResourceRefs:     []byte("[]"),
		Status:           "succeeded",
		TurnID:           "turn-shell-" + conversationID,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := db.Create(call).Error; err != nil {
		t.Fatalf("seed call: %v", err)
	}
	result := &persistence.ToolResult{
		ID:            "result-" + conversationID,
		ToolCallID:    call.ToolCallID,
		MessageID:     "msg-tool-" + conversationID,
		ToolBatchID:   batch.ID,
		TurnID:        "turn-shell-" + conversationID,
		Status:        "applied",
		BoundedResult: envelope,
		CreatedAt:     now,
	}
	if err := db.Create(result).Error; err != nil {
		t.Fatalf("seed result: %v", err)
	}
	return call, envelope
}

func TestLogicalArtifactCommandCheckBindsRealToolResult(t *testing.T) {
	db := openLogicalArtifactDB(t, "logical_artifact_command_check")
	if err := db.AutoMigrate(
		&persistence.ToolBatch{},
		&persistence.ToolCall{},
		&persistence.ToolResult{},
	); err != nil {
		t.Fatalf("migrate tool tables: %v", err)
	}
	seedArtifactConversation(t, db)
	_, envelope := seedCommandCheckFixture(t, db, "conv-art", 0)
	svc := newLogicalArtifactSvc(db)
	ctx := context.Background()

	_, version, err := svc.ClaimVersion(ctx, "ptid:actor-1", &model.ClaimArtifactVersionRequest{
		ConversationId:       "conv-art",
		Name:                 "Code result",
		Origin:               model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT,
		SourceTurnId:         "turn-v1",
		SourceMessageId:      "msg-v1",
		ClientIdempotencyKey: "claim-cmd-1",
	})
	if err != nil {
		t.Fatalf("claim version: %v", err)
	}
	outputSHA := artifactBodySHA256(envelope)
	check, err := svc.RecordCheck(ctx, "ptid:actor-1", &model.RecordArtifactCheckRequest{
		ArtifactId:          version.ArtifactID,
		VersionId:           version.ID,
		CheckType:           model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_COMMAND,
		Result:              model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_PASSED,
		SourceToolCallId:    "call-conv-art",
		CommandExitCode:     0,
		CommandOutputSha256: outputSHA,
		Command:             "ls",
	})
	if err != nil {
		t.Fatalf("record command check: %v", err)
	}
	if check.SourceToolCallID != "call-conv-art" || check.Command != "ls" ||
		check.CommandExitCode != 0 || check.CommandOutputSHA != outputSHA {
		t.Fatalf("command evidence not persisted: %+v", check)
	}

	// A fabricated digest must be rejected.
	if _, err := svc.RecordCheck(ctx, "ptid:actor-1", &model.RecordArtifactCheckRequest{
		ArtifactId:          version.ArtifactID,
		VersionId:           version.ID,
		CheckType:           model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_COMMAND,
		Result:              model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_PASSED,
		SourceToolCallId:    "call-conv-art",
		CommandExitCode:     0,
		CommandOutputSha256: "00",
		Command:             "ls",
	}); err == nil {
		t.Fatal("fabricated output digest accepted")
	}

	// Missing tool call id is a bad request.
	if _, err := svc.RecordCheck(ctx, "ptid:actor-1", &model.RecordArtifactCheckRequest{
		ArtifactId: version.ArtifactID,
		VersionId:  version.ID,
		CheckType:  model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_COMMAND,
		Result:     model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_PASSED,
	}); err == nil {
		t.Fatal("command check without tool call accepted")
	}

	// A tool call from a different conversation cannot evidence the check.
	otherNow := time.Now().UTC()
	if err := db.Create(&persistence.Conversation{
		ID: "conv-other", AgentID: "agent-1", ActorPTID: "ptid:actor-1",
		Title: "other", Version: 1, Status: "active",
		CreatedAt: otherNow, UpdatedAt: otherNow,
	}).Error; err != nil {
		t.Fatalf("seed other conversation: %v", err)
	}
	_, otherEnvelope := seedCommandCheckFixture(t, db, "conv-other", 0)
	if _, err := svc.RecordCheck(ctx, "ptid:actor-1", &model.RecordArtifactCheckRequest{
		ArtifactId:          version.ArtifactID,
		VersionId:           version.ID,
		CheckType:           model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_COMMAND,
		Result:              model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_PASSED,
		SourceToolCallId:    "call-conv-other",
		CommandExitCode:     0,
		CommandOutputSha256: artifactBodySHA256(otherEnvelope),
		Command:             "ls",
	}); err == nil {
		t.Fatal("cross-conversation tool call accepted as evidence")
	}

	// A failed command on the same conversation can be recorded as a
	// FAILED check, but never as a passed one.
	failedEnvelope := []byte(`{"ok":true,"output":{"command":"ls","exit_code":1,"stderr":"missing"}}`)
	failedCall := &persistence.ToolCall{
		ID: "call-conv-art-failed", ActorID: "ptid:actor-1", TurnID: "turn-shell-conv-art",
		ToolBatchID: "batch-conv-art", ToolName: "local_shell_exec",
		ToolCallID: "llm-call-failed", BoundedArguments: []byte(`{"command":"ls"}`),
		ResourceRefs: []byte("[]"), Status: "succeeded",
		CreatedAt: otherNow, UpdatedAt: otherNow,
	}
	if err := db.Create(failedCall).Error; err != nil {
		t.Fatalf("seed failed call: %v", err)
	}
	if err := db.Create(&persistence.ToolResult{
		ID: "result-failed", ToolCallID: failedCall.ToolCallID, MessageID: "msg-failed",
		ToolBatchID: "batch-conv-art", TurnID: "turn-shell-conv-art",
		Status: "applied", BoundedResult: failedEnvelope, CreatedAt: otherNow,
	}).Error; err != nil {
		t.Fatalf("seed failed result: %v", err)
	}
	if _, err := svc.RecordCheck(ctx, "ptid:actor-1", &model.RecordArtifactCheckRequest{
		ArtifactId:          version.ArtifactID,
		VersionId:           version.ID,
		CheckType:           model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_COMMAND,
		Result:              model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_PASSED,
		SourceToolCallId:    "call-conv-art-failed",
		CommandExitCode:     1,
		CommandOutputSha256: artifactBodySHA256(failedEnvelope),
		Command:             "ls",
	}); err == nil {
		t.Fatal("non-zero command recorded as passed")
	}
	failedCheck, err := svc.RecordCheck(ctx, "ptid:actor-1", &model.RecordArtifactCheckRequest{
		ArtifactId:          version.ArtifactID,
		VersionId:           version.ID,
		CheckType:           model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_COMMAND,
		Result:              model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_FAILED,
		SourceToolCallId:    "call-conv-art-failed",
		CommandExitCode:     1,
		CommandOutputSha256: artifactBodySHA256(failedEnvelope),
		Command:             "ls",
	})
	if err != nil {
		t.Fatalf("record failed command check: %v", err)
	}
	if failedCheck.Result != "failed" {
		t.Fatalf("expected failed check result, got %q", failedCheck.Result)
	}
}

func hasHTTPStatus(err error, status int) bool {
	if err == nil {
		return false
	}
	var biz *errcode.BizError
	if errors.As(err, &biz) {
		switch status {
		case http.StatusNotFound:
			return biz.Code == errcode.AgentNotFound
		case http.StatusConflict:
			return biz.Code == errcode.AgentInvalidSourceState
		}
	}
	return false
}
