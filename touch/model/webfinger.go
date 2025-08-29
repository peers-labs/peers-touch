package model

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

// WebFingerResponse represents the standard WebFinger response format
// as defined in RFC 7033: https://tools.ietf.org/html/rfc7033
type WebFingerResponse struct {
	// Subject is the URI that was queried (e.g., "acct:alice@example.com")
	Subject string `json:"subject"`

	// Aliases are alternative URIs that identify the same entity
	Aliases []string `json:"aliases,omitempty"`

	// Properties are name-value pairs that describe the subject
	Properties map[string]string `json:"properties,omitempty"`

	// Links are typed connections to related resources
	Links []WebFingerLink `json:"links,omitempty"`
}

// WebFingerLink represents a link in a WebFinger response
type WebFingerLink struct {
	// Rel is the relationship type (e.g., "self", "profile", "http://webfinger.net/rel/profile-page")
	Rel string `json:"rel"`

	// Type is the media type of the linked resource (e.g., "application/activity+json")
	Type string `json:"type,omitempty"`

	// Href is the URI of the linked resource
	Href string `json:"href,omitempty"`

	// Template is a URI template for the linked resource
	Template string `json:"template,omitempty"`

	// Properties are additional properties for the link
	Properties map[string]string `json:"properties,omitempty"`

	// Titles provide human-readable descriptions in various languages
	Titles map[string]string `json:"titles,omitempty"`
}

// ActivityPubActor represents an ActivityPub actor for WebFinger discovery
type ActivityPubActor struct {
	// ID is the unique identifier for the actor (ActivityPub ID)
	ID string `json:"id"`

	// Type is the actor type (Person, Service, Group, etc.)
	Type string `json:"type"`

	// PreferredUsername is the actor's preferred username
	PreferredUsername string `json:"preferredUsername"`

	// Name is the actor's display name
	Name string `json:"name,omitempty"`

	// Summary is a brief description of the actor
	Summary string `json:"summary,omitempty"`

	// Icon represents the actor's avatar/profile picture
	Icon *ActivityPubImage `json:"icon,omitempty"`

	// Image represents the actor's header/banner image
	Image *ActivityPubImage `json:"image,omitempty"`

	// Inbox is the actor's inbox endpoint
	Inbox string `json:"inbox"`

	// Outbox is the actor's outbox endpoint
	Outbox string `json:"outbox"`

	// Followers is the actor's followers collection endpoint
	Followers string `json:"followers,omitempty"`

	// Following is the actor's following collection endpoint
	Following string `json:"following,omitempty"`

	// Liked is the actor's liked collection endpoint
	Liked string `json:"liked,omitempty"`

	// PublicKey contains the actor's public key for HTTP signatures
	PublicKey *ActivityPubPublicKey `json:"publicKey,omitempty"`

	// Endpoints contains additional endpoints
	Endpoints map[string]string `json:"endpoints,omitempty"`

	// CreatedAt is when the actor was created
	CreatedAt time.Time `json:"published,omitempty"`

	// UpdatedAt is when the actor was last updated
	UpdatedAt time.Time `json:"updated,omitempty"`
}

// ActivityPubImage represents an image in ActivityPub
type ActivityPubImage struct {
	Type      string `json:"type"`
	URL       string `json:"url"`
	MediaType string `json:"mediaType,omitempty"`
}

// ActivityPubPublicKey represents a public key for HTTP signatures
type ActivityPubPublicKey struct {
	ID           string `json:"id"`
	Owner        string `json:"owner"`
	PublicKeyPem string `json:"publicKeyPem"`
}

// UserDiscoveryRequest represents a request to discover a user
type UserDiscoveryRequest struct {
	// Resource is the WebFinger resource identifier (e.g., "acct:alice@example.com")
	Resource WebFingerResource `json:"resource"`

	// Domain is the domain part of the resource (extracted from resource)
	Domain string `json:"domain"`

	// Username is the username part of the resource (extracted from resource)
	Username string `json:"username"`

	// RequestedRels are the specific relationship types requested
	RequestedRels []string `json:"rel,omitempty"`
}

