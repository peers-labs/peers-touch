package accessgate

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate/gatekeeper"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

const gateIDDeviceApproval = "device.approval"

// DeviceApprovalGateConfig is the frame-local rollout switch. The app module
// maps its Station access policy onto this value at the composition root, so
// the frame module never imports the app-package login-approval domain.
type DeviceApprovalGateConfig struct {
	// Enabled gates the whole feature. It ships false: with the switch off the
	// gate is inert and the authorization path is byte-identical to before.
	Enabled bool
	// MaxDevicesPerActor, when > 0, lets the gate surface an explicit device
	// ceiling instead of relying on an implicit category-based session kick.
	MaxDevicesPerActor int
}

// EnrolledDeviceCounter resolves how many devices an Actor has already
// enrolled. Injected through a seam so the frame module keeps its dependency
// direction (the concrete query lives in the app module).
type EnrolledDeviceCounter func(ctx context.Context, actorPtid string) (int, error)

// Package-level seam for the enrollment counter. The rollout switch itself is
// read from the request-scoped Access policy (see resolveConfig); this seam
// only supplies the frame→app device query.
var deviceEnrollmentCounter EnrolledDeviceCounter = func(context.Context, string) (int, error) {
	return 0, errors.New("device approval enrollment counter is not wired")
}

// policyLoader defaults to the package policy loader. It is a var seam so the
// non-linked (standard credential) fallback can be exercised hermetically
// without injecting a process-global database store.
var policyLoader = GetPolicy

// ConfigureDeviceApproval installs the app-owned enrollment counter. The
// enabled flag is policy-driven, so no process-global switch is needed.
func ConfigureDeviceApproval(counter EnrolledDeviceCounter) {
	if counter != nil {
		deviceEnrollmentCounter = counter
	}
}

// resolveConfig reads the rollout switch from the request-scoped policy.
// Linked Access transactions pin a SHARE-locked policy snapshot under
// linkedPolicyKey. The standard credential path evaluates with the bare
// request context (no pinned snapshot), so fall back to the package policy
// loader — context-first then database — exactly as the other gatekeepers
// obtain policy. An unresolvable policy is returned as an error so Evaluate
// fails closed instead of silently disabling the gate.
func resolveConfig(ctx context.Context) (DeviceApprovalGateConfig, error) {
	if policy, ok := ctx.Value(linkedPolicyKey{}).(*dbmodel.AccessPolicy); ok && policy != nil {
		return DeviceApprovalGateConfig{
			Enabled:            policy.DeviceApprovalEnabled,
			MaxDevicesPerActor: int(policy.DeviceApprovalMaxDevices),
		}, nil
	}
	policy, err := policyLoader(ctx)
	if err != nil {
		return DeviceApprovalGateConfig{}, err
	}
	return DeviceApprovalGateConfig{
		Enabled:            policy.DeviceApprovalEnabled,
		MaxDevicesPerActor: int(policy.DeviceApprovalMaxDevices),
	}, nil
}

// deviceApprovalGatekeeper halts the chain for a non-first device until an
// already-enrolled device of the same Actor approves the sign-in. It never
// appears in the default gate order, so it only runs when an operator pins it
// into an explicit enabled-gates policy.
type deviceApprovalGatekeeper struct{}

func (deviceApprovalGatekeeper) Type() pb.AccessGateType {
	return pb.AccessGateType_ACCESS_GATE_TYPE_DEVICE_APPROVAL
}

func (deviceApprovalGatekeeper) GateID() string { return gateIDDeviceApproval }

func (deviceApprovalGatekeeper) Evaluate(ctx context.Context, ec *gatekeeper.EvalContext) *pb.AccessGate {
	gate := &pb.AccessGate{
		GateId: gateIDDeviceApproval,
		Type:   pb.AccessGateType_ACCESS_GATE_TYPE_DEVICE_APPROVAL,
		Title:  "Approve this device",
	}

	// Default-off: inert until an operator enables the policy. A policy that
	// cannot be resolved fails closed rather than silently switching the gate
	// off on the credential path.
	config, err := resolveConfig(ctx)
	if err != nil {
		gate.State = pb.AccessGateState_ACCESS_GATE_STATE_BLOCKED
		gate.BlockingReason = "device approval policy unavailable"
		return gate
	}
	if !config.Enabled {
		gate.State = pb.AccessGateState_ACCESS_GATE_STATE_SKIPPED
		return gate
	}

	// Before AUTH_LOGIN establishes an Actor identity there is nothing to
	// approve; the login gate owns credential collection. This gate must always
	// be ordered after AUTH_LOGIN.
	if ec.Actor == nil || ec.Actor.GetPtid() == "" {
		gate.State = pb.AccessGateState_ACCESS_GATE_STATE_SKIPPED
		return gate
	}

	enrolled, err := deviceEnrollmentCounter(ctx, ec.Actor.GetPtid())
	if err != nil {
		// Fail closed: an unresolvable device inventory must never grant access.
		gate.State = pb.AccessGateState_ACCESS_GATE_STATE_BLOCKED
		gate.BlockingReason = "device approval unavailable"
		return gate
	}

	// First device of an Actor can never require approval, otherwise a
	// brand-new install dead-locks with no approver present.
	if enrolled <= 0 {
		gate.State = pb.AccessGateState_ACCESS_GATE_STATE_PASSED
		return gate
	}

	gate.State = pb.AccessGateState_ACCESS_GATE_STATE_ACTION_REQUIRED
	gate.Description = "Approve this sign-in from an already enrolled device."
	gate.BlockingReason = "device approval required"
	return gate
}
