package accessgate

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/auth"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	policyModeOpen       = "open"
	policyModeInviteOnly = "invite_only"
	policyModeFixedUsers = "fixed_users"
	policyModeClosed     = "closed"
)

type Attempt struct {
	ID        string
	SessionID string
	Actor     *pb.AccessGateActorRef
	CreatedAt time.Time
	ExpiresAt time.Time
}

type PolicyInput struct {
	Mode             string
	AllowedEmails    []string
	AllowedUsernames []string
	AllowedActorIDs  []int64
	UpdatedBy        string
}

var (
	attemptsMu sync.Mutex
	attempts   = map[string]*Attempt{}
)

func StartAttempt(ctx context.Context, req *pb.StartAccessAttemptRequest) (*pb.AccessDecision, error) {
	actorRef, err := actorRefFromSession(ctx, strings.TrimSpace(req.GetSessionId()))
	if err != nil {
		return nil, err
	}

	attempt := &Attempt{
		ID:        newAttemptID(),
		SessionID: strings.TrimSpace(req.GetSessionId()),
		Actor:     actorRef,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(15 * time.Minute),
	}

	attemptsMu.Lock()
	attempts[attempt.ID] = attempt
	attemptsMu.Unlock()

	return DecisionForAttempt(ctx, attempt), nil
}

func actorRefFromSession(ctx context.Context, sessionID string) (*pb.AccessGateActorRef, error) {
	if sessionID == "" {
		return nil, nil
	}

	session, err := auth.SessionManager().Validate(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("access session invalid: %w", err)
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}

	var actor dbmodel.Actor
	if err := rds.WithContext(ctx).Where("id = ?", session.UserID).First(&actor).Error; err != nil {
		return nil, err
	}

	return &pb.AccessGateActorRef{
		Id:       strconv.FormatUint(uint64(actor.ID), 10),
		ActorId:  int64(actor.ID),
		Username: actor.PreferredUsername,
		Email:    actor.Email,
	}, nil
}

func GetAttempt(id string) (*Attempt, bool) {
	attemptsMu.Lock()
	defer attemptsMu.Unlock()

	attempt, ok := attempts[id]
	if !ok || time.Now().After(attempt.ExpiresAt) {
		delete(attempts, id)
		return nil, false
	}
	return attempt, true
}

func CompleteLogin(ctx context.Context, attemptID string, actor *pb.AccessGateActorRef, sessionID string) (*pb.AccessDecision, error) {
	attempt, ok := GetAttempt(attemptID)
	if !ok {
		return nil, fmt.Errorf("access attempt expired or not found")
	}

	attempt.Actor = actor
	attempt.SessionID = sessionID

	return DecisionForAttempt(ctx, attempt), nil
}

func DecisionForAttempt(ctx context.Context, attempt *Attempt) *pb.AccessDecision {
	gates := []*pb.AccessGate{passedCapabilityGate()}
	if attempt.Actor == nil {
		return &pb.AccessDecision{
			State:         pb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED,
			AttemptId:     attempt.ID,
			CurrentGateId: "auth.login",
			Gates:         append(gates, loginGate(pb.AccessGateState_ACCESS_GATE_STATE_ACTION_REQUIRED, "")),
			ExpiresAt:     timestamppb.New(attempt.ExpiresAt),
		}
	}

	allowed, reason := CheckActorAllowed(ctx, attempt.Actor)
	inviteState := pb.AccessGateState_ACCESS_GATE_STATE_PASSED
	decisionState := pb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED
	currentGateID := ""
	if !allowed {
		inviteState = pb.AccessGateState_ACCESS_GATE_STATE_BLOCKED
		decisionState = pb.AccessDecisionState_ACCESS_DECISION_STATE_BLOCKED
		currentGateID = "invite.allowlist"
	}

	return &pb.AccessDecision{
		State:         decisionState,
		AttemptId:     attempt.ID,
		CurrentGateId: currentGateID,
		Gates: append(gates,
			loginGate(pb.AccessGateState_ACCESS_GATE_STATE_PASSED, ""),
			inviteGate(inviteState, reason),
		),
		Actor:         attempt.Actor,
		AccessGrantId: grantID(attempt.ID, attempt.Actor),
		ExpiresAt:     timestamppb.New(attempt.ExpiresAt),
		Message:       reason,
	}
}

func CheckActorAllowed(ctx context.Context, actor *pb.AccessGateActorRef) (bool, string) {
	policy, err := GetPolicy(ctx)
	if err != nil {
		return false, "access policy unavailable"
	}

	mode := strings.TrimSpace(policy.Mode)
	if mode == "" || mode == policyModeOpen {
		return true, ""
	}
	if mode == policyModeClosed {
		return false, "Station is currently closed"
	}

	if containsString(splitList(policy.AllowedEmails), actor.GetEmail()) ||
		containsString(splitList(policy.AllowedUsernames), actor.GetUsername()) ||
		containsInt64(splitList(policy.AllowedActorIDs), actor.GetActorId()) {
		return true, ""
	}

	switch mode {
	case policyModeInviteOnly:
		return false, "This Station is invite-only"
	case policyModeFixedUsers:
		return false, "This Station only allows configured users"
	default:
		return false, "Unsupported Station access policy"
	}
}

