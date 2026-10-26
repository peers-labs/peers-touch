package application

import (
	"context"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

// PublicReadPort is the original Social owner of point and batch read policy.
// Search consumes this port, not a second copy of post/comment permissions.
type PublicReadPort struct {
	repos *infrastructure.Repos
}

type PublicReadBatch struct {
	Posts    map[uint64]*domain.Post
	Comments map[uint64]*domain.Comment
	Authors  map[string]*db.Actor
}

func NewPublicReadPort(repos *infrastructure.Repos) *PublicReadPort {
	return &PublicReadPort{repos: repos}
}

func (p *PublicReadPort) Read(
	ctx context.Context, viewerPTID string, postIDs, commentIDs []uint64,
) (*PublicReadBatch, error) {
	if len(postIDs)+len(commentIDs) > 100 {
		return nil, fmt.Errorf("public read batch exceeds 100 resources")
	}
	comments, err := p.repos.Comments.GetPublicByIDs(ctx, commentIDs)
	if err != nil {
		return nil, err
	}
	return p.readWithComments(ctx, viewerPTID, postIDs, comments)
}

func (p *PublicReadPort) readWithComments(
	ctx context.Context, viewerPTID string, postIDs []uint64, comments []*domain.Comment,
) (*PublicReadBatch, error) {
	ids := make(map[uint64]bool)
	for _, id := range postIDs {
		ids[id] = true
	}
	for _, comment := range comments {
		ids[comment.PostID] = true
	}
	parentIDs := make([]uint64, 0, len(ids))
	for id := range ids {
		parentIDs = append(parentIDs, id)
	}
	posts, err := p.repos.PublicPosts.GetByIDs(ctx, parentIDs)
	if err != nil {
		return nil, err
	}
	return p.authorize(ctx, viewerPTID, posts, comments)
}

func (p *PublicReadPort) authorize(
	ctx context.Context, viewerPTID string, posts []*domain.Post, comments []*domain.Comment,
) (*PublicReadBatch, error) {
	if len(posts)+len(comments) > 201 {
		return nil, fmt.Errorf("public read policy batch exceeds bound")
	}
	ptidSet := make(map[string]bool)
	for _, post := range posts {
		ptidSet[post.AuthorPTID] = true
	}
	for _, comment := range comments {
		ptidSet[comment.AuthorPTID] = true
	}
	delete(ptidSet, "")
	ptids := make([]string, 0, len(ptidSet))
	for ptid := range ptidSet {
		ptids = append(ptids, ptid)
	}
	authors, err := p.repos.Identity.ActorsByPTIDs(ctx, ptids)
	if err != nil {
		return nil, err
	}
	blocked, err := blockedActorPTIDs(ctx, p.repos, viewerPTID, ptids)
	if err != nil {
		return nil, err
	}
	domains, peers := make([]string, 0, len(authors)), make([]string, 0, len(authors))
	knownPTIDs := make([]string, 0, len(authors))
	for ptid, author := range authors {
		domains = append(domains, author.HomeStationDomain)
		peers = append(peers, author.HomeStationPeerID)
		knownPTIDs = append(knownPTIDs, ptid)
	}
	blockedDomains, blockedPeers, err := p.repos.Moderation.BlockedStations(ctx, domains, peers)
	if err != nil {
		return nil, err
	}
	actorReadable := func(ptid string) bool {
		a := authors[ptid]
		return a != nil && !blocked[ptid] &&
			!blockedDomains[strings.TrimSpace(a.HomeStationDomain)] &&
			!blockedPeers[strings.TrimSpace(a.HomeStationPeerID)]
	}
	viewer := domain.Viewer{ActorPTID: viewerPTID, BlockedActors: make(map[string]struct{})}
	for ptid, denied := range blocked {
		if denied {
			viewer.BlockedActors[ptid] = struct{}{}
		}
	}
	mutual := make(map[string]struct{})
	if len(comments) > 0 && viewerPTID != "" && len(knownPTIDs) > 0 {
		following, err := p.repos.Follows.GetRelationships(ctx, viewerPTID, knownPTIDs)
		if err != nil {
			return nil, err
		}
		followedBy, err := p.repos.Follows.GetReverseRelationships(ctx, viewerPTID, knownPTIDs)
		if err != nil {
			return nil, err
		}
		for ptid := range following {
			if followedBy[ptid] && actorReadable(ptid) {
				mutual[ptid] = struct{}{}
			}
		}
	}
	out := &PublicReadBatch{
		Posts: make(map[uint64]*domain.Post), Comments: make(map[uint64]*domain.Comment), Authors: authors,
	}
	converter := domain.NewPostConverter()
	for _, post := range posts {
		if !post.IsPublic() || !actorReadable(post.AuthorPTID) {
			continue
		}
		if readable, _ := domain.CanRead(viewer, post.AuthorPTID, post.Audience, post.IsDeleted()); !readable {
			continue
		}
		// A partially decoded body is not CONTENT_READY for discovery/open.
		wire, err := converter.DomainToProto(post)
		if err != nil || wire == nil || wire.Content == nil {
			continue
		}
		out.Posts[post.ID] = post
	}
	for _, comment := range comments {
		parent := out.Posts[comment.PostID]
		if parent == nil || comment.PostClass != domain.PostClassPublic ||
			comment.DeletedAt != nil || !actorReadable(comment.AuthorPTID) {
			continue
		}
		visibility := domain.InteractionVisibility{
			ViewerPTID: viewerPTID, PostAuthorPTID: parent.AuthorPTID, MutualActorPTIDs: mutual,
		}
		if visibility.CanSeeActor(comment.AuthorPTID) {
			out.Comments[comment.ID] = comment
		}
	}
	return out, nil
}
