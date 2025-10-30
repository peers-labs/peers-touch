package types

import (
	"crypto/sha256"
	"encoding/base32"
	"fmt"
	"strings"
)

// NetworkID is the tracking identifier for peers-touch network
// Encoding format: v{version}-{type}-{hash}
// Example: v1-p-abc123def456, v1-n-bootstrap@abc123
// Total length does not exceed 48 characters
type NetworkID struct {
	Version byte   `json:"version"` // Version number (1-255)
	Type    byte   `json:"type"`    // Type: 'p'=peer, 'n'=node
	Hash    []byte `json:"hash"`    // Hash digest (20 bytes)
}

// Type constants
const (
	TypePeer byte = 'p'
	TypeNode byte = 'n'
)

// Version constants
const (
	Version1 byte = 1
)
// String encodes to string (base32 encoding, total length <= 48 characters)
func (n *NetworkID) String() string {
	// Version and type prefix: v{version}-{type}-
	prefix := fmt.Sprintf("v%d-%c-", n.Version, n.Type)
	
	// Hash part encoded in base32 (no padding)
	hashStr := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(n.Hash)
	
	// Ensure total length does not exceed 48 characters
	maxHashLen := 48 - len(prefix)
	if len(hashStr) > maxHashLen {
		hashStr = hashStr[:maxHashLen]
	}
	
	return prefix + hashStr
}

// ParseNetworkID parses from string
func ParseNetworkID(id string) (*NetworkID, error) {
	// Check format: v{version}-{type}-{hash}
	if !strings.HasPrefix(id, "v") {
		return nil, fmt.Errorf("invalid network id format: missing version prefix")
	}
	
	parts := strings.SplitN(id, "-", 3)
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid network id format: expected 3 parts")
	}
	
	// Parse version
	if len(parts[0]) < 2 || parts[0][0] != 'v' {
		return nil, fmt.Errorf("invalid version format")
	}
	version := byte(parts[0][1] - '0')
	
	// Parse type
	if len(parts[1]) != 1 {
		return nil, fmt.Errorf("invalid type format")
	}
	typeChar := byte(parts[1][0])
	if typeChar != TypePeer && typeChar != TypeNode {
		return nil, fmt.Errorf("invalid type: %c", typeChar)
	}
	
	// Parse hash
	hash, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("invalid hash encoding: %w", err)
	}
	
	return &NetworkID{
		Version: version,
		Type:    typeChar,
		Hash:    hash,
	}, nil
}

// NewPeerNetworkID generates peer network_id
func NewPeerNetworkID(peerID string) *NetworkID {
	hash := sha256.Sum256([]byte(peerID))
	return &NetworkID{
		Version: Version1,
		Type:    TypePeer,
		Hash:    hash[:20], // Take first 20 bytes
	}
}

// NewNodeNetworkID generates node network_id
func NewNodeNetworkID(peerID, nodeType, nodeID string) *NetworkID {
	// Combine peer and node information to generate hash
	content := fmt.Sprintf("%s:%s:%s", peerID, nodeType, nodeID)
	hash := sha256.Sum256([]byte(content))
	
	return &NetworkID{
		Version: Version1,
		Type:    TypeNode,
		Hash:    hash[:20], // Take first 20 bytes
	}
}

// Utility methods
func (n *NetworkID) IsPeer() bool {
	return n.Type == TypePeer
}

func (n *NetworkID) IsNode() bool {
	return n.Type == TypeNode
}

// ExtractPeerID extracts peer network_id from node network_id
func (n *NetworkID) ExtractPeerID() string {
	if n.Type == TypePeer {
		return n.String()
	}
	
	// For node type, we need to store additional mapping
	// Return peer network_id format here
	peerHash := n.Hash[:10] // Take first 10 bytes as peer hash
	peerID := &NetworkID{
		Version: n.Version,
		Type:    TypePeer,
		Hash:    peerHash,
	}
	return peerID.String()
}

// IsValid checks if network_id is valid
func (n *NetworkID) IsValid() bool {
	return n.Version >= Version1 && (n.Type == TypePeer || n.Type == TypeNode) && len(n.Hash) > 0
}

// Equal compares two network_ids for equality
func (n *NetworkID) Equal(other *NetworkID) bool {
	if n == nil || other == nil {
		return n == other
	}
	return n.Version == other.Version && n.Type == other.Type && string(n.Hash) == string(other.Hash)
}
