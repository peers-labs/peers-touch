package service

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const workspaceGrantTestCapability = "filesystem.write"

func registerWorkspaceGrantLease(
	t *testing.T,
	fixture toolDispatchFixture,
) *model.ClientCapabilityLease {
	t.Helper()
	request := &model.RegisterClientCapabilityLeaseRequest{
		Advertisement: &model.ClientCapabilityAdvertisement{
			AdvertisementId:    "advertisement-workspace",
			DeviceId:           fixture.deviceID,
			DeviceSigningKeyId: proofTestSigningKeyID,
			Platform:           model.ClientPlatform_CLIENT_PLATFORM_DESKTOP,
			ConnectionId:       "connection-workspace",
			Capabilities: []*model.ClientCapability{{
				CapabilityId:   workspaceGrantTestCapability,
				SchemaVersion:  "1",
				Permission:     model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_GRANTED,
				PermissionKind: model.CapabilityPermissionKind_CAPABILITY_PERMISSION_KIND_FILESYSTEM,
				Constraints: &model.CapabilityConstraints{
					MaxRequestBytes:      4096,
					AllowedResourceKinds: []string{"workspace"},
				},
			}},
		},
	}
	fixture.signRequest(
		t,
		request,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REGISTER_LEASE,
		"register-workspace",
		41,
	)
	response, err := fixture.service.RegisterCapabilityLease(
		context.Background(),
		fixture.actorID,
		"auth-session-workspace",
		fixture.deviceID,
		request,
	)
	if err != nil {
		t.Fatalf("register workspace capability lease: %v", err)
	}
	seedLiveActorSession(t, fixture.db, "auth-session-workspace", fixture.now)
	return response.GetLease()
}

func workspaceGrantProposal(
	t *testing.T,
	fixture toolDispatchFixture,
	sessionID string,
	suffix string,
) ToolBatchProposal {
	t.Helper()
	bindingID := "binding-" + suffix
	snapshotID := "readiness-" + suffix
	manifest := &persistence.CapabilityManifest{
		CapabilityID: workspaceGrantTestCapability, Version: "1",
		SourceKind:       int32(model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CLIENT_NATIVE),
		SourceInstanceID: "local_file_write", DisplayMetadataJSON: "{}",
		InputSchemaRef:  "schema://" + workspaceGrantTestCapability + "/input",
		OutputSchemaRef: "schema://" + workspaceGrantTestCapability + "/output",
		ExecutionOwner: int32(
			model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY,
		),
		RequiredCapabilitiesJSON: "[]", RiskClass: "high",
		DefaultApprovalPolicy: int32(
			model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
		),
		SecretBoundary: "client",
		Availability: int32(
			model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE,
		),
		PayloadHash: hashString("manifest-" + suffix), CreatedAt: fixture.now,
	}
	if err := fixture.db.Create(manifest).Error; err != nil {
		t.Fatalf("persist write manifest: %v", err)
	}
	binding := &persistence.AgentCapabilityBinding{
		BindingID: bindingID, Ptid: fixture.actorID, AgentID: "agent-ws",
		CapabilityID: manifest.CapabilityID, CapabilityVersion: manifest.Version,
		Enabled: true,
		ApprovalPolicy: int32(
			model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
		),
		AgentVersion: 1, Revision: 1, UpdatedAt: fixture.now,
	}
	if err := fixture.db.Create(binding).Error; err != nil {
		t.Fatalf("persist write binding: %v", err)
	}
	selectedSession := sessionID
	snapshot := &model.CapabilityReadinessSnapshot{
		SnapshotId: snapshotID, Ptid: fixture.actorID, AgentId: binding.AgentID,
		SelectedClientSessionId: &selectedSession,
		Capabilities: []*model.CapabilityReadiness{{
			CapabilityId: manifest.CapabilityID, CapabilityVersion: manifest.Version,
			BindingId: bindingID, BindingRevision: binding.Revision,
			State: model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		}},
		CreatedAt: timestamppb.New(fixture.now),
		ExpiresAt: timestamppb.New(fixture.now.Add(time.Minute)),
	}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(snapshot)
	if err != nil {
		t.Fatalf("encode readiness snapshot: %v", err)
	}
	if err := fixture.db.Create(&persistence.CapabilityReadinessSnapshot{
		SnapshotID: snapshotID, Ptid: fixture.actorID, AgentID: binding.AgentID,
		Payload: payload, PayloadHash: hashBytes(payload), CreatedAt: fixture.now,
		ExpiresAt: fixture.now.Add(time.Minute),
	}).Error; err != nil {
		t.Fatalf("persist readiness snapshot: %v", err)
	}
	return ToolBatchProposal{
		ActorID: fixture.actorID, TurnID: "turn-" + suffix, AttemptID: "attempt-" + suffix,
		ToolBatchID: "batch-" + suffix, ConversationID: "conversation-ws", AgentID: binding.AgentID,
		Provider: "provider-1", Model: "model-1",
		ThinkingMode: "disabled",
		MaxRetries:   3, ContextWindowSize: 128000,
		ClientCapabilitySessionID: sessionID, ReadinessSnapshotID: snapshotID,
		Deadline: fixture.now.Add(time.Minute),
		Calls: []AuthorizedToolProposal{{
			ToolCallID: "tool-call-" + suffix, ToolName: "local_file_write",
			CapabilityID: manifest.CapabilityID, SchemaVersion: manifest.Version,
			BindingID: bindingID, BindingRevision: binding.Revision,
			ExecutionOwner: model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY,
			Arguments:      []byte(`{"path":"notes.txt","content":"hello"}`),
		}},
	}
}

