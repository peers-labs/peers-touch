package accessgate

import (
	"context"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate/gatekeeper"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	"google.golang.org/protobuf/proto"
)

func TestValidateGateOrder(t *testing.T) {
	capability := pb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY
	login := pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN
	allowlist := pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_ALLOWLIST
	inviteCode := pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_CODE

	tests := []struct {
		name    string
		mode    string
		order   []pb.AccessGateType
		wantErr string
	}{
		{
			name:  "empty order uses safe default",
			mode:  policyModeClosed,
			order: nil,
		},
		{
			name:  "open policy permits required prefix only",
			mode:  policyModeOpen,
			order: []pb.AccessGateType{capability, login},
		},
		{
			name:  "invite-only policy permits invite code enforcement",
			mode:  policyModeInviteOnly,
			order: []pb.AccessGateType{capability, login, inviteCode},
		},
		{
			name:  "fixed-users policy requires allowlist",
			mode:  policyModeFixedUsers,
			order: []pb.AccessGateType{capability, login, allowlist},
		},
		{
			name:    "rejects unregistered gate",
			mode:    policyModeOpen,
			order:   []pb.AccessGateType{capability, login, pb.AccessGateType_ACCESS_GATE_TYPE_DEVICE_TRUST},
			wantErr: "unsupported access gate type",
		},
		{
			name:    "rejects unknown gate enum",
			mode:    policyModeOpen,
			order:   []pb.AccessGateType{capability, login, pb.AccessGateType(999)},
			wantErr: "unsupported access gate type",
		},
		{
			name:    "rejects unspecified gate",
			mode:    policyModeOpen,
			order:   []pb.AccessGateType{capability, login, pb.AccessGateType_ACCESS_GATE_TYPE_UNSPECIFIED},
			wantErr: "unsupported access gate type",
		},
		{
			name:    "rejects duplicate gate",
			mode:    policyModeOpen,
			order:   []pb.AccessGateType{capability, login, login},
			wantErr: "duplicate access gate type",
		},
		{
			name:    "rejects missing capability prefix",
			mode:    policyModeOpen,
			order:   []pb.AccessGateType{login, allowlist},
			wantErr: "must start with STATION_CAPABILITY followed by AUTH_LOGIN",
		},
		{
			name:    "rejects gate before login",
			mode:    policyModeInviteOnly,
			order:   []pb.AccessGateType{capability, inviteCode, login},
			wantErr: "must start with STATION_CAPABILITY followed by AUTH_LOGIN",
		},
		{
			name:    "rejects invite-only bypass",
			mode:    policyModeInviteOnly,
			order:   []pb.AccessGateType{capability, login},
			wantErr: "requires INVITE_ALLOWLIST or INVITE_CODE",
		},
		{
			name:    "rejects fixed-users bypass",
			mode:    policyModeFixedUsers,
			order:   []pb.AccessGateType{capability, login, inviteCode},
			wantErr: "requires INVITE_ALLOWLIST",
		},
		{
			name:    "rejects closed-policy bypass",
			mode:    policyModeClosed,
			order:   []pb.AccessGateType{capability, login, inviteCode},
			wantErr: "requires INVITE_ALLOWLIST",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateGateOrder(tt.mode, tt.order)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("validateGateOrder() error = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("validateGateOrder() error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestUpdatePolicyRejectsUnsafeOrderBeforePersistence(t *testing.T) {
	_, err := UpdatePolicy(context.Background(), PolicyInput{
		Mode: policyModeOpen,
		EnabledGates: []pb.AccessGateType{
			pb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY,
			pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
			pb.AccessGateType_ACCESS_GATE_TYPE_DEVICE_TRUST,
		},
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported access gate type") {
		t.Fatalf("UpdatePolicy() error = %v, want unsupported gate rejection", err)
	}
}

func TestDecodeEnabledGatesPreservesInvalidEntriesForFailClosedValidation(t *testing.T) {
	decoded := decodeEnabledGates("1,not-a-gate,2,999")
	if len(decoded) != 4 {
		t.Fatalf("decoded gate count = %d, want 4", len(decoded))
	}
	if decoded[1] != invalidAccessGateType {
		t.Fatalf("malformed gate = %d, want invalid sentinel %d", decoded[1], invalidAccessGateType)
	}
	if decoded[3] != pb.AccessGateType(999) {
		t.Fatalf("unknown numeric gate = %d, want 999", decoded[3])
	}
	if err := validateGateOrder(policyModeOpen, decoded); err == nil {
		t.Fatal("invalid persisted gate order unexpectedly passed validation")
	}
}

func TestValidateSubmissionRejectsInvalidBindingBeforeAttemptLookup(t *testing.T) {
	tests := []struct {
		name    string
		req     *pb.SubmitAccessGateRequest
		wantErr string
	}{
		{
			name: "missing attempt id",
			req: &pb.SubmitAccessGateRequest{
				GateId: gateIDLogin,
				Type:   pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
			},
			wantErr: "access attempt id is required",
		},
		{
			name: "missing gate id",
			req: &pb.SubmitAccessGateRequest{
				AttemptId: "attempt-1",
				Type:      pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
			},
			wantErr: "access gate id is required",
		},
		{
			name: "unsupported gate type",
			req: &pb.SubmitAccessGateRequest{
				AttemptId: "attempt-1",
				GateId:    "device.trust",
				Type:      pb.AccessGateType_ACCESS_GATE_TYPE_DEVICE_TRUST,
			},
			wantErr: "unsupported access gate type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := validateSubmission(context.Background(), tt.req)
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("validateSubmission() error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestValidateSubmissionDecisionRequiresExactCurrentGateBinding(t *testing.T) {
	currentDecision := func() *pb.AccessDecision {
		return &pb.AccessDecision{
			State:         pb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED,
			AttemptId:     "attempt-1",
			CurrentGateId: gateIDLogin,
			Gates: []*pb.AccessGate{
				{
					GateId: gateIDCapability,
					Type:   pb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY,
					State:  pb.AccessGateState_ACCESS_GATE_STATE_PASSED,
				},
				bindPrimaryAction(&pb.AccessGate{
					GateId:       gateIDLogin,
					Type:         pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
					State:        pb.AccessGateState_ACCESS_GATE_STATE_ACTION_REQUIRED,
					SubmitAction: "submit_login",
				}, "auth.password"),
			},
		}
	}

	tests := []struct {
		name      string
		decision  *pb.AccessDecision
		attemptID string
		gateID    string
		gateType  pb.AccessGateType
		wantErr   string
	}{
		{
			name:      "accepts exact current binding",
			decision:  currentDecision(),
			attemptID: "attempt-1",
			gateID:    gateIDLogin,
			gateType:  pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
		},
		{
			name:      "rejects different attempt",
			decision:  currentDecision(),
			attemptID: "attempt-2",
			gateID:    gateIDLogin,
			gateType:  pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
			wantErr:   "attempt does not match",
		},
		{
			name:      "rejects stale gate id",
			decision:  currentDecision(),
			attemptID: "attempt-1",
			gateID:    gateIDInviteCode,
			gateType:  pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
			wantErr:   "does not match the current gate",
		},
		{
			name:      "rejects mismatched gate type",
			decision:  currentDecision(),
			attemptID: "attempt-1",
			gateID:    gateIDLogin,
			gateType:  pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_CODE,
			wantErr:   "type does not match",
		},
		{
			name: "rejects terminal decision",
			decision: &pb.AccessDecision{
				State:     pb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED,
				AttemptId: "attempt-1",
			},
			attemptID: "attempt-1",
			gateID:    gateIDLogin,
			gateType:  pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
			wantErr:   "does not have an actionable current gate",
		},
		{
			name: "rejects missing gate descriptor",
			decision: &pb.AccessDecision{
				State:         pb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED,
				AttemptId:     "attempt-1",
				CurrentGateId: gateIDLogin,
			},
			attemptID: "attempt-1",
			gateID:    gateIDLogin,
			gateType:  pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
			wantErr:   "descriptor is unavailable",
		},
		{
			name:      "rejects unregistered submission type",
			decision:  currentDecision(),
			attemptID: "attempt-1",
			gateID:    gateIDLogin,
			gateType:  pb.AccessGateType_ACCESS_GATE_TYPE_DEVICE_TRUST,
			wantErr:   "unsupported access gate type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			currentGate := tt.decision.GetGates()
			actionID := "auth.password"
			schemaRevision := accessGateSchemaRevision
			schemaDigest := ""
			if len(currentGate) > 0 {
				last := currentGate[len(currentGate)-1]
				actionID = last.GetActionId()
				schemaRevision = last.GetSchemaRevision()
				schemaDigest = last.GetSchemaDigest()
			}
			_, _, err := validateSubmissionDecision(tt.decision, &pb.SubmitAccessGateRequest{
				AttemptId:      tt.attemptID,
				GateId:         tt.gateID,
				Type:           tt.gateType,
				ActionId:       actionID,
				SchemaRevision: schemaRevision,
				SchemaDigest:   schemaDigest,
			})
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("validateSubmissionDecision() error = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("validateSubmissionDecision() error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestSchemaBoundDescriptorRejectsStaleRevisionAndDigest(t *testing.T) {
	gate := bindPrimaryAction(&pb.AccessGate{
		GateId:       gateIDLogin,
		Type:         pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
		State:        pb.AccessGateState_ACCESS_GATE_STATE_ACTION_REQUIRED,
		SubmitAction: "submit_login",
	}, "auth.password")
	decision := &pb.AccessDecision{
		State:         pb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED,
		AttemptId:     "attempt-1",
		CurrentGateId: gateIDLogin,
		Gates:         []*pb.AccessGate{gate},
	}
	base := &pb.SubmitAccessGateRequest{
		AttemptId:      "attempt-1",
		GateId:         gateIDLogin,
		Type:           pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
		ActionId:       gate.GetActionId(),
		SchemaRevision: gate.GetSchemaRevision(),
		SchemaDigest:   gate.GetSchemaDigest(),
	}

	if _, _, err := validateSubmissionDecision(decision, base); err != nil {
		t.Fatalf("exact descriptor rejected: %v", err)
	}
	staleRevision := proto.Clone(base).(*pb.SubmitAccessGateRequest)
	staleRevision.SchemaRevision++
	if _, _, err := validateSubmissionDecision(decision, staleRevision); err == nil {
		t.Fatal("stale schema revision unexpectedly accepted")
	}
	staleDigest := proto.Clone(base).(*pb.SubmitAccessGateRequest)
	staleDigest.SchemaDigest = strings.Repeat("0", 64)
	if _, _, err := validateSubmissionDecision(decision, staleDigest); err == nil {
		t.Fatal("stale schema digest unexpectedly accepted")
	}
}

func TestGenericScalarValidationRejectsSecretsUnknownFieldsAndWrongTypes(t *testing.T) {
	validSchema := `{"fields":[{"name":"accepted","type":"checkbox","required":true},{"name":"region","type":"select","options":["us",{"value":"eu"}]}]}`
	valid := &pb.AccessGateGenericInput{Fields: []*pb.AccessGateScalarValue{
		{
			FieldName: "accepted",
			Value:     &pb.AccessGateScalarValue_BoolValue{BoolValue: true},
		},
		{
			FieldName: "region",
			Value:     &pb.AccessGateScalarValue_StringValue{StringValue: "eu"},
		},
	}}
	if err := validateGenericInput(validSchema, valid); err != nil {
		t.Fatalf("valid generic input rejected: %v", err)
	}

	tests := []struct {
		name   string
		schema string
		input  *pb.AccessGateGenericInput
	}{
		{
			name:   "secret field",
			schema: `{"fields":[{"name":"access_token","type":"text"}]}`,
			input:  &pb.AccessGateGenericInput{},
		},
		{
			name:   "unknown field",
			schema: validSchema,
			input: &pb.AccessGateGenericInput{Fields: []*pb.AccessGateScalarValue{{
				FieldName: "other",
				Value:     &pb.AccessGateScalarValue_StringValue{StringValue: "value"},
			}}},
		},
		{
			name:   "wrong scalar kind",
			schema: validSchema,
			input: &pb.AccessGateGenericInput{Fields: []*pb.AccessGateScalarValue{{
				FieldName: "accepted",
				Value:     &pb.AccessGateScalarValue_StringValue{StringValue: "true"},
			}}},
		},
		{
			name:   "unsupported select option",
			schema: validSchema,
			input: &pb.AccessGateGenericInput{Fields: []*pb.AccessGateScalarValue{
				{
					FieldName: "accepted",
					Value:     &pb.AccessGateScalarValue_BoolValue{BoolValue: true},
				},
				{
					FieldName: "region",
					Value:     &pb.AccessGateScalarValue_StringValue{StringValue: "moon"},
				},
			}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateGenericInput(tt.schema, tt.input); err == nil {
				t.Fatal("invalid generic input unexpectedly accepted")
			}
		})
	}
}

func TestTermsGateAdvertisesCanonicalSchemaBinding(t *testing.T) {
	gate := (termsAcceptanceGatekeeper{}).Evaluate(
		context.Background(),
		&gatekeeper.EvalContext{CompletedActions: map[string]bool{}},
	)
	if gate.GetActionId() != "terms.accept" ||
		gate.GetSchemaRevision() != accessGateSchemaRevision ||
		len(gate.GetSchemaDigest()) != 64 {
		t.Fatalf("terms descriptor is incomplete: %#v", gate)
	}
	if gate.GetState() != pb.AccessGateState_ACCESS_GATE_STATE_ACTION_REQUIRED {
		t.Fatalf("terms state = %s, want action required", gate.GetState())
	}
}

func TestSubmissionPayloadHashUsesStationKeyForExactCredentialReplay(t *testing.T) {
	key := []byte("station-auth-secret-for-submission-test")
	login := &pb.SubmitAccessGateRequest{
		AttemptId:      "attempt-1",
		GateId:         gateIDLogin,
		Type:           pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
		ActionId:       "auth.password",
		SchemaRevision: 1,
		SchemaDigest:   strings.Repeat("a", 64),
		SubmissionId:   "submission-1",
		ActionInput: &pb.SubmitAccessGateRequest_Login{
			Login: &model.LoginRequest{
				Email:      "alice@example.test",
				Password:   "first-password",
				DeviceType: "mobile",
			},
		},
	}
	firstHash, err := submissionPayloadHashWithKey(login, key)
	if err != nil {
		t.Fatalf("hash login submission: %v", err)
	}
	changedPassword := proto.Clone(login).(*pb.SubmitAccessGateRequest)
	changedPassword.GetLogin().Password = "second-password"
	secondHash, err := submissionPayloadHashWithKey(changedPassword, key)
	if err != nil {
		t.Fatalf("hash changed password submission: %v", err)
	}
	if firstHash == secondHash {
		t.Fatal("changed password did not affect exact submission fingerprint")
	}

	changedEmail := proto.Clone(login).(*pb.SubmitAccessGateRequest)
	changedEmail.GetLogin().Email = "bob@example.test"
	changedEmailHash, err := submissionPayloadHashWithKey(changedEmail, key)
	if err != nil {
		t.Fatalf("hash changed email submission: %v", err)
	}
	if firstHash == changedEmailHash {
		t.Fatal("non-secret action identity did not affect submission fingerprint")
	}

	invite := proto.Clone(login).(*pb.SubmitAccessGateRequest)
	invite.Type = pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_CODE
	invite.GateId = gateIDInviteCode
	invite.ActionId = "invite.redeem"
	invite.ActionInput = &pb.SubmitAccessGateRequest_InviteCode{
		InviteCode: "FIRST-CODE",
	}
	firstInviteHash, err := submissionPayloadHashWithKey(invite, key)
	if err != nil {
		t.Fatalf("hash invite submission: %v", err)
	}
	changedInvite := proto.Clone(invite).(*pb.SubmitAccessGateRequest)
	changedInvite.ActionInput = &pb.SubmitAccessGateRequest_InviteCode{
		InviteCode: "SECOND-CODE",
	}
	secondInviteHash, err := submissionPayloadHashWithKey(changedInvite, key)
	if err != nil {
		t.Fatalf("hash changed invite submission: %v", err)
	}
	if firstInviteHash == secondInviteHash {
		t.Fatal("changed invite credential did not affect exact submission fingerprint")
	}

	otherKeyHash, err := submissionPayloadHashWithKey(
		login,
		[]byte("different-station-auth-secret"),
	)
	if err != nil {
		t.Fatalf("hash login submission with other key: %v", err)
	}
	if firstHash == otherKeyHash {
		t.Fatal("Station key did not affect submission fingerprint")
	}
}
