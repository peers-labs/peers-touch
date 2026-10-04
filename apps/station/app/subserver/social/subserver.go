package social

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/appdir"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
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
	commonWrapper                    server.Wrapper
	jwtWrapper                       server.Wrapper
	optionalJWTWrapper               server.Wrapper
	privateContentJWTWrapper         server.Wrapper
	privateContentOptionalJWTWrapper server.Wrapper

	// Application services
	momentSvc         *application.MomentService
	commentSvc        *application.CommentService
	reactionSvc       *application.ReactionService
	circleSvc         *application.CircleService
	timelineSvc       *application.TimelineService
	relationshipSvc   *application.RelationshipService
	statsSvc          *application.StatsService
	moderationSvc     *application.ModerationService
	privateContentSvc *application.PrivateContentService
	privateObjectSvc  *application.PrivateObjectService

	federatedFriendRequestSvc *application.FederatedFriendRequestService
	federatedRelationshipSvc  *application.FederatedRelationshipService
	friendRequestEffectSvc    *application.FriendRequestDirectEffectService
	friendRequestEffectCancel context.CancelFunc
	friendRequestEffectWait   sync.WaitGroup
	privateObjectCancel       context.CancelFunc
	privateObjectWait         sync.WaitGroup
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
	s.optionalJWTWrapper = server.HTTPWrapperAdapter(httpadapter.OptionalJWT(provider))
	s.privateContentJWTWrapper = server.HTTPWrapperAdapter(
		httpadapter.RequireStructuredJWT(
			provider,
			int32(model.ErrorCode_ERROR_CODE_UNAUTHORIZED),
			true,
		),
	)
	s.privateContentOptionalJWTWrapper = server.HTTPWrapperAdapter(
		httpadapter.OptionalStructuredJWT(
			provider,
			int32(model.ErrorCode_ERROR_CODE_UNAUTHORIZED),
			true,
		),
	)

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	if err := infrastructure.MigrateIdentitySchema(rds); err != nil {
		return fmt.Errorf("migrate social identity schema: %w", err)
	}
	if err := infrastructure.MigrateInteractionSchema(rds); err != nil {
		return fmt.Errorf("migrate social interaction schema: %w", err)
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
	actorCapabilities, err := resolvePrivateContentActorCapabilities()
	if err != nil {
		return fmt.Errorf("initialize Social private Actor Identity port: %w", err)
	}
	privateContentStore, err := infrastructure.NewGORMPrivateContentStore(rds)
	if err != nil {
		return fmt.Errorf("initialize Social private content store: %w", err)
	}
	if err := privateContentStore.Migrate(ctx); err != nil {
		return err
	}
	privateAudienceAuthority, err :=
		infrastructure.NewGORMPrivateAudienceAuthority(rds)
	if err != nil {
		return fmt.Errorf("initialize Social private audience authority: %w", err)
	}
	privateFederationMembership, err :=
		resolvePrivateContentFederationMembership()
	if err != nil {
		return fmt.Errorf(
			"initialize Social private Federation membership port: %w",
			err,
		)
	}
	privateGroupRecipients := newPrivateContentGroupRecipientPort()
	privateRecipientDirectory, err := newPrivateContentRecipientDirectory(
		actorCapabilities,
		federationRuntime,
		privateAudienceAuthority,
		privateFederationMembership,
	)
	if err != nil {
		return fmt.Errorf("initialize Social private recipient directory: %w", err)
	}
	privateStationKeyStore := authfed.NewKeyStoreGORMWithDB(rds)
	privateProofKeyAuthority, err := authfed.NewContentProofKeyAuthority(
		federationRuntime.LocalStationPeerID(),
		privateStationKeyStore,
	)
	if err != nil {
		return fmt.Errorf(
			"initialize Social private proof-key authority: %w",
			err,
		)
	}
	privateStationSigner := privateContentStationSigner{
		stationPeerID:     federationRuntime.LocalStationPeerID(),
		proofKeyAuthority: privateProofKeyAuthority,
	}
	s.privateContentSvc, err = application.NewPrivateContentService(
		privateContentStore,
		privateAudienceAuthority,
		privateAudienceAuthority,
		privateGroupRecipients,
		privateRecipientDirectory,
		privateContentKeyExchangePort{},
		privateStationSigner,
		privateContentAuthorSignatureVerifier{
			actors:             actorCapabilities,
			localStationPeerID: federationRuntime.LocalStationPeerID(),
		},
		privateContentSystemClock{},
	)
	if err != nil {
		return fmt.Errorf("initialize Social private content service: %w", err)
	}
	if err := s.privateContentSvc.ConfigureFederatedPrivateDelivery(
		federationRuntime.LocalStationPeerID(),
		privateFederationMembership,
		momentEvents,
	); err != nil {
		return fmt.Errorf(
			"configure Social private Federation delivery: %w",
			err,
		)
	}
	dataDirectory, err := appdir.Resolve("station", "data")
	if err != nil {
		return fmt.Errorf("resolve Social private object data directory: %w", err)
	}
	privateObjectBlobs, err := infrastructure.NewPrivateObjectBlobStore(
		storage.NewLocalBackend(
			filepath.Join(dataDirectory, "social-private-objects"),
		),
	)
	if err != nil {
		return fmt.Errorf("initialize Social private object storage: %w", err)
	}
	s.privateObjectSvc, err = application.NewPrivateObjectService(
		privateContentStore,
		privateObjectBlobs,
		privateRecipientDirectory,
		privateStationSigner,
		privateContentSystemClock{},
	)
	if err != nil {
		return fmt.Errorf("initialize Social private object service: %w", err)
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
	s.federatedFriendRequestSvc, err = application.NewFederatedFriendRequestService(
		federatedStore,
		federationRuntime.Signer(),
		federationRuntime.LocalStationPeerID(),
		clock,
	)
	if err != nil {
		return fmt.Errorf("initialize federated Friend Request service: %w", err)
	}
	s.federatedFriendRequestSvc.WithActorDeviceKeyResolver(actorDeviceKeyPort{})
	s.federatedRelationshipSvc, err = application.NewFederatedRelationshipService(
		federatedStore,
		federationRuntime.Signer(),
		federationRuntime.LocalStationPeerID(),
		clock,
	)
	if err != nil {
		return fmt.Errorf("initialize federated Social relationship service: %w", err)
	}
	s.federatedRelationshipSvc.WithActorDeviceKeyResolver(actorDeviceKeyPort{})
	if err := federationRuntime.RegisterReceivers(func(registry *delivery.Registry) error {
		if err := infrastructure.RegisterFederatedFriendRequestReceivers(
			registry,
			s.federatedFriendRequestSvc,
		); err != nil {
			return err
		}
		if err := infrastructure.RegisterFederatedRelationshipReceiver(
			registry,
			s.federatedRelationshipSvc,
		); err != nil {
			return err
		}
		return infrastructure.RegisterFederatedPrivateResourceReceiver(
			registry,
			s.privateContentSvc,
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
	if s.federatedFriendRequestSvc == nil ||
		s.federatedRelationshipSvc == nil ||
		s.friendRequestEffectSvc == nil ||
		s.privateObjectSvc == nil {
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
	objectContext, objectCancel := context.WithCancel(ctx)
	s.privateObjectCancel = objectCancel
	s.privateObjectWait.Add(1)
	go func() {
		defer s.privateObjectWait.Done()
		s.runPrivateObjectCleanup(objectContext)
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
	if s.privateObjectCancel != nil {
		s.privateObjectCancel()
		s.privateObjectCancel = nil
	}
	s.friendRequestEffectWait.Wait()
	s.privateObjectWait.Wait()
	s.status = server.StatusStopped
	log.Infof(ctx, "[social] subserver stopped")
	return nil
}

func (s *subServer) runPrivateObjectCleanup(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		if _, err := s.privateObjectSvc.CleanupUnattached(ctx); err != nil &&
			ctx.Err() == nil {
			log.Warnf(
				ctx,
				"[social] private object cleanup remains retryable: %v",
				err,
			)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
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
