package bootstrap

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/bootstrapblob"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

func (s *SubServer) NetworkAuthorization(ctx context.Context) (*peerpb.StationNodeAuthorization, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return s.currentNodeAuthorization(time.Now().UTC())
}

// PublicConnectionMaterial projects the canonical discovery origin, never the
// caller's URL or a maintenance listener. The consumer still performs a fresh
// endpoint challenge before using any returned standard transport route.
func (s *SubServer) PublicConnectionMaterial(ctx context.Context, expires time.Time) (*peerpb.PublicEndpointConnectionMaterial, error) {
	authority, err := s.NetworkAuthorization(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	verified, err := peerpb.VerifyStationNodeAuthorization(authority, now)
	if err != nil || expires.UnixMilli() > verified.Statement.GetExpiresAtUnixMs() {
		return nil, bootstrapblob.ErrUnavailable
	}
	material := &peerpb.PublicEndpointConnectionMaterial{
		SchemaVersion: 1, CanonicalDiscoveryOrigin: canonicalStationOrigin(),
		ExpectedEndpointRole:         peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION,
		ExpectedEndpointIdentity:     verified.Statement.GetStationPeerId(),
		ExpectedStationRootPublicKey: authority.GetStationRootPublicKey(),
		IssuedAtUnixMs:               now.UnixMilli(), ExpiresAtUnixMs: expires.UnixMilli(),
	}
	if _, err := peerpb.VerifyPublicEndpointConnectionMaterial(material, true, now); err != nil {
		return nil, bootstrapblob.ErrUnavailable
	}
	return material, nil
}
