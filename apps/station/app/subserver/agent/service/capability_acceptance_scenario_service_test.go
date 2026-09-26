package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

const capabilityAcceptanceTestActor = "ptid:person:acceptance"

func TestCapabilityAcceptanceScenarioEnvironmentGate(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "scenario-environment")
	t.Setenv("PT_ACCEPTANCE_ENVIRONMENT", "production")
	t.Setenv("PT_AGENT_CAPABILITY_SCENARIO_CONTROL", "1")
	t.Setenv("PT_ACCEPTANCE_RUN_ID", "run-1")
	if service := NewCapabilityAcceptanceScenarioServiceFromEnvironment(authority); service != nil {
		t.Fatal("production environment enabled capability scenario control")
	}

	t.Setenv("PT_ACCEPTANCE_ENVIRONMENT", capabilityAcceptanceEnvironment)
	t.Setenv("PT_AGENT_CAPABILITY_SCENARIO_CONTROL", "0")
	if service := NewCapabilityAcceptanceScenarioServiceFromEnvironment(authority); service != nil {
		t.Fatal("disabled capability scenario control was created")
	}

	t.Setenv("PT_AGENT_CAPABILITY_SCENARIO_CONTROL", "1")
	if service := NewCapabilityAcceptanceScenarioServiceFromEnvironment(authority); service == nil {
		t.Fatal("explicit Acceptance environment did not enable scenario control")
	}
}

func TestCapabilityAcceptanceScenarioRejectsUnreviewedTupleAndRun(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "scenario-validation")
	scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")

	request := capabilityAcceptanceRequest("run-other", "AS-03", "execution-1")
	if _, err := scenarios.Prepare(
		context.Background(),
		capabilityAcceptanceTestActor,
		request,
	); !isCapabilityError(err, errcode.AgentUnauthorized) {
		t.Fatalf("expected run identity rejection, got %v", err)
	}

	request = capabilityAcceptanceRequest("run-1", "UNREVIEWED", "execution-2")
	if _, err := scenarios.Prepare(
		context.Background(),
		capabilityAcceptanceTestActor,
		request,
	); !isCapabilityError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("expected unreviewed tuple rejection, got %v", err)
	}
}

func TestCapabilityAcceptanceScenarioRejectsCrossFamilyAndProfileTuple(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "scenario-family-profile")
	scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")

	request := capabilityAcceptanceRequest("run-1", "CR-03", "execution-family")
	if _, err := scenarios.Prepare(
		context.Background(),
		capabilityAcceptanceTestActor,
		request,
	); !isCapabilityError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("expected cross-family cell rejection, got %v", err)
	}

	request.Family =
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03
	request.RuntimeAttestationProfile =
		model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_CAPABILITY_TURN
	if _, err := scenarios.Prepare(
		context.Background(),
		capabilityAcceptanceTestActor,
		request,
	); !isCapabilityError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("expected platform/profile rejection, got %v", err)
	}
}

func TestCapabilityAcceptanceScenarioJ03ZeroExecutionProfiles(t *testing.T) {
	tests := []struct {
		name     string
		cell     string
		platform string
		ordering string
		profile  model.CapabilityAcceptanceRuntimeProfile
		allowed  bool
	}{
		{
			name:     "executor unavailable uses Station Turn",
			cell:     "ERR-O01",
			platform: "desktop_app",
			ordering: "single",
			profile:  model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_TURN,
			allowed:  true,
		},
		{
			name:     "executor unavailable rejects client receipt profile",
			cell:     "ERR-O01",
			platform: "desktop_app",
			ordering: "single",
			profile:  model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
		},
		{
			name:     "revoke first uses Station Turn",
			cell:     "R-05",
			platform: "browser",
			ordering: "A",
			profile:  model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_TURN,
			allowed:  true,
		},
		{
			name:     "dispatch first keeps Station executor profile",
			cell:     "R-05",
			platform: "browser",
			ordering: "B",
			profile:  model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_CAPABILITY_TURN,
			allowed:  true,
		},
		{
			name:     "dispatch first rejects Station Turn",
			cell:     "R-07",
			platform: "browser",
			ordering: "B",
			profile:  model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_TURN,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := capabilityAcceptanceRequest(
				"run-1",
				test.cell,
				"execution-profile",
			)
			request.Family =
				model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03
			request.Platform = test.platform
			request.Ordering = test.ordering
			request.RuntimeAttestationProfile = test.profile
			err := validateCapabilityAcceptanceTuple(request)
			if test.allowed && err != nil {
				t.Fatalf("expected reviewed profile, got %v", err)
			}
			if !test.allowed && !isCapabilityError(err, errcode.AgentInvalidRequest) {
				t.Fatalf("expected profile rejection, got %v", err)
			}
		})
	}
}

