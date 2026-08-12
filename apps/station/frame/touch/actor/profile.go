package actor

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type PeersTouchInfo struct {
	NetworkID string `json:"network_id"`
}

type UserLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

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

	Region                    string     `json:"region"`
	Timezone                  string     `json:"timezone"`
	Tags                      []string   `json:"tags"`
	Links                     []UserLink `json:"links"`
	DefaultVisibility         string     `json:"default_visibility"`
	ManuallyApprovesFollowers bool       `json:"manually_approves_followers"`
	MessagePermission         string     `json:"message_permission"`
	AutoExpireDays            int        `json:"auto_expire_days"`

	PeersTouch PeersTouchInfo `json:"peers_touch"`
}

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

// GetWebProfile resolves a LOCAL profile by preferred_username. It
// scopes to origin='local' so Phase D remote_cached rows (which can
// share the same local-part with a coincident local actor) cannot
// shadow this station's own profile rendering.
func GetWebProfile(c context.Context, username string, baseURL string) (*ProfileResponse, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	var actor db.Actor
	err = rds.Where("preferred_username = ? AND namespace = ? AND origin = ?", username, "peers", OriginLocal).First(&actor).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}

	return getWebProfileFromActor(c, rds, &actor, baseURL)
}

func GetWebProfileByID(c context.Context, actorID uint64, baseURL string) (*ProfileResponse, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	var actor db.Actor
	if err := rds.First(&actor, actorID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}

	return getWebProfileFromActor(c, rds, &actor, baseURL)
}

func GetWebProfileByPTID(c context.Context, ptid, baseURL string) (*ProfileResponse, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	var actor db.Actor
	if err := rds.Where("ptid = ?", ptid).First(&actor).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}

	return getWebProfileFromActor(c, rds, &actor, baseURL)
}

func getWebProfileFromActor(c context.Context, rds *gorm.DB, actor *db.Actor, baseURL string) (*ProfileResponse, error) {
	var meta db.ActorTouchMeta
	err := rds.Where("actor_id = ?", actor.ID).First(&meta).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		log.Warnf(c, "Failed to fetch actor meta: %v", err)
	}

	activityPubID := fmt.Sprintf("%s/users/%s", baseURL, actor.PreferredUsername)

	statusesCount := int64(meta.StatusesCount)
	followingCount := int64(meta.FollowingCount)
	followersCount := int64(meta.FollowersCount)

	var tags []string
	if meta.Tags != "" {
		_ = json.Unmarshal([]byte(meta.Tags), &tags)
	}
	if tags == nil {
		tags = []string{}
	}

	var links []UserLink
	if meta.Links != "" {
		_ = json.Unmarshal([]byte(meta.Links), &links)
	}
	if links == nil {
		links = []UserLink{}
	}

	response := &ProfileResponse{
		ID:                        strconv.FormatUint(actor.ID, 10),
		Username:                  actor.PreferredUsername,
		Acct:                      actor.PreferredUsername,
		DisplayName:               actor.Name,
		Note:                      actor.Summary,
		URL:                       activityPubID,
		Avatar:                    actor.Icon,
		Header:                    actor.Image,
		Locked:                    meta.ManuallyApprovesFollowers,
		CreatedAt:                 actor.CreatedAt,
		StatusesCount:             statusesCount,
		FollowingCount:            followingCount,
		FollowersCount:            followersCount,
		Region:                    meta.Region,
		Timezone:                  meta.Timezone,
		Tags:                      tags,
		Links:                     links,
		DefaultVisibility:         meta.DefaultVisibility,
		ManuallyApprovesFollowers: meta.ManuallyApprovesFollowers,
		MessagePermission:         meta.MessagePermission,
		AutoExpireDays:            meta.AutoExpireDays,
		PeersTouch: PeersTouchInfo{
			NetworkID: actor.PTID,
		},
	}

	return response, nil
}

func UpdateProfile(c context.Context, username string, req UpdateProfileRequest) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		return err
	}
	var actor db.Actor
	err = rds.Where("preferred_username = ? AND namespace = ?", username, "peers").First(&actor).Error
	if err != nil {
		return err
	}
	return updateProfileInternal(c, rds, &actor, req)
}

func UpdateProfileByID(c context.Context, actorID uint64, req UpdateProfileRequest) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		return err
	}
	var actor db.Actor
	if err := rds.First(&actor, actorID).Error; err != nil {
		return err
	}
	return updateProfileInternal(c, rds, &actor, req)
}

