package bootstrap

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	cfg "github.com/peers-labs/peers-touch/station/frame/core/config"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const (
	stationIdentityChallengeSize = 32
	stationIdentityLifetime      = time.Minute
	stationIdentityDomain        = "peers-touch/station-identity/v1\x00"
)

var stationIdentityCapabilities = []string{
	"access-gate",
	"actor-ptid",
	"station-identity",
}

func (s *SubServer) stationIdentity(
	_ context.Context,
	req *peerpb.StationIdentityRequest,
) (*peerpb.StationIdentityResponse, error) {
	if s.host == nil {
		return nil, fmt.Errorf("station identity host is not ready")
	}
	privateKey := s.host.Peerstore().PrivKey(s.host.ID())
	if privateKey == nil {
		return nil, fmt.Errorf("station identity host private key is unavailable")
	}
	return signStationIdentity(
		privateKey,
		s.host.ID(),
		canonicalStationOrigin(),
		req.GetChallenge(),
		time.Now().UTC(),
	)
}

func signStationIdentity(
	privateKey crypto.PrivKey,
	stationPeerID peer.ID,
	canonicalOrigin string,
	challenge []byte,
	now time.Time,
) (*peerpb.StationIdentityResponse, error) {
	if len(challenge) != stationIdentityChallengeSize {
		return nil, fmt.Errorf(
			"station identity challenge must contain exactly %d bytes",
			stationIdentityChallengeSize,
		)
	}
	if privateKey.Type() != crypto.Ed25519 {
		return nil, fmt.Errorf("station identity host key must be Ed25519")
	}
	if stationPeerID == "" {
		return nil, fmt.Errorf("station identity peer ID is unavailable")
	}
	if canonicalOrigin == "" {
		return nil, fmt.Errorf("station identity canonical origin is unavailable")
	}

	derivedPeerID, err := peer.IDFromPrivateKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("derive station identity peer ID: %w", err)
	}
	if derivedPeerID != stationPeerID {
		return nil, fmt.Errorf("station identity host key does not match peer ID")
	}

	capabilities := append([]string(nil), stationIdentityCapabilities...)
	sort.Strings(capabilities)
	statement := &peerpb.StationIdentityStatement{
		Challenge:       append([]byte(nil), challenge...),
		StationPeerId:   stationPeerID.String(),
		CanonicalOrigin: canonicalOrigin,
		Capabilities:    capabilities,
		IssuedAtUnixMs:  now.UnixMilli(),
		ExpiresAtUnixMs: now.Add(stationIdentityLifetime).UnixMilli(),
	}
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(statement)
	if err != nil {
		return nil, fmt.Errorf("marshal station identity statement: %w", err)
	}
	signatureInput := append([]byte(stationIdentityDomain), statementBytes...)
	signature, err := privateKey.Sign(signatureInput)
	if err != nil {
		return nil, fmt.Errorf("sign station identity statement: %w", err)
	}
	publicKey, err := crypto.MarshalPublicKey(privateKey.GetPublic())
	if err != nil {
		return nil, fmt.Errorf("marshal station identity public key: %w", err)
	}

	return &peerpb.StationIdentityResponse{
		StatementBytes: statementBytes,
		HostPublicKey:  publicKey,
		Signature:      signature,
	}, nil
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