// ParseUserDiscoveryRequest parses a WebFinger resource into a UserDiscoveryRequest
func ParseUserDiscoveryRequest(resource WebFingerResource, rels []string) (*UserDiscoveryRequest, error) {
	if err := resource.Validate(); err != nil {
		return nil, err
	}

	// Parse acct:username@domain format
	value := resource.Value()
	parts := strings.Split(value, "@")
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid account format: expected username@domain, got %s", value)
	}

	return &UserDiscoveryRequest{
		Resource:      resource,
		Username:      parts[0],
		Domain:        parts[1],
		RequestedRels: rels,
	}, nil
}

// Validate validates the WebFingerResource
func (r WebFingerResource) Validate() error {
	resourceStr := strings.TrimSpace(string(r))
	if resourceStr == "" {
		return ErrWellKnownInvalidResourceFormat
	}

	if !strings.Contains(resourceStr, ":") {
		return ErrWellKnownInvalidResourceFormat
	}

	prefix := r.Prefix()
	if prefix != "acct" {
		return ErrWellKnownUnsupportedPrefixType
	}

	// Validate the account format (username@domain)
	value := r.Value()
	if !strings.Contains(value, "@") {
		return fmt.Errorf("invalid account format: missing @ symbol in %s", value)
	}

	parts := strings.Split(value, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return fmt.Errorf("invalid account format: expected username@domain, got %s", value)
	}

	// Validate domain format
	domain := parts[1]
	if _, err := url.Parse("http://" + domain); err != nil {
		return fmt.Errorf("invalid domain format: %s", domain)
	}

	return nil
}

// BuildWebFingerResponse builds a WebFinger response for an ActivityPub actor
func BuildWebFingerResponse(actor *ActivityPubActor, baseURL string, resource WebFingerResource) *WebFingerResponse {
	response := &WebFingerResponse{
		Subject: string(resource),
		Aliases: []string{
			actor.ID,
		},
		Properties: map[string]string{
			"https://www.w3.org/ns/activitystreams#preferredUsername": actor.PreferredUsername,
		},
		Links: []WebFingerLink{
			{
				Rel:  "self",
				Type: "application/activity+json",
				Href: actor.ID,
			},
			{
				Rel:  "http://webfinger.net/rel/profile-page",
				Type: "text/html",
				Href: fmt.Sprintf("%s/@%s", baseURL, actor.PreferredUsername),
			},
		},
	}

	// Add optional properties
	if actor.Name != "" {
		response.Properties["https://www.w3.org/ns/activitystreams#name"] = actor.Name
	}

	if actor.Summary != "" {
		response.Properties["https://www.w3.org/ns/activitystreams#summary"] = actor.Summary
	}

	// Add ActivityPub endpoints as links
	if actor.Inbox != "" {
		response.Links = append(response.Links, WebFingerLink{
			Rel:  "https://www.w3.org/ns/activitystreams#inbox",
			Type: "application/activity+json",
			Href: actor.Inbox,
		})
	}

	if actor.Outbox != "" {
		response.Links = append(response.Links, WebFingerLink{
			Rel:  "https://www.w3.org/ns/activitystreams#outbox",
			Type: "application/activity+json",
			Href: actor.Outbox,
		})
	}

	return response
}

// Constants for common WebFinger relationship types
const (
	RelSelf                = "self"
	RelProfilePage         = "http://webfinger.net/rel/profile-page"
	RelActivityPubActor    = "self"
	RelActivityPubInbox    = "https://www.w3.org/ns/activitystreams#inbox"
	RelActivityPubOutbox   = "https://www.w3.org/ns/activitystreams#outbox"
	RelActivityPubFollowers = "https://www.w3.org/ns/activitystreams#followers"
	RelActivityPubFollowing = "https://www.w3.org/ns/activitystreams#following"
)

// Constants for common content types
const (
	ContentTypeActivityJSON = "application/activity+json"
	ContentTypeJSON         = "application/json"
	ContentTypeHTML         = "text/html"
	ContentTypeJRD          = "application/jrd+json"
)