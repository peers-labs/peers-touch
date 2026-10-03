package actor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrProfileRevisionRequired = errors.New("profile observed revision is required")
	ErrEmptyProfileMutation    = errors.New("profile mutation is empty")
	ErrInvalidDiscoverability  = errors.New("profile discoverability is invalid")
	ErrRemoteProfileMutation   = errors.New("remote actor profile cannot be mutated")
)

type PeersTouchInfo struct {
	NetworkID string `json:"network_id"`
}

type UserLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

type ProfileResponse struct {
	ID             string            `json:"id"`
	Ref            *modelpb.ActorRef `json:"ref"`
	Username       string            `json:"username"`
	Acct           string            `json:"acct"`
	DisplayName    string            `json:"display_name"`
	Note           string            `json:"note"`
	URL            string            `json:"url"`
	Avatar         string            `json:"avatar"`
	Header         string            `json:"header"`
	Locked         bool              `json:"locked"`
	CreatedAt      time.Time         `json:"created_at"`
	StatusesCount  int64             `json:"statuses_count"`
	FollowingCount int64             `json:"following_count"`
	FollowersCount int64             `json:"followers_count"`

	Region                    string     `json:"region"`
	Timezone                  string     `json:"timezone"`
	Tags                      []string   `json:"tags"`
	Links                     []UserLink `json:"links"`
	DefaultVisibility         string     `json:"default_visibility"`
	ManuallyApprovesFollowers bool       `json:"manually_approves_followers"`
	MessagePermission         string     `json:"message_permission"`
	AutoExpireDays            int        `json:"auto_expire_days"`
	ProfileRevision           uint64     `json:"profile_revision"`
	FederatedHandle           string     `json:"federated_handle"`
	HomeStationPeerID         string     `json:"home_station_peer_id"`
	HomeStationDomain         string     `json:"home_station_domain"`
	Discoverability           int16      `json:"discoverability"`

	PeersTouch PeersTouchInfo `json:"peers_touch"`
}

type UpdateProfileRequest struct {
	DisplayName               *string                  `json:"display_name"`
	Note                      *string                  `json:"note"`
	Avatar                    *string                  `json:"avatar"`
	Header                    *string                  `json:"header"`
	Region                    *string                  `json:"region"`
	Timezone                  *string                  `json:"timezone"`
	Tags                      *[]string                `json:"tags"`
	Links                     *[]UserLink              `json:"links"`
	DefaultVisibility         *string                  `json:"default_visibility"`
	ManuallyApprovesFollowers *bool                    `json:"manually_approves_followers"`
	MessagePermission         *string                  `json:"message_permission"`
	AutoExpireDays            *int                     `json:"auto_expire_days"`
	Discoverability           *modelpb.ActorVisibility `json:"discoverability"`
	ObservedRevision          uint64                   `json:"observed_revision"`
}

type ProfileUpdateResult struct {
	Outcome modelpb.ProfileUpdateOutcome
	Profile *ProfileResponse
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
		ID:                        activityPubID,
		Ref:                       ProtoActorRef(actor),
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
		ProfileRevision:           canonicalProfileRevision(meta.ProfileRevision),
		FederatedHandle:           actor.FederatedHandle,
		HomeStationPeerID:         actor.HomeStationPeerID,
		HomeStationDomain:         actor.HomeStationDomain,
		Discoverability:           canonicalDiscoverability(actor.Visibility),
		PeersTouch: PeersTouchInfo{
			NetworkID: actor.PTID,
		},
	}

	return response, nil
}

func UpdateProfile(c context.Context, username, baseURL string, req UpdateProfileRequest) (*ProfileUpdateResult, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}
	var actor db.Actor
	err = rds.Where("preferred_username = ? AND namespace = ?", username, "peers").First(&actor).Error
	if err != nil {
		return nil, err
	}
	return updateProfileInternal(c, rds, actor.ID, baseURL, req)
}

func UpdateProfileByID(c context.Context, actorID uint64, baseURL string, req UpdateProfileRequest) (*ProfileUpdateResult, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}
	return updateProfileInternal(c, rds, actorID, baseURL, req)
}

func (req UpdateProfileRequest) hasMutation() bool {
	return req.DisplayName != nil ||
		req.Note != nil ||
		req.Avatar != nil ||
		req.Header != nil ||
		req.Region != nil ||
		req.Timezone != nil ||
		req.Tags != nil ||
		req.Links != nil ||
		req.DefaultVisibility != nil ||
		req.ManuallyApprovesFollowers != nil ||
		req.MessagePermission != nil ||
		req.AutoExpireDays != nil ||
		req.Discoverability != nil
}

func ValidateProfileUpdateRequest(req UpdateProfileRequest) error {
	if req.ObservedRevision == 0 {
		return ErrProfileRevisionRequired
	}
	if !req.hasMutation() {
		return ErrEmptyProfileMutation
	}
	if req.Discoverability != nil &&
		*req.Discoverability != modelpb.ActorVisibility_ACTOR_VISIBILITY_HIDDEN &&
		*req.Discoverability != modelpb.ActorVisibility_ACTOR_VISIBILITY_BY_HANDLE &&
		*req.Discoverability != modelpb.ActorVisibility_ACTOR_VISIBILITY_INDEXED {
		return fmt.Errorf("%w: %d", ErrInvalidDiscoverability, *req.Discoverability)
	}
	return nil
}

func canonicalProfileRevision(revision uint64) uint64 {
	if revision == 0 {
		return 1
	}
	return revision
}

func canonicalDiscoverability(value int16) int16 {
	if value == VisibilityByHandle || value == VisibilityIndexed {
		return value
	}
	return VisibilityHidden
}

