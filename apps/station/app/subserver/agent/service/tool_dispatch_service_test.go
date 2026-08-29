package service

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	touchmodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

type toolDispatchFixture struct {
	db         *gorm.DB
	service    *ToolDispatchService
	now        time.Time
	actorID    string
	deviceID   string
	session    *model.ClientCapabilityLease
	privateKey ed25519.PrivateKey
}

func newToolDispatchFixture(t *testing.T) toolDispatchFixture {
	t.Helper()
	db := openConversationAuthorityDB(t, "tool_dispatch_"+strings.ReplaceAll(t.Name(), "/", "_"))
	if err := db.AutoMigrate(
		&persistence.ToolCall{},
		&persistence.ClientCapabilityLease{},
		&persistence.ToolBatch{},
		&persistence.ToolDecisionCommand{},
		&persistence.ToolDispatchOutbox{},
		&persistence.ReceiptRecoveryCredential{},
		&persistence.ClientCapabilityCommand{},
		&persistence.ToolReceiptAttempt{},
		&persistence.ToolResult{},
		&persistence.ToolContinuation{},
		&persistence.TurnAttempt{},
		&persistence.TurnTrace{},
		&persistence.ExecutionStep{},
		&persistence.ExecutorLease{},
		&persistence.CapabilityManifest{},
		&persistence.AgentCapabilityBinding{},
		&persistence.CapabilityReadinessSnapshot{},
	); err != nil {
		t.Fatalf("migrate tool dispatch models: %v", err)
	}

	now := time.Now().UTC()
	dispatch := NewToolDispatchService()
	dispatch.now = func() time.Time { return now }
	publicKey, privateKey := deterministicProofTestKey()
	dispatch.SetCapabilityProofService(NewClientCapabilityProofService(
		&deterministicDeviceSigningKeyResolver{key: &touchmodel.VerifiedActorDeviceSigningKey{
			ActorPtid:          proofTestActorID,
			ActorDeviceId:      proofTestDeviceID,
			SigningKeyId:       proofTestSigningKeyID,
			Ed25519PublicKey:   publicKey[:],
			VerificationSource: touchmodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION,
		}},
		nil,
		func() time.Time { return now },
	))
	fixture := toolDispatchFixture{
		db:         db,
		service:    dispatch,
		now:        now,
		actorID:    proofTestActorID,
		deviceID:   proofTestDeviceID,
		privateKey: privateKey,
	}
	registerRequest := &model.RegisterClientCapabilityLeaseRequest{
		Advertisement: &model.ClientCapabilityAdvertisement{
			AdvertisementId:    "advertisement-1",
			DeviceId:           fixture.deviceID,
			DeviceSigningKeyId: proofTestSigningKeyID,
			Platform:           model.ClientPlatform_CLIENT_PLATFORM_DESKTOP,
			ConnectionId:       "connection-1",
			Capabilities: []*model.ClientCapability{
				{
					CapabilityId:  "filesystem.read",
					SchemaVersion: "1",
					Permission:    model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_GRANTED,
					Constraints:   &model.CapabilityConstraints{MaxRequestBytes: 4096},
				},
				{
					CapabilityId:  "shell.execute",
					SchemaVersion: "1",
					Permission:    model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_GRANTED,
					Constraints:   &model.CapabilityConstraints{MaxRequestBytes: 4096},
				},
			},
		},
	}
	fixture.signRequest(t, registerRequest, model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REGISTER_LEASE, "register", 1)
	response, err := dispatch.RegisterCapabilityLease(
		context.Background(),
		fixture.actorID,
		"auth-session-1",
		fixture.deviceID,
		registerRequest,
	)
	if err != nil {
		t.Fatalf("register capability lease: %v", err)
	}
	fixture.session = response.GetLease()
	return fixture
}

func (f toolDispatchFixture) signRequest(
	t *testing.T,
	request proto.Message,
	domain model.ClientCapabilityCommandDomain,
	commandID string,
	nonceByte byte,
) {
	t.Helper()
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		t.Fatalf("marshal command body: %v", err)
	}
	bodyHash := sha256.Sum256(body)
	proof := &model.ClientCapabilityCommandProof{
		CommandId:          commandID,
		DeviceSigningKeyId: proofTestSigningKeyID,
		Nonce:              bytes.Repeat([]byte{nonceByte}, clientCapabilityCommandNonceSize),
		IssuedAt:           timestamppb.New(f.now),
	}
	signingPayload := &model.ClientCapabilityCommandSigningPayload{
		Domain:    domain,
		ActorPtid: f.actorID,
		DeviceId:  f.deviceID,
		CommandId: commandID,
		BodyHash:  bodyHash[:],
		Nonce:     proof.GetNonce(),
		IssuedAt:  proof.GetIssuedAt(),
	}
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(signingPayload)
	if err != nil {
		t.Fatalf("marshal signing payload: %v", err)
	}
	proof.Signature = ed25519.Sign(f.privateKey, signingBytes)
	attachCapabilityCommandProofForTest(t, request, proof)
}

func (f toolDispatchFixture) signedReceiptRequest(
	t *testing.T,
	receipt *model.ClientCapabilityReceipt,
) *model.SubmitClientCapabilityReceiptRequest {
	t.Helper()
	request := &model.SubmitClientCapabilityReceiptRequest{Receipt: receipt}
	f.signRequest(
		t,
		request,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_SUBMIT_ACTIVE_RECEIPT,
		fmt.Sprintf("receipt-%s-%d", receipt.GetRequestId(), receipt.GetSequence()),
		byte(receipt.GetSequence()+10),
	)
	return request
}

func (f toolDispatchFixture) propose(t *testing.T, callIDs ...string) ToolBatchProposal {
	t.Helper()
	proposal := f.authorizedProposal(
		t,
		"fixture",
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		true,
	)
	calls := make([]AuthorizedToolProposal, 0, len(callIDs))
	for _, callID := range callIDs {
		calls = append(calls, AuthorizedToolProposal{
			ToolCallID:      callID,
			ToolName:        "local_file_read",
			CapabilityID:    "filesystem.read",
			SchemaVersion:   "1",
			BindingID:       proposal.Calls[0].BindingID,
			BindingRevision: proposal.Calls[0].BindingRevision,
			ExecutionOwner:  proposal.Calls[0].ExecutionOwner,
			Arguments:       []byte(`{"resource_ref":"resource-1"}`),
		})
	}
	proposal.TurnID = "turn-1"
	proposal.AttemptID = "attempt-1"
	proposal.ToolBatchID = "batch-1"
	proposal.Calls = calls
	if _, err := f.service.ProposeAuthorizedBatch(
		context.Background(),
		proposal,
	); err != nil {
		t.Fatalf("propose tool batch: %v", err)
	}
	return proposal
}

func (f toolDispatchFixture) pullSingleEnvelope(t *testing.T) *model.ClientCapabilityRequest {
	t.Helper()
	request := f.signedPullRequest(t, "single", 2)
	response, err := f.service.PullCapabilityRequests(
		context.Background(),
		f.actorID,
		f.deviceID,
		request,
	)
	if err != nil {
		t.Fatalf("pull capability requests: %v", err)
	}
	if len(response.GetRequests()) != 1 {
		t.Fatalf("expected one capability request, got %d", len(response.GetRequests()))
	}
	return response.GetRequests()[0]
}

func TestCapabilitySessionReadbackUsesCanonicalLeasePTID(t *testing.T) {
	row := &persistence.ClientCapabilityLease{
		SessionID:    "session-1",
		ActorID:      "347760690666143747",
		DeviceID:     "device-1",
		PlatformKind: int32(model.ClientPlatform_CLIENT_PLATFORM_DESKTOP),
		ExpiresAt:    time.Now().Add(time.Minute),
	}
	lease := &model.ClientCapabilityLease{
		Ptid: "ptid:v1:actor:peers:p:alice:fixture",
	}

	session := capabilitySessionFromLeaseRow(row, lease)

	if session.GetPtid() != lease.GetPtid() {
		t.Fatalf(
			"capability session leaked internal actor ID: got %q want %q",
			session.GetPtid(),
			lease.GetPtid(),
		)
	}
}

func TestToolDispatchServiceRejectsCrossDeviceCapabilitySessionPull(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	foreignLease := proto.Clone(fixture.session).(*model.ClientCapabilityLease)
	foreignLease.DeviceId = "device-other"
	encodedLease, err := proto.MarshalOptions{Deterministic: true}.Marshal(foreignLease)
	if err != nil {
		t.Fatalf("encode foreign-device lease: %v", err)
	}
	if err := fixture.db.Model(&persistence.ClientCapabilityLease{}).
		Where("session_id = ?", fixture.session.GetCapabilitySessionId()).
		Updates(map[string]interface{}{
			"device_id":     foreignLease.GetDeviceId(),
			"lease_payload": encodedLease,
		}).Error; err != nil {
		t.Fatalf("persist foreign-device lease: %v", err)
	}

	response, err := fixture.service.PullCapabilityRequests(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedPullRequest(t, "cross-device-session", 22),
	)
	if response != nil {
		t.Fatalf("cross-device capability pull returned response: %+v", response)
	}
	var businessError *errcode.BizError
	if !errors.As(err, &businessError) ||
		businessError.Code != errcode.AgentUnauthorized {
		t.Fatalf("cross-device capability pull error = %v", err)
	}

	var commandCount int64
	if err := fixture.db.Model(&persistence.ClientCapabilityCommand{}).
		Where("command_id = ?", "pull-cross-device-session").
		Count(&commandCount).Error; err != nil {
		t.Fatalf("count rejected capability command: %v", err)
	}
	if commandCount != 0 {
		t.Fatalf("cross-device capability pull committed %d command rows", commandCount)
	}
}

func (f toolDispatchFixture) signedPullRequest(
	t *testing.T,
	suffix string,
	nonceByte byte,
) *model.PullClientCapabilityRequestsRequest {
	t.Helper()
	request := &model.PullClientCapabilityRequestsRequest{
		CapabilitySessionId: f.session.GetCapabilitySessionId(),
		DeviceId:            f.deviceID,
	}
	f.signRequest(
		t,
		request,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
		"pull-"+suffix,
		nonceByte,
	)
	return request
}

