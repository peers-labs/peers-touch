package federation

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestFederatedContentPreKeyRouteAndScopeAreCanonical(t *testing.T) {
	scope.ResetForTest()
	if err := RegisterPeerScopes(); err != nil {
		t.Fatal(err)
	}
	spec, ok := peerRouteSpecFor(PeerRouteKeyExchangeContentPreKeyClaim)
	if !ok {
		t.Fatal("Content PreKey peer route is not registered")
	}
	if spec.path != "/federation/key-exchange/content-prekeys/claim" ||
		spec.method != server.POST ||
		spec.scope != KeyExchangeContentPreKeyClaimScope {
		t.Fatalf("Content PreKey peer route = %+v", spec)
	}
	registered, err := scope.Get(KeyExchangeContentPreKeyClaimScope)
	if err != nil {
		t.Fatal(err)
	}
	expectedClaims := map[string]bool{
		ClaimFederationID:           true,
		ClaimAuthorityPlanID:        true,
		ClaimPlanRequestSHA256:      true,
		ClaimCanonicalRequestSHA256: true,
		ClaimSourceStationPeerID:    true,
		ClaimTargetStationPeerID:    true,
	}
	if !registered.Policy.AudienceRequired ||
		len(registered.Policy.AllowedClaimKeys) != len(expectedClaims) {
		t.Fatalf("Content PreKey peer scope = %+v", registered.Policy)
	}
	for _, claim := range registered.Policy.AllowedClaimKeys {
		if !expectedClaims[claim] {
			t.Fatalf("unexpected Content PreKey peer claim %q", claim)
		}
	}
}
