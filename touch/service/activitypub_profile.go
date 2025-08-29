package service

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/touch/model/db"
	"gorm.io/gorm"
)

// ActivityPubProfileService handles user profile management for ActivityPub
type ActivityPubProfileService struct {
	db       *gorm.DB
	baseURL  string // Base URL for this instance (e.g., "https://example.com")
}

// NewActivityPubProfileService creates a new ActivityPub profile service
func NewActivityPubProfileService(database *gorm.DB, baseURL string) *ActivityPubProfileService {
	return &ActivityPubProfileService{
		db:      database,
		baseURL: baseURL,
	}
}

// CreateUserProfile creates an ActivityPub profile for a user
func (s *ActivityPubProfileService) CreateUserProfile(user *db.User, displayName, summary string) (*db.UserActivityPubProfile, error) {
	// Check if user already has an ActivityPub profile
	var existingProfile db.UserActivityPubProfile
	if err := s.db.Where("user_id = ?", user.ID).First(&existingProfile).Error; err == nil {
		return &existingProfile, fmt.Errorf("user already has an ActivityPub profile")
	} else if err != gorm.ErrRecordNotFound {
		return nil, fmt.Errorf("failed to check existing profile: %w", err)
	}

	// Generate RSA key pair for HTTP signatures
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("failed to generate RSA key pair: %w", err)
	}

	// Encode private key to PEM
	privateKeyBytes := x509.MarshalPKCS1PrivateKey(privateKey)
	privateKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: privateKeyBytes,
	})

	// Encode public key to PEM
	publicKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal public key: %w", err)
	}
	publicKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: publicKeyBytes,
	})

	// Create ActivityPub actor
	actorID := fmt.Sprintf("%s/users/%s", s.baseURL, user.Name)
	publicKeyID := fmt.Sprintf("%s#main-key", actorID)

	// Set metadata with public key information
	metadata := map[string]interface{}{
		"publicKey": map[string]interface{}{
			"id":           publicKeyID,
			"owner":        actorID,
			"publicKeyPem": string(publicKeyPEM),
		},
	}

	activityPubActor := &db.ActivityPubActor{
		ActivityPubID:     actorID,
		Type:              "Person",
		Name:              displayName,
		PreferredUsername: user.Name,
		Summary:           summary,
		InboxURL:          fmt.Sprintf("%s/users/%s/inbox", s.baseURL, user.Name),
		OutboxURL:         fmt.Sprintf("%s/users/%s/outbox", s.baseURL, user.Name),
		FollowersURL:      fmt.Sprintf("%s/users/%s/followers", s.baseURL, user.Name),
		FollowingURL:      fmt.Sprintf("%s/users/%s/following", s.baseURL, user.Name),
		LikedURL:          fmt.Sprintf("%s/users/%s/liked", s.baseURL, user.Name),
		PublicKeyPem:      string(publicKeyPEM),
		PrivateKeyPem:     string(privateKeyPEM),
		IsLocal:           true,
		IsActive:          true,
	}

	// Set metadata
	if err := activityPubActor.SetMetadata(metadata); err != nil {
		return nil, fmt.Errorf("failed to set actor metadata: %w", err)
	}

	// Create user profile
	userProfile := &db.UserActivityPubProfile{
		UserID:                    user.ID,
		ManuallyApprovesFollowers: false,
		Discoverable:              true,
		Indexable:                 true,
		Bot:                       false,
		Locked:                    false,
	}

	// Start transaction
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Create ActivityPub actor
	if err := tx.Create(activityPubActor).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("failed to create ActivityPub actor: %w", err)
	}

	// Set the actor ID in the profile
	userProfile.ActivityPubActorID = activityPubActor.ID

	// Create user profile
	if err := tx.Create(userProfile).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("failed to create user profile: %w", err)
	}

	// Commit transaction
	if err := tx.Commit().Error; err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	// Load relationships
	userProfile.User = user
	userProfile.ActivityPubActor = activityPubActor

	return userProfile, nil
}

// GetUserProfile retrieves a user's ActivityPub profile
func (s *ActivityPubProfileService) GetUserProfile(userID uint64) (*db.UserActivityPubProfile, error) {
	var profile db.UserActivityPubProfile
	err := s.db.Preload("User").Preload("ActivityPubActor").Where("user_id = ?", userID).First(&profile).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("user profile not found")
		}
		return nil, fmt.Errorf("failed to get user profile: %w", err)
	}
	return &profile, nil
}

// GetUserProfileByUsername retrieves a user's ActivityPub profile by username
func (s *ActivityPubProfileService) GetUserProfileByUsername(username string) (*db.UserActivityPubProfile, error) {
	var profile db.UserActivityPubProfile
	err := s.db.Preload("User").Preload("ActivityPubActor").
		Joins("JOIN touch_user ON touch_user_activitypub_profile.user_id = touch_user.id").
		Where("touch_user.name = ?", username).First(&profile).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("user profile not found")
		}
		return nil, fmt.Errorf("failed to get user profile: %w", err)
	}
	return &profile, nil
}

// UpdateUserProfile updates a user's ActivityPub profile
func (s *ActivityPubProfileService) UpdateUserProfile(userID uint64, updates map[string]interface{}) error {
	// Get existing profile
	profile, err := s.GetUserProfile(userID)
	if err != nil {
		return err
	}

	// Start transaction
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Update profile settings
	profileUpdates := make(map[string]interface{})
	actorUpdates := make(map[string]interface{})

	// Separate updates for profile and actor
	for key, value := range updates {
		switch key {
		case "manually_approves_followers", "discoverable", "indexable", "bot", "locked":
			profileUpdates[key] = value
		case "name", "summary":
			actorUpdates[key] = value
		}
	}

	// Update profile if there are profile updates
	if len(profileUpdates) > 0 {
		profileUpdates["updated_at"] = time.Now()
		if err := tx.Model(&profile).Updates(profileUpdates).Error; err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to update profile: %w", err)
		}
	}

	// Update actor if there are actor updates
	if len(actorUpdates) > 0 {
		actorUpdates["updated_at"] = time.Now()
		if err := tx.Model(&profile.ActivityPubActor).Updates(actorUpdates).Error; err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to update actor: %w", err)
		}
	}

	// Commit transaction
	if err := tx.Commit().Error; err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// DeleteUserProfile deletes a user's ActivityPub profile
func (s *ActivityPubProfileService) DeleteUserProfile(userID uint64) error {
	// Get existing profile
	profile, err := s.GetUserProfile(userID)
	if err != nil {
		return err
	}

	// Start transaction
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Delete profile
	if err := tx.Delete(&profile).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("failed to delete profile: %w", err)
	}

	// Delete associated ActivityPub actor
	if err := tx.Delete(&profile.ActivityPubActor).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("failed to delete actor: %w", err)
	}

	// Commit transaction
	if err := tx.Commit().Error; err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// GetActivityPubActor retrieves an ActivityPub actor by username
func (s *ActivityPubProfileService) GetActivityPubActor(username string) (*db.ActivityPubActor, error) {
	profile, err := s.GetUserProfileByUsername(username)
	if err != nil {
		return nil, err
	}
	return profile.ActivityPubActor, nil
}

// IsUserDiscoverable checks if a user is discoverable via WebFinger
func (s *ActivityPubProfileService) IsUserDiscoverable(username string) (bool, error) {
	profile, err := s.GetUserProfileByUsername(username)
	if err != nil {
		return false, err
	}
	return profile.Discoverable, nil
}