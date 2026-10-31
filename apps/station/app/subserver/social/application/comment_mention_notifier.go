package application

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/notification"
	notificationdomain "github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/metrics"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

const (
	// socialCommentMentionTargetType is the notification targetType the
	// Desktop notification center uses to jump to the moment thread.
	socialCommentMentionTargetType = "social-comment"

	// socialCommentMentionMetadata* keys carry only static resource
	// references. The recipient client re-authorizes and resolves
	// display text on readback — even for public parents the Station
	// never stores post title, comment snippet, or display name here.
	socialCommentMentionMetadataPostID    = "post_id"
	socialCommentMentionMetadataCommentID = "comment_id"
	socialCommentMentionMetadataActorPTID = "actor_ptid"

	socialCommentMentionVisibilityPublic  = "public"
	socialCommentMentionVisibilityPrivate = "private"

	socialCommentMentionOutcomeProduced     = "produced"
	socialCommentMentionOutcomeSelfSkipped  = "self_skipped"
	socialCommentMentionOutcomeUnreadable   = "unreadable"
	socialCommentMentionOutcomeUnregistered = "unregistered"
	socialCommentMentionOutcomeFailed       = "failed"

	// socialCommentMentionMaxTargets bounds fan-out per comment. The
	// request-side validator already enforces the same 20-mention cap.
	socialCommentMentionMaxTargets = 20

	// socialCommentMentionDeliveryTimeout bounds the detached delivery
	// so an unavailable notification SubServer cannot leak goroutines.
	socialCommentMentionDeliveryTimeout = 10 * time.Second
)

// ParentCommentReadable re-adjudicates, for an arbitrary recipient,
// whether the parent Moment of a public comment is readable at
// delivery time. Public parents are numeric ULIDs; the owner read port
// uses uint64. Private parents never invoke this (the signed
// mention-routing facts were already adjudicated against the audience
// snapshot during prepare).
type ParentCommentReadable func(ctx context.Context, postID uint64, viewerPTID string) bool

// CommentMentionNotifier bridges committed comment mentions into the
// notification SubServer. Delivery is best-effort and detached from the
// write request: an unregistered bridge or a produce failure MUST be
// logged and counted, never rolled back or made to block the response —
// the comment is already committed when Notify runs.
type CommentMentionNotifier struct {
	bridge   *notification.Bridge
	readable ParentCommentReadable
	total    metrics.Counter
	now      func() time.Time
}

// NewCommentMentionNotifier wires the global notification Bridge behind
// the Social owner. `readable` is required for public parents so the
// parent audience is re-checked for each mentioned actor at delivery.
func NewCommentMentionNotifier(readable ParentCommentReadable) *CommentMentionNotifier {
	return &CommentMentionNotifier{
		bridge:   notification.NewBridge(),
		readable: readable,
		total: metrics.Get().Counter(
			"social_comment_mention_notification_total",
			"Comment mention notification delivery dispositions",
			"visibility",
			"outcome",
		),
		now: time.Now,
	}
}

// NotifyPublicCommentMentions schedules detached fan-out for a
// committed public comment, re-checking parent-post readability per
// recipient. Public resource ids are numeric ULIDs.
func (n *CommentMentionNotifier) NotifyPublicCommentMentions(
	ctx context.Context,
	postID uint64,
	commentID uint64,
	authorPTID string,
	mentions []*model.Mention,
) {
	if n == nil {
		return
	}
	postIDString := strconv.FormatUint(postID, 10)
	commentIDString := strconv.FormatUint(commentID, 10)
	readable := func(checkCtx context.Context, parentPostID string, viewerPTID string) bool {
		if n.readable == nil {
			return false
		}
		parentID, err := strconv.ParseUint(parentPostID, 10, 64)
		if err != nil || parentID == 0 {
			return false
		}
		return n.readable(checkCtx, parentID, viewerPTID)
	}
	n.dispatch(
		ctx,
		socialCommentMentionVisibilityPublic,
		postIDString,
		commentIDString,
		authorPTID,
		domain.MentionActorPTIDs(mentions),
		readable,
	)
}

// NotifyPrivateCommentMentions schedules detached fan-out for a
// committed private comment. Post/comment ids are opaque resource
// strings (ULIDs): they MUST be used verbatim in target/metadata and
// never parsed as decimal ids. Recipients come from the signed
// mention-routing facts, so no read-port re-check is performed.
func (n *CommentMentionNotifier) NotifyPrivateCommentMentions(
	ctx context.Context,
	postID string,
	commentID string,
	authorPTID string,
	mentionedPTIDs []string,
) {
	if n == nil {
		return
	}
	n.dispatch(
		ctx,
		socialCommentMentionVisibilityPrivate,
		postID,
		commentID,
		authorPTID,
		mentionedPTIDs,
		nil,
	)
}