func TestCapabilityAcceptanceScenarioExecutorHookTicketIsSingleUse(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "scenario-executor-hook")
	scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
	request := capabilityAcceptanceRequest("run-1", "CR-03", "execution-hook")
	request.Family =
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03
	request.RuntimeAttestationProfile =
		model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN
	request.Locale = "neutral"

	prepared, err := scenarios.Prepare(
		context.Background(),
		capabilityAcceptanceTestActor,
		request,
	)
	if err != nil {
		t.Fatalf("prepare executor hook scenario: %v", err)
	}
	if prepared.GetExecutorHookTicket() == "" {
		t.Fatal("executor hook ticket is missing")
	}
	arm := &model.ArmCapabilityAcceptanceExecutorHookRequest{
		ScenarioHandle:     prepared.GetScenarioHandle(),
		ExecutorHookTicket: prepared.GetExecutorHookTicket(),
	}
	armed, err := scenarios.ArmExecutorHook(capabilityAcceptanceTestActor, arm)
	if err != nil {
		t.Fatalf("arm executor hook: %v", err)
	}
	if armed.GetBarrier() != capabilityBarrierPreparedBeforeEffect {
		t.Fatalf("armed barrier = %q", armed.GetBarrier())
	}
	if armed.GetFamily() != request.GetFamily() {
		t.Fatalf("armed family = %s, want %s", armed.GetFamily(), request.GetFamily())
	}
	if _, err := scenarios.ArmExecutorHook(
		capabilityAcceptanceTestActor,
		arm,
	); !isCapabilityError(err, errcode.AgentUnauthorized) {
		t.Fatalf("expected one-time ticket rejection, got %v", err)
	}
}

func TestCapabilityAcceptanceScenarioBarrierInterruptsOnlyOneWorkerGeneration(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "scenario-worker-interrupt")
	scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
	request := capabilityAcceptanceRequest("run-1", "CR-03", "execution-interrupt")
	request.Family =
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03
	request.RuntimeAttestationProfile =
		model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN
	request.Locale = "neutral"
	prepared, err := scenarios.Prepare(
		context.Background(),
		capabilityAcceptanceTestActor,
		request,
	)
	if err != nil {
		t.Fatalf("prepare interrupt scenario: %v", err)
	}
	if _, err := scenarios.ArmExecutorHook(
		capabilityAcceptanceTestActor,
		&model.ArmCapabilityAcceptanceExecutorHookRequest{
			ScenarioHandle:     prepared.GetScenarioHandle(),
			ExecutorHookTicket: prepared.GetExecutorHookTicket(),
		},
	); err != nil {
		t.Fatalf("arm executor hook: %v", err)
	}

	interrupted := make(chan bool, 1)
	go func() {
		value, reachErr := scenarios.ReachStationBarrier(
			context.Background(),
			capabilityAcceptanceTestActor,
			request.GetFamily(),
			capabilityBarrierPreparedBeforeEffect,
		)
		if reachErr != nil {
			t.Errorf("reach barrier: %v", reachErr)
			return
		}
		interrupted <- value
	}()
	if _, err := scenarios.WaitBarrier(
		context.Background(),
		capabilityAcceptanceTestActor,
		&model.WaitCapabilityAcceptanceBarrierRequest{
			ScenarioHandle: prepared.GetScenarioHandle(),
			Barrier:        capabilityBarrierPreparedBeforeEffect,
		},
	); err != nil {
		t.Fatalf("wait barrier: %v", err)
	}
	if _, err := scenarios.InterruptWorker(
		capabilityAcceptanceTestActor,
		&model.InterruptCapabilityAcceptanceWorkerRequest{
			ScenarioHandle: prepared.GetScenarioHandle(),
			Barrier:        capabilityBarrierPreparedBeforeEffect,
		},
	); err != nil {
		t.Fatalf("interrupt worker: %v", err)
	}
	select {
	case value := <-interrupted:
		if !value {
			t.Fatal("first worker generation was not interrupted")
		}
	case <-time.After(time.Second):
		t.Fatal("first worker generation did not leave the barrier")
	}
	value, err := scenarios.ReachStationBarrier(
		context.Background(),
		capabilityAcceptanceTestActor,
		request.GetFamily(),
		capabilityBarrierPreparedBeforeEffect,
	)
	if err != nil || value {
		t.Fatalf("recovery generation did not pass barrier: interrupted=%v err=%v", value, err)
	}
}

