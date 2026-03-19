package types

import (
	"time"
)

// Peer is the deployment unit in peers-touch network - the smallest deployment entity
type Peer struct {
	// Deployment unit identifier
	ID        string                 `json:"id" yaml:"id"`                                   // peers-touch deployment unit ID
	NetworkID *NetworkID             `json:"network_id" yaml:"network_id"`                   // Network tracking ID
	Nodes     []Node                 `json:"nodes" yaml:"nodes"`                             // Node service list
	Name      string                 `json:"name" yaml:"name"`                               // Deployment unit name
	Version   string                 `json:"version" yaml:"version"`                         // Version
	Metadata  map[string]interface{} `json:"metadata,omitempty" yaml:"metadata,omitempty"`   // Extended metadata
	Timestamp time.Time              `json:"timestamp" yaml:"timestamp"`                     // Timestamp
	Signature []byte                 `json:"signature,omitempty" yaml:"signature,omitempty"` // Signature
}

// Node is the node service under deployment unit
type Node struct {
	ID        string     `json:"id" yaml:"id"`                 // Node service ID
	Type      string     `json:"type" yaml:"type"`             // Service type: bootstrap, registry, turn, http, storage
	NetworkID *NetworkID `json:"network_id" yaml:"network_id"` // Node network ID

	Name      string   `json:"name" yaml:"name"`                     // Node name
	Addresses []string `json:"addresses" yaml:"addresses"`           // Service addresses (relative to Peer addresses)
	Port      int      `json:"port,omitempty" yaml:"port,omitempty"` // Service port

	Priority int                    `json:"priority" yaml:"priority"`                     // Service priority
	Weight   int                    `json:"weight" yaml:"weight"`                         // Load weight
	Metadata map[string]interface{} `json:"metadata,omitempty" yaml:"metadata,omitempty"` // Service metadata
}
