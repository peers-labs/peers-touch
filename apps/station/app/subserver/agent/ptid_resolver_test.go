package agent

import (
	"context"
	"testing"
)

func TestActorPTIDResolverRejectsNonNumeric(t *testing.T) {
	resolver := actorPTIDResolverAdapter{}
	_, err := resolver.ResolvePTID(context.Background(), "not-a-number")
	if err == nil {
		t.Fatal("expected error for non-numeric actor ID")
	}
}

func TestActorPTIDResolverPassesThroughPTID(t *testing.T) {
	// The caller (proof service) already skips resolution for ptid: prefix,
	// so the resolver itself should only receive numeric IDs.
	// This test documents the contract: non-numeric → error.
	resolver := actorPTIDResolverAdapter{}
	_, err := resolver.ResolvePTID(context.Background(), "ptid:v1:actor:peers:p:alice:abc")
	if err == nil {
		t.Fatal("expected error for non-numeric input (PTID should be filtered by caller)")
	}
}
