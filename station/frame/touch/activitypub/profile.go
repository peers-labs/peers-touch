package activitypub

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// PeersTouchInfo contains Peers Touch specific network information
type PeersTouchInfo struct {
	NetworkID string `json:"network_id"` // PeersActorID (PTID)
}

// UserLink represents a link in the user's profile
type UserLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// ProfileResponse represents the extended actor profile for the personal page
// Modeled after Mastodon's Account entity but with Peers Touch extensions
type ProfileResponse struct {
	ID             string    `json:"id"`
	Username       string    `json:"username"`
	Acct           string    `json:"acct"`
	DisplayName    string    `json:"display_name"`
	Note           string    `json:"note"`
	URL            string    `json:"url"`
	Avatar         string    `json:"avatar"`
	Header         string    `json:"header"`
	Locked         bool      `json:"locked"`
	CreatedAt      time.Time `json:"created_at"`
	StatusesCount  int64     `json:"statuses_count"`
	FollowingCount int64     `json:"following_count"`
	FollowersCount int64     `json:"followers_count"`

	// Extended Profile Fields
	Region                    string     `json:"region"`
	Timezone                  string     `json:"timezone"`
	Tags                      []string   `json:"tags"`
	Links                     []UserLink `json:"links"`
	DefaultVisibility         string     `json:"default_visibility"`
	ManuallyApprovesFollowers bool       `json:"manually_approves_followers"`
	MessagePermission         string     `json:"message_permission"`
	AutoExpireDays            int        `json:"auto_expire_days"`

	// Peers Touch specific extensions
	PeersTouch PeersTouchInfo `json:"peers_touch"`
}

// UpdateProfileRequest represents the request body for updating a profile
type UpdateProfileRequest struct {
	DisplayName               *string     `json:"display_name"`
	Note                      *string     `json:"note"`
	Avatar                    *string     `json:"avatar"`
	Header                    *string     `json:"header"`
	Region                    *string     `json:"region"`
	Timezone                  *string     `json:"timezone"`
	Tags                      *[]string   `json:"tags"`
	Links                     *[]UserLink `json:"links"`
	DefaultVisibility         *string     `json:"default_visibility"`
	ManuallyApprovesFollowers *bool       `json:"manually_approves_followers"`
	MessagePermission         *string     `json:"message_permission"`
	AutoExpireDays            *int        `json:"auto_expire_days"`
}

// GetWebProfile retrieves the extended actor profile
// Logic only, no HTTP dependency
func GetWebProfile(c context.Context, rds *gorm.DB, username string, baseURL string) (*ProfileResponse, error) {
	// 1. Fetch Basic Actor Info
	var actor db.Actor
	// Assuming "peers" namespace for now, similar to GetActor
	err := rds.Where("name = ? AND namespace = ?", username, "peers").First(&actor).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}

	return getWebProfileFromActor(c, rds, &actor, baseURL)
}

// GetWebProfileByID retrieves the extended actor profile by Actor ID
func GetWebProfileByID(c context.Context, rds *gorm.DB, actorID uint64, baseURL string) (*ProfileResponse, error) {
	var actor db.Actor
	if err := rds.First(&actor, actorID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}

	return getWebProfileFromActor(c, rds, &actor, baseURL)
}