func signedWorkspaceGrants(
	t *testing.T,
	fixture toolDispatchFixture,
	lease *model.ClientCapabilityLease,
	nonceByte byte,
) *model.DeclareClientResourceGrantsRequest {
	t.Helper()
	request := &model.DeclareClientResourceGrantsRequest{
		CapabilitySessionId: lease.GetCapabilitySessionId(),
		DeviceId:            fixture.deviceID,
		Grants: []*model.ClientResourceRef{{
			ResourceRef:         "wks-fixture",
			Ptid:                lease.GetPtid(),
			DeviceId:            fixture.deviceID,
			CapabilitySessionId: lease.GetCapabilitySessionId(),
			CapabilityId:        workspaceGrantTestCapability,
			ExpiresAt:           timestamppb.New(lease.GetExpiresAt().AsTime().Add(time.Hour)),
			PermissionGrantId:   "pgrant-wks-fixture",
			IntegrityHash:       hashString("workspace-root-fixture"),
		}},
	}
	fixture.signRequest(
		t,
		request,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_DECLARED_RESOURCE_GRANTS,
		"declare-workspace",
		nonceByte,
	)
	return request
}

func TestWorkspaceGrantGatesApprovalAndPinsEnvelope(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	lease := registerWorkspaceGrantLease(t, fixture)
	proposal := workspaceGrantProposal(
		t,
		fixture,
		lease.GetCapabilitySessionId(),
		"workspace",
	)
	fixture.seedTurnAuthority(t, proposal)
	if _, err := fixture.service.ProposeAuthorizedBatch(
		context.Background(),
		proposal,
	); err != nil {
		t.Fatalf("propose workspace batch: %v", err)
	}

	var decisions []persistence.ToolCall
	if err := fixture.db.
		Where("tool_call_id = ?", proposal.Calls[0].ToolCallID).
		Find(&decisions).Error; err != nil {
		t.Fatalf("load waiting approval: %v", err)
	}
	if len(decisions) != 1 ||
		decisions[0].Status != persistence.ToolCallStatusWaitingApproval {
		t.Fatalf("write call must wait for manual approval: %+v", decisions)
	}

	approve := func(decisionID string, nonceByte byte) *model.SubmitToolApprovalDecisionResponse {
		request := &model.SubmitToolApprovalDecisionRequest{
			ApprovalId:       decisions[0].ApprovalID,
			ToolCallId:       proposal.Calls[0].ToolCallID,
			DecisionId:       decisionID,
			ExpectedRevision: 0,
			Approved:         true,
			IdempotencyKey:   "decision-" + decisionID,
		}
		request.PayloadHash = decisionPayloadHash(request)
		response, err := fixture.service.SubmitDecision(
			context.Background(),
			fixture.actorID,
			request,
		)
		if err != nil {
			t.Fatalf("%s: %v", decisionID, err)
		}
		return response
	}

	blocked := approve("before-grant", 51)
	if blocked.GetAccepted() {
		t.Fatal("approval without a workspace grant must be rejected")
	}
	if blocked.GetOutcomeError().GetErrorType() !=
		"CLIENT_EXECUTOR_UNAVAILABLE" {
		t.Fatalf("unexpected blocked outcome: %+v", blocked.GetOutcomeError())
	}

	declare, err := fixture.service.DeclareCapabilityResourceGrants(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		signedWorkspaceGrants(t, fixture, lease, 61),
	)
	if err != nil {
		t.Fatalf("declare workspace grants: %v", err)
	}
	if declare.GetErrorCode() != 0 || declare.GetAcceptedCount() != 1 {
		t.Fatalf("unexpected declare response: %+v", declare)
	}

	accepted := approve("after-grant", 52)
	if !accepted.GetAccepted() {
		t.Fatalf("approval after workspace grant must be accepted: %+v", accepted)
	}

	pullRequest := &model.PullClientCapabilityRequestsRequest{
		CapabilitySessionId: lease.GetCapabilitySessionId(),
		DeviceId:            fixture.deviceID,
		AfterSequence:       0,
		Limit:               32,
	}
	fixture.signRequest(
		t,
		pullRequest,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
		"pull-workspace",
		71,
	)
	pull, err := fixture.service.PullCapabilityRequests(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		pullRequest,
	)
	if err != nil {
		t.Fatalf("pull workspace envelope: %v", err)
	}
	if len(pull.GetRequests()) != 1 {
		t.Fatalf("expected one envelope, got %d", len(pull.GetRequests()))
	}
	envelope := pull.GetRequests()[0]
	refs := envelope.GetResourceRefs()
	if len(refs) != 1 {
		t.Fatalf("envelope must carry exactly one resource grant, got %d", len(refs))
	}
	ref := refs[0]
	if ref.GetResourceRef() != "wks-fixture" ||
		ref.GetCapabilityId() != workspaceGrantTestCapability ||
		ref.GetCapabilitySessionId() != lease.GetCapabilitySessionId() ||
		ref.GetDeviceId() != fixture.deviceID ||
		ref.GetPtid() != lease.GetPtid() {
		t.Fatalf("envelope grant is not bound to the active lease: %+v", ref)
	}

	var persisted persistence.ToolCall
	if err := fixture.db.
		Where("tool_call_id = ?", proposal.Calls[0].ToolCallID).
		First(&persisted).Error; err != nil {
		t.Fatalf("load dispatched call: %v", err)
	}
	if len(persisted.ResourceRefs) == 0 {
		t.Fatal("dispatched tool call must persist the pinned resource refs")
	}
}

