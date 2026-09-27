package touch

import (
	"testing"

	locatorpb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	"github.com/peers-labs/peers-touch/station/frame/touch/federation/resolver"
)

func TestSelfViewUsesCanonicalPersistedHandle(t *testing.T) {
	view := selfViewFromSnapshot(&actor.FederationSelfSnapshot{
		ActorPTID:       "ptid:v1:actor:peers:p:alice:fingerprint",
		ActorKind:       "p",
		FederatedHandle: "@Alice@Home.Example",
	})

	if got, want := view.GetActorRef().GetAcct(), "alice@home.example"; got != want {
		t.Fatalf("self ActorRef acct = %q, want %q", got, want)
	}
}

func TestResolveViewUsesCanonicalWireHandle(t *testing.T) {
	for _, handle := range []string{
		"alice@station.example",
		"@alice@station.example",
	} {
		view := resolveViewFromResolved(&resolver.Resolved{
			Envelope: &profilepb.ActorProfileEnvelope{
				FederatedHandle: handle,
			},
			Locator: &locatorpb.ActorLocatorRecord{Seq: 74},
		})
		if got, want := view.GetFederatedHandle(), "@alice@station.example"; got != want {
			t.Fatalf("resolve handle = %q, want %q", got, want)
		}
	}
}
