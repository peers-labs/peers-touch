package messaging

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	envelopesub "github.com/peers-labs/peers-touch/station/app/subserver/envelope"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	httpinterface "github.com/peers-labs/peers-touch/station/app/subserver/messaging/interface/http"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/worker"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

const (
	defaultQueueMaxItems          = 10_000
	defaultQueueMaxBytes          = 64 << 20
	defaultRecoveryMaxBytes       = 256 << 20
	defaultFederationDispatchTick = time.Second
)

type subServer struct {
	status      server.Status
	composition *Composition
	jwtWrapper  server.Wrapper
	cancel      context.CancelFunc
	wait        sync.WaitGroup
}

func NewMessagingSubServer(...option.Option) server.Subserver {
	return &subServer{status: server.StatusStopped}
}

func (s *subServer) Init(ctx context.Context, _ ...option.Option) error {
	s.status = server.StatusStarting
	database, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	localStationID := messagingLocalStationID()
	tokenMinter, err := infrastructure.NewPeerJWTFederationTokenMinter(
		authfed.Singleton(),
		localStationID,
	)
	if err != nil {
		return err
	}
	federationTransport, err := infrastructure.NewHTTPFederationTransport(
		&http.Client{Timeout: 15 * time.Second},
		tokenMinter,
		envelopesub.NewGORMStationURLResolver(database),
		nil,
	)
	if err != nil {
		return err
	}
	composition, err := NewComposition(CompositionConfig{
		Database:       database,
		Clock:          time.Now,
		LocalStationID: localStationID,
		PeerKeys:       authfed.NewPeerKeyStoreGORMWithDB(database),
		QueueLimits: domain.QueueLimits{
			MaxUnackedItems: defaultQueueMaxItems,
			MaxUnackedBytes: defaultQueueMaxBytes,
		},
		QueuePolicy: application.QueuePolicy{
			LeaseDuration:  30 * time.Second,
			MaxBatchSize:   100,
			MaxAttempts:    8,
			BaseRetryDelay: time.Second,
			MaxRetryDelay:  time.Minute,
		},
		FederationPolicy: application.FederationPolicy{
			MaxBatchWrites: 100,
		},
		RecoveryPolicy: application.RecoveryPolicy{
			MaxEncryptedArchiveBytes: defaultRecoveryMaxBytes,
		},
		AuthorityPlanPolicy: application.AuthorityPlanPolicy{
			ReservationTTL: 5 * time.Minute,
		},
		FederationDispatcherID: "messaging:" + localStationID,
		FederationDispatcherPolicy: worker.FederationDispatcherPolicy{
			BatchSize:     100,
			LeaseDuration: 30 * time.Second,
			MaxAttempts:   8,
			BaseBackoff:   time.Second,
			MaxBackoff:    time.Minute,
		},
		FederationTransport: federationTransport,
	})
	if err != nil {
		return err
	}
	if err := composition.Migrate(); err != nil {
		return err
	}
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = serverwrapper.CanonicalSubject(
		server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider)),
		serverwrapper.SubjectResolver(touchactor.ResolveSubjectPTID),
	)
	s.composition = composition
	return nil
}

