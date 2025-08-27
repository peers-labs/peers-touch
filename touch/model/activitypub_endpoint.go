package model

import (
	"time"
)

// ActivityPubEndpointInfo represents the complete ActivityPub endpoint information for a peer
type ActivityPubEndpointInfo struct {
	// PeerID is the unique identifier for the peer
	PeerID string `json:"peer_id"`

	// BaseURL is the root URL of the ActivityPub server (e.g., "https://example.com")
	BaseURL string `json:"base_url"`

	// EndpointCount is the total number of available ActivityPub endpoints
	EndpointCount int `json:"endpoint_count"`

	// Endpoints is the array of endpoint descriptors
	Endpoints []EndpointDescriptor `json:"endpoints"`

	// ServerVersion is the ActivityPub implementation version
	ServerVersion string `json:"server_version,omitempty"`

	// SupportedActivities is the list of supported ActivityPub activity types
	SupportedActivities []string `json:"supported_activities,omitempty"`

	// LastUpdated is the timestamp of last endpoint configuration change
	LastUpdated time.Time `json:"last_updated"`

	// TTL is the time-to-live for caching this information (in seconds)
	TTL int64 `json:"ttl"`
}

// EndpointDescriptor describes a single ActivityPub endpoint
type EndpointDescriptor struct {
	// Path is the relative path (e.g., "/users/alice", "/inbox", "/outbox")
	Path string `json:"path"`

	// Type is the endpoint category
	Type EndpointType `json:"type"`

	// Methods are the HTTP methods supported (GET, POST, etc.)
	Methods []string `json:"methods"`

	// ContentTypes are the supported content types
	ContentTypes []string `json:"content_types"`

	// IsPublic indicates whether the endpoint is publicly accessible
	IsPublic bool `json:"is_public"`

	// RequiresAuth indicates authentication requirements
	RequiresAuth bool `json:"requires_auth"`

	// Description provides additional information about the endpoint
	Description string `json:"description,omitempty"`
}

// EndpointType represents the category of an ActivityPub endpoint
type EndpointType string

const (
	// Actor endpoint types
	EndpointTypeActor     EndpointType = "actor"
	EndpointTypeInbox     EndpointType = "inbox"
	EndpointTypeOutbox    EndpointType = "outbox"
	EndpointTypeFollowers EndpointType = "followers"
	EndpointTypeFollowing EndpointType = "following"
	EndpointTypeLiked     EndpointType = "liked"
	EndpointTypeShares    EndpointType = "shares"

	// Collection endpoint types
	EndpointTypeCollection        EndpointType = "collection"
	EndpointTypeOrderedCollection EndpointType = "ordered_collection"

	// Well-known endpoint types
	EndpointTypeWebfinger EndpointType = "webfinger"
	EndpointTypeNodeInfo  EndpointType = "nodeinfo"

	// Custom endpoint types
	EndpointTypeCustom EndpointType = "custom"
)

// ActivityPubCapabilities represents the ActivityPub capabilities of a peer
type ActivityPubCapabilities struct {
	// SupportedActivities lists the ActivityPub activity types supported
	SupportedActivities []ActivityType `json:"supported_activities"`

	// SupportedObjects lists the ActivityPub object types supported
	SupportedObjects []ObjectType `json:"supported_objects"`

	// Extensions lists any ActivityPub extensions supported
	Extensions []string `json:"extensions,omitempty"`

	// MaxContentLength is the maximum content length accepted (in bytes)
	MaxContentLength int64 `json:"max_content_length,omitempty"`

	// SupportedMediaTypes lists supported media types for attachments
	SupportedMediaTypes []string `json:"supported_media_types,omitempty"`
}

// ActivityType represents ActivityPub activity types
type ActivityType string

const (
	ActivityTypeCreate   ActivityType = "Create"
	ActivityTypeUpdate   ActivityType = "Update"
	ActivityTypeDelete   ActivityType = "Delete"
	ActivityTypeFollow   ActivityType = "Follow"
	ActivityTypeAccept   ActivityType = "Accept"
	ActivityTypeReject   ActivityType = "Reject"
	ActivityTypeAdd      ActivityType = "Add"
	ActivityTypeRemove   ActivityType = "Remove"
	ActivityTypeLike     ActivityType = "Like"
	ActivityTypeAnnounce ActivityType = "Announce"
	ActivityTypeUndo     ActivityType = "Undo"
	ActivityTypeBlock    ActivityType = "Block"
	ActivityTypeFlag     ActivityType = "Flag"
)

