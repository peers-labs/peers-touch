package relay

import (
	"fmt"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

type NodeAdmission struct {
	StationPeerID string
	NodePeerID    peer.ID
	Generation    uint64
	ExpiresAt     time.Time
}

type RouteAdmission struct {
	NodePeerID peer.ID
	Generation uint64
	Public     bool
	ExpiresAt  time.Time
}

type ConnectPermit struct {
	PermitID          string
	SourcePeerID      peer.ID
	DestinationPeerID peer.ID
	Generation        uint64
	ExpiresAt         time.Time
}

type admissionNode struct {
	stationPeerID string
	generation    uint64
	expiresAt     time.Time
	route         *RouteAdmission
}

type permitKey struct {
	source      peer.ID
	destination peer.ID
}

type Admission struct {
	lock    sync.Mutex
	host    host.Host
	nodes   map[peer.ID]admissionNode
	permits map[permitKey]map[string]ConnectPermit
	now     func() time.Time
}

func NewAdmission() *Admission {
	return &Admission{
		nodes:   make(map[peer.ID]admissionNode),
		permits: make(map[permitKey]map[string]ConnectPermit),
		now:     func() time.Time { return time.Now().UTC() },
	}
}

func (a *Admission) AttachHost(value host.Host) error {
	if a == nil || value == nil {
		return fmt.Errorf("Relay admission requires a P2P Kernel Host")
	}
	a.lock.Lock()
	defer a.lock.Unlock()
	if a.host != nil {
		return fmt.Errorf("Relay admission already has a Host")
	}
	a.host = value
	return nil
}

func (a *Admission) AdmitNode(input NodeAdmission) error {
	if a == nil || input.StationPeerID == "" || input.NodePeerID == "" ||
		input.Generation == 0 || !input.ExpiresAt.After(a.now()) {
		return fmt.Errorf("Relay node admission is invalid")
	}
	a.lock.Lock()
	defer a.lock.Unlock()
	current := a.nodes[input.NodePeerID]
	if current.stationPeerID != "" &&
		(current.stationPeerID != input.StationPeerID ||
			current.generation > input.Generation) {
		return fmt.Errorf("Relay node admission conflicts with current enrollment")
	}
	if current.generation != input.Generation {
		current.route = nil
		a.deletePermitsForDestinationLocked(input.NodePeerID)
	}
	current.stationPeerID = input.StationPeerID
	current.generation = input.Generation
	current.expiresAt = input.ExpiresAt.UTC()
	a.nodes[input.NodePeerID] = current
	return nil
}

func (a *Admission) PublishRoute(input RouteAdmission) error {
	if a == nil || input.NodePeerID == "" || input.Generation == 0 ||
		!input.ExpiresAt.After(a.now()) {
		return fmt.Errorf("Relay route admission is invalid")
	}
	a.lock.Lock()
	defer a.lock.Unlock()
	current, ok := a.nodes[input.NodePeerID]
	if !ok || current.generation != input.Generation ||
		!current.expiresAt.After(a.now()) {
		return fmt.Errorf("Relay route does not belong to an admitted node")
	}
	route := input
	route.ExpiresAt = route.ExpiresAt.UTC()
	current.route = &route
	a.nodes[input.NodePeerID] = current
	return nil
}

func (a *Admission) Permit(input ConnectPermit) error {
	if a == nil || input.PermitID == "" ||
		input.SourcePeerID == "" ||
		input.DestinationPeerID == "" ||
		input.SourcePeerID == input.DestinationPeerID ||
		input.Generation == 0 ||
		!input.ExpiresAt.After(a.now()) {
		return fmt.Errorf("Relay connect permit is invalid")
	}
	a.lock.Lock()
	defer a.lock.Unlock()
	destination, ok := a.nodes[input.DestinationPeerID]
	if !ok || destination.generation != input.Generation ||
		destination.route == nil ||
		destination.route.Generation != input.Generation ||
		!destination.route.ExpiresAt.After(a.now()) ||
		!destination.expiresAt.After(a.now()) {
		return fmt.Errorf("Relay permit destination is unavailable")
	}
	input.ExpiresAt = input.ExpiresAt.UTC()
	key := permitKey{
		source:      input.SourcePeerID,
		destination: input.DestinationPeerID,
	}
	bucket := a.permits[key]
	if bucket == nil {
		bucket = make(map[string]ConnectPermit)
	}
	if current, ok := bucket[input.PermitID]; ok {
		if current.SourcePeerID != input.SourcePeerID ||
			current.DestinationPeerID != input.DestinationPeerID ||
			current.Generation != input.Generation ||
			!current.ExpiresAt.Equal(input.ExpiresAt) {
			return fmt.Errorf("Relay connect permit conflicts with current authorization")
		}
		return nil
	}
	bucket[input.PermitID] = input
	a.permits[key] = bucket
	return nil
}

func (a *Admission) RevokeNode(nodePeerID peer.ID) error {
	if a == nil || nodePeerID == "" {
		return fmt.Errorf("Relay revocation Node PeerID is invalid")
	}
	a.lock.Lock()
	delete(a.nodes, nodePeerID)
	a.deletePermitsForDestinationLocked(nodePeerID)
	valueHost := a.host
	a.lock.Unlock()
	if valueHost == nil {
		return nil
	}
	return valueHost.Network().ClosePeer(nodePeerID)
}

func (a *Admission) AllowReserve(
	nodePeerID peer.ID,
	_ multiaddr.Multiaddr,
) bool {
	if a == nil {
		return false
	}
	a.lock.Lock()
	defer a.lock.Unlock()
	now := a.now()
	a.removeExpiredLocked(now)
	node, ok := a.nodes[nodePeerID]
	return ok && node.expiresAt.After(now)
}

func (a *Admission) AllowConnect(
	sourcePeerID peer.ID,
	_ multiaddr.Multiaddr,
	destinationPeerID peer.ID,
) bool {
	if a == nil || sourcePeerID == "" || destinationPeerID == "" {
		return false
	}
	a.lock.Lock()
	defer a.lock.Unlock()
	now := a.now()
	a.removeExpiredLocked(now)
	destination, ok := a.nodes[destinationPeerID]
	if !ok || destination.route == nil ||
		!destination.expiresAt.After(now) ||
		!destination.route.ExpiresAt.After(now) ||
		destination.route.Generation != destination.generation {
		return false
	}
	if destination.route.Public {
		return true
	}
	key := permitKey{
		source:      sourcePeerID,
		destination: destinationPeerID,
	}
	for _, permit := range a.permits[key] {
		if permit.Generation == destination.generation &&
			permit.ExpiresAt.After(now) {
			return true
		}
	}
	return false
}

func (a *Admission) Counts() (nodes int, routes int, permits int) {
	if a == nil {
		return 0, 0, 0
	}
	a.lock.Lock()
	defer a.lock.Unlock()
	a.removeExpiredLocked(a.now())
	for _, node := range a.nodes {
		nodes++
		if node.route != nil {
			routes++
		}
	}
	for _, bucket := range a.permits {
		permits += len(bucket)
	}
	return nodes, routes, permits
}

func (a *Admission) removeExpiredLocked(now time.Time) {
	for nodePeerID, node := range a.nodes {
		if !node.expiresAt.After(now) {
			delete(a.nodes, nodePeerID)
			a.deletePermitsForDestinationLocked(nodePeerID)
			continue
		}
		if node.route != nil && !node.route.ExpiresAt.After(now) {
			node.route = nil
			a.nodes[nodePeerID] = node
			a.deletePermitsForDestinationLocked(nodePeerID)
		}
	}
	for key, bucket := range a.permits {
		for permitID, permit := range bucket {
			if !permit.ExpiresAt.After(now) {
				delete(bucket, permitID)
			}
		}
		if len(bucket) == 0 {
			delete(a.permits, key)
		}
	}
}

func (a *Admission) deletePermitsForDestinationLocked(nodePeerID peer.ID) {
	for key := range a.permits {
		if key.destination == nodePeerID {
			delete(a.permits, key)
		}
	}
}
