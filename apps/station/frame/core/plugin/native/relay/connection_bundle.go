package relay

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
)

// IssueConnectionBundle gives each live Relay its own fresh grant. A failed
// target cannot cause another target's grant or reservation to be reused.
func (c *StationControl) IssueConnectionBundle(ctx context.Context, request ConnectionMaterialRequest, limit int) ([]*ConnectionMaterial, error) {
	if c == nil || limit < 1 || limit > 4 {
		return nil, ErrInvalidConnectionMaterialRequest
	}
	c.lock.Lock()
	routes := c.liveRoutes(time.Now().UTC())
	ids := make([]peer.ID, 0, len(routes))
	for _, route := range routes {
		ids = append(ids, route.RelayPeerID)
	}
	c.lock.Unlock()
	sort.Slice(ids, func(i, j int) bool { return ids[i].String() < ids[j].String() })
	var materials []*ConnectionMaterial
	for _, id := range ids {
		if len(materials) == limit {
			break
		}
		candidate := request
		candidate.RelayPeerID = id
		candidate.RouteID = ""
		material, err := c.IssueConnectionMaterial(ctx, candidate)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if errors.Is(err, ErrInvalidConnectionMaterialRequest) {
				return nil, err
			}
			// Availability, trust and control failures belong to this target.
			// Never reuse its material; later candidates remain independent.
			continue
		}
		materials = append(materials, material)
	}
	if len(materials) == 0 {
		return nil, ErrConnectionMaterialUnavailable
	}
	return materials, nil
}