func GetPolicy(ctx context.Context) (*dbmodel.AccessPolicy, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}

	var policy dbmodel.AccessPolicy
	if err := rds.WithContext(ctx).First(&policy).Error; err == nil {
		return &policy, nil
	}

	policy = dbmodel.AccessPolicy{Mode: policyModeOpen}
	if err := rds.WithContext(ctx).Create(&policy).Error; err != nil {
		return nil, err
	}
	return &policy, nil
}

func UpdatePolicy(ctx context.Context, input PolicyInput) (*dbmodel.AccessPolicy, error) {
	mode := normalizeMode(input.Mode)
	if mode == "" {
		return nil, fmt.Errorf("unsupported access policy mode: %s", input.Mode)
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}

	policy, err := GetPolicy(ctx)
	if err != nil {
		return nil, err
	}

	policy.Mode = mode
	policy.AllowedEmails = joinStrings(input.AllowedEmails)
	policy.AllowedUsernames = joinStrings(input.AllowedUsernames)
	policy.AllowedActorIDs = joinInt64(input.AllowedActorIDs)
	policy.UpdatedBy = input.UpdatedBy

	if err := rds.WithContext(ctx).Save(policy).Error; err != nil {
		return nil, err
	}
	return policy, nil
}

func ToProtoPolicy(policy *dbmodel.AccessPolicy) *pb.AccessPolicy {
	actorIDs := make([]int64, 0)
	for _, raw := range splitList(policy.AllowedActorIDs) {
		if id, err := strconv.ParseInt(raw, 10, 64); err == nil {
			actorIDs = append(actorIDs, id)
		}
	}

	return &pb.AccessPolicy{
		Mode:             toProtoPolicyMode(policy.Mode),
		AllowedEmails:    splitList(policy.AllowedEmails),
		AllowedUsernames: splitList(policy.AllowedUsernames),
		AllowedActorIds:  actorIDs,
		UpdatedAt:        timestamppb.New(policy.UpdatedAt),
		UpdatedBy:        policy.UpdatedBy,
	}
}

func passedCapabilityGate() *pb.AccessGate {
	return &pb.AccessGate{
		GateId: "station.capability",
		Type:   pb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY,
		State:  pb.AccessGateState_ACCESS_GATE_STATE_PASSED,
		Title:  "Station compatibility",
	}
}

func loginGate(state pb.AccessGateState, reason string) *pb.AccessGate {
	return &pb.AccessGate{
		GateId:         "auth.login",
		Type:           pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
		State:          state,
		Title:          "Log in",
		Description:    "Log in before entering this Station.",
		BlockingReason: reason,
		SubmitAction:   "submit_login",
	}
}

func inviteGate(state pb.AccessGateState, reason string) *pb.AccessGate {
	return &pb.AccessGate{
		GateId:         "invite.allowlist",
		Type:           pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_ALLOWLIST,
		State:          state,
		Title:          "Station access",
		Description:    "Station access is controlled by the Station administrator.",
		BlockingReason: reason,
	}
}

func newAttemptID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("attempt-%d", time.Now().UnixNano())
	}
	return "attempt-" + hex.EncodeToString(b[:])
}

func grantID(attemptID string, actor *pb.AccessGateActorRef) string {
	return fmt.Sprintf("grant-%s-%d", strings.TrimPrefix(attemptID, "attempt-"), actor.GetActorId())
}

func normalizeMode(mode string) string {
	switch strings.TrimSpace(mode) {
	case "", policyModeOpen:
		return policyModeOpen
	case policyModeInviteOnly:
		return policyModeInviteOnly
	case policyModeFixedUsers:
		return policyModeFixedUsers
	case policyModeClosed:
		return policyModeClosed
	default:
		return ""
	}
}

func toProtoPolicyMode(mode string) pb.AccessPolicyMode {
	switch normalizeMode(mode) {
	case policyModeInviteOnly:
		return pb.AccessPolicyMode_ACCESS_POLICY_MODE_INVITE_ONLY
	case policyModeFixedUsers:
		return pb.AccessPolicyMode_ACCESS_POLICY_MODE_FIXED_USERS
	case policyModeClosed:
		return pb.AccessPolicyMode_ACCESS_POLICY_MODE_CLOSED
	default:
		return pb.AccessPolicyMode_ACCESS_POLICY_MODE_OPEN
	}
}

func splitList(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if value := strings.TrimSpace(part); value != "" {
			out = append(out, value)
		}
	}
	return out
}

func joinStrings(values []string) string {
	clean := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			clean = append(clean, trimmed)
		}
	}
	return strings.Join(clean, ",")
}

func joinInt64(values []int64) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		if value > 0 {
			parts = append(parts, strconv.FormatInt(value, 10))
		}
	}
	return strings.Join(parts, ",")
}

func containsString(values []string, target string) bool {
	target = strings.TrimSpace(strings.ToLower(target))
	if target == "" {
		return false
	}
	for _, value := range values {
		if strings.ToLower(strings.TrimSpace(value)) == target {
			return true
		}
	}
	return false
}

func containsInt64(values []string, target int64) bool {
	if target <= 0 {
		return false
	}
	targetStr := strconv.FormatInt(target, 10)
	for _, value := range values {
		if strings.TrimSpace(value) == targetStr {
			return true
		}
	}
	return false
}