func TestWorkspaceGrantRejectsForeignLease(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	lease := registerWorkspaceGrantLease(t, fixture)
	request := signedWorkspaceGrants(t, fixture, lease, 81)
	request.Grants[0].CapabilitySessionId = "capability_session_other"
	// Re-sign over the tampered body so the signature check passes and the
	// lease binding validation is what rejects the declaration.
	request.CommandProof = nil
	fixture.signRequest(
		t,
		request,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_DECLARED_RESOURCE_GRANTS,
		"declare-workspace-foreign",
		82,
	)

	_, err := fixture.service.DeclareCapabilityResourceGrants(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		request,
	)
	if err == nil {
		t.Fatal("grant bound to another session must be rejected")
	}
}

func TestWorkspaceGrantRejectedForCapabilityWithoutResourceKind(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	// The base fixture lease grants filesystem.read without resource kinds.
	lease := fixture.session
	request := &model.DeclareClientResourceGrantsRequest{
		CapabilitySessionId: lease.GetCapabilitySessionId(),
		DeviceId:            fixture.deviceID,
		Grants: []*model.ClientResourceRef{{
			ResourceRef:         "wks-read-fixture",
			Ptid:                lease.GetPtid(),
			DeviceId:            fixture.deviceID,
			CapabilitySessionId: lease.GetCapabilitySessionId(),
			CapabilityId:        "filesystem.read",
			ExpiresAt:           timestamppb.New(lease.GetExpiresAt().AsTime().Add(time.Hour)),
			PermissionGrantId:   "pgrant-wks-read",
			IntegrityHash:       hashString("workspace-root-read"),
		}},
	}
	fixture.signRequest(
		t,
		request,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_DECLARED_RESOURCE_GRANTS,
		"declare-read",
		91,
	)
	if _, err := fixture.service.DeclareCapabilityResourceGrants(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		request,
	); err == nil {
		t.Fatal("grant for a capability without workspace constraints must be rejected")
	}
}
