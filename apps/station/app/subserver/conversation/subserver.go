package conversation

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"

	conversationengine "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine"
	enginedomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	engineinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/follower"
	envpkg "github.com/peers-labs/peers-touch/station/app/subserver/envelope"
	envinf "github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"
	fedinf "github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	modeldb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type conversationAuthorityReader interface {
	GetConversation(
		ctx context.Context,
		conversationID string,
	) (*enginedomain.AuthorityConversation, error)
	GetMember(
		ctx context.Context,
		conversationID string,
		ptid string,
	) (*enginedomain.AuthorityMember, error)
	ListConversationsForActor(
		ctx context.Context,
		ptid string,
	) ([]enginedomain.AuthorityConversationView, error)
}

type subServer struct {
	status                server.Status
	jwtWrapper            server.Wrapper
	proposalWrapper       server.Wrapper
	leaveIntentWrapper    server.Wrapper
	syncWrapper           server.Wrapper
	repo                  Repository
	service               Service
	proposalService       *ConversationCommandProposalService
	proposalForwarder     ConversationCommandProposalForwarder
	proposalStore         *commandProposalStore
	proposalWorkerCancel  context.CancelFunc
	leaveService          *MlsLeaveIntentService
	leaveIntentForwarder  MlsLeaveIntentForwarder
	kpStore               *KeyPackageStore
	conversationAuthority conversationAuthorityReader
	deviceStore           *touchactor.DeviceStore
	envelopeService       envpkg.Service
	localStationID        string
	fedKpFetcher          *FederatedKeyPackageFetcher
	gateEval              *ConversationGateEvaluator
	relQuerier            social_gate.RelationshipQuerier
	db                    *gorm.DB
	engine                server.Subserver
}

