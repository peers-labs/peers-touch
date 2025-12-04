package webfinger

import (
	"context"
	"fmt"
	"strings"

	cfg "github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// DiscoverUser discovers a user by WebFinger resource and returns a WebFinger response
func DiscoverUser(ctx context.Context, params *model.WebFingerParams) (*model.WebFingerResponse, error) {
	// Default to empty rels for now if calling through legacy wrapper
	return DiscoverActor(ctx, params, nil)
}

// DiscoverActor discovers an actor by WebFinger resource and returns a WebFinger response
func DiscoverActor(ctx context.Context, params *model.WebFingerParams, rels []string) (*model.WebFingerResponse, error) {
	// 1. Parse resource (acct:user@domain)
	resource := string(params.Resource)
	if !strings.HasPrefix(resource, "acct:") {
		// Check if it is a URL (e.g. https://example.com/users/alice)
		if strings.HasPrefix(resource, "http") {
			// TODO: Handle URL based discovery if needed
			return nil, fmt.Errorf("unsupported resource format: %s", resource)
		}
		return nil, fmt.Errorf("invalid resource format: missing acct: prefix")
	}

	identifier := strings.TrimPrefix(resource, "acct:")
	parts := strings.Split(identifier, "@")
	var username, domain string

	if len(parts) == 2 {
		username = parts[0]
		domain = parts[1]
	} else if len(parts) == 1 {
		// If no domain provided, assume local (though strictly acct should have domain)
		username = parts[0]
		domain = "" // check logic below
	} else {
		return nil, fmt.Errorf("invalid resource format: expected user@domain")
	}

	// 2. Check if domain is local (if provided)
	if domain != "" && !isLocalDomain(domain) {
		return nil, fmt.Errorf("domain not supported: %s", domain)
	}

	// 3. Look up user
	actor, err := activitypub.GetActorByName(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("error looking up actor: %v", err)
	}
	if actor == nil {
		return nil, fmt.Errorf("actor not found: %s", username)
	}

	// 4. Construct response
	baseURL := getBaseURL()
	// Ensure baseURL doesn't have trailing slash
	baseURL = strings.TrimSuffix(baseURL, "/")

	profileURL := fmt.Sprintf("%s/@%s", baseURL, username)
	actorID := fmt.Sprintf("%s/users/%s", baseURL, username)

	response := &model.WebFingerResponse{
		Subject: resource,
		Aliases: []string{
			profileURL,
			actorID,
		},
		Links: []model.WebFingerLink{
			{
				Rel:  model.RelSelf,
				Type: "application/activity+json",
				Href: actorID,
			},
			{
				Rel:  model.RelProfilePage,
				Type: "text/html",
				Href: profileURL,
			},
		},
	}

	// Filter based on requested relationships
	response = FilterRequestedRelationships(response, rels)

	return response, nil
}

// GetActivityPubActor returns the ActivityPub actor representation for an actor
func GetActivityPubActor(ctx context.Context, username string) (*model.WebFingerActivityPubActor, error) {
	// Look up the user in the database
	actor, err := activitypub.GetActorByName(ctx, username)
	if err != nil {
		return nil, err
	}
	if actor == nil {
		return nil, fmt.Errorf("actor not found")
	}

	baseURL := getBaseURL()
	baseURL = strings.TrimSuffix(baseURL, "/")
	actorID := fmt.Sprintf("%s/users/%s", baseURL, username)

	return &model.WebFingerActivityPubActor{
		ID:                actorID,
		Type:              "Person",
		PreferredUsername: actor.Name,
		Inbox:             fmt.Sprintf("%s/inbox", actorID),
		Outbox:            fmt.Sprintf("%s/outbox", actorID),
		PublicKey: &model.ActivityPubPublicKey{
			ID:           fmt.Sprintf("%s#main-key", actorID),
			Owner:        actorID,
			PublicKeyPem: "", // TODO: Fetch public key if needed here, though usually in the main actor object
		},
	}, nil
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
