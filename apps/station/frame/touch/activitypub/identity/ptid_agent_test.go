package identity

import "testing"

// PTID account letter "b" parses and validates for AGENT actors.
func TestAgentPTID(t *testing.T) {
	s := "ptid:v1:actor:peers:b:claude-code-notifier:abcdef0123456789"
	id, err := Parse(s)
	if err != nil {
		t.Fatalf("parse agent ptid: %v", err)
	}
	if id.Type != TypeAgent || string(id.Type) != "b" {
		t.Fatalf("type = %q, want b", id.Type)
	}
	if err := id.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if id.String() != s {
		t.Fatalf("round trip = %q, want %q", id.String(), s)
	}

	// An unknown letter still fails.
	if _, err := Parse("ptid:v1:actor:peers:x:someone:abcdef0123456789"); err == nil {
		t.Fatal("unknown account letter must be rejected")
	}
}
