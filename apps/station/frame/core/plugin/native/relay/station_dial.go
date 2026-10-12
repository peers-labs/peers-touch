package relay

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/transport/securehttp"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const accessEndpointDomain = "peers-touch/access-endpoint/v1\x00"

func (r *Runtime) Available() bool {
	return r != nil && r.control != nil &&
		len(r.LiveRoutes(time.Now().UTC())) > 0
}

func (r *Runtime) RelayOrigin() string {
	if r == nil || len(r.config.Pool.Targets) == 0 {
		return ""
	}
	return r.config.Pool.Targets[0].ControlOrigin
}

func (r *Runtime) RoundTrip(
	ctx context.Context,
	targetStationPeerID string,
	request *http.Request,
) (*http.Response, error) {
	if r == nil || r.control == nil {
		return nil, ErrConnectionMaterialUnavailable
	}
	return r.control.roundTrip(ctx, targetStationPeerID, request)
}

func (c *StationControl) roundTrip(
	ctx context.Context,
	targetStationPeerID string,
	request *http.Request,
) (*http.Response, error) {
	if c == nil || request == nil ||
		strings.TrimSpace(targetStationPeerID) == "" {
		return nil, fmt.Errorf("Station Circuit request is invalid")
	}
	c.lock.Lock()
	defer c.lock.Unlock()
	var lastError error
	bodySent := false
	for _, target := range c.pool.Targets {
		route, err := c.discoverRouteLocked(
			ctx,
			target,
			targetStationPeerID,
		)
		if err != nil {
			lastError = err
			continue
		}
		address, err := multiaddr.NewMultiaddr(route.address)
		if err != nil {
			lastError = err
			continue
		}
		addressInfo, err := peer.AddrInfoFromP2pAddr(address)
		if err != nil || addressInfo.ID != route.nodePeerID {
			lastError = fmt.Errorf("signed Circuit address is invalid")
			continue
		}
		if err := c.host.Connect(ctx, *addressInfo); err != nil {
			lastError = err
			continue
		}
		client, err := securehttp.NewClient(securehttp.ClientConfig{
			Host:         c.host,
			TargetPeerID: route.nodePeerID,
			ExpectedSPKI: route.innerSPKI,
		})
		if err != nil {
			lastError = err
			continue
		}
		attempt, err := relayRequestAttempt(ctx, request, &bodySent)
		if err != nil {
			client.CloseIdleConnections()
			return nil, err
		}
		response, err := client.RoundTrip(attempt)
		if err != nil {
			client.CloseIdleConnections()
			lastError = err
			if !relayRequestAllowsAutomaticRetry(request.Method) {
				return nil, err
			}
			continue
		}
		return response, nil
	}
	if lastError == nil {
		lastError = fmt.Errorf("no verified Relay route is available")
	}
	return nil, lastError
}

func relayRequestAllowsAutomaticRetry(method string) bool {
	switch method {
	case http.MethodGet,
		http.MethodHead,
		http.MethodOptions,
		http.MethodTrace:
		return true
	default:
		return false
	}
}

func relayRequestAttempt(
	ctx context.Context,
	request *http.Request,
	bodySent *bool,
) (*http.Request, error) {
	attempt := request.Clone(ctx)
	if request.Body == nil {
		return attempt, nil
	}
	if !*bodySent {
		*bodySent = true
		attempt.Body = request.Body
		return attempt, nil
	}
	if request.GetBody == nil {
		return nil, fmt.Errorf(
			"Station Circuit request body is not replayable after a failed route",
		)
	}
	body, err := request.GetBody()
	if err != nil {
		return nil, fmt.Errorf("replay Station Circuit request body: %w", err)
	}
	attempt.Body = body
	return attempt, nil
}

type verifiedCircuitRoute struct {
	nodePeerID peer.ID
	innerSPKI  [sha256.Size]byte
	address    string
}

