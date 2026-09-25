package accessgate

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

const (
	accessGateSchemaRevision  = uint32(1)
	submissionStateProcessing = "processing"
	submissionStateCompleted  = "completed"
	submissionLease           = 30 * time.Second
	maxGenericFieldCount      = 32
	maxGenericStringBytes     = 4096
)

var secretFieldName = regexp.MustCompile(`(?i)(password|passwd|secret|token|credential|private[_-]?key|url|uri|binary|script|code)`)

type SubmissionClaim struct {
	Attempt     *Attempt
	Decision    *pb.AccessDecision
	Gate        *pb.AccessGate
	Action      *pb.AccessGateAction
	PayloadHash string
	Replay      bool
}

type gateFieldSchema struct {
	Name     string            `json:"name"`
	Type     string            `json:"type"`
	Required bool              `json:"required"`
	Options  []json.RawMessage `json:"options"`
}

type gateInputSchema struct {
	Fields []gateFieldSchema `json:"fields"`
}

func accessGateAction(actionID string, gateType pb.AccessGateType, submitAction, schema string) *pb.AccessGateAction {
	return &pb.AccessGateAction{
		ActionId:       actionID,
		Type:           gateType,
		SubmitAction:   submitAction,
		SchemaRevision: accessGateSchemaRevision,
		SchemaDigest:   accessGateSchemaDigest(actionID, submitAction, schema),
	}
}

func bindPrimaryAction(gate *pb.AccessGate, actionID string) *pb.AccessGate {
	if gate == nil {
		return nil
	}
	action := accessGateAction(actionID, gate.GetType(), gate.GetSubmitAction(), gate.GetInputSchemaJson())
	gate.ActionId = action.GetActionId()
	gate.SchemaRevision = action.GetSchemaRevision()
	gate.SchemaDigest = action.GetSchemaDigest()
	return gate
}

func accessGateSchemaDigest(actionID, submitAction, schema string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		"peers-touch.access-gate.v1",
		strings.TrimSpace(actionID),
		strings.TrimSpace(submitAction),
		schema,
	}, "\x00")))
	return hex.EncodeToString(sum[:])
}

func submissionPayloadHash(req *pb.SubmitAccessGateRequest) (string, error) {
	return submissionPayloadHashWithKey(req, []byte(coreauth.Get().Secret))
}

func submissionPayloadHashWithKey(
	req *pb.SubmitAccessGateRequest,
	key []byte,
) (string, error) {
	if req == nil {
		return "", errors.New("access gate submission is required")
	}
	if len(key) == 0 {
		return "", errors.New("access gate submission fingerprint key is required")
	}
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("encode access gate submission fingerprint: %w", err)
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte("peers-touch.access-gate.submission.v1\x00"))
	_, _ = mac.Write(data)
	return hex.EncodeToString(mac.Sum(nil)), nil
}

// BeginSubmission validates the exact current descriptor and claims the stable
// submission ID before any gate mutation. A completed matching claim is a
// replay; a live processing claim fails closed until its bounded lease expires.
func BeginSubmission(ctx context.Context, req *pb.SubmitAccessGateRequest) (*SubmissionClaim, error) {
	if req == nil {
		return nil, errors.New("access gate submission is required")
	}
	submissionID := strings.TrimSpace(req.GetSubmissionId())
	if submissionID == "" {
		return nil, errors.New("access gate submission id is required")
	}
	payloadHash, err := submissionPayloadHash(req)
	if err != nil {
		return nil, err
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}
	var existing dbmodel.AccessGateSubmission
	findErr := rds.WithContext(ctx).
		Where("attempt_id = ? AND submission_id = ?", req.GetAttemptId(), submissionID).
		First(&existing).Error
	if findErr == nil {
		if existing.PayloadHash != payloadHash {
			return nil, errors.New("access gate submission id was reused with different input")
		}
		attempt, ok := findAttempt(ctx, req.GetAttemptId())
		if !ok {
			return nil, errAttemptNotFound
		}
		if existing.State == submissionStateCompleted {
			return &SubmissionClaim{
				Attempt:     attempt,
				Decision:    DecisionForAttempt(ctx, attempt),
				PayloadHash: payloadHash,
				Replay:      true,
			}, nil
		}
		if time.Since(existing.UpdatedAt) < submissionLease {
			return nil, errors.New("access gate submission is already processing")
		}
		if err := rds.WithContext(ctx).Model(&existing).Update("updated_at", time.Now()).Error; err != nil {
			return nil, err
		}
		return &SubmissionClaim{
			Attempt:     attempt,
			Decision:    DecisionForAttempt(ctx, attempt),
			PayloadHash: payloadHash,
		}, nil
	}
	if !errors.Is(findErr, gorm.ErrRecordNotFound) {
		return nil, findErr
	}

	claim, err := validateSubmission(ctx, req)
	if err != nil {
		return nil, err
	}
	row := &dbmodel.AccessGateSubmission{
		AttemptID:    req.GetAttemptId(),
		SubmissionID: submissionID,
		GateID:       req.GetGateId(),
		ActionID:     req.GetActionId(),
		PayloadHash:  payloadHash,
		State:        submissionStateProcessing,
	}
	if err := rds.WithContext(ctx).Create(row).Error; err != nil {
		return nil, fmt.Errorf("claim access gate submission: %w", err)
	}
	claim.PayloadHash = payloadHash
	return claim, nil
}