func TestCapabilityAcceptanceScenarioTupleBarrierMatchesExactOrdering(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "scenario-tuple-barrier")
	scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
	request := capabilityAcceptanceRequest("run-1", "R-03", "execution-race-b")
	request.Family =
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03
	request.Platform = "browser"
	request.Ordering = "B"
	request.RuntimeAttestationProfile =
		model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_CAPABILITY_TURN
	prepared, err := scenarios.Prepare(
		context.Background(),
		capabilityAcceptanceTestActor,
		request,
	)
	if err != nil {
		t.Fatalf("prepare R-03/B: %v", err)
	}
	if prepared.GetExecutorHookTicket() != "" {
		t.Fatal("Station executor race unexpectedly issued a Desktop hook ticket")
	}
	if interrupted, err := scenarios.ReachStationTupleBarrier(
		context.Background(),
		capabilityAcceptanceTestActor,
		request.GetFamily(),
		"R-03",
		"A",
	); err != nil || interrupted {
		t.Fatalf("wrong ordering matched tuple barrier: interrupted=%v err=%v", interrupted, err)
	}

	type barrierResult struct {
		interrupted bool
		err         error
	}
	reached := make(chan barrierResult, 1)
	go func() {
		interrupted, reachErr := scenarios.ReachStationTupleBarrier(
			context.Background(),
			capabilityAcceptanceTestActor,
			request.GetFamily(),
			"R-03",
			"B",
		)
		reached <- barrierResult{interrupted: interrupted, err: reachErr}
	}()
	if _, err := scenarios.WaitBarrier(
		context.Background(),
		capabilityAcceptanceTestActor,
		&model.WaitCapabilityAcceptanceBarrierRequest{
			ScenarioHandle: prepared.GetScenarioHandle(),
			Barrier:        capabilityBarrierCancelResultRace,
		},
	); err != nil {
		t.Fatalf("wait R-03/B barrier: %v", err)
	}
	if _, err := scenarios.InterruptWorker(
		capabilityAcceptanceTestActor,
		&model.InterruptCapabilityAcceptanceWorkerRequest{
			ScenarioHandle: prepared.GetScenarioHandle(),
			Barrier:        capabilityBarrierCancelResultRace,
		},
	); err != nil {
		t.Fatalf("interrupt R-03/B barrier: %v", err)
	}
	select {
	case result := <-reached:
		if result.err != nil || !result.interrupted {
			t.Fatalf(
				"R-03/B barrier result: interrupted=%v err=%v",
				result.interrupted,
				result.err,
			)
		}
	case <-time.After(time.Second):
		t.Fatal("R-03/B barrier did not resume")
	}
}

func TestCapabilityAcceptanceScenarioIssuesOnlyOwnedExecutorHooks(t *testing.T) {
	tests := []struct {
		cell       string
		expectHook bool
	}{
		{cell: "R-05", expectHook: true},
		{cell: "R-07", expectHook: false},
	}
	for _, test := range tests {
		t.Run(test.cell, func(t *testing.T) {
			authority := newCapabilityAuthorityTestService(
				t,
				"scenario-hook-owner-"+test.cell,
			)
			scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
			request := capabilityAcceptanceRequest(
				"run-1",
				test.cell,
				"execution-hook-owner",
			)
			request.Family =
				model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03
			request.Ordering = "B"
			request.RuntimeAttestationProfile =
				model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN
			prepared, err := scenarios.Prepare(
				context.Background(),
				capabilityAcceptanceTestActor,
				request,
			)
			if err != nil {
				t.Fatalf("prepare %s/B: %v", test.cell, err)
			}
			if (prepared.GetExecutorHookTicket() != "") != test.expectHook {
				t.Fatalf(
					"%s/B executor hook present=%v, want %v",
					test.cell,
					prepared.GetExecutorHookTicket() != "",
					test.expectHook,
				)
			}
		})
	}
}

