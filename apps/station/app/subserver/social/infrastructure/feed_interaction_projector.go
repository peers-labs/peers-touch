package infrastructure

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// StoreInteraction is called after independent Actor-root/device verification.
// Receipts do not advance a chain head. Missing predecessors remain durable
// and are retried by the bounded projection worker.
func (p *FeedProjector) StoreInteraction(ctx context.Context, tx *gorm.DB,
	receipt *model.FeedInteraction, home string, forwarded bool) (bool, error) {
	if receipt == nil || receipt.Event == nil || receipt.Event.Statement == nil {
		return false, domain.ErrFeedInvalid
	}
	receipt = proto.Clone(receipt).(*model.FeedInteraction)
	incomingSupplement := receipt.PollAdmission != nil
	event := receipt.Event
	payload := &model.FeedPayload{}
	if err := signedlog.Decode(event.Payload, payload); err != nil {
		return false, err
	}
	if payload.GetPost() != nil {
		return false, domain.ErrFeedInvalid
	}
	target, err := domain.FeedInteractionTarget(payload)
	if err != nil {
		return false, err
	}
	station, _, err := domain.FeedTargetPost(target)
	if err != nil {
		return false, err
	}
	wire, err := FeedInteractionCanonicalBytes(receipt)
	if err != nil {
		return false, err
	}
	hash, err := domain.FeedEventHash(event)
	if err != nil {
		return false, err
	}
	s := event.Statement
	if err := checkFeedQuarantine(ctx, tx, s.ActorPtid, s.ChainId); err != nil {
		return false, err
	}
	var chain FeedChainRecord
	chainErr := tx.WithContext(ctx).Where("actor_ptid = ? AND chain_id = ?", s.ActorPtid, s.ChainId).Take(&chain).Error
	if chainErr == nil {
		if chain.Forked {
			return false, domain.ErrFeedFork
		}
		genesis, err := signedlog.Canonical(receipt.Genesis)
		if err != nil {
			return false, err
		}
		grant, err := signedlog.Canonical(receipt.WriterGrant)
		if err != nil {
			return false, err
		}
		if chain.HomeStationPeerID != home || !bytes.Equal(chain.Genesis, genesis) || !bytes.Equal(chain.WriterGrant, grant) {
			return false, domain.ErrFeedWriter
		}
	} else if !errors.Is(chainErr, gorm.ErrRecordNotFound) {
		return false, chainErr
	}
	var known FeedEventRecord
	knownErr := tx.Where("actor_ptid = ? AND chain_id = ? AND sequence = ?", s.ActorPtid, s.ChainId, s.Sequence).Take(&known).Error
	if knownErr == nil && !bytes.Equal(known.EventHash, hash) {
		return false, domain.ErrFeedFork
	}
	if knownErr != nil && !errors.Is(knownErr, gorm.ErrRecordNotFound) {
		return false, knownErr
	}
	ctx, err = p.LockInteractions(ctx, tx, []*model.FeedEvent{event})
	if err != nil {
		return false, err
	}
	locks, err := feedProjectionLocksFromContext(ctx, tx)
	if err != nil {
		return false, err
	}
	parent, included := locks.parents[target]
	if !included {
		return false, domain.ErrFeedInvalid
	}
	row := FeedInteractionRecord{ActorPTID: s.ActorPtid, ChainID: s.ChainId,
		Sequence: s.Sequence, EventHash: hash, Interaction: wire,
		TargetStation: station, HomeStation: home, Forwarded: forwarded || station == p.localStation}
	result := tx.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
	if result.Error != nil {
		return false, result.Error
	}
	duplicate := result.RowsAffected == 0
	if duplicate {
		if err := tx.Where("actor_ptid = ? AND chain_id = ? AND sequence = ?",
			s.ActorPtid, s.ChainId, s.Sequence).Take(&row).Error; err != nil {
			return false, err
		}
		if !bytes.Equal(row.EventHash, hash) || !bytes.Equal(row.Interaction, wire) {
			return false, domain.ErrFeedFork
		}
	}
	if parent == nil {
		// The parent may arrive after the initial lookup. Defer this whole
		// projection instead of acquiring it after receipt/thread locks.
		return duplicate, nil
	}
	if payload.GetPollBallot() != nil && p.pollAuthority == nil {
		return false, domain.ErrFeedInvalid
	}
	if p.pollAuthority != nil {
		err := p.pollAuthority(ctx, tx, receipt)
		if errors.Is(err, domain.ErrFeedGap) && !incomingSupplement {
			return duplicate, nil
		}
		if err != nil {
			return false, err
		}
	} else if incomingSupplement {
		return false, domain.ErrFeedInvalid
	}
	if receipt.PollAdmission != nil {
		supplement, err := signedlog.Canonical(receipt.PollAdmission)
		if err != nil {
			return false, err
		}
		if len(row.PollAdmission) != 0 && !bytes.Equal(row.PollAdmission, supplement) {
			return false, domain.ErrFeedInvalid
		}
		if len(row.PollAdmission) == 0 {
			row.PollAdmission = supplement
			row.AdmissionReturnRequired = station == p.localStation && home != station
			if err := tx.Model(&row).Updates(map[string]interface{}{
				"poll_admission": supplement, "admission_return_required": row.AdmissionReturnRequired,
			}).Error; err != nil {
				return false, err
			}
		}
	}
	if payload.GetPollBallot() != nil && receipt.PollAdmission == nil {
		return duplicate, nil
	}
	if station == p.localStation {
		if err := indexThread(ctx, tx, p.localStation, target, &row); err != nil {
			return false, err
		}
	}
	if row.Projected {
		return duplicate, nil
	}
	if station == p.localStation {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&FeedInteractionFanout{
			ActorPTID: s.ActorPtid, ChainID: s.ChainId, Sequence: s.Sequence, PostRef: target,
		}).Error; err != nil {
			return false, err
		}
	}
	// A savepoint keeps a deferred projection from partially changing state.
	if err := tx.SavePoint("feed_interaction_projection").Error; err != nil {
		return false, err
	}
	err = p.projectInteraction(ctx, tx, receipt, payload, home)
	if errors.Is(err, domain.ErrFeedGap) {
		return duplicate, tx.RollbackTo("feed_interaction_projection").Error
	}
	if err != nil {
		if rollback := tx.RollbackTo("feed_interaction_projection").Error; rollback != nil {
			return false, rollback
		}
		return false, err
	}
	var post FeedObjectRecord
	_, objectID, _ := domain.FeedTargetPost(target)
	if err := tx.Where("home_station = ? AND object_kind = 'post' AND object_id = ?", station, objectID).Take(&post).Error; err != nil {
		return false, err
	}
	if err := p.observe(ctx, tx, event, post.LocalID, post.ActorPTID); err != nil {
		return false, err
	}
	return duplicate, tx.Model(&row).Update("projected", true).Error
}