func (c *StationControl) discoverRouteLocked(
	ctx context.Context,
	target Target,
	targetStationPeerID string,
) (verifiedCircuitRoute, error) {
	challenge := make([]byte, peerpb.StationIdentityChallengeSize)
	if _, err := rand.Read(challenge); err != nil {
		return verifiedCircuitRoute{}, err
	}
	response := &peerpb.AccessEndpointResponse{}
	if err := c.postProtoLocked(
		ctx,
		target,
		"/.well-known/peers-touch/access",
		"",
		&peerpb.AccessEndpointRequest{
			Challenge:             challenge,
			ClientProtocolVersion: 1,
			SourcePeerId:          c.host.ID().String(),
		},
		response,
	); err != nil {
		return verifiedCircuitRoute{}, err
	}
	now := time.Now().UTC()
	statement := &peerpb.AccessEndpointStatement{}
	if err := proto.Unmarshal(
		response.GetEndpointStatementBytes(),
		statement,
	); err != nil {
		return verifiedCircuitRoute{}, err
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(statement)
	if err != nil ||
		!bytes.Equal(canonical, response.GetEndpointStatementBytes()) ||
		!bytes.Equal(statement.GetChallenge(), challenge) ||
		statement.GetEndpointRole() !=
			peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY ||
		statement.GetEndpointPeerId() != target.RelayPeerID.String() ||
		strings.TrimRight(statement.GetCanonicalOrigin(), "/") !=
			target.ControlOrigin ||
		statement.GetIssuedAtUnixMs() > now.Add(time.Minute).UnixMilli() ||
		statement.GetExpiresAtUnixMs() < now.Add(-time.Minute).UnixMilli() {
		return verifiedCircuitRoute{}, fmt.Errorf(
			"Relay endpoint statement is invalid",
		)
	}
	endpointKey, err := libp2pcrypto.UnmarshalPublicKey(
		response.GetEndpointPublicKey(),
	)
	if err != nil {
		return verifiedCircuitRoute{}, err
	}
	endpointPeerID, err := peer.IDFromPublicKey(endpointKey)
	if err != nil || endpointPeerID != target.RelayPeerID {
		return verifiedCircuitRoute{}, fmt.Errorf(
			"Relay endpoint key does not match configured PeerID",
		)
	}
	valid, err := endpointKey.Verify(
		append(
			[]byte(accessEndpointDomain),
			response.GetEndpointStatementBytes()...,
		),
		response.GetEndpointSignature(),
	)
	if err != nil || !valid {
		return verifiedCircuitRoute{}, fmt.Errorf(
			"Relay endpoint signature is invalid",
		)
	}
	routes := append(
		[]*peerpb.StationRouteAttestation(nil),
		response.GetStationRoutes()...,
	)
	sort.Slice(routes, func(left, right int) bool {
		return string(routes[left].GetStatementBytes()) <
			string(routes[right].GetStatementBytes())
	})
	for _, attestation := range routes {
		verified, err := peerpb.VerifyStationRouteAttestation(
			attestation,
			target.RelayPeerID.String(),
			now,
		)
		if err != nil ||
			verified.Statement.GetStationPeerId() != targetStationPeerID ||
			verified.Statement.GetKind() !=
				peerpb.StationRouteKind_STATION_ROUTE_KIND_CIRCUIT ||
			len(verified.Statement.GetInnerTlsSpkiSha256()) != sha256.Size {
			continue
		}
		nodePeerID, err := peer.Decode(
			verified.Statement.GetNodePeerId(),
		)
		if err != nil {
			continue
		}
		var expectedSPKI [sha256.Size]byte
		copy(
			expectedSPKI[:],
			verified.Statement.GetInnerTlsSpkiSha256(),
		)
		for _, address := range verified.Statement.GetAddresses() {
			if strings.Contains(address, "/p2p-circuit/") {
				return verifiedCircuitRoute{
					nodePeerID: nodePeerID,
					innerSPKI:  expectedSPKI,
					address:    address,
				}, nil
			}
		}
	}
	return verifiedCircuitRoute{}, fmt.Errorf(
		"Relay has no verified route for Station %s",
		targetStationPeerID,
	)
}