func getWebProfileFromActor(c context.Context, rds *gorm.DB, actor *db.Actor, baseURL string) (*ProfileResponse, error) {
	// 2. Fetch Extended Profile Info
	var profile db.ActorProfile
	err := rds.Where("actor_id = ?", actor.ID).First(&profile).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		log.Warnf(c, "Failed to fetch actor profile: %v", err)
	}

	activityPubID := fmt.Sprintf("%s/users/%s", baseURL, actor.Name) // Standard AP Actor ID format

	// 3. Fetch Stats
	var statusesCount int64
	// Count objects (Notes, Articles) attributed to this actor
	// We check ActivityPubObject where AttributedTo matches the actor's AP ID
	err = rds.Model(&db.ActivityPubObject{}).
		Where("attributed_to = ?", activityPubID).
		Count(&statusesCount).Error
	if err != nil {
		log.Warnf(c, "Failed to count statuses: %v", err)
		// Continue, just default to 0
	}

	var followingCount int64
	// Count active follows initiated by this actor
	err = rds.Model(&db.ActivityPubFollow{}).
		Where("follower_id = ? AND is_active = ?", activityPubID, true).
		Count(&followingCount).Error
	if err != nil {
		log.Warnf(c, "Failed to count following: %v", err)
	}

	var followersCount int64
	// Count active follows targeting this actor
	err = rds.Model(&db.ActivityPubFollow{}).
		Where("following_id = ? AND is_active = ?", activityPubID, true).
		Count(&followersCount).Error
	if err != nil {
		log.Warnf(c, "Failed to count followers: %v", err)
	}

	// Parse JSON fields
	var tags []string
	if profile.Tags != "" {
		_ = json.Unmarshal([]byte(profile.Tags), &tags)
	}
	if tags == nil {
		tags = []string{}
	}

	var links []UserLink
	if profile.Links != "" {
		_ = json.Unmarshal([]byte(profile.Links), &links)
	}
	if links == nil {
		links = []UserLink{}
	}

	// 4. Construct Response
	response := &ProfileResponse{
		ID:                        strconv.FormatUint(actor.ID, 10),
		Username:                  actor.Name,
		Acct:                      actor.Name, // Local user, so acct is just username
		DisplayName:               actor.DisplayName,
		Note:                      actor.Summary,
		URL:                       activityPubID,
		Avatar:                    actor.Icon,
		Header:                    actor.Image,
		Locked:                    false, // TODO: Add logic if we support locked accounts
		CreatedAt:                 actor.CreatedAt,
		StatusesCount:             statusesCount,
		FollowingCount:            followingCount,
		FollowersCount:            followersCount,
		Region:                    profile.Region,
		Timezone:                  profile.Timezone,
		Tags:                      tags,
		Links:                     links,
		DefaultVisibility:         profile.DefaultVisibility,
		ManuallyApprovesFollowers: profile.ManuallyApprovesFollowers,
		MessagePermission:         profile.MessagePermission,
		AutoExpireDays:            profile.AutoExpireDays,
		PeersTouch: PeersTouchInfo{
			NetworkID: actor.PeersActorID, // Using Actor's PeersActorID
		},
	}

	return response, nil
}

// UpdateProfile updates the actor profile
func UpdateProfile(c context.Context, rds *gorm.DB, username string, req UpdateProfileRequest) error {
	var actor db.Actor
	err := rds.Where("name = ? AND namespace = ?", username, "peers").First(&actor).Error
	if err != nil {
		return err
	}
	return updateProfileInternal(c, rds, &actor, req)
}

// UpdateProfileByID updates the actor profile by Actor ID
func UpdateProfileByID(c context.Context, rds *gorm.DB, actorID uint64, req UpdateProfileRequest) error {
	var actor db.Actor
	if err := rds.First(&actor, actorID).Error; err != nil {
		return err
	}
	return updateProfileInternal(c, rds, &actor, req)
}

func updateProfileInternal(c context.Context, rds *gorm.DB, actor *db.Actor, req UpdateProfileRequest) error {
	var profile db.ActorProfile
	err := rds.Where("actor_id = ?", actor.ID).First(&profile).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			// Create profile if it doesn't exist
			profile = db.ActorProfile{
				ActorID: actor.ID,
			}
			if err := rds.Create(&profile).Error; err != nil {
				return err
			}
		} else {
			return err
		}
	}

	// Update Actor fields
	actorUpdates := map[string]interface{}{}
	if req.DisplayName != nil {
		actorUpdates["display_name"] = *req.DisplayName
	}
	if req.Note != nil {
		actorUpdates["summary"] = *req.Note
	}
	if req.Avatar != nil {
		actorUpdates["icon"] = *req.Avatar
	}
	if req.Header != nil {
		actorUpdates["image"] = *req.Header
	}

	if len(actorUpdates) > 0 {
		if err := rds.Model(actor).Updates(actorUpdates).Error; err != nil {
			return err
		}
	}

	// Update Profile fields
	profileUpdates := map[string]interface{}{}
	if req.Region != nil {
		profileUpdates["region"] = *req.Region
	}
	if req.Timezone != nil {
		profileUpdates["timezone"] = *req.Timezone
	}
	if req.Tags != nil {
		tagsJSON, _ := json.Marshal(*req.Tags)
		profileUpdates["tags"] = string(tagsJSON)
	}
	if req.Links != nil {
		linksJSON, _ := json.Marshal(*req.Links)
		profileUpdates["links"] = string(linksJSON)
	}
	if req.DefaultVisibility != nil {
		profileUpdates["default_visibility"] = *req.DefaultVisibility
	}
	if req.ManuallyApprovesFollowers != nil {
		profileUpdates["manually_approves_followers"] = *req.ManuallyApprovesFollowers
	}
	if req.MessagePermission != nil {
		profileUpdates["message_permission"] = *req.MessagePermission
	}
	if req.AutoExpireDays != nil {
		profileUpdates["auto_expire_days"] = *req.AutoExpireDays
	}

	if len(profileUpdates) > 0 {
		if err := rds.Model(&profile).Updates(profileUpdates).Error; err != nil {
			return err
		}
	}

	return nil
}
