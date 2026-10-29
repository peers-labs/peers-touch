package conversation

import (
	"context"
	"fmt"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
)

// Role threshold constants aligned with chat.MemberRole proto enum values.
const (
	roleMember int32 = 1
	roleAdmin  int32 = 2
	roleOwner  int32 = 3
)

// Status constants aligned with chat.MemberStatus proto enum values.
const (
	statusActive int32 = 1
)

// ConversationGateEvaluator implements social_gate.SocialGate by composing
// relationship, group role, and cross-station federation authorization for
// conversation operations.
type ConversationGateEvaluator struct {
	rel   social_gate.RelationshipQuerier
	role  social_gate.GroupRoleQuerier
	cross social_gate.CrossStationAuthorizer
}

// NewConversationGateEvaluator creates a gate evaluator with the provided
// queriers. Relationship/role queriers may be nil for open mode. The cross
// authorizer is consulted only for cross-station operations; a nil authorizer
// leaves federation authorization to the existing transport/membership layers
// (no positive membership decision is made here).
func NewConversationGateEvaluator(
	rel social_gate.RelationshipQuerier,
	role social_gate.GroupRoleQuerier,
	cross social_gate.CrossStationAuthorizer,
) *ConversationGateEvaluator {
	return &ConversationGateEvaluator{rel: rel, role: role, cross: cross}
}

// Evaluate dispatches policy evaluation based on the operation action.
func (e *ConversationGateEvaluator) Evaluate(ctx context.Context, op social_gate.Operation) error {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return &social_gate.PolicyDeniedError{
			Code:   "UNAUTHENTICATED",
			Reason: "no subject in context",
		}
	}
	subjectPtid := subject.ID

	switch op.Action {
	case "create_direct":
		return e.evaluateCreateDirect(ctx, subjectPtid, op)
	case "send_message", "dkx_send":
		return e.evaluateConversationMember(ctx, subjectPtid, op.ConversationID, op.Action)
	case "add_member":
		return e.evaluateAdminAction(ctx, subjectPtid, op.ConversationID)
	case "remove_member":
		return e.evaluateRemoveMember(ctx, subjectPtid, op.TargetPtid, op.ConversationID)
	case "dissolve":
		return e.evaluateOwnerAction(ctx, subjectPtid, op.ConversationID)
	case "fetch_key_package":
		return e.evaluateKeyPackageFetch(ctx, subjectPtid, op.TargetPtid)
	}

	// Unknown actions pass through (fail-open for new actions during development)
	return nil
}

// evaluateCreateDirect checks bilateral relationship requirements for direct
// conversations and applies the authorization wrapper branch:
//   - same-station: local scope; relationship policy only, never invokes the
//     cross-station authorizer and requires no Federation;
//   - cross-station: relationship policy plus CrossStationAuthorizer under
//     the supplied Federation scope; a local scope on a cross-station action
//     is rejected fail-closed.
//
// Policy: blocked => deny; mutual followers OR shared conversation => allow; else deny.
func (e *ConversationGateEvaluator) evaluateCreateDirect(ctx context.Context, subjectPtid string, op social_gate.Operation) error {
	targetPtid := op.TargetPtid

	if e.rel != nil {
		blocked, err := e.rel.IsBlocked(ctx, targetPtid, subjectPtid)
		if err != nil {
			return fmt.Errorf("gate: relationship check failed: %w", err)
		}
		if blocked {
			return &social_gate.PolicyDeniedError{
				Code:   "BLOCKED",
				Reason: "target actor has blocked the subject",
			}
		}

		// Also check the reverse direction: subject blocked the target
		blockedReverse, err := e.rel.IsBlocked(ctx, subjectPtid, targetPtid)
		if err != nil {
			return fmt.Errorf("gate: relationship check failed: %w", err)
		}
		if blockedReverse {
			return &social_gate.PolicyDeniedError{
				Code:   "BLOCKED",
				Reason: "subject has blocked the target actor",
			}
		}

		mutual, err := e.rel.AreMutualFollowers(ctx, subjectPtid, targetPtid)
		if err != nil {
			return fmt.Errorf("gate: mutual followers check failed: %w", err)
		}
		if !mutual {
			shared, err := e.rel.HaveSharedConversation(ctx, subjectPtid, targetPtid)
			if err != nil {
				return fmt.Errorf("gate: shared conversation check failed: %w", err)
			}
			if !shared {
				return &social_gate.PolicyDeniedError{
					Code:   "RELATIONSHIP_REQUIRED",
					Reason: "actors must be mutual followers or share a conversation",
				}
			}
		}
	}

	// Same-station actors use the local scope: same Home Station, and a local
	// scope may never cross stations.
	if op.SameStation() {
		if op.ScopeKind != "" && op.ScopeKind != social_gate.ScopeKindLocal {
			return &social_gate.PolicyDeniedError{
				Code:   "SCOPE_STATION_MISMATCH",
				Reason: "same-station conversation must use the local scope",
			}
		}
		return nil
	}

	// Cross-station. A local scope is invalid here even if station fields
	// disagree or are missing on either side.
	if op.LocalScope() {
		return &social_gate.PolicyDeniedError{
			Code:   "SCOPE_STATION_MISMATCH",
			Reason: "local scope cannot span different Home Stations",
		}
	}
	if e.cross != nil {
		if err := e.cross.AuthorizeCrossStation(ctx, social_gate.CrossStationOperation{
			Action:               op.Action,
			Scope:                op.Scope,
			SubjectStationPeerID: op.SubjectStationPeerID,
			TargetStationPeerID:  op.TargetStationPeerID,
			SubjectPTID:          subjectPtid,
			TargetPTID:           targetPtid,
		}); err != nil {
			return &social_gate.PolicyDeniedError{
				Code:   "FEDERATION_UNAUTHORIZED",
				Reason: err.Error(),
			}
		}
	}
	return nil
}