func TestBrowserCapabilitySessionAllowsEmptyCapabilitiesAndListsByActor(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	request := &model.RegisterClientCapabilityLeaseRequest{
		Advertisement: &model.ClientCapabilityAdvertisement{
			AdvertisementId:    "browser-advertisement",
			DeviceId:           fixture.deviceID,
			DeviceSigningKeyId: proofTestSigningKeyID,
			Platform:           model.ClientPlatform_CLIENT_PLATFORM_BROWSER,
			ConnectionId:       "browser-connection",
		},
	}
	fixture.signRequest(
		t,
		request,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REGISTER_LEASE,
		"register-browser",
		31,
	)
	response, err := fixture.service.RegisterCapabilityLease(
		context.Background(),
		fixture.actorID,
		"auth-session-1",
		fixture.deviceID,
		request,
	)
	if err != nil {
		t.Fatalf("register browser capability lease: %v", err)
	}
	browserLease := response.GetLease()
	if browserLease.GetPlatform() != model.ClientPlatform_CLIENT_PLATFORM_BROWSER ||
		len(browserLease.GetCapabilities()) != 0 {
		t.Fatalf("unexpected browser capability lease: %+v", browserLease)
	}

	sessions, err := fixture.service.ListCapabilitySessions(
		context.Background(),
		fixture.actorID,
	)
	if err != nil {
		t.Fatalf("list browser capability sessions: %v", err)
	}
	if len(sessions.GetSessions()) != 2 {
		t.Fatalf("expected desktop and browser sessions, got %+v", sessions.GetSessions())
	}
	var browserSession *model.ClientCapabilitySession
	for _, session := range sessions.GetSessions() {
		if session.GetSessionId() == browserLease.GetCapabilitySessionId() {
			browserSession = session
			break
		}
	}
	if browserSession == nil || browserSession.GetConnectionId() != "browser-connection" {
		t.Fatalf("browser session readback mismatch: %+v", sessions.GetSessions())
	}
	if browserSession.GetPtid() != browserLease.GetPtid() {
		t.Fatalf(
			"browser session PTID mismatch: got %q want %q",
			browserSession.GetPtid(),
			browserLease.GetPtid(),
		)
	}
	resolved, err := fixture.service.GetActiveCapabilitySession(
		context.Background(),
		fixture.actorID,
		browserLease.GetCapabilitySessionId(),
	)
	if err != nil {
		t.Fatalf("resolve browser capability session: %v", err)
	}
	if resolved == nil ||
		resolved.GetPlatformKind() != model.ClientPlatform_CLIENT_PLATFORM_BROWSER {
		t.Fatalf("resolved browser capability session mismatch: %+v", resolved)
	}

	otherActor, err := fixture.service.ListCapabilitySessions(
		context.Background(),
		"ptid:other-actor",
	)
	if err != nil {
		t.Fatalf("list other actor capability sessions: %v", err)
	}
	if len(otherActor.GetSessions()) != 0 {
		t.Fatalf("cross-actor capability sessions leaked: %+v", otherActor.GetSessions())
	}

	if err := fixture.db.Model(&persistence.ClientCapabilityLease{}).
		Where("session_id = ?", browserLease.GetCapabilitySessionId()).
		Update("revoked_at", fixture.now).Error; err != nil {
		t.Fatalf("revoke browser capability session fixture: %v", err)
	}
	if err := fixture.db.Model(&persistence.ClientCapabilityLease{}).
		Where("session_id = ?", fixture.session.GetCapabilitySessionId()).
		Update("expires_at", fixture.now.Add(-time.Minute)).Error; err != nil {
		t.Fatalf("expire desktop capability session fixture: %v", err)
	}
	active, err := fixture.service.ListCapabilitySessions(
		context.Background(),
		fixture.actorID,
	)
	if err != nil {
		t.Fatalf("list filtered capability sessions: %v", err)
	}
	if len(active.GetSessions()) != 0 {
		t.Fatalf("revoked or expired capability session leaked: %+v", active.GetSessions())
	}
	resolved, err = fixture.service.GetActiveCapabilitySession(
		context.Background(),
		fixture.actorID,
		browserLease.GetCapabilitySessionId(),
	)
	if err != nil {
		t.Fatalf("resolve revoked capability session: %v", err)
	}
	if resolved != nil {
		t.Fatalf("revoked capability session remained selectable: %+v", resolved)
	}
}

func TestToolDispatchServiceProposeAuthorizedBatchPersistsEveryCall(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-1", "tool-call-2")

	var count int64
	if err := fixture.db.Model(&persistence.ToolCall{}).
		Where("tool_batch_id = ?", "batch-1").
		Count(&count).Error; err != nil {
		t.Fatalf("count tool calls: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected two tool calls, got %d", count)
	}
}

func TestToolDispatchServiceProposeAuthorizedBatchUsesCapabilityAuthority(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	proposal := fixture.authorizedProposal(
		t,
		"authorized-batch",
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		true,
	)
	decisions, err := fixture.service.ProposeAuthorizedBatch(context.Background(), proposal)
	if err != nil {
		t.Fatalf("propose authorized batch: %v", err)
	}
	if len(decisions) != 1 ||
		decisions[0].Status != persistence.ToolCallStatusWaitingApproval {
		t.Fatalf("binding policy did not govern proposal: %+v", decisions)
	}

	var call persistence.ToolCall
	if err := fixture.db.Where("tool_batch_id = ?", proposal.ToolBatchID).First(&call).Error; err != nil {
		t.Fatalf("load authorized tool call: %v", err)
	}
	if call.ManifestID != "filesystem.read" ||
		call.BindingID != "binding-authorized-batch" ||
		call.ReadinessSnapID != "readiness-authorized-batch" ||
		call.ApprovalPolicy != string(ToolPolicyManual) {
		t.Fatalf("tool call authority lineage mismatch: %+v", call)
	}
}

func TestToolDispatchServiceProposeAuthorizedBatchFailsClosed(t *testing.T) {
	tests := []struct {
		name      string
		enabled   bool
		readiness model.CapabilityReadinessState
	}{
		{name: "disabled binding", enabled: false, readiness: model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY},
		{name: "unavailable snapshot", enabled: true, readiness: model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newToolDispatchFixture(t)
			proposal := fixture.authorizedProposal(
				t,
				strings.ReplaceAll(test.name, " ", "-"),
				model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
				test.readiness,
				test.enabled,
			)
			if _, err := fixture.service.ProposeAuthorizedBatch(
				context.Background(), proposal,
			); !isCapabilityError(err, errcode.AgentInvalidSourceState) {
				t.Fatalf("invalid authority accepted: %v", err)
			}
			var count int64
			if err := fixture.db.Model(&persistence.ToolCall{}).
				Where("tool_batch_id = ?", proposal.ToolBatchID).
				Count(&count).Error; err != nil {
				t.Fatalf("count rejected tool calls: %v", err)
			}
			if count != 0 {
				t.Fatalf("invalid authority persisted %d tool calls", count)
			}
		})
	}
}

func TestTurnServiceExecutesAuthorizedStationToolExactlyOnce(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	proposal := fixture.authorizedProposalForOwner(
		t,
		"station-auto",
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		true,
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION,
	)
	if _, err := fixture.service.ProposeAuthorizedBatch(
		context.Background(),
		proposal,
	); err != nil {
		t.Fatalf("propose Station tool: %v", err)
	}

	executionCount := 0
	registry := NewToolRegistryService(nil, nil)
	registry.Register(&domain.ToolDefinition{
		Name:       proposal.Calls[0].ToolName,
		JSONSchema: []byte(`{"type":"object"}`),
		Handler: func(
			_ context.Context,
			_ *domain.ToolCallMeta,
			_ json.RawMessage,
		) (*domain.ToolResult, error) {
			executionCount++
			return &domain.ToolResult{Content: "station result"}, nil
		},
	})
	turnService := &TurnService{
		toolDispatch: fixture.service,
		toolRegistry: registry,
	}
	if err := turnService.executeReadyStationTools(context.Background()); err != nil {
		t.Fatalf("execute Station tool: %v", err)
	}
	if err := turnService.executeReadyStationTools(context.Background()); err != nil {
		t.Fatalf("repeat Station tool worker: %v", err)
	}
	if executionCount != 1 {
		t.Fatalf("Station tool execution count = %d, want 1", executionCount)
	}

	var call persistence.ToolCall
	if err := fixture.db.Where(
		"tool_call_id = ?",
		proposal.Calls[0].ToolCallID,
	).First(&call).Error; err != nil {
		t.Fatalf("load Station tool call: %v", err)
	}
	if call.Status != persistence.ToolCallStatusSucceeded ||
		call.ExecutionAttemptCount != 1 ||
		call.ExecutionClaimID == "" ||
		call.SideEffectReceipt == "" ||
		call.ResultID == "" {
		t.Fatalf("Station tool lineage is incomplete: %+v", call)
	}
	var resultCount int64
	if err := fixture.db.Model(&persistence.ToolResult{}).
		Where("tool_call_id = ?", call.ToolCallID).
		Count(&resultCount).Error; err != nil {
		t.Fatalf("count Station tool results: %v", err)
	}
	var continuationCount int64
	if err := fixture.db.Model(&persistence.ToolContinuation{}).
		Where("tool_batch_id = ?", call.ToolBatchID).
		Count(&continuationCount).Error; err != nil {
		t.Fatalf("count Station tool continuations: %v", err)
	}
	if resultCount != 1 || continuationCount != 1 {
		t.Fatalf(
			"Station result/continuation counts = %d/%d, want 1/1",
			resultCount,
			continuationCount,
		)
	}

	if _, err := fixture.service.ProposeAuthorizedBatch(
		context.Background(),
		proposal,
	); err != nil {
		t.Fatalf("replay Station tool proposal: %v", err)
	}
	if err := turnService.executeReadyStationTools(context.Background()); err != nil {
		t.Fatalf("execute after duplicate proposal: %v", err)
	}
	if executionCount != 1 {
		t.Fatalf("duplicate proposal executed Station tool %d times", executionCount)
	}
	if err := fixture.db.Where("id = ?", call.ID).First(&call).Error; err != nil {
		t.Fatalf("reload duplicate Station tool call: %v", err)
	}
	if call.DuplicateDeliveryCount != 1 {
		t.Fatalf(
			"duplicate delivery count = %d, want 1",
			call.DuplicateDeliveryCount,
		)
	}
}

func TestStationToolPolicyBlocksExecutionUntilApproved(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	proposal := fixture.authorizedProposalForOwner(
		t,
		"station-manual",
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		true,
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION,
	)
	decisions, err := fixture.service.ProposeAuthorizedBatch(
		context.Background(),
		proposal,
	)
	if err != nil {
		t.Fatalf("propose manual Station tool: %v", err)
	}

	executionCount := 0
	registry := NewToolRegistryService(nil, nil)
	registry.Register(&domain.ToolDefinition{
		Name:       proposal.Calls[0].ToolName,
		JSONSchema: []byte(`{"type":"object"}`),
		Handler: func(
			_ context.Context,
			_ *domain.ToolCallMeta,
			_ json.RawMessage,
		) (*domain.ToolResult, error) {
			executionCount++
			return &domain.ToolResult{Content: "approved result"}, nil
		},
	})
	turnService := &TurnService{
		toolDispatch: fixture.service,
		toolRegistry: registry,
	}
	if err := turnService.executeReadyStationTools(context.Background()); err != nil {
		t.Fatalf("execute unapproved Station tool: %v", err)
	}
	if executionCount != 0 {
		t.Fatalf("manual Station tool executed before approval")
	}
	if len(decisions) != 1 {
		t.Fatalf("manual Station decision count = %d, want 1", len(decisions))
	}
	decision := &model.SubmitToolApprovalDecisionRequest{
		ApprovalId:       decisions[0].ApprovalID,
		ToolCallId:       proposal.Calls[0].ToolCallID,
		DecisionId:       "decision-station-manual",
		ExpectedRevision: decisions[0].DecisionRevision,
		Approved:         true,
		IdempotencyKey:   "decision-station-manual",
	}
	decision.PayloadHash = decisionPayloadHash(decision)
	if _, err := fixture.service.SubmitDecision(
		context.Background(),
		fixture.actorID,
		decision,
	); err != nil {
		t.Fatalf("approve Station tool: %v", err)
	}
	if err := turnService.executeReadyStationTools(context.Background()); err != nil {
		t.Fatalf("execute approved Station tool: %v", err)
	}
	if executionCount != 1 {
		t.Fatalf("approved Station tool execution count = %d, want 1", executionCount)
	}
}

