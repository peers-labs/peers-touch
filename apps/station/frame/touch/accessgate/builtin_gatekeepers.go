package accessgate

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate/gatekeeper"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
)

// allowedFunc resolves whether an actor satisfies the Station access policy.
// It is injected so the allowlist gatekeeper stays decoupled from policy storage.
type allowedFunc func(ctx context.Context, actor *pb.AccessGateActorRef) (bool, string)

// capabilityGatekeeper validates Station/client compatibility. The MVP always
// passes; it exists so capability checks have a home as the chain grows.
type capabilityGatekeeper struct{}

func (capabilityGatekeeper) Type() pb.AccessGateType {
	return pb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY
}
func (capabilityGatekeeper) GateID() string { return gateIDCapability }

func (capabilityGatekeeper) Evaluate(_ context.Context, _ *gatekeeper.EvalContext) *pb.AccessGate {
	return &pb.AccessGate{
		GateId: gateIDCapability,
		Type:   pb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY,
		State:  pb.AccessGateState_ACCESS_GATE_STATE_PASSED,
		Title:  "Station compatibility",
	}
}

// loginGatekeeper requires an authenticated actor before later gates run. The
// gate passes once the attempt carries an actor; otherwise it asks the client
// to collect credentials.
type loginGatekeeper struct{}

func (loginGatekeeper) Type() pb.AccessGateType { return pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN }
func (loginGatekeeper) GateID() string          { return gateIDLogin }

func (loginGatekeeper) Evaluate(_ context.Context, ec *gatekeeper.EvalContext) *pb.AccessGate {
	state := pb.AccessGateState_ACCESS_GATE_STATE_PASSED
	if ec.Actor == nil {
		state = pb.AccessGateState_ACCESS_GATE_STATE_ACTION_REQUIRED
	}
	return &pb.AccessGate{
		GateId:       gateIDLogin,
		Type:         pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
		State:        state,
		Title:        "Log in",
		Description:  "Log in before entering this Station.",
		SubmitAction: "submit_login",
	}
}

// allowlistGatekeeper enforces the administrator-managed access policy
// (open/invite_only/fixed_users/closed) once the actor identity is known.
type allowlistGatekeeper struct {
	allowed allowedFunc
}

func (allowlistGatekeeper) Type() pb.AccessGateType {
	return pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_ALLOWLIST
}
func (allowlistGatekeeper) GateID() string { return gateIDInviteAllowlist }

func (g allowlistGatekeeper) Evaluate(ctx context.Context, ec *gatekeeper.EvalContext) *pb.AccessGate {
	state := pb.AccessGateState_ACCESS_GATE_STATE_PASSED
	reason := ""
	if ec.Actor != nil {
		if ok, why := g.allowed(ctx, ec.Actor); !ok {
			state = pb.AccessGateState_ACCESS_GATE_STATE_BLOCKED
			reason = why
		}
	}
	return &pb.AccessGate{
		GateId:         gateIDInviteAllowlist,
		Type:           pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_ALLOWLIST,
		State:          state,
		Title:          "Station access",
		Description:    "Station access is controlled by the Station administrator.",
		BlockingReason: reason,
	}
}

// inviteCodeGatekeeper requires the holder to submit a valid Station-issued
// invite code. The gate stays satisfied once an attempt has redeemed a code
// (InvitePassed); otherwise it asks the client to collect one. Redemption itself
// happens on the submit path, never in Evaluate, so re-evaluation is idempotent.
type inviteCodeGatekeeper struct{}

func (inviteCodeGatekeeper) Type() pb.AccessGateType {
	return pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_CODE
}
func (inviteCodeGatekeeper) GateID() string { return gateIDInviteCode }

func (inviteCodeGatekeeper) Evaluate(_ context.Context, ec *gatekeeper.EvalContext) *pb.AccessGate {
	state := pb.AccessGateState_ACCESS_GATE_STATE_ACTION_REQUIRED
	if ec.InvitePassed {
		state = pb.AccessGateState_ACCESS_GATE_STATE_PASSED
	}
	return &pb.AccessGate{
		GateId:          gateIDInviteCode,
		Type:            pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_CODE,
		State:           state,
		Title:           "Invite code",
		Description:     "Enter your invite code to enter this Station.",
		SubmitAction:    "submit_invite_code",
		InputSchemaJson: inviteCodeInputSchema,
	}
}

// inviteCodeInputSchema describes the single field the client collects for the
// invite.code gate. Keeping it schema-driven lets clients render the gate
// generically without a per-gate code release.
const inviteCodeInputSchema = `{"fields":[{"name":"invite_code","type":"text","required":true,"label":"Invite code"}]}`
