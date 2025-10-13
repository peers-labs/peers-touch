package v1

import (
	"context"
	"time"

	discoverypb "github.com/dirty-bro-tech/peers-touch-go/model/v2/discovery"
	identitypb "github.com/dirty-bro-tech/peers-touch-go/model/v2/identity"
)

// ResourceID represents a unique identifier for a discoverable resource.
type ResourceID string

// ServiceID represents a unique identifier for a node.
type ServiceID string

// ResourceType represents the type of a discoverable resource.
type ResourceType string

const (
	ResourceTypePeer    ResourceType = "peer"
	ResourceTypeService ResourceType = "node"
	ResourceTypeContent ResourceType = "content"
	ResourceTypeTopic   ResourceType = "topic"
	ResourceTypeFile    ResourceType = "file"
)

// DiscoveryScope represents the scope of discovery operations.
type DiscoveryScope string

const (
	ScopeLocal  DiscoveryScope = "local"  // Local network only
	ScopeRegion DiscoveryScope = "region" // Regional network
	ScopeGlobal DiscoveryScope = "global" // Global network
)

// ResourceInfo contains metadata about a discoverable resource.
type ResourceInfo struct {
	ID          ResourceID             `json:"id"`
	Type        ResourceType           `json:"type"`
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	Owner       *identitypb.IdentityID `json:"owner"`
	Addresses   []string               `json:"addresses"`
	Metadata    map[string]string      `json:"metadata,omitempty"`
	Tags        []string               `json:"tags,omitempty"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	ExpiresAt   *time.Time             `json:"expires_at,omitempty"`
	Signature   *identitypb.Signature  `json:"signature,omitempty"`
}

// ServiceInfo contains metadata about a discoverable node.
type ServiceInfo struct {
	ID          ServiceID              `json:"id"`
	Name        string                 `json:"name"`
	Version     string                 `json:"version"`
	Description string                 `json:"description,omitempty"`
	Provider    *identitypb.IdentityID `json:"provider"`
	Endpoints   []string               `json:"endpoints"`
	Protocol    string                 `json:"protocol"`
	Metadata    map[string]string      `json:"metadata,omitempty"`
	Tags        []string               `json:"tags,omitempty"`
	Health      string                 `json:"health"` // "healthy", "degraded", "unhealthy"
	Load        float64                `json:"load"`   // 0.0 to 1.0
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	ExpiresAt   *time.Time             `json:"expires_at,omitempty"`
}

// PeerInfo contains metadata about a discoverable peer.
type PeerInfo struct {
	ID         *identitypb.IdentityID `json:"id"`
	Addresses  []string               `json:"addresses"`
	Protocols  []string               `json:"protocols"`
	Services   []ServiceID            `json:"services"`
	Metadata   map[string]string      `json:"metadata,omitempty"`
	Tags       []string               `json:"tags,omitempty"`
	LastSeen   time.Time              `json:"last_seen"`
	IsOnline   bool                   `json:"is_online"`
	Reputation float64                `json:"reputation"` // 0.0 to 1.0
	Distance   int                    `json:"distance"`   // Network hops
}

// QueryFilter represents filters for discovery queries.
type QueryFilter struct {
	Type        ResourceType           `json:"type,omitempty"`
	Tags        []string               `json:"tags,omitempty"`
	Metadata    map[string]string      `json:"metadata,omitempty"`
	Owner       *identitypb.IdentityID `json:"owner,omitempty"`
	MinDistance *int                   `json:"min_distance,omitempty"`
	MaxDistance *int                   `json:"max_distance,omitempty"`
	OnlineOnly  bool                   `json:"online_only,omitempty"`
}

// QueryOptions contains options for discovery queries.
type QueryOptions struct {
	Scope        DiscoveryScope `json:"scope,omitempty"`
	Limit        int            `json:"limit,omitempty"`
	Timeout      time.Duration  `json:"timeout,omitempty"`
	SortBy       string         `json:"sort_by,omitempty"`    // "distance", "reputation", "last_seen"
	SortOrder    string         `json:"sort_order,omitempty"` // "asc", "desc"
	IncludeStale bool           `json:"include_stale,omitempty"`
}

// AnnounceOptions contains options for announcing resources.
type AnnounceOptions struct {
	Scope    DiscoveryScope    `json:"scope,omitempty"`
	TTL      time.Duration     `json:"ttl,omitempty"`
	Replicas int               `json:"replicas,omitempty"`
	Priority int               `json:"priority,omitempty"`
	Metadata map[string]string `json:"metadata,omitempty"`
}

// IndexEntry represents an entry in the discovery index.
type IndexEntry struct {
	Key       string                 `json:"key"`
	Value     []byte                 `json:"value"`
	Type      ResourceType           `json:"type"`
	Owner     *identitypb.IdentityID `json:"owner"`
	Metadata  map[string]string      `json:"metadata,omitempty"`
	CreatedAt time.Time              `json:"created_at"`
	ExpiresAt *time.Time             `json:"expires_at,omitempty"`
}

// DiscoveryClient provides methods for querying and discovering resources.
type DiscoveryClient interface {
	// Query searches for resources based on the provided filter and options.
	Query(ctx context.Context, req *discoverypb.QueryRequest) (*discoverypb.QueryResponse, error)

	// FindPeers searches for peers based on the provided criteria.
	FindPeers(ctx context.Context, req *discoverypb.FindPeersRequest) (*discoverypb.FindPeersResponse, error)

	// Announce announces a resource to the discovery network.
	Announce(ctx context.Context, req *discoverypb.AnnounceRequest) (*discoverypb.AnnounceResponse, error)

	// Withdraw removes a resource from the discovery network.
	Withdraw(ctx context.Context, resourceID *discoverypb.ResourceID) error

	// Subscribe subscribes to discovery events for specific resource types or filters.
	Subscribe(ctx context.Context, filter *discoverypb.QueryFilter) (<-chan *discoverypb.ResourceInfo, error)

	// Unsubscribe cancels a subscription to discovery events.
	Unsubscribe(ctx context.Context, subscriptionID string) error
}

// Index provides methods for indexing and searching resources.
type Index interface {
	// Add adds a resource to the index.
	Add(ctx context.Context, resource *discoverypb.ResourceInfo) error

	// Remove removes a resource from the index.
	Remove(ctx context.Context, resourceID *discoverypb.ResourceID) error

	// Update updates a resource in the index.
	Update(ctx context.Context, req *discoverypb.IndexUpdateRequest) error

	// Search searches the index for resources matching the query.
	Search(ctx context.Context, req *discoverypb.QueryRequest) (*discoverypb.QueryResponse, error)

	// GetStats returns statistics about the index.
	GetStats(ctx context.Context) (*discoverypb.IndexStats, error)

	// Rebuild rebuilds the entire index.
	Rebuild(ctx context.Context) error
}

// RoutingTable manages the routing information for peer discovery.
type RoutingTable interface {
	// AddPeer adds a peer to the routing table.
	AddPeer(ctx context.Context, peer *discoverypb.PeerInfo) error

	// RemovePeer removes a peer from the routing table.
	RemovePeer(ctx context.Context, peerID *identitypb.IdentityID) error

	// FindClosestPeers finds the closest peers to a given resource ID.
	FindClosestPeers(ctx context.Context, resourceID *discoverypb.ResourceID, count int) ([]*discoverypb.PeerInfo, error)

	// GetPeer retrieves information about a specific peer.
	GetPeer(ctx context.Context, peerID *identitypb.IdentityID) (*discoverypb.PeerInfo, error)

	// ListPeers lists all peers in the routing table.
	ListPeers(ctx context.Context, req *discoverypb.ListPeersRequest) (*discoverypb.ListPeersResponse, error)

	// UpdatePeer updates peer information in the routing table.
	UpdatePeer(ctx context.Context, peer *discoverypb.PeerInfo) error

	// Ping pings a peer to check if it's still alive.
	Ping(ctx context.Context, peerID *identitypb.IdentityID) error
}

// DiscoveryManager coordinates all discovery-related operations.
type DiscoveryManager interface {
	// RegisterService registers a node for discovery.
	RegisterService(ctx context.Context, req *discoverypb.RegisterServiceRequest) (*discoverypb.RegisterServiceResponse, error)

	// UnregisterService unregisters a node from discovery.
	UnregisterService(ctx context.Context, serviceID *discoverypb.ServiceID) error

	// Heartbeat sends a heartbeat for a registered node.
	Heartbeat(ctx context.Context, req *discoverypb.HeartbeatRequest) (*discoverypb.HeartbeatResponse, error)

	// GetClient returns a discovery client for querying resources.
	GetClient() DiscoveryClient

	// GetIndex returns the discovery index.
	GetIndex() Index

	// GetRoutingTable returns the routing table.
	GetRoutingTable() RoutingTable

	// Start starts the discovery manager.
	Start(ctx context.Context) error

	// Stop stops the discovery manager.
	Stop(ctx context.Context) error

	// GetStatus returns the current status of the discovery manager.
	GetStatus(ctx context.Context) (*discoverypb.DiscoveryStatus, error)
}
