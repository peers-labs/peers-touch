package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

var (
	ErrRouteAttestationInvalid = domain.ErrRouteAttestationInvalid
	ErrRouteNotFound           = errors.New("Station route is not found")
	ErrGrantInvalid            = errors.New("Station connection grant is invalid")
	ErrTunnelUnauthorized      = errors.New("Relay tunnel is not authorized")
)

const (
	discoveryLifetime = time.Minute
)

var relayEndpointCapabilities = []string{
	"endpoint-discovery",
	"relay-opaque-tunnel-v1",
	"station-route-attestation-v1",
}

func (s *Service) PublishStationRoute(
	ctx context.Context,
	identity domain.MountIdentity,
	attestation *peerpb.StationRouteAttestation,
) (*peerpb.StationRouteStatement, error) {
	statement, err := domain.VerifyStationRouteAttestation(
		attestation,
		s.authority.RelayPeerID(),
		s.now(),
	)
	if err != nil {
		return nil, err
	}
	if statement.GetStationPeerId() != identity.StationPeerID ||
		statement.GetRouteGeneration() != identity.Generation {
		return nil, ErrRouteAttestationInvalid
	}
	if _, err := s.authenticateMountIdentity(ctx, identity); err != nil {
		return nil, err
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(attestation)
	if err != nil {
		return nil, fmt.Errorf("marshal Station route attestation: %w", err)
	}

	s.discoveryMu.Lock()
	defer s.discoveryMu.Unlock()
	s.removeExpiredDiscoveryStateLocked(s.now())
	if current, ok := s.routes[statement.GetRouteId()]; ok &&
		current.StationPeerID != identity.StationPeerID {
		return nil, ErrRouteAttestationInvalid
	}
	s.routes[statement.GetRouteId()] = domain.RouteRecord{
		RouteID:          statement.GetRouteId(),
		StationPeerID:    statement.GetStationPeerId(),
		RelayPeerID:      statement.GetRelayPeerId(),
		RouteGeneration:  statement.GetRouteGeneration(),
		Visibility:       statement.GetVisibility(),
		ExpiresAt:        time.UnixMilli(statement.GetExpiresAtUnixMs()).UTC(),
		AttestationBytes: raw,
	}
	return proto.Clone(statement).(*peerpb.StationRouteStatement), nil
}

func (s *Service) RegisterConnectionGrant(
	ctx context.Context,
	identity domain.MountIdentity,
	req *peerpb.RegisterStationConnectionGrantRequest,
) (*domain.GrantRecord, error) {
	if req == nil || len(req.GetGrantDigest()) != sha256.Size ||
		strings.TrimSpace(req.GetGrantId()) == "" ||
		strings.TrimSpace(req.GetRouteId()) == "" ||
		req.GetRouteGeneration() == 0 ||
		req.GetMaxUses() == 0 ||
		req.GetMaxUses() > domain.MaxConnectionGrantUses {
		return nil, ErrGrantInvalid
	}
	if _, err := s.authenticateMountIdentity(ctx, identity); err != nil {
		return nil, err
	}
	now := s.now()
	expiresAt := time.UnixMilli(req.GetExpiresAtUnixMs()).UTC()
	if !expiresAt.After(now) ||
		expiresAt.After(now.Add(domain.MaxConnectionGrantLifetime)) {
		return nil, ErrGrantInvalid
	}

	s.discoveryMu.Lock()
	defer s.discoveryMu.Unlock()
	s.removeExpiredDiscoveryStateLocked(now)
	route, ok := s.routes[req.GetRouteId()]
	if !ok ||
		route.StationPeerID != identity.StationPeerID ||
		route.RelayPeerID != identity.RelayPeerID ||
		route.RouteGeneration != identity.Generation ||
		route.RouteGeneration != req.GetRouteGeneration() {
		return nil, ErrRouteNotFound
	}
	digest := hex.EncodeToString(req.GetGrantDigest())
	if current, ok := s.grants[digest]; ok {
		if current.GrantID != req.GetGrantId() ||
			current.StationPeerID != identity.StationPeerID ||
			current.RelayPeerID != identity.RelayPeerID ||
			current.RouteID != route.RouteID ||
			current.RouteGeneration != route.RouteGeneration ||
			current.MaxUses != req.GetMaxUses() ||
			!current.ExpiresAt.Equal(expiresAt) {
			return nil, ErrGrantInvalid
		}
		out := current
		return &out, nil
	}
	record := domain.GrantRecord{
		GrantID:         req.GetGrantId(),
		GrantDigest:     digest,
		StationPeerID:   identity.StationPeerID,
		RelayPeerID:     identity.RelayPeerID,
		RouteID:         route.RouteID,
		RouteGeneration: route.RouteGeneration,
		MaxUses:         req.GetMaxUses(),
		RemainingUses:   req.GetMaxUses(),
		ExpiresAt:       expiresAt,
	}
	s.grants[digest] = record
	out := record
	return &out, nil
}

func (s *Service) DiscoverEndpoint(
	ctx context.Context,
	req *peerpb.AccessEndpointRequest,
	canonicalOrigin string,
) (*peerpb.AccessEndpointResponse, error) {
	if req == nil ||
		len(req.GetChallenge()) != domain.DiscoveryChallengeSize ||
		req.GetClientProtocolVersion() != domain.AccessProtocolVersion {
		return nil, ErrInvalidRequest
	}
	now := s.now()
	outcome := peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_NO_CANDIDATES
	routes := make([]*peerpb.StationRouteAttestation, 0)

	if len(req.GetConnectionGrant()) > 0 {
		route, grantOutcome := s.consumeConnectionGrant(
			ctx,
			req.GetConnectionGrant(),
			now,
		)
		outcome = grantOutcome
		if route != nil {
			routes = append(routes, route)
		}
	} else {
		routes = s.publicStationRoutes(ctx, now)
		switch len(routes) {
		case 0:
			outcome = peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_NO_CANDIDATES
		case 1:
			outcome = peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_READY
		default:
			outcome = peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_MULTIPLE_CANDIDATES
		}
	}

	statement := &peerpb.AccessEndpointStatement{
		Challenge:        append([]byte(nil), req.GetChallenge()...),
		EndpointRole:     peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY,
		EndpointPeerId:   s.authority.RelayPeerID(),
		CanonicalOrigin:  canonicalOrigin,
		ProtocolVersions: []uint32{domain.AccessProtocolVersion},
		Capabilities:     append([]string(nil), relayEndpointCapabilities...),
		IssuedAtUnixMs:   now.UnixMilli(),
		ExpiresAtUnixMs:  now.Add(discoveryLifetime).UnixMilli(),
	}
	sort.Strings(statement.Capabilities)
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(statement)
	if err != nil {
		return nil, fmt.Errorf("marshal Relay endpoint statement: %w", err)
	}
	publicKey, signature, err := s.authority.SignEndpointStatement(
		statementBytes,
	)
	if err != nil {
		return nil, err
	}
	return &peerpb.AccessEndpointResponse{
		Outcome:                outcome,
		EndpointStatementBytes: statementBytes,
		EndpointPublicKey:      publicKey,
		EndpointSignature:      signature,
		StationRoutes:          routes,
	}, nil
}

func (s *Service) publicStationRoutes(
	ctx context.Context,
	now time.Time,
) []*peerpb.StationRouteAttestation {
	s.discoveryMu.Lock()
	defer s.discoveryMu.Unlock()
	s.removeExpiredDiscoveryStateLocked(now)
	routeIDs := make([]string, 0, len(s.routes))
	for routeID := range s.routes {
		routeIDs = append(routeIDs, routeID)
	}
	sort.Strings(routeIDs)
	routes := make([]*peerpb.StationRouteAttestation, 0, len(routeIDs))
	for _, routeID := range routeIDs {
		record := s.routes[routeID]
		if record.Visibility != peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC ||
			!s.routeIsCurrent(ctx, record) {
			continue
		}
		attestation := &peerpb.StationRouteAttestation{}
		if err := proto.Unmarshal(record.AttestationBytes, attestation); err == nil {
			routes = append(routes, attestation)
		}
	}
	return routes
}

func (s *Service) consumeConnectionGrant(
	ctx context.Context,
	raw []byte,
	now time.Time,
) (*peerpb.StationRouteAttestation, peerpb.AccessEndpointOutcome) {
	grant := &peerpb.StationConnectionGrant{}
	if err := proto.Unmarshal(raw, grant); err != nil {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(grant)
	if err != nil || !bytes.Equal(canonical, raw) {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}
	statement := &peerpb.StationConnectionGrantStatement{}
	if err := proto.Unmarshal(grant.GetStatementBytes(), statement); err != nil {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}
	if statement.GetRelayPeerId() != s.authority.RelayPeerID() {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_GRANT_WRONG_RELAY
	}
	issuedAt := time.UnixMilli(statement.GetIssuedAtUnixMs()).UTC()
	expiresAt := time.UnixMilli(statement.GetExpiresAtUnixMs()).UTC()
	if !expiresAt.After(now) {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_GRANT_EXPIRED
	}
	if statement.GetMaxUses() == 0 ||
		statement.GetMaxUses() > domain.MaxConnectionGrantUses ||
		expiresAt.Sub(issuedAt) <= 0 ||
		expiresAt.Sub(issuedAt) > domain.MaxConnectionGrantLifetime {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}
	if err := verifyStationSignature(
		grant.GetStatementBytes(),
		grant.GetHostPublicKey(),
		grant.GetSignature(),
		domain.ConnectionGrantDomain,
		statement.GetStationPeerId(),
	); err != nil {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}
	digest, err := domain.DigestGrant(grant)
	if err != nil {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}

	s.discoveryMu.Lock()
	defer s.discoveryMu.Unlock()
	s.removeExpiredDiscoveryStateLocked(now)
	record, ok := s.grants[digest]
	if !ok || record.RemainingUses == 0 {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_GRANT_REPLAYED
	}
	if record.GrantID != statement.GetGrantId() ||
		record.StationPeerID != statement.GetStationPeerId() ||
		record.RelayPeerID != statement.GetRelayPeerId() ||
		record.RouteID != statement.GetRouteId() ||
		record.RouteGeneration != statement.GetRouteGeneration() ||
		record.MaxUses != statement.GetMaxUses() {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}
	route, ok := s.routes[record.RouteID]
	if !ok || !s.routeIsCurrent(ctx, route) {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}
	record.RemainingUses--
	record.ReservedUses++
	s.grants[digest] = record
	attestation := &peerpb.StationRouteAttestation{}
	if err := proto.Unmarshal(route.AttestationBytes, attestation); err != nil {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}
	return attestation, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_READY
}

// AuthorizeClientTunnel atomically redeems a discovery reservation. Discovery
// consumes the public grant use; tunnel establishment consumes the matching
// reservation, so replayed discovery remains rejected without reviving a
// reusable bearer credential.
func (s *Service) AuthorizeClientTunnel(
	ctx context.Context,
	rawGrant []byte,
	routeID string,
	routeGeneration uint64,
) (domain.RouteRecord, error) {
	grant := &peerpb.StationConnectionGrant{}
	if err := proto.Unmarshal(rawGrant, grant); err != nil {
		return domain.RouteRecord{}, ErrTunnelUnauthorized
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(grant)
	if err != nil || !bytes.Equal(canonical, rawGrant) {
		return domain.RouteRecord{}, ErrTunnelUnauthorized
	}
	statement := &peerpb.StationConnectionGrantStatement{}
	if err := proto.Unmarshal(grant.GetStatementBytes(), statement); err != nil {
		return domain.RouteRecord{}, ErrTunnelUnauthorized
	}
	now := s.now()
	if statement.GetRelayPeerId() != s.authority.RelayPeerID() ||
		statement.GetRouteId() != routeID ||
		statement.GetRouteGeneration() != routeGeneration ||
		!time.UnixMilli(statement.GetExpiresAtUnixMs()).After(now) {
		return domain.RouteRecord{}, ErrTunnelUnauthorized
	}
	if err := verifyStationSignature(
		grant.GetStatementBytes(),
		grant.GetHostPublicKey(),
		grant.GetSignature(),
		domain.ConnectionGrantDomain,
		statement.GetStationPeerId(),
	); err != nil {
		return domain.RouteRecord{}, ErrTunnelUnauthorized
	}
	digest, err := domain.DigestGrant(grant)
	if err != nil {
		return domain.RouteRecord{}, ErrTunnelUnauthorized
	}

	s.discoveryMu.Lock()
	defer s.discoveryMu.Unlock()
	s.removeExpiredDiscoveryStateLocked(now)
	record, ok := s.grants[digest]
	if !ok || record.ReservedUses == 0 ||
		record.GrantID != statement.GetGrantId() ||
		record.StationPeerID != statement.GetStationPeerId() ||
		record.RouteID != routeID ||
		record.RouteGeneration != routeGeneration {
		return domain.RouteRecord{}, ErrTunnelUnauthorized
	}
	route, ok := s.routes[routeID]
	if !ok || !s.routeIsCurrent(ctx, route) {
		return domain.RouteRecord{}, ErrTunnelUnauthorized
	}
	record.ReservedUses--
	s.grants[digest] = record
	return route, nil
}

// AuthorizePeerTunnel binds a caller's mount credential to a current target
// route. Relay sees Station identities and route metadata, never the typed
// capability or its inner HTTP request.
func (s *Service) AuthorizePeerTunnel(
	ctx context.Context,
	caller domain.MountIdentity,
	targetStationPeerID string,
	routeID string,
	routeGeneration uint64,
) (domain.RouteRecord, error) {
	if strings.TrimSpace(targetStationPeerID) == "" ||
		targetStationPeerID == caller.StationPeerID {
		return domain.RouteRecord{}, ErrTunnelUnauthorized
	}
	if _, err := s.authenticateMountIdentity(ctx, caller); err != nil ||
		!containsScope(caller.Scopes, domain.ScopePeerTunnel) {
		return domain.RouteRecord{}, ErrTunnelUnauthorized
	}

	s.discoveryMu.Lock()
	defer s.discoveryMu.Unlock()
	s.removeExpiredDiscoveryStateLocked(s.now())
	candidates := make([]domain.RouteRecord, 0, 1)
	for _, route := range s.routes {
		if route.StationPeerID != targetStationPeerID {
			continue
		}
		if routeID != "" && route.RouteID != routeID {
			continue
		}
		if routeGeneration != 0 &&
			route.RouteGeneration != routeGeneration {
			continue
		}
		if s.routeIsCurrent(ctx, route) {
			candidates = append(candidates, route)
		}
	}
	if len(candidates) != 1 {
		return domain.RouteRecord{}, ErrTunnelUnauthorized
	}
	return candidates[0], nil
}

func (s *Service) AuthorizePublicTunnel(
	ctx context.Context,
	routeID string,
	routeGeneration uint64,
) (domain.RouteRecord, error) {
	s.discoveryMu.Lock()
	defer s.discoveryMu.Unlock()
	s.removeExpiredDiscoveryStateLocked(s.now())
	route, ok := s.routes[routeID]
	if !ok ||
		route.RouteGeneration != routeGeneration ||
		route.Visibility !=
			peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC ||
		!s.routeIsCurrent(ctx, route) {
		return domain.RouteRecord{}, ErrTunnelUnauthorized
	}
	return route, nil
}

func (s *Service) InvalidateStationRoutes(stationPeerID string) {
	s.discoveryMu.Lock()
	defer s.discoveryMu.Unlock()
	for routeID, route := range s.routes {
		if route.StationPeerID == stationPeerID {
			delete(s.routes, routeID)
		}
	}
	for digest, grant := range s.grants {
		if grant.StationPeerID == stationPeerID {
			delete(s.grants, digest)
		}
	}
}

func (s *Service) routeIsCurrent(
	ctx context.Context,
	route domain.RouteRecord,
) bool {
	mount, err := s.repo.GetMountByStationPeerID(ctx, route.StationPeerID)
	return err == nil &&
		mount.Status == domain.MountStatusOnline &&
		mount.Generation == route.RouteGeneration &&
		route.RelayPeerID == s.authority.RelayPeerID()
}

func (s *Service) removeExpiredDiscoveryStateLocked(now time.Time) {
	for routeID, route := range s.routes {
		if !route.ExpiresAt.After(now) {
			delete(s.routes, routeID)
		}
	}
	for digest, grant := range s.grants {
		if !grant.ExpiresAt.After(now) {
			delete(s.grants, digest)
		}
	}
}

func verifyStationSignature(
	statement []byte,
	hostPublicKey []byte,
	signature []byte,
	signatureDomain string,
	stationPeerID string,
) error {
	publicKey, err := libp2pcrypto.UnmarshalPublicKey(hostPublicKey)
	if err != nil || publicKey.Type() != libp2pcrypto.Ed25519 {
		return ErrRouteAttestationInvalid
	}
	derivedPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil || derivedPeerID.String() != stationPeerID {
		return ErrRouteAttestationInvalid
	}
	ok, err := publicKey.Verify(
		append([]byte(signatureDomain), statement...),
		signature,
	)
	if err != nil || !ok {
		return ErrRouteAttestationInvalid
	}
	return nil
}