func (s *subServer) Start(ctx context.Context, _ ...option.Option) error {
	if s.composition == nil {
		return fmt.Errorf("messaging: subserver is not initialized")
	}
	runContext, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.status = server.StatusRunning
	s.wait.Add(1)
	go func() {
		defer s.wait.Done()
		ticker := time.NewTicker(defaultFederationDispatchTick)
		defer ticker.Stop()
		for {
			if _, err := s.composition.FederationDispatcher.DispatchOnce(runContext); err != nil &&
				runContext.Err() == nil {
				slog.WarnContext(
					runContext,
					"messaging federation dispatch failed; durable retry remains scheduled",
					"error",
					err,
				)
			}
			select {
			case <-runContext.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return nil
}

func (s *subServer) Stop(context.Context) error {
	s.status = server.StatusStopping
	if s.cancel != nil {
		s.cancel()
	}
	s.wait.Wait()
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "messaging" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}
func (s *subServer) Status() server.Status { return s.status }

func (s *subServer) Handlers() []server.Handler {
	logID := serverwrapper.LogID()
	deviceID := serverwrapper.DeviceID()
	return []server.Handler{
		server.NewTypedHandler("messaging-conversation-create-direct", "/messaging/conversation/direct", server.POST,
			s.handleCreateDirectConversation, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-group-genesis-prepare", "/messaging/group/genesis/prepare", server.POST,
			s.handlePrepareGroupGenesis, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-membership-transition-prepare", "/messaging/membership/transition/prepare", server.POST,
			s.handlePrepareMembershipTransition, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-conversation-list", "/messaging/conversation/list", server.GET,
			s.handleListConversations, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-command-prepare", "/messaging/command/prepare", server.POST,
			s.handlePrepareSend, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-command-submit", "/messaging/command/submit", server.POST,
			s.handleSubmitCommand, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-device-enroll", "/messaging/device/enroll", server.POST,
			s.handleEnrollDevice, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-queue-claim", "/messaging/queue/claim", server.POST,
			s.handleClaimQueue, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-queue-ack", "/messaging/queue/ack", server.POST,
			s.handleAcknowledgeQueue, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-queue-reject", "/messaging/queue/reject", server.POST,
			s.handleRejectQueue, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-recovery-put", "/messaging/recovery/revision", server.POST,
			s.handlePutRecovery, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-recovery-latest", "/messaging/recovery/latest", server.GET,
			s.handleGetLatestRecovery, logID, s.jwtWrapper),
		server.NewTypedHandler("messaging-federation-deliver", "/messaging/federation/deliver", server.POST,
			s.composition.FederationHandler.DeliverAuthenticated, logID, s.composition.FederationAuth),
	}
}

func (s *subServer) handlePrepareGroupGenesis(
	ctx context.Context,
	request *chat.PrepareMessagingGroupGenesisRequest,
) (*chat.PrepareMessagingGroupGenesisResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil || request.Creator == nil {
		return nil, server.BadRequest("creator is required")
	}
	if request.Creator.Ptid != ptid || request.Creator.DeviceId != deviceID {
		return nil, server.Forbidden(
			"creator does not match authenticated messaging endpoint",
		)
	}
	response, err := s.composition.AuthorityPlanService.PrepareGroupGenesis(ctx, request)
	if err != nil {
		return nil, mapMessagingError(err)
	}
	return response, nil
}

func (s *subServer) handlePrepareMembershipTransition(
	ctx context.Context,
	request *chat.PrepareMessagingMembershipTransitionRequest,
) (*chat.PrepareMessagingMembershipTransitionResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil || strings.TrimSpace(request.ConversationId) == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	if request.Sender != nil &&
		(request.Sender.Ptid != ptid || request.Sender.DeviceId != deviceID) {
		return nil, server.Forbidden("sender does not match authenticated messaging endpoint")
	}
	request.Sender = &chat.CryptoEndpoint{Ptid: ptid, DeviceId: deviceID}
	response, err := s.composition.AuthorityPlanService.PrepareMembershipTransition(
		ctx,
		request,
	)
	if err != nil {
		return nil, mapMessagingError(err)
	}
	return response, nil
}

func (s *subServer) handleCreateDirectConversation(
	ctx context.Context,
	request *chat.CreateMessagingDirectConversationRequest,
) (*chat.CreateMessagingDirectConversationResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil || strings.TrimSpace(request.PeerPtid) == "" {
		return nil, server.BadRequest("peer_ptid is required")
	}
	authenticated := &chat.CryptoEndpoint{Ptid: ptid, DeviceId: deviceID}
	if request.Creator != nil &&
		(request.Creator.Ptid != ptid || request.Creator.DeviceId != deviceID) {
		return nil, server.Forbidden("creator does not match authenticated messaging endpoint")
	}
	conversation, err := s.composition.ConversationService.CreateDirect(
		ctx,
		authenticated,
		request.PeerPtid,
	)
	if err != nil {
		return nil, mapMessagingError(err)
	}
	return &chat.CreateMessagingDirectConversationResponse{
		Conversation: conversation,
	}, nil
}

func (s *subServer) handleListConversations(
	ctx context.Context,
	_ *chat.ListMessagingConversationsRequest,
) (*chat.ListMessagingConversationsResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	conversations, err := s.composition.ConversationService.List(
		ctx,
		&chat.CryptoEndpoint{Ptid: ptid, DeviceId: deviceID},
	)
	if err != nil {
		return nil, mapMessagingError(err)
	}
	return &chat.ListMessagingConversationsResponse{Conversations: conversations}, nil
}

func (s *subServer) handlePrepareSend(
	ctx context.Context,
	request *chat.PrepareMessagingSendRequest,
) (*chat.PrepareMessagingSendResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.CommandHandler.PrepareSend(ctx, ptid, deviceID, request)
	return response, mapMessagingError(err)
}

func (s *subServer) handleSubmitCommand(
	ctx context.Context,
	request *chat.SubmitMessagingCommandRequest,
) (*chat.SubmitMessagingCommandResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.CommandHandler.Submit(ctx, ptid, deviceID, request)
	return response, mapMessagingError(err)
}

func (s *subServer) handleEnrollDevice(
	ctx context.Context,
	request *chat.EnrollMessagingDeviceRequest,
) (*chat.EnrollMessagingDeviceResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.DeviceHandler.Enroll(ctx, ptid, deviceID, request)
	return response, mapMessagingError(err)
}

func (s *subServer) handleClaimQueue(
	ctx context.Context,
	request *chat.ClaimDeviceQueueRequest,
) (*chat.ClaimDeviceQueueResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.QueueHandler.Claim(ctx, ptid, deviceID, request)
	return response, mapMessagingError(err)
}

func (s *subServer) handleAcknowledgeQueue(
	ctx context.Context,
	request *chat.AcknowledgeDeviceQueueItemRequest,
) (*chat.AcknowledgeDeviceQueueItemResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.QueueHandler.Acknowledge(ctx, ptid, deviceID, request)
	return response, mapMessagingError(err)
}

func (s *subServer) handleRejectQueue(
	ctx context.Context,
	request *chat.RejectDeviceQueueItemRequest,
) (*chat.RejectDeviceQueueItemResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.QueueHandler.Reject(ctx, ptid, deviceID, request)
	return response, mapMessagingError(err)
}

func (s *subServer) handlePutRecovery(
	ctx context.Context,
	request *chat.PutRecoveryRevisionRequest,
) (*chat.PutRecoveryRevisionResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.RecoveryService.Put(ctx, ptid, deviceID, request)
	return response, mapMessagingError(err)
}

func (s *subServer) handleGetLatestRecovery(
	ctx context.Context,
	request *chat.GetLatestRecoveryRevisionRequest,
) (*chat.GetLatestRecoveryRevisionResponse, error) {
	_ = request
	subject := coreauth.GetSubject(ctx)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return nil, server.Unauthorized("authentication required")
	}
	response, err := s.composition.RecoveryService.GetLatest(ctx, subject.ID)
	return response, mapMessagingError(err)
}

func messagingEndpoint(ctx context.Context) (string, string, error) {
	subject := coreauth.GetSubject(ctx)
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if subject == nil || strings.TrimSpace(subject.ID) == "" || deviceID == "" {
		return "", "", server.Unauthorized("authenticated messaging endpoint required")
	}
	return subject.ID, deviceID, nil
}

func mapMessagingError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, httpinterface.ErrEndpointBinding):
		return server.Forbidden(err.Error())
	case errors.Is(err, application.ErrDeviceUnauthorized),
		errors.Is(err, domain.ErrSenderUnauthorized):
		return server.Forbidden(err.Error())
	case errors.Is(err, domain.ErrNotFound):
		return server.NotFound(err.Error())
	case errors.Is(err, domain.ErrCommandConflict),
		errors.Is(err, domain.ErrConversationState),
		errors.Is(err, domain.ErrAuthorityPlanStale),
		errors.Is(err, domain.ErrAuthorityPlanExpired),
		errors.Is(err, domain.ErrQueueItemOrder),
		errors.Is(err, domain.ErrQueueItemState),
		errors.Is(err, domain.ErrConsumerFenced),
		errors.Is(err, domain.ErrPayloadHash):
		return server.Conflict(err.Error())
	case errors.Is(err, domain.ErrDeliverySet),
		errors.Is(err, domain.ErrUnsupportedCommand),
		errors.Is(err, domain.ErrRecoveryIntegrity),
		errors.Is(err, domain.ErrRecoveryTooLarge):
		return server.BadRequest(err.Error())
	default:
		return server.InternalErrorWithCause("messaging operation failed", err)
	}
}

func messagingLocalStationID() string {
	identity := nativefed.LocalIdentitySnapshot()
	if peerID := strings.TrimSpace(identity.StationPeerID.String()); peerID != "" {
		return peerID
	}
	if domainName := strings.TrimSpace(identity.StationDomain); domainName != "" {
		return domainName
	}
	return "local"
}
