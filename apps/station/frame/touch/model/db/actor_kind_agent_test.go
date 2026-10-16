package db

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// The "b" shorthand round-trips to AGENT and never collapses into Person.
func TestAgentKindShorthandRoundTrip(t *testing.T) {
	if got := KindFromProto(model.ActorKind_ACTOR_KIND_AGENT); got != "b" {
		t.Fatalf("KindFromProto(AGENT) = %q, want b", got)
	}
	if got := ActorKindFromShorthand("b"); got != model.ActorKind_ACTOR_KIND_AGENT {
		t.Fatalf("ActorKindFromShorthand(b) = %v, want AGENT", got)
	}
	// Unknown still maps to UNSPECIFIED; empty/legacy still maps Person.
	if got := ActorKindFromShorthand("z"); got != model.ActorKind_ACTOR_KIND_UNSPECIFIED {
		t.Fatalf("unknown shorthand = %v, want UNSPECIFIED", got)
	}
	if got := ActorKindFromShorthand(""); got != model.ActorKind_ACTOR_KIND_PERSON {
		t.Fatalf("empty shorthand = %v, want PERSON", got)
	}
}