func TestStationToolDenyAndExpiryExecuteZeroTimes(t *testing.T) {
	tests := []struct {
		name   string
		policy model.CapabilityApprovalPolicy
		expire bool
	}{
		{
			name:   "deny",
			policy: model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_DENY,
		},
		{
			name:   "expiry",
			policy: model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
			expire: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newToolDispatchFixture(t)
			proposal := fixture.authorizedProposalForOwner(
				t,
				"station-"+test.name,
				test.policy,
				model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
				true,
				model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION,
			)
			if _, err := fixture.service.ProposeAuthorizedBatch(
				context.Background(),
				proposal,
			); err != nil {
				t.Fatalf("propose %s Station tool: %v", test.name, err)
			}
			if test.expire {
				fixture.service.now = func() time.Time {
					return proposal.Deadline.Add(time.Second)
				}
				if _, err := fixture.service.SettleExpiredToolCalls(
					context.Background(),
				); err != nil {
					t.Fatalf("expire Station tool: %v", err)
				}
			}

			executionCount := 0
			registry := NewToolRegistryService(nil, nil)
			registry.Register(&domain.ToolDefinition{
				Name:       proposal.Calls[0].ToolName,
				JSONSchema: []byte(`{"type":"object"}`),
				Handler: func(
					_ context.Context,
					_ *domain.ToolCallMeta,
					_ json.RawMessage,
				) (*domain.ToolResult, error) {
					executionCount++
					return &domain.ToolResult{Content: "unexpected"}, nil
				},
			})
			turnService := &TurnService{
				toolDispatch: fixture.service,
				toolRegistry: registry,
			}
			if err := turnService.executeReadyStationTools(context.Background()); err != nil {
				t.Fatalf("execute %s Station tool: %v", test.name, err)
			}
			if executionCount != 0 {
				t.Fatalf("%s Station tool executed %d times", test.name, executionCount)
			}

			var call persistence.ToolCall
			if err := fixture.db.Where(
				"tool_call_id = ?",
				proposal.Calls[0].ToolCallID,
			).First(&call).Error; err != nil {
				t.Fatalf("load %s Station tool: %v", test.name, err)
			}
			expectedStatus := persistence.ToolCallStatusDenied
			if test.expire {
				expectedStatus = persistence.ToolCallStatusExpired
			}
			if call.Status != expectedStatus ||
				call.ExecutionAttemptCount != 0 ||
				call.ResultID != "" {
				t.Fatalf("%s Station tool state is invalid: %+v", test.name, call)
			}
		})
	}
}

func (f toolDispatchFixture) authorizedProposal(
	t *testing.T,
	suffix string,
	policy model.CapabilityApprovalPolicy,
	readiness model.CapabilityReadinessState,
	enabled bool,
) ToolBatchProposal {
	return f.authorizedProposalForOwner(
		t,
		suffix,
		policy,
		readiness,
		enabled,
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY,
	)
}

func (f toolDispatchFixture) authorizedProposalForOwner(
	t *testing.T,
	suffix string,
	policy model.CapabilityApprovalPolicy,
	readiness model.CapabilityReadinessState,
	enabled bool,
	executionOwner model.ToolExecutionOwner,
) ToolBatchProposal {
	t.Helper()
	bindingID := "binding-" + suffix
	snapshotID := "readiness-" + suffix
	toolName := "local_file_read"
	capabilityID := "filesystem.read"
	selectedSessionID := f.session.GetCapabilitySessionId()
	if executionOwner == model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION {
		toolName = "station_test_tool"
		capabilityID = "tool:station_test_tool"
		selectedSessionID = ""
	}
	manifest := &persistence.CapabilityManifest{
		CapabilityID: capabilityID, Version: "1",
		SourceKind:       int32(model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL),
		SourceInstanceID: toolName, DisplayMetadataJSON: "{}",
		InputSchemaRef: "schema://" + capabilityID + "/input", OutputSchemaRef: "schema://" + capabilityID + "/output",
		ExecutionOwner:           int32(executionOwner),
		RequiredCapabilitiesJSON: "[]", RiskClass: "read", DefaultApprovalPolicy: int32(policy),
		SecretBoundary: "station", Availability: int32(model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE),
		PayloadHash: hashString("manifest-" + suffix), CreatedAt: f.now,
	}
	if executionOwner == model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY {
		manifest.SecretBoundary = "client"
	}
	if err := f.db.Create(manifest).Error; err != nil {
		t.Fatalf("persist authority manifest: %v", err)
	}
	binding := &persistence.AgentCapabilityBinding{
		BindingID: bindingID, Ptid: f.actorID, AgentID: "agent-1",
		CapabilityID: manifest.CapabilityID, CapabilityVersion: manifest.Version,
		Enabled: enabled, ApprovalPolicy: int32(policy), AgentVersion: 1, Revision: 1, UpdatedAt: f.now,
	}
	if err := f.db.Create(binding).Error; err != nil {
		t.Fatalf("persist authority binding: %v", err)
	}
	snapshot := &model.CapabilityReadinessSnapshot{
		SnapshotId: snapshotID, Ptid: f.actorID, AgentId: binding.AgentID,
		SelectedClientSessionId: &selectedSessionID,
		Capabilities: []*model.CapabilityReadiness{{
			CapabilityId: manifest.CapabilityID, CapabilityVersion: manifest.Version,
			BindingId: bindingID, BindingRevision: binding.Revision, State: readiness,
		}},
		CreatedAt: timestamppb.New(f.now), ExpiresAt: timestamppb.New(f.now.Add(time.Minute)),
	}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(snapshot)
	if err != nil {
		t.Fatalf("encode readiness snapshot: %v", err)
	}
	if err := f.db.Create(&persistence.CapabilityReadinessSnapshot{
		SnapshotID: snapshotID, Ptid: f.actorID, AgentID: binding.AgentID,
		Payload: payload, PayloadHash: hashBytes(payload), CreatedAt: f.now,
		ExpiresAt: f.now.Add(time.Minute),
	}).Error; err != nil {
		t.Fatalf("persist readiness snapshot: %v", err)
	}
	return ToolBatchProposal{
		ActorID: f.actorID, TurnID: "turn-" + suffix, AttemptID: "attempt-" + suffix,
		ToolBatchID: "batch-" + suffix, ConversationID: "conversation-1", AgentID: binding.AgentID,
		Provider: "provider-1", Model: "model-1", ThinkingMode: string(domain.ThinkingModeDisabled),
		MaxRetries: 3, ContextWindowSize: 128000,
		ClientCapabilitySessionID: f.session.GetCapabilitySessionId(), ReadinessSnapshotID: snapshotID,
		Deadline: f.now.Add(time.Minute),
		Calls: []AuthorizedToolProposal{{
			ToolCallID: "tool-call-" + suffix, ToolName: toolName,
			CapabilityID: manifest.CapabilityID, SchemaVersion: manifest.Version,
			BindingID: bindingID, BindingRevision: binding.Revision,
			ExecutionOwner: executionOwner,
			Arguments:      []byte(`{"value":"fixture"}`),
		}},
	}
}

func TestToolDispatchServiceSubmitReceipt(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-1")
	envelope := fixture.pullSingleEnvelope(t)

	receipt := &model.ClientCapabilityReceipt{
		RequestId:           envelope.GetRequestId(),
		TurnId:              envelope.GetTurnId(),
		ToolCallId:          envelope.GetToolCallId(),
		CapabilitySessionId: envelope.GetCapabilitySessionId(),
		TargetDeviceId:      envelope.GetTargetDeviceId(),
		DecisionId:          envelope.GetDecisionId(),
		DecisionRevision:    envelope.GetDecisionRevision(),
		ExecutionClaimId:    envelope.GetExecutionClaimId(),
		ExecutorLeaseId:     envelope.GetExecutorLeaseId(),
		FencingToken:        envelope.GetFencingToken(),
		DispatchSequence:    envelope.GetDispatchSequence(),
		PayloadHash:         envelope.GetPayloadHash(),
		SideEffectReceiptId: "side-effect-1",
		Status:              model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED,
		ResultId:            "result-1",
		ToolBatchId:         envelope.GetToolBatchId(),
		Sequence:            1,
		OccurredAt:          timestamppb.New(fixture.now),
	}
	response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, receipt),
	)
	if err != nil {
		t.Fatalf("submit out-of-order receipt: %v", err)
	}
	if response.GetAccepted() {
		t.Fatal("out-of-order APPLIED receipt must not be accepted")
	}
	if response.GetErrorCode() != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_INVALID_TRANSITION {
		t.Fatalf("expected invalid transition, got %s", response.GetErrorCode())
	}

	var attempt persistence.ToolReceiptAttempt
	if err := fixture.db.Where("request_id = ? AND sequence = ?", envelope.GetRequestId(), 1).
		First(&attempt).Error; err != nil {
		t.Fatalf("load rejected receipt attempt: %v", err)
	}
	if attempt.Accepted {
		t.Fatal("rejected receipt attempt must be persisted with accepted=false")
	}
}

func TestToolDispatchServicePreparedReceiptRechecksDeadlineAfterLocks(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-fresh-receipt-clock")
	envelope := fixture.pullSingleEnvelope(t)
	prepared := receiptForEnvelope(
		envelope,
		1,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)

	clockReads := 0
	fixture.service.now = func() time.Time {
		clockReads++
		if clockReads == 1 {
			return fixture.now
		}
		return envelope.GetExecutionDeadline().AsTime().Add(time.Second)
	}
	response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	)
	if err != nil {
		t.Fatalf("submit deadline-crossing PREPARED receipt: %v", err)
	}
	if response.GetAccepted() ||
		response.GetErrorCode() != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_EXPIRED {
		t.Fatalf("deadline-crossing PREPARED receipt response = %+v", response)
	}

	var call persistence.ToolCall
	if err := fixture.db.First(&call, "tool_call_id = ?", envelope.GetToolCallId()).Error; err != nil {
		t.Fatalf("reload deadline-crossing tool call: %v", err)
	}
	if call.Status != persistence.ToolCallStatusDispatchCommitted || call.StartedAt != nil {
		t.Fatalf("deadline-crossing PREPARED receipt changed call: %+v", call)
	}
}

