package model

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Error definitions
var (
	ErrPeerAddrExists = errors.New("peer address already exists")
	ErrUndefined      = errors.New("undefined error")
)

// UndefinedError represents an undefined error
var UndefinedError = ErrUndefined

// Error creates a standard error response
func Error(message string) map[string]interface{} {
	return map[string]interface{}{
		"error":   true,
		"message": message,
	}
}

// NewSuccessResponse creates a standard success response
func NewSuccessResponse(data interface{}) map[string]interface{} {
	return map[string]interface{}{
		"success": true,
		"data":    data,
	}
}

// PeerAddressParam represents parameters for peer address
type PeerAddressParam struct {
	PeerID  string `json:"peer_id"`
	Address string `json:"address"`
	Addr    string `json:"addr"`
	Port    int    `json:"port"`
	Typ     string `json:"typ"`
}

// Check validates the PeerAddressParam
func (p *PeerAddressParam) Check() error {
	if p.PeerID == "" {
		return errors.New("peer_id is required")
	}
	if p.Address == "" {
		return errors.New("address is required")
	}
	if p.Port <= 0 {
		return errors.New("port must be positive")
	}
	return nil
}

// PeerAddrInfo represents peer address information
type PeerAddrInfo struct {
	ID      string `json:"id"`
	PeerId  string `json:"peer_id"`
	Address string `json:"address"`
	Addrs   []string `json:"addrs"`
	Port    int    `json:"port"`
}

// StreamMessage represents a message in a stream
type StreamMessage struct {
	ID        string    `json:"id"`
	Content   string    `json:"content"`
	Timestamp time.Time `json:"timestamp"`
}

// TouchHiToParam represents parameters for TouchHiTo message
type TouchHiToParam struct {
	PeerID      string `json:"peer_id"`
	PeerAddress string `json:"peer_address"`
	Message     string `json:"message"`
}

// Check validates the TouchHiToParam
func (t *TouchHiToParam) Check() error {
	if t.PeerID == "" {
		return errors.New("peer_id is required")
	}
	if t.PeerAddress == "" {
		return errors.New("peer_address is required")
	}
	if t.Message == "" {
		return errors.New("message is required")
	}
	return nil
}

// ActivityPubActor represents an ActivityPub actor
type ActivityPubActor struct {
	ID                string    `json:"id"`
	Type              string    `json:"type"`
	Name              string    `json:"name"`
	PreferredUsername string    `json:"preferredUsername"`
	Summary           string    `json:"summary"`
	InboxURL          string    `json:"inbox"`
	OutboxURL         string    `json:"outbox"`
	FollowersURL      string    `json:"followers"`
	FollowingURL      string    `json:"following"`
	LikedURL          string    `json:"liked"`
	PublicKeyPem      string    `json:"publicKey"`
	IsLocal           bool      `json:"isLocal"`
	IsActive          bool      `json:"isActive"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

// WebFingerParams represents parameters for WebFinger discovery
type WebFingerParams struct {
	Resource string   `json:"resource"`
	Username string   `json:"username"`
	Domain   string   `json:"domain"`
	Rel      []string `json:"rel,omitempty"`
}

// Check validates the WebFingerParams
func (w *WebFingerParams) Check() error {
	if w.Resource == "" {
		return errors.New("resource is required")
	}
	if w.Username == "" {
		return errors.New("username is required")
	}
	if w.Domain == "" {
		return errors.New("domain is required")
	}
	return nil
}

// WebFingerResponse represents a WebFinger response
type WebFingerResponse struct {
	Subject string                   `json:"subject"`
	Aliases []string                 `json:"aliases,omitempty"`
	Links   []WebFingerLink          `json:"links"`
}

// WebFingerLink represents a link in a WebFinger response
type WebFingerLink struct {
	Rel        string            `json:"rel"`
	Type       string            `json:"type,omitempty"`
	Href       string            `json:"href,omitempty"`
	Template   string            `json:"template,omitempty"`
	Properties map[string]string `json:"properties,omitempty"`
}

// BuildWebFingerResponse builds a WebFinger response for an ActivityPub actor
func BuildWebFingerResponse(actor *ActivityPubActor, baseURL, resource string) *WebFingerResponse {
	return &WebFingerResponse{
		Subject: resource,
		Links: []WebFingerLink{
			{
				Rel:  "self",
				Type: "application/activity+json",
				Href: actor.ID,
			},
		},
	}
}

// WebFinger relation constants
const (
	RelSelf                  = "self"
	RelProfilePage          = "http://webfinger.net/rel/profile-page"
	RelActivityPubInbox     = "https://www.w3.org/ns/activitystreams#inbox"
	RelActivityPubOutbox    = "https://www.w3.org/ns/activitystreams#outbox"
	RelActivityPubFollowers = "https://www.w3.org/ns/activitystreams#followers"
	RelActivityPubFollowing = "https://www.w3.org/ns/activitystreams#following"
)

// ParseUserDiscoveryRequest parses a WebFinger discovery request
func ParseUserDiscoveryRequest(resource string) (*WebFingerParams, error) {
	// Parse acct:username@domain format
	if !strings.HasPrefix(resource, "acct:") {
		return nil, fmt.Errorf("invalid resource format: %s", resource)
	}
	
	// Remove "acct:" prefix
	userDomain := strings.TrimPrefix(resource, "acct:")
	
	// Split username and domain
	parts := strings.Split(userDomain, "@")
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid user@domain format: %s", userDomain)
	}
	
	return &WebFingerParams{
		Username: parts[0],
		Domain:   parts[1],
	}, nil
}