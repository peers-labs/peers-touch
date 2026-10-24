package application

import (
	"strconv"
	"strings"
	"time"

	searchpb "github.com/peers-labs/peers-touch/station/app/model/search"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
)

const (
	PublicSearchSourceID        = "station.social.public"
	PublicSearchReadBinding     = "social.station.public.read"
	PublicSearchResolver        = "social.station.public.open"
	publicSearchAuthorityPrefix = "social:public:"
)

func publicSearchReadValidity(viewer, observation string) *searchpb.ReadValidity {
	return &searchpb.ReadValidity{
		ReadScope:          PublicSearchSourceID + ":actor:" + publicSearchHash([]byte(viewer)),
		PolicyRevision:     "pg-snapshot:" + publicSearchHash([]byte(observation)),
		OwnerCheckRequired: true,
	}
}

func publicSearchCache(viewer, observation, validator string) *searchpb.CacheMetadata {
	return &searchpb.CacheMetadata{
		Validator: validator, SourceRevision: "pg-snapshot:" + publicSearchHash([]byte(observation)),
		ReadValidity: publicSearchReadValidity(viewer, observation), NoStore: true,
	}
}

func publicSearchAuthority(author *db.Actor) string {
	if author == nil {
		return ""
	}
	// Only durable original-author metadata defines authority. Transport Host
	// and request URLs never participate, even when this Station is a mirror.
	station := strings.TrimSpace(author.HomeStationDomain)
	if station == "" {
		return ""
	}
	return publicSearchAuthorityPrefix + station
}

func publicPostRef(post *domain.Post, author *db.Actor) *searchpb.ResourceRef {
	if post == nil || publicSearchAuthority(author) == "" {
		return nil
	}
	wire, err := domain.NewPostConverter().DomainToProto(post)
	if err != nil {
		return nil
	}
	data, _ := proto.MarshalOptions{Deterministic: true}.Marshal(wire)
	return &searchpb.ResourceRef{
		Kind: "social-post", Id: strconv.FormatUint(post.ID, 10),
		AuthorityNamespace: publicSearchAuthority(author),
		ContentRevision:    publicSearchHash(data),
	}
}

func publicSearchResult(batch *PublicReadBatch, kind string, id uint64, viewer, observation string) *searchpb.ResultItem {
	var resource *searchpb.ResourceRef
	var text, authorPTID string
	var createdAt time.Time
	searchKind := searchpb.SearchKind_SEARCH_KIND_SOCIAL_POST
	if kind == "social-post" {
		post := batch.Posts[id]
		if post == nil {
			return nil
		}
		resource = publicPostRef(post, batch.Authors[post.AuthorPTID])
		text, authorPTID, createdAt = post.TextBody, post.AuthorPTID, post.CreatedAt
	} else if kind == "social-comment" {
		comment := batch.Comments[id]
		if comment == nil {
			return nil
		}
		parent := batch.Posts[comment.PostID]
		parentRef := publicPostRef(parent, batch.Authors[parent.AuthorPTID])
		if parentRef == nil {
			return nil
		}
		wire := domain.NewPostConverter().CommentToProto(comment)
		data, _ := proto.MarshalOptions{Deterministic: true}.Marshal(wire)
		resource = &searchpb.ResourceRef{
			Kind: "social-comment", Id: strconv.FormatUint(comment.ID, 10),
			AuthorityNamespace: parentRef.AuthorityNamespace, Parent: parentRef,
			Anchor:          &searchpb.ResourceAnchor{Kind: "comment", Id: strconv.FormatUint(comment.ID, 10)},
			ContentRevision: publicSearchHash(data),
		}
		text, authorPTID, createdAt = comment.TextBody, comment.AuthorPTID, comment.CreatedAt
		searchKind = searchpb.SearchKind_SEARCH_KIND_SOCIAL_COMMENT
	}
	if resource == nil {
		return nil
	}
	return &searchpb.ResultItem{
		Resource: resource, Kind: searchKind, Zone: searchpb.SearchZone_SEARCH_ZONE_STATION,
		Title: publicSearchFragment(text, 96), Snippet: publicSearchFragment(text, 240),
		AuthorPtid: authorPTID, CreatedAtUnixMs: createdAt.UnixMilli(), Score: 1,
		SourceId: PublicSearchSourceID, ReadValidity: publicSearchReadValidity(viewer, observation),
	}
}

func publicSearchFragment(text string, limit int) string {
	runes := []rune(text)
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}

func publicSearchValidator(result *searchpb.ResultItem) string {
	copy := proto.Clone(result).(*searchpb.ResultItem)
	copy.ReadValidity = nil
	data, _ := proto.MarshalOptions{Deterministic: true}.Marshal(copy)
	return publicSearchHash(data)
}

func publicSearchRefID(resource *searchpb.ResourceRef) (uint64, bool) {
	if resource == nil || resource.ConversationId != "" || resource.MessageId != "" ||
		resource.TargetPage != "" || !strings.HasPrefix(resource.AuthorityNamespace, publicSearchAuthorityPrefix) ||
		len(resource.AuthorityNamespace) > 300 || len(resource.ContentRevision) > 128 {
		return 0, false
	}
	id, err := strconv.ParseUint(resource.Id, 10, 64)
	if err != nil || id == 0 || strconv.FormatUint(id, 10) != resource.Id {
		return 0, false
	}
	switch resource.Kind {
	case "social-post":
		return id, resource.Parent == nil && resource.Anchor == nil
	case "social-comment":
		if resource.Parent == nil || resource.Parent.Kind != "social-post" ||
			resource.Parent.AuthorityNamespace != resource.AuthorityNamespace ||
			resource.Anchor == nil || resource.Anchor.Kind != "comment" || resource.Anchor.Id != resource.Id {
			return 0, false
		}
		_, valid := publicSearchRefID(resource.Parent)
		return id, valid
	default:
		return 0, false
	}
}

func publicSearchRefMatches(input, current *searchpb.ResourceRef) bool {
	if input == nil || current == nil || input.Kind != current.Kind || input.Id != current.Id ||
		input.AuthorityNamespace != current.AuthorityNamespace {
		return false
	}
	if input.Kind == "social-comment" {
		return input.Parent.GetId() == current.Parent.GetId() &&
			input.Parent.GetAuthorityNamespace() == current.Parent.GetAuthorityNamespace()
	}
	return true
}
