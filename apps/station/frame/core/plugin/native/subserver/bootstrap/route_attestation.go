package bootstrap

import (
	"crypto/sha256"
	"fmt"
	"sort"
	"time"

	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

func (s *SubServer) SignStationRouteAttestation(
	statement *peerpb.StationRouteStatement,
) (*peerpb.StationRouteAttestation, error) {
	if s.host == nil {
		return nil, fmt.Errorf("Station route signer is not ready")
	}
	now := time.Now().UTC()
	authorization, err := s.currentNodeAuthorization(now)
	if err != nil {
		return nil, err
	}
	if err := bindNodeRouteStatement(statement, authorization, now); err != nil {
		return nil, err
	}
	return peerpb.SignStationRouteAttestation(
		s.host.Peerstore().PrivKey(s.host.ID()),
		authorization,
		statement,
		now,
	)
}

func (s *SubServer) SignStationConnectionGrant(
	statement *peerpb.StationConnectionGrantStatement,
) (*peerpb.StationConnectionGrant, error) {
	if s.host == nil {
		return nil, fmt.Errorf("Station grant signer is not ready")
	}
	now := time.Now().UTC()
	authorization, err := s.currentNodeAuthorization(now)
	if err != nil {
		return nil, err
	}
	if err := bindNodeGrantStatement(statement, authorization, now); err != nil {
		return nil, err
	}
	return peerpb.SignStationConnectionGrant(
		s.host.Peerstore().PrivKey(s.host.ID()),
		authorization,
		statement,
		now,
	)
}

func bindNodeRouteStatement(
	statement *peerpb.StationRouteStatement,
	authorization *peerpb.StationNodeAuthorization,
	now time.Time,
) error {
	verified, err := peerpb.VerifyStationNodeAuthorization(authorization, now)
	if err != nil || statement == nil {
		return fmt.Errorf("Station route authorization is invalid")
	}
	if statement.GetStationPeerId() != "" &&
		statement.GetStationPeerId() !=
			verified.Statement.GetStationPeerId() {
		return fmt.Errorf("Station route logical identity does not match authorization")
	}
	statement.StationPeerId = verified.Statement.GetStationPeerId()
	statement.NodePeerId = verified.Statement.GetNodePeerId()
	statement.NodeAuthorizationDigest = verified.Digest[:]
	statement.CapabilitiesDigest = append(
		[]byte(nil),
		verified.Statement.GetCapabilitiesDigest()...,
	)
	switch statement.GetKind() {
	case peerpb.StationRouteKind_STATION_ROUTE_KIND_DIRECT:
		if statement.GetRelayPeerId() != "" {
			return fmt.Errorf("Station Direct route must not carry a Relay identity")
		}
	case peerpb.StationRouteKind_STATION_ROUTE_KIND_CIRCUIT:
		if statement.GetRelayPeerId() == "" {
			return fmt.Errorf("Station Circuit route Relay identity is missing")
		}
	default:
		return fmt.Errorf("Station route kind is invalid")
	}
	statement.Addresses = append([]string(nil), statement.GetAddresses()...)
	sort.Strings(statement.Addresses)
	if statement.GetExpiresAtUnixMs()-statement.GetIssuedAtUnixMs() >
		peerpb.MaxRouteAttestationLifetime.Milliseconds() {
		statement.ExpiresAtUnixMs = statement.GetIssuedAtUnixMs() +
			peerpb.MaxRouteAttestationLifetime.Milliseconds()
	}
	if len(statement.GetInnerTlsSpkiSha256()) != sha256.Size {
		return fmt.Errorf("Station route TLS SPKI digest is invalid")
	}
	return nil
}

func bindNodeGrantStatement(
	statement *peerpb.StationConnectionGrantStatement,
	authorization *peerpb.StationNodeAuthorization,
	now time.Time,
) error {
	if statement == nil {
		return fmt.Errorf("Station grant statement is invalid")
	}
	verified, err := peerpb.VerifyStationNodeAuthorization(
		authorization,
		now,
	)
	if err != nil {
		return fmt.Errorf("Station grant authorization is invalid")
	}
	if statement.GetStationPeerId() != "" &&
		statement.GetStationPeerId() !=
			verified.Statement.GetStationPeerId() {
		return fmt.Errorf("Station grant logical identity does not match authorization")
	}
	statement.StationPeerId = verified.Statement.GetStationPeerId()
	statement.NodePeerId = verified.Statement.GetNodePeerId()
	statement.NodeAuthorizationDigest = verified.Digest[:]
	return nil
}