func NewConversationSubServer(opts ...option.Option) server.Subserver {
	return &subServer{status: server.StatusStopped}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting
	registerConversationCommandProposalScope()
	registerMlsLeaveIntentFederationScope()
	registerAuthorityEventSyncScope()

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = withCanonicalConversationSubject(
		server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider)),
		resolveConversationSubjectPTID,
	)

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	if err := modeldb.MigrateStringIdentityColumn(
		rds,
		"conversation_members",
		"actor_did",
		"ptid",
	); err != nil {
		return err
	}

	if err := rds.AutoMigrate(
		&conversationModel{},
		&conversationMemberModel{},
		&conversationMemberDeviceModel{},
		&conversationEventModel{},
		&conversationCommandReceiptModel{},
		&conversationCommandProposalModel{},
		&mlsLeaveIntentModel{},
	); err != nil {
		return err
	}

	repairMemberIndex(rds)

	s.localStationID = conversationLocalAudience()
	s.db = rds
	repo := newPostgresConversationRepo(rds)
	s.repo = repo
	s.proposalStore = newCommandProposalStore(rds)
	authorityRepository := engineinfra.NewAuthorityRepository(rds)
	s.conversationAuthority = authorityRepository
	s.kpStore = NewKeyPackageStore(rds)
	if err := s.kpStore.AutoMigrate(); err != nil {
		return err
	}
	s.deviceStore = touchactor.NewDeviceStore(rds)
	if err := s.deviceStore.AutoMigrate(); err != nil {
		return err
	}

	envRepo := envinf.NewPostgresRepository(rds)
	if err := envRepo.AutoMigrate(); err != nil {
		return err
	}
	envBus := envpkg.NewSSEDeviceBus()
	envelopeService := envpkg.NewService(envRepo, envBus, conversationLocalAudience)
	envelopeBridge := NewEnvelopeBridge(envelopeService)

	s.envelopeService = envelopeService
	s.service = NewConversationService(
		repo,
		envelopeBridge,
		s.localStationID,
		NewPostgresTransitionUnitOfWork(rds),
	)
	authorityService := s.service.(*DefaultService)
	federationRepos := fedinf.NewRepos(rds)
	s.proposalService = NewConversationCommandProposalService(
		authorityService,
		s.deviceStore,
		federationMembershipAdapter{repo: federationRepos.Membership},
		s.localStationID,
	).WithActorKeyHydrator(NewVerifiedProfileActorKeyHydrator(
		federationRepos.Membership,
		authfed.NewPeerKeyStoreGORMWithDB(rds),
		s.deviceStore,
	))
	s.proposalForwarder = NewHTTPConversationCommandProposalForwarder(
		rds,
		authfed.Singleton(),
	)
	s.leaveService = NewMlsLeaveIntentService(
		repo,
		newPostgresLeaveIntentRepository(rds),
		s.deviceStore,
		s.localStationID,
	)
	s.leaveIntentForwarder = NewHTTPMlsLeaveIntentForwarder(
		rds,
		authfed.Singleton(),
	)
	s.proposalWrapper = serverwrapper.RequireFederationToken(
		conversationCommandProposalScope,
		authfed.NewPeerKeyStoreGORMWithDB(rds),
		conversationCommandProposalAudience(),
	)
	s.leaveIntentWrapper = serverwrapper.RequireFederationToken(
		mlsLeaveIntentFederationScope,
		authfed.NewPeerKeyStoreGORMWithDB(rds),
		mlsLeaveIntentFederationAudience(),
	)
	s.syncWrapper = serverwrapper.RequireFederationToken(
		authorityEventSyncScope,
		authfed.NewPeerKeyStoreGORMWithDB(rds),
		authorityEventSyncAudience(),
	)
	s.fedKpFetcher = NewFederatedKeyPackageFetcher(authfed.Singleton())

	// Social gate: compose policy evaluator from repository-backed adapters.
	relAdapter := NewConversationRelationshipAdapter(rds, authorityRepository)
	roleAdapter := NewConversationGroupRoleAdapter(authorityRepository)
	s.gateEval = NewConversationGateEvaluator(relAdapter, roleAdapter, nil)
	s.relQuerier = relAdapter
	s.engine = conversationengine.New(conversationengine.Dependencies{
		CreateDirectPolicy: social_gate.NewGateWrapper(
			s.gateEval,
			"create_direct",
			extractCreateDirectOp,
		),
		SubmitCommandPolicy: social_gate.NewGateWrapper(
			s.gateEval,
			"send_message",
			extractSubmitCommandOp,
		),
	})
	if err := s.engine.Init(ctx, opts...); err != nil {
		s.status = server.StatusError
		return fmt.Errorf("initialize conversation engine: %w", err)
	}

	return nil
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	if err := s.engine.Start(ctx, opts...); err != nil {
		s.status = server.StatusError
		return fmt.Errorf("start conversation engine: %w", err)
	}
	workerCtx, cancel := context.WithCancel(context.Background())
	s.proposalWorkerCancel = cancel
	go s.runCommandProposalWorker(workerCtx)
	registerSignalAuthorizer(s.relQuerier)
	s.status = server.StatusRunning
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	if s.proposalWorkerCancel != nil {
		s.proposalWorkerCancel()
		s.proposalWorkerCancel = nil
	}
	registerSignalAuthorizer(nil)
	if s.engine != nil {
		if err := s.engine.Stop(ctx); err != nil {
			s.status = server.StatusError
			return fmt.Errorf("stop conversation engine: %w", err)
		}
	}
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "conversation" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}
func (s *subServer) Status() server.Status { return s.status }

func (s *subServer) requireActiveMembership(ctx context.Context, conversationID string) error {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return server.Unauthorized("authentication required")
	}
	member, err := s.service.GetMember(ctx, conversationID, subject.ID)
	if err == nil && member != nil &&
		member.MemberStatus == chat.MemberStatus_MEMBER_STATUS_ACTIVE {
		return nil
	}
	if s.db != nil {
		active, followerErr := follower.NewService(s.db).IsActiveMember(
			ctx,
			conversationID,
			subject.ID,
		)
		if followerErr == nil && active {
			return nil
		}
	}
	return server.Forbidden("active conversation membership required")
}