type feedProjectionLocksKey struct{}

// This snapshot belongs to one SQL transaction, not to the shared projector.
// Missing parents cannot join the lock set after receipt/thread locks are held.
type feedProjectionLocks struct {
	connection   gorm.ConnPool
	parents      map[string]*FeedObjectRecord
	interactions map[string]bool
	createdPosts map[string]bool
	threadLocal  string
}

func feedProjectionLocksFromContext(ctx context.Context, tx *gorm.DB) (*feedProjectionLocks, error) {
	locks, _ := ctx.Value(feedProjectionLocksKey{}).(*feedProjectionLocks)
	if tx == nil || locks == nil || locks.connection != tx.Statement.ConnPool {
		return nil, domain.ErrFeedInvalid
	}
	return locks, nil
}

// LockInteractions freezes the entire receipt batch before its first write.
// AppendTx supplies the larger parent set, including authored post mutations.
func (p *FeedProjector) LockInteractions(ctx context.Context, tx *gorm.DB, events []*model.FeedEvent) (context.Context, error) {
	if ctx.Value(feedProjectionLocksKey{}) == nil {
		var err error
		ctx, err = lockFeedProjectionParents(ctx, tx, events, "", clause.Locking{Strength: "UPDATE"})
		if err != nil {
			return nil, err
		}
	}
	locks, err := feedProjectionLocksFromContext(ctx, tx)
	if err != nil {
		return nil, err
	}
	if locks.threadLocal != "" {
		if locks.threadLocal != p.localStation {
			return nil, domain.ErrFeedInvalid
		}
		return ctx, nil
	}
	authors := make(map[string]bool)
	for target := range locks.interactions {
		if parent := locks.parents[target]; parent != nil && parent.HomeStation == p.localStation {
			authors[parent.ActorPTID] = true
		}
	}
	ordered := make([]string, 0, len(authors))
	for author := range authors {
		ordered = append(ordered, author)
	}
	sort.Strings(ordered)
	for _, author := range ordered {
		if err := LockFeedThreadHead(ctx, tx, author); err != nil {
			return nil, err
		}
	}
	locks.threadLocal = p.localStation
	return ctx, nil
}

