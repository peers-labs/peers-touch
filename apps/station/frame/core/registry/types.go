package registry

import (
	"context"
	"time"
)

type RegisterType string

const (
	RegisterTypeComponent RegisterType = "component"
	RegisterTypeNode      RegisterType = "node"
)

// Registration registration information - V2 minimalist design
type Registration struct {
	ID         string                 // Unique identifier
	Name       string                 // Display name
	Type       RegisterType           // Type: component, node
	Namespaces []string               // Multi-namespace registration support
	Addresses  []string               // Network addresses
	Metadata   map[string]interface{} // Extended metadata
	TTL        time.Duration          // Time to live
	CreatedAt  interface{}            // Creation time, specific type determined by implementation
	UpdatedAt  interface{}            // Update time, specific type determined by implementation
}

// WatchEvent watch event - V2 design
type WatchEvent struct {
	Type         WatchEventType // Event type
	Registration *Registration  // Registration information
	Timestamp    interface{}    // Timestamp, specific type determined by implementation
	Namespace    string         // Namespace that triggered the event
}

// WatchEventType event type
type WatchEventType string

const (
	WatchEventAdd    WatchEventType = "ADD"
	WatchEventUpdate WatchEventType = "UPDATE"
	WatchEventDelete WatchEventType = "DELETE"
)

// WatchCallback watch callback
type WatchCallback func(event WatchEvent)

// Standard namespaces - V2 equality concept
const (
	// Basic namespaces
	NamespaceGlobal   = "global"
	NamespaceLocal    = "local"
	NamespaceInternal = "internal"

	// Versioned namespaces
	NamespaceV1Prefix  = "pt1"
	NamespaceV1Global  = "pt1/global"
	NamespaceV1Local   = "pt1/local"
	NamespaceV1Prod    = "pt1/prod"
	NamespaceV1Staging = "pt1/staging"
	NamespaceV1Test    = "pt1/test"

	// Component namespaces
	NamespaceV1Bootstrap = "pt1/bootstrap"
	NamespaceV1Registry  = "pt1/registry"
	NamespaceV1Turn      = "pt1/turn"

	// Backward compatibility
	DefaultPeersNetworkNamespace = "pst" // Original default namespace
)

// Station types for peer addressing
const (
	StationTypeStun      = "stun"
	StationTypeTurnRelay = "turn-relay"
	StationTypeHttp      = "http"
)

// Peer represents a peer in the network
type Peer struct {
	Name       string                 `json:"name"`
	ID         string                 `json:"id"`
	Version    string                 `json:"version"`
	Metadata   map[string]interface{} `json:"metadata"`
	EndStation map[string]*EndStation `json:"end_station,omitempty"`
}

// EndStation represents an endpoint station for a peer
type EndStation struct {
	Name       string      `json:"name"`
	Typ        string      `json:"typ"`
	NetAddress string      `json:"net_address"`
	Endpoints  []*Endpoint `json:"endpoints"`
}

// Endpoint represents a service endpoint
type Endpoint struct {
	Name string `json:"name"`
	// Add other endpoint fields as needed
}

// Node represents a node in the network
type Node struct {
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	Version      string                 `json:"version"`
	Addresses    []string               `json:"addresses"`
	Capabilities []string               `json:"capabilities"`
	Metadata     map[string]interface{} `json:"metadata"`
	Status       string                 `json:"status"`
	PublicKey    string                 `json:"public_key"`
	Port         int                    `json:"port"`
	LastSeenAt   interface{}            `json:"last_seen_at"`
	HeartbeatAt  interface{}            `json:"heartbeat_at"`
	RegisteredAt interface{}            `json:"registered_at"`
}

// NodeFilter represents filters for querying nodes
type NodeFilter struct {
	Limit        int      `json:"limit"`
	Offset       int      `json:"offset"`
	Status       []string `json:"status"`
	Capabilities []string `json:"capabilities"`
	OnlineOnly   bool     `json:"online_only"`
}

// NodeStorage interface for node storage
type NodeStorage interface {
	Register(ctx context.Context, node *Node) error
	Deregister(ctx context.Context, id string) error
	GetNode(ctx context.Context, id string) (*Node, error)
	ListNodes(ctx context.Context, filter *NodeFilter) ([]*Node, int, error)
	UpdateNode(ctx context.Context, node *Node) error
	Heartbeat(ctx context.Context, id string) error
}

// Node status constants
const (
	NodeStatusOnline   = "online"
	NodeStatusOffline  = "offline"
	NodeStatusInactive = "inactive"
)