func TestToolDispatchServicePreparedReceiptRejectsRenewedLeaseRevision(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-renewed-before-prepared")
	envelope := fixture.pullSingleEnvelope(t)
	if err := fixture.db.Model(&persistence.ClientCapabilityLease{}).
		Where("session_id = ?", envelope.GetCapabilitySessionId()).
		Update("lease_revision", envelope.GetCapabilityLeaseRevision()+1).Error; err != nil {
		t.Fatalf("advance capability lease revision: %v", err)
	}

	prepared := receiptForEnvelope(
		envelope,
		1,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)
	response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	)
	if err != nil {
		t.Fatalf("submit stale-revision PREPARED receipt: %v", err)
	}
	if response.GetAccepted() ||
		response.GetErrorCode() != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH {
		t.Fatalf("stale-revision PREPARED receipt response = %+v", response)
	}

	var call persistence.ToolCall
	if err := fixture.db.First(&call, "tool_call_id = ?", envelope.GetToolCallId()).Error; err != nil {
		t.Fatalf("reload stale-revision tool call: %v", err)
	}
	if call.Status != persistence.ToolCallStatusDispatchCommitted || call.StartedAt != nil {
		t.Fatalf("stale-revision PREPARED receipt changed call: %+v", call)
	}
}

func TestToolDispatchServiceRejectsInvalidReceiptAuthority(t *testing.T) {
	testCases := []struct {
		name              string
		mutate            func(toolDispatchFixture, *model.ClientCapabilityReceipt)
		actorID           string
		deviceID          string
		expectCode        model.ClientCapabilityReceiptErrorCode
		expectCommandCode model.ClientCapabilityCommandErrorCode
	}{
		{
			name:              "actor",
			mutate:            func(_ toolDispatchFixture, _ *model.ClientCapabilityReceipt) {},
			actorID:           "actor-other",
			expectCommandCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_KEY_NOT_FOUND,
		},
		{
			name:              "device",
			mutate:            func(_ toolDispatchFixture, _ *model.ClientCapabilityReceipt) {},
			deviceID:          "device-other",
			expectCommandCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
		},
		{
			name: "session",
			mutate: func(_ toolDispatchFixture, receipt *model.ClientCapabilityReceipt) {
				receipt.CapabilitySessionId = "session-other"
			},
			expectCode: model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH,
		},
		{
			name: "claim",
			mutate: func(_ toolDispatchFixture, receipt *model.ClientCapabilityReceipt) {
				receipt.ExecutionClaimId = "claim-other"
			},
			expectCode: model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH,
		},
		{
			name: "revision",
			mutate: func(_ toolDispatchFixture, receipt *model.ClientCapabilityReceipt) {
				receipt.DecisionRevision++
			},
			expectCode: model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH,
		},
		{
			name: "fence",
			mutate: func(_ toolDispatchFixture, receipt *model.ClientCapabilityReceipt) {
				receipt.FencingToken++
			},
			expectCode: model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_STALE_FENCE,
		},
		{
			name: "payload",
			mutate: func(_ toolDispatchFixture, receipt *model.ClientCapabilityReceipt) {
				receipt.PayloadHash = "payload-other"
			},
			expectCode: model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_PAYLOAD_CONFLICT,
		},
		{
			name: "expired",
			mutate: func(fixture toolDispatchFixture, _ *model.ClientCapabilityReceipt) {
				fixture.service.now = func() time.Time { return fixture.now.Add(2 * time.Minute) }
			},
			expectCode: model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_EXPIRED,
		},
		{
			name: "revoked",
			mutate: func(fixture toolDispatchFixture, _ *model.ClientCapabilityReceipt) {
				revokedAt := fixture.now
				if err := fixture.db.Model(&persistence.ClientCapabilityLease{}).
					Where("session_id = ?", fixture.session.GetCapabilitySessionId()).
					Update("revoked_at", revokedAt).Error; err != nil {
					t.Fatalf("revoke capability lease: %v", err)
				}
			},
			expectCode: model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newToolDispatchFixture(t)
			fixture.propose(t, "tool-call-1")
			envelope := fixture.pullSingleEnvelope(t)
			prepared := receiptForEnvelope(
				envelope,
				1,
				model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
			)
			if response, err := fixture.service.SubmitReceipt(
				context.Background(),
				fixture.actorID,
				fixture.deviceID,
				fixture.signedReceiptRequest(t, prepared),
			); err != nil || !response.GetAccepted() {
				t.Fatalf("submit prepared receipt: response=%+v err=%v", response, err)
			}

			receipt := receiptForEnvelope(
				envelope,
				2,
				model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED,
			)
			receipt.ResultId = "result-1"
			receipt.BoundedResult = []byte(`{"ok":true}`)
			testCase.mutate(fixture, receipt)
			actorID := testCase.actorID
			if actorID == "" {
				actorID = fixture.actorID
			}
			deviceID := testCase.deviceID
			if deviceID == "" {
				deviceID = fixture.deviceID
			}
			response, err := fixture.service.SubmitReceipt(
				context.Background(),
				actorID,
				deviceID,
				fixture.signedReceiptRequest(t, receipt),
			)
			if err != nil {
				t.Fatalf("submit mismatched receipt: %v", err)
			}
			if response.GetAccepted() ||
				response.GetErrorCode() != testCase.expectCode ||
				response.GetCommandErrorCode() != testCase.expectCommandCode {
				t.Fatalf(
					"expected receipt=%s command=%s, got %+v",
					testCase.expectCode,
					testCase.expectCommandCode,
					response,
				)
			}
		})
	}
}

func TestToolDispatchServiceTerminalReceiptRollsBackAtomically(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-1")
	envelope := fixture.pullSingleEnvelope(t)
	prepared := receiptForEnvelope(envelope, 1, model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit prepared receipt: response=%+v err=%v", response, err)
	}

	const callbackName = "test:reject_tool_result_create"
	if err := fixture.db.Callback().Create().Before("gorm:create").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == (persistence.ToolResult{}).TableName() {
			tx.AddError(errors.New("injected tool result persistence failure"))
		}
	}); err != nil {
		t.Fatalf("register create failure callback: %v", err)
	}
	defer fixture.db.Callback().Create().Remove(callbackName)

	applied := receiptForEnvelope(envelope, 2, model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED)
	applied.ResultId = "result-1"
	applied.BoundedResult = []byte(`{"ok":true}`)
	if _, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, applied),
	); err == nil {
		t.Fatal("expected terminal receipt transaction to fail")
	}

	for table, modelValue := range map[string]interface{}{
		"tool result":  &persistence.ToolResult{},
		"continuation": &persistence.ToolContinuation{},
		"tool message": &persistence.AgentMessage{},
	} {
		var count int64
		if err := fixture.db.Model(modelValue).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("%s must roll back with terminal receipt, got %d rows", table, count)
		}
	}
	var call persistence.ToolCall
	if err := fixture.db.First(&call, "tool_call_id = ?", envelope.GetToolCallId()).Error; err != nil {
		t.Fatalf("reload tool call: %v", err)
	}
	if call.Status != persistence.ToolCallStatusPrepared {
		t.Fatalf("tool call must remain prepared after rollback, got %s", call.Status)
	}
}

func TestToolDispatchServiceSettleExpiredToolCalls(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-dispatched", "tool-call-prepared")
	pulled, err := fixture.service.PullCapabilityRequests(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedPullRequest(t, "settle", 3),
	)
	if err != nil {
		t.Fatalf("pull capability requests: %v", err)
	}
	if len(pulled.GetRequests()) != 2 {
		t.Fatalf("expected two capability requests, got %d", len(pulled.GetRequests()))
	}
	prepared := receiptForEnvelope(
		pulled.GetRequests()[1],
		1,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit prepared receipt: response=%+v err=%v", response, err)
	}

	fixture.service.now = func() time.Time { return fixture.now.Add(2 * time.Minute) }
	affected, err := fixture.service.SettleExpiredToolCalls(context.Background())
	if err != nil {
		t.Fatalf("settle expired tool calls: %v", err)
	}
	if affected != 1 {
		t.Fatalf("expected only the unprepared call to expire, got %d", affected)
	}

	var calls []persistence.ToolCall
	if err := fixture.db.Order("tool_call_id ASC").Find(&calls).Error; err != nil {
		t.Fatalf("load settled tool calls: %v", err)
	}
	statusByID := make(map[string]string, len(calls))
	for i := range calls {
		statusByID[calls[i].ToolCallID] = calls[i].Status
	}
	if statusByID["tool-call-dispatched"] != persistence.ToolCallStatusExpired {
		t.Fatalf("unprepared call must expire, got %s", statusByID["tool-call-dispatched"])
	}
	if statusByID["tool-call-prepared"] != persistence.ToolCallStatusPrepared {
		t.Fatalf("prepared call must remain reconcilable, got %s", statusByID["tool-call-prepared"])
	}
	fixture.service.now = func() time.Time { return fixture.now.Add(12 * time.Minute) }
	affected, err = fixture.service.SettleExpiredToolCalls(context.Background())
	if err != nil || affected != 1 {
		t.Fatalf("settle reconciliation deadline: affected=%d err=%v", affected, err)
	}
	var batch persistence.ToolBatch
	if err := fixture.db.First(&batch, "id = ?", "batch-1").Error; err != nil {
		t.Fatalf("load settled batch: %v", err)
	}
	if batch.Status != persistence.ToolBatchStatusBlocked {
		t.Fatalf("expired batch must be blocked, got %s", batch.Status)
	}
}

func TestToolDispatchServiceReconcileExpiredContinuations(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	expiredAt := fixture.now.Add(-time.Minute)
	row := &persistence.ToolContinuation{
		ID:                     "continuation-1",
		TurnID:                 "turn-1",
		AttemptID:              "attempt-1",
		ToolBatchID:            "batch-1",
		Status:                 persistence.ToolContinuationStatusClaimed,
		LeaseID:                "continuation-lease-1",
		FencingToken:           1,
		LeaseExpiresAt:         &expiredAt,
		ProviderRequestEmitted: true,
		ProviderIdempotent:     true,
		CreatedAt:              fixture.now.Add(-2 * time.Minute),
		UpdatedAt:              fixture.now.Add(-2 * time.Minute),
	}
	if err := fixture.db.Create(row).Error; err != nil {
		t.Fatalf("seed continuation: %v", err)
	}

	if err := fixture.service.ReconcileExpiredContinuations(context.Background()); err != nil {
		t.Fatalf("reconcile expired continuations: %v", err)
	}
	var reloaded persistence.ToolContinuation
	if err := fixture.db.First(&reloaded, "id = ?", row.ID).Error; err != nil {
		t.Fatalf("reload continuation: %v", err)
	}
	if reloaded.Status != persistence.ToolContinuationStatusReady {
		t.Fatalf("expected provider-idempotent continuation to return to ready, got %s", reloaded.Status)
	}
	if reloaded.LeaseID != "" || reloaded.LeaseExpiresAt != nil {
		t.Fatalf("expected reclaimed continuation lease to be cleared: %+v", reloaded)
	}
}

