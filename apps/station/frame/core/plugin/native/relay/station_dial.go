package relay

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/transport/securehttp"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const accessEndpointDomain = "peers-touch/access-endpoint/v1\x00"

const maxStationRouteClients = 16

func (r *Runtime) Available() bool {
	return r != nil && r.control != nil &&
		len(r.LiveRoutes(time.Now().UTC())) > 0
}

func (r *Runtime) RelayOrigin() string {
	targets := r.targets()
	if len(targets) == 0 {
		return ""
	}
	return targets[0].ControlOrigin
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
	targets := make([]Target, 0, len(c.targets))
	for _, target := range c.targets {
		targets = append(targets, cloneTarget(target))
	}
	sort.Slice(targets, func(left, right int) bool {
		return targets[left].RelayPeerID.String() <
			targets[right].RelayPeerID.String()
	})
	for _, target := range targets {
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
		key, session, err := c.routeClientLocked(route)
		if err != nil {
			lastError = err
			continue
		}
		attempt, err := relayRequestAttempt(ctx, request, &bodySent)
		if err != nil {
			return nil, err
		}
		response, err := session.client.RoundTrip(attempt)
		if err != nil {
			c.retireRouteClientLocked(key, session)
			lastError = err
			if !relayRequestAllowsAutomaticRetry(request.Method) {
				return nil, err
			}
			continue
		}
		session.activeResponses++
		response.Body = &stationRouteResponseBody{
			inner: response.Body,
			release: func() {
				c.releaseRouteClientResponse(session)
			},
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
	relayPeerID peer.ID
	nodePeerID  peer.ID
	routeID     string
	generation  uint64
	innerSPKI   [sha256.Size]byte
	address     string
}

type stationRouteClientKey struct {
	relayPeerID peer.ID
	nodePeerID  peer.ID
	routeID     string
	generation  uint64
	innerSPKI   [sha256.Size]byte
	address     string
}

type stationRouteClient struct {
	client          *securehttp.Client
	lastUsed        uint64
	activeResponses int
	retired         bool
}

type stationRouteResponseBody struct {
	inner   io.ReadCloser
	release func()
	once    sync.Once
}

func (b *stationRouteResponseBody) Read(output []byte) (int, error) {
	count, err := b.inner.Read(output)
	if err != nil {
		b.once.Do(b.release)
	}
	return count, err
}

func (b *stationRouteResponseBody) Close() error {
	err := b.inner.Close()
	b.once.Do(b.release)
	return err
}

func (c *StationControl) routeClientLocked(
	route verifiedCircuitRoute,
) (stationRouteClientKey, *stationRouteClient, error) {
	key := stationRouteClientKey{
		relayPeerID: route.relayPeerID,
		nodePeerID:  route.nodePeerID,
		routeID:     route.routeID,
		generation:  route.generation,
		innerSPKI:   route.innerSPKI,
		address:     route.address,
	}
	c.routeClientSequence++
	if session := c.routeClients[key]; session != nil && !session.retired {
		session.lastUsed = c.routeClientSequence
		return key, session, nil
	}
	client, err := securehttp.NewClient(securehttp.ClientConfig{
		Host:         c.host,
		TargetPeerID: route.nodePeerID,
		ExpectedSPKI: route.innerSPKI,
	})
	if err != nil {
		return stationRouteClientKey{}, nil, err
	}
	session := &stationRouteClient{
		client:   client,
		lastUsed: c.routeClientSequence,
	}
	if c.routeClients == nil {
		c.routeClients = make(map[stationRouteClientKey]*stationRouteClient)
	}
	c.routeClients[key] = session
	for len(c.routeClients) > maxStationRouteClients {
		var oldestKey stationRouteClientKey
		var oldest *stationRouteClient
		for candidateKey, candidate := range c.routeClients {
			if candidate == session {
				continue
			}
			if oldest == nil || candidate.lastUsed < oldest.lastUsed {
				oldestKey = candidateKey
				oldest = candidate
			}
		}
		if oldest == nil {
			break
		}
		c.retireRouteClientLocked(oldestKey, oldest)
	}
	return key, session, nil
}

func (c *StationControl) retireRouteClientLocked(
	key stationRouteClientKey,
	session *stationRouteClient,
) {
	if session == nil {
		return
	}
	if current := c.routeClients[key]; current == session {
		delete(c.routeClients, key)
	}
	session.retired = true
	if session.activeResponses == 0 {
		session.client.CloseIdleConnections()
	}
}

func (c *StationControl) releaseRouteClientResponse(
	session *stationRouteClient,
) {
	c.lock.Lock()
	defer c.lock.Unlock()
	if session.activeResponses > 0 {
		session.activeResponses--
	}
	if session.retired && session.activeResponses == 0 {
		session.client.CloseIdleConnections()
	}
}

func (c *StationControl) close() {
	if c == nil {
		return
	}
	c.lock.Lock()
	for key, session := range c.routeClients {
		c.retireRouteClientLocked(key, session)
	}
	c.lock.Unlock()
	c.credentialMu.Lock()
	defer c.credentialMu.Unlock()
	for key, client := range c.clients {
		if closer, ok := client.Transport.(interface{ CloseIdleConnections() }); ok {
			closer.CloseIdleConnections()
		}
		delete(c.clients, key)
	}
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
					relayPeerID: target.RelayPeerID,
					nodePeerID:  nodePeerID,
					routeID:     verified.Statement.GetRouteId(),
					generation:  verified.Statement.GetRouteGeneration(),
					innerSPKI:   expectedSPKI,
					address:     address,
				}, nil
			}
		}
	}
	return verifiedCircuitRoute{}, fmt.Errorf(
		"Relay has no verified route for Station %s",
		targetStationPeerID,
	)
}
