package relayclient

import (
	"context"
	"fmt"
	"time"

	federationcore "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

const defaultPeerRouteRefresh = 30 * time.Minute

func (s *SubServer) runRoutePublisher(ctx context.Context) {
	ticker := time.NewTicker(defaultPeerRouteRefresh)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.publishDefaultRoute(ctx)
		}
	}
}

func (s *SubServer) publishDefaultRoute(ctx context.Context) {
	credential, ok := s.getCredential()
	if !ok || credential.StationPeerID == "" || credential.Generation == 0 {
		return
	}
	routeID := "peer-" + credential.StationPeerID
	_, err := s.publishRoute(
		ctx,
		routeID,
		peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_GRANT_ONLY,
		defaultRouteLifetime,
	)
	if err != nil {
		logger.Warnf(ctx, "[relay-client] publish peer tunnel route: %v", err)
	}
}

func (s *SubServer) publishRoute(
	ctx context.Context,
	routeID string,
	visibility peerpb.StationRouteVisibility,
	lifetime time.Duration,
) (*peerpb.StationRouteAttestation, error) {
	credential, ok := s.getCredential()
	if !ok || credential.Token == "" ||
		credential.StationPeerID == "" ||
		credential.RelayPeerID == "" ||
		credential.Generation == 0 {
		return nil, ErrConnectionMaterialUnavailable
	}
	s.mu.Lock()
	ingress := s.innerTLS
	s.mu.Unlock()
	if ingress == nil {
		return nil, ErrConnectionMaterialUnavailable
	}
	signer, err := s.ensureStationConnectionSigner()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	attestation, err := signer.SignStationRouteAttestation(
		&peerpb.StationRouteStatement{
			StationPeerId:      credential.StationPeerID,
			RelayPeerId:        credential.RelayPeerID,
			RouteId:            routeID,
			RouteGeneration:    credential.Generation,
			InnerTlsSpkiSha256: ingress.SPKISHA256(),
			CapabilitiesDigest: federationcore.PeerCapabilityManifestDigest(),
			Visibility:         visibility,
			IssuedAtUnixMs:     now.UnixMilli(),
			ExpiresAtUnixMs:    now.Add(lifetime).UnixMilli(),
		},
	)
	if err != nil {
		return nil, fmt.Errorf("sign Station route attestation: %w", err)
	}
	published := &peerpb.PublishStationRouteResponse{}
	if err := s.postProto(
		ctx,
		"/api/v1/relay/routes",
		credential.Token,
		&peerpb.PublishStationRouteRequest{RouteAttestation: attestation},
		published,
	); err != nil {
		return nil, fmt.Errorf("publish Station route: %w", err)
	}
	if published.GetRouteId() != routeID ||
		published.GetRouteGeneration() != credential.Generation {
		return nil, fmt.Errorf("Relay published a different Station route")
	}
	s.routeMu.Lock()
	if s.publishedRoutes == nil {
		s.publishedRoutes = make(map[string]uint64)
	}
	s.publishedRoutes[routeID] = credential.Generation
	s.routeMu.Unlock()
	return attestation, nil
}

func (s *SubServer) routeIsPublished(routeID string, generation uint64) bool {
	s.routeMu.RLock()
	current := s.publishedRoutes[routeID]
	s.routeMu.RUnlock()
	return current != 0 && current == generation
}

func (s *SubServer) clearPublishedRoutes() {
	s.routeMu.Lock()
	clear(s.publishedRoutes)
	s.routeMu.Unlock()
}
