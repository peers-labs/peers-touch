package social

import (
	"context"
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touch "github.com/peers-labs/peers-touch/station/frame/touch"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type subServer struct {
	mu     sync.RWMutex
	status server.Status

	// Wrappers
	commonWrapper server.Wrapper
	jwtWrapper    server.Wrapper

	// Application services
	momentSvc       *application.MomentService
	commentSvc      *application.CommentService
	reactionSvc     *application.ReactionService
	circleSvc       *application.CircleService
	timelineSvc     *application.TimelineService
	relationshipSvc *application.RelationshipService
	statsSvc        *application.StatsService
}

func NewSocialSubServer(_ ...option.Option) server.Subserver {
	return &subServer{status: server.StatusStopped}
}

func (s *subServer) Init(ctx context.Context, _ ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusStarting

	s.commonWrapper = touch.CommonAccessControlWrapper(model.RouteNameSocial)
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	// Cross-subserver contracts. P1 wires the no-op default for both
	// — the social subserver compiles and runs end-to-end without
	// requiring chat / actor surfaces to ratify their lookup APIs
	// first. P3 swaps in real implementations.
	resolver := application.NewNoopActorResolver()
	groups := application.NewNoopGroupMembershipChecker()

	repos := infrastructure.NewRepos(rds, resolver.ResolveID)

	// MediaResolver wires the cross-subserver gate that rejects
	// foreign-origin or fabricated `oss://...` CIDs in image / video
	// posts. The OSS subserver lives in the same process and stores
	// `FileMeta` in the same RDS, so the resolver runs as a single
	// SELECT — no HTTP loopback. See `infrastructure/oss_media_resolver.go`.
	media := infrastructure.NewOssMediaResolver(rds)

	// Reaction service has no inter-service dependency; build first
	// so the moment service can hold a pointer for hydration.
	s.reactionSvc = application.NewReactionService(rds, repos)

	s.momentSvc = application.NewMomentService(rds, repos, resolver, groups, media, s.reactionSvc)
	s.commentSvc = application.NewCommentService(repos, s.momentSvc)
	s.circleSvc = application.NewCircleService(repos)
	s.timelineSvc = application.NewTimelineService(repos, s.momentSvc, resolver, groups)
	s.relationshipSvc = application.NewRelationshipService(repos.Follows, repos.Blocks)
	s.statsSvc = application.NewStatsService(rds, repos)

	log.Warn(ctx, "[social] CUSTOM_*/CIRCLE/GROUP audiences degrade until P3 wires real ActorResolver + GroupMembershipChecker")
	log.Infof(ctx, "[social] subserver initialized")
	return nil
}

func (s *subServer) Start(ctx context.Context, _ ...option.Option) error {
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

func (s *subServer) Name() string                     { return "social" }
func (s *subServer) Type() server.SubserverType       { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress { return server.SubserverAddress{} }
func (s *subServer) Status() server.Status            { return s.status }