func updateProfileInternal(
	c context.Context,
	rds *gorm.DB,
	actorID uint64,
	baseURL string,
	req UpdateProfileRequest,
) (*ProfileUpdateResult, error) {
	if err := ValidateProfileUpdateRequest(req); err != nil {
		return nil, err
	}

	var result ProfileUpdateResult
	changed := false
	err := rds.WithContext(c).Transaction(func(tx *gorm.DB) error {
		var actor db.Actor
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&actor, actorID).Error; err != nil {
			return err
		}
		if req.Discoverability != nil && actor.Origin != OriginLocal {
			return ErrRemoteProfileMutation
		}

		var meta db.ActorTouchMeta
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("actor_id = ?", actor.ID).
			First(&meta).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			meta = db.ActorTouchMeta{
				ActorID:         actor.ID,
				ProfileRevision: 1,
			}
			if err := tx.Create(&meta).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		meta.ProfileRevision = canonicalProfileRevision(meta.ProfileRevision)

		if req.ObservedRevision != meta.ProfileRevision {
			profile, err := getWebProfileFromActor(c, tx, &actor, baseURL)
			if err != nil {
				return err
			}
			result = ProfileUpdateResult{
				Outcome: modelpb.ProfileUpdateOutcome_PROFILE_UPDATE_OUTCOME_CONFLICT,
				Profile: profile,
			}
			return nil
		}

		actorUpdates := map[string]interface{}{}
		if req.DisplayName != nil && *req.DisplayName != actor.Name {
			actorUpdates["name"] = *req.DisplayName
		}
		if req.Note != nil && *req.Note != actor.Summary {
			actorUpdates["summary"] = *req.Note
		}
		if req.Avatar != nil && *req.Avatar != actor.Icon {
			actorUpdates["icon"] = *req.Avatar
		}
		if req.Header != nil && *req.Header != actor.Image {
			actorUpdates["image"] = *req.Header
		}
		if req.Discoverability != nil && int16(*req.Discoverability) != actor.Visibility {
			actorUpdates["visibility"] = int16(*req.Discoverability)
		}

		metaUpdates := map[string]interface{}{}
		if req.Region != nil && *req.Region != meta.Region {
			metaUpdates["region"] = *req.Region
		}
		if req.Timezone != nil && *req.Timezone != meta.Timezone {
			metaUpdates["timezone"] = *req.Timezone
		}
		if req.Tags != nil {
			tagsJSON, err := json.Marshal(*req.Tags)
			if err != nil {
				return err
			}
			if string(tagsJSON) != meta.Tags {
				metaUpdates["tags"] = string(tagsJSON)
			}
		}
		if req.Links != nil {
			linksJSON, err := json.Marshal(*req.Links)
			if err != nil {
				return err
			}
			if string(linksJSON) != meta.Links {
				metaUpdates["links"] = string(linksJSON)
			}
		}
		if req.DefaultVisibility != nil && *req.DefaultVisibility != meta.DefaultVisibility {
			metaUpdates["default_visibility"] = *req.DefaultVisibility
		}
		if req.ManuallyApprovesFollowers != nil &&
			*req.ManuallyApprovesFollowers != meta.ManuallyApprovesFollowers {
			metaUpdates["manually_approves_followers"] = *req.ManuallyApprovesFollowers
		}
		if req.MessagePermission != nil && *req.MessagePermission != meta.MessagePermission {
			metaUpdates["message_permission"] = *req.MessagePermission
		}
		if req.AutoExpireDays != nil && *req.AutoExpireDays != meta.AutoExpireDays {
			metaUpdates["auto_expire_days"] = *req.AutoExpireDays
		}

		if len(actorUpdates) == 0 && len(metaUpdates) == 0 {
			profile, err := getWebProfileFromActor(c, tx, &actor, baseURL)
			if err != nil {
				return err
			}
			result = ProfileUpdateResult{
				Outcome: modelpb.ProfileUpdateOutcome_PROFILE_UPDATE_OUTCOME_UNCHANGED,
				Profile: profile,
			}
			return nil
		}

		if len(actorUpdates) > 0 {
			if err := tx.Model(&actor).Updates(actorUpdates).Error; err != nil {
				return err
			}
		}
		nextRevision := meta.ProfileRevision + 1
		metaUpdates["profile_revision"] = nextRevision
		if err := tx.Model(&meta).Updates(metaUpdates).Error; err != nil {
			return err
		}
		if err := tx.First(&actor, actorID).Error; err != nil {
			return err
		}

		profile, err := getWebProfileFromActor(c, tx, &actor, baseURL)
		if err != nil {
			return err
		}
		result = ProfileUpdateResult{
			Outcome: modelpb.ProfileUpdateOutcome_PROFILE_UPDATE_OUTCOME_APPLIED,
			Profile: profile,
		}
		changed = true
		return nil
	})
	if err != nil {
		return nil, err
	}

	// This is a user-driven content change. Publish only after the transaction
	// commits, and never for stale or equal-value requests.
	if changed {
		publishVisibilityAsync(actorID)
	}
	return &result, nil
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
		Ref:                       p.Ref,
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
		ProfileRevision:           p.ProfileRevision,
		FederatedHandle:           p.FederatedHandle,
		HomeStationPeerId:         p.HomeStationPeerID,
		HomeStationDomain:         p.HomeStationDomain,
		Discoverability: modelpb.ActorVisibility(
			canonicalDiscoverability(p.Discoverability),
		),
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
	if req.Discoverability != nil {
		value := *req.Discoverability
		out.Discoverability = &value
	}
	out.ObservedRevision = req.ObservedRevision
	return out
}
