package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestConnectorManifestSyncProjectsOpaqueVersionedTools(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "connector-sync")
	if err := authority.db.AutoMigrate(
		&persistence.ConnectorResourceManifest{},
		&persistence.ConnectorManifestCommand{},
	); err != nil {
		t.Fatalf("migrate Connector authority: %v", err)
	}
	service := NewConnectorManifestService(authority.db, authority)
	service.now = authority.now
	ctx := context.Background()
	request := connectorSyncRequest(0, 1, "connector-sync-1")

	response, err := service.Sync(ctx, "ptid:person:owner", request)
	if err != nil {
		t.Fatalf("sync Connector manifests: %v", err)
	}
	if len(response.GetManifests()) != 2 ||
		len(response.GetCapabilityManifests()) != 2 {
		t.Fatalf("unexpected Connector projection: %+v", response)
	}
	for _, capability := range response.GetCapabilityManifests() {
		if capability.GetSourceKind() !=
			model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CONNECTOR ||
			capability.GetExecutionOwner() !=
				model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY ||
			capability.GetOwnerPtid() != "ptid:person:owner" ||
			!strings.HasPrefix(
				capability.GetSourceInstanceId(),
				"connector_resource_",
			) ||
			strings.Contains(capability.GetSourceInstanceId(), "github") {
			t.Fatalf("invalid Connector capability: %+v", capability)
		}
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("encode Connector projection: %v", err)
	}
	for _, forbidden := range []string{"access_token", "refresh_token", "client_secret"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("Connector projection leaked %s: %s", forbidden, encoded)
		}
	}

	replayed, err := service.Sync(ctx, "ptid:person:owner", request)
	if err != nil {
		t.Fatalf("replay Connector sync: %v", err)
	}
	if !proto.Equal(response, replayed) {
		t.Fatalf("Connector sync replay changed result")
	}
	other, err := service.List(ctx, "ptid:person:other", "github")
	if err != nil {
		t.Fatalf("list cross-actor Connector resources: %v", err)
	}
	if len(other) != 0 {
		t.Fatalf("cross-actor Connector resources leaked: %+v", other)
	}
}