func lockFeedProjectionParents(ctx context.Context, tx *gorm.DB, events []*model.FeedEvent,
	home string, lock clause.Locking) (context.Context, error) {
	if tx == nil || ctx.Value(feedProjectionLocksKey{}) != nil {
		return nil, domain.ErrFeedInvalid
	}
	locks := &feedProjectionLocks{connection: tx.Statement.ConnPool,
		parents: make(map[string]*FeedObjectRecord), interactions: make(map[string]bool),
		createdPosts: make(map[string]bool)}
	for _, event := range events {
		if event == nil || event.Statement == nil {
			return nil, domain.ErrFeedInvalid
		}
		payload := &model.FeedPayload{}
		if err := signedlog.Decode(event.Payload, payload); err != nil {
			return nil, err
		}
		var target string
		if mutation := payload.GetPost(); mutation != nil {
			if home == "" {
				return nil, domain.ErrFeedInvalid
			}
			target = "oss://" + home + "/post/" + mutation.PostId
		} else {
			var err error
			target, err = domain.FeedInteractionTarget(payload)
			if err != nil {
				return nil, err
			}
			locks.interactions[target] = true
		}
		locks.parents[target] = nil
	}
	targets := make([]string, 0, len(locks.parents))
	for target := range locks.parents {
		targets = append(targets, target)
	}
	sort.Strings(targets)
	// Object locks precede post locks, including in the authored-post path.
	// Otherwise a post edit could hold the object while waiting for its post.
	posts := make([]*FeedObjectRecord, 0, len(targets))
	for _, target := range targets {
		station, objectID, err := domain.FeedTargetPost(target)
		if err != nil {
			return nil, err
		}
		var object FeedObjectRecord
		err = tx.WithContext(ctx).Clauses(lock).Where(
			"home_station = ? AND object_kind = 'post' AND object_id = ?", station, objectID).Take(&object).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		locks.parents[target] = &object
		posts = append(posts, &object)
	}
	sort.Slice(posts, func(i, j int) bool { return posts[i].LocalID < posts[j].LocalID })
	for _, object := range posts {
		var post db.SocialPublicPost
		err := tx.WithContext(ctx).Clauses(lock).Where("id = ?", object.LocalID).Take(&post).Error
		if lock.Options == "SKIP LOCKED" && errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrFeedGap
		}
		if err != nil {
			return nil, err
		}
	}
	return context.WithValue(ctx, feedProjectionLocksKey{}, locks), nil
}

