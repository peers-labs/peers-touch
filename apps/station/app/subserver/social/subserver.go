package social

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/clusterreadiness"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/appdir"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touch "github.com/peers-labs/peers-touch/station/frame/touch"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
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
	publicSearchSvc   *application.PublicSearchService
	privateContentSvc *application.PrivateContentService
	privateObjectSvc  *application.PrivateObjectService
	feedLogSvc        *application.FeedLogService
	database          *gorm.DB
	privateObjects    storage.Backend

	federatedFriendRequestSvc *application.FederatedFriendRequestService
	federatedRelationshipSvc  *application.FederatedRelationshipService
	friendRequestEffectSvc    *application.FriendRequestDirectEffectService
	friendRequestEffectCancel context.CancelFunc
	friendRequestEffectWait   sync.WaitGroup
	privateObjectCancel       context.CancelFunc
	privateObjectWait         sync.WaitGroup
	feedCancel                context.CancelFunc
	feedWait                  sync.WaitGroup
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
	if err := infrastructure.MigratePublicSearchSchema(ctx, rds); err != nil {
		return fmt.Errorf("migrate social public search indexes: %w", err)
	}
	s.publicSearchSvc, err = application.NewPublicSearchService(rds)
	if err != nil {
		return fmt.Errorf("initialize social public search: %w", err)
	}

	// Actor identity translation is owned by the persistence adapter.
	resolver := infrastructure.NewActorIdentity(rds)
	groups := application.NewNoopGroupMembershipChecker()

	repos := infrastructure.NewRepos(rds, func(ctx context.Context, tx delivery.Transaction,
		subscriber, author string, enabled bool) error {
		return s.feedLogSvc.ChangeSubscription(ctx, tx, subscriber, author, enabled)
	})

	// MediaResolver wires the cross-subserver gate that rejects
	// foreign-origin or fabricated `oss://...` CIDs in image / video
	// posts. The OSS subserver lives in the same process and stores
	// `FileMeta` in the same RDS, so the resolver runs as a single
	// SELECT — no HTTP loopback. See `infrastructure/oss_media_resolver.go`.
	media := infrastructure.NewOssMediaResolver(rds)
	momentEvents := application.NewMomentEventPublisher()

	// Reaction service has no inter-service dependency; build first
	// so the moment service can hold a pointer for hydration.
	s.reactionSvc = application.NewReactionService(repos)

	s.momentSvc = application.NewMomentService(rds, repos, resolver, groups, media, s.reactionSvc, momentEvents)
	s.commentSvc = application.NewCommentService(repos, s.momentSvc, momentEvents)
	// Public @-mention delivery re-adjudicates the parent Moment for
	// each recipient through the owner read port at notification time.
	commentMentionNotifier := application.NewCommentMentionNotifier(
		func(ctx context.Context, postID uint64, viewerPTID string) bool {
			post, readErr := s.momentSvc.GetMoment(
				ctx, strconv.FormatUint(postID, 10), viewerPTID,
			)
			return readErr == nil && post != nil && !post.GetIsDeleted()
		},
	)
	s.commentSvc.SetMentionNotifier(commentMentionNotifier)
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
	feedActors, ok := server.GetOptions().SubserverInstances["actor_identity"].(application.FeedActorIdentity)
	if !ok || feedActors == nil {
		return fmt.Errorf("initialize Social feed: Actor Identity capability unavailable")
	}
	feedStore, err := infrastructure.NewFeedLogStore(rds)
	if err != nil {
		return err
	}
	if err := feedStore.Migrate(ctx); err != nil {
		return fmt.Errorf("migrate Social feed: %w", err)
	}
	s.feedLogSvc, err = application.NewFeedLogService(feedStore, feedActors,
		federationRuntime.LocalStationPeerID(), infrastructure.NewFeedProjector(federationRuntime.LocalStationPeerID()).Apply)
	if err != nil {
		return err
	}
	feedProjector := infrastructure.NewFeedProjector(federationRuntime.LocalStationPeerID())
	feedProjector.SetObserver(momentEvents.FeedObserver())
	s.feedLogSvc.SetProjector(feedProjector)
	s.feedLogSvc.SetWritePolicy(application.NewFeedWritePolicy())
	if err := s.feedLogSvc.ConfigureFederation(federationRuntime.Signer(), feedPeerPull(federationRuntime)); err != nil {
		return err
	}
	if err := configureFeedAcceptance(s.feedLogSvc, federationRuntime.LocalStationPeerID()); err != nil {
		return err
	}
	if err := federationRuntime.RegisterPeerEndpoint(federationruntime.PeerRouteSocialPublicFeedRead, s.handleFederatedFeedRead); err != nil {
		return err
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
	if err := s.feedLogSvc.ConfigurePollAuthority(privateStationSigner, privateStationSigner.verifyFeedPollStation); err != nil {
		return err
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
	// Private @-mention delivery trusts the signed mention-routing
	// facts already adjudicated against the audience snapshot at
	// prepare time; only static resource IDs are persisted.
	s.privateContentSvc.ConfigureMentionNotifications(commentMentionNotifier)
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
	if err := federationRuntime.RegisterDeliveryObserver(
		delivery.PayloadKindSocialPrivateResource,
		s.privateContentSvc,
	); err != nil {
		return fmt.Errorf(
			"register Social private Federation delivery observer: %w",
			err,
		)
	}
	s.relationshipSvc.ConfigurePrivateRevocation(
		s.privateContentSvc,
		application.NewSocialGraphEventPublisher(),
	)
	dataDirectory, err := appdir.Resolve("station", "data")
	if err != nil {
		return fmt.Errorf("resolve Social private object data directory: %w", err)
	}
	privateObjectBackend := clusterreadiness.FilesystemBackend(
		filepath.Join(dataDirectory, "social-private-objects"),
	)
	privateObjectBlobs, err := infrastructure.NewPrivateObjectBlobStore(
		privateObjectBackend,
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
	s.database = rds
	s.privateObjects = privateObjectBackend
	if err := s.privateObjectSvc.ConfigureFederatedRead(
		federationRuntime.LocalStationPeerID(),
		privateFederationMembership,
		federatedPrivateObjectPeer{runtime: federationRuntime},
	); err != nil {
		return fmt.Errorf(
			"configure Social private object Federation read: %w",
			err,
		)
	}
	if err := federationRuntime.RegisterPeerEndpoint(
		federationruntime.PeerRouteSocialPrivateObjectRead,
		s.handleFederatedPrivateObjectRead,
	); err != nil {
		return fmt.Errorf(
			"register Social private object Federation endpoint: %w",
			err,
		)
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
	s.federatedRelationshipSvc.
		WithActorDeviceKeyResolver(actorDeviceKeyPort{}).
		WithPrivateContentRevoker(s.privateContentSvc)
	if err := federationRuntime.RegisterReceivers(func(registry *delivery.Registry) error {
		if err := s.feedLogSvc.RegisterReceivers(registry); err != nil {
			return err
		}
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
		if err := infrastructure.RegisterFederatedPrivateResourceReceivers(
			registry,
			s.privateContentSvc,
		); err != nil {
			return err
		}
		return infrastructure.RegisterFederatedPrivateInteractionReceivers(
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
	feedContext, feedCancel := context.WithCancel(ctx)
	s.feedCancel = feedCancel
	s.feedWait.Add(1)
	go func() {
		defer s.feedWait.Done()
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			if err := s.feedLogSvc.ProcessFederation(feedContext); err != nil && feedContext.Err() == nil {
				log.Warnf(feedContext, "[social] public feed reconcile remains retryable: %v", err)
			}
			select {
			case <-feedContext.Done():
				return
			case <-ticker.C:
			}
		}
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
	if s.feedCancel != nil {
		s.feedCancel()
		s.feedCancel = nil
	}
	s.friendRequestEffectWait.Wait()
	s.privateObjectWait.Wait()
	s.feedWait.Wait()
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

// ClusterReadiness verifies that Social metadata and private object bytes are
// shared before this node can publish clustered readiness.
func (s *subServer) ClusterReadiness(ctx context.Context) (string, error) {
	s.mu.RLock()
	status := s.status
	database := s.database
	privateObjects := s.privateObjects
	s.mu.RUnlock()
	if status != server.StatusRunning {
		return "", fmt.Errorf("social: cluster runtime is not running")
	}
	return clusterreadiness.SharedPostgresAndFilesystem(
		ctx,
		"social",
		database,
		privateObjects,
	)
}

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
