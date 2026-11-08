package domain

import (
	"net/url"
	"strconv"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func FeedObjectID(value string) (uint64, error) {
	n, err := strconv.ParseUint(value, 10, 63)
	if err != nil || n == 0 || strconv.FormatUint(n, 10) != value {
		return 0, ErrFeedInvalid
	}
	return n, nil
}

func FeedTargetPost(value string) (string, string, error) {
	return feedTargetObject(value, "post")
}

func FeedTargetComment(value string) (string, string, error) {
	return feedTargetObject(value, "comment")
}

func feedTargetObject(value, kind string) (string, string, error) {
	ref, err := url.Parse(value)
	if err != nil || ref.Scheme != "oss" || ref.Host == "" || ref.User != nil ||
		ref.RawQuery != "" || ref.Fragment != "" || ref.Port() != "" || ref.RawPath != "" {
		return "", "", ErrFeedInvalid
	}
	prefix := "/" + kind + "/"
	object := strings.TrimPrefix(ref.Path, prefix)
	if ref.Path != prefix+object {
		return "", "", ErrFeedInvalid
	}
	if _, err := FeedObjectID(object); err != nil {
		return "", "", err
	}
	if value != "oss://"+ref.Host+prefix+object {
		return "", "", ErrFeedInvalid
	}
	return ref.Host, object, nil
}

// ValidateFeedPayload checks signed semantics independently of SQL projection.
// A valid signature never authorizes a private body on the public chain.
func ValidateFeedPayload(kind model.FeedEventKind, payload *model.FeedPayload) error {
	switch kind {
	case model.FeedEventKind_FEED_EVENT_KIND_POST_CREATED,
		model.FeedEventKind_FEED_EVENT_KIND_POST_UPDATED,
		model.FeedEventKind_FEED_EVENT_KIND_POST_TOMBSTONED:
		p := payload.GetPost()
		if p == nil {
			return ErrFeedInvalid
		}
		if _, err := FeedObjectID(p.PostId); err != nil {
			return err
		}
		if kind == model.FeedEventKind_FEED_EVENT_KIND_POST_TOMBSTONED {
			if len(p.CreateRequest) != 0 {
				return ErrFeedInvalid
			}
			return nil
		}
		r := &model.CreatePostRequest{}
		if signedlog.Decode(p.CreateRequest, r) != nil || !IsPublic(r.Audience) ||
			r.ReplyToPostId != "" {
			return ErrFeedInvalid
		}
		matched := (r.Type == model.PostType_TEXT && r.GetText() != nil) ||
			(r.Type == model.PostType_IMAGE && r.GetImage() != nil) ||
			(r.Type == model.PostType_VIDEO && r.GetVideo() != nil) ||
			(r.Type == model.PostType_LINK && r.GetLink() != nil) ||
			(r.Type == model.PostType_POLL && r.GetPoll() != nil) ||
			(r.Type == model.PostType_REPOST && r.GetRepost() != nil) ||
			(r.Type == model.PostType_LOCATION && r.GetLocation() != nil)
		if !matched {
			return ErrFeedInvalid
		}
		if _, err := NewPostConverter().CreateRequestToDomain(r, "signed-author", nil); err != nil {
			return ErrFeedInvalid
		}
		if r.GetRepost() != nil {
			_, _, err := FeedTargetPost(r.GetRepost().OriginalPostId)
			return err
		}
		return nil
	case model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET,
		model.FeedEventKind_FEED_EVENT_KIND_REACTION_REMOVED:
		r := payload.GetReaction()
		if r == nil || r.ReactionKind < 1 || r.ReactionKind > 16 {
			return ErrFeedInvalid
		}
		if _, _, err := FeedTargetPost(r.TargetPostRef); err != nil {
			return err
		}
		if r.TargetCommentRef != "" {
			_, _, err := FeedTargetComment(r.TargetCommentRef)
			return err
		}
		return nil
	case model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED,
		model.FeedEventKind_FEED_EVENT_KIND_COMMENT_UPDATED,
		model.FeedEventKind_FEED_EVENT_KIND_COMMENT_TOMBSTONED:
		c := payload.GetComment()
		if c == nil {
			return ErrFeedInvalid
		}
		if _, err := FeedObjectID(c.CommentId); err != nil {
			return err
		}
		if _, _, err := FeedTargetPost(c.TargetPostRef); err != nil {
			return err
		}
		if kind == model.FeedEventKind_FEED_EVENT_KIND_COMMENT_TOMBSTONED {
			if len(c.CreateRequest) != 0 {
				return ErrFeedInvalid
			}
			return nil
		}
		r := &model.CreateCommentRequest{}
		if signedlog.Decode(c.CreateRequest, r) != nil || strings.TrimSpace(r.Content) == "" ||
			r.PostId != c.TargetPostRef {
			return ErrFeedInvalid
		}
		if r.ReplyToCommentId != "" {
			if _, _, err := FeedTargetComment(r.ReplyToCommentId); err != nil {
				return err
			}
		}
		if _, err := ValidateTypedMentions(r.Content, r.TypedMentions); err != nil {
			return ErrFeedInvalid
		}
		return nil
	default:
		return ErrFeedInvalid
	}
}
