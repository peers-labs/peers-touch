package application_test

import (
	"testing"

	"github.com/libp2p/go-libp2p/core/peer"
	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"github.com/stretchr/testify/require"
)

func TestCreateReturnsCompactBootstrapReference(t *testing.T) {
	fixture := newFixture(t)
	response := fixture.create(t)
	require.NotNil(t, response.Locator)

	signedOffer, err := link.Encode(response.Offer)
	require.NoError(t, err)
	statement := &pb.DeviceLinkOfferStatement{}
	require.NoError(t, link.Decode(response.Offer.GetStatementBytes(), statement))
	stationID, err := peer.Decode(fixture.network.station)
	require.NoError(t, err)
	stationPublic, err := stationID.ExtractPublicKey()
	require.NoError(t, err)
	stationRaw, err := stationPublic.Raw()
	require.NoError(t, err)

	locator := response.Locator
	require.Equal(t, uint32(1), locator.GetProtocolVersion())
	require.Equal(t, link.Digest(signedOffer), locator.GetOfferDigest())
	require.Equal(t, statement.GetExpiresAtUnixMs(), locator.GetExpiresAtUnixMs())
	require.Equal(t, stationRaw, locator.GetStationRootEd25519())
	require.Len(t, locator.GetBootstrapSecret(), 32)
	require.Equal(t, "https://station.example.test", locator.GetCanonicalDiscoveryOrigin())
	require.Equal(t, peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION, locator.GetEndpointRole())
	require.Empty(t, locator.GetRelayEd25519())
	require.Nil(t, locator.GetEndpointTlsTrust())

	lookup, unseal, err := link.BootstrapKeys(locator)
	require.NoError(t, err)
	require.Len(t, lookup, 32)
	require.Len(t, unseal, 32)
	require.NotEqual(t, lookup, unseal)
}
