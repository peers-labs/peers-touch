package accessgate

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	stationidentity "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate/gatekeeper"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/auth"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
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

const (
	gateIDCapability      = "station.capability"
	gateIDLogin           = "auth.login"
	gateIDInviteAllowlist = "invite.allowlist"
	gateIDInviteCode      = "invite.code"
)

const invalidAccessGateType pb.AccessGateType = -1

// defaultGateOrder is the chain a Station evaluates when its policy does not pin
// an explicit enabled_gates list. Capability runs first, then login establishes
// actor identity, then the allowlist enforces administrator policy.
var defaultGateOrder = []pb.AccessGateType{
	pb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY,
	pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
	pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_ALLOWLIST,
}

type Attempt struct {
	ID                  string
	SessionID           string
	StationPeerID       string
	Actor               *actormodel.ActorRef
	ActorUsername       string
	ActorEmail          string
	AuthMethod          string
	InvitePassed        bool
	Platform            string
	DeviceID            string
	LifecycleGeneration uint64
	CompletedActions    map[string]bool
	CurrentGateID       string
	DecisionRevision    uint64
	Status              string
	CreatedAt           time.Time
	ExpiresAt           time.Time
}

type PolicyInput struct {
	Mode              string
	AllowedEmails     []string
	AllowedUsernames  []string
	AllowedActorPTIDs []string
	EnabledGates      []pb.AccessGateType
	SelfServiceInvite bool
	UpdatedBy         string
}

func StartAttempt(ctx context.Context, req *pb.StartAccessAttemptRequest) (*pb.AccessDecision, error) {
	if req == nil {
		return nil, fmt.Errorf("access attempt request is required")
	}
	stationPeerID := strings.TrimSpace(req.GetStationPeerId())
	if err := ValidateStationPeerID(stationPeerID); err != nil {
		return nil, err
	}
	client := req.GetClient()
	if client == nil {
		return nil, fmt.Errorf("access attempt client is required")
	}
	if strings.TrimSpace(client.GetDeviceId()) == "" {
		return nil, fmt.Errorf("access attempt device id is required")
	}
	if client.GetLifecycleGeneration() == 0 {
		return nil, fmt.Errorf("access attempt lifecycle generation is required")
	}

	actorRef, username, email, err := actorRefFromSession(ctx, strings.TrimSpace(req.GetSessionId()))
	if err != nil {
		return nil, err
	}

	attempt := &Attempt{
		ID:                  newAttemptID(),
		SessionID:           strings.TrimSpace(req.GetSessionId()),
		StationPeerID:       stationPeerID,
		Actor:               actorRef,
		ActorUsername:       username,
		ActorEmail:          email,
		AuthMethod:          "",
		Platform:            strings.TrimSpace(client.GetPlatform()),
		DeviceID:            strings.TrimSpace(client.GetDeviceId()),
		LifecycleGeneration: client.GetLifecycleGeneration(),
		CompletedActions:    make(map[string]bool),
		CreatedAt:           time.Now(),
		ExpiresAt:           time.Now().Add(15 * time.Minute),
	}
	if actorRef != nil {
		attempt.AuthMethod = "session_restore"
	}

	decision := DecisionForAttempt(ctx, attempt)
	attempt.Status = attemptStatusForDecision(decision.GetState())
	attempt.CurrentGateID = decision.GetCurrentGateId()
	if err := createAttempt(ctx, attempt, req, decision); err != nil {
		return nil, err
	}

	return decision, nil
}

// ValidateStationPeerID prevents URL-scoped credentials and gate state from
// crossing to another Station identity.
func ValidateStationPeerID(stationPeerID string) error {
	expected := stationidentity.LocalIdentitySnapshot().StationPeerID.String()
	if expected == "" {
		return fmt.Errorf("local Station peer identity is unavailable")
	}
	if strings.TrimSpace(stationPeerID) != expected {
		return fmt.Errorf("Station peer identity mismatch")
	}
	return nil
}

