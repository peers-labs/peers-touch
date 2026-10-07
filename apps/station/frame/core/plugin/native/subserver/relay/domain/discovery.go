package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"time"

	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const (
	AccessEndpointDomain  = "peers-touch/access-endpoint/v1\x00"
	StationRouteDomain    = "peers-touch/station-route/v1\x00"
	ConnectionGrantDomain = "peers-touch/station-connection-grant/v1\x00"

	AccessProtocolVersion       = uint32(1)
	DiscoveryChallengeSize      = 32
	MaxRouteAttestationLifetime = 24 * time.Hour
	MaxConnectionGrantLifetime  = 15 * time.Minute
	MaxConnectionGrantUses      = uint32(32)
)

type RouteRecord struct {
	RouteID          string
	StationPeerID    string
	RelayPeerID      string
	RouteGeneration  uint64
	Visibility       peerpb.StationRouteVisibility
	ExpiresAt        time.Time
	AttestationBytes []byte
}

type GrantRecord struct {
	GrantID         string
	GrantDigest     string
	StationPeerID   string
	RelayPeerID     string
	RouteID         string
	RouteGeneration uint64
	MaxUses         uint32
	RemainingUses   uint32
	ReservedUses    uint32
	ExpiresAt       time.Time
}

func DigestGrant(grant *peerpb.StationConnectionGrant) (string, error) {
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(grant)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
