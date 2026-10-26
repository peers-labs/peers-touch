package infrastructure

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

const wireDigestPlaceholder = "WIRE_DIGEST_PLACEHOLDER"

func TestAuditRequestPreservesWireTimestampForOwnerRevalidation(t *testing.T) {
	raw := []byte(`{"schema_version":1,"request_id":"audit-request","reset_id":"reset-id","reset_intent":"SCHEMA_ACTIVATION","plan_id":"SECURE-CONTENT-HARD-CUT-20260913","task_id":"W12D","declaration_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source_commit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","workspace_id":"9eb2cb904c9ae460","profile_id":"four","deployment_environment":"station-four","destructive_scope":"station-four-social-private","issued_at":"2026-09-20T16:28:09.000Z","expires_at":"2026-09-20T16:38:09.000Z","request_digest":"WIRE_DIGEST_PLACEHOLDER"}`)
	raw = sealWireDigest(t, raw, "request_digest")

	var request SecureContentResetAuditRequestV1
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	binding := ResetInvocationBinding{
		SourceCommit:          request.SourceCommit,
		WorkspaceID:           request.WorkspaceID,
		ProfileID:             request.ProfileID,
		DeploymentEnvironment: request.DeploymentEnvironment,
		DestructiveScope:      request.DestructiveScope,
		DeclarationDigest:     request.DeclarationDigest,
	}
	if err := ValidateAuditRequest(
		request,
		binding,
		time.Date(2026, 9, 20, 16, 29, 0, 0, time.UTC),
		nil,
	); err != nil {
		t.Fatalf("revalidate decoded audit request: %v", err)
	}
}

func TestResetInvocationPreservesWireTimestampForOwnerRevalidation(t *testing.T) {
	raw := []byte(`{"schema_version":1,"invocation_id":"reset-invocation","reset_id":"reset-id","reset_intent":"SCHEMA_ACTIVATION","reset_manifest_digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","plan_id":"SECURE-CONTENT-HARD-CUT-20260913","task_id":"W12D","declaration_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source_commit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","workspace_id":"9eb2cb904c9ae460","profile_id":"four","deployment_environment":"station-four","destructive_scope":"station-four-social-private","issued_at":"2026-09-20T16:28:09.000Z","expires_at":"2026-09-20T16:38:09.000Z","invocation_digest":"WIRE_DIGEST_PLACEHOLDER"}`)
	raw = sealWireDigest(t, raw, "invocation_digest")

	var invocation SecureContentResetInvocationV1
	if err := json.Unmarshal(raw, &invocation); err != nil {
		t.Fatal(err)
	}
	binding := ResetInvocationBinding{
		SourceCommit:          invocation.SourceCommit,
		WorkspaceID:           invocation.WorkspaceID,
		ProfileID:             invocation.ProfileID,
		DeploymentEnvironment: invocation.DeploymentEnvironment,
		DestructiveScope:      invocation.DestructiveScope,
		DeclarationDigest:     invocation.DeclarationDigest,
	}
	if err := ValidateResetInvocation(
		invocation,
		binding,
		time.Date(2026, 9, 20, 16, 29, 0, 0, time.UTC),
		nil,
	); err != nil {
		t.Fatalf("revalidate decoded reset invocation: %v", err)
	}
}