func CompleteSubmission(
	ctx context.Context,
	req *pb.SubmitAccessGateRequest,
	decision *pb.AccessDecision,
) error {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	result := rds.WithContext(ctx).Model(&dbmodel.AccessGateSubmission{}).
		Where(
			"attempt_id = ? AND submission_id = ? AND state = ?",
			req.GetAttemptId(),
			req.GetSubmissionId(),
			submissionStateProcessing,
		).
		Updates(map[string]any{
			"state":             submissionStateCompleted,
			"decision_revision": decisionRevision(ctx, req.GetAttemptId()),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("access gate submission claim is unavailable")
	}
	return nil
}

func AbandonSubmission(ctx context.Context, req *pb.SubmitAccessGateRequest) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return
	}
	_ = rds.WithContext(ctx).
		Where(
			"attempt_id = ? AND submission_id = ? AND state = ?",
			req.GetAttemptId(),
			req.GetSubmissionId(),
			submissionStateProcessing,
		).
		Delete(&dbmodel.AccessGateSubmission{}).Error
}

func validateSubmission(ctx context.Context, req *pb.SubmitAccessGateRequest) (*SubmissionClaim, error) {
	if strings.TrimSpace(req.GetAttemptId()) == "" {
		return nil, errors.New("access attempt id is required")
	}
	if strings.TrimSpace(req.GetGateId()) == "" {
		return nil, errors.New("access gate id is required")
	}
	if !isKnownGateType(req.GetType()) || !registry().Has(req.GetType()) {
		return nil, fmt.Errorf("unsupported access gate type: %d", req.GetType())
	}

	attempt, ok := findAttempt(ctx, req.GetAttemptId())
	if !ok {
		return nil, errAttemptNotFound
	}
	if err := validateSubmissionScope(attempt, req); err != nil {
		return nil, err
	}
	decision := DecisionForAttempt(ctx, attempt)
	gate, action, err := validateSubmissionDecision(decision, req)
	if err != nil {
		return nil, err
	}
	if err := validateActionInput(gate, action, req); err != nil {
		return nil, err
	}
	return &SubmissionClaim{
		Attempt:  attempt,
		Decision: decision,
		Gate:     gate,
		Action:   action,
	}, nil
}

// ValidateLegacySubmission keeps non-Mobile clients on their existing typed
// login/invite protocol until their owning Plan adopts the schema-bound
// envelope. A Mobile attempt can never downgrade into this path.
func ValidateLegacySubmission(ctx context.Context, req *pb.SubmitAccessGateRequest) error {
	if req == nil {
		return errors.New("access gate submission is required")
	}
	attempt, ok := findAttempt(ctx, strings.TrimSpace(req.GetAttemptId()))
	if !ok {
		return errAttemptNotFound
	}
	if strings.EqualFold(strings.TrimSpace(attempt.Platform), "mobile") ||
		attempt.DeviceID != "" || attempt.LifecycleGeneration != 0 {
		return errors.New("schema-bound access gate submission is required")
	}
	decision := DecisionForAttempt(ctx, attempt)
	if decision == nil || decision.GetAttemptId() != req.GetAttemptId() {
		return errors.New("access gate submission attempt does not match the current decision")
	}
	if decision.GetState() != pb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED ||
		decision.GetCurrentGateId() != req.GetGateId() {
		return errors.New("access gate submission does not match the current gate")
	}
	for _, gate := range decision.GetGates() {
		if gate.GetGateId() == req.GetGateId() &&
			gate.GetType() == req.GetType() &&
			gate.GetState() == pb.AccessGateState_ACCESS_GATE_STATE_ACTION_REQUIRED {
			return validateLegacyActionInput(req)
		}
	}
	return errors.New("current access gate descriptor is unavailable")
}

func ValidateDecisionRead(
	attempt *Attempt,
	req *pb.GetAccessDecisionRequest,
) error {
	if attempt == nil || req == nil {
		return errors.New("access decision request is required")
	}
	return validateAttemptScope(
		attempt,
		req.GetStationPeerId(),
		req.GetDeviceId(),
		req.GetLifecycleGeneration(),
		"access decision",
	)
}

