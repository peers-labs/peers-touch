package v1

import (
	"context"

	connectionpb "github.com/dirty-bro-tech/peers-touch-go/model/v2/connection"
)

// Connection represents a single network connection to a peer.
type Connection interface {
	// GetInfo returns metadata about this connection.
	GetInfo() *connectionpb.ConnectionInfo
	
	// Close closes the connection gracefully.
	Close(ctx context.Context) error
	
	// Ping sends a ping to test connectivity and measure latency.
	Ping(ctx context.Context) (*connectionpb.PingResponse, error)
}

// Link represents a logical link that may use multiple connections.
type Link interface {
	// GetInfo returns metadata about this link.
	GetInfo() *connectionpb.LinkInfo
	
	// Close closes the link and all its connections.
	Close(ctx context.Context) error
	
	// Ping sends a ping through the best available connection.
	Ping(ctx context.Context) (*connectionpb.PingResponse, error)
}

// ConnectionManager manages individual network connections.
type ConnectionManager interface {
	// Connect establishes a new connection to the specified address.
	Connect(ctx context.Context, req *connectionpb.ConnectRequest) (*connectionpb.ConnectResponse, error)
	
	// List returns all active connections.
	List(ctx context.Context, req *connectionpb.ListConnectionsRequest) (*connectionpb.ListConnectionsResponse, error)
	
	// Get returns a specific connection by ID.
	Get(ctx context.Context, id *connectionpb.ConnectionID) (Connection, error)
	
	// Close closes a specific connection.
	Close(ctx context.Context, req *connectionpb.CloseConnectionRequest) error
}

// LinkManager manages logical links between peers.
type LinkManager interface {
	// Establish creates a new link to the specified peer.
	Establish(ctx context.Context, req *connectionpb.EstablishLinkRequest) (*connectionpb.EstablishLinkResponse, error)
	
	// List returns all active links.
	List(ctx context.Context, req *connectionpb.ListLinksRequest) (*connectionpb.ListLinksResponse, error)
	
	// Get returns a specific link by ID.
	Get(ctx context.Context, id *connectionpb.LinkID) (Link, error)
	
	// Close closes a specific link.
	Close(ctx context.Context, req *connectionpb.CloseLinkRequest) error
}
