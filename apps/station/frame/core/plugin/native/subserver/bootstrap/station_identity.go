package bootstrap

import (
	"context"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	cfg "github.com/peers-labs/peers-touch/station/frame/core/config"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

var stationNodeCapabilities = []string{
	"access-gate",
	"actor-ptid",
	"endpoint-discovery",
	"station-identity",
	"station-route",
}

func (s *SubServer) stationIdentity(
	_ context.Context,
	req *peerpb.StationIdentityRequest,
) (*peerpb.StationIdentityResponse, error) {
	return s.SignStationIdentityResponse(req.GetChallenge())
}

func (s *SubServer) SignStationIdentityResponse(
	challenge []byte,
) (*peerpb.StationIdentityResponse, error) {
	if s.host == nil {
		return nil, fmt.Errorf("Station node host is not ready")
	}
	now := time.Now().UTC()
	authorization, err := s.currentNodeAuthorization(now)
	if err != nil {
		return nil, err
	}
	return peerpb.SignStationIdentityResponse(
		s.host.Peerstore().PrivKey(s.host.ID()),
		authorization,
		canonicalStationOrigin(),
		challenge,
		stationNodeCapabilities,
		now,
	)
}

// ClusterNodeAuthorization returns the verified, non-secret node delegation
// facts consumed by Station cluster admission.
func (s *SubServer) ClusterNodeAuthorization(
	_ context.Context,
) (
	stationPeerID string,
	nodePeerID string,
	authorizationEpoch uint64,
	authorizationDigest string,
	err error,
) {
	now := time.Now().UTC()
	authorization, err := s.currentNodeAuthorization(now)
	if err != nil {
		return "", "", 0, "", err
	}
	verified, err := peerpb.VerifyStationNodeAuthorization(
		authorization,
		now,
	)
	if err != nil {
		return "", "", 0, "", err
	}
	statement := verified.Statement
	return statement.GetStationPeerId(),
		statement.GetNodePeerId(),
		statement.GetAuthorizationEpoch(),
		hex.EncodeToString(verified.Digest[:]),
		nil
}

func (s *SubServer) currentNodeAuthorization(
	now time.Time,
) (*peerpb.StationNodeAuthorization, error) {
	s.nodeAuthorizationLock.Lock()
	defer s.nodeAuthorizationLock.Unlock()

	if current := s.nodeAuthorization; current != nil {
		verified, err := peerpb.VerifyStationNodeAuthorization(current, now)
		if err == nil &&
			verified.Statement.GetExpiresAtUnixMs() >
				now.Add(peerpb.MaxRouteAttestationLifetime).UnixMilli() {
			return current, nil
		}
	}
	if s.opts.StationRootKey == nil || s.host == nil {
		return nil, fmt.Errorf("Station identity keys are unavailable")
	}
	authorization, err := peerpb.SignDefaultStationNodeAuthorization(
		s.opts.StationRootKey,
		s.host.Peerstore().PubKey(s.host.ID()),
		stationNodeCapabilities,
		now,
	)
	if err != nil {
		return nil, fmt.Errorf("authorize Station node: %w", err)
	}
	s.nodeAuthorization = authorization
	return authorization, nil
}

func canonicalStationOrigin() string {
	raw := strings.TrimSpace(
		cfg.Get("peers", "node", "server", "baseurl").String(""),
	)
	parsed, err := url.Parse(raw)
	if err != nil || parsed.User != nil || parsed.Hostname() == "" {
		return ""
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return ""
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return ""
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	port := parsed.Port()
	if port == "" {
		if scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	return scheme + "://" + net.JoinHostPort(
		strings.ToLower(parsed.Hostname()),
		port,
	)
}