func TestConnectorManifestRevisionRetiresAdmissionAndPinsArguments(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "connector-revision")
	if err := authority.db.AutoMigrate(
		&persistence.ConnectorResourceManifest{},
		&persistence.ConnectorManifestCommand{},
	); err != nil {
		t.Fatalf("migrate Connector authority: %v", err)
	}
	service := NewConnectorManifestService(authority.db, authority)
	service.now = authority.now
	ctx := context.Background()
	first, err := service.Sync(
		ctx,
		"ptid:person:owner",
		connectorSyncRequest(0, 1, "connector-sync-1"),
	)
	if err != nil {
		t.Fatalf("initial Connector sync: %v", err)
	}
	var resource *model.ConnectorResourceManifest
	for _, candidate := range first.GetManifests() {
		if candidate.GetResourceId() == "connection.status" {
			resource = candidate
			break
		}
	}
	if resource == nil || len(resource.GetToolManifests()) != 1 {
		t.Fatalf("missing status Connector resource: %+v", first)
	}
	reference := resource.GetToolManifests()[0]
	var capability *model.CapabilityManifest
	for _, candidate := range first.GetCapabilityManifests() {
		if candidate.GetCapabilityId() == reference.GetCapabilityId() &&
			candidate.GetVersion() == reference.GetCapabilityVersion() {
			capability = candidate
			break
		}
	}
	if capability == nil {
		t.Fatalf("missing status Connector capability: %+v", first)
	}
	seedCapabilityAuthorityAgent(
		t,
		authority.db,
		"agent-1",
		"ptid:person:owner",
		1,
	)
	binding, err := authority.UpsertBinding(
		ctx,
		"ptid:person:owner",
		&model.UpsertAgentCapabilityBindingRequest{
			Binding: &model.AgentCapabilityBinding{
				AgentId:              "agent-1",
				CapabilityId:         capability.GetCapabilityId(),
				CapabilityVersion:    capability.GetVersion(),
				Enabled:              true,
				ApprovalPolicy:       model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
				ExpectedAgentVersion: 1,
			},
			IdempotencyKey: "bind-connector",
		},
	)
	if err != nil {
		t.Fatalf("bind Connector capability: %v", err)
	}
	pinned, _, err := pinConnectorInvocationTx(
		authority.db,
		"ptid:person:owner",
		capability.GetSourceInstanceId(),
		capability.GetCapabilityId(),
		capability.GetVersion(),
		[]byte(`{"params":{"query":"safe"}}`),
		authority.now(),
	)
	if err != nil {
		t.Fatalf("pin Connector invocation: %v", err)
	}
	var arguments map[string]interface{}
	if err := json.Unmarshal(pinned, &arguments); err != nil {
		t.Fatalf("decode pinned arguments: %v", err)
	}
	if arguments["oauth_connection_id"] != "oauth-connection-1" ||
		arguments["resource_id"] != resource.GetResourceId() ||
		arguments["capability_id"] != capability.GetCapabilityId() {
		t.Fatalf("Connector identity was not pinned: %+v", arguments)
	}

	disconnect := connectorSyncRequest(1, 2, "connector-sync-2")
	disconnect.ConnectionStatus =
		model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REVOCATION_UNCONFIRMED
	second, err := service.Sync(ctx, "ptid:person:owner", disconnect)
	if err != nil {
		t.Fatalf("disconnect Connector sync: %v", err)
	}
	for _, manifest := range second.GetManifests() {
		if manifest.GetStatus() !=
			model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REVOCATION_UNCONFIRMED {
			t.Fatalf("disconnect status not projected: %+v", manifest)
		}
	}
	var retired persistence.CapabilityManifest
	if err := authority.db.Where(
		"capability_id = ? AND version = ?",
		capability.GetCapabilityId(),
		capability.GetVersion(),
	).First(&retired).Error; err != nil {
		t.Fatalf("load retired Connector capability: %v", err)
	}
	if retired.RetiredAt == nil {
		t.Fatalf("superseded Connector capability remained active")
	}
	var rebased persistence.AgentCapabilityBinding
	if err := authority.db.Where(
		"binding_id = ?",
		binding.GetBindingId(),
	).First(&rebased).Error; err != nil {
		t.Fatalf("load rebased Connector binding: %v", err)
	}
	if rebased.CapabilityVersion == capability.GetVersion() ||
		rebased.Revision != binding.GetRevision()+1 ||
		!rebased.Enabled {
		t.Fatalf("Connector binding was not rebased with policy intact: %+v", rebased)
	}
	currentState, currentReason, _, err := connectorReadinessForCapability(
		authority.db,
		"ptid:person:owner",
		rebased.CapabilityID,
		rebased.CapabilityVersion,
		authority.now(),
	)
	if err != nil {
		t.Fatalf("resolve disconnected Connector readiness: %v", err)
	}
	if currentState != model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED ||
		currentReason != "connector_revocation_unconfirmed" {
		t.Fatalf(
			"disconnected Connector readiness = %s/%s",
			currentState,
			currentReason,
		)
	}
	state, reason, _, err := connectorReadinessForCapability(
		authority.db,
		"ptid:person:owner",
		capability.GetCapabilityId(),
		capability.GetVersion(),
		authority.now(),
	)
	if err != nil {
		t.Fatalf("resolve stale Connector readiness: %v", err)
	}
	if state != model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED ||
		reason != "connector_manifest_stale" {
		t.Fatalf("stale Connector readiness = %s/%s", state, reason)
	}
}

