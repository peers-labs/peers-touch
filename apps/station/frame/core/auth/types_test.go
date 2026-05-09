package auth

import (
	"context"
	"testing"
)

type testSessionValidator struct {
	valid     bool
	reason    string
	sessionID string
}

func (v *testSessionValidator) CheckSessionValid(_ context.Context, sessionID string) (bool, string) {
	v.sessionID = sessionID
	return v.valid, v.reason
}

func TestCheckSubjectSessionValidUsesGlobalValidator(t *testing.T) {
	t.Cleanup(func() { SetGlobalSessionValidator(nil) })

	validator := &testSessionValidator{valid: false, reason: "kicked"}
	SetGlobalSessionValidator(validator)

	valid, reason := CheckSubjectSessionValid(context.Background(), &Subject{
		ID:        "actor-1",
		SessionID: "session-1",
	})
	if valid {
		t.Fatal("expected revoked subject to be invalid")
	}
	if reason != "kicked" {
		t.Fatalf("expected reason kicked, got %q", reason)
	}
	if validator.sessionID != "session-1" {
		t.Fatalf("expected validator to receive session-1, got %q", validator.sessionID)
	}
}

func TestCheckSubjectSessionValidSkipsMissingSession(t *testing.T) {
	t.Cleanup(func() { SetGlobalSessionValidator(nil) })

	validator := &testSessionValidator{valid: false, reason: "kicked"}
	SetGlobalSessionValidator(validator)

	valid, reason := CheckSubjectSessionValid(context.Background(), &Subject{ID: "actor-1"})
	if !valid {
		t.Fatalf("expected subject without session id to remain valid, reason=%q", reason)
	}
	if validator.sessionID != "" {
		t.Fatalf("expected validator not to run, got session %q", validator.sessionID)
	}
}