func TestCapabilityAcceptanceScenarioJ04AndJ05HookOwnership(t *testing.T) {
	tests := []struct {
		name       string
		family     model.CapabilityAcceptanceScenarioFamily
		profile    model.CapabilityAcceptanceRuntimeProfile
		cell       string
		ordering   string
		expectHook bool
	}{
		{
			name:    "MCP prepared boundary is Desktop-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
			cell:    "R-01", ordering: "A", expectHook: true,
		},
		{
			name:    "MCP cleanup takeover boundary is Desktop-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
			cell:    "R-02", ordering: "A", expectHook: true,
		},
		{
			name:    "MCP cancel result boundary is Desktop-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
			cell:    "R-03", ordering: "A", expectHook: true,
		},
		{
			name:    "MCP reconnect race is Station-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
			cell:    "R-04", ordering: "A", expectHook: false,
		},
		{
			name:    "MCP unavailable executor boundary is Station-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
			cell:    "ERR-O01", ordering: "single", expectHook: false,
		},
		{
			name:    "MCP business lease boundary is Desktop-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
			cell:    "ERR-O02", ordering: "single", expectHook: true,
		},
		{
			name:    "MCP cancellation cleanup boundary is Desktop-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
			cell:    "ERR-O03", ordering: "single", expectHook: true,
		},
		{
			name:    "MCP execution deadline boundary is Desktop-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
			cell:    "ERR-O04", ordering: "single", expectHook: true,
		},
		{
			name:    "MCP disconnect after creation is Station-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
			cell:    "ERR-O05", ordering: "single", expectHook: false,
		},
		{
			name:    "MCP cleanup lease boundary is Desktop-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
			cell:    "ERR-O06", ordering: "single", expectHook: true,
		},
		{
			name:    "MCP ambiguous effect boundary is Desktop-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
			cell:    "ERR-O07", ordering: "single", expectHook: true,
		},
		{
			name:    "MCP stale fence boundary is Desktop-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN,
			cell:    "ERR-O08", ordering: "single", expectHook: true,
		},
		{
			name:    "Connector disconnect race is Station-owned",
			family:  model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_CONNECTOR_J05,
			profile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_CAPABILITY_TURN,
			cell:    "R-06", ordering: "A", expectHook: false,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			authority := newCapabilityAuthorityTestService(
				t,
				"scenario-family-hook-"+strings.ToLower(test.cell),
			)
			scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
			request := capabilityAcceptanceRequest(
				"run-1",
				test.cell,
				"execution-family-hook",
			)
			request.Family = test.family
			request.RuntimeAttestationProfile = test.profile
			request.Ordering = test.ordering
			prepared, err := scenarios.Prepare(
				context.Background(),
				capabilityAcceptanceTestActor,
				request,
			)
			if err != nil {
				t.Fatalf("prepare %s: %v", test.cell, err)
			}
			if (prepared.GetExecutorHookTicket() != "") != test.expectHook {
				t.Fatalf(
					"%s executor hook present=%v, want %v",
					test.cell,
					prepared.GetExecutorHookTicket() != "",
					test.expectHook,
				)
			}
		})
	}
}

func TestCapabilityAcceptanceScenarioBindsOneMCPOperationExecutor(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "scenario-operation-binding")
	scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
	request := capabilityAcceptanceRequest("run-1", "R-01", "execution-operation")
	request.Family =
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04
	request.RuntimeAttestationProfile =
		model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN
	request.Ordering = "A"
	if _, err := scenarios.Prepare(
		context.Background(),
		capabilityAcceptanceTestActor,
		request,
	); err != nil {
		t.Fatalf("prepare MCP scenario: %v", err)
	}
	if err := scenarios.BindCapabilityOperation(
		capabilityAcceptanceTestActor,
		"operation-1",
		"device-1",
		"session-1",
	); err != nil {
		t.Fatalf("bind MCP operation: %v", err)
	}
	if err := scenarios.BindCapabilityOperation(
		capabilityAcceptanceTestActor,
		"operation-2",
		"device-1",
		"session-1",
	); !isCapabilityError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("expected second operation rejection, got %v", err)
	}
	if err := scenarios.BindCapabilityOperation(
		capabilityAcceptanceTestActor,
		"operation-1",
		"device-2",
		"session-1",
	); !isCapabilityError(err, errcode.AgentInvalidRequest) {
		t.Fatalf("expected cross-device operation rejection, got %v", err)
	}
}

