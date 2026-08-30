package application

import (
	"strconv"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// BuildFeedObjectExplanation creates the viewer-scoped explanation
// projection returned beside feed objects. The server remains the
// authority for audience and block policy; clients render this object
// instead of re-deriving permission semantics from presentation fields.
func BuildFeedObjectExplanation(post *model.Post, reason model.RelationshipReason_Kind) *model.FeedObjectExplanation {
	if post == nil || post.GetId() == "" {
		return nil
	}

	author := post.GetAuthor()
	stationDomain := ""
	if author != nil {
		stationDomain = author.GetHomeStationDomain()
	}

	sourceKind := model.ActivitySource_ACTIVITY_SOURCE_UNRESOLVED
	if stationDomain != "" {
		sourceKind = model.ActivitySource_ACTIVITY_SOURCE_REMOTE
	}

	audienceKind := model.Audience_PUBLIC
	targetID := ""
	if audience := post.GetAudience(); audience != nil {
		audienceKind = audience.GetKind()
		if audience.GetTargetId() != 0 {
			targetID = strconv.FormatUint(audience.GetTargetId(), 10)
		}
	}

	if reason == model.RelationshipReason_RELATIONSHIP_REASON_UNSPECIFIED {
		reason = model.RelationshipReason_RELATIONSHIP_REASON_UNKNOWN
	}

	actorID := ""
	if author != nil {
		actorID = author.GetId()
	}

	return &model.FeedObjectExplanation{
		ObjectId: post.GetId(),
		Source: &model.ActivitySource{
			Kind:          sourceKind,
			StationDomain: stationDomain,
		},
		RelationshipReason: &model.RelationshipReason{
			Kind:          reason,
			ActorPtid:     actorID,
			StationDomain: stationDomain,
		},
		AudienceExplanation: &model.AudienceExplanation{
			Kind:           audienceKind,
			TargetId:       targetID,
			ViewerIsAuthor: reason == model.RelationshipReason_RELATIONSHIP_REASON_SELF,
			ViewerIsMember: reason == model.RelationshipReason_RELATIONSHIP_REASON_CIRCLE,
		},
		BlockExplanation: &model.BlockExplanation{
			Kind: model.BlockExplanation_BLOCK_STATE_NOT_BLOCKED,
		},
	}
}

func buildFeedObjectExplanations(
	posts []*model.Post,
	reasonsByPostID map[string]model.RelationshipReason_Kind,
	defaultReason model.RelationshipReason_Kind,
) []*model.FeedObjectExplanation {
	if len(posts) == 0 {
		return nil
	}

	out := make([]*model.FeedObjectExplanation, 0, len(posts))
	for _, post := range posts {
		if post == nil {
			continue
		}
		reason := defaultReason
		if reasonsByPostID != nil {
			if got, ok := reasonsByPostID[post.GetId()]; ok {
				reason = got
			}
		}
		explanation := BuildFeedObjectExplanation(post, reason)
		if explanation != nil {
			out = append(out, explanation)
		}
	}
	return out
}

func filterStationBlockedFeedPosts(
	posts []*model.Post,
	blockedStations map[string]*domain.StationModerationPolicy,
) []*model.Post {
	if len(posts) == 0 || len(blockedStations) == 0 {
		return posts
	}
	out := posts[:0]
	for _, post := range posts {
		if post == nil {
			continue
		}
		author := post.GetAuthor()
		stationDomain := ""
		if author != nil {
			stationDomain = author.GetHomeStationDomain()
		}
		if stationDomain != "" && blockedStations[stationDomain] != nil {
			continue
		}
		out = append(out, post)
	}
	return out
}

func timelineReasonFromSource(source string, audienceKind model.Audience_Kind) model.RelationshipReason_Kind {
	switch source {
	case "self_public", "self_private":
		return model.RelationshipReason_RELATIONSHIP_REASON_SELF
	case "followed_public", "followed_followers":
		return model.RelationshipReason_RELATIONSHIP_REASON_FOLLOWING
	case "circles":
		return model.RelationshipReason_RELATIONSHIP_REASON_CIRCLE
	case "delivery":
		switch audienceKind {
		case model.Audience_SELF:
			return model.RelationshipReason_RELATIONSHIP_REASON_SELF
		case model.Audience_CIRCLE:
			return model.RelationshipReason_RELATIONSHIP_REASON_CIRCLE
		case model.Audience_FOLLOWERS:
			return model.RelationshipReason_RELATIONSHIP_REASON_FOLLOWING
		default:
			return model.RelationshipReason_RELATIONSHIP_REASON_UNKNOWN
		}
	default:
		return model.RelationshipReason_RELATIONSHIP_REASON_UNKNOWN
	}
}
