package accessgate

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate/gatekeeper"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

func actorContext() *gatekeeper.EvalContext {
	return &gatekeeper.EvalContext{
		AttemptID: "attempt-1",
		Actor:     &actormodel.ActorRef{Ptid: "ptid:v1:actor:peers:p:alice:fp"},
	}
}

func resetDeviceApprovalSeams(t *testing.T) {
	t.Helper()
	originalCounter := deviceEnrollmentCounter
	originalLoader := policyLoader
	t.Cleanup(func() {
		deviceEnrollmentCounter = originalCounter
		policyLoader = originalLoader
	})
}

// withPolicy injects an Access policy the same way linkedEvaluationContext does.
func withPolicy(policy *dbmodel.AccessPolicy) context.Context {
	return context.WithValue(context.Background(), linkedPolicyKey{}, policy)
}

func enabledCtx() context.Context {
	return withPolicy(&dbmodel.AccessPolicy{DeviceApprovalEnabled: true})
}

func TestDeviceApprovalGatekeeper_FailsClosedWhenPolicyUnresolvable(t *testing.T) {
	resetDeviceApprovalSeams(t)
	// A bare context has neither a pinned policy snapshot nor an injected store,
	// so the DB fallback cannot resolve policy. The security gate must block
	// rather than silently fall back to disabled.
	gate := deviceApprovalGatekeeper{}.Evaluate(context.Background(), actorContext())
	if gate.GetState() != pb.AccessGateState_ACCESS_GATE_STATE_BLOCKED {
		t.Fatalf("unresolvable-policy state = %v, want BLOCKED", gate.GetState())
	}
	if gate.GetGateId() != gateIDDeviceApproval ||
		gate.GetType() != pb.AccessGateType_ACCESS_GATE_TYPE_DEVICE_APPROVAL {
		t.Fatalf("gate identity mismatch: %s/%v", gate.GetGateId(), gate.GetType())
	}
}

func TestDeviceApprovalGatekeeper_ExplicitlyDisabledPolicyIsSkipped(t *testing.T) {
	resetDeviceApprovalSeams(t)
	ctx := withPolicy(&dbmodel.AccessPolicy{DeviceApprovalEnabled: false})
	gate := deviceApprovalGatekeeper{}.Evaluate(ctx, actorContext())
	if gate.GetState() != pb.AccessGateState_ACCESS_GATE_STATE_SKIPPED {
		t.Fatalf("disabled-policy state = %v, want SKIPPED", gate.GetState())
	}
}

// Standard credential login evaluates with the bare request context, which
// carries no linked-transaction policy snapshot. The gate must still honor an
// enabled persisted policy via the loader fallback instead of staying inert.
func TestDeviceApprovalGatekeeper_StandardPathFallsBackToPersistedPolicy(t *testing.T) {
	resetDeviceApprovalSeams(t)
	policyLoader = func(context.Context) (*dbmodel.AccessPolicy, error) {
		return &dbmodel.AccessPolicy{DeviceApprovalEnabled: true}, nil
	}
	ConfigureDeviceApproval(func(_ context.Context, _ string) (int, error) { return 2, nil })

	gate := deviceApprovalGatekeeper{}.Evaluate(context.Background(), actorContext())
	if gate.GetState() != pb.AccessGateState_ACCESS_GATE_STATE_ACTION_REQUIRED {
		t.Fatalf("standard-path enabled-policy state = %v, want ACTION_REQUIRED", gate.GetState())
	}
}

func TestDeviceApprovalGatekeeper_StandardPathDisabledPersistedPolicyIsSkipped(t *testing.T) {
	resetDeviceApprovalSeams(t)
	policyLoader = func(context.Context) (*dbmodel.AccessPolicy, error) {
		return &dbmodel.AccessPolicy{DeviceApprovalEnabled: false}, nil
	}

	gate := deviceApprovalGatekeeper{}.Evaluate(context.Background(), actorContext())
	if gate.GetState() != pb.AccessGateState_ACCESS_GATE_STATE_SKIPPED {
		t.Fatalf("standard-path disabled-policy state = %v, want SKIPPED", gate.GetState())
	}
}

func TestDeviceApprovalGatekeeper_SkipsBeforeLoginIdentity(t *testing.T) {
	resetDeviceApprovalSeams(t)
	gate := deviceApprovalGatekeeper{}.Evaluate(enabledCtx(), &gatekeeper.EvalContext{})
	if gate.GetState() != pb.AccessGateState_ACCESS_GATE_STATE_SKIPPED {
		t.Fatalf("pre-login state = %v, want SKIPPED", gate.GetState())
	}
}

func TestDeviceApprovalGatekeeper_FirstDevicePasses(t *testing.T) {
	resetDeviceApprovalSeams(t)
	ConfigureDeviceApproval(func(_ context.Context, _ string) (int, error) { return 0, nil })
	gate := deviceApprovalGatekeeper{}.Evaluate(enabledCtx(), actorContext())
	if gate.GetState() != pb.AccessGateState_ACCESS_GATE_STATE_PASSED {
		t.Fatalf("first-device state = %v, want PASSED", gate.GetState())
	}
}

func TestDeviceApprovalGatekeeper_ExistingDeviceRequiresAction(t *testing.T) {
	resetDeviceApprovalSeams(t)
	ConfigureDeviceApproval(func(_ context.Context, _ string) (int, error) { return 2, nil })
	gate := deviceApprovalGatekeeper{}.Evaluate(enabledCtx(), actorContext())
	if gate.GetState() != pb.AccessGateState_ACCESS_GATE_STATE_ACTION_REQUIRED {
		t.Fatalf("existing-device state = %v, want ACTION_REQUIRED", gate.GetState())
	}
	if gate.GetBlockingReason() == "" {
		t.Fatal("ACTION_REQUIRED gate must carry a blocking reason")
	}
}

func TestDeviceApprovalGatekeeper_FailsClosedOnCounterError(t *testing.T) {
	resetDeviceApprovalSeams(t)
	ConfigureDeviceApproval(func(_ context.Context, _ string) (int, error) {
		return 0, errors.New("inventory unavailable")
	})
	gate := deviceApprovalGatekeeper{}.Evaluate(enabledCtx(), actorContext())
	if gate.GetState() != pb.AccessGateState_ACCESS_GATE_STATE_BLOCKED {
		t.Fatalf("counter-error state = %v, want BLOCKED", gate.GetState())
	}
}

func TestDeviceApproval_RegisteredButAbsentFromDefaultOrder(t *testing.T) {
	resetDeviceApprovalSeams(t)
	gateType := pb.AccessGateType_ACCESS_GATE_TYPE_DEVICE_APPROVAL
	if !registry().Has(gateType) {
		t.Fatal("DEVICE_APPROVAL must be registered for explicit enabled-gates policies")
	}
	for _, gate := range defaultGateOrder {
		if gate == gateType {
			t.Fatal("DEVICE_APPROVAL must not appear in the default gate order")
		}
	}
}

func TestDeviceApproval_ExplicitOrderValidatesOnceRegistered(t *testing.T) {
	resetDeviceApprovalSeams(t)
	order := []pb.AccessGateType{
		pb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY,
		pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
		pb.AccessGateType_ACCESS_GATE_TYPE_DEVICE_APPROVAL,
	}
	if err := validateGateOrder(policyModeOpen, order); err != nil {
		t.Fatalf("explicit DEVICE_APPROVAL order should validate after registration: %v", err)
	}
}
