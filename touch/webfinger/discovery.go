package webfinger

import (
	"context"
	"fmt"
	"strings"

	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	cfg "github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model/db"
	"github.com/dirty-bro-tech/peers-touch-go/touch/user"
)

// DiscoverUser discovers a user by WebFinger resource and returns a WebFinger response
func DiscoverUser(ctx context.Context, params *model.WebFingerParams) (*model.WebFingerResponse, error) {
	// Parse the discovery request
	request, err := model.ParseUserDiscoveryRequest(params.Resource, nil)
	if err != nil {
		log.Warnf(ctx, "[DiscoverUser] Failed to parse discovery request: %v", err)
		return nil, err
	}

	// Look up the user in the database
	dbUser, err := user.GetUserByName(ctx, request.Username)
	if err != nil {
		log.Warnf(ctx, "[DiscoverUser] Failed to find user %s: %v", request.Username, err)
		return nil, fmt.Errorf("user not found: %s", request.Username)
	}

	// Get base URL from config
	baseURL := getBaseURL()

	// Convert database user to ActivityPub actor
	actor, err := buildActivityPubActor(ctx, dbUser, baseURL)
	if err != nil {
		log.Errorf(ctx, "[DiscoverUser] Failed to build ActivityPub actor: %v", err)
		return nil, err
	}

	// Build and return WebFinger response
	response := model.BuildWebFingerResponse(actor, baseURL, params.Resource)
	return response, nil
}

// GetActivityPubActor returns the ActivityPub actor representation for a user
func GetActivityPubActor(ctx context.Context, username string) (*model.ActivityPubActor, error) {
	// Look up the user in the database
	dbUser, err := user.GetUserByName(ctx, username)
	if err != nil {
		log.Warnf(ctx, "[GetActivityPubActor] Failed to find user %s: %v", username, err)
		return nil, fmt.Errorf("user not found: %s", username)
	}

	// Get base URL from config
	baseURL := getBaseURL()

	// Convert database user to ActivityPub actor
	return buildActivityPubActor(ctx, dbUser, baseURL)
}

// CreateActivityPubActor creates a new ActivityPub actor for a user
func CreateActivityPubActor(ctx context.Context, userID uint64) (*model.ActivityPubActor, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		log.Errorf(ctx, "[CreateActivityPubActor] Failed to get database connection: %v", err)
		return nil, err
	}

	// Get user from database
	var dbUser db.User
	if err := rds.Where("id = ?", userID).First(&dbUser).Error; err != nil {
		log.Errorf(ctx, "[CreateActivityPubActor] Failed to find user with ID %d: %v", userID, err)
		return nil, fmt.Errorf("user not found with ID: %d", userID)
	}

	// Get base URL from config
	baseURL := getBaseURL()

	// Build ActivityPub actor
	return buildActivityPubActor(ctx, &dbUser, baseURL)
}

// buildActivityPubActor converts a database user to an ActivityPub actor
func buildActivityPubActor(ctx context.Context, dbUser *db.User, baseURL string) (*model.ActivityPubActor, error) {
	// Build ActivityPub actor URLs
	baseURL = strings.TrimSuffix(baseURL, "/")
	actorID := fmt.Sprintf("%s/users/%s", baseURL, dbUser.Name)
	inboxURL := fmt.Sprintf("%s/users/%s/inbox", baseURL, dbUser.Name)
	outboxURL := fmt.Sprintf("%s/users/%s/outbox", baseURL, dbUser.Name)
	followersURL := fmt.Sprintf("%s/users/%s/followers", baseURL, dbUser.Name)
	followingURL := fmt.Sprintf("%s/users/%s/following", baseURL, dbUser.Name)

	// Create ActivityPub actor
	actor := &model.ActivityPubActor{
		ID:                actorID,
		Type:              "Person",
		PreferredUsername: dbUser.Name,
		Name:              dbUser.Name, // Use database name as display name
		Summary:           "",          // Default empty summary
		Inbox:             inboxURL,
		Outbox:            outboxURL,
		Followers:         followersURL,
		Following:         followingURL,
		CreatedAt:         dbUser.CreatedAt,
		UpdatedAt:         dbUser.UpdatedAt,
	}

	return actor, nil
}

// ValidateLocalUser validates that a user exists on this server
func ValidateLocalUser(ctx context.Context, username, domain string) error {
	// Check if the domain matches our base URL
	if !isLocalDomain(domain) {
		return fmt.Errorf("domain %s is not local to this server", domain)
	}

	// Check if user exists
	_, err := user.GetUserByName(ctx, username)
	if err != nil {
		return fmt.Errorf("user %s not found on this server", username)
	}

	return nil
}

// isLocalDomain checks if the given domain matches our server's domain
func isLocalDomain(domain string) bool {
	baseURL := getBaseURL()
	// Extract domain from base URL
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

// IsUserDiscoverable checks if a user is discoverable via WebFinger
func IsUserDiscoverable(ctx context.Context, username string) (bool, error) {
	// Check if user exists
	_, err := user.GetUserByName(ctx, username)
	if err != nil {
		return false, fmt.Errorf("user %s not found", username)
	}

	// For now, all existing users are discoverable
	// This can be extended to check user preferences in the future
	return true, nil
}

// getBaseURL retrieves the base URL from configuration
func getBaseURL() string {
	// Get base URL from core config system
	if baseURL := cfg.Get("peers", "service", "server", "baseurl").String(""); baseURL != "" {
		return baseURL
	}
	// Fallback to default
	return "https://localhost:8080"
}