func ValidateCancellation(
	attempt *Attempt,
	req *pb.CancelAccessAttemptRequest,
) error {
	if attempt == nil || req == nil {
		return errors.New("access cancellation request is required")
	}
	return validateAttemptScope(
		attempt,
		req.GetStationPeerId(),
		req.GetDeviceId(),
		req.GetLifecycleGeneration(),
		"access cancellation",
	)
}

func validateLegacyActionInput(req *pb.SubmitAccessGateRequest) error {
	switch req.GetType() {
	case pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN:
		if req.GetLogin() == nil {
			return errors.New("login gate requires typed credentials")
		}
	case pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_CODE:
		if strings.TrimSpace(req.GetInviteCode()) == "" {
			return errors.New("invite code gate requires a code")
		}
	default:
		return fmt.Errorf("legacy access gate type is not submittable: %s", req.GetType())
	}
	return nil
}

func validateSubmissionScope(attempt *Attempt, req *pb.SubmitAccessGateRequest) error {
	return validateAttemptScope(
		attempt,
		req.GetStationPeerId(),
		req.GetDeviceId(),
		req.GetLifecycleGeneration(),
		"access gate submission",
	)
}

func validateAttemptScope(
	attempt *Attempt,
	stationPeerID, deviceID string,
	lifecycleGeneration uint64,
	operation string,
) error {
	if attempt.DeviceID == "" && attempt.LifecycleGeneration == 0 {
		return nil
	}
	if strings.TrimSpace(stationPeerID) != attempt.StationPeerID {
		return fmt.Errorf("%s Station identity mismatch", operation)
	}
	if attempt.DeviceID != "" || attempt.LifecycleGeneration != 0 {
		if strings.TrimSpace(deviceID) == "" || deviceID != attempt.DeviceID {
			return fmt.Errorf("%s device mismatch", operation)
		}
		if lifecycleGeneration == 0 || lifecycleGeneration != attempt.LifecycleGeneration {
			return fmt.Errorf("%s lifecycle generation mismatch", operation)
		}
	}
	return nil
}

func validateSubmissionDecision(
	decision *pb.AccessDecision,
	req *pb.SubmitAccessGateRequest,
) (*pb.AccessGate, *pb.AccessGateAction, error) {
	if !isKnownGateType(req.GetType()) || !registry().Has(req.GetType()) {
		return nil, nil, fmt.Errorf("unsupported access gate type: %d", req.GetType())
	}
	if decision == nil || decision.GetAttemptId() != req.GetAttemptId() {
		return nil, nil, errors.New("access gate submission attempt does not match the current decision")
	}
	if decision.GetState() != pb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED {
		return nil, nil, errors.New("access attempt does not have an actionable current gate")
	}
	if decision.GetCurrentGateId() != req.GetGateId() {
		return nil, nil, errors.New("access gate submission does not match the current gate")
	}

	for _, gate := range decision.GetGates() {
		if gate.GetGateId() != req.GetGateId() {
			continue
		}
		if gate.GetType() != req.GetType() {
			return nil, nil, errors.New("access gate submission type does not match the current gate")
		}
		if gate.GetState() != pb.AccessGateState_ACCESS_GATE_STATE_ACTION_REQUIRED {
			return nil, nil, errors.New("access gate is not actionable")
		}
		action := primaryAction(gate)
		if req.GetActionId() != action.GetActionId() ||
			req.GetSchemaRevision() != action.GetSchemaRevision() ||
			req.GetSchemaDigest() != action.GetSchemaDigest() {
			return nil, nil, errors.New("access gate submission descriptor is stale or mismatched")
		}
		return gate, action, nil
	}

	return nil, nil, errors.New("current access gate descriptor is unavailable")
}

func primaryAction(gate *pb.AccessGate) *pb.AccessGateAction {
	return &pb.AccessGateAction{
		ActionId:       gate.GetActionId(),
		Type:           gate.GetType(),
		SubmitAction:   gate.GetSubmitAction(),
		SchemaRevision: gate.GetSchemaRevision(),
		SchemaDigest:   gate.GetSchemaDigest(),
	}
}

func validateActionInput(
	gate *pb.AccessGate,
	action *pb.AccessGateAction,
	req *pb.SubmitAccessGateRequest,
) error {
	switch action.GetType() {
	case pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN:
		if req.GetLogin() == nil {
			return errors.New("login gate requires typed credentials")
		}
	case pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_SESSION_RESTORE:
		if strings.TrimSpace(req.GetSessionId()) == "" {
			return errors.New("session restore gate requires a session id")
		}
	case pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_CODE:
		if strings.TrimSpace(req.GetInviteCode()) == "" {
			return errors.New("invite code gate requires a code")
		}
	case pb.AccessGateType_ACCESS_GATE_TYPE_DEVICE_TRUST:
		if req.GetDeviceTrust() == nil ||
			strings.TrimSpace(req.GetDeviceTrust().GetAttestationHandle()) == "" {
			return errors.New("device trust gate requires a native attestation handle")
		}
	case pb.AccessGateType_ACCESS_GATE_TYPE_TERMS_ACCEPTANCE,
		pb.AccessGateType_ACCESS_GATE_TYPE_CUSTOM:
		return validateGenericInput(gate.GetInputSchemaJson(), req.GetGeneric())
	default:
		return fmt.Errorf("access gate action type is not submittable: %s", action.GetType())
	}
	return nil
}

