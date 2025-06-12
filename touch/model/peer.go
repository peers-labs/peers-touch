package model

import (
	"errors"
	"net"
	"strings"
)

// Predefined valid types for peer address
var validAddrTypes = []string{"stun", "turn", "http"}

type PeerAddressParam struct {
	Params

	// PeerID is the unique identifier of the peer.
	PeerID string `json:"peer_id" form:"peer_id"`
	// Addr is the address of the peer.
	Addr string `json:"addr" form:"addr"`
	// Typ is the type of the peer address.
	Typ string `json:"typ" form:"typ"`
}

// Check validates the PeerAddressParam fields.
// It checks if the Addr is a valid network address and Typ is one of the predefined valid types.
func (p *PeerAddressParam) Check() error {
	if p.Addr == "" {
		return errors.New("peer address cannot be empty")
	}

	// Check if Addr is a valid IP:port or host:port
	_, _, err := net.SplitHostPort(strings.TrimSpace(p.Addr))
	if err != nil {
		return errors.New("invalid peer address format, expected host:port or ip:port")
	}

	if p.Typ == "" {
		return errors.New("peer address type cannot be empty")
	}

	// Check if Typ is one of the valid types
	typ := strings.ToLower(strings.TrimSpace(p.Typ))
	for _, validType := range validAddrTypes {
		if typ == validType {
			return nil
		}
	}

	return errors.New("invalid peer address type")
}