func TestConnectorManifestScopeLossIsTyped(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "connector-scope")
	if err := authority.db.AutoMigrate(
		&persistence.ConnectorResourceManifest{},
		&persistence.ConnectorManifestCommand{},
	); err != nil {
		t.Fatalf("migrate Connector authority: %v", err)
	}
	service := NewConnectorManifestService(authority.db, authority)
	service.now = authority.now
	request := connectorSyncRequest(0, 1, "connector-sync-1")
	request.GrantedScopes = nil
	response, err := service.Sync(
		context.Background(),
		"ptid:person:owner",
		request,
	)
	if err != nil {
		t.Fatalf("sync scope-denied Connector: %v", err)
	}
	statuses := make(map[string]model.ConnectorResourceStatus)
	for _, manifest := range response.GetManifests() {
		statuses[manifest.GetResourceId()] = manifest.GetStatus()
	}
	if statuses["connection.status"] !=
		model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY ||
		statuses["connection.profile"] !=
			model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_SCOPE_DENIED {
		t.Fatalf("unexpected scope-derived statuses: %+v", statuses)
	}
}

func TestConnectorApprovalRevalidatesAfterDisconnect(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "connector-approval-race")
	if err := authority.db.AutoMigrate(
		&persistence.ConnectorResourceManifest{},
		&persistence.ConnectorManifestCommand{},
	); err != nil {
		t.Fatalf("migrate Connector authority: %v", err)
	}
	service := NewConnectorManifestService(authority.db, authority)
	service.now = authority.now
	first, err := service.Sync(
		context.Background(),
		"ptid:person:owner",
		connectorSyncRequest(0, 1, "connector-sync-1"),
	)
	if err != nil {
		t.Fatalf("initial Connector sync: %v", err)
	}
	resource := first.GetManifests()[0]
	reference := resource.GetToolManifests()[0]
	call := &persistence.ToolCall{
		ActorID:         "ptid:person:owner",
		CapabilityID:    reference.GetCapabilityId(),
		ManifestID:      reference.GetCapabilityId(),
		ManifestVersion: reference.GetCapabilityVersion(),
	}
	disconnect := connectorSyncRequest(1, 2, "connector-sync-2")
	disconnect.ConnectionStatus =
		model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REVOCATION_UNCONFIRMED
	if _, err := service.Sync(
		context.Background(),
		"ptid:person:owner",
		disconnect,
	); err != nil {
		t.Fatalf("disconnect Connector sync: %v", err)
	}
	outcome, err := connectorApprovalAvailabilityTx(
		authority.db,
		call,
		authority.now(),
	)
	if err != nil {
		t.Fatalf("revalidate Connector approval: %v", err)
	}
	if outcome == nil ||
		outcome.GetErrorType() != "CONNECTOR_REVOCATION_UNCONFIRMED" ||
		outcome.GetLocaleKey() != "agent.errors.connectorRevocationUnconfirmed" {
		t.Fatalf("disconnect approval outcome is not typed: %+v", outcome)
	}

	reconnected := connectorSyncRequest(2, 3, "connector-sync-3")
	if _, err := service.Sync(
		context.Background(),
		"ptid:person:owner",
		reconnected,
	); err != nil {
		t.Fatalf("reconnect Connector sync: %v", err)
	}
	outcome, err = connectorApprovalAvailabilityTx(
		authority.db,
		call,
		authority.now(),
	)
	if err != nil {
		t.Fatalf("revalidate stale Connector approval: %v", err)
	}
	if outcome == nil ||
		outcome.GetErrorType() != "CONNECTOR_MANIFEST_STALE" ||
		outcome.GetLocaleKey() != "agent.errors.connectorManifestStale" {
		t.Fatalf("reconnected stale approval outcome is not typed: %+v", outcome)
	}
}

func TestConnectorManifestResourceRemovalIsExplicit(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "connector-removal")
	if err := authority.db.AutoMigrate(
		&persistence.ConnectorResourceManifest{},
		&persistence.ConnectorManifestCommand{},
	); err != nil {
		t.Fatalf("migrate Connector authority: %v", err)
	}
	service := NewConnectorManifestService(authority.db, authority)
	service.now = authority.now
	if _, err := service.Sync(
		context.Background(),
		"ptid:person:owner",
		connectorSyncRequest(0, 1, "connector-sync-1"),
	); err != nil {
		t.Fatalf("initial Connector sync: %v", err)
	}
	removed := connectorSyncRequest(1, 2, "connector-sync-2")
	removed.Resources = removed.Resources[:1]
	response, err := service.Sync(
		context.Background(),
		"ptid:person:owner",
		removed,
	)
	if err != nil {
		t.Fatalf("remove Connector resource: %v", err)
	}
	statuses := make(map[string]model.ConnectorResourceStatus)
	for _, manifest := range response.GetManifests() {
		statuses[manifest.GetResourceId()] = manifest.GetStatus()
	}
	if statuses["connection.status"] !=
		model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY ||
		statuses["connection.profile"] !=
			model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REMOVED {
		t.Fatalf("resource removal was not projected: %+v", statuses)
	}
}