// evaluateConversationMember verifies the subject is an active member of the conversation.
// For send_message, also checks the mute state.
func (e *ConversationGateEvaluator) evaluateConversationMember(ctx context.Context, subjectPtid, conversationID, action string) error {
	if e.role == nil {
		return nil
	}

	_, status, muted, err := e.role.GetMemberStatus(ctx, conversationID, subjectPtid)
	if err != nil {
		return fmt.Errorf("gate: member status check failed: %w", err)
	}
	if status != statusActive {
		return &social_gate.PolicyDeniedError{
			Code:   "NOT_MEMBER",
			Reason: "subject is not an active member of the conversation",
		}
	}

	if muted && action == "send_message" {
		return &social_gate.PolicyDeniedError{
			Code:   "MUTED",
			Reason: "subject is muted in this conversation",
		}
	}

	return nil
}

// evaluateAdminAction requires the subject to hold ADMIN or OWNER role.
func (e *ConversationGateEvaluator) evaluateAdminAction(ctx context.Context, subjectPtid, conversationID string) error {
	if e.role == nil {
		return nil
	}

	role, status, _, err := e.role.GetMemberStatus(ctx, conversationID, subjectPtid)
	if err != nil {
		return fmt.Errorf("gate: member role check failed: %w", err)
	}
	if status != statusActive {
		return &social_gate.PolicyDeniedError{
			Code:   "NOT_MEMBER",
			Reason: "subject is not an active member of the conversation",
		}
	}
	if role < roleAdmin {
		return &social_gate.PolicyDeniedError{
			Code:   "INSUFFICIENT_ROLE",
			Reason: "admin or owner role required",
		}
	}

	return nil
}

// evaluateRemoveMember requires the subject to outrank the target member.
// OWNER > ADMIN > MEMBER hierarchy is enforced.
func (e *ConversationGateEvaluator) evaluateRemoveMember(ctx context.Context, subjectPtid, targetPtid, conversationID string) error {
	if e.role == nil {
		return nil
	}

	subjectRole, subjectStatus, _, err := e.role.GetMemberStatus(ctx, conversationID, subjectPtid)
	if err != nil {
		return fmt.Errorf("gate: subject role check failed: %w", err)
	}
	if subjectStatus != statusActive {
		return &social_gate.PolicyDeniedError{
			Code:   "NOT_MEMBER",
			Reason: "subject is not an active member of the conversation",
		}
	}

	targetRole, _, _, err := e.role.GetMemberStatus(ctx, conversationID, targetPtid)
	if err != nil {
		return fmt.Errorf("gate: target role check failed: %w", err)
	}

	// Subject must outrank target (strictly greater role value)
	if subjectRole <= targetRole {
		return &social_gate.PolicyDeniedError{
			Code:   "INSUFFICIENT_ROLE",
			Reason: "subject must outrank target to remove them",
		}
	}

	return nil
}

// evaluateOwnerAction requires the subject to be the OWNER of the conversation.
func (e *ConversationGateEvaluator) evaluateOwnerAction(ctx context.Context, subjectPtid, conversationID string) error {
	if e.role == nil {
		return nil
	}

	role, status, _, err := e.role.GetMemberStatus(ctx, conversationID, subjectPtid)
	if err != nil {
		return fmt.Errorf("gate: owner role check failed: %w", err)
	}
	if status != statusActive {
		return &social_gate.PolicyDeniedError{
			Code:   "NOT_MEMBER",
			Reason: "subject is not an active member of the conversation",
		}
	}
	if role != roleOwner {
		return &social_gate.PolicyDeniedError{
			Code:   "INSUFFICIENT_ROLE",
			Reason: "owner role required",
		}
	}

	return nil
}

// evaluateKeyPackageFetch allows fetching own key packages unconditionally.
// For others, requires a shared conversation.
func (e *ConversationGateEvaluator) evaluateKeyPackageFetch(ctx context.Context, subjectPtid, targetPtid string) error {
	// Self-fetch is always allowed
	if targetPtid == subjectPtid {
		return nil
	}

	if e.rel == nil {
		return nil
	}

	shared, err := e.rel.HaveSharedConversation(ctx, subjectPtid, targetPtid)
	if err != nil {
		return fmt.Errorf("gate: shared conversation check failed: %w", err)
	}
	if !shared {
		return &social_gate.PolicyDeniedError{
			Code:   "RELATIONSHIP_REQUIRED",
			Reason: "actors must share at least one conversation to fetch key packages",
		}
	}

	return nil
}
