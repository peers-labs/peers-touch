package social

import (
	"context"
	"fmt"
	"strings"
	"sync"

	convsub "github.com/peers-labs/peers-touch/station/app/subserver/conversation"
	envpkg "github.com/peers-labs/peers-touch/station/app/subserver/envelope"
	envinf "github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"
	notifapp "github.com/peers-labs/peers-touch/station/app/subserver/notification/application"
	notifinfra "github.com/peers-labs/peers-touch/station/app/subserver/notification/infrastructure"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touch "github.com/peers-labs/peers-touch/station/frame/touch"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

type subServer struct {
	mu     sync.RWMutex
	status server.Status

	// Wrappers
	commonWrapper server.Wrapper
	jwtWrapper    server.Wrapper

	// Application services
	momentSvc        *application.MomentService
	commentSvc       *application.CommentService
	reactionSvc      *application.ReactionService
	circleSvc        *application.CircleService
	timelineSvc      *application.TimelineService
	relationshipSvc  *application.RelationshipService
	friendRequestSvc *application.FriendRequestService
	statsSvc         *application.StatsService
	moderationSvc    *application.ModerationService
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
	momentEvents := application.NewMomentEventPublisher()

	// Reaction service has no inter-service dependency; build first
	// so the moment service can hold a pointer for hydration.
	s.reactionSvc = application.NewReactionService(rds, repos, momentEvents)

	s.momentSvc = application.NewMomentService(rds, repos, resolver, groups, media, s.reactionSvc, momentEvents)
	s.commentSvc = application.NewCommentService(repos, s.momentSvc, momentEvents)
	s.circleSvc = application.NewCircleService(repos)
	s.timelineSvc = application.NewTimelineService(repos, s.momentSvc, resolver, groups)
	s.relationshipSvc = application.NewRelationshipService(repos.Follows, repos.Blocks, repos.Moderation)
	friendRequestRepo := infrastructure.NewFriendRequestRepository(rds)
	notifRepo := notifinfra.NewGormRepo(rds)
	notifSvc := notifapp.NewService(notifRepo)

	localStationID := socialLocalAudience()
	convRepo := convsub.NewPostgresRepository(rds)
	envRepo := envinf.NewPostgresRepository(rds)
	envBus := envpkg.NewSSEDeviceBus()
	envSvc := envpkg.NewService(envRepo, envBus, socialLocalAudience)
	envelopeBridge := convsub.NewEnvelopeBridge(envSvc)
	convSvc := convsub.NewConversationService(convRepo, envelopeBridge, localStationID)

	s.friendRequestSvc = application.NewFriendRequestService(
		friendRequestRepo, repos.Blocks, s.relationshipSvc,
		&notifAdapter{svc: notifSvc},
		&convAdapter{svc: convSvc},
	)
	s.statsSvc = application.NewStatsService(rds, repos)
	s.moderationSvc = application.NewModerationService(repos)

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

// notifAdapter bridges the notification application service to the
// NotificationProducer interface expected by FriendRequestService.
type notifAdapter struct {
	svc *notifapp.Service
}

func (a *notifAdapter) Produce(recipientID, actorID string, notifType, category int32, targetType, targetID, title, body, groupKey string, metadata map[string]string) error {
	_, err := a.svc.Produce(recipientID, actorID, notifType, category, targetType, targetID, title, body, groupKey, metadata)
	return err
}

// convAdapter bridges the conversation service to the ConversationCreator
// interface expected by FriendRequestService.
type convAdapter struct {
	svc convsub.Service
}

func (a *convAdapter) CreateDirect(ctx context.Context, actorAID, actorBID uint64) error {
	actors, err := actor.GetActorsByIDs(ctx, []uint64{actorAID, actorBID})
	if err != nil {
		return fmt.Errorf("resolve direct-conversation actors: %w", err)
	}
	actorAPtid, actorAStation, actorBPtid, actorBStation, err := canonicalDirectParticipants(
		actors,
		actorAID,
		actorBID,
	)
	if err != nil {
		return err
	}
	_, err = a.svc.CreateDirect(
		ctx,
		actorAPtid,
		actorBPtid,
		actorAStation,
		actorBStation,
	)
	return err
}

func canonicalDirectParticipants(
	actors map[uint64]*db.Actor,
	actorAID, actorBID uint64,
) (string, string, string, string, error) {
	actorA, okA := actors[actorAID]
	actorB, okB := actors[actorBID]
	if !okA || !okB || actorA == nil || actorB == nil {
		return "", "", "", "", fmt.Errorf("resolve direct-conversation actors: actor record missing")
	}
	actorAPtid := strings.TrimSpace(actorA.PTID)
	actorBPtid := strings.TrimSpace(actorB.PTID)
	if actorAPtid == "" || actorBPtid == "" {
		return "", "", "", "", fmt.Errorf("resolve direct-conversation actors: canonical PTID missing")
	}
	return actorAPtid, actorA.HomeStationPeerID, actorBPtid, actorB.HomeStationPeerID, nil
}

func socialLocalAudience() string {
	identity := nativefed.LocalIdentitySnapshot()
	if strings.TrimSpace(identity.StationPeerID.String()) != "" {
		return identity.StationPeerID.String()
	}
	if strings.TrimSpace(identity.StationDomain) != "" {
		return strings.TrimSpace(identity.StationDomain)
	}
	return ""
}
