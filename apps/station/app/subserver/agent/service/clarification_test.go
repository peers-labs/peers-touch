package service

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
)

func TestClarificationDecisionPersistsAnswerAndRejectsConflictingReplay(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	proposal := fixture.authorizedProposalForOwner(t, "clarification",
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		true, model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION)
	proposal.Calls[0].ToolName = clarificationToolName
	proposal.Calls[0].Arguments = []byte(`{"prompt":"Which environment?","choices":["Test","Production"]}`)
	if err := fixture.db.Model(&persistence.CapabilityManifest{}).
		Where("capability_id = ?", proposal.Calls[0].CapabilityID).
		Update("source_instance_id", clarificationToolName).Error; err != nil {
		t.Fatal(err)
	}
	decisions, err := fixture.service.ProposeAuthorizedBatch(context.Background(), proposal)
	if err != nil {
		t.Fatal(err)
	}
	if decisions[0].Status != persistence.ToolCallStatusWaitingApproval {
		t.Fatalf("question did not wait for human: %+v", decisions)
	}
	request := &model.SubmitToolApprovalDecisionRequest{
		ApprovalId: decisions[0].ApprovalID, ToolCallId: proposal.Calls[0].ToolCallID,
		DecisionId: "answer-1", IdempotencyKey: "answer-1", Approved: true, Answer: "My isolated environment",
	}
	request.PayloadHash = decisionPayloadHash(request)
	response, err := fixture.service.SubmitDecision(context.Background(), fixture.actorID, request)
	if err != nil || !response.GetAccepted() {
		t.Fatalf("submit: %+v %v", response, err)
	}
	replay, err := fixture.service.SubmitDecision(context.Background(), fixture.actorID, request)
	if err != nil || !proto.Equal(response, replay) {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	conflict := proto.Clone(request).(*model.SubmitToolApprovalDecisionRequest)
	conflict.Answer = "Different answer"
	conflict.PayloadHash = decisionPayloadHash(conflict)
	rejected, err := fixture.service.SubmitDecision(context.Background(), fixture.actorID, conflict)
	if err != nil || rejected.GetAccepted() {
		t.Fatalf("conflicting replay: %+v %v", rejected, err)
	}
	var call persistence.ToolCall
	if err := fixture.db.Where("tool_call_id = ?", request.ToolCallId).First(&call).Error; err != nil {
		t.Fatal(err)
	}
	if call.ClarificationAnswer != request.Answer || call.DecisionRevision != 1 || call.TurnID != proposal.TurnID {
		t.Fatalf("answer authority changed: %+v", call)
	}
	// A fresh dispatch service must recover the same durable answer.
	restarted := NewToolDispatchService()
	claim, err := restarted.ClaimReadyStationTool(context.Background())
	if err != nil || claim == nil || claim.ClarificationAnswer != request.Answer {
		t.Fatalf("recover answer execution: %+v %v", claim, err)
	}
}

func TestClarificationAnswerRequiresBoundedNonEmptyInput(t *testing.T) {
	question := []byte(`{"prompt":"Choose","choices":["A"]}`)
	if validateClarificationAnswer(question, " ", true) == nil {
		t.Fatal("accepted empty answer")
	}
	if validateClarificationAnswer(question, "custom", true) != nil {
		t.Fatal("rejected Other answer")
	}
	if validateClarificationAnswer(question, "custom", false) == nil {
		t.Fatal("accepted answer on denial")
	}
}