func TestConnectorInvocationRejectsCredentialShapedParams(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "connector-secret-params")
	if err := authority.db.AutoMigrate(
		&persistence.ConnectorResourceManifest{},
		&persistence.ConnectorManifestCommand{},
	); err != nil {
		t.Fatalf("migrate Connector authority: %v", err)
	}
	service := NewConnectorManifestService(authority.db, authority)
	service.now = authority.now
	response, err := service.Sync(
		context.Background(),
		"ptid:person:owner",
		connectorSyncRequest(0, 1, "connector-sync-1"),
	)
	if err != nil {
		t.Fatalf("sync Connector manifests: %v", err)
	}
	resource := response.GetManifests()[0]
	reference := resource.GetToolManifests()[0]
	var capability *model.CapabilityManifest
	for _, candidate := range response.GetCapabilityManifests() {
		if candidate.GetCapabilityId() == reference.GetCapabilityId() &&
			candidate.GetVersion() == reference.GetCapabilityVersion() {
			capability = candidate
			break
		}
	}
	if capability == nil {
		t.Fatalf("missing Connector capability: %+v", response)
	}
	_, _, err = pinConnectorInvocationTx(
		authority.db,
		"ptid:person:owner",
		capability.GetSourceInstanceId(),
		reference.GetCapabilityId(),
		reference.GetCapabilityVersion(),
		[]byte(`{"params":{"nested":{"access_token":"must-not-persist"}}}`),
		authority.now(),
	)
	if err == nil || !strings.Contains(err.Error(), "credential material") {
		t.Fatalf("credential-shaped Connector params were accepted: %v", err)
	}
}

func TestConnectorToolDefinitionUsesOpaqueFixedSchema(t *testing.T) {
	registry := NewToolRegistryService(nil, nil)
	name := "connector_resource_" + strings.Repeat("a", 24)
	definitions := registry.Definitions([]string{name, "connector_github"})
	if len(definitions) != 1 || definitions[0].Name != name {
		t.Fatalf("unexpected Connector definitions: %+v", definitions)
	}
	schema := string(definitions[0].JSONSchema)
	if strings.Contains(schema, "provider_id") ||
		strings.Contains(schema, "resource_id") ||
		!strings.Contains(schema, `"additionalProperties":false`) {
		t.Fatalf("Connector schema exposes mutable identity: %s", schema)
	}
}

func connectorSyncRequest(
	expectedRevision uint64,
	revision uint64,
	idempotencyKey string,
) *model.SyncConnectorResourceManifestsRequest {
	return &model.SyncConnectorResourceManifestsRequest{
		ConnectorId:                "github",
		OauthConnectionId:          "oauth-connection-1",
		ExpectedConnectionRevision: expectedRevision,
		ConnectionRevision:         revision,
		GrantedScopes:              []string{"read:user"},
		ConnectionStatus:           model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY,
		ExpiresAt:                  timestamppb.New(time.Date(2026, time.August, 28, 12, 0, 0, 0, time.UTC)),
		Resources: []*model.ConnectorResourceProjection{
			{
				ResourceId:      "connection.status",
				ResourceVersion: "connection-status",
				Status:          model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY,
			},
			{
				ResourceId:      "connection.profile",
				ResourceVersion: "connection-profile",
				RequiredScopes:  []string{"read:user"},
				Status:          model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY,
			},
		},
		IdempotencyKey: idempotencyKey,
	}
}
