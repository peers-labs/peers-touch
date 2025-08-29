package webfinger

import (
	"context"
	"fmt"
	"strings"

	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model/db"
	"github.com/dirty-bro-tech/peers-touch-go/touch/service"
	"github.com/dirty-bro-tech/peers-touch-go/touch/user"
	"gorm.io/gorm"
)

// DiscoveryService handles WebFinger user discovery operations
type DiscoveryService struct {
	db             *gorm.DB
	baseURL        string
	profileService *service.ActivityPubProfileService
}

// NewDiscoveryService creates a new WebFinger discovery service
func NewDiscoveryService(db *gorm.DB, baseURL string) *DiscoveryService {
	return &DiscoveryService{
		db:             db,
		baseURL:        strings.TrimSuffix(baseURL, "/"),
		profileService: service.NewActivityPubProfileService(db, baseURL),
	}
}

// DiscoverUser discovers a user by WebFinger resource and returns a WebFinger response
func (s *DiscoveryService) DiscoverUser(ctx context.Context, params *model.WebFingerParams) (*model.WebFingerResponse, error) {
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

	// Convert database user to ActivityPub actor
	actor, err := s.buildActivityPubActor(dbUser)
	if err != nil {
		log.Errorf(ctx, "[DiscoverUser] Failed to build ActivityPub actor: %v", err)
		return nil, err
	}

	// Build and return WebFinger response
	response := model.BuildWebFingerResponse(actor, s.baseURL, params.Resource)
	return response, nil
}

// GetActivityPubActor returns the ActivityPub actor representation for a user
func (s *DiscoveryService) GetActivityPubActor(ctx context.Context, username string) (*model.ActivityPubActor, error) {
	// Look up the user in the database
	dbUser, err := user.GetUserByName(ctx, username)
	if err != nil {
		log.Warnf(ctx, "[GetActivityPubActor] Failed to find user %s: %v", username, err)
		return nil, fmt.Errorf("user not found: %s", username)
	}

	// Convert database user to ActivityPub actor
	return s.buildActivityPubActor(dbUser)
}

// CreateActivityPubActor creates a new ActivityPub actor for a user
func (s *DiscoveryService) CreateActivityPubActor(ctx context.Context, userID uint64) (*model.ActivityPubActor, error) {
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

	// Build ActivityPub actor
	return s.buildActivityPubActor(&dbUser)
}

// buildActivityPubActor converts a database user to an ActivityPub actor
func (s *DiscoveryService) buildActivityPubActor(dbUser *db.User) (*model.ActivityPubActor, error) {
	if dbUser == nil {
		return nil, fmt.Errorf("user cannot be nil")
	}

	// Build actor ID and endpoints
	actorID := fmt.Sprintf("%s/users/%s", s.baseURL, dbUser.Name)
	inboxURL := fmt.Sprintf("%s/users/%s/inbox", s.baseURL, dbUser.Name)
	outboxURL := fmt.Sprintf("%s/users/%s/outbox", s.baseURL, dbUser.Name)
	followersURL := fmt.Sprintf("%s/users/%s/followers", s.baseURL, dbUser.Name)
	followingURL := fmt.Sprintf("%s/users/%s/following", s.baseURL, dbUser.Name)
	likedURL := fmt.Sprintf("%s/users/%s/liked", s.baseURL, dbUser.Name)

	// Create ActivityPub actor
	actor := &model.ActivityPubActor{
		ID:                actorID,
		Type:              "Person",
		PreferredUsername: dbUser.Name,
		Name:              dbUser.Name, // Use name as display name for now
		Inbox:             inboxURL,
		Outbox:            outboxURL,
		Followers:         followersURL,
		Following:         followingURL,
		Liked:             likedURL,
		CreatedAt:         dbUser.CreatedAt,
		UpdatedAt:         dbUser.UpdatedAt,
	}

	// Add public key for HTTP signatures (placeholder for now)
	actor.PublicKey = &model.ActivityPubPublicKey{
		ID:           fmt.Sprintf("%s#main-key", actorID),
		Owner:        actorID,
		PublicKeyPem: "", // TODO: Generate and store actual public keys
	}

	// Add endpoints
	actor.Endpoints = map[string]string{
		"sharedInbox": fmt.Sprintf("%s/inbox", s.baseURL),
	}

	return actor, nil
}

// ValidateLocalUser checks if a user exists locally and can be discovered
func (s *DiscoveryService) ValidateLocalUser(ctx context.Context, username, domain string) error {
	// Check if the domain matches our base URL
	if !s.isLocalDomain(domain) {
		return fmt.Errorf("domain %s is not local to this server", domain)
	}

	// Check if user exists
	_, err := user.GetUserByName(ctx, username)
	if err != nil {
		return fmt.Errorf("user %s not found on this server", username)
	}

	return nil
}

// isLocalDomain checks if the given domain belongs to this server
func (s *DiscoveryService) isLocalDomain(domain string) bool {
	// Extract domain from base URL
	baseURL := strings.TrimPrefix(s.baseURL, "http://")
	baseURL = strings.TrimPrefix(baseURL, "https://")
	baseDomain := strings.Split(baseURL, ":")[0] // Remove port if present

	return strings.EqualFold(domain, baseDomain)
}

// GetSupportedRelationships returns the relationships supported by this server
func (s *DiscoveryService) GetSupportedRelationships() []string {
	return []string{
		model.RelSelf,
		model.RelProfilePage,
		model.RelActivityPubInbox,
		model.RelActivityPubOutbox,
		model.RelActivityPubFollowers,
		model.RelActivityPubFollowing,
	}
}

// FilterRequestedRelationships filters the WebFinger response based on requested relationships
func (s *DiscoveryService) FilterRequestedRelationships(response *model.WebFingerResponse, requestedRels []string) *model.WebFingerResponse {
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