func TestToolDispatchServiceClaimReadyContinuation(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	row := &persistence.ToolContinuation{
		ID:          "continuation-claim-once",
		TurnID:      "turn-claim-once",
		AttemptID:   "attempt-claim-once",
		ToolBatchID: "batch-claim-once",
		Status:      persistence.ToolContinuationStatusReady,
		CreatedAt:   fixture.now,
		UpdatedAt:   fixture.now,
	}
	if err := fixture.db.Create(row).Error; err != nil {
		t.Fatalf("seed ready continuation: %v", err)
	}

	claimed, err := fixture.service.ClaimReadyContinuation(context.Background(), time.Minute)
	if err != nil {
		t.Fatalf("claim ready continuation: %v", err)
	}
	if claimed.ID != row.ID || claimed.Status != persistence.ToolContinuationStatusClaimed {
		t.Fatalf("unexpected claimed continuation: %+v", claimed)
	}
	if claimed.LeaseID == "" || claimed.FencingToken != 1 || claimed.LeaseExpiresAt == nil {
		t.Fatalf("claim must assign a fenced lease: %+v", claimed)
	}

	if _, err := fixture.service.ClaimReadyContinuation(context.Background(), time.Minute); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("second claim must not acquire an active lease, got %v", err)
	}
}

func TestToolDispatchServiceSubmitDecision(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	proposal := fixture.authorizedProposal(
		t,
		"decision",
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		true,
	)
	decisions, err := fixture.service.ProposeAuthorizedBatch(
		context.Background(),
		proposal,
	)
	if err != nil {
		t.Fatalf("propose manual tool: %v", err)
	}
	if len(decisions) != 1 || decisions[0].Status != persistence.ToolCallStatusWaitingApproval {
		t.Fatalf("expected one waiting decision, got %+v", decisions)
	}

	request := &model.SubmitToolApprovalDecisionRequest{
		ApprovalId:       decisions[0].ApprovalID,
		ToolCallId:       proposal.Calls[0].ToolCallID,
		DecisionId:       "decision-1",
		ExpectedRevision: 0,
		Approved:         true,
		IdempotencyKey:   "decision-command-1",
	}
	request.PayloadHash = decisionPayloadHash(request)
	first, err := fixture.service.SubmitDecision(context.Background(), fixture.actorID, request)
	if err != nil {
		t.Fatalf("submit decision: %v", err)
	}
	if !first.GetAccepted() || first.GetDecisionRevision() != 1 {
		t.Fatalf("unexpected decision acknowledgement: %+v", first)
	}
	replayed, err := fixture.service.SubmitDecision(context.Background(), fixture.actorID, request)
	if err != nil {
		t.Fatalf("replay decision: %v", err)
	}
	if !replayed.GetAccepted() || replayed.GetDecisionRevision() != first.GetDecisionRevision() {
		t.Fatalf("expected original acknowledgement, got %+v", replayed)
	}

	conflict := protoCloneDecisionRequest(request)
	conflict.Approved = false
	conflict.PayloadHash = decisionPayloadHash(conflict)
	conflictResponse, err := fixture.service.SubmitDecision(context.Background(), fixture.actorID, conflict)
	if err != nil {
		t.Fatalf("submit payload conflict: %v", err)
	}
	if conflictResponse.GetErrorCode() != model.ToolApprovalDecisionErrorCode_TOOL_APPROVAL_DECISION_ERROR_CODE_IDEMPOTENCY_CONFLICT {
		t.Fatalf("expected idempotency conflict, got %+v", conflictResponse)
	}

	stale := protoCloneDecisionRequest(request)
	stale.IdempotencyKey = "decision-command-2"
	stale.PayloadHash = decisionPayloadHash(stale)
	staleResponse, err := fixture.service.SubmitDecision(context.Background(), fixture.actorID, stale)
	if err != nil {
		t.Fatalf("submit stale decision: %v", err)
	}
	if staleResponse.GetErrorCode() != model.ToolApprovalDecisionErrorCode_TOOL_APPROVAL_DECISION_ERROR_CODE_STALE_REVISION {
		t.Fatalf("expected stale revision, got %+v", staleResponse)
	}

	var outboxCount int64
	if err := fixture.db.Model(&persistence.ToolDispatchOutbox{}).Count(&outboxCount).Error; err != nil {
		t.Fatalf("count outbox rows: %v", err)
	}
	if outboxCount != 1 {
		t.Fatalf("expected one targeted dispatch, got %d", outboxCount)
	}
}

func TestToolDispatchServiceConcurrentDecisionCAS(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	sqlDB, err := fixture.db.DB()
	if err != nil {
		t.Fatalf("open sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	proposal := fixture.authorizedProposal(
		t,
		"concurrent-decision",
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		true,
	)
	decisions, err := fixture.service.ProposeAuthorizedBatch(
		context.Background(),
		proposal,
	)
	if err != nil {
		t.Fatalf("propose manual tool: %v", err)
	}

	responses := make(chan *model.SubmitToolApprovalDecisionResponse, 2)
	errorsCh := make(chan error, 2)
	start := make(chan struct{})
	for index := 0; index < 2; index++ {
		go func(index int) {
			<-start
			request := &model.SubmitToolApprovalDecisionRequest{
				ApprovalId:       decisions[0].ApprovalID,
				ToolCallId:       proposal.Calls[0].ToolCallID,
				DecisionId:       "decision-" + string(rune('a'+index)),
				ExpectedRevision: 0,
				Approved:         true,
				IdempotencyKey:   "decision-command-" + string(rune('a'+index)),
			}
			request.PayloadHash = decisionPayloadHash(request)
			response, err := fixture.service.SubmitDecision(context.Background(), fixture.actorID, request)
			responses <- response
			errorsCh <- err
		}(index)
	}
	close(start)

	accepted := 0
	stale := 0
	for range 2 {
		if err := <-errorsCh; err != nil {
			t.Fatalf("submit concurrent decision: %v", err)
		}
		response := <-responses
		if response.GetAccepted() {
			accepted++
		}
		if response.GetErrorCode() == model.ToolApprovalDecisionErrorCode_TOOL_APPROVAL_DECISION_ERROR_CODE_STALE_REVISION {
			stale++
		}
	}
	if accepted != 1 || stale != 1 {
		t.Fatalf("expected one accepted and one stale decision, accepted=%d stale=%d", accepted, stale)
	}
}

func TestToolDispatchServiceToolBatchBarrier(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-1", "tool-call-2")

	pulled, err := fixture.service.PullCapabilityRequests(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedPullRequest(t, "barrier", 4),
	)
	if err != nil {
		t.Fatalf("pull capability requests: %v", err)
	}
	if len(pulled.GetRequests()) != 2 {
		t.Fatalf("expected two capability requests, got %d", len(pulled.GetRequests()))
	}

	for index, envelope := range pulled.GetRequests() {
		prepared := receiptForEnvelope(envelope, uint64(index*2+1), model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED)
		if response, err := fixture.service.SubmitReceipt(
			context.Background(),
			fixture.actorID,
			fixture.deviceID,
			fixture.signedReceiptRequest(t, prepared),
		); err != nil || !response.GetAccepted() {
			t.Fatalf("submit prepared receipt %d: response=%+v err=%v", index, response, err)
		}

		applied := receiptForEnvelope(envelope, uint64(index*2+2), model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED)
		applied.ResultId = "result-" + envelope.GetToolCallId()
		applied.BoundedResult = []byte(`{"ok":true}`)
		response, err := fixture.service.SubmitReceipt(
			context.Background(),
			fixture.actorID,
			fixture.deviceID,
			fixture.signedReceiptRequest(t, applied),
		)
		if err != nil || !response.GetAccepted() {
			t.Fatalf("submit applied receipt %d: response=%+v err=%v", index, response, err)
		}
		if index == 0 && response.GetContinuationId() != "" {
			t.Fatalf("first batch result must not create continuation: %+v", response)
		}
		if index == 1 {
			if response.GetContinuationId() == "" {
				t.Fatal("final batch result must create continuation")
			}
			replayed, err := fixture.service.SubmitReceipt(
				context.Background(),
				fixture.actorID,
				fixture.deviceID,
				fixture.signedReceiptRequest(t, applied),
			)
			if err != nil {
				t.Fatalf("replay final result: %v", err)
			}
			if !replayed.GetReplayed() || replayed.GetContinuationId() != response.GetContinuationId() {
				t.Fatalf("expected original continuation acknowledgement, got %+v", replayed)
			}
		}
	}

	var continuationCount int64
	if err := fixture.db.Model(&persistence.ToolContinuation{}).Count(&continuationCount).Error; err != nil {
		t.Fatalf("count continuations: %v", err)
	}
	if continuationCount != 1 {
		t.Fatalf("expected one batch continuation, got %d", continuationCount)
	}
}

func TestToolDispatchServiceConcurrentFinalReceiptCreatesOneContinuation(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	sqlDB, err := fixture.db.DB()
	if err != nil {
		t.Fatalf("open sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	fixture.propose(t, "tool-call-1")
	envelope := fixture.pullSingleEnvelope(t)
	prepared := receiptForEnvelope(envelope, 1, model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit prepared receipt: response=%+v err=%v", response, err)
	}

	start := make(chan struct{})
	responses := make(chan *model.SubmitClientCapabilityReceiptResponse, 2)
	errorsCh := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			applied := receiptForEnvelope(envelope, 2, model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED)
			applied.ResultId = "result-1"
			applied.BoundedResult = []byte(`{"ok":true}`)
			response, err := fixture.service.SubmitReceipt(
				context.Background(),
				fixture.actorID,
				fixture.deviceID,
				fixture.signedReceiptRequest(t, applied),
			)
			responses <- response
			errorsCh <- err
		}()
	}
	close(start)

	replayed := 0
	for range 2 {
		if err := <-errorsCh; err != nil {
			t.Fatalf("submit concurrent final receipt: %v", err)
		}
		response := <-responses
		if !response.GetAccepted() || response.GetContinuationId() == "" {
			t.Fatalf("expected accepted receipt with continuation, got %+v", response)
		}
		if response.GetReplayed() {
			replayed++
		}
	}
	if replayed != 1 {
		t.Fatalf("expected exactly one replayed acknowledgement, got %d", replayed)
	}
	for table, modelValue := range map[string]interface{}{
		"tool result":  &persistence.ToolResult{},
		"continuation": &persistence.ToolContinuation{},
		"tool message": &persistence.AgentMessage{},
	} {
		var count int64
		if err := fixture.db.Model(modelValue).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows: %v", table, err)
		}
		if count != 1 {
			t.Fatalf("expected one %s row, got %d", table, count)
		}
	}
}