type commentMentionReadable func(ctx context.Context, postID string, viewerPTID string) bool

// dispatch runs the fan-out in a detached goroutine so notification
// delivery never blocks or fails the comment write request.
func (n *CommentMentionNotifier) dispatch(
	requestCtx context.Context,
	visibility string,
	postID string,
	commentID string,
	authorPTID string,
	recipientPTIDs []string,
	readable commentMentionReadable,
) {
	if n.bridge == nil || postID == "" || commentID == "" {
		return
	}
	// Detach from request cancellation/deadline; the comment commit
	// already succeeded and delivery must not be aborted when the HTTP
	// response returns.
	detached := context.WithoutCancel(requestCtx)
	go func() {
		ctx, cancel := context.WithTimeout(detached, socialCommentMentionDeliveryTimeout)
		defer cancel()
		n.deliver(ctx, visibility, postID, commentID, authorPTID, recipientPTIDs, readable)
	}()
}

func (n *CommentMentionNotifier) deliver(
	ctx context.Context,
	visibility string,
	postID string,
	commentID string,
	authorPTID string,
	recipientPTIDs []string,
	readable commentMentionReadable,
) {
	targetID := commentID
	groupKey := socialCommentMentionTargetType + ":" + targetID
	metadata := map[string]string{
		socialCommentMentionMetadataPostID:    postID,
		socialCommentMentionMetadataCommentID: targetID,
		socialCommentMentionMetadataActorPTID: authorPTID,
	}

	deduplicated := dedupeMentionRecipients(recipientPTIDs, authorPTID, n, visibility)
	if len(deduplicated) > socialCommentMentionMaxTargets {
		logger.Warn(ctx, "comment.mention.notification: target cap reached, truncating fan-out",
			"post_id", postID,
			"comment_id", commentID,
			"targets", len(deduplicated),
			"cap", socialCommentMentionMaxTargets,
		)
		deduplicated = deduplicated[:socialCommentMentionMaxTargets]
	}

	for _, recipientPTID := range deduplicated {
		if visibility == socialCommentMentionVisibilityPublic && readable != nil {
			if !readable(ctx, postID, recipientPTID) {
				n.observe(visibility, socialCommentMentionOutcomeUnreadable)
				continue
			}
		}

		// Title/body stay empty on purpose: the notification center
		// renders localized text and resolves identities through an
		// authorized readback, so no private content is persisted by
		// the notification owner.
		err := n.bridge.Produce(
			recipientPTID,
			authorPTID,
			notificationdomain.TypeSocialCommentMention,
			notificationdomain.CategorySocial,
			socialCommentMentionTargetType,
			targetID,
			"",
			"",
			groupKey,
			metadata,
		)
		switch {
		case err == nil:
			n.observe(visibility, socialCommentMentionOutcomeProduced)
		case errors.Is(err, notification.ErrBridgeUnregistered):
			logger.Warn(ctx, "comment.mention.notification: bridge unregistered",
				"post_id", postID, "comment_id", commentID)
			n.observe(visibility, socialCommentMentionOutcomeUnregistered)
		default:
			// The comment commit is never rolled back; the recipient
			// sees the mention on the next thread read regardless.
			logger.Warn(ctx, "comment.mention.notification: produce failed",
				"post_id", postID, "comment_id", commentID, "error", err)
			n.observe(visibility, socialCommentMentionOutcomeFailed)
		}
	}
}

// dedupeMentionRecipients drops empty/duplicate PTIDs and the author;
// each self-skip is still observed so fan-out behavior stays measurable.
func dedupeMentionRecipients(
	recipientPTIDs []string,
	authorPTID string,
	n *CommentMentionNotifier,
	visibility string,
) []string {
	seen := make(map[string]struct{}, len(recipientPTIDs))
	deduplicated := make([]string, 0, len(recipientPTIDs))
	for _, recipientPTID := range recipientPTIDs {
		if recipientPTID == "" {
			continue
		}
		if recipientPTID == authorPTID {
			// The notification Service self-guards as well; observe it
			// explicitly so fan-out behavior stays measurable.
			n.observe(visibility, socialCommentMentionOutcomeSelfSkipped)
			continue
		}
		if _, duplicated := seen[recipientPTID]; duplicated {
			continue
		}
		seen[recipientPTID] = struct{}{}
		deduplicated = append(deduplicated, recipientPTID)
	}
	return deduplicated
}

func (n *CommentMentionNotifier) observe(visibility, outcome string) {
	if n.total != nil {
		n.total.Inc(visibility, outcome)
	}
}
