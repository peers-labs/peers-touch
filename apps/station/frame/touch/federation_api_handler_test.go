package touch

import (
	"testing"

	locatorpb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	"github.com/peers-labs/peers-touch/station/frame/touch/federation/resolver"
)

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
