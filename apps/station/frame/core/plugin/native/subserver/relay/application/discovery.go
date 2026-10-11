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

	"github.com/libp2p/go-libp2p/core/peer"
	nativeRelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
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
	"libp2p-circuit-v2",
	"station-route-attestation-v1",
}

func (s *Service) PublishStationRoute(
	ctx context.Context,
	identity domain.NodeIdentity,
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
	enrollment, err := s.authenticateNodeIdentity(ctx, identity)
	if err != nil {
		return nil, err
	}
	if statement.GetNodePeerId() != enrollment.NodePeerID {
		return nil, ErrRouteAttestationInvalid
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(attestation)
	if err != nil {
		return nil, fmt.Errorf("marshal Station route attestation: %w", err)
	}
	nodePeerID, err := peer.Decode(statement.GetNodePeerId())
	if err != nil {
		return nil, ErrRouteAttestationInvalid
	}
	if err := s.repo.UpdateEnrollmentStatus(
		ctx,
		identity.StationPeerID,
		identity.Generation,
		domain.EnrollmentStatusOnline,
	); err != nil {
		return nil, err
	}
	if err := s.admission.PublishRoute(nativeRelay.RouteAdmission{
		NodePeerID: nodePeerID,
		Generation: statement.GetRouteGeneration(),
		Public: statement.GetVisibility() ==
			peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC,
		ExpiresAt: time.UnixMilli(statement.GetExpiresAtUnixMs()).UTC(),
	}); err != nil {
		_ = s.repo.UpdateEnrollmentStatus(
			ctx,
			identity.StationPeerID,
			identity.Generation,
			domain.EnrollmentStatusOffline,
		)
		return nil, ErrRouteAttestationInvalid
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
		NodePeerID:       statement.GetNodePeerId(),
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
	identity domain.NodeIdentity,
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
	if _, err := s.authenticateNodeIdentity(ctx, identity); err != nil {
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
			req.GetSourcePeerId(),
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
	sourcePeerIDValue string,
	now time.Time,
) (*peerpb.StationRouteAttestation, peerpb.AccessEndpointOutcome) {
	sourcePeerID, err := peer.Decode(strings.TrimSpace(sourcePeerIDValue))
	if err != nil {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}
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
	verifiedGrant, err := peerpb.VerifyStationConnectionGrant(grant, now)
	if err != nil {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}
	statement = verifiedGrant.Statement
	if statement.GetMaxUses() == 0 ||
		statement.GetMaxUses() > domain.MaxConnectionGrantUses ||
		expiresAt.Sub(issuedAt) <= 0 ||
		expiresAt.Sub(issuedAt) > domain.MaxConnectionGrantLifetime {
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
	destinationPeerID, err := peer.Decode(route.NodePeerID)
	if err != nil || s.admission.Permit(nativeRelay.ConnectPermit{
		SourcePeerID:      sourcePeerID,
		DestinationPeerID: destinationPeerID,
		Generation:        route.RouteGeneration,
		RemainingUses:     1,
		ExpiresAt:         record.ExpiresAt,
	}) != nil {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}
	record.RemainingUses--
	s.grants[digest] = record
	attestation := &peerpb.StationRouteAttestation{}
	if err := proto.Unmarshal(route.AttestationBytes, attestation); err != nil {
		return nil, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_INVALID_STATION_ATTESTATION
	}
	return attestation, peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_READY
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
	enrollment, err := s.repo.GetEnrollmentByStationPeerID(ctx, route.StationPeerID)
	return err == nil &&
		enrollment.Status != domain.EnrollmentStatusRevoked &&
		enrollment.Generation == route.RouteGeneration &&
		enrollment.NodePeerID == route.NodePeerID &&
		enrollment.NodeAuthorizationUntil.After(s.now()) &&
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