func TestCapabilityAcceptanceScenarioPublishesTypedCatalogIssueAndCleans(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "scenario-catalog-issue")
	scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
	response, err := scenarios.Prepare(
		context.Background(),
		capabilityAcceptanceTestActor,
		capabilityAcceptanceRequest("run-1", "ERR-CAT03", "execution-1"),
	)
	if err != nil {
		t.Fatalf("prepare invalid catalog scenario: %v", err)
	}
	capabilityID := acceptanceResource(response.GetOpaqueResourceIds(), "capability_id:")
	_, issues, err := authority.ListManifestInventory(
		context.Background(),
		capabilityAcceptanceTestActor,
		nil,
	)
	if err != nil {
		t.Fatalf("list manifest inventory: %v", err)
	}
	if len(issues) != 1 ||
		issues[0].GetCapabilityId() != capabilityID ||
		issues[0].GetCode() !=
			model.CapabilityCatalogErrorCode_CAPABILITY_CATALOG_ERROR_CODE_SCHEMA_INVALID ||
		issues[0].GetError().GetErrorType() !=
			string(errcode.AgentCapabilityManifestSchemaInvalid) {
		t.Fatalf("typed catalog issue mismatch: %+v", issues)
	}
	if _, err := scenarios.Cleanup(
		context.Background(),
		capabilityAcceptanceTestActor,
		&model.CleanupCapabilityAcceptanceScenarioRequest{
			ScenarioHandle: response.GetScenarioHandle(),
		},
	); err != nil {
		t.Fatalf("cleanup invalid catalog scenario: %v", err)
	}
	_, issues, err = authority.ListManifestInventory(
		context.Background(),
		capabilityAcceptanceTestActor,
		nil,
	)
	if err != nil {
		t.Fatalf("list cleaned manifest inventory: %v", err)
	}
	if len(issues) != 0 {
		t.Fatalf("catalog issues remained after cleanup: %+v", issues)
	}
}

func TestCapabilityAcceptanceScenarioTypedBindingErrors(t *testing.T) {
	tests := []struct {
		cell          string
		expectedCode  errcode.Code
		mutateRequest func(*model.UpsertAgentCapabilityBindingRequest)
	}{
		{
			cell:         "ERR-CAT01",
			expectedCode: errcode.AgentCapabilityManifestNotFound,
		},
		{
			cell:         "ERR-CAT02",
			expectedCode: errcode.AgentCapabilityManifestVersionStale,
		},
		{
			cell:         "ERR-B02",
			expectedCode: errcode.AgentCapabilityUnavailable,
		},
		{
			cell:         "ERR-B03",
			expectedCode: errcode.AgentCapabilityPolicyInvalid,
			mutateRequest: func(request *model.UpsertAgentCapabilityBindingRequest) {
				request.Binding.ApprovalPolicy =
					model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_UNSPECIFIED
			},
		},
	}
	for _, test := range tests {
		t.Run(test.cell, func(t *testing.T) {
			authority := newCapabilityAuthorityTestService(
				t,
				"scenario-error-"+strings.ToLower(test.cell),
			)
			scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
			response, err := scenarios.Prepare(
				context.Background(),
				capabilityAcceptanceTestActor,
				capabilityAcceptanceRequest("run-1", test.cell, "execution-"+test.cell),
			)
			if err != nil {
				t.Fatalf("prepare %s: %v", test.cell, err)
			}
			if test.cell == "ERR-CAT01" || test.cell == "ERR-CAT02" {
				barrier := capabilityBarrierManifestAbsent
				if test.cell == "ERR-CAT02" {
					barrier = capabilityBarrierVersionStale
				}
				if _, err := scenarios.ReleaseBarrier(
					context.Background(),
					capabilityAcceptanceTestActor,
					&model.ReleaseCapabilityAcceptanceBarrierRequest{
						ScenarioHandle: response.GetScenarioHandle(),
						Barrier:        barrier,
					},
				); err != nil {
					t.Fatalf("release %s barrier: %v", test.cell, err)
				}
			}
			seedCapabilityAuthorityAgent(
				t,
				authority.db,
				"agent-1",
				capabilityAcceptanceTestActor,
				1,
			)
			request := capabilityAcceptanceBindingRequest(response)
			if test.mutateRequest != nil {
				test.mutateRequest(request)
			}
			_, mutationErr := authority.UpsertBinding(
				context.Background(),
				capabilityAcceptanceTestActor,
				request,
			)
			if !isCapabilityError(mutationErr, test.expectedCode) {
				t.Fatalf("expected %s, got %v", test.expectedCode, mutationErr)
			}
			businessError := capabilityBusinessError(t, mutationErr)
			if businessError.Payload == nil ||
				businessError.Payload.GetLocaleKey() == "" ||
				!businessError.Payload.GetTerminal() {
				t.Fatalf("typed error payload is incomplete: %+v", businessError.Payload)
			}
			for _, key := range expectedCapabilityErrorDetailKeys(test.cell) {
				if strings.TrimSpace(businessError.Payload.GetDetails()[key]) == "" {
					t.Fatalf("%s detail %q is missing: %+v", test.cell, key, businessError.Payload)
				}
			}
		})
	}
}

