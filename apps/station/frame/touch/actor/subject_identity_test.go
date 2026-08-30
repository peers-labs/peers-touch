package actor

import (
	"context"
	"testing"
)

func TestResolveSubjectPTIDAcceptsCanonicalPTID(t *testing.T) {
	const ptid = "ptid:v1:actor:peers:p:alice:fingerprint"

	got, err := ResolveSubjectPTID(context.Background(), ptid)
	if err != nil {
		t.Fatalf("ResolveSubjectPTID() error = %v", err)
	}
	if got != ptid {
		t.Fatalf("ResolveSubjectPTID() = %q, want %q", got, ptid)
	}
}

func TestResolveSubjectPTIDRejectsNumericSubject(t *testing.T) {
	if _, err := ResolveSubjectPTID(context.Background(), "347760575104679938"); err == nil {
		t.Fatal("ResolveSubjectPTID() accepted numeric subject")
	}
}