func TestTurnServiceProcessToolCallsPausesAfterDurableDispatch(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	now := fixture.now
	proposal := fixture.authorizedProposal(
		t,
		"turn-service",
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		true,
	)
	conversation := &persistence.Conversation{
		ID:        "conversation-pause",
		AgentID:   "agent-1",
		Ptid:      fixture.actorID,
		Title:     "Pause",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := fixture.db.Create(conversation).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := fixture.db.Create(&persistence.AgentTurn{
		ID:             proposal.TurnID,
		ConversationID: conversation.ID,
		AgentID:        proposal.AgentID,
		Status:         string(domain.TurnStatusRunning),
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}
	if err := fixture.db.Create(&persistence.TurnAttempt{
		ID:                  proposal.AttemptID,
		TurnID:              proposal.TurnID,
		AttemptIndex:        1,
		Status:              string(domain.TurnStatusRunning),
		ReadinessSnapshotID: proposal.ReadinessSnapshotID,
		StartedAt:           now,
	}).Error; err != nil {
		t.Fatalf("seed turn attempt: %v", err)
	}

	service := &TurnService{
		toolDispatch: fixture.service,
		nudgeState:   domain.NewNudgeState(),
	}
	config := &TurnConfig{
		AgentID:                   "agent-1",
		ActorID:                   fixture.actorID,
		ConversationID:            conversation.ID,
		Provider:                  "provider-1",
		Model:                     "model-1",
		ContextWindowSize:         128000,
		MaxRetries:                3,
		ClientCapabilitySessionID: fixture.session.GetCapabilitySessionId(),
		AttemptID:                 proposal.AttemptID,
		TurnID:                    proposal.TurnID,
	}
	authorized, err := LoadAuthorizedCapabilitySet(
		context.Background(),
		fixture.db,
		config,
	)
	if err != nil {
		t.Fatalf("load turn capability authority: %v", err)
	}
	config.AuthorizedCapabilities = authorized
	response := ""
	providerToolCalls := []ProviderToolCall{{
		ID:        "provider-call-1",
		Name:      "local_file_read",
		Arguments: `{"resource_ref":"resource-1"}`,
	}}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	iterations, paused, err := service.processToolCalls(
		ctx,
		config,
		proposal.TurnID,
		&domain.TurnTrace{TraceID: "trace-pause", TurnID: proposal.TurnID},
		"system prompt",
		nil,
		&response,
		providerToolCalls,
		0,
	)
	if err != nil {
		t.Fatalf("process client tool call: %v", err)
	}
	if !paused || iterations != 1 {
		t.Fatalf("expected durable pause after first tool batch, paused=%v iterations=%d", paused, iterations)
	}

	var batch persistence.ToolBatch
	if err := fixture.db.First(&batch, "turn_id = ?", proposal.TurnID).Error; err != nil {
		t.Fatalf("load durable tool batch: %v", err)
	}
	if batch.CapabilitySessionID != fixture.session.GetCapabilitySessionId() {
		t.Fatalf("capability session was not frozen on batch: %+v", batch)
	}
	var call persistence.ToolCall
	if err := fixture.db.First(&call, "tool_batch_id = ?", batch.ID).Error; err != nil {
		t.Fatalf("load governed tool call: %v", err)
	}
	if call.ManifestID != "filesystem.read" ||
		call.BindingID != "binding-turn-service" ||
		call.ReadinessSnapID != proposal.ReadinessSnapshotID {
		t.Fatalf("turn tool call lost capability authority lineage: %+v", call)
	}
	var assistantMessage persistence.AgentMessage
	if err := fixture.db.
		Where("turn_id = ? AND role = ?", proposal.TurnID, string(domain.MessageRoleAssistant)).
		First(&assistantMessage).Error; err != nil {
		t.Fatalf("load assistant ToolCall message: %v", err)
	}
	var persistedCalls []openAIToolCall
	if err := json.Unmarshal(assistantMessage.ToolCallsJSON, &persistedCalls); err != nil {
		t.Fatalf("decode assistant ToolCalls: %v", err)
	}
	if len(persistedCalls) != 1 ||
		persistedCalls[0].ID != call.ToolCallID ||
		persistedCalls[0].Function.Name != "local_file_read" {
		t.Fatalf("assistant ToolCall linkage = %+v, call=%+v", persistedCalls, call)
	}
}

func TestTurnServiceResumeReadyToolContinuation(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	now := fixture.now
	authority := fixture.authorizedProposal(
		t,
		"resume",
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		true,
	)
	conversation := &persistence.Conversation{
		ID:        "conversation-1",
		AgentID:   "agent-1",
		Ptid:      fixture.actorID,
		Title:     "Resume",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}
	userInput := "continue"
	turn := &persistence.AgentTurn{
		ID:             "turn-1",
		ConversationID: conversation.ID,
		AgentID:        "agent-1",
		UserInput:      &userInput,
		Status:         string(domain.TurnStatusWaitingLocalTool),
		StartedAt:      now,
	}
	pinnedBudget := &model.RuntimeBudget{
		MaxToolCalls:          7,
		MaxIdenticalToolCalls: 2,
	}
	runtimeSnapshot, err := persistence.MarshalRuntimeSnapshot(&model.RuntimeSnapshot{
		Budget: pinnedBudget,
	})
	if err != nil {
		t.Fatalf("encode pinned runtime budget: %v", err)
	}
	attempt := &persistence.TurnAttempt{
		ID:                  "attempt-1",
		TurnID:              turn.ID,
		AttemptIndex:        1,
		Status:              string(domain.TurnStatusWaitingLocalTool),
		ReadinessSnapshotID: authority.ReadinessSnapshotID,
		RuntimeSnapshot:     runtimeSnapshot,
		StartedAt:           now,
	}
	if err := fixture.db.Create(conversation).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := fixture.db.Create(turn).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}
	if err := fixture.db.Create(attempt).Error; err != nil {
		t.Fatalf("seed attempt: %v", err)
	}

	authority.TurnID = turn.ID
	authority.AttemptID = attempt.ID
	authority.ToolBatchID = "batch-1"
	authority.Calls[0].ToolCallID = "tool-call-1"
	if _, err := fixture.service.ProposeAuthorizedBatch(
		context.Background(),
		authority,
	); err != nil {
		t.Fatalf("propose initial governed tool call: %v", err)
	}
	envelope := fixture.pullSingleEnvelope(t)
	prepared := receiptForEnvelope(envelope, 1, model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit prepared receipt: response=%+v err=%v", response, err)
	}
	applied := receiptForEnvelope(envelope, 2, model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED)
	applied.ResultId = "result-1"
	applied.BoundedResult = []byte(`{"ok":true}`)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, applied),
	); err != nil || !response.GetAccepted() || response.GetContinuationId() == "" {
		t.Fatalf("submit applied receipt: response=%+v err=%v", response, err)
	}
	var toolMessage persistence.AgentMessage
	if err := fixture.db.
		Where("turn_id = ? AND role = ?", turn.ID, string(domain.MessageRoleTool)).
		First(&toolMessage).Error; err != nil {
		t.Fatalf("load persisted tool result message: %v", err)
	}
	var toolMetadata map[string]string
	if err := json.Unmarshal(toolMessage.MetadataJSON, &toolMetadata); err != nil {
		t.Fatalf("decode tool result metadata: %v", err)
	}
	if toolMetadata["tool_call_id"] != authority.Calls[0].ToolCallID {
		t.Fatalf("tool result linkage = %#v", toolMetadata)
	}

	providerCalls := 0
	resumedThinkingMode := domain.ThinkingMode("")
	var resumedBudget *model.RuntimeBudget
	service := &TurnService{
		toolDispatch: fixture.service,
		nudgeState:   domain.NewNudgeState(),
		resumeProviderCall: func(
			_ context.Context,
			config *TurnConfig,
			_ string,
			_ *domain.TurnTrace,
			_ string,
			_ []domain.Message,
		) (string, []ProviderToolCall, []domain.ProviderCallRecord, bool, error) {
			providerCalls++
			resumedThinkingMode = config.ThinkingMode
			resumedBudget = cloneRuntimeBudget(config.RuntimeBudget)
			return "",
				[]ProviderToolCall{{
					ID:        "provider-call-2",
					Name:      "local_file_read",
					Arguments: `{"resource_ref":"resource-2"}`,
				}},
				[]domain.ProviderCallRecord{{Provider: "provider-1", Model: "model-1"}},
				false,
				nil
		},
	}

	resumed, err := service.ResumeReadyToolContinuation(context.Background(), time.Minute)
	if err != nil {
		t.Fatalf("resume ready continuation: %v", err)
	}
	if !resumed || providerCalls != 1 {
		t.Fatalf("expected one resumed provider call, resumed=%v calls=%d", resumed, providerCalls)
	}
	if resumedThinkingMode != domain.ThinkingModeDisabled {
		t.Fatalf("resumed thinking mode = %q, want disabled", resumedThinkingMode)
	}
	if !proto.Equal(resumedBudget, pinnedBudget) {
		t.Fatalf("resumed budget = %+v, want persisted %+v", resumedBudget, pinnedBudget)
	}

	var completed persistence.ToolContinuation
	if err := fixture.db.First(&completed, "tool_batch_id = ?", "batch-1").Error; err != nil {
		t.Fatalf("load completed continuation: %v", err)
	}
	if completed.Status != persistence.ToolContinuationStatusCompleted {
		t.Fatalf("expected completed continuation, got %s", completed.Status)
	}
	var batchCount int64
	if err := fixture.db.Model(&persistence.ToolBatch{}).
		Where("turn_id = ?", turn.ID).
		Count(&batchCount).Error; err != nil {
		t.Fatalf("count tool batches: %v", err)
	}
	if batchCount != 2 {
		t.Fatalf("expected resumed response to create the next durable batch, got %d", batchCount)
	}
	var trace persistence.TurnTrace
	if err := fixture.db.First(&trace, "turn_id = ?", turn.ID).Error; err != nil {
		t.Fatalf("load resumed trace: %v", err)
	}
}

