package social

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
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
	moderationSvc   *application.ModerationService

	federatedFriendRequestSvc *application.FederatedFriendRequestService
	friendRequestEffectSvc    *application.FriendRequestDirectEffectService
	friendRequestEffectCancel context.CancelFunc
	friendRequestEffectWait   sync.WaitGroup
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
	if err := infrastructure.MigrateIdentitySchema(rds); err != nil {
		return fmt.Errorf("migrate social identity schema: %w", err)
	}

	// Actor identity translation is owned by the persistence adapter.
	resolver := infrastructure.NewActorIdentity(rds)
	groups := application.NewNoopGroupMembershipChecker()

	repos := infrastructure.NewRepos(rds)

	// MediaResolver wires the cross-subserver gate that rejects
	// foreign-origin or fabricated `oss://...` CIDs in image / video
	// posts. The OSS subserver lives in the same process and stores
	// `FileMeta` in the same RDS, so the resolver runs as a single
	// SELECT — no HTTP loopback. See `infrastructure/oss_media_resolver.go`.
	media := infrastructure.NewOssMediaResolver(rds)
	momentEvents := application.NewMomentEventPublisher()

	// Reaction service has no inter-service dependency; build first
	// so the moment service can hold a pointer for hydration.
	s.reactionSvc = application.NewReactionService(rds, repos, momentEvents)

	s.momentSvc = application.NewMomentService(rds, repos, resolver, groups, media, s.reactionSvc, momentEvents)
	s.commentSvc = application.NewCommentService(repos, s.momentSvc, momentEvents)
	s.circleSvc = application.NewCircleService(repos)
	s.timelineSvc = application.NewTimelineService(repos, s.momentSvc, resolver, groups)
	s.relationshipSvc = application.NewRelationshipService(repos.Follows, repos.Blocks, repos.Moderation)

	federationRuntime, err := sharedFederationRuntime()
	if err != nil {
		return fmt.Errorf("initialize Social Federation composition: %w", err)
	}
	clock := delivery.SystemClock{}
	federatedStore, err := infrastructure.NewGORMFederatedFriendRequestStore(
		rds,
		clock,
	)
	if err != nil {
		return fmt.Errorf("initialize Social Friend Request store: %w", err)
	}
	if err := federatedStore.Migrate(ctx); err != nil {
		return fmt.Errorf("migrate Social Friend Request store: %w", err)
	}
	keyHydrator, err := infrastructure.NewVerifiedFriendRequestActorKeyHydrator(rds)
	if err != nil {
		return fmt.Errorf("initialize Social Friend Request identity: %w", err)
	}
	s.federatedFriendRequestSvc, err = application.NewFederatedFriendRequestService(
		federatedStore,
		federationRuntime.Signer(),
		federationRuntime.LocalStationPeerID(),
		clock,
	)
	if err != nil {
		return fmt.Errorf("initialize federated Friend Request service: %w", err)
	}
	s.federatedFriendRequestSvc.WithActorKeyHydrator(keyHydrator)
	if err := federationRuntime.RegisterReceivers(func(registry *delivery.Registry) error {
		return infrastructure.RegisterFederatedFriendRequestReceivers(
			registry,
			s.federatedFriendRequestSvc,
		)
	}); err != nil {
		return fmt.Errorf("register Social Federation receivers: %w", err)
	}
	s.friendRequestEffectSvc, err = application.NewFriendRequestDirectEffectService(
		federatedStore,
		newConversationDirectPort(),
		clock,
		application.FriendRequestDirectEffectPolicy{
			LeaseDuration: friendRequestEffectLease,
			RetryInitial:  friendRequestEffectRetryInitial,
			RetryMaximum:  friendRequestEffectRetryMaximum,
		},
	)
	if err != nil {
		return fmt.Errorf("initialize Friend Request Direct effect worker: %w", err)
	}

	s.statsSvc = application.NewStatsService(repos)
	s.moderationSvc = application.NewModerationService(repos)

	log.Warn(ctx, "[social] CUSTOM_*/CIRCLE/GROUP audiences degrade until P3 wires real ActorResolver + GroupMembershipChecker")
	log.Infof(ctx, "[social] subserver initialized")
	return nil
}

func (s *subServer) Start(ctx context.Context, _ ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.federatedFriendRequestSvc == nil || s.friendRequestEffectSvc == nil {
		s.status = server.StatusError
		return fmt.Errorf("start Social Federation composition: services are not initialized")
	}

	effectContext, cancel := context.WithCancel(ctx)
	s.friendRequestEffectCancel = cancel
	s.friendRequestEffectWait.Add(1)
	go func() {
		defer s.friendRequestEffectWait.Done()
		s.runFriendRequestDirectEffects(effectContext)
	}()

	s.status = server.StatusRunning
	log.Infof(ctx, "[social] subserver started")
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusStopping
	if s.friendRequestEffectCancel != nil {
		s.friendRequestEffectCancel()
		s.friendRequestEffectCancel = nil
	}
	s.friendRequestEffectWait.Wait()
	s.status = server.StatusStopped
	log.Infof(ctx, "[social] subserver stopped")
	return nil
}

func (s *subServer) Name() string                     { return "social" }
func (s *subServer) Type() server.SubserverType       { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress { return server.SubserverAddress{} }
func (s *subServer) Status() server.Status            { return s.status }

func (s *subServer) runFriendRequestDirectEffects(ctx context.Context) {
	ticker := time.NewTicker(friendRequestEffectPollInterval)
	defer ticker.Stop()

	for {
		processed, err := s.friendRequestEffectSvc.ProcessOne(
			ctx,
			"social-friend-request-direct",
		)
		if err != nil && ctx.Err() == nil {
			log.Warnf(
				ctx,
				"[social] Friend Request Direct effect remains retryable: %v",
				err,
			)
		}
		if processed && err == nil {
			continue
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