func TestCapabilityAcceptanceScenarioBindingBarrierAndCleanup(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "scenario-barrier")
	scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
	response, err := scenarios.Prepare(
		context.Background(),
		capabilityAcceptanceTestActor,
		capabilityAcceptanceRequest("run-1", "TAX-02", "execution-tax-02"),
	)
	if err != nil {
		t.Fatalf("prepare TAX-02: %v", err)
	}
	seedCapabilityAuthorityAgent(
		t,
		authority.db,
		"agent-1",
		capabilityAcceptanceTestActor,
		1,
	)
	result := make(chan error, 1)
	go func() {
		_, bindingErr := authority.UpsertBinding(
			context.Background(),
			capabilityAcceptanceTestActor,
			capabilityAcceptanceBindingRequest(response),
		)
		result <- bindingErr
	}()
	select {
	case err := <-result:
		t.Fatalf("binding crossed the unreleased barrier: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	if _, err := scenarios.ReleaseBarrier(
		context.Background(),
		capabilityAcceptanceTestActor,
		&model.ReleaseCapabilityAcceptanceBarrierRequest{
			ScenarioHandle: response.GetScenarioHandle(),
			Barrier:        capabilityBarrierBindingAck,
		},
	); err != nil {
		t.Fatalf("release binding barrier: %v", err)
	}
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("binding failed after barrier release: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("binding did not resume after barrier release")
	}
	if _, err := scenarios.Cleanup(
		context.Background(),
		capabilityAcceptanceTestActor,
		&model.CleanupCapabilityAcceptanceScenarioRequest{
			ScenarioHandle: response.GetScenarioHandle(),
		},
	); err != nil {
		t.Fatalf("cleanup TAX-02: %v", err)
	}
	if _, err := scenarios.Cleanup(
		context.Background(),
		capabilityAcceptanceTestActor,
		&model.CleanupCapabilityAcceptanceScenarioRequest{
			ScenarioHandle: response.GetScenarioHandle(),
		},
	); err != nil {
		t.Fatalf("repeat cleanup TAX-02: %v", err)
	}
	var manifests int64
	if err := authority.db.Model(&persistence.CapabilityManifest{}).
		Where("capability_id LIKE ?", capabilityAcceptancePrefix+"%").
		Count(&manifests).Error; err != nil {
		t.Fatalf("count scenario manifests: %v", err)
	}
	var bindings int64
	if err := authority.db.Model(&persistence.AgentCapabilityBinding{}).
		Where("capability_id LIKE ?", capabilityAcceptancePrefix+"%").
		Count(&bindings).Error; err != nil {
		t.Fatalf("count scenario bindings: %v", err)
	}
	if manifests != 0 || bindings != 0 {
		t.Fatalf("scenario cleanup left manifests=%d bindings=%d", manifests, bindings)
	}
}