// ObjectType represents ActivityPub object types
type ObjectType string

const (
	ObjectTypeNote         ObjectType = "Note"
	ObjectTypeArticle      ObjectType = "Article"
	ObjectTypeImage        ObjectType = "Image"
	ObjectTypeVideo        ObjectType = "Video"
	ObjectTypeAudio        ObjectType = "Audio"
	ObjectTypeDocument     ObjectType = "Document"
	ObjectTypePage         ObjectType = "Page"
	ObjectTypeEvent        ObjectType = "Event"
	ObjectTypePlace        ObjectType = "Place"
	ObjectTypePerson       ObjectType = "Person"
	ObjectTypeGroup        ObjectType = "Group"
	ObjectTypeOrganization ObjectType = "Organization"
	ObjectTypeApplication  ObjectType = "Application"
	ObjectTypeService      ObjectType = "Service"
)

// PeerEndpointRegistry manages ActivityPub endpoint information for multiple peers
type PeerEndpointRegistry struct {
	// Peers maps peer IDs to their endpoint information
	Peers map[string]*ActivityPubEndpointInfo `json:"peers"`

	// LastSync is the timestamp of the last registry synchronization
	LastSync time.Time `json:"last_sync"`

	// Version is the registry format version
	Version string `json:"version"`
}

// NewActivityPubEndpointInfo creates a new ActivityPubEndpointInfo with default values
func NewActivityPubEndpointInfo(peerID string, baseURL string) *ActivityPubEndpointInfo {
	return &ActivityPubEndpointInfo{
		PeerID:      peerID,
		BaseURL:     baseURL,
		Endpoints:   make([]EndpointDescriptor, 0),
		LastUpdated: time.Now(),
		TTL:         3600, // 1 hour default TTL
	}
}

// AddEndpoint adds a new endpoint descriptor to the endpoint info
func (info *ActivityPubEndpointInfo) AddEndpoint(endpoint EndpointDescriptor) {
	info.Endpoints = append(info.Endpoints, endpoint)
	info.EndpointCount = len(info.Endpoints)
	info.LastUpdated = time.Now()
}

// GetEndpointsByType returns all endpoints of a specific type
func (info *ActivityPubEndpointInfo) GetEndpointsByType(endpointType EndpointType) []EndpointDescriptor {
	var result []EndpointDescriptor
	for _, endpoint := range info.Endpoints {
		if endpoint.Type == endpointType {
			result = append(result, endpoint)
		}
	}
	return result
}

// IsExpired checks if the endpoint information has expired based on TTL
func (info *ActivityPubEndpointInfo) IsExpired() bool {
	return time.Since(info.LastUpdated).Seconds() > float64(info.TTL)
}

// NewPeerEndpointRegistry creates a new peer endpoint registry
func NewPeerEndpointRegistry() *PeerEndpointRegistry {
	return &PeerEndpointRegistry{
		Peers:    make(map[string]*ActivityPubEndpointInfo),
		LastSync: time.Now(),
		Version:  "1.0",
	}
}

// AddPeer adds or updates peer endpoint information in the registry
func (registry *PeerEndpointRegistry) AddPeer(info *ActivityPubEndpointInfo) {
	registry.Peers[info.PeerID] = info
	registry.LastSync = time.Now()
}

// GetPeer retrieves peer endpoint information from the registry
func (registry *PeerEndpointRegistry) GetPeer(peerID string) (*ActivityPubEndpointInfo, bool) {
	info, exists := registry.Peers[peerID]
	return info, exists
}

// RemovePeer removes peer endpoint information from the registry
func (registry *PeerEndpointRegistry) RemovePeer(peerID string) {
	delete(registry.Peers, peerID)
	registry.LastSync = time.Now()
}

// GetActivePeers returns all peers with non-expired endpoint information
func (registry *PeerEndpointRegistry) GetActivePeers() map[string]*ActivityPubEndpointInfo {
	active := make(map[string]*ActivityPubEndpointInfo)
	for peerID, info := range registry.Peers {
		if !info.IsExpired() {
			active[peerID] = info
		}
	}
	return active
}

// CleanupExpired removes expired peer endpoint information from the registry
func (registry *PeerEndpointRegistry) CleanupExpired() int {
	count := 0
	for peerID, info := range registry.Peers {
		if info.IsExpired() {
			delete(registry.Peers, peerID)
			count++
		}
	}
	if count > 0 {
		registry.LastSync = time.Now()
	}
	return count
}
