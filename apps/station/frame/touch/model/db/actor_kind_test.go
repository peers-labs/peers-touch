package db

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func TestKindFromProtoDefaults(t *testing.T) {
	t.Parallel()
	if got := KindFromProto(model.ActorKind_ACTOR_KIND_UNSPECIFIED); got != "p" {
		t.Fatalf("UNSPECIFIED: got %q want p", got)
	}
	if got := KindFromProto(model.ActorKind_ACTOR_KIND_GROUP); got != "g" {
		t.Fatalf("GROUP: got %q want g", got)
	}
}

func TestActorKindFromShorthandRoundTrip(t *testing.T) {
	t.Parallel()
	k := ActorKindFromShorthand("p")
	if k != model.ActorKind_ACTOR_KIND_PERSON {
		t.Fatalf("p: got %v", k)
	}
	if KindFromProto(k) != "p" {
		t.Fatalf("roundtrip: got %q", KindFromProto(k))
	}
}