func (s *subServer) requireActiveConversationMembership(
	ctx context.Context,
	conversationID string,
) (*enginedomain.AuthorityConversation, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if s.conversationAuthority == nil {
		return nil, server.InternalError("conversation authority repository unavailable")
	}
	conversation, err := s.conversationAuthority.GetConversation(ctx, conversationID)
	if errors.Is(err, enginedomain.ErrNotFound) {
		return nil, server.Forbidden("active conversation membership required")
	}
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"resolve messaging conversation membership failed",
			err,
		)
	}
	if conversation == nil || !conversation.Active {
		return nil, server.Forbidden("active conversation membership required")
	}
	member, err := s.conversationAuthority.GetMember(
		ctx,
		conversationID,
		subject.ID,
	)
	if errors.Is(err, enginedomain.ErrNotFound) {
		return nil, server.Forbidden("active conversation membership required")
	}
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"resolve messaging actor membership failed",
			err,
		)
	}
	if member == nil || !member.Active {
		return nil, server.Forbidden("active conversation membership required")
	}
	return conversation, nil
}
func mapConversationServiceError(err error) error {
	var transitionErr *TransitionError
	if !errors.As(err, &transitionErr) {
		return server.InternalErrorWithCause("conversation operation failed", err)
	}
	switch transitionErr.Code {
	case "PERMISSION_DENIED", "NOT_MEMBER", "NOT_AUTHORITY", "GROUP_READ_ONLY":
		return server.Forbidden(transitionErr.Message)
	case "TRANSITION_CONFLICT", "EPOCH_STALE", "EPOCH_MISMATCH":
		return server.Conflict(transitionErr.Message)
	default:
		return server.BadRequest(transitionErr.Message)
	}
}

