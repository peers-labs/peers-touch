package activitypub

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// PeersTouchInfo contains Peers Touch specific network information
type PeersTouchInfo struct {
	NetworkID string `json:"network_id"` // PeersActorID (PTID)
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

	// Peers Touch specific extensions
	PeersTouch PeersTouchInfo `json:"peers_touch"`
}

// GetActorProfile handles GET requests for the extended actor profile
// GET /:actor/profile
func GetActorProfile(c context.Context, ctx *app.RequestContext) {
	username := ctx.Param("actor")
	if username == "" {
		log.Warnf(c, "Username parameter is required")
		ctx.JSON(http.StatusBadRequest, "Username parameter is required")
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	// 1. Fetch Basic Actor Info
	var actor db.Actor
	// Assuming "peers" namespace for now, similar to GetActor
	err = rds.Where("name = ? AND namespace = ?", username, "peers").First(&actor).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			ctx.JSON(http.StatusNotFound, "User not found")
			return
		}
		log.Errorf(c, "Failed to fetch actor: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Internal Server Error")
		return
	}

	baseURL := getBaseURL(ctx)
	activityPubID := fmt.Sprintf("%s/users/%s", baseURL, username) // Standard AP Actor ID format

	// 2. Fetch Stats
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

	// 3. Construct Response
	response := ProfileResponse{
		ID:             strconv.FormatUint(actor.ID, 10),
		Username:       actor.Name,
		Acct:           actor.Name, // Local user, so acct is just username
		DisplayName:    actor.DisplayName,
		Note:           actor.Summary,
		URL:            activityPubID,
		Avatar:         actor.Icon,
		Header:         actor.Image,
		Locked:         false, // TODO: Add logic if we support locked accounts
		CreatedAt:      actor.CreatedAt,
		StatusesCount:  statusesCount,
		FollowingCount: followingCount,
		FollowersCount: followersCount,
		PeersTouch: PeersTouchInfo{
			NetworkID: actor.PeersActorID,
		},
	}

	ctx.JSON(http.StatusOK, response)
}

// GetProfile retrieves the profile for a given actor ID (internal use)
func GetProfile(c context.Context, actorID uint64) (*ProfileResponse, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	var actor db.Actor
	if err := rds.First(&actor, actorID).Error; err != nil {
		return nil, err
	}

	return &ProfileResponse{
		ID:          strconv.FormatUint(actor.ID, 10),
		Username:    actor.Name,
		Acct:        actor.Name,
		DisplayName: actor.DisplayName,
		Note:        actor.Summary,
		Avatar:      actor.Icon,
		Header:      actor.Image,
		CreatedAt:   actor.CreatedAt,
		PeersTouch: PeersTouchInfo{
			NetworkID: actor.PeersActorID,
		},
	}, nil
}

// UpdateProfile updates the profile
func UpdateProfile(c context.Context, actorID uint64, params *model.ProfileUpdateParams) error {
	if params == nil {
		return nil
	}
	if err := params.Validate(); err != nil {
		return err
	}
	rds, err := store.GetRDS(c)
	if err != nil {
		return err
	}
	updatesActor := map[string]interface{}{}
	if params.WhatsUp != nil {
		updatesActor["summary"] = *params.WhatsUp
	}
	if params.ProfilePhoto != nil {
		updatesActor["icon"] = *params.ProfilePhoto
	}
	if params.Email != nil {
		updatesActor["email"] = *params.Email
	}
	if len(updatesActor) > 0 {
		if err := rds.Model(&db.Actor{}).Where("id = ?", actorID).Updates(updatesActor).Error; err != nil {
			return err
		}
	}
	var prof db.ActorProfile
	if err := rds.Where("actor_id = ?", actorID).First(&prof).Error; err != nil {
		prof.ActorID = actorID
	}
	if params.ProfilePhoto != nil {
		prof.ProfilePhoto = *params.ProfilePhoto
	}
	if params.Gender != nil {
		prof.Gender = *params.Gender
	}
	if params.Region != nil {
		prof.Region = *params.Region
	}
	if params.Email != nil {
		prof.Email = *params.Email
	}
	if params.WhatsUp != nil {
		prof.WhatsUp = *params.WhatsUp
	}
	if prof.ID == 0 {
		if err := rds.Create(&prof).Error; err != nil {
			return err
		}
	} else {
		if err := rds.Save(&prof).Error; err != nil {
			return err
		}
	}
	return nil
}

func GetPTProfile(c context.Context, actorID uint64) (*model.ProfileGetResponse, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}
	var actor db.Actor
	if err := rds.First(&actor, actorID).Error; err != nil {
		return nil, err
	}
	var prof db.ActorProfile
	_ = rds.Where("actor_id = ?", actorID).First(&prof).Error
	return &model.ProfileGetResponse{
		ProfilePhoto: firstNonEmpty(prof.ProfilePhoto, actor.Icon),
		Name:         firstNonEmpty(actor.DisplayName, actor.Name),
		Gender:       prof.Gender,
		Region:       prof.Region,
		Email:        firstNonEmpty(prof.Email, actor.Email),
		PeersID:      firstNonEmpty(prof.PeersID, actor.PeersActorID),
		WhatsUp:      firstNonEmpty(prof.WhatsUp, actor.Summary),
	}, nil
}

func firstNonEmpty(a string, b string) string {
	if a != "" {
		return a
	}
	return b
}