func validateGenericInput(rawSchema string, input *pb.AccessGateGenericInput) error {
	if input == nil {
		return errors.New("schema-bound gate requires generic scalar values")
	}
	var schema gateInputSchema
	if err := json.Unmarshal([]byte(rawSchema), &schema); err != nil {
		return errors.New("access gate input schema is invalid")
	}
	if len(schema.Fields) > maxGenericFieldCount || len(input.GetFields()) > maxGenericFieldCount {
		return errors.New("access gate field count exceeds the supported limit")
	}

	definitions := make(map[string]gateFieldSchema, len(schema.Fields))
	for _, field := range schema.Fields {
		field.Name = strings.TrimSpace(field.Name)
		field.Type = strings.ToLower(strings.TrimSpace(field.Type))
		if field.Name == "" || secretFieldName.MatchString(field.Name) {
			return errors.New("access gate schema contains a forbidden field")
		}
		if _, exists := definitions[field.Name]; exists {
			return errors.New("access gate schema contains a duplicate field")
		}
		definitions[field.Name] = field
	}

	seen := make(map[string]struct{}, len(input.GetFields()))
	for _, value := range input.GetFields() {
		name := strings.TrimSpace(value.GetFieldName())
		field, ok := definitions[name]
		if !ok {
			return fmt.Errorf("access gate submission contains undeclared field %q", name)
		}
		if _, duplicate := seen[name]; duplicate {
			return fmt.Errorf("access gate submission contains duplicate field %q", name)
		}
		seen[name] = struct{}{}
		if err := validateScalarValue(field, value); err != nil {
			return err
		}
	}
	for name, field := range definitions {
		if field.Required {
			if _, ok := seen[name]; !ok {
				return fmt.Errorf("access gate submission is missing required field %q", name)
			}
		}
	}
	return nil
}

func validateScalarValue(field gateFieldSchema, value *pb.AccessGateScalarValue) error {
	if value == nil || value.Value == nil {
		return fmt.Errorf("access gate field %q has no scalar value", field.Name)
	}
	switch field.Type {
	case "text", "string", "email", "select":
		stringValue, ok := value.Value.(*pb.AccessGateScalarValue_StringValue)
		if !ok || len(stringValue.StringValue) > maxGenericStringBytes {
			return fmt.Errorf("access gate field %q requires a bounded string", field.Name)
		}
		if field.Type == "select" && !schemaOptionContains(field.Options, stringValue.StringValue) {
			return fmt.Errorf("access gate field %q contains an unsupported option", field.Name)
		}
	case "checkbox", "boolean", "bool":
		if _, ok := value.Value.(*pb.AccessGateScalarValue_BoolValue); !ok {
			return fmt.Errorf("access gate field %q requires a boolean", field.Name)
		}
	case "integer":
		if _, ok := value.Value.(*pb.AccessGateScalarValue_IntegerValue); !ok {
			return fmt.Errorf("access gate field %q requires an integer", field.Name)
		}
	case "number":
		number, ok := value.Value.(*pb.AccessGateScalarValue_NumberValue)
		if !ok || math.IsNaN(number.NumberValue) || math.IsInf(number.NumberValue, 0) {
			return fmt.Errorf("access gate field %q requires a finite number", field.Name)
		}
	default:
		return fmt.Errorf("access gate field %q has unsupported type %q", field.Name, field.Type)
	}
	return nil
}

func schemaOptionContains(options []json.RawMessage, candidate string) bool {
	for _, raw := range options {
		var stringOption string
		if json.Unmarshal(raw, &stringOption) == nil && stringOption == candidate {
			return true
		}
		var objectOption struct {
			Value string `json:"value"`
		}
		if json.Unmarshal(raw, &objectOption) == nil && objectOption.Value == candidate {
			return true
		}
	}
	return false
}

func decisionRevision(ctx context.Context, attemptID string) uint64 {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return 0
	}
	var row dbmodel.AccessAttempt
	if err := rds.WithContext(ctx).Select("decision_revision").
		Where("id = ?", attemptID).First(&row).Error; err != nil {
		return 0
	}
	return row.DecisionRevision
}
