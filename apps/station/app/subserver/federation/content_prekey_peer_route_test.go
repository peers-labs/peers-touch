package federation

import (
	"testing"

	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
)

func TestFederatedContentPreKeyPeerEndpointIsOwnedByFederation(t *testing.T) {
	handler, err := resolveFederationPeerEndpoint(
		federationruntime.PeerRouteKeyExchangeContentPreKeyClaim,
	)
	if err != nil {
		t.Fatal(err)
	}
	if handler == nil {
		t.Fatal("Content PreKey peer endpoint resolver returned nil")
	}
}
