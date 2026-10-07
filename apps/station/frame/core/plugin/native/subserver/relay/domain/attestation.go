package domain

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

var ErrRouteAttestationInvalid = errors.New(
	"Station route attestation is invalid",
)

func VerifyStationRouteAttestation(
	attestation *peerpb.StationRouteAttestation,
	relayPeerID string,
	now time.Time,
) (*peerpb.StationRouteStatement, error) {
	if attestation == nil {
		return nil, ErrRouteAttestationInvalid
	}
	statement := &peerpb.StationRouteStatement{}
	if err := proto.Unmarshal(attestation.GetStatementBytes(), statement); err != nil {
		return nil, ErrRouteAttestationInvalid
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(statement)
	if err != nil || !bytes.Equal(canonical, attestation.GetStatementBytes()) {
		return nil, ErrRouteAttestationInvalid
	}
	issuedAt := time.UnixMilli(statement.GetIssuedAtUnixMs()).UTC()
	expiresAt := time.UnixMilli(statement.GetExpiresAtUnixMs()).UTC()
	if statement.GetStationPeerId() == "" ||
		statement.GetRouteId() == "" ||
		statement.GetRouteGeneration() == 0 ||
		len(statement.GetInnerTlsSpkiSha256()) != sha256.Size ||
		len(statement.GetCapabilitiesDigest()) != sha256.Size ||
		statement.GetRelayPeerId() != relayPeerID ||
		(statement.GetVisibility() !=
			peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC &&
			statement.GetVisibility() !=
				peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_GRANT_ONLY) ||
		issuedAt.After(now.Add(time.Minute)) ||
		!expiresAt.After(now) ||
		expiresAt.Sub(issuedAt) <= 0 ||
		expiresAt.Sub(issuedAt) > MaxRouteAttestationLifetime {
		return nil, ErrRouteAttestationInvalid
	}
	publicKey, err := libp2pcrypto.UnmarshalPublicKey(
		attestation.GetHostPublicKey(),
	)
	if err != nil {
		return nil, ErrRouteAttestationInvalid
	}
	derivedPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil || derivedPeerID.String() != statement.GetStationPeerId() {
		return nil, ErrRouteAttestationInvalid
	}
	valid, err := publicKey.Verify(
		append([]byte(StationRouteDomain), attestation.GetStatementBytes()...),
		attestation.GetSignature(),
	)
	if err != nil || !valid {
		return nil, ErrRouteAttestationInvalid
	}
	return statement, nil
}