func updateProfileInternal(c context.Context, rds *gorm.DB, actor *db.Actor, req UpdateProfileRequest) error {
	var meta db.ActorTouchMeta
	err := rds.Where("actor_id = ?", actor.ID).First(&meta).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			meta = db.ActorTouchMeta{
				ActorID: actor.ID,
			}
			if err := rds.Create(&meta).Error; err != nil {
				return err
			}
		} else {
			return err
		}
	}

	actorUpdates := map[string]interface{}{}
	if req.DisplayName != nil {
		actorUpdates["name"] = *req.DisplayName
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

	metaUpdates := map[string]interface{}{}
	if req.Region != nil {
		metaUpdates["region"] = *req.Region
	}
	if req.Timezone != nil {
		metaUpdates["timezone"] = *req.Timezone
	}
	if req.Tags != nil {
		tagsJSON, _ := json.Marshal(*req.Tags)
		metaUpdates["tags"] = string(tagsJSON)
	}
	if req.Links != nil {
		linksJSON, _ := json.Marshal(*req.Links)
		metaUpdates["links"] = string(linksJSON)
	}
	if req.DefaultVisibility != nil {
		metaUpdates["default_visibility"] = *req.DefaultVisibility
	}
	if req.ManuallyApprovesFollowers != nil {
		metaUpdates["manually_approves_followers"] = *req.ManuallyApprovesFollowers
	}
	if req.MessagePermission != nil {
		metaUpdates["message_permission"] = *req.MessagePermission
	}
	if req.AutoExpireDays != nil {
		metaUpdates["auto_expire_days"] = *req.AutoExpireDays
	}

	if len(metaUpdates) > 0 {
		if err := rds.Model(&meta).Updates(metaUpdates).Error; err != nil {
			return err
		}
	}

	// Tier C1 — re-publish the locator record so receivers' caches
	// get invalidated on the next broadcast. We trigger only when at
	// least one row actually changed; an empty PATCH is a no-op and
	// must not generate federation traffic. publishVisibilityAsync is
	// internally gated on Origin=local + federated_handle non-empty,
	// so non-local / not-yet-bootstrapped actors fall through quietly.
	if len(actorUpdates) > 0 || len(metaUpdates) > 0 {
		publishVisibilityAsync(actor.ID)
	}

	return nil
}

// WebProfileToActorProfileProto maps a web ProfileResponse to the domain ActorProfile proto
// so Touch SuccessResponse can pack protobuf Any for desktop clients.
func WebProfileToActorProfileProto(p *ProfileResponse) *modelpb.ActorProfile {
	if p == nil {
		return nil
	}
	links := make([]*modelpb.UserLink, 0, len(p.Links))
	for i := range p.Links {
		links = append(links, &modelpb.UserLink{
			Label: p.Links[i].Label,
			Url:   p.Links[i].URL,
		})
	}
	return &modelpb.ActorProfile{
		Id:                        p.ID,
		DisplayName:               p.DisplayName,
		Username:                  p.Username,
		Note:                      p.Note,
		Avatar:                    p.Avatar,
		Header:                    p.Header,
		Region:                    p.Region,
		Timezone:                  p.Timezone,
		Tags:                      p.Tags,
		Links:                     links,
		Url:                       p.URL,
		PeersTouch:                &modelpb.PeersTouchInfo{NetworkId: p.PeersTouch.NetworkID},
		Acct:                      p.Acct,
		Locked:                    p.Locked,
		CreatedAt:                 p.CreatedAt.Format(time.RFC3339),
		FollowersCount:            p.FollowersCount,
		FollowingCount:            p.FollowingCount,
		StatusesCount:             p.StatusesCount,
		DefaultVisibility:         p.DefaultVisibility,
		ManuallyApprovesFollowers: p.ManuallyApprovesFollowers,
		MessagePermission:         p.MessagePermission,
		AutoExpireDays:            int32(p.AutoExpireDays),
	}
}

// UpdateProfileRequestFromProto converts a protobuf update payload to the internal
// UpdateProfileRequest used by persistence (optional pointer semantics preserved).
func UpdateProfileRequestFromProto(req *modelpb.UpdateProfileRequest) UpdateProfileRequest {
	if req == nil {
		return UpdateProfileRequest{}
	}
	out := UpdateProfileRequest{}
	if req.DisplayName != nil {
		s := *req.DisplayName
		out.DisplayName = &s
	}
	if req.Note != nil {
		s := *req.Note
		out.Note = &s
	}
	if req.Avatar != nil {
		s := *req.Avatar
		out.Avatar = &s
	}
	if req.Header != nil {
		s := *req.Header
		out.Header = &s
	}
	if req.Region != nil {
		s := *req.Region
		out.Region = &s
	}
	if req.Timezone != nil {
		s := *req.Timezone
		out.Timezone = &s
	}
	if len(req.Tags) > 0 {
		t := append([]string(nil), req.Tags...)
		out.Tags = &t
	}
	if len(req.Links) > 0 {
		al := make([]UserLink, 0, len(req.Links))
		for _, l := range req.Links {
			if l == nil {
				continue
			}
			al = append(al, UserLink{Label: l.GetLabel(), URL: l.GetUrl()})
		}
		if len(al) > 0 {
			out.Links = &al
		}
	}
	if req.DefaultVisibility != nil {
		s := *req.DefaultVisibility
		out.DefaultVisibility = &s
	}
	if req.ManuallyApprovesFollowers != nil {
		b := *req.ManuallyApprovesFollowers
		out.ManuallyApprovesFollowers = &b
	}
	if req.MessagePermission != nil {
		s := *req.MessagePermission
		out.MessagePermission = &s
	}
	if req.AutoExpireDays != nil {
		n := int(*req.AutoExpireDays)
		out.AutoExpireDays = &n
	}
	return out
}
