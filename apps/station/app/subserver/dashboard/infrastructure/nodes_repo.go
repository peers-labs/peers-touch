// Package infrastructure — NodesRepository surfaces P2P node information
// from the persistent peer tables for the dashboard "Nodes" page.
//
// Two complementary sources are aggregated:
//  1. touch_peer + touch_peer_address — peers persisted via station bootstrap.
//  2. registry.Registry.Query()       — live in-memory registrations.
//
// The dashboard page renders these as two distinct lists so the operator
// can tell "remembered but not currently registered" apart from "currently
// registered with this process".
//
// Created: 2026-04-21 — replaces the placeholder Nodes page.
package infrastructure

import (
	"context"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	touchdb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

// NodesRepository exposes peer-table reads to the application layer.
type NodesRepository interface {
	ListPersistedPeers(ctx context.Context) ([]domain.PersistedPeer, error)
}

type nodesRepository struct {
	db *gorm.DB
}

// NewNodesRepository constructs a GORM-backed NodesRepository.
func NewNodesRepository(db *gorm.DB) NodesRepository {
	return &nodesRepository{db: db}
}

// ListPersistedPeers returns peers stored in the local DB joined with
// their addresses (typed by transport: stun, turn-relay, http).
//
// Peers without addresses are still returned so the dashboard can show
// "registered but no addresses yet" cases honestly.
func (r *nodesRepository) ListPersistedPeers(ctx context.Context) ([]domain.PersistedPeer, error) {
	var peers []touchdb.Peer
	if err := r.db.WithContext(ctx).
		Order("updated_at DESC").
		Find(&peers).Error; err != nil {
		return nil, err
	}

	if len(peers) == 0 {
		return []domain.PersistedPeer{}, nil
	}

	peerIDs := make([]string, 0, len(peers))
	for _, p := range peers {
		if p.PeerID != "" {
			peerIDs = append(peerIDs, p.PeerID)
		}
	}

	addrByPeer := make(map[string][]domain.PeerAddressInfo, len(peerIDs))
	if len(peerIDs) > 0 {
		var addrs []touchdb.PeerAddress
		if err := r.db.WithContext(ctx).
			Where("peer_id IN ?", peerIDs).
			Find(&addrs).Error; err != nil {
			return nil, err
		}
		for _, a := range addrs {
			addrByPeer[a.PeerID] = append(addrByPeer[a.PeerID], domain.PeerAddressInfo{
				Type: a.Typ,
				Addr: a.Addr,
			})
		}
	}

	out := make([]domain.PersistedPeer, 0, len(peers))
	for _, p := range peers {
		out = append(out, domain.PersistedPeer{
			ID:        p.ID,
			PeerID:    p.PeerID,
			Name:      p.Name,
			Version:   p.Version,
			Addresses: addrByPeer[p.PeerID],
			CreatedAt: p.CreatedAt,
			UpdatedAt: p.UpdatedAt,
		})
	}
	return out, nil
}