func TestTurnServiceLifecycleCancellationPreservesResumedContinuation(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	if err := fixture.db.AutoMigrate(&persistence.TaskRun{}); err != nil {
		t.Fatalf("migrate chat task run: %v", err)
	}

	authority := fixture.authorizedProposal(
		t,
		"lifecycle-cancel",
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		true,
	)
	authority.TaskID = "task-lifecycle-cancel"
	authority.StepID = "step-lifecycle-cancel"
	conversation := &persistence.Conversation{
		ID:        authority.ConversationID,
		AgentID:   authority.AgentID,
		Ptid:      fixture.actorID,
		Title:     "Lifecycle cancellation",
		Status:    "active",
		CreatedAt: fixture.now,
		UpdatedAt: fixture.now,
	}
	userInput := "continue"
	turn := &persistence.AgentTurn{
		ID:             authority.TurnID,
		ConversationID: authority.ConversationID,
		AgentID:        authority.AgentID,
		UserInput:      &userInput,
		Status:         string(domain.TurnStatusWaitingLocalTool),
		StartedAt:      fixture.now,
	}
	runtimeSnapshot, err := persistence.MarshalRuntimeSnapshot(&model.RuntimeSnapshot{
		Budget: &model.RuntimeBudget{MaxToolCalls: 7, MaxIdenticalToolCalls: 2},
	})
	if err != nil {
		t.Fatalf("encode runtime snapshot: %v", err)
	}
	attempt := &persistence.TurnAttempt{
		ID:                  authority.AttemptID,
		TurnID:              authority.TurnID,
		AttemptIndex:        1,
		Status:              string(domain.TurnStatusWaitingLocalTool),
		ReadinessSnapshotID: authority.ReadinessSnapshotID,
		RuntimeSnapshot:     runtimeSnapshot,
		StartedAt:           fixture.now,
	}
	task := &persistence.TaskRun{
		TaskID:         authority.TaskID,
		Surface:        int32(model.TaskSurface_TASK_SURFACE_CHAT),
		Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		OwnerActorID:   fixture.actorID,
		ConversationID: authority.ConversationID,
		CreatedAt:      fixture.now,
		StartedAt:      fixture.now,
		UpdatedAt:      fixture.now,
	}
	step := &persistence.ExecutionStep{
		StepID:    authority.StepID,
		TaskID:    authority.TaskID,
		AgentID:   authority.AgentID,
		TurnID:    authority.TurnID,
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		StartedAt: fixture.now,
	}
	for name, record := range map[string]interface{}{
		"conversation": conversation,
		"turn":         turn,
		"attempt":      attempt,
		"task":         task,
		"step":         step,
	} {
		if err := fixture.db.Create(record).Error; err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}
	}
	if _, err := fixture.service.ProposeAuthorizedBatch(
		context.Background(),
		authority,
	); err != nil {
		t.Fatalf("propose governed tool call: %v", err)
	}
	envelope := fixture.pullSingleEnvelope(t)
	prepared := receiptForEnvelope(
		envelope,
		1,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit prepared receipt: response=%+v err=%v", response, err)
	}
	applied := receiptForEnvelope(
		envelope,
		2,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED,
	)
	applied.ResultId = "result-lifecycle-cancel"
	applied.BoundedResult = []byte(`{"ok":true}`)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, applied),
	); err != nil || !response.GetAccepted() || response.GetContinuationId() == "" {
		t.Fatalf("submit applied receipt: response=%+v err=%v", response, err)
	}

	providerStarted := make(chan struct{})
	service := &TurnService{
		toolDispatch: fixture.service,
		nudgeState:   domain.NewNudgeState(),
		resumeProviderCall: func(
			ctx context.Context,
			_ *TurnConfig,
			_ string,
			_ *domain.TurnTrace,
			_ string,
			_ []domain.Message,
		) (string, []ProviderToolCall, []domain.ProviderCallRecord, bool, error) {
			close(providerStarted)
			<-ctx.Done()
			return "", nil, nil, false, ctx.Err()
		},
	}
	service.SetExecutionLifecycle(context.Background())
	result := make(chan error, 1)
	if !service.RunExecutionWorker(func(ctx context.Context) {
		_, err := service.ResumeReadyToolContinuation(ctx, time.Minute)
		result <- err
	}) {
		t.Fatal("continuation worker was rejected before shutdown")
	}
	<-providerStarted
	stopCtx, cancelStop := context.WithTimeout(context.Background(), time.Second)
	defer cancelStop()
	if err := service.StopExecutionLifecycle(stopCtx); err != nil {
		t.Fatalf("stop execution lifecycle: %v", err)
	}
	if err := <-result; err == nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("resume cancellation error = %v, want context cancellation", err)
	}

	var continuation persistence.ToolContinuation
	if err := fixture.db.First(
		&continuation,
		"tool_batch_id = ?",
		authority.ToolBatchID,
	).Error; err != nil {
		t.Fatalf("reload cancelled continuation: %v", err)
	}
	if continuation.Status != persistence.ToolContinuationStatusClaimed ||
		!continuation.ProviderRequestEmitted ||
		continuation.CompletedAt != nil {
		t.Fatalf("lifecycle cancellation consumed continuation: %+v", continuation)
	}
	var persistedTurn persistence.AgentTurn
	if err := fixture.db.First(&persistedTurn, "id = ?", authority.TurnID).Error; err != nil {
		t.Fatalf("reload turn: %v", err)
	}
	if persistedTurn.Status != string(domain.TurnStatusWaitingLocalTool) ||
		persistedTurn.EndedAt != nil {
		t.Fatalf("lifecycle cancellation terminally settled turn: %+v", persistedTurn)
	}

	fixture.service.now = func() time.Time {
		return fixture.now.Add(2 * time.Minute)
	}
	if err := fixture.service.ReconcileExpiredContinuations(context.Background()); err != nil {
		t.Fatalf("reconcile cancelled continuation: %v", err)
	}
	if err := fixture.db.First(&continuation, "id = ?", continuation.ID).Error; err != nil {
		t.Fatalf("reload reconciled continuation: %v", err)
	}
	if continuation.Status != persistence.ToolContinuationStatusReconciliationRequired {
		t.Fatalf("continuation status = %q, want reconciliation_required", continuation.Status)
	}
	if err := NewChatTaskService(nil).RecoverRunningChatTasks(context.Background()); err != nil {
		t.Fatalf("recover chat task with reconciliable continuation: %v", err)
	}
	var persistedStep persistence.ExecutionStep
	if err := fixture.db.First(&persistedStep, "step_id = ?", authority.StepID).Error; err != nil {
		t.Fatalf("reload recoverable step: %v", err)
	}
	if persistedStep.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) ||
		persistedStep.EndedAt != nil {
		t.Fatalf("recovery consumed reconciliable step: %+v", persistedStep)
	}
}

func TestChatTaskServicePreservesDurableToolContinuation(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	if err := fixture.db.AutoMigrate(&persistence.TaskRun{}); err != nil {
		t.Fatalf("migrate chat task runs: %v", err)
	}
	steps := []*persistence.ExecutionStep{
		{
			StepID:    "step-waiting-receipt",
			TaskID:    "task-waiting-receipt",
			AgentID:   "agent-1",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			StartedAt: fixture.now,
		},
		{
			StepID:    "step-ready-continuation",
			TaskID:    "task-ready-continuation",
			AgentID:   "agent-1",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			StartedAt: fixture.now,
		},
		{
			StepID:    "step-reconciliation-required",
			TaskID:    "task-reconciliation-required",
			AgentID:   "agent-1",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			StartedAt: fixture.now,
		},
	}
	tasks := []*persistence.TaskRun{
		{
			TaskID:         steps[0].TaskID,
			Surface:        int32(model.TaskSurface_TASK_SURFACE_CHAT),
			Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
			OwnerActorID:   fixture.actorID,
			ConversationID: "conversation-waiting-receipt",
			CreatedAt:      fixture.now,
			StartedAt:      fixture.now,
			UpdatedAt:      fixture.now,
		},
		{
			TaskID:         steps[1].TaskID,
			Surface:        int32(model.TaskSurface_TASK_SURFACE_CHAT),
			Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
			OwnerActorID:   fixture.actorID,
			ConversationID: "conversation-ready-continuation",
			CreatedAt:      fixture.now,
			StartedAt:      fixture.now,
			UpdatedAt:      fixture.now,
		},
		{
			TaskID:         steps[2].TaskID,
			Surface:        int32(model.TaskSurface_TASK_SURFACE_CHAT),
			Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
			OwnerActorID:   fixture.actorID,
			ConversationID: "conversation-reconciliation-required",
			CreatedAt:      fixture.now,
			StartedAt:      fixture.now,
			UpdatedAt:      fixture.now,
		},
	}
	if err := fixture.db.Create(&tasks).Error; err != nil {
		t.Fatalf("seed chat tasks: %v", err)
	}
	if err := fixture.db.Create(&steps).Error; err != nil {
		t.Fatalf("seed running chat steps: %v", err)
	}
	batches := []*persistence.ToolBatch{
		{
			ID:                  "batch-waiting-receipt",
			ActorID:             fixture.actorID,
			TurnID:              "turn-waiting-receipt",
			AttemptID:           "attempt-waiting-receipt",
			ConversationID:      "conversation-waiting-receipt",
			AgentID:             "agent-1",
			Provider:            "provider-1",
			Model:               "model-1",
			SystemPrompt:        "system",
			Iteration:           1,
			StepID:              steps[0].StepID,
			CapabilitySessionID: fixture.session.GetCapabilitySessionId(),
			ExpectedCallCount:   1,
			Status:              persistence.ToolBatchStatusOpen,
			CreatedAt:           fixture.now,
			UpdatedAt:           fixture.now,
		},
		{
			ID:                  "batch-ready-continuation",
			ActorID:             fixture.actorID,
			TurnID:              "turn-ready-continuation",
			AttemptID:           "attempt-ready-continuation",
			ConversationID:      "conversation-ready-continuation",
			AgentID:             "agent-1",
			Provider:            "provider-1",
			Model:               "model-1",
			SystemPrompt:        "system",
			Iteration:           1,
			StepID:              steps[1].StepID,
			CapabilitySessionID: fixture.session.GetCapabilitySessionId(),
			ExpectedCallCount:   1,
			Status:              persistence.ToolBatchStatusReadyForContinuation,
			CreatedAt:           fixture.now,
			UpdatedAt:           fixture.now,
		},
		{
			ID:                  "batch-reconciliation-required",
			ActorID:             fixture.actorID,
			TurnID:              "turn-reconciliation-required",
			AttemptID:           "attempt-reconciliation-required",
			ConversationID:      "conversation-reconciliation-required",
			AgentID:             "agent-1",
			Provider:            "provider-1",
			Model:               "model-1",
			SystemPrompt:        "system",
			Iteration:           1,
			StepID:              steps[2].StepID,
			CapabilitySessionID: fixture.session.GetCapabilitySessionId(),
			ExpectedCallCount:   1,
			Status:              persistence.ToolBatchStatusReadyForContinuation,
			CreatedAt:           fixture.now,
			UpdatedAt:           fixture.now,
		},
	}
	if err := fixture.db.Create(&batches).Error; err != nil {
		t.Fatalf("seed recoverable tool batches: %v", err)
	}
	if err := fixture.db.Create(&persistence.ToolContinuation{
		ID:          "continuation-recoverable",
		TurnID:      batches[1].TurnID,
		AttemptID:   batches[1].AttemptID,
		ToolBatchID: batches[1].ID,
		Status:      persistence.ToolContinuationStatusReady,
		CreatedAt:   fixture.now,
		UpdatedAt:   fixture.now,
	}).Error; err != nil {
		t.Fatalf("seed recoverable continuation: %v", err)
	}
	if err := fixture.db.Create(&persistence.ToolContinuation{
		ID:          "continuation-reconciliation-required",
		TurnID:      batches[2].TurnID,
		AttemptID:   batches[2].AttemptID,
		ToolBatchID: batches[2].ID,
		Status:      persistence.ToolContinuationStatusReconciliationRequired,
		CreatedAt:   fixture.now,
		UpdatedAt:   fixture.now,
	}).Error; err != nil {
		t.Fatalf("seed reconciliation-required continuation: %v", err)
	}

	service := NewChatTaskService(nil)
	if err := service.RecoverRunningChatTasks(context.Background()); err != nil {
		t.Fatalf("recover running chat tasks: %v", err)
	}

	for _, step := range steps {
		var reloaded persistence.ExecutionStep
		if err := fixture.db.First(&reloaded, "step_id = ?", step.StepID).Error; err != nil {
			t.Fatalf("reload chat step %s: %v", step.StepID, err)
		}
		if reloaded.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
			t.Fatalf("recoverable tool work must remain running: step=%s status=%d", step.StepID, reloaded.Status)
		}
	}
}

