package bootstrap

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const (
	accessEndpointDomain   = "peers-touch/access-endpoint/v1\x00"
	accessEndpointLifetime = time.Minute
	accessProtocolVersion  = uint32(1)
)

var directEndpointCapabilities = []string{
	"access-gate",
	"endpoint-discovery",
	"station-identity",
}

func (s *SubServer) AccessEndpoint(
	_ context.Context,
	req *peerpb.AccessEndpointRequest,
) (*peerpb.AccessEndpointResponse, error) {
	if s.host == nil {
		return nil, fmt.Errorf("Station endpoint identity host is not ready")
	}
	privateKey := s.host.Peerstore().PrivKey(s.host.ID())
	if privateKey == nil {
		return nil, fmt.Errorf("Station endpoint identity key is unavailable")
	}
	return signAccessEndpoint(
		privateKey,
		s.host.ID(),
		canonicalStationOrigin(),
		req,
		time.Now().UTC(),
	)
}

func signAccessEndpoint(
	privateKey crypto.PrivKey,
	endpointPeerID peer.ID,
	canonicalOrigin string,
	req *peerpb.AccessEndpointRequest,
	now time.Time,
) (*peerpb.AccessEndpointResponse, error) {
	if req == nil || len(req.GetChallenge()) != stationIdentityChallengeSize {
		return nil, fmt.Errorf(
			"access endpoint challenge must contain exactly %d bytes",
			stationIdentityChallengeSize,
		)
	}
	if req.GetClientProtocolVersion() != accessProtocolVersion {
		return nil, fmt.Errorf(
			"unsupported access endpoint protocol version: %d",
			req.GetClientProtocolVersion(),
		)
	}
	if len(req.GetConnectionGrant()) != 0 {
		return nil, fmt.Errorf("direct Station does not accept a connection grant")
	}
	if privateKey.Type() != crypto.Ed25519 {
		return nil, fmt.Errorf("Station endpoint identity key must be Ed25519")
	}
	if endpointPeerID == "" || canonicalOrigin == "" {
		return nil, fmt.Errorf("Station endpoint identity is incomplete")
	}
	derivedPeerID, err := peer.IDFromPrivateKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("derive Station endpoint peer ID: %w", err)
	}
	if derivedPeerID != endpointPeerID {
		return nil, fmt.Errorf("Station endpoint key does not match peer ID")
	}

	capabilities := append([]string(nil), directEndpointCapabilities...)
	sort.Strings(capabilities)
	statement := &peerpb.AccessEndpointStatement{
		Challenge:        append([]byte(nil), req.GetChallenge()...),
		EndpointRole:     peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION,
		EndpointPeerId:   endpointPeerID.String(),
		CanonicalOrigin:  canonicalOrigin,
		ProtocolVersions: []uint32{accessProtocolVersion},
		Capabilities:     capabilities,
		IssuedAtUnixMs:   now.UnixMilli(),
		ExpiresAtUnixMs:  now.Add(accessEndpointLifetime).UnixMilli(),
	}
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(statement)
	if err != nil {
		return nil, fmt.Errorf("marshal Station endpoint statement: %w", err)
	}
	signature, err := privateKey.Sign(
		append([]byte(accessEndpointDomain), statementBytes...),
	)
	if err != nil {
		return nil, fmt.Errorf("sign Station endpoint statement: %w", err)
	}
	publicKey, err := crypto.MarshalPublicKey(privateKey.GetPublic())
	if err != nil {
		return nil, fmt.Errorf("marshal Station endpoint public key: %w", err)
	}
	return &peerpb.AccessEndpointResponse{
		Outcome:                peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_READY,
		EndpointStatementBytes: statementBytes,
		EndpointPublicKey:      publicKey,
		EndpointSignature:      signature,
	}, nil
}