// ValidateOAuthBinding verifies that an OAuth attempt is attached to the
// current actionable gate of the same Station access attempt.
func ValidateOAuthBinding(
	ctx context.Context,
	accessAttemptID, stationPeerID, gateID string,
	actionType pb.AccessGateType,
) error {
	if actionType != pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_OAUTH {
		return fmt.Errorf("OAuth action type must be AUTH_OAUTH")
	}
	if err := ValidateStationPeerID(stationPeerID); err != nil {
		return err
	}
	attempt, ok := findAttempt(ctx, strings.TrimSpace(accessAttemptID))
	if !ok {
		return errAttemptNotFound
	}
	if attempt.StationPeerID != stationPeerID {
		return fmt.Errorf("OAuth access attempt Station mismatch")
	}
	decision, err := decisionAndPersist(ctx, attempt)
	if err != nil {
		return err
	}
	if decision.GetState() != pb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED ||
		decision.GetCurrentGateId() != strings.TrimSpace(gateID) {
		return fmt.Errorf("OAuth gate is not the current access gate")
	}
	for _, gate := range decision.GetGates() {
		if gate.GetGateId() != strings.TrimSpace(gateID) ||
			gate.GetType() != pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN {
			continue
		}
		for _, action := range gate.GetAlternativeActions() {
			if action.GetType() == actionType &&
				action.GetActionId() == "auth.oauth" &&
				action.GetSubmitAction() == "start_oauth" {
				return nil
			}
		}
	}
	return fmt.Errorf("AUTH_OAUTH is not an advertised alternative action")
}

// BindOAuthCandidate attaches a resolved actor without issuing a session, then
// re-evaluates all later Station-owned gates.
func BindOAuthCandidate(
	ctx context.Context,
	accessAttemptID, stationPeerID, gateID string,
	actorRef *actormodel.ActorRef,
	username, email string,
) (*pb.AccessDecision, error) {
	if actorRef == nil || strings.TrimSpace(actorRef.GetPtid()) == "" {
		return nil, fmt.Errorf("OAuth candidate requires an actor PTID")
	}
	if err := ValidateOAuthBinding(
		ctx,
		accessAttemptID,
		stationPeerID,
		gateID,
		pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_OAUTH,
	); err != nil {
		return nil, err
	}
	attempt, ok := findAttempt(ctx, accessAttemptID)
	if !ok {
		return nil, errAttemptNotFound
	}
	attempt.Actor = actorRef
	attempt.ActorUsername = username
	attempt.ActorEmail = email
	attempt.SessionID = ""
	attempt.AuthMethod = "oauth"
	return decisionAndPersist(ctx, attempt)
}

// ReevaluateOAuthCandidate reads the current gate state after another gate
// action has completed. It never creates or activates a session.
func ReevaluateOAuthCandidate(
	ctx context.Context,
	accessAttemptID, stationPeerID string,
) (*pb.AccessDecision, error) {
	if err := ValidateStationPeerID(stationPeerID); err != nil {
		return nil, err
	}
	attempt, ok := findAttempt(ctx, strings.TrimSpace(accessAttemptID))
	if !ok {
		return nil, errAttemptNotFound
	}
	if attempt.StationPeerID != stationPeerID {
		return nil, fmt.Errorf("OAuth access attempt Station mismatch")
	}
	if attempt.Actor == nil || strings.TrimSpace(attempt.Actor.GetPtid()) == "" {
		return nil, fmt.Errorf("OAuth access attempt has no actor candidate")
	}
	return decisionAndPersist(ctx, attempt)
}

func actorRefFromSession(ctx context.Context, sessionID string) (*actormodel.ActorRef, string, string, error) {
	if sessionID == "" {
		return nil, "", "", nil
	}

	session, err := auth.SessionManager().Validate(ctx, sessionID)
	if err != nil {
		return nil, "", "", actormodel.NewErrorResponse(
			actormodel.ErrorCode_ERROR_CODE_UNAUTHORIZED,
			"access session invalid",
		)
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, "", "", err
	}

	var actor dbmodel.Actor
	if err := rds.WithContext(ctx).Where("id = ?", session.UserID).First(&actor).Error; err != nil {
		return nil, "", "", err
	}

	return touchactor.ProtoActorRef(&actor, ""), actor.PreferredUsername, actor.Email, nil
}

// GetAttempt loads a live attempt from the persistent store. Expired, cancelled,
// or missing attempts report not found so callers surface one uniform message.
func GetAttempt(ctx context.Context, id string) (*Attempt, bool) {
	return findAttempt(ctx, id)
}

func CompleteLoginCandidate(
	ctx context.Context,
	attemptID string,
	actor *actormodel.ActorRef,
	username, email string,
) (*pb.AccessDecision, error) {
	attempt, ok := findAttempt(ctx, attemptID)
	if !ok {
		return nil, errAttemptNotFound
	}

	attempt.Actor = actor
	attempt.ActorUsername = username
	attempt.ActorEmail = email
	attempt.SessionID = ""
	attempt.AuthMethod = "password"

	return decisionAndPersist(ctx, attempt)
}

// CancelAttempt closes a live attempt. It is idempotent: cancelling an attempt
// that is already gone or terminal returns cancelled=false without an error.
func CancelAttempt(ctx context.Context, attemptID string) (bool, error) {
	return cancelAttempt(ctx, strings.TrimSpace(attemptID))
}

