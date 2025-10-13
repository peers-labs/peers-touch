package actor

import (
	"context"
	"fmt"
	"time"

	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/dirty-bro-tech/peers-touch-go/core/util/id"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model/db"
	"gorm.io/gorm"
)

// CreateProfile creates a new user profile
func CreateProfile(c context.Context, actorId uint64, name string, email string) (*db.ActorProfile, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[CreateProfile] Get db err: %v", err)
		return nil, err
	}

	// Check if profile already exists
	var existingProfile db.ActorProfile
	if err := rds.Where("user_id = ?", actorId).First(&existingProfile).Error; err == nil {
		return &existingProfile, nil // Profile already exists, return it
	} else if err != gorm.ErrRecordNotFound {
		log.Warnf(c, "[CreateProfile] Check existing profile err: %v", err)
		return nil, err
	}

	// Generate unique peers ID
	peersID := generatePeersID(name)

	// Ensure peers ID is unique
	for {
		var count int64
		if err := rds.Model(&db.ActorProfile{}).Where("peers_id = ?", peersID).Count(&count).Error; err != nil {
			log.Warnf(c, "[CreateProfile] Check peers ID uniqueness err: %v", err)
			return nil, err
		}
		if count == 0 {
			break
		}
		// Generate new peers ID if collision
		peersID = generatePeersID(name)
	}

	// Create new profile
	profile := db.ActorProfile{
		ActorID: actorId,
		Email:   email,
		PeersID: peersID,
		Gender:  db.GenderOther, // Default gender
	}

	if err := rds.Create(&profile).Error; err != nil {
		log.Warnf(c, "[CreateProfile] Create profile err: %v", err)
		return nil, err
	}

	log.Infof(c, "[CreateProfile] Profile created for user %d with peers ID %s", actorId, peersID)
	return &profile, nil
}

// GetProfile retrieves user profile by user ID
func GetProfile(c context.Context, actorId uint64) (*model.ProfileGetResponse, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[GetProfile] Get db err: %v", err)
		return nil, err
	}

	// Get user info
	user, err := GetUserByID(c, actorId)
	if err != nil {
		log.Warnf(c, "[GetProfile] Get user err: %v", err)
		return nil, err
	}

	// Get profile info
	var profile db.ActorProfile
	if err := rds.Where("user_id = ?", actorId).First(&profile).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			// Return profile not found error instead of auto-creating
			return nil, model.NewError("t20009", "Profile not found")
		}
		log.Warnf(c, "[GetProfile] Get profile err: %v", err)
		return nil, err
	}

	return &model.ProfileGetResponse{
		ProfilePhoto: profile.ProfilePhoto,
		Name:         user.Name.String(),
		Gender:       string(profile.Gender),
		Region:       profile.Region,
		Email:        profile.Email,
		PeersID:      profile.PeersID,
		WhatsUp:      profile.WhatsUp,
	}, nil
}

// GetProfileByPeersID retrieves user profile by peers ID
func GetProfileByPeersID(c context.Context, peersID string) (*model.ProfileGetResponse, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[GetProfileByPeersID] Get db err: %v", err)
		return nil, err
	}

	// Get profile by peers ID
	var profile db.ActorProfile
	if err := rds.Where("peers_id = ?", peersID).First(&profile).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, model.NewError("t20008", "Profile not found")
		}
		log.Warnf(c, "[GetProfileByPeersID] Get profile err: %v", err)
		return nil, err
	}

	// Get user info
	user, err := GetUserByID(c, profile.ActorID)
	if err != nil {
		log.Warnf(c, "[GetProfileByPeersID] Get user err: %v", err)
		return nil, err
	}

	return &model.ProfileGetResponse{
		ProfilePhoto: profile.ProfilePhoto,
		Name:         user.Name.String(),
		Gender:       string(profile.Gender),
		Region:       profile.Region,
		Email:        profile.Email,
		PeersID:      profile.PeersID,
		WhatsUp:      profile.WhatsUp,
	}, nil
}

// UpdateProfile updates user profile information
// Supports updating specific items (partial updates) like WeChat
func UpdateProfile(c context.Context, actorId uint64, params *model.ProfileUpdateParams) error {
	// Validate parameters
	if err := params.Validate(); err != nil {
		return err
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[UpdateProfile] Get db err: %v", err)
		return err
	}

	// Get existing profile
	var profile db.ActorProfile
	if err := rds.Where("user_id = ?", actorId).First(&profile).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return model.NewError("t20009", "Profile not found")
		}
		log.Warnf(c, "[UpdateProfile] Get profile err: %v", err)
		return err
	}

	// Update fields if provided - supports partial updates
	updates := make(map[string]interface{})

	if params.ProfilePhoto != nil {
		updates["profile_photo"] = *params.ProfilePhoto
	}
	if params.Gender != nil {
		updates["gender"] = *params.Gender
	}
	if params.Region != nil {
		updates["region"] = *params.Region
	}
	if params.Email != nil {
		updates["email"] = *params.Email
	}
	if params.WhatsUp != nil {
		updates["whats_up"] = *params.WhatsUp
	}

	if len(updates) > 0 {
		updates["updated_at"] = time.Now()
		if err := rds.Model(&profile).Updates(updates).Error; err != nil {
			log.Warnf(c, "[UpdateProfile] Update profile err: %v", err)
			return err
		}
	}

	log.Infof(c, "[UpdateProfile] Profile updated for user %d", actorId)
	return nil
}

// GetUserByID retrieves user by ID (helper function)
func GetUserByID(c context.Context, actorId uint64) (*db.Actor, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	var user db.Actor
	if err := rds.Where("id = ?", actorId).First(&user).Error; err != nil {
		return nil, err
	}

	return &user, nil
}

// generatePeersID generates a unique peers ID based on user name
func generatePeersID(name string) string {
	// Use snowflake ID to ensure uniqueness
	snowflakeID := id.NextID()

	// Create a simple peers ID format: first 3 chars of name + timestamp suffix
	prefix := ""
	if len(name) >= 3 {
		prefix = name[:3]
	} else {
		prefix = name
	}

	// Remove non-alphanumeric characters and convert to lowercase
	cleanPrefix := ""
	for _, r := range prefix {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			cleanPrefix += string(r)
		}
	}

	if cleanPrefix == "" {
		cleanPrefix = "usr"
	}

	return fmt.Sprintf("%s_%d", cleanPrefix, snowflakeID%1000000)
}
