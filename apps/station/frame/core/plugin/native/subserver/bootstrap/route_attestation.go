package bootstrap

import (
	"fmt"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

func (s *SubServer) SignStationRouteAttestation(
	statement *peerpb.StationRouteStatement,
) (*peerpb.StationRouteAttestation, error) {
	if s.host == nil {
		return nil, fmt.Errorf("Station route signer is not ready")
	}
	return signStationRouteAttestation(
		s.host.Peerstore().PrivKey(s.host.ID()),
		s.host.ID(),
		statement,
		time.Now().UTC(),
	)
}

func (s *SubServer) SignStationConnectionGrant(
	statement *peerpb.StationConnectionGrantStatement,
) (*peerpb.StationConnectionGrant, error) {
	if s.host == nil {
		return nil, fmt.Errorf("Station grant signer is not ready")
	}
	return signStationConnectionGrant(
		s.host.Peerstore().PrivKey(s.host.ID()),
		s.host.ID(),
		statement,
		time.Now().UTC(),
	)
}

func signStationRouteAttestation(
	privateKey crypto.PrivKey,
	stationPeerID peer.ID,
	statement *peerpb.StationRouteStatement,
	now time.Time,
) (*peerpb.StationRouteAttestation, error) {
	if statement == nil ||
		statement.GetStationPeerId() != stationPeerID.String() ||
		statement.GetRelayPeerId() == "" ||
		statement.GetRouteId() == "" ||
		statement.GetRouteGeneration() == 0 ||
		len(statement.GetInnerTlsSpkiSha256()) != 32 ||
		len(statement.GetCapabilitiesDigest()) != 32 ||
		(statement.GetVisibility() !=
			peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC &&
			statement.GetVisibility() !=
				peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_GRANT_ONLY) ||
		statement.GetIssuedAtUnixMs() > now.Add(time.Minute).UnixMilli() ||
		statement.GetExpiresAtUnixMs() <= now.UnixMilli() ||
		statement.GetExpiresAtUnixMs()-statement.GetIssuedAtUnixMs() >
			domain.MaxRouteAttestationLifetime.Milliseconds() {
		return nil, fmt.Errorf("Station route statement is invalid")
	}
	return signStationStatement(
		privateKey,
		stationPeerID,
		statement,
		domain.StationRouteDomain,
		func(statementBytes, publicKey, signature []byte) *peerpb.StationRouteAttestation {
			return &peerpb.StationRouteAttestation{
				StatementBytes: statementBytes,
				HostPublicKey:  publicKey,
				Signature:      signature,
			}
		},
	)
}

func signStationConnectionGrant(
	privateKey crypto.PrivKey,
	stationPeerID peer.ID,
	statement *peerpb.StationConnectionGrantStatement,
	now time.Time,
) (*peerpb.StationConnectionGrant, error) {
	if statement == nil ||
		statement.GetStationPeerId() != stationPeerID.String() ||
		statement.GetRelayPeerId() == "" ||
		statement.GetRouteId() == "" ||
		statement.GetRouteGeneration() == 0 ||
		statement.GetGrantId() == "" ||
		statement.GetMaxUses() == 0 ||
		statement.GetMaxUses() > domain.MaxConnectionGrantUses ||
		statement.GetIssuedAtUnixMs() > now.Add(time.Minute).UnixMilli() ||
		statement.GetExpiresAtUnixMs() <= now.UnixMilli() ||
		statement.GetExpiresAtUnixMs()-statement.GetIssuedAtUnixMs() >
			domain.MaxConnectionGrantLifetime.Milliseconds() {
		return nil, fmt.Errorf("Station connection grant statement is invalid")
	}
	return signStationStatement(
		privateKey,
		stationPeerID,
		statement,
		domain.ConnectionGrantDomain,
		func(statementBytes, publicKey, signature []byte) *peerpb.StationConnectionGrant {
			return &peerpb.StationConnectionGrant{
				StatementBytes: statementBytes,
				HostPublicKey:  publicKey,
				Signature:      signature,
			}
		},
	)
}

func signStationStatement[T proto.Message](
	privateKey crypto.PrivKey,
	stationPeerID peer.ID,
	statement proto.Message,
	signatureDomain string,
	build func([]byte, []byte, []byte) T,
) (T, error) {
	var zero T
	if privateKey == nil || privateKey.Type() != crypto.Ed25519 {
		return zero, fmt.Errorf("Station signing key must be Ed25519")
	}
	derivedPeerID, err := peer.IDFromPrivateKey(privateKey)
	if err != nil || derivedPeerID != stationPeerID {
		return zero, fmt.Errorf("Station signing key does not match peer ID")
	}
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(statement)
	if err != nil {
		return zero, fmt.Errorf("marshal Station signed statement: %w", err)
	}
	signature, err := privateKey.Sign(
		append([]byte(signatureDomain), statementBytes...),
	)
	if err != nil {
		return zero, fmt.Errorf("sign Station statement: %w", err)
	}
	publicKey, err := crypto.MarshalPublicKey(privateKey.GetPublic())
	if err != nil {
		return zero, fmt.Errorf("marshal Station public key: %w", err)
	}
	return build(statementBytes, publicKey, signature), nil
}