func (p *FeedProjector) projectInteraction(ctx context.Context, tx *gorm.DB,
	receipt *model.FeedInteraction, payload *model.FeedPayload, home string) error {
	event := receipt.Event
	target, err := domain.FeedInteractionTarget(payload)
	if err != nil {
		return err
	}
	locks, err := feedProjectionLocksFromContext(ctx, tx)
	if err != nil {
		return err
	}
	object := locks.parents[target]
	if object == nil {
		return domain.ErrFeedGap
	}
	var post db.SocialPublicPost
	if err := tx.Where("id = ?", object.LocalID).Take(&post).Error; err != nil {
		return err
	}
	if payload.GetPollBallot() != nil {
		return p.projectPollBallot(ctx, tx, receipt, &post)
	}
	// A late historical interaction cannot resurrect a hidden parent.
	if post.DeletedAt != nil {
		return nil
	}
	authorID, err := NewActorIdentity(tx).RequireID(ctx, event.Statement.ActorPtid)
	if err != nil {
		return err
	}
	when := time.UnixMilli(event.Statement.CreatedAtUnixMs).UTC()
	if reaction := payload.GetReaction(); reaction != nil {
		targetRef, commentID := target, ""
		var comment db.SocialComment
		if reaction.TargetCommentRef != "" {
			commentHome, commentObjectID, err := domain.FeedTargetComment(reaction.TargetCommentRef)
			if err != nil {
				return err
			}
			var commentObject FeedObjectRecord
			err = tx.Where("home_station = ? AND object_kind = 'comment' AND object_id = ?",
				commentHome, commentObjectID).Take(&commentObject).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrFeedGap
			}
			if err != nil {
				return err
			}
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ? AND post_class = 'public'", commentObject.LocalID).Take(&comment).Error; err != nil {
				return err
			}
			if comment.PostID != post.ID {
				return domain.ErrFeedInvalid
			}
			if comment.DeletedAt != nil {
				return nil
			}
			targetRef, commentID = reaction.TargetCommentRef, strconv.FormatUint(comment.ID, 10)
		}
		version := FeedReactionVersion{TargetRef: targetRef, ActorPTID: event.Statement.ActorPtid, Kind: reaction.ReactionKind}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&version).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("target_ref = ? AND actor_ptid = ? AND kind = ?", targetRef, version.ActorPTID, version.Kind).
			Take(&version).Error; err != nil {
			return err
		}
		if version.Sequence >= event.Statement.Sequence {
			return nil
		}
		row := db.SocialReaction{PostID: strconv.FormatUint(post.ID, 10), CommentID: commentID, ActorID: authorID,
			Kind: model.ReactionKind(reaction.ReactionKind).String(), PostClass: db.PostClassPublic, CreatedAt: when}
		if event.Statement.Kind == model.FeedEventKind_FEED_EVENT_KIND_REACTION_REMOVED {
			err = tx.Where("post_id = ? AND comment_id = ? AND actor_id = ? AND kind = ? AND post_class = 'public'",
				row.PostID, row.CommentID, row.ActorID, row.Kind).Delete(&db.SocialReaction{}).Error
		} else {
			err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
		}
		if err != nil {
			return err
		}
		if err := tx.Model(&version).Update("sequence", event.Statement.Sequence).Error; err != nil {
			return err
		}
		if commentID != "" {
			return nil
		}
		var counts []struct {
			Kind  string
			Count int64
		}
		if err := tx.Model(&db.SocialReaction{}).Select("kind, COUNT(*) AS count").
			Where("post_id = ? AND comment_id = '' AND post_class = 'public'", row.PostID).Group("kind").Scan(&counts).Error; err != nil {
			return err
		}
		snapshot := make(map[string]int64, len(counts))
		for _, count := range counts {
			snapshot[count.Kind] = count.Count
		}
		encoded, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		// Counts are derived interaction state. GORM's Update would also
		// rewrite updated_at, which belongs to the author's signed post event.
		return tx.Model(&post).UpdateColumn("reactions_count_json", string(encoded)).Error
	}
	c := payload.GetComment()
	key := FeedObjectRecord{HomeStation: home, ObjectKind: "comment", ObjectID: c.CommentId}
	var commentObject FeedObjectRecord
	err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("home_station = ? AND object_kind = 'comment' AND object_id = ?", home, c.CommentId).
		Take(&commentObject).Error
	kind := event.Statement.Kind
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if kind != model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED {
			return domain.ErrFeedGap
		}
		key.ActorPTID, key.Sequence = event.Statement.ActorPtid, event.Statement.Sequence
		key.LocalID, _ = domain.FeedObjectID(c.CommentId)
		if home != p.localStation {
			key.LocalID = id.NextID()
		}
		commentObject = key
	} else if err != nil {
		return err
	} else {
		if commentObject.ActorPTID != event.Statement.ActorPtid {
			return domain.ErrFeedWriter
		}
		if commentObject.Sequence >= event.Statement.Sequence {
			return nil
		}
		if kind == model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED {
			return domain.ErrFeedInvalid
		}
	}
	var existing db.SocialComment
	if kind != model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED {
		if err := tx.Where("id = ? AND post_id = ? AND author_id = ? AND post_class = 'public'",
			commentObject.LocalID, post.ID, authorID).Take(&existing).Error; err != nil {
			return err
		}
		if existing.DeletedAt != nil {
			return nil
		}
	}
	if kind == model.FeedEventKind_FEED_EVENT_KIND_COMMENT_TOMBSTONED {
		if err := tx.Model(&existing).Updates(map[string]interface{}{"deleted_at": when, "updated_at": when}).Error; err != nil {
			return err
		}
	} else {
		request := &model.CreateCommentRequest{}
		if err := signedlog.Decode(c.CreateRequest, request); err != nil {
			return err
		}
		mentions, err := domain.ValidateTypedMentions(request.Content, request.TypedMentions)
		if err != nil {
			return err
		}
		for _, actor := range domain.MentionActorPTIDs(mentions) {
			if _, err := NewActorIdentity(tx).RequireID(ctx, actor); err != nil {
				return err
			}
		}
		var parentID *uint64
		if request.ReplyToCommentId != "" {
			parentHome, parentObjectID, err := domain.FeedTargetComment(request.ReplyToCommentId)
			if err != nil {
				return err
			}
			var parentObject FeedObjectRecord
			err = tx.Where("home_station = ? AND object_kind = 'comment' AND object_id = ?",
				parentHome, parentObjectID).Take(&parentObject).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrFeedGap
			}
			if err != nil {
				return err
			}
			n := parentObject.LocalID
			var parent db.SocialComment
			err = tx.Where("id = ? AND post_id = ? AND post_class = 'public' AND deleted_at IS NULL", n, post.ID).
				Take(&parent).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrFeedGap
			}
			if err != nil {
				return err
			}
			if parent.ParentCommentID != nil {
				return domain.ErrFeedInvalid
			}
			parentID = &n
		}
		encoded, err := json.Marshal(mentions)
		if err != nil {
			return err
		}
		if kind == model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED {
			if err := tx.Create(&commentObject).Error; err != nil {
				return err
			}
			if err := tx.Create(&db.SocialComment{ID: commentObject.LocalID, PostID: post.ID,
				PostClass: db.PostClassPublic, AuthorID: authorID, ParentCommentID: parentID,
				TextBody: request.Content, MentionsJSON: string(encoded), CreatedAt: when, UpdatedAt: when}).Error; err != nil {
				return err
			}
		} else {
			if (existing.ParentCommentID == nil) != (parentID == nil) ||
				(parentID != nil && *existing.ParentCommentID != *parentID) {
				return domain.ErrFeedInvalid
			}
			if err := tx.Model(&existing).Updates(map[string]interface{}{
				"text_body": request.Content, "mentions_json": string(encoded), "edited_at": when, "updated_at": when}).Error; err != nil {
				return err
			}
		}
	}
	if err := tx.Model(&commentObject).Update("sequence", event.Statement.Sequence).Error; err != nil {
		return err
	}
	return tx.Model(&post).UpdateColumn("comments_count", tx.Model(&db.SocialComment{}).
		Select("COUNT(*)").Where("post_id = ? AND post_class = 'public' AND deleted_at IS NULL", post.ID)).Error
}