// CompleteInviteCode redeems an invite code for an attempt and, on success,
// marks the attempt's invite gate passed before re-evaluating the chain. The
// redemption is atomic; an invalid code returns the chain's blocked decision so
// the client can re-prompt without leaking which validation failed.
func CompleteInviteCode(ctx context.Context, attemptID, code string) (*pb.AccessDecision, error) {
	attempt, ok := findAttempt(ctx, attemptID)
	if !ok {
		return nil, errAttemptNotFound
	}
	if attempt.InvitePassed {
		return decisionAndPersist(ctx, attempt)
	}

	if err := redeemInviteCode(ctx, attempt.ID, code); err != nil {
		if errors.Is(err, errInviteCodeInvalid) {
			return nil, errInviteCodeInvalid
		}
		return nil, err
	}

	attempt, ok = findAttempt(ctx, attempt.ID)
	if !ok {
		return nil, errAttemptNotFound
	}

	return decisionAndPersist(ctx, attempt)
}

// CompleteGenericAction applies the policy semantics for a schema-bound scalar
// action. Only registered, Station-owned actions are accepted.
func CompleteGenericAction(
	ctx context.Context,
	attemptID, actionID string,
	input *pb.AccessGateGenericInput,
) (*pb.AccessDecision, error) {
	switch actionID {
	case "terms.accept":
		accepted := false
		for _, field := range input.GetFields() {
			if field.GetFieldName() == "accepted" {
				accepted = field.GetBoolValue()
			}
		}
		if !accepted {
			return nil, errors.New("terms acceptance requires explicit consent")
		}
	default:
		return nil, fmt.Errorf("unsupported schema-bound access action: %s", actionID)
	}

	attempt, err := markAttemptActionCompleted(ctx, attemptID, actionID)
	if err != nil {
		return nil, err
	}
	return decisionAndPersist(ctx, attempt)
}

// DecisionForAttempt evaluates the gate chain without persisting the outcome.
// Use decisionAndPersist on the write paths so the stored attempt status tracks
// the decision the client receives.
func DecisionForAttempt(ctx context.Context, attempt *Attempt) *pb.AccessDecision {
	return registry().Decide(ctx, &gatekeeper.EvalContext{
		AttemptID:        attempt.ID,
		Actor:            attempt.Actor,
		ActorUsername:    attempt.ActorUsername,
		ActorEmail:       attempt.ActorEmail,
		ExpiresAt:        attempt.ExpiresAt,
		InvitePassed:     attempt.InvitePassed,
		CompletedActions: attempt.CompletedActions,
	}, gateOrder(ctx))
}

func RefreshDecision(ctx context.Context, attempt *Attempt) (*pb.AccessDecision, error) {
	if attempt == nil {
		return nil, errors.New("access attempt is required")
	}
	return decisionAndPersist(ctx, attempt)
}

// decisionAndPersist evaluates the gate chain and writes the resulting status
// and current gate back onto the attempt row before returning the decision.
func decisionAndPersist(ctx context.Context, attempt *Attempt) (*pb.AccessDecision, error) {
	decision := DecisionForAttempt(ctx, attempt)
	if err := saveAttemptDecision(ctx, attempt, decision); err != nil {
		return nil, fmt.Errorf("persist access decision: %w", err)
	}
	attempt.Status = attemptStatusForDecision(decision.GetState())
	attempt.CurrentGateID = decision.GetCurrentGateId()
	return decision, nil
}

var (
	registryOnce sync.Once
	registryInst *gatekeeper.Registry
)

// registry lazily builds the gatekeeper registry with the Station's built-in
// gates. Custom or future gates register here without touching DecisionForAttempt.
func registry() *gatekeeper.Registry {
	registryOnce.Do(func() {
		r := gatekeeper.NewRegistry(grantID)
		r.Register(capabilityGatekeeper{})
		r.Register(loginGatekeeper{})
		r.Register(allowlistGatekeeper{allowed: CheckActorAllowed})
		r.Register(inviteCodeGatekeeper{})
		r.Register(termsAcceptanceGatekeeper{})
		registryInst = r
	})
	return registryInst
}

// gateOrder resolves the evaluation order for the current Station policy. An
// explicit enabled_gates list wins so the Dashboard can disable an optional
// policy gate across every client; otherwise the built-in default chain
// applies. Invalid persisted orders become an invalid sentinel that the
// registry blocks rather than silently falling back or skipping a gate.
func gateOrder(ctx context.Context) []pb.AccessGateType {
	policy, err := GetPolicy(ctx)
	if err != nil {
		return defaultGateOrder
	}

	enabled := decodeEnabledGates(policy.EnabledGates)
	if len(enabled) == 0 {
		return defaultGateOrder
	}
	if err := validateGateOrder(normalizeMode(policy.Mode), enabled); err != nil {
		return []pb.AccessGateType{invalidAccessGateType}
	}
	return enabled
}

