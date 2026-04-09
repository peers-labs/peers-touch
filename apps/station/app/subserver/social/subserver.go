package social

import (
	"context"
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	touch "github.com/peers-labs/peers-touch/station/frame/touch"
)

type subServer struct {
	mu     sync.RWMutex
	status server.Status

	// Wrappers
	commonWrapper server.Wrapper
	jwtWrapper    server.Wrapper

	// Application services
	postSvc         *application.PostService
	commentSvc      *application.CommentService
	relationshipSvc *application.RelationshipService
	timelineSvc     *application.TimelineService
}

func NewSocialSubServer(opts ...option.Option) server.Subserver {
	return &subServer{status: server.StatusStopped}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusStarting

	// Initialize wrappers
	s.commonWrapper = touch.CommonAccessControlWrapper(model.RouteNameSocial)
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	// Get database connection
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	// Create infrastructure repositories
	postRepo := infrastructure.NewPostRepository(rds)
	postContentRepo := infrastructure.NewPostContentRepository(rds)
	likeRepo := infrastructure.NewLikeRepository(rds)
	followRepo := infrastructure.NewFollowRepository(rds)

	// Create domain converter
	postConverter := domain.NewPostConverter(likeRepo)

	// Create application services
	s.postSvc = application.NewPostService(rds, postRepo, postContentRepo, likeRepo, postConverter)
	s.commentSvc = application.NewCommentService(rds)
	s.relationshipSvc = application.NewRelationshipService(followRepo)
	s.timelineSvc = application.NewTimelineService(postRepo, postConverter)

	log.Infof(ctx, "[social] subserver initialized")
	return nil
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusRunning
	log.Infof(ctx, "[social] subserver started")
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusStopped
	log.Infof(ctx, "[social] subserver stopped")
	return nil
}

func (s *subServer) Name() string               { return "social" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}
func (s *subServer) Status() server.Status { return s.status }