func TestResetTaskAllowlistMatchesIntentAndProfile(t *testing.T) {
	now := time.Date(2026, 9, 26, 4, 0, 0, 0, time.UTC)
	tests := []struct {
		name      string
		planID    string
		intent    ResetIntent
		profileID string
		taskID    string
		wantError bool
	}{
		{"activation four", SecureContentResetPlanID, ResetIntentSchemaActivation, "four", "W12D", false},
		{"activation fiveArm", SecureContentResetPlanID, ResetIntentSchemaActivation, "fiveArm", "W12D", false},
		{"stale activation four", SecureContentResetPlanID, ResetIntentSchemaActivation, "four", "W12A", true},
		{"stale activation fiveArm", SecureContentResetPlanID, ResetIntentSchemaActivation, "fiveArm", "W12A", true},
		{"final four", SecureContentResetPlanID, ResetIntentFinalCut, "four", "W12", false},
		{"final fiveArm", SecureContentResetPlanID, ResetIntentFinalCut, "fiveArm", "W12", false},
		{"wrong final four", SecureContentResetPlanID, ResetIntentFinalCut, "four", "W12D", true},
		{"wrong final fiveArm", SecureContentResetPlanID, ResetIntentFinalCut, "fiveArm", "W12D", true},
		{"cross-station activation disposable", CrossStationSocialResetPlanID, ResetIntentSchemaActivation, "chat-native-disposable", CrossStationSocialActivationTask, false},
		{"cross-station activation fiveArm", CrossStationSocialResetPlanID, ResetIntentSchemaActivation, "fiveArm", CrossStationSocialActivationTask, false},
		{"cross-station legacy four denied", CrossStationSocialResetPlanID, ResetIntentSchemaActivation, "four", CrossStationSocialActivationTask, true},
		{"cross-station final cut denied", CrossStationSocialResetPlanID, ResetIntentFinalCut, "four", "W12", true},
		{"unknown plan denied", "OTHER-PLAN", ResetIntentSchemaActivation, "four", CrossStationSocialActivationTask, true},
		{"planless three", "", ResetIntentSchemaActivation, "three", "social-search-suite", false},
		{"planless four", "", ResetIntentSchemaActivation, "four", "social-search-suite", false},
		{"planless final cut denied", "", ResetIntentFinalCut, "three", "social-search-suite", true},
		{"planless empty audit task denied", "", ResetIntentSchemaActivation, "three", "", true},
		{"planless unknown profile denied", "", ResetIntentSchemaActivation, "unknown", "social-search-suite", true},
		{"planless stable denied", "", ResetIntentSchemaActivation, "corpstable", "social-search-suite", true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			deployment := "station-four"
			scope := "station-four-social-private"
			if test.profileID == "three" {
				deployment = "station-three"
				scope = "station-three-social-private"
			} else if test.profileID == "chat-native-disposable" {
				deployment = "chat-native-disposable-station"
				scope = "chat-native-disposable-social-private"
			} else if test.profileID == "fiveArm" {
				deployment = "station-five-arm"
				scope = "station-five-arm-social-private"
			}
			request := SecureContentResetAuditRequestV1{
				SchemaVersion:         SecureContentResetSchemaVersion,
				RequestID:             "audit-task-allowlist",
				ResetID:               "reset-task-allowlist",
				ResetIntent:           test.intent,
				PlanID:                test.planID,
				TaskID:                test.taskID,
				DeclarationDigest:     strings.Repeat("a", 64),
				SourceCommit:          strings.Repeat("b", 40),
				WorkspaceID:           "9eb2cb904c9ae460",
				ProfileID:             test.profileID,
				DeploymentEnvironment: deployment,
				DestructiveScope:      scope,
				IssuedAt:              now,
				ExpiresAt:             now.Add(10 * time.Minute),
			}
			var err error
			request.RequestDigest, err = request.CalculatedDigest()
			if err != nil {
				t.Fatal(err)
			}
			binding := ResetInvocationBinding{
				SourceCommit:          request.SourceCommit,
				WorkspaceID:           request.WorkspaceID,
				ProfileID:             request.ProfileID,
				DeploymentEnvironment: request.DeploymentEnvironment,
				DestructiveScope:      request.DestructiveScope,
				DeclarationDigest:     request.DeclarationDigest,
			}

			err = ValidateAuditRequest(request, binding, now, nil)
			if test.wantError && err == nil {
				t.Fatal("expected task allowlist rejection")
			}
			if !test.wantError && err != nil {
				t.Fatalf("expected task allowlist acceptance: %v", err)
			}
		})
	}
}

func TestPlanlessResetRejectsProcessBindingDrift(t *testing.T) {
	now := time.Now().UTC()
	invocation := SecureContentResetInvocationV1{
		SchemaVersion: SecureContentResetSchemaVersion,
		InvocationID:  "invocation-runtime", ResetID: "reset-runtime",
		ResetIntent:         ResetIntentSchemaActivation,
		ResetManifestDigest: strings.Repeat("c", 64),
		TaskID:              "social-search-suite", DeclarationDigest: strings.Repeat("a", 64),
		SourceCommit: strings.Repeat("b", 40), WorkspaceID: "workspace-runtime",
		ProfileID: "three", DeploymentEnvironment: "station-three",
		DestructiveScope: "station-three-social-private",
		IssuedAt:         now, ExpiresAt: now.Add(5 * time.Minute),
	}
	var err error
	invocation.InvocationDigest, err = invocation.CalculatedDigest()
	if err != nil {
		t.Fatal(err)
	}
	binding := ResetInvocationBinding{
		SourceCommit: invocation.SourceCommit, WorkspaceID: invocation.WorkspaceID,
		ProfileID: invocation.ProfileID, DeploymentEnvironment: invocation.DeploymentEnvironment,
		DestructiveScope: invocation.DestructiveScope, DeclarationDigest: invocation.DeclarationDigest,
	}
	if err := ValidateResetInvocation(invocation, binding, now, nil); err != nil {
		t.Fatalf("exact planless binding rejected: %v", err)
	}
	for name, mutate := range map[string]func(*ResetInvocationBinding){
		"source":      func(b *ResetInvocationBinding) { b.SourceCommit = strings.Repeat("d", 40) },
		"workspace":   func(b *ResetInvocationBinding) { b.WorkspaceID = "another-workspace" },
		"profile":     func(b *ResetInvocationBinding) { b.ProfileID = "four" },
		"deployment":  func(b *ResetInvocationBinding) { b.DeploymentEnvironment = "station-four" },
		"scope":       func(b *ResetInvocationBinding) { b.DestructiveScope = "station-four-social-private" },
		"declaration": func(b *ResetInvocationBinding) { b.DeclarationDigest = strings.Repeat("d", 64) },
	} {
		t.Run(name, func(t *testing.T) {
			drifted := binding
			mutate(&drifted)
			if err := ValidateResetInvocation(invocation, drifted, now, nil); err == nil {
				t.Fatal("planless reset accepted process binding drift")
			}
		})
	}
}

func sealWireDigest(t *testing.T, raw []byte, field string) []byte {
	t.Helper()
	digest, err := canonicalSHA256WithoutFieldFromRaw(raw, field)
	if err != nil {
		t.Fatal(err)
	}
	return []byte(strings.ReplaceAll(
		string(raw),
		wireDigestPlaceholder,
		digest,
	))
}
