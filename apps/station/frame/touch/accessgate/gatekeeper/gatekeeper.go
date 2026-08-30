// Package gatekeeper defines the Station access-gate plugin mechanism.
//
// A Gatekeeper is one independent step in the Station-owned access gate chain
// (for example login, invite allowlist, or invite-code redemption). The package
// only provides the mechanism — the interface, the registry that orders the
// plugins, and the orchestrator that turns an ordered evaluation into a single
// AccessDecision. Concrete gatekeepers and all policy decisions live in the
// parent accessgate package so this package never imports back into it and the
// dependency direction stays one-way.
package gatekeeper

import (
	"context"
	"time"

	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// EvalContext is the per-attempt input handed to every gatekeeper during a
// single decision pass. It carries only the facts a gatekeeper may need; the
// services a gatekeeper depends on are captured by the concrete gatekeeper at
// construction time, keeping this struct free of cross-package wiring.
type EvalContext struct {
	AttemptID     string
	Actor         *actormodel.ActorRef
	ActorUsername string
	ActorEmail    string
	ExpiresAt     time.Time
	InviteCode    string
	InvitePassed  bool
}

// Gatekeeper is a single access gate. Evaluate must be side-effect free with
// respect to the attempt: it inspects the EvalContext and returns the gate
// descriptor (including its current state) without mutating shared state. State
// transitions that persist (consuming an invite code, issuing a session) belong
// to the gatekeeper's submit path, not Evaluate.
type Gatekeeper interface {
	// Type is the proto gate type this gatekeeper owns.
	Type() pb.AccessGateType
	// GateID is the stable identifier used in AccessDecision.current_gate_id.
	GateID() string
	// Evaluate returns the gate descriptor with its resolved state for the
	// given attempt.
	Evaluate(ctx context.Context, ec *EvalContext) *pb.AccessGate
}

// GrantIDFunc mints the access grant identifier once every gate has passed.
type GrantIDFunc func(attemptID string, actor *actormodel.ActorRef) string

// Registry holds the registered gatekeepers keyed by gate type. It is the
// single place that maps a Station's enabled-gate order onto concrete plugins.
type Registry struct {
	byType  map[pb.AccessGateType]Gatekeeper
	grantID GrantIDFunc
}

// NewRegistry builds an empty registry. grantID is invoked only when an attempt
// reaches the granted state.
func NewRegistry(grantID GrantIDFunc) *Registry {
	return &Registry{
		byType:  make(map[pb.AccessGateType]Gatekeeper),
		grantID: grantID,
	}
}

// Register adds a gatekeeper. Registering the same type twice replaces the
// previous entry so a Station can override a built-in gate with a custom one.
func (r *Registry) Register(gk Gatekeeper) {
	r.byType[gk.Type()] = gk
}

// Has reports whether a gatekeeper is registered for the given type.
func (r *Registry) Has(t pb.AccessGateType) bool {
	_, ok := r.byType[t]
	return ok
}

// Decide runs the ordered gatekeepers and folds their evaluations into one
// AccessDecision.
//
// Evaluation stops at the first gate that is not passed or skipped: that gate
// becomes the decision's current gate and its state drives the overall decision
// state. Gates after the halting gate are intentionally omitted so clients only
// ever render the gate they must act on. When every gate passes the decision is
// granted and an access grant id is minted.
func (r *Registry) Decide(ctx context.Context, ec *EvalContext, order []pb.AccessGateType) *pb.AccessDecision {
	gates := make([]*pb.AccessGate, 0, len(order))
	decision := &pb.AccessDecision{
		AttemptId: ec.AttemptID,
		Actor:     ec.Actor,
		ExpiresAt: timestamppb.New(ec.ExpiresAt),
	}

	for _, gateType := range order {
		gk, ok := r.byType[gateType]
		if !ok {
			continue
		}

		gate := gk.Evaluate(ctx, ec)
		gates = append(gates, gate)

		if gate.GetState() == pb.AccessGateState_ACCESS_GATE_STATE_PASSED ||
			gate.GetState() == pb.AccessGateState_ACCESS_GATE_STATE_SKIPPED {
			continue
		}

		decision.Gates = gates
		decision.CurrentGateId = gate.GetGateId()
		decision.State = decisionStateForGate(gate.GetState())
		decision.Message = gate.GetBlockingReason()
		return decision
	}

	decision.Gates = gates
	decision.State = pb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED
	if r.grantID != nil && ec.Actor != nil {
		decision.AccessGrantId = r.grantID(ec.AttemptID, ec.Actor)
	}
	return decision
}

func decisionStateForGate(state pb.AccessGateState) pb.AccessDecisionState {
	switch state {
	case pb.AccessGateState_ACCESS_GATE_STATE_ACTION_REQUIRED:
		return pb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED
	case pb.AccessGateState_ACCESS_GATE_STATE_BLOCKED:
		return pb.AccessDecisionState_ACCESS_DECISION_STATE_BLOCKED
	case pb.AccessGateState_ACCESS_GATE_STATE_FAILED:
		return pb.AccessDecisionState_ACCESS_DECISION_STATE_FAILED
	default:
		return pb.AccessDecisionState_ACCESS_DECISION_STATE_PENDING
	}
}