func CheckActorAllowed(ctx context.Context, actor *actormodel.ActorRef, username, email string) (bool, string) {
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

	if containsString(splitList(policy.AllowedEmails), email) ||
		containsString(splitList(policy.AllowedUsernames), username) ||
		containsString(splitList(policy.AllowedActorPTIDs), actor.GetPtid()) {
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
	if err := validateGateOrder(mode, input.EnabledGates); err != nil {
		return nil, err
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
	policy.AllowedActorPTIDs = joinStrings(input.AllowedActorPTIDs)
	policy.EnabledGates = encodeEnabledGates(input.EnabledGates)
	policy.SelfServiceInvite = input.SelfServiceInvite
	policy.UpdatedBy = input.UpdatedBy

	if err := rds.WithContext(ctx).Save(policy).Error; err != nil {
		return nil, err
	}
	return policy, nil
}

func validateGateOrder(mode string, gates []pb.AccessGateType) error {
	switch mode {
	case policyModeOpen, policyModeInviteOnly, policyModeFixedUsers, policyModeClosed:
	default:
		return fmt.Errorf("unsupported access policy mode: %s", mode)
	}

	if len(gates) == 0 {
		return nil
	}

	seen := make(map[pb.AccessGateType]struct{}, len(gates))
	for _, gateType := range gates {
		if !isKnownGateType(gateType) || !registry().Has(gateType) {
			return fmt.Errorf("unsupported access gate type in policy: %d", gateType)
		}
		if _, ok := seen[gateType]; ok {
			return fmt.Errorf("duplicate access gate type in policy: %s", gateType.String())
		}
		seen[gateType] = struct{}{}
	}

	if len(gates) < 2 ||
		gates[0] != pb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY ||
		gates[1] != pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN {
		return fmt.Errorf("access gate order must start with STATION_CAPABILITY followed by AUTH_LOGIN")
	}

	_, hasAllowlist := seen[pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_ALLOWLIST]
	_, hasInviteCode := seen[pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_CODE]
	switch mode {
	case policyModeInviteOnly:
		if !hasAllowlist && !hasInviteCode {
			return fmt.Errorf("invite-only policy requires INVITE_ALLOWLIST or INVITE_CODE")
		}
	case policyModeFixedUsers, policyModeClosed:
		if !hasAllowlist {
			return fmt.Errorf("%s policy requires INVITE_ALLOWLIST", mode)
		}
	}

	return nil
}

func isKnownGateType(gateType pb.AccessGateType) bool {
	if gateType == pb.AccessGateType_ACCESS_GATE_TYPE_UNSPECIFIED {
		return false
	}
	_, ok := pb.AccessGateType_name[int32(gateType)]
	return ok
}

// encodeEnabledGates serializes the enabled gate types as a comma-separated list
// of their numeric enum values for storage.
func encodeEnabledGates(gates []pb.AccessGateType) string {
	parts := make([]string, 0, len(gates))
	for _, gate := range gates {
		parts = append(parts, strconv.Itoa(int(gate)))
	}
	return strings.Join(parts, ",")
}

// decodeEnabledGates parses the stored enabled gate list back into enum values.
// Malformed entries are retained as an invalid sentinel so legacy or manually
// corrupted policy rows fail closed during evaluation.
func decodeEnabledGates(raw string) []pb.AccessGateType {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}

	values := strings.Split(raw, ",")
	gates := make([]pb.AccessGateType, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		num, err := strconv.Atoi(value)
		if err != nil {
			gates = append(gates, invalidAccessGateType)
			continue
		}
		gates = append(gates, pb.AccessGateType(num))
	}
	return gates
}

func ToProtoPolicy(policy *dbmodel.AccessPolicy) *pb.AccessPolicy {
	return &pb.AccessPolicy{
		Mode:              toProtoPolicyMode(policy.Mode),
		AllowedEmails:     splitList(policy.AllowedEmails),
		AllowedUsernames:  splitList(policy.AllowedUsernames),
		AllowedActorPtids: splitList(policy.AllowedActorPTIDs),
		EnabledGates:      decodeEnabledGates(policy.EnabledGates),
		SelfServiceInvite: policy.SelfServiceInvite,
		UpdatedAt:         timestamppb.New(policy.UpdatedAt),
		UpdatedBy:         policy.UpdatedBy,
	}
}

func newAttemptID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("attempt-%d", time.Now().UnixNano())
	}
	return "attempt-" + hex.EncodeToString(b[:])
}

func grantID(attemptID string, actor *actormodel.ActorRef) string {
	return fmt.Sprintf("grant-%s-%s", strings.TrimPrefix(attemptID, "attempt-"), actor.GetPtid())
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
