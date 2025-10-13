package model

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Error definitions
var (
	ErrPeerAddrExists            = errors.New("peer address already exists")
	ErrUndefined                 = errors.New("undefined error")
	ErrActorActorExists         = errors.New("actor already exists")
	ErrActorNotFound            = errors.New("actor not found")
	ErrActorInvalidCredentials  = errors.New("invalid credentials")
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
// Deprecated: Use BuildWebFingerResponseFromModel instead
func BuildWebFingerResponse(actor *ActivityPubActor, baseURL, resource string) *WebFingerResponse {
	return BuildWebFingerResponseFromModel(actor, baseURL, resource)
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

// ActorSignParams represents parameters for actor signup
type ActorSignParams struct {
	Name     string `json:"name" binding:"required"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
}

// Check validates the ActorSignParams
func (a *ActorSignParams) Check() error {
	if a.Name == "" {
		return errors.New("name is required")
	}
	if a.Email == "" {
		return errors.New("email is required")
	}
	if a.Password == "" {
		return errors.New("password is required")
	}
	if len(a.Password) < 6 {
		return errors.New("password must be at least 6 characters")
	}
	return nil
}

// ActorLoginParams represents parameters for actor login
type ActorLoginParams struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// Check validates the ActorLoginParams
func (a *ActorLoginParams) Check() error {
	if a.Email == "" {
		return errors.New("email is required")
	}
	if a.Password == "" {
		return errors.New("password is required")
	}
	return nil
}

// ProfileGetResponse represents the response for getting a profile
type ProfileGetResponse struct {
	ProfilePhoto string `json:"profile_photo"`
	Name         string `json:"name"`
	Gender       string `json:"gender"`
	Region       string `json:"region"`
	Email        string `json:"email"`
	PeersID      string `json:"peers_id"`
	WhatsUp      string `json:"whats_up"`
}

// ProfileUpdateParams represents parameters for updating a profile
type ProfileUpdateParams struct {
	ProfilePhoto *string `json:"profile_photo,omitempty"`
	Gender       *string `json:"gender,omitempty"`
	Region       *string `json:"region,omitempty"`
	Email        *string `json:"email,omitempty"`
	WhatsUp      *string `json:"whats_up,omitempty"`
}

// Validate validates the ProfileUpdateParams
func (p *ProfileUpdateParams) Validate() error {
	// At least one field must be provided for update
	if p.ProfilePhoto == nil && p.Gender == nil && p.Region == nil && 
		p.Email == nil && p.WhatsUp == nil {
		return errors.New("at least one field must be provided for update")
	}
	return nil
}

// PageData represents paginated data response
type PageData[T any] struct {
	Total int `json:"total"`
	List  []T `json:"list"`
	No    int `json:"no"`
}

// NewError creates a new error with code and message
func NewError(code, message string) error {
	return fmt.Errorf("[%s] %s", code, message)
}