func TestChatTaskServiceBindChatStepToTurn(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	step := &persistence.ExecutionStep{
		StepID:    "step-bind",
		TaskID:    "task-bind",
		AgentID:   "agent-1",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		StartedAt: fixture.now,
	}
	lease := &persistence.ExecutorLease{
		LeaseID:      "lease-bind",
		TaskID:       step.TaskID,
		StepID:       step.StepID,
		ExecutorID:   "station-old",
		ExecutorKind: int32(model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED),
		Status:       chatLeaseStatusActive,
		AcquiredAt:   fixture.now,
		HeartbeatAt:  fixture.now,
		ExpiresAt:    fixture.now.Add(time.Minute),
	}
	if err := fixture.db.Create(step).Error; err != nil {
		t.Fatalf("seed running chat step: %v", err)
	}
	if err := fixture.db.Create(lease).Error; err != nil {
		t.Fatalf("seed chat step lease: %v", err)
	}

	service := NewChatTaskService(nil)
	if err := service.BindChatStepToTurn(context.Background(), step.TaskID, step.StepID, "turn-bind"); err != nil {
		t.Fatalf("bind chat step to turn: %v", err)
	}

	var reloaded persistence.ExecutionStep
	if err := fixture.db.First(&reloaded, "step_id = ?", step.StepID).Error; err != nil {
		t.Fatalf("reload chat step: %v", err)
	}
	if reloaded.TurnID != "turn-bind" ||
		reloaded.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
		t.Fatalf("chat step must remain running and bind the turn: %+v", reloaded)
	}
}

func TestTurnServiceSettlesReconciliationRequiredTurn(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	now := fixture.now
	conversation := &persistence.Conversation{
		ID:        "conversation-reconciliation",
		AgentID:   "agent-1",
		Ptid:      fixture.actorID,
		Title:     "Reconciliation",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}
	turn := &persistence.AgentTurn{
		ID:             "turn-reconciliation",
		ConversationID: conversation.ID,
		AgentID:        "agent-1",
		Status:         string(domain.TurnStatusWaitingLocalTool),
		StartedAt:      now,
	}
	attempt := &persistence.TurnAttempt{
		ID:           "attempt-reconciliation",
		TurnID:       turn.ID,
		AttemptIndex: 1,
		Status:       string(domain.TurnStatusWaitingLocalTool),
		StartedAt:    now,
	}
	batch := &persistence.ToolBatch{
		ID:                  "batch-reconciliation",
		ActorID:             fixture.actorID,
		TurnID:              turn.ID,
		AttemptID:           attempt.ID,
		ConversationID:      conversation.ID,
		AgentID:             "agent-1",
		Provider:            "provider-1",
		Model:               "model-1",
		SystemPrompt:        "system",
		Iteration:           1,
		CapabilitySessionID: fixture.session.GetCapabilitySessionId(),
		ExpectedCallCount:   1,
		Status:              persistence.ToolBatchStatusReadyForContinuation,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	continuation := &persistence.ToolContinuation{
		ID:                     "continuation-reconciliation",
		TurnID:                 turn.ID,
		AttemptID:              attempt.ID,
		ToolBatchID:            batch.ID,
		Status:                 persistence.ToolContinuationStatusReconciliationRequired,
		ProviderRequestEmitted: true,
		CreatedAt:              now,
		UpdatedAt:              now,
	}
	for label, value := range map[string]interface{}{
		"conversation": conversation,
		"turn":         turn,
		"attempt":      attempt,
		"batch":        batch,
		"continuation": continuation,
	} {
		if err := fixture.db.Create(value).Error; err != nil {
			t.Fatalf("seed %s: %v", label, err)
		}
	}

	service := &TurnService{}
	if err := service.settleReconciliationRequiredTurns(context.Background()); err != nil {
		t.Fatalf("settle reconciliation-required turn: %v", err)
	}

	var reloadedTurn persistence.AgentTurn
	if err := fixture.db.First(&reloadedTurn, "id = ?", turn.ID).Error; err != nil {
		t.Fatalf("reload turn: %v", err)
	}
	if reloadedTurn.Status != string(domain.TurnStatusInterrupted) {
		t.Fatalf("expected interrupted turn, got %s", reloadedTurn.Status)
	}
	var reloadedAttempt persistence.TurnAttempt
	if err := fixture.db.First(&reloadedAttempt, "id = ?", attempt.ID).Error; err != nil {
		t.Fatalf("reload attempt: %v", err)
	}
	if reloadedAttempt.Status != string(domain.TurnStatusInterrupted) || reloadedAttempt.EndedAt == nil {
		t.Fatalf("expected interrupted terminal attempt, got %+v", reloadedAttempt)
	}
}

func TestTurnServiceCancelWaitingToolTurnBlocksBatch(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	now := fixture.now
	conversation := &persistence.Conversation{
		ID:        "conversation-cancel",
		AgentID:   "agent-1",
		Ptid:      fixture.actorID,
		Title:     "Cancel",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}
	turn := &persistence.AgentTurn{
		ID:             "turn-1",
		ConversationID: conversation.ID,
		AgentID:        "agent-1",
		Status:         string(domain.TurnStatusWaitingLocalTool),
		StartedAt:      now,
	}
	attempt := &persistence.TurnAttempt{
		ID:           "attempt-1",
		TurnID:       turn.ID,
		AttemptIndex: 1,
		Status:       string(domain.TurnStatusWaitingLocalTool),
		StartedAt:    now,
	}
	for label, value := range map[string]interface{}{
		"conversation": conversation,
		"turn":         turn,
		"attempt":      attempt,
	} {
		if err := fixture.db.Create(value).Error; err != nil {
			t.Fatalf("seed %s: %v", label, err)
		}
	}
	fixture.propose(t, "tool-call-unprepared", "tool-call-prepared")
	pulled, err := fixture.service.PullCapabilityRequests(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedPullRequest(t, "cancel", 5),
	)
	if err != nil {
		t.Fatalf("pull capability requests: %v", err)
	}
	prepared := receiptForEnvelope(
		pulled.GetRequests()[1],
		1,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit prepared receipt: response=%+v err=%v", response, err)
	}

	service := &TurnService{}
	if err := service.cancelTurn(context.Background(), "agent-1", turn.ID, "", ""); err != nil {
		t.Fatalf("cancel waiting tool turn: %v", err)
	}

	var reloadedTurn persistence.AgentTurn
	if err := fixture.db.First(&reloadedTurn, "id = ?", turn.ID).Error; err != nil {
		t.Fatalf("reload turn: %v", err)
	}
	if reloadedTurn.Status != string(domain.TurnStatusCancelled) {
		t.Fatalf("expected cancelled turn, got %s", reloadedTurn.Status)
	}
	var reloadedAttempt persistence.TurnAttempt
	if err := fixture.db.First(&reloadedAttempt, "id = ?", attempt.ID).Error; err != nil {
		t.Fatalf("reload attempt: %v", err)
	}
	if reloadedAttempt.Status != string(domain.TurnStatusCancelled) || reloadedAttempt.EndedAt == nil {
		t.Fatalf("expected cancelled terminal attempt, got %+v", reloadedAttempt)
	}
	var batch persistence.ToolBatch
	if err := fixture.db.First(&batch, "id = ?", "batch-1").Error; err != nil {
		t.Fatalf("reload tool batch: %v", err)
	}
	if batch.Status != persistence.ToolBatchStatusBlocked {
		t.Fatalf("cancelled turn must block its tool batch, got %s", batch.Status)
	}
	var calls []persistence.ToolCall
	if err := fixture.db.Where("tool_batch_id = ?", batch.ID).Find(&calls).Error; err != nil {
		t.Fatalf("reload tool calls: %v", err)
	}
	statusByID := make(map[string]string, len(calls))
	for i := range calls {
		statusByID[calls[i].ToolCallID] = calls[i].Status
	}
	if statusByID["tool-call-unprepared"] != persistence.ToolCallStatusCancelled {
		t.Fatalf("unprepared tool call must be cancelled, got %s", statusByID["tool-call-unprepared"])
	}
	if statusByID["tool-call-prepared"] != persistence.ToolCallStatusUnknownSideEffect {
		t.Fatalf("prepared tool call must become unknown side effect, got %s", statusByID["tool-call-prepared"])
	}
}

func receiptForEnvelope(
	envelope *model.ClientCapabilityRequest,
	sequence uint64,
	status model.ClientCapabilityReceiptStatus,
) *model.ClientCapabilityReceipt {
	return &model.ClientCapabilityReceipt{
		RequestId:           envelope.GetRequestId(),
		TurnId:              envelope.GetTurnId(),
		ToolCallId:          envelope.GetToolCallId(),
		CapabilitySessionId: envelope.GetCapabilitySessionId(),
		TargetDeviceId:      envelope.GetTargetDeviceId(),
		DecisionId:          envelope.GetDecisionId(),
		DecisionRevision:    envelope.GetDecisionRevision(),
		ExecutionClaimId:    envelope.GetExecutionClaimId(),
		ExecutorLeaseId:     envelope.GetExecutorLeaseId(),
		FencingToken:        envelope.GetFencingToken(),
		DispatchSequence:    envelope.GetDispatchSequence(),
		PayloadHash:         envelope.GetPayloadHash(),
		SideEffectReceiptId: "side-effect-" + envelope.GetToolCallId(),
		Status:              status,
		Sequence:            sequence,
		OccurredAt:          timestamppb.New(time.Date(2026, 8, 21, 12, 0, 0, 0, time.UTC)),
		ToolBatchId:         envelope.GetToolBatchId(),
	}
}

func protoCloneDecisionRequest(
	request *model.SubmitToolApprovalDecisionRequest,
) *model.SubmitToolApprovalDecisionRequest {
	return &model.SubmitToolApprovalDecisionRequest{
		ApprovalId:       request.GetApprovalId(),
		ToolCallId:       request.GetToolCallId(),
		DecisionId:       request.GetDecisionId(),
		ExpectedRevision: request.GetExpectedRevision(),
		Approved:         request.GetApproved(),
		IdempotencyKey:   request.GetIdempotencyKey(),
		PayloadHash:      request.GetPayloadHash(),
	}
}
