package federation

import (
	"testing"
	"time"

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

	validationSpec, ok := peerRouteSpecFor(
		PeerRouteKeyExchangeContentPreKeyValidate,
	)
	if !ok {
		t.Fatal("Content PreKey validation peer route is not registered")
	}
	if validationSpec.path !=
		"/federation/key-exchange/content-prekeys/validate" ||
		validationSpec.method != server.POST ||
		validationSpec.scope != KeyExchangeContentPreKeyValidateScope {
		t.Fatalf("Content PreKey validation peer route = %+v", validationSpec)
	}
	validationScope, err := scope.Get(KeyExchangeContentPreKeyValidateScope)
	if err != nil {
		t.Fatal(err)
	}
	expectedValidationClaims := map[string]bool{
		ClaimFederationID:            true,
		ClaimAuthorityPlanID:         true,
		ClaimPlanRequestSHA256:       true,
		ClaimCanonicalRequestSHA256:  true,
		ClaimCanonicalResponseSHA256: true,
		ClaimSourceStationPeerID:     true,
		ClaimTargetStationPeerID:     true,
	}
	if !validationScope.Policy.AudienceRequired ||
		len(validationScope.Policy.AllowedClaimKeys) !=
			len(expectedValidationClaims) {
		t.Fatalf(
			"Content PreKey validation peer scope = %+v",
			validationScope.Policy,
		)
	}
	for _, claim := range validationScope.Policy.AllowedClaimKeys {
		if !expectedValidationClaims[claim] {
			t.Fatalf("unexpected Content PreKey validation claim %q", claim)
		}
	}
}

func TestFederatedPrivateObjectRouteAndScopeAreCanonical(t *testing.T) {
	scope.ResetForTest()
	if err := RegisterPeerScopes(); err != nil {
		t.Fatal(err)
	}

	spec, ok := peerRouteSpecFor(PeerRouteSocialPrivateObjectRead)
	if !ok {
		t.Fatal("Social private-object peer route is not registered")
	}
	if spec.path !=
		SocialPrivateObjectReadRoute ||
		spec.method != server.POST ||
		spec.scope != SocialPrivateObjectReadScope {
		t.Fatalf("Social private-object peer route = %+v", spec)
	}

	registered, err := scope.Get(SocialPrivateObjectReadScope)
	if err != nil {
		t.Fatal(err)
	}
	expectedClaims := map[string]bool{
		ClaimFederationID:           true,
		ClaimSourceStationPeerID:    true,
		ClaimTargetStationPeerID:    true,
		ClaimActorPTID:              true,
		ClaimDeviceID:               true,
		ClaimObjectID:               true,
		ClaimCanonicalRequestSHA256: true,
	}
	if registered.Policy.TTLMax != time.Minute ||
		!registered.Policy.AudienceRequired ||
		len(registered.Policy.AllowedClaimKeys) != len(expectedClaims) {
		t.Fatalf(
			"Social private-object peer scope = %+v",
			registered.Policy,
		)
	}
	for _, claim := range registered.Policy.AllowedClaimKeys {
		if !expectedClaims[claim] {
			t.Fatalf("unexpected Social private-object peer claim %q", claim)
		}
	}
}
