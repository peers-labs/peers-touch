package webfinger

import (
	"context"
	"strings"

	cfg "github.com/peers-touch/peers-touch/station/frame/core/config"
	"github.com/peers-touch/peers-touch/station/frame/touch/model"
)

// DiscoverUser discovers a user by WebFinger resource and returns a WebFinger response
func DiscoverUser(ctx context.Context, params *model.WebFingerParams) (*model.WebFingerResponse, error) {
	panic("implement me")
}

// DiscoverActor discovers an actor by WebFinger resource and returns a WebFinger response
func DiscoverActor(ctx context.Context, params *model.WebFingerParams) (*model.WebFingerResponse, error) {
	panic("implement me")
	return nil, nil
}

// GetActivityPubActor returns the ActivityPub actor representation for an actor
func GetActivityPubActor(ctx context.Context, username string) (*model.WebFingerActivityPubActor, error) {
	// Look up the user in the database
	panic("implement me")
	return nil, nil
}

// isLocalDomain checks if the given domain matches our server's domain
func isLocalDomain(domain string) bool {
	baseURL := getBaseURL()
	// Extract domain from base SubPath
	serverDomain := baseURL
	if strings.HasPrefix(serverDomain, "http://") {
		serverDomain = strings.TrimPrefix(serverDomain, "http://")
	} else if strings.HasPrefix(serverDomain, "https://") {
		serverDomain = strings.TrimPrefix(serverDomain, "https://")
	}

	// Remove port if present
	if colonIndex := strings.Index(serverDomain, ":"); colonIndex != -1 {
		serverDomain = serverDomain[:colonIndex]
	}

	// Remove path if present
	if slashIndex := strings.Index(serverDomain, "/"); slashIndex != -1 {
		serverDomain = serverDomain[:slashIndex]
	}

	return strings.EqualFold(serverDomain, domain)
}

// GetSupportedRelationships returns the relationships supported by this server
func GetSupportedRelationships() []string {
	return []string{
		model.RelSelf,
		model.RelProfilePage,
		model.RelActivityPubInbox,
		model.RelActivityPubOutbox,
		model.RelActivityPubFollowers,
		model.RelActivityPubFollowing,
	}
}

// FilterRequestedRelationships filters WebFinger response links based on requested relationships
func FilterRequestedRelationships(response *model.WebFingerResponse, requestedRels []string) *model.WebFingerResponse {
	if len(requestedRels) == 0 {
		return response // Return all relationships if none specifically requested
	}

	// Create a map for quick lookup
	requestedMap := make(map[string]bool)
	for _, rel := range requestedRels {
		requestedMap[rel] = true
	}

	// Filter links based on requested relationships
	filteredLinks := make([]model.WebFingerLink, 0)
	for _, link := range response.Links {
		if requestedMap[link.Rel] {
			filteredLinks = append(filteredLinks, link)
		}
	}

	// Create filtered response
	filteredResponse := *response
	filteredResponse.Links = filteredLinks

	return &filteredResponse
}

// getBaseURL retrieves the base SubPath from configuration
func getBaseURL() string {
	// Get base SubPath from core config system
	if baseURL := cfg.Get("peers", "service", "server", "baseurl").String(""); baseURL != "" {
		return baseURL
	}
	// Fallback to default
	return "https://localhost:8080"
}
