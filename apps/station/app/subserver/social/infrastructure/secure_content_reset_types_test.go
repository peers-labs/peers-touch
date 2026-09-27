package infrastructure

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

const wireDigestPlaceholder = "WIRE_DIGEST_PLACEHOLDER"

func TestAuditRequestPreservesWireTimestampForOwnerRevalidation(t *testing.T) {
	raw := []byte(`{"schema_version":1,"request_id":"audit-request","reset_id":"reset-id","reset_intent":"SCHEMA_ACTIVATION","plan_id":"SECURE-CONTENT-HARD-CUT-20260913","task_id":"W12A","declaration_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source_commit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","workspace_id":"9eb2cb904c9ae460","profile_id":"four","deployment_environment":"station-four","destructive_scope":"station-four-social-private","issued_at":"2026-09-20T16:28:09.000Z","expires_at":"2026-09-20T16:38:09.000Z","request_digest":"WIRE_DIGEST_PLACEHOLDER"}`)
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
	raw := []byte(`{"schema_version":1,"invocation_id":"reset-invocation","reset_id":"reset-id","reset_intent":"SCHEMA_ACTIVATION","reset_manifest_digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","plan_id":"SECURE-CONTENT-HARD-CUT-20260913","task_id":"W12A","declaration_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source_commit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","workspace_id":"9eb2cb904c9ae460","profile_id":"four","deployment_environment":"station-four","destructive_scope":"station-four-social-private","issued_at":"2026-09-20T16:28:09.000Z","expires_at":"2026-09-20T16:38:09.000Z","invocation_digest":"WIRE_DIGEST_PLACEHOLDER"}`)
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