func TestCapabilityAcceptanceScenarioCleanupCancelsBlockedBinding(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "scenario-cleanup-cancel")
	scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
	response, err := scenarios.Prepare(
		context.Background(),
		capabilityAcceptanceTestActor,
		capabilityAcceptanceRequest("run-1", "TAX-02", "execution-cleanup"),
	)
	if err != nil {
		t.Fatalf("prepare TAX-02: %v", err)
	}
	seedCapabilityAuthorityAgent(
		t,
		authority.db,
		"agent-1",
		capabilityAcceptanceTestActor,
		1,
	)
	result := make(chan error, 1)
	go func() {
		_, bindingErr := authority.UpsertBinding(
			context.Background(),
			capabilityAcceptanceTestActor,
			capabilityAcceptanceBindingRequest(response),
		)
		result <- bindingErr
	}()
	select {
	case err := <-result:
		t.Fatalf("binding crossed the unreleased barrier: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	if _, err := scenarios.Cleanup(
		context.Background(),
		capabilityAcceptanceTestActor,
		&model.CleanupCapabilityAcceptanceScenarioRequest{
			ScenarioHandle: response.GetScenarioHandle(),
		},
	); err != nil {
		t.Fatalf("cleanup TAX-02: %v", err)
	}
	select {
	case err := <-result:
		if !isCapabilityError(err, errcode.AgentInvalidSourceState) {
			t.Fatalf("expected cleanup cancellation, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("blocked binding did not stop after cleanup")
	}
	var bindings int64
	if err := authority.db.Model(&persistence.AgentCapabilityBinding{}).
		Where("capability_id LIKE ?", capabilityAcceptancePrefix+"%").
		Count(&bindings).Error; err != nil {
		t.Fatalf("count scenario bindings: %v", err)
	}
	if bindings != 0 {
		t.Fatalf("cleanup-cancelled binding left %d rows", bindings)
	}
}

func TestCapabilityAcceptanceScenarioRejectsCrossActorCleanup(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "scenario-actor")
	scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
	response, err := scenarios.Prepare(
		context.Background(),
		capabilityAcceptanceTestActor,
		capabilityAcceptanceRequest("run-1", "AS-10", "execution-as-10"),
	)
	if err != nil {
		t.Fatalf("prepare AS-10: %v", err)
	}
	_, err = scenarios.Cleanup(
		context.Background(),
		"ptid:person:secondary",
		&model.CleanupCapabilityAcceptanceScenarioRequest{
			ScenarioHandle: response.GetScenarioHandle(),
		},
	)
	if !isCapabilityError(err, errcode.AgentNotFound) {
		t.Fatalf("expected cross-actor cleanup rejection, got %v", err)
	}
}

func capabilityAcceptanceRequest(
	runID string,
	cell string,
	executionID string,
) *model.PrepareCapabilityAcceptanceScenarioRequest {
	return &model.PrepareCapabilityAcceptanceScenarioRequest{
		RunId:                     runID,
		ScenarioExecutionId:       executionID,
		Cell:                      cell,
		Platform:                  "desktop_app",
		Locale:                    "en",
		Ordering:                  "single",
		SampleId:                  "sample-001",
		Family:                    model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_BINDING_J02,
		RuntimeAttestationProfile: model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_CONTROL_PLANE,
	}
}

func capabilityAcceptanceBindingRequest(
	response *model.PrepareCapabilityAcceptanceScenarioResponse,
) *model.UpsertAgentCapabilityBindingRequest {
	return &model.UpsertAgentCapabilityBindingRequest{
		Binding: &model.AgentCapabilityBinding{
			AgentId:              "agent-1",
			CapabilityId:         acceptanceResource(response.GetOpaqueResourceIds(), "capability_id:"),
			CapabilityVersion:    acceptanceResource(response.GetOpaqueResourceIds(), "requested_version:"),
			Enabled:              true,
			ApprovalPolicy:       model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
			ExpectedAgentVersion: 1,
		},
		IdempotencyKey: "scenario-binding",
	}
}

func acceptanceResource(resources []string, prefix string) string {
	for _, resource := range resources {
		if strings.HasPrefix(resource, prefix) {
			return strings.TrimPrefix(resource, prefix)
		}
	}
	return ""
}

func expectedCapabilityErrorDetailKeys(cell string) []string {
	switch cell {
	case "ERR-CAT01":
		return []string{"capability_id", "capability_version"}
	case "ERR-CAT02":
		return []string{"capability_id", "expected_version", "actual_version"}
	case "ERR-B02":
		return []string{"capability_id", "target_device_id", "reason_code"}
	case "ERR-B03":
		return []string{"policy_kind", "reason_code"}
	default:
		return nil
	}
}

func capabilityBusinessError(t *testing.T, err error) *errcode.BizError {
	t.Helper()
	var businessError *errcode.BizError
	if !errors.As(err, &businessError) {
		t.Fatalf("expected typed capability error, got %T: %v", err, err)
	}
	return businessError
}
