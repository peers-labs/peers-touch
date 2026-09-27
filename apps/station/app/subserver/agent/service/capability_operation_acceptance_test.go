package service

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestCapabilityOperationAcceptanceRejectsUnavailableExecutorBeforeDispatch(t *testing.T) {
	authority, operations, start := newUnstartedCapabilityOperationFixture(
		t,
		"operation-acceptance-unavailable",
	)
	scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
	scenarios.SetCapabilityOperationService(operations)
	operations.SetAcceptanceScenarioService(scenarios)
	request := capabilityAcceptanceRequest(
		"run-1",
		"ERR-O01",
		"operation-acceptance-unavailable",
	)
	request.Family =
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04
	request.RuntimeAttestationProfile =
		model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN
	prepared, err := scenarios.Prepare(
		context.Background(),
		"ptid:person:owner",
		request,
	)
	if err != nil {
		t.Fatalf("prepare unavailable-executor scenario: %v", err)
	}

	startResult := make(chan error, 1)
	go func() {
		_, startErr := operations.Start(
			context.Background(),
			"ptid:person:owner",
			start,
		)
		startResult <- startErr
	}()
	if _, err := scenarios.WaitBarrier(
		context.Background(),
		"ptid:person:owner",
		&model.WaitCapabilityAcceptanceBarrierRequest{
			ScenarioHandle: prepared.GetScenarioHandle(),
			Barrier:        capabilityBarrierExecutorBeforeDispatch,
		},
	); err != nil {
		t.Fatalf("wait unavailable-executor barrier: %v", err)
	}
	if _, err := scenarios.ReleaseBarrier(
		context.Background(),
		"ptid:person:owner",
		&model.ReleaseCapabilityAcceptanceBarrierRequest{
			ScenarioHandle: prepared.GetScenarioHandle(),
			Barrier:        capabilityBarrierExecutorBeforeDispatch,
		},
	); err != nil {
		t.Fatalf("release unavailable-executor barrier: %v", err)
	}
	select {
	case err := <-startResult:
		if !isCapabilityError(err, errcode.AgentNotFound) {
			t.Fatalf("expected unavailable executor rejection, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("operation start did not resume")
	}
	assertCapabilityOperationRowCount(
		t,
		authority.db,
		&persistence.CapabilityOperation{},
		0,
	)
	assertCapabilityOperationRowCount(
		t,
		authority.db,
		&persistence.CapabilityOperationOutbox{},
		0,
	)
}

func TestCapabilityOperationAcceptanceTakeoverBeforeEffect(t *testing.T) {
	operations, _, created, _ :=
		newCapabilityOperationTestFixture(t, "operation-acceptance-pre-effect")
	running, _, err := operations.ReportEvent(
		context.Background(),
		"ptid:person:owner",
		capabilityOperationEventRequest(
			created,
			1,
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RUNNING,
		),
	)
	if err != nil {
		t.Fatalf("report operation running: %v", err)
	}
	scenarios, prepared := prepareMCPOperationAcceptanceScenario(
		t,
		operations,
		"R-01",
		"A",
		"operation-acceptance-pre-effect",
	)
	bindMCPOperationAcceptanceScenario(t, scenarios, running)

	reached := reachMCPOperationAcceptanceBarrier(
		t,
		scenarios,
		prepared,
		capabilityBarrierOperationPrepared,
	)
	if _, err := scenarios.InterruptWorker(
		"ptid:person:owner",
		&model.InterruptCapabilityAcceptanceWorkerRequest{
			ScenarioHandle: prepared.GetScenarioHandle(),
			Barrier:        capabilityBarrierOperationPrepared,
		},
	); err != nil {
		t.Fatalf("interrupt pre-effect operation: %v", err)
	}
	assertMCPOperationBarrierResult(t, reached, true)

	takenOver, err := operations.Get(
		context.Background(),
		"ptid:person:owner",
		created.GetOperationId(),
	)
	if err != nil {
		t.Fatalf("read taken-over operation: %v", err)
	}
	if takenOver.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISPATCHED ||
		takenOver.GetAttemptEpoch() != created.GetAttemptEpoch()+1 ||
		takenOver.GetFencingToken() != created.GetFencingToken()+1 {
		t.Fatalf("pre-effect takeover did not advance the fence: %+v", takenOver)
	}
}

func TestCapabilityOperationAcceptanceTakesOverCleanupLease(t *testing.T) {
	operations, _, created, _ :=
		newCapabilityOperationTestFixture(t, "operation-acceptance-cleanup-takeover")
	settling, _, err := operations.ReportEvent(
		context.Background(),
		"ptid:person:owner",
		capabilityOperationEventRequest(
			created,
			1,
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SUCCEEDED,
		),
	)
	if err != nil {
		t.Fatalf("report operation result: %v", err)
	}
	scenarios, prepared := prepareMCPOperationAcceptanceScenario(
		t,
		operations,
		"R-02",
		"A",
		"operation-acceptance-cleanup-takeover",
	)
	bindMCPOperationAcceptanceScenario(t, scenarios, settling)

	reached := reachMCPOperationAcceptanceBarrier(
		t,
		scenarios,
		prepared,
		capabilityBarrierOperationCleanup,
	)
	if _, err := scenarios.InterruptWorker(
		"ptid:person:owner",
		&model.InterruptCapabilityAcceptanceWorkerRequest{
			ScenarioHandle: prepared.GetScenarioHandle(),
			Barrier:        capabilityBarrierOperationCleanup,
		},
	); err != nil {
		t.Fatalf("interrupt cleanup operation: %v", err)
	}
	assertMCPOperationBarrierResult(t, reached, true)

	takenOver, err := operations.Get(
		context.Background(),
		"ptid:person:owner",
		created.GetOperationId(),
	)
	if err != nil {
		t.Fatalf("read cleanup takeover: %v", err)
	}
	if takenOver.GetCleanupEpoch() != settling.GetCleanupEpoch()+1 ||
		takenOver.GetCleanupFencingToken() !=
			settling.GetCleanupFencingToken()+1 {
		t.Fatalf("cleanup takeover did not advance its independent fence: %+v", takenOver)
	}
}

func TestCapabilityOperationAcceptanceExpiresCleanupLeaseAndDeadline(t *testing.T) {
	operations, _, created, _ :=
		newCapabilityOperationTestFixture(t, "operation-acceptance-cleanup-expiry")
	settling, _, err := operations.ReportEvent(
		context.Background(),
		"ptid:person:owner",
		capabilityOperationEventRequest(
			created,
			1,
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SUCCEEDED,
		),
	)
	if err != nil {
		t.Fatalf("report operation result: %v", err)
	}
	scenarios, prepared := prepareMCPOperationAcceptanceScenario(
		t,
		operations,
		"ERR-O06",
		"single",
		"operation-acceptance-cleanup-expiry",
	)
	bindMCPOperationAcceptanceScenario(t, scenarios, settling)

	reached := reachMCPOperationAcceptanceBarrier(
		t,
		scenarios,
		prepared,
		capabilityBarrierCleanupLeaseDeadline,
	)
	if _, err := scenarios.ReleaseBarrier(
		context.Background(),
		"ptid:person:owner",
		&model.ReleaseCapabilityAcceptanceBarrierRequest{
			ScenarioHandle: prepared.GetScenarioHandle(),
			Barrier:        capabilityBarrierCleanupLeaseDeadline,
		},
	); err != nil {
		t.Fatalf("release cleanup expiry barrier: %v", err)
	}
	assertMCPOperationBarrierResult(t, reached, false)

	expired, err := operations.Get(
		context.Background(),
		"ptid:person:owner",
		created.GetOperationId(),
	)
	if err != nil {
		t.Fatalf("read expired cleanup: %v", err)
	}
	if expired.GetStatus() !=
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CLEANUP_FAILED ||
		expired.GetError().GetCode() !=
			model.CapabilityOperationErrorCode_CAPABILITY_OPERATION_ERROR_CODE_CLEANUP_FAILED {
		t.Fatalf("cleanup expiry did not settle visibly: %+v", expired)
	}
}

func prepareMCPOperationAcceptanceScenario(
	t *testing.T,
	operations *CapabilityOperationService,
	cell string,
	ordering string,
	executionID string,
) (*CapabilityAcceptanceScenarioService, *model.PrepareCapabilityAcceptanceScenarioResponse) {
	t.Helper()
	authority := NewCapabilityAuthorityService(operations.db)
	authority.now = operations.now
	scenarios := NewCapabilityAcceptanceScenarioService(authority, "run-1")
	scenarios.SetCapabilityOperationService(operations)
	operations.SetAcceptanceScenarioService(scenarios)
	request := capabilityAcceptanceRequest("run-1", cell, executionID)
	request.Family =
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04
	request.RuntimeAttestationProfile =
		model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN
	request.Ordering = ordering
	prepared, err := scenarios.Prepare(
		context.Background(),
		"ptid:person:owner",
		request,
	)
	if err != nil {
		t.Fatalf("prepare MCP operation scenario: %v", err)
	}
	if prepared.GetExecutorHookTicket() == "" {
		t.Fatal("MCP operation scenario did not issue an executor hook")
	}
	if _, err := scenarios.ArmExecutorHook(
		"ptid:person:owner",
		&model.ArmCapabilityAcceptanceExecutorHookRequest{
			ScenarioHandle:     prepared.GetScenarioHandle(),
			ExecutorHookTicket: prepared.GetExecutorHookTicket(),
		},
	); err != nil {
		t.Fatalf("arm MCP operation hook: %v", err)
	}
	return scenarios, prepared
}

func bindMCPOperationAcceptanceScenario(
	t *testing.T,
	scenarios *CapabilityAcceptanceScenarioService,
	operation *model.CapabilityOperation,
) {
	t.Helper()
	if err := scenarios.BindCapabilityOperation(
		"ptid:person:owner",
		operation.GetOperationId(),
		operation.GetTargetDeviceId(),
		operation.GetCapabilitySessionId(),
	); err != nil {
		t.Fatalf("bind MCP operation scenario: %v", err)
	}
}

type mcpOperationBarrierResult struct {
	interrupted bool
	err         error
}

func reachMCPOperationAcceptanceBarrier(
	t *testing.T,
	scenarios *CapabilityAcceptanceScenarioService,
	prepared *model.PrepareCapabilityAcceptanceScenarioResponse,
	barrier string,
) <-chan mcpOperationBarrierResult {
	t.Helper()
	result := make(chan mcpOperationBarrierResult, 1)
	go func() {
		response, err := scenarios.ReachExecutorBarrier(
			context.Background(),
			"ptid:person:owner",
			&model.ReachCapabilityAcceptanceExecutorBarrierRequest{
				ScenarioHandle: prepared.GetScenarioHandle(),
				Barrier:        barrier,
			},
		)
		result <- mcpOperationBarrierResult{
			interrupted: response != nil && response.GetInterrupted(),
			err:         err,
		}
	}()
	if _, err := scenarios.WaitBarrier(
		context.Background(),
		"ptid:person:owner",
		&model.WaitCapabilityAcceptanceBarrierRequest{
			ScenarioHandle: prepared.GetScenarioHandle(),
			Barrier:        barrier,
		},
	); err != nil {
		t.Fatalf("wait MCP operation barrier: %v", err)
	}
	return result
}

func assertMCPOperationBarrierResult(
	t *testing.T,
	result <-chan mcpOperationBarrierResult,
	wantInterrupted bool,
) {
	t.Helper()
	select {
	case reached := <-result:
		if reached.err != nil || reached.interrupted != wantInterrupted {
			t.Fatalf(
				"MCP operation barrier interrupted=%v err=%v, want interrupted=%v",
				reached.interrupted,
				reached.err,
				wantInterrupted,
			)
		}
	case <-time.After(time.Second):
		t.Fatal("MCP operation barrier did not resolve")
	}
}

func newUnstartedCapabilityOperationFixture(
	t *testing.T,
	name string,
) (
	*CapabilityAuthorityService,
	*CapabilityOperationService,
	*model.StartCapabilityOperationRequest,
) {
	t.Helper()
	authority := newCapabilityAuthorityTestService(t, name)
	if err := authority.db.AutoMigrate(
		&persistence.ClientCapabilityLease{},
		&persistence.CapabilityOperation{},
		&persistence.CapabilityOperationCommand{},
		&persistence.CapabilityOperationEvent{},
		&persistence.CapabilityOperationEventRejection{},
		&persistence.CapabilityOperationOutbox{},
		&persistence.CapabilityOperationLease{},
		&persistence.CapabilityCleanupLease{},
	); err != nil {
		t.Fatalf("migrate operation fixture: %v", err)
	}
	manifest := capabilityAuthorityTestManifest()
	manifest.ExecutionOwner =
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY
	if _, err := authority.RegisterManifest(
		context.Background(),
		manifest,
	); err != nil {
		t.Fatalf("register operation manifest: %v", err)
	}
	now := authority.now()
	if err := authority.db.Create(&persistence.ClientCapabilityLease{
		SessionID: "session-1", ActorID: "ptid:person:owner",
		AuthSessionID: "auth-1", DeviceID: "device-1",
		ConnectionID: "connection-1", LeaseID: "capability-lease-1",
		LeaseRevision: 1, LeasePayload: operationCapabilityLeasePayload(t),
		ExpiresAt: now.Add(time.Minute), CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed operation capability lease: %v", err)
	}
	operations := NewCapabilityOperationService(authority.db)
	operations.now = authority.now
	return authority, operations, &model.StartCapabilityOperationRequest{
		CapabilityId: manifest.GetCapabilityId(), CapabilityVersion: manifest.GetVersion(),
		OperationKind: "test", TargetDeviceId: "device-1",
		CapabilitySessionId: "session-1",
		BoundedArguments:    []byte(`{"probe":true}`),
		IdempotencyKey:      "operation-start-1",
		Deadline:            timestamppb.New(now.Add(time.Minute)),
	}
}