func (s *subServer) Handlers() []server.Handler {
	logID := serverwrapper.LogID()
	deviceIDWrapper := serverwrapper.DeviceID()

	// Social gate wrappers — applied AFTER jwtWrapper (auth must come first).
	fetchKpGate := social_gate.NewGateWrapper(s.gateEval, "fetch_key_package", extractFetchKeyPackageOp)
	dkxSendGate := social_gate.NewGateWrapper(s.gateEval, "dkx_send", extractDkxSendOp)

	handlers := []server.Handler{
		server.NewTypedHandler("conv-identity", "/conversation/identity", server.GET,
			s.handleGetConversationIdentity, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-create-group", "/conversation/group", server.POST,
			s.handleCreateGroup, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler(
			"conv-submit-command-proposal",
			"/conversation/command-proposal",
			server.POST,
			s.handleSubmitConversationCommandProposal,
			logID,
			deviceIDWrapper,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"conv-federated-command-proposal",
			"/federation/conversation/command-proposal",
			server.POST,
			s.handleFederatedConversationCommandProposal,
			logID,
			s.proposalWrapper,
		),
		server.NewTypedHandler(
			"conv-command-proposal-result",
			"/conversation/command-proposal/result",
			server.GET,
			s.handleGetConversationCommandProposalResult,
			logID,
			deviceIDWrapper,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"conv-submit-mls-leave-intent",
			"/conversation/mls/leave-intent",
			server.POST,
			s.handleSubmitMlsLeaveIntent,
			logID,
			deviceIDWrapper,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"conv-list-mls-leave-intents",
			"/conversation/mls/leave-intents",
			server.GET,
			s.handleListPendingMlsLeaveIntents,
			logID,
			deviceIDWrapper,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"conv-federated-submit-mls-leave-intent",
			"/federation/conversation/mls/leave-intent",
			server.POST,
			s.handleFederatedSubmitMlsLeaveIntent,
			logID,
			s.leaveIntentWrapper,
		),
		server.NewTypedHandler(
			"conv-federated-list-mls-leave-intents",
			"/federation/conversation/mls/leave-intents",
			server.POST,
			s.handleFederatedListMlsLeaveIntents,
			logID,
			s.leaveIntentWrapper,
		),
		server.NewTypedHandler(
			"conv-authority-event-sync",
			"/federation/conversation/events/sync",
			server.POST,
			s.handleSyncAuthorityEvents,
			logID,
			s.syncWrapper,
		),
		server.NewTypedHandler("conv-get", "/conversation/get", server.GET,
			s.handleGetConversation, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-public-head", "/conversation/public-head", server.GET,
			s.handleGetConversationPublicHead, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-members", "/conversation/members", server.GET,
			s.handleGetMembers, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-events", "/conversation/events", server.GET,
			s.handleListEvents, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-messages", "/conversation/messages", server.GET,
			s.handleListMessages, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-thread-messages", "/conversation/thread/messages", server.GET,
			s.handleListThreadMessages, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-thread-counts", "/conversation/thread/counts", server.POST,
			s.handleGetThreadCounts, logID, s.jwtWrapper),
		server.NewTypedHandler("kp-upload", "/key-exchange/mls/key-package/upload", server.POST,
			s.handleUploadKeyPackage, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("kp-fetch", "/key-exchange/mls/key-package/fetch", server.POST,
			s.handleFetchKeyPackage, logID, fetchKpGate, s.jwtWrapper),
		server.NewTypedHandler("kp-count", "/key-exchange/mls/key-package/count", server.GET,
			s.handleCountKeyPackages, logID, s.jwtWrapper),
		server.NewTypedHandler("device-list", "/device/list", server.GET,
			s.handleDeviceList, logID, s.jwtWrapper),
		server.NewTypedHandler("device-revoke", "/device/revoke", server.POST,
			s.handleDeviceRevoke, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("dkx-send", "/key-exchange/dkx/send", server.POST,
			s.handleDkxSend, logID, deviceIDWrapper, dkxSendGate, s.jwtWrapper),
	}
	if s.engine == nil {
		return handlers
	}
	return append(handlers, s.engine.Handlers()...)
}

func (s *subServer) handleGetConversationIdentity(
	ctx context.Context,
	_ *chat.GetConversationIdentityRequest,
) (*chat.GetConversationIdentityResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if !strings.HasPrefix(subject.ID, "ptid:") {
		return nil, server.Conflict("authenticated actor has no canonical PTID")
	}
	return &chat.GetConversationIdentityResponse{Ptid: subject.ID}, nil
}

// --- Handlers ---

func (s *subServer) handleCreateDirect(ctx context.Context, req *chat.CreateDirectConversationRequest) (*chat.CreateDirectConversationResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PeerPtid == "" {
		return nil, server.BadRequest("peer_ptid is required")
	}

	peerStation := req.PeerStationPeerId
	if peerStation == "" {
		peerStation = s.localStationID
	}

	conv, err := s.service.CreateDirect(ctx, subject.ID, req.PeerPtid, s.localStationID, peerStation)
	if err != nil {
		return nil, server.InternalErrorWithCause("create direct conversation failed", err)
	}
	return &chat.CreateDirectConversationResponse{Conversation: conv}, nil
}

func (s *subServer) handleCreateGroup(ctx context.Context, req *chat.CreateGroupConversationRequest) (*chat.CreateGroupConversationResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Name == "" {
		return nil, server.BadRequest("name is required")
	}
	if req.GenesisTransition == nil {
		return nil, server.BadRequest("genesis_transition is required")
	}
	if req.ConversationId == "" {
		return nil, server.BadRequest("conversation_id is required")
	}

	conv, transitionEvent, err := s.service.CreateGroup(
		ctx,
		req.Name,
		subject.ID,
		s.localStationID,
		serverwrapper.GetDeviceID(ctx),
		req.FederationId,
		req.ConversationId,
		req.GenesisTransition,
	)
	if err != nil {
		return nil, mapConversationServiceError(err)
	}
	return &chat.CreateGroupConversationResponse{
		Conversation:    conv,
		TransitionEvent: transitionEvent,
	}, nil
}

func (s *subServer) handleSubmitCommand(ctx context.Context, req *chat.SubmitConversationCommandRequest) (*chat.SubmitConversationCommandResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Command == nil {
		return nil, server.BadRequest("command is required")
	}

	req.Command.SenderPtid = subject.ID
	if deviceID := serverwrapper.GetDeviceID(ctx); deviceID != "" {
		req.Command.SenderDeviceId = deviceID
	}

	event, err := s.service.SubmitCommand(ctx, req.Command)
	if err != nil {
		slog.ErrorContext(ctx, "conversation command failed",
			"conversation_id", req.Command.ConversationId,
			"command_id", req.Command.CommandId,
			"error", err,
		)
		return nil, mapConversationServiceError(err)
	}
	return &chat.SubmitConversationCommandResponse{Event: event}, nil
}

func (s *subServer) handleSubmitMlsLeaveIntent(
	ctx context.Context,
	req *chat.SubmitMlsLeaveIntentRequest,
) (*chat.SubmitMlsLeaveIntentResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Intent == nil {
		return nil, server.BadRequest("intent is required")
	}
	intent, err := s.submitAuthenticatedMlsLeaveIntent(
		ctx,
		subject.ID,
		serverwrapper.GetDeviceID(ctx),
		req.Intent,
	)
	if err != nil {
		return nil, err
	}
	return &chat.SubmitMlsLeaveIntentResponse{Intent: intent}, nil
}

func (s *subServer) handleListPendingMlsLeaveIntents(
	ctx context.Context,
	req *chat.ListPendingMlsLeaveIntentsRequest,
) (*chat.ListPendingMlsLeaveIntentsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationId == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	intents, err := s.listAuthenticatedMlsLeaveIntents(
		ctx,
		subject.ID,
		serverwrapper.GetDeviceID(ctx),
		req.ConversationId,
	)
	if err != nil {
		return nil, err
	}
	return &chat.ListPendingMlsLeaveIntentsResponse{Intents: intents}, nil
}

func (s *subServer) handleSubmitReceipt(ctx context.Context, req *chat.SubmitConversationReceiptRequest) (*chat.SubmitConversationReceiptResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationId == "" || req.MessageId == "" {
		return nil, server.BadRequest("conversation_id and message_id are required")
	}
	if err := s.requireActiveMembership(ctx, req.ConversationId); err != nil {
		return nil, err
	}

	receipt := &chat.MessageReceipt{
		ConversationId: req.ConversationId,
		MessageId:      req.MessageId,
		Ptid:           subject.ID,
		DeviceId:       req.DeviceId,
		ReceiptType:    req.ReceiptType,
		Ts:             timestamppb.Now(),
	}

	if err := s.service.SubmitReceipt(ctx, receipt); err != nil {
		return nil, server.InternalErrorWithCause("submit receipt failed", err)
	}
	return &chat.SubmitConversationReceiptResponse{}, nil
}

func (s *subServer) handleGetConversation(ctx context.Context, req *chat.GetConversationRequest) (*chat.GetConversationResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationId == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	if err := s.requireActiveMembership(ctx, req.ConversationId); err != nil {
		return nil, err
	}

	conv, err := s.service.GetConversation(ctx, req.ConversationId)
	if err != nil {
		return nil, server.InternalErrorWithCause("get conversation failed", err)
	}
	return &chat.GetConversationResponse{Conversation: conv}, nil
}

func (s *subServer) handleGetConversationPublicHead(
	ctx context.Context,
	req *chat.GetConversationPublicHeadRequest,
) (*chat.GetConversationPublicHeadResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationId == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	conversation, err := s.repo.GetConversation(ctx, req.ConversationId)
	if err == nil && conversation.AuthorityStationPeerId == s.localStationID {
		member, memberErr := s.repo.GetMember(ctx, req.ConversationId, subject.ID)
		if memberErr != nil ||
			member.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			return nil, server.Forbidden("active conversation membership required")
		}
		event, eventErr := s.repo.GetLastEvent(ctx, req.ConversationId)
		if eventErr != nil {
			return nil, server.InternalErrorWithCause("load authority public head", eventErr)
		}
		transition := event.GetMembershipTransitionCommitted()
		head := &chat.ConversationPublicHead{
			ConversationId:         conversation.ConversationId,
			Source:                 chat.ConversationPublicHeadSource_CONVERSATION_PUBLIC_HEAD_SOURCE_AUTHORITY,
			FederationId:           conversation.FederationId,
			AuthorityStationPeerId: conversation.AuthorityStationPeerId,
			AuthorityEpoch:         conversation.AuthorityEpoch,
			GroupSeq:               event.GroupSeq,
			EventHash:              append([]byte(nil), event.EventHash...),
			MembershipEpoch:        conversation.MembershipEpoch,
			MlsEpoch:               conversation.MlsEpoch,
			Status:                 conversation.Status.String(),
		}
		if transition != nil {
			head.TransitionId = transition.TransitionId
			head.CommitSha256 = append([]byte(nil), transition.CommitSha256...)
		}
		return &chat.GetConversationPublicHeadResponse{Head: head}, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, server.InternalErrorWithCause("load conversation public head", err)
	}
	var followerMember follower.Member
	if err := s.db.WithContext(ctx).First(
		&followerMember,
		"conversation_id = ? AND ptid = ?",
		req.ConversationId,
		subject.ID,
	).Error; err != nil ||
		followerMember.Status != int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE) {
		return nil, server.Forbidden("active follower membership required")
	}
	var followerHead follower.Head
	if err := s.db.WithContext(ctx).First(
		&followerHead,
		"conversation_id = ?",
		req.ConversationId,
	).Error; err != nil {
		return nil, server.InternalErrorWithCause("load follower public head", err)
	}
	return &chat.GetConversationPublicHeadResponse{
		Head: &chat.ConversationPublicHead{
			ConversationId:         followerHead.ConversationID,
			Source:                 chat.ConversationPublicHeadSource_CONVERSATION_PUBLIC_HEAD_SOURCE_FOLLOWER,
			FederationId:           followerHead.FederationID,
			AuthorityStationPeerId: followerHead.AuthorityStationPeerID,
			AuthorityEpoch:         followerHead.AuthorityEpoch,
			GroupSeq:               followerHead.GroupSeq,
			EventHash:              append([]byte(nil), followerHead.EventHash...),
			MembershipEpoch:        followerHead.MembershipEpoch,
			MlsEpoch:               followerHead.MlsEpoch,
			TransitionId:           followerHead.TransitionID,
			CommitSha256:           append([]byte(nil), followerHead.CommitSHA256...),
			Status:                 followerHead.Status,
		},
	}, nil
}

func (s *subServer) handleListConversations(ctx context.Context, _ *chat.ListConversationsRequest) (*chat.ListConversationsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	convs, err := s.service.ListConversations(ctx, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("list conversations failed", err)
	}
	if s.db != nil {
		followerConversations, followerErr := follower.NewService(s.db).
			ListConversationsForActor(ctx, subject.ID)
		if followerErr != nil {
			return nil, server.InternalErrorWithCause(
				"list follower conversations failed",
				followerErr,
			)
		}
		seen := make(map[string]bool, len(convs))
		for _, conversation := range convs {
			seen[conversation.ConversationId] = true
		}
		for _, conversation := range followerConversations {
			if !seen[conversation.ConversationId] {
				convs = append(convs, conversation)
			}
		}
	}
	return &chat.ListConversationsResponse{Conversations: convs}, nil
}

func (s *subServer) handleGetMembers(ctx context.Context, req *chat.GetConversationMembersRequest) (*chat.GetConversationMembersResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationId == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	if err := s.requireActiveMembership(ctx, req.ConversationId); err != nil {
		return nil, err
	}

	var (
		members []*chat.ConversationMember
		err     error
	)
	if _, err := s.repo.GetConversation(ctx, req.ConversationId); err == nil {
		members, err = s.service.GetMembers(ctx, req.ConversationId)
	} else if s.db != nil {
		members, err = follower.NewService(s.db).ListMembers(ctx, req.ConversationId)
	} else {
		err = gorm.ErrRecordNotFound
	}
	if err != nil {
		return nil, server.InternalErrorWithCause("get conversation members failed", err)
	}
	return &chat.GetConversationMembersResponse{Members: members}, nil
}

func (s *subServer) handleListEvents(ctx context.Context, req *chat.ListConversationEventsRequest) (*chat.ListConversationEventsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationId == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	if err := s.requireActiveMembership(ctx, req.ConversationId); err != nil {
		return nil, err
	}

	events, err := s.service.ListEvents(ctx, req.ConversationId, req.AfterSeq, int(req.Limit))
	if err != nil {
		return nil, server.InternalErrorWithCause("list events failed", err)
	}
	return &chat.ListConversationEventsResponse{Events: events}, nil
}

// --- KeyPackage handlers ---

func (s *subServer) handleUploadKeyPackage(ctx context.Context, req *chat.UploadKeyPackageRequest) (*chat.UploadKeyPackageResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if deviceID == "" {
		return nil, server.BadRequest("X-Device-ID is required")
	}
	if requestedDeviceID := strings.TrimSpace(req.DeviceId); requestedDeviceID != "" &&
		requestedDeviceID != deviceID {
		return nil, server.BadRequest("device_id does not match authenticated X-Device-ID")
	}
	if len(req.Data) == 0 {
		return nil, server.BadRequest("data is required")
	}
	active, err := s.deviceStore.IsVerifiedActive(ctx, subject.ID, deviceID)
	if err != nil {
		return nil, server.InternalErrorWithCause("verify messaging device failed", err)
	}
	if !active {
		return nil, server.Forbidden("verified active messaging device required")
	}

	if err := s.kpStore.Upload(ctx, subject.ID, deviceID, s.localStationID, req.Data); err != nil {
		return nil, server.InternalErrorWithCause("upload keypackage failed", err)
	}
	return &chat.UploadKeyPackageResponse{}, nil
}

func (s *subServer) handleFetchKeyPackage(ctx context.Context, req *chat.FetchKeyPackageRequest) (*chat.FetchKeyPackageResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Ptid == "" {
		return nil, server.BadRequest("ptid is required")
	}

	keyPackage, err := s.kpStore.FetchAndConsume(ctx, req.Ptid)
	if err != nil {
		return nil, server.InternalErrorWithCause("fetch keypackage failed", err)
	}

	homeStationPeerID := strings.TrimSpace(req.HomeStationPeerId)
	if keyPackage == nil && homeStationPeerID == "" {
		actorRecord, resolveErr := touchactor.GetActorByPTID(ctx, req.Ptid)
		if resolveErr != nil {
			return nil, server.InternalErrorWithCause("resolve actor Home Station failed", resolveErr)
		}
		if actorRecord != nil {
			homeStationPeerID = strings.TrimSpace(actorRecord.HomeStationPeerID)
		}
	}
	if keyPackage == nil && homeStationPeerID != "" && homeStationPeerID != s.localStationID {
		remoteKeyPackage, fetchErr := s.fedKpFetcher.FetchRemote(ctx, homeStationPeerID, req.Ptid)
		if fetchErr != nil {
			return nil, server.InternalErrorWithCause("federated keypackage fetch failed", fetchErr)
		}
		keyPackage = remoteKeyPackage
	}

	if keyPackage == nil {
		return &chat.FetchKeyPackageResponse{}, nil
	}
	return &chat.FetchKeyPackageResponse{
		Data:              keyPackage.Data,
		Available:         true,
		DeviceId:          keyPackage.DeviceID,
		HomeStationPeerId: keyPackage.StationID,
	}, nil
}

func (s *subServer) handleCountKeyPackages(ctx context.Context, _ *chat.CountKeyPackagesRequest) (*chat.CountKeyPackagesResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	count, err := s.kpStore.CountAvailable(ctx, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("count keypackages failed", err)
	}
	return &chat.CountKeyPackagesResponse{Count: count}, nil
}

// --- Device handlers ---

func (s *subServer) handleDeviceRegister(ctx context.Context, req *chat.RegisterDeviceRequest) (*chat.RegisterDeviceResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if deviceID == "" {
		return nil, server.BadRequest("X-Device-ID is required")
	}
	if strings.TrimSpace(req.DeviceId) != deviceID {
		return nil, server.BadRequest("device_id must match authenticated X-Device-ID")
	}

	if err := s.deviceStore.RegisterLocal(
		ctx,
		subject.ID,
		deviceID,
		req.Label,
		s.localStationID,
		req.SigningKeyId,
		req.PublicKey,
		req.ProfileVersion,
	); err != nil {
		return nil, server.InternalErrorWithCause("device register failed", err)
	}
	return &chat.RegisterDeviceResponse{}, nil
}

func (s *subServer) handleDeviceList(ctx context.Context, _ *chat.ListDevicesRequest) (*chat.ListDevicesResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	records, err := s.deviceStore.ListActive(ctx, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("device list failed", err)
	}

	devices := make([]*chat.DeviceInfoView, 0, len(records))
	for _, r := range records {
		devices = append(devices, &chat.DeviceInfoView{
			DeviceId:  r.DeviceID,
			Label:     r.Label,
			CreatedAt: r.CreatedAt.Format("2006-01-02T15:04:05Z"),
			Revoked:   r.Revoked,
		})
	}
	return &chat.ListDevicesResponse{Devices: devices}, nil
}

func (s *subServer) handleDeviceRevoke(ctx context.Context, req *chat.RevokeDeviceRequest) (*chat.RevokeDeviceResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.DeviceId == "" {
		return nil, server.BadRequest("device_id is required")
	}

	if err := s.deviceStore.Revoke(ctx, subject.ID, req.DeviceId); err != nil {
		if errors.Is(err, touchactor.ErrDeviceSigningKeyNotFound) {
			return nil, server.NotFound("device not found")
		}
		return nil, server.InternalErrorWithCause("device revoke failed", err)
	}
	return &chat.RevokeDeviceResponse{}, nil
}

// --- Direct Key Exchange handler (P2: X3DH initial handshake routing) ---

func (s *subServer) handleDkxSend(ctx context.Context, req *chat.SendDkxRequest) (*chat.SendDkxResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	senderDeviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	recipientPtid := strings.TrimSpace(req.RecipientPtid)
	recipientDeviceID := strings.TrimSpace(req.RecipientDeviceId)
	if senderDeviceID == "" ||
		recipientPtid == "" ||
		recipientDeviceID == "" ||
		req.ConversationId == "" ||
		req.SessionId == "" ||
		len(req.OpaqueKeyMaterial) == 0 {
		return nil, server.BadRequest(
			"sender X-Device-ID, recipient_ptid, recipient_device_id, conversation_id, session_id, and opaque_key_material are required",
		)
	}
	senderDevices, err := s.deviceStore.ListActive(ctx, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("resolve sender device failed", err)
	}
	activeDevices, err := s.deviceStore.ListActive(ctx, recipientPtid)
	if err != nil {
		return nil, server.InternalErrorWithCause("resolve recipient device failed", err)
	}
	recipientStation, err := resolveDkxDeviceRoute(
		subject.ID,
		senderDeviceID,
		recipientPtid,
		recipientDeviceID,
		req.RecipientStationPeerId,
		senderDevices,
		activeDevices,
	)
	if err != nil {
		return nil, err
	}

	dkxPayload := &chat.DirectKeyExchangePayload{
		SessionId:         req.SessionId,
		Kind:              req.Kind,
		OpaqueKeyMaterial: req.OpaqueKeyMaterial,
	}
	payloadBytes, err := proto.Marshal(dkxPayload)
	if err != nil {
		return nil, server.InternalErrorWithCause("marshal dkx payload failed", err)
	}

	env := &chat.StationEnvelope{
		EnvelopeId:                 uuid.NewString(),
		ConversationId:             req.ConversationId,
		IdempotencyKey:             dkxIdempotencyKey(req.SessionId, subject.ID, senderDeviceID, recipientPtid, recipientDeviceID, req.Kind, req.OpaqueKeyMaterial),
		SenderPtid:                 subject.ID,
		SenderDeviceId:             senderDeviceID,
		RecipientPtid:              recipientPtid,
		RecipientDeviceId:          recipientDeviceID,
		RecipientHomeStationPeerId: recipientStation,
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_DIRECT_KEY_EXCHANGE,
		PayloadBytes:               payloadBytes,
	}

	envelopeId, err := s.envelopeService.Submit(ctx, env)
	if err != nil {
		return nil, server.InternalErrorWithCause("submit dkx envelope failed", err)
	}

	return &chat.SendDkxResponse{EnvelopeId: envelopeId}, nil
}

func resolveDkxDeviceRoute(
	senderPtid string,
	senderDeviceID string,
	recipientPtid string,
	recipientDeviceID string,
	requestedStation string,
	senderDevices []touchactor.DeviceRecord,
	recipientDevices []touchactor.DeviceRecord,
) (string, error) {
	if recipientPtid == senderPtid && recipientDeviceID == senderDeviceID {
		return "", server.BadRequest("DKX sender and recipient endpoints must differ")
	}
	senderActive := false
	for _, device := range senderDevices {
		if device.DeviceID == senderDeviceID {
			senderActive = true
			break
		}
	}
	if !senderActive {
		return "", server.BadRequest("X-Device-ID is not an active sender device")
	}
	recipientStation := ""
	for _, device := range recipientDevices {
		if device.DeviceID == recipientDeviceID {
			recipientStation = strings.TrimSpace(device.HomeStationPeerID)
			break
		}
	}
	if recipientStation == "" {
		return "", server.BadRequest("recipient_device_id is not active for recipient_ptid")
	}
	if requestedStation = strings.TrimSpace(requestedStation); requestedStation != "" &&
		requestedStation != recipientStation {
		return "", server.BadRequest(
			"recipient_station_peer_id does not match the registered recipient device",
		)
	}
	return recipientStation, nil
}

func dkxIdempotencyKey(
	sessionID string,
	senderPtid string,
	senderDeviceID string,
	recipientPtid string,
	recipientDeviceID string,
	kind chat.DirectKeyExchangeKind,
	opaqueKeyMaterial []byte,
) string {
	digest := sha256.Sum256(opaqueKeyMaterial)
	tuple := strings.Join(
		[]string{
			sessionID,
			senderPtid,
			senderDeviceID,
			recipientPtid,
			recipientDeviceID,
			kind.String(),
		},
		"\x00",
	)
	tupleDigest := sha256.Sum256(append([]byte(tuple), digest[:]...))
	return fmt.Sprintf("dkx:%x", tupleDigest)
}

func conversationLocalAudience() string {
	identity := nativefed.LocalIdentitySnapshot()
	if strings.TrimSpace(identity.StationPeerID.String()) != "" {
		return identity.StationPeerID.String()
	}
	if strings.TrimSpace(identity.StationDomain) != "" {
		return strings.TrimSpace(identity.StationDomain)
	}
	return ""
}
