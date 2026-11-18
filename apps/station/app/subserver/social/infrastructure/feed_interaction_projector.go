package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"sort"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
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
	// A late historical interaction cannot resurrect a hidden parent.
	if post.DeletedAt != nil {
		return nil
	}
	in := InteractionInput{Tx: tx, Receipt: receipt, Payload: payload, Post: &post, Home: home, Target: target}
	handler, err := p.interactions.Resolve(payload)
	if err != nil {
		return err
	}
	return handler.Project(ctx, in)
}
