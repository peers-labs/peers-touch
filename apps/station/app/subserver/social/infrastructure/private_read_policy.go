package infrastructure

import (
	"context"
	"database/sql"
	"errors"

	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"gorm.io/gorm"
)

// CheckMomentReadPolicy consumes the same original audience and interaction
// owners as point reads. It returns decisions only, never content or a lease.
func (s *GORMPrivateContentStore) CheckMomentReadPolicy(
	ctx context.Context, viewerPTID, viewerDeviceID string,
	targets []*privatecontentpb.MomentReadPolicyTarget,
) (*privatecontentpb.CheckMomentReadPolicyResponse, error) {
	if viewerPTID == "" || viewerDeviceID == "" || len(targets) > 100 {
		return nil, ErrPrivateContentInvalid
	}
	response := &privatecontentpb.CheckMomentReadPolicyResponse{}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec("SET LOCAL statement_timeout = '4500ms'").Error; err != nil {
				return err
			}
		}
		postIDs := make([]string, 0, len(targets))
		for _, target := range targets {
			postIDs = append(postIDs, target.GetPostId())
		}
		var posts []dbmodel.SocialPrivateContentPost
		if len(postIDs) > 0 {
			if err := tx.Select("post_id", "content_id", "generation", "author_ptid", "audience_snapshot_id").
				Where("post_id IN ? AND lifecycle_state = ? AND deleted_at IS NULL",
					postIDs, privateContentLifecycleActive).Find(&posts).Error; err != nil {
				return err
			}
		}
		parents := make(map[string]dbmodel.SocialPrivateContentPost, len(posts))
		readable := make(map[string]bool, len(posts))
		for _, post := range posts {
			parents[post.PostID] = post
			if err := authorizePrivatePostViewer(tx, post, viewerPTID); err != nil {
				if errors.Is(err, ErrPrivateContentNotFound) || errors.Is(err, gorm.ErrRecordNotFound) {
					continue
				}
				return err
			}
			readable[post.PostID] = true
		}
		remoteParents := make(map[string]bool)
		for _, target := range targets {
			if err := ctx.Err(); err != nil {
				return err
			}
			allowed := readable[target.PostId]
			if parent, local := parents[target.PostId]; local {
				if allowed && target.CommentId != "" {
					var count int64
					if err := privateCommentVisibilityScope(tx, parent, viewerPTID).
						Where("post_id = ? AND comment_id = ?", target.PostId, target.CommentId).
						Count(&count).Error; err != nil {
						return err
					}
					allowed = count == 1
				}
			} else {
				var checked bool
				allowed, checked = remoteParents[target.PostId]
				if !checked {
					_, err := loadRemotePrivatePost(ctx, tx, target.PostId, viewerPTID, viewerDeviceID)
					if err != nil && !errors.Is(err, ErrPrivateContentNotFound) {
						return err
					}
					allowed = err == nil
					remoteParents[target.PostId] = allowed
				}
				if allowed && target.CommentId != "" {
					row, err := loadRemotePrivateCommentRow(ctx, tx, target.PostId, target.CommentId, viewerPTID)
					if err != nil && !errors.Is(err, ErrPrivateContentNotFound) {
						return err
					}
					allowed = err == nil
					if allowed {
						_, _, err = loadRemotePrivateDelivery(ctx, tx, row, viewerDeviceID, false)
						if err != nil && !errors.Is(err, ErrPrivateContentNotFound) {
							return err
						}
						allowed = err == nil
					}
				}
			}
			decision := privatecontentpb.MomentReadDecision_MOMENT_READ_DECISION_UNAVAILABLE
			if allowed {
				decision = privatecontentpb.MomentReadDecision_MOMENT_READ_DECISION_READABLE
			}
			response.Outcomes = append(response.Outcomes, &privatecontentpb.MomentReadPolicyOutcome{
				ItemId: target.ItemId, Decision: decision,
			})
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return response, err
}
