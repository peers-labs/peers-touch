package messaging

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	httpinterface "github.com/peers-labs/peers-touch/station/app/subserver/messaging/interface/http"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/worker"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/appdir"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
)

const (
	defaultQueueMaxItems          = 10_000
	defaultQueueMaxBytes          = 64 << 20
	defaultRecoveryMaxBytes       = 256 << 20
	defaultFederationDispatchTick = time.Second
	defaultFollowerReplayTick     = time.Minute
	defaultAttachmentUploadTTL    = 24 * time.Hour
	defaultAttachmentGCTick       = time.Hour
	defaultAttachmentGCBatch      = 100
	defaultAttachmentMetricsTick  = 15 * time.Second
	defaultAttachmentRetryAfter   = time.Second
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
	dataDirectory, err := appdir.Resolve("station", "data")
	if err != nil {
		return err
	}
	attachmentBlobs, err := infrastructure.NewAttachmentBlobStore(
		storage.NewLocalBackend(filepath.Join(dataDirectory, "messaging-attachments")),
	)
	if err != nil {
		return err
	}
	tokenMinter, err := infrastructure.NewPeerJWTFederationTokenMinter(
		authfed.Singleton(),
		localStationID,
	)
	if err != nil {
		return err
	}
	peerKeys := authfed.NewPeerKeyStoreGORMWithDB(database)
	peerTrustResolver, err := infrastructure.NewFederationPeerTrustResolver(
		database,
		peerKeys,
	)
	if err != nil {
		return err
	}
	relayAccess := infrastructure.NewLiveFederationRelayAccess()
	federationTransport, err := infrastructure.NewHTTPFederationTransport(
		&http.Client{Timeout: 15 * time.Second},
		tokenMinter,
		nil,
		relayAccess,
	)
	if err != nil {
		return err
	}
	composition, err := NewComposition(CompositionConfig{
		Database:       database,
		Clock:          time.Now,
		LocalStationID: localStationID,
		PeerKeys:       peerKeys,
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
		FollowerProjectionPolicy: application.FollowerProjectionPolicy{
			MaxPendingEvents: 128,
			MaxPendingBytes:  4 << 20,
			PendingTTL:       10 * time.Minute,
			ReplayPageLimit:  128,
		},
		FollowerReplayPolicy: application.FollowerReplayPolicy{
			MaxPageEvents: 128,
			PageTTL:       time.Minute,
		},
		RecoveryPolicy: application.RecoveryPolicy{
			MaxEncryptedArchiveBytes: defaultRecoveryMaxBytes,
		},
		AuthorityPlanPolicy: application.AuthorityPlanPolicy{
			ReservationTTL: 5 * time.Minute,
		},
		AttachmentPolicy: application.AttachmentPolicy{
			UploadTTL: defaultAttachmentUploadTTL,
		},
		AttachmentBlobStore:    attachmentBlobs,
		FederationDispatcherID: "messaging:" + localStationID,
		FederationDispatcherPolicy: worker.FederationDispatcherPolicy{
			BatchSize:     100,
			LeaseDuration: 30 * time.Second,
			MaxAttempts:   8,
			BaseBackoff:   time.Second,
			MaxBackoff:    time.Minute,
		},
		FederationTransport:         federationTransport,
		FederationRelay:             relayAccess,
		FederationPeerTrustResolver: peerTrustResolver,
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
	s.wait.Add(1)
	go func() {
		defer s.wait.Done()
		ticker := time.NewTicker(defaultFollowerReplayTick)
		defer ticker.Stop()
		for {
			if err := s.composition.FollowerProjectionService.ReconcilePending(
				runContext,
			); err != nil && runContext.Err() == nil {
				slog.WarnContext(
					runContext,
					"messaging follower replay reconciliation failed; retry remains scheduled",
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
	s.wait.Add(1)
	go func() {
		defer s.wait.Done()
		ticker := time.NewTicker(defaultAttachmentGCTick)
		defer ticker.Stop()
		for {
			if _, err := s.composition.AttachmentService.SweepExpiredUploads(
				runContext,
				defaultAttachmentGCBatch,
			); err != nil && runContext.Err() == nil {
				slog.WarnContext(
					runContext,
					"messaging attachment cleanup failed; retry remains scheduled",
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
	s.wait.Add(1)
	go func() {
		defer s.wait.Done()
		ticker := time.NewTicker(defaultAttachmentMetricsTick)
		defer ticker.Stop()
		for {
			if err := s.composition.AttachmentService.PublishMetrics(runContext); err != nil &&
				runContext.Err() == nil {
				slog.WarnContext(
					runContext,
					"messaging attachment metrics refresh failed",
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
		server.NewTypedHandler("messaging-member-settings-get", "/messaging/member/settings", server.GET,
			s.handleGetMemberSettings, logID, s.jwtWrapper),
		server.NewTypedHandler("messaging-member-settings-put", "/messaging/member/settings", server.PUT,
			s.handleUpdateMemberSettings, logID, s.jwtWrapper),
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
		server.NewTypedHandler(
			"messaging-attachment-upload-begin",
			"/messaging/attachments/uploads:begin",
			server.POST,
			s.handleBeginAttachmentUpload,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewSimpleHandler(
			"messaging-attachment-upload-status",
			"/messaging/attachments/uploads/:upload_id",
			server.GET,
			s.handleAttachmentUploadStatus,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewSimpleHandler(
			"messaging-attachment-upload-part",
			"/messaging/attachments/uploads/:upload_id/chunks/:chunk_index",
			server.PUT,
			s.handleAttachmentChunk,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewSimpleHandler(
			"messaging-attachment-upload-complete",
			"/messaging/attachments/uploads/:upload_id/complete",
			server.POST,
			s.handleCompleteAttachmentUpload,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewSimpleHandler(
			"messaging-attachment-upload-cancel",
			"/messaging/attachments/uploads/:upload_id/cancel",
			server.POST,
			s.handleCancelAttachmentUpload,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewSimpleHandler(
			"messaging-attachment-object-download",
			"/messaging/attachments/objects/:object_id",
			server.GET,
			s.handleAttachmentObject,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"messaging-federation-attachment-upload-begin",
			"/messaging/federation/attachments/uploads:begin",
			server.POST,
			s.handleFederatedBeginAttachmentUpload,
			logID,
			s.composition.AttachmentFederationAuth,
		),
		server.NewSimpleHandler(
			"messaging-federation-attachment-upload-status",
			"/messaging/federation/attachments/uploads/:upload_id",
			server.GET,
			s.handleFederatedAttachmentUploadStatus,
			logID,
			s.composition.AttachmentFederationAuth,
		),
		server.NewSimpleHandler(
			"messaging-federation-attachment-upload-part",
			"/messaging/federation/attachments/uploads/:upload_id/chunks/:chunk_index",
			server.PUT,
			s.handleFederatedAttachmentChunk,
			logID,
			s.composition.AttachmentFederationAuth,
		),
		server.NewSimpleHandler(
			"messaging-federation-attachment-upload-complete",
			"/messaging/federation/attachments/uploads/:upload_id/complete",
			server.POST,
			s.handleFederatedCompleteAttachmentUpload,
			logID,
			s.composition.AttachmentFederationAuth,
		),
		server.NewSimpleHandler(
			"messaging-federation-attachment-upload-cancel",
			"/messaging/federation/attachments/uploads/:upload_id/cancel",
			server.POST,
			s.handleFederatedCancelAttachmentUpload,
			logID,
			s.composition.AttachmentFederationAuth,
		),
		server.NewSimpleHandler(
			"messaging-federation-attachment-object-download",
			"/messaging/federation/attachments/objects/:object_id",
			server.GET,
			s.handleFederatedAttachmentObject,
			logID,
			s.composition.AttachmentFederationAuth,
		),
		server.NewTypedHandler("messaging-federation-deliver", "/messaging/federation/deliver", server.POST,
			s.handleFederationDeliver, logID, s.composition.FederationAuth),
		server.NewTypedHandler(
			"messaging-federation-follower-events",
			"/messaging/federation/follower/events",
			server.POST,
			s.handleFollowerReplay,
			logID,
			s.composition.FollowerReplayAuth,
		),
		server.NewTypedHandler(
			"messaging-federation-endpoint-manifest",
			"/messaging/federation/endpoint-manifest",
			server.POST,
			s.composition.EndpointManifestHandler.GetAuthenticated,
			logID,
			s.composition.EndpointManifestAuth,
		),
		server.NewTypedHandler(
			"messaging-federation-command-prepare",
			"/messaging/federation/command/prepare",
			server.POST,
			s.composition.AuthorityPrepareHandler.PrepareAuthenticated,
			logID,
			s.composition.AuthorityPrepareAuth,
		),
		server.NewTypedHandler(
			"messaging-federation-mls-key-package-claim",
			"/messaging/federation/mls-key-package/claim",
			server.POST,
			s.composition.MlsKeyPackageClaimHandler.ClaimAuthenticated,
			logID,
			s.composition.MlsKeyPackageClaimAuth,
		),
		server.NewTypedHandler("messaging-typing-submit", "/messaging/typing/submit", server.POST,
			s.handleSubmitTyping, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-receipt-submit", "/messaging/receipt/submit", server.POST,
			s.handleSubmitReceipt, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("messaging-delivery-receipt-submit", "/messaging/receipt/delivery", server.POST,
			s.handleSubmitDeliveryReceipt, logID, deviceID, s.jwtWrapper),
	}
}

func (s *subServer) handleFederationDeliver(
	ctx context.Context,
	request *chat.DeliverMessagingFederationFrameRequest,
) (*chat.DeliverMessagingFederationFrameResponse, error) {
	response, err := s.composition.FederationHandler.DeliverAuthenticated(ctx, request)
	return response, mapMessagingError(err)
}

func (s *subServer) handleFollowerReplay(
	ctx context.Context,
	request *chat.GetMessagingFollowerEventsRequest,
) (*chat.MessagingFollowerEventsPage, error) {
	response, err := s.composition.FollowerReplayHandler.GetAuthenticated(ctx, request)
	return response, mapMessagingError(err)
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

func (s *subServer) handleGetMemberSettings(
	ctx context.Context,
	request *chat.GetMessagingMemberSettingsRequest,
) (*chat.GetMessagingMemberSettingsResponse, error) {
	ptid, err := messagingSubjectPTID(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.MemberSettingsService.Get(ctx, ptid, request)
	return response, mapMessagingError(err)
}

func (s *subServer) handleUpdateMemberSettings(
	ctx context.Context,
	request *chat.UpdateMessagingMemberSettingsRequest,
) (*chat.UpdateMessagingMemberSettingsResponse, error) {
	ptid, err := messagingSubjectPTID(ctx)
	if err != nil {
		return nil, err
	}
	updated, err := s.composition.MemberSettingsService.Update(ctx, ptid, request)
	if err != nil {
		return nil, mapMessagingError(err)
	}
	if err := publishMemberSettingsChanged(updated.Conversation, ptid); err != nil {
		slog.WarnContext(
			ctx,
			"messaging member settings realtime publish failed; durable settings remain authoritative",
			"conversation_id",
			request.ConversationId,
			"error",
			err,
		)
	}
	return updated.Response, nil
}

func publishMemberSettingsChanged(
	conversation *chat.MessagingConversationView,
	ptid string,
) error {
	if conversation == nil {
		return fmt.Errorf("messaging: settings conversation projection is missing")
	}
	bus := events.GetBus()
	if bus == nil {
		return fmt.Errorf("messaging: settings event bus is unavailable")
	}
	kind := realtime.ConversationSettingsChanged_FRIEND
	if conversation.Kind == chat.ConversationKind_CONVERSATION_KIND_GROUP {
		kind = realtime.ConversationSettingsChanged_GROUP
	}
	if _, err := bus.Publish(ptid, &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_ConversationSettingsChanged{
			ConversationSettingsChanged: &realtime.ConversationSettingsChanged{
				ContainerUlid:   conversation.ConversationId,
				Kind:            kind,
				ActorPtid:       ptid,
				ChangedTsUnixMs: time.Now().UnixMilli(),
			},
		},
	}); err != nil {
		return fmt.Errorf("messaging: publish member settings change: %w", err)
	}
	return nil
}

func (s *subServer) handlePrepareSend(
	ctx context.Context,
	request *chat.PrepareMessagingSendRequest,
) (*chat.PrepareMessagingSendResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil ||
		request.Sender == nil ||
		request.Sender.Ptid != ptid ||
		request.Sender.DeviceId != deviceID {
		return nil, server.Forbidden(
			"send preparation endpoint does not match authenticated endpoint",
		)
	}
	if request.AuthorityStationId != messagingLocalStationID() {
		response, err := s.composition.AuthorityPrepareFetcher.PrepareSend(ctx, request)
		return response, mapMessagingError(err)
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
	if request == nil ||
		request.Command == nil ||
		request.Command.Sender == nil ||
		request.Command.Sender.Ptid != ptid ||
		request.Command.Sender.DeviceId != deviceID {
		return nil, server.Forbidden("command sender does not match authenticated endpoint")
	}
	if request.Command.AuthorityStationId != messagingLocalStationID() {
		if err := s.composition.AuthorityCommandForwarder.Forward(
			ctx,
			request.Command,
		); err != nil {
			return nil, mapMessagingError(err)
		}
		return &chat.SubmitMessagingCommandResponse{
			AcceptedForForwarding: true,
		}, nil
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

func (s *subServer) handleSubmitTyping(
	ctx context.Context,
	request *chat.ConversationCommand,
) (*chat.SubmitMessagingReceiptResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil || request.GetTyping() == nil {
		return nil, server.BadRequest("typing command is required")
	}
	if request.SenderPtid != ptid || request.SenderDeviceId != deviceID {
		return nil, server.Forbidden("typing sender does not match authenticated endpoint")
	}
	if strings.TrimSpace(request.ConversationId) == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	if err := s.composition.TypingHandler.SubmitTyping(
		ctx, ptid, deviceID, request.ConversationId, request.GetTyping().IsTyping,
	); err != nil {
		return nil, mapMessagingError(err)
	}
	return &chat.SubmitMessagingReceiptResponse{}, nil
}

func (s *subServer) handleSubmitReceipt(
	ctx context.Context,
	request *chat.SubmitMessagingReceiptRequest,
) (*chat.SubmitMessagingReceiptResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.ReceiptHandler.Submit(ctx, ptid, deviceID, request)
	if err != nil {
		return nil, mapMessagingError(err)
	}
	return response, nil
}

func (s *subServer) handleSubmitDeliveryReceipt(
	ctx context.Context,
	request *chat.SubmitConversationReceiptRequest,
) (*chat.SubmitConversationReceiptResponse, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.ReceiptHandler.SubmitDelivery(
		ctx,
		ptid,
		deviceID,
		request,
	)
	if err != nil {
		return nil, mapMessagingError(err)
	}
	return response, nil
}

func (s *subServer) handleBeginAttachmentUpload(
	ctx context.Context,
	request *chat.BeginAttachmentUploadRequest,
) (*chat.BeginAttachmentUploadResponse, error) {
	endpoint, err := authenticatedMessagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	if request != nil &&
		request.AuthorityStationId != "" &&
		request.AuthorityStationId != messagingLocalStationID() {
		body, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
		if err != nil {
			return nil, mapAttachmentError(err)
		}
		proxyResponse, err := s.composition.AttachmentProxy.Forward(
			ctx,
			infrastructure.AttachmentProxyRequest{
				TargetStationID: request.AuthorityStationId,
				ConversationID:  request.ConversationId,
				Endpoint:        endpoint,
				Action:          "begin",
				ResourceID:      request.MessageId,
				Method:          http.MethodPost,
				Route:           "/messaging/federation/attachments/uploads:begin",
				Header: http.Header{
					"Content-Type": []string{"application/x-protobuf"},
					"Accept":       []string{"application/x-protobuf"},
				},
				Body: bytes.NewReader(body),
			},
		)
		if err != nil {
			return nil, mapAttachmentError(err)
		}
		defer proxyResponse.Body.Close()
		responseBody, err := io.ReadAll(io.LimitReader(proxyResponse.Body, 2<<20))
		if err != nil {
			return nil, mapAttachmentError(err)
		}
		if proxyResponse.StatusCode < 200 || proxyResponse.StatusCode >= 300 {
			headers := map[string]string{}
			if retryAfter := proxyResponse.Header.Get("Retry-After"); retryAfter != "" {
				headers["Retry-After"] = retryAfter
			}
			return nil, server.NewHandlerErrorWithResponse(
				proxyResponse.StatusCode,
				strings.TrimSpace(string(responseBody)),
				proxyResponse.Header.Get("Content-Type"),
				responseBody,
				headers,
			)
		}
		result := &chat.BeginAttachmentUploadResponse{}
		if err := proto.Unmarshal(responseBody, result); err != nil {
			return nil, err
		}
		if result.AuthorityStationId != request.AuthorityStationId {
			return nil, mapAttachmentError(domain.ErrAttachmentConflict)
		}
		return result, nil
	}
	response, err := s.composition.AttachmentService.Begin(
		ctx,
		endpoint,
		request,
	)
	return response, mapAttachmentError(err)
}

func (s *subServer) handleAttachmentUploadStatus(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	endpoint, err := authenticatedMessagingEndpoint(ctx)
	if err != nil {
		return err
	}
	uploadID, _, err := attachmentUploadPath(request.Path())
	if err != nil {
		return err
	}
	generation, err := positiveUintHeader(request, "X-Peers-Attachment-Generation", 64)
	if err != nil {
		return err
	}
	authorityStationID := requestHeader(request, "X-Peers-Authority-Station-ID")
	conversationID := requestHeader(request, "X-Peers-Conversation-ID")
	if authorityStationID != "" && authorityStationID != messagingLocalStationID() {
		return s.forwardAttachmentRequest(
			ctx,
			request,
			response,
			endpoint,
			authorityStationID,
			conversationID,
			"status",
			uploadID,
		)
	}
	result, err := s.composition.AttachmentService.Status(
		ctx,
		endpoint,
		&chat.GetAttachmentUploadRequest{
			UploadId:           uploadID,
			Generation:         generation,
			AuthorityStationId: authorityStationID,
			ConversationId:     conversationID,
		},
	)
	if err != nil {
		return mapAttachmentError(err)
	}
	return writeProtoResponse(response, result)
}

func (s *subServer) handleAttachmentChunk(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	endpoint, err := authenticatedMessagingEndpoint(ctx)
	if err != nil {
		return err
	}
	uploadID, pathChunkIndex, err := attachmentUploadPath(request.Path())
	if err != nil {
		return err
	}
	metadataBytes, err := base64.StdEncoding.DecodeString(
		strings.TrimSpace(requestHeader(request, "X-Peers-Attachment-Metadata-Bin")),
	)
	if err != nil || len(metadataBytes) == 0 {
		return server.BadRequest("attachment part metadata is required")
	}
	metadata := &chat.PutAttachmentChunkRequest{}
	if err := proto.Unmarshal(metadataBytes, metadata); err != nil {
		return server.BadRequest("attachment part metadata is invalid")
	}
	if metadata.UploadId != uploadID || metadata.ChunkIndex != pathChunkIndex {
		return server.BadRequest("attachment part path does not match metadata")
	}
	if metadata.AuthorityStationId != "" &&
		metadata.AuthorityStationId != messagingLocalStationID() {
		return s.forwardAttachmentRequest(
			ctx,
			request,
			response,
			endpoint,
			metadata.AuthorityStationId,
			metadata.ConversationId,
			"part",
			fmt.Sprintf("%s/%d", uploadID, pathChunkIndex),
		)
	}
	result, err := s.composition.AttachmentService.PutChunk(
		ctx,
		endpoint,
		metadata,
		request.Body(),
	)
	if err != nil {
		return mapAttachmentError(err)
	}
	return writeProtoResponse(response, result)
}

func (s *subServer) handleCompleteAttachmentUpload(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	endpoint, err := authenticatedMessagingEndpoint(ctx)
	if err != nil {
		return err
	}
	uploadID, _, err := attachmentUploadPath(request.Path())
	if err != nil {
		return err
	}
	input := &chat.CompleteAttachmentUploadRequest{}
	if err := proto.Unmarshal(request.Body(), input); err != nil {
		return server.BadRequest("attachment completion metadata is invalid")
	}
	if input.UploadId != uploadID {
		return server.BadRequest("attachment completion path does not match metadata")
	}
	if input.AuthorityStationId != "" &&
		input.AuthorityStationId != messagingLocalStationID() {
		return s.forwardAttachmentRequest(
			ctx,
			request,
			response,
			endpoint,
			input.AuthorityStationId,
			input.ConversationId,
			"complete",
			uploadID,
		)
	}
	result, err := s.composition.AttachmentService.Complete(ctx, endpoint, input)
	if err != nil {
		return mapAttachmentError(err)
	}
	return writeProtoResponse(response, result)
}

func (s *subServer) handleCancelAttachmentUpload(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	endpoint, err := authenticatedMessagingEndpoint(ctx)
	if err != nil {
		return err
	}
	uploadID, _, err := attachmentUploadPath(request.Path())
	if err != nil {
		return err
	}
	input := &chat.CancelAttachmentUploadRequest{}
	if err := proto.Unmarshal(request.Body(), input); err != nil {
		return server.BadRequest("attachment cancellation metadata is invalid")
	}
	if input.UploadId != uploadID {
		return server.BadRequest("attachment cancellation path does not match metadata")
	}
	if input.AuthorityStationId != "" &&
		input.AuthorityStationId != messagingLocalStationID() {
		return s.forwardAttachmentRequest(
			ctx,
			request,
			response,
			endpoint,
			input.AuthorityStationId,
			input.ConversationId,
			"cancel",
			uploadID,
		)
	}
	result, err := s.composition.AttachmentService.Cancel(ctx, endpoint, input)
	if err != nil {
		return mapAttachmentError(err)
	}
	return writeProtoResponse(response, result)
}

func (s *subServer) handleAttachmentObject(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	endpoint, err := authenticatedMessagingEndpoint(ctx)
	if err != nil {
		return err
	}
	objectID, conversationID, err := attachmentObjectPath(request.Path())
	if err != nil {
		return err
	}
	authorityStationID := requestHeader(request, "X-Peers-Authority-Station-ID")
	if authorityStationID != "" && authorityStationID != messagingLocalStationID() {
		return s.forwardAttachmentRequest(
			ctx,
			request,
			response,
			endpoint,
			authorityStationID,
			conversationID,
			"download",
			objectID,
		)
	}
	expectedETag, err := attachmentETag(requestHeader(request, "If-Match"))
	if err != nil {
		return err
	}
	start, end, partial, err := attachmentRange(requestHeader(request, "Range"))
	if err != nil {
		return err
	}
	object, reader, totalSize, err := s.composition.AttachmentService.OpenGrantedObject(
		ctx,
		endpoint,
		&chat.GetAttachmentObjectRequest{
			ConversationId:     conversationID,
			ObjectId:           objectID,
			ExpectedEtagSha256: expectedETag,
			AuthorityStationId: authorityStationID,
		},
		start,
		end,
	)
	if errors.Is(err, domain.ErrAttachmentETag) {
		return attachmentHandlerError(
			http.StatusPreconditionFailed,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_DESCRIPTOR_MISMATCH,
			0,
		)
	}
	if errors.Is(err, domain.ErrAttachmentRange) {
		return attachmentHandlerError(
			http.StatusRequestedRangeNotSatisfiable,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RANGE_INVALID,
			0,
		)
	}
	if err != nil {
		return mapAttachmentError(err)
	}
	defer reader.Close()
	if end == -1 {
		end = totalSize - 1
	}
	response.SetHeader("Accept-Ranges", "bytes")
	response.SetHeader("Content-Type", "application/octet-stream")
	response.SetHeader("ETag", `"`+hex.EncodeToString(object.Descriptor.CiphertextSha256)+`"`)
	response.SetHeader("Content-Length", strconv.FormatInt(end-start+1, 10))
	if partial {
		response.SetHeader(
			"Content-Range",
			fmt.Sprintf("bytes %d-%d/%d", start, end, totalSize),
		)
		response.WriteHeader(http.StatusPartialContent)
	} else {
		response.WriteHeader(http.StatusOK)
	}
	_, err = io.Copy(responseWriter{response}, reader)
	return err
}

func (s *subServer) forwardAttachmentRequest(
	ctx context.Context,
	request server.Request,
	response server.Response,
	endpoint *chat.CryptoEndpoint,
	authorityStationID string,
	conversationID string,
	action string,
	resourceID string,
) error {
	headers := make(http.Header, len(request.Header()))
	for name, value := range request.Header() {
		headers.Set(name, value)
	}
	route := strings.Replace(
		request.Path(),
		"/messaging/attachments/",
		"/messaging/federation/attachments/",
		1,
	)
	proxyResponse, err := s.composition.AttachmentProxy.Forward(
		ctx,
		infrastructure.AttachmentProxyRequest{
			TargetStationID: authorityStationID,
			ConversationID:  conversationID,
			Endpoint:        endpoint,
			Action:          action,
			ResourceID:      resourceID,
			Method:          string(request.Method()),
			Route:           route,
			Header:          headers,
			Body:            bytes.NewReader(request.Body()),
		},
	)
	if err != nil {
		return mapAttachmentError(err)
	}
	defer proxyResponse.Body.Close()
	for _, name := range []string{
		"Accept-Ranges",
		"Content-Length",
		"Content-Range",
		"Content-Type",
		"ETag",
		"Retry-After",
	} {
		if value := proxyResponse.Header.Get(name); value != "" {
			response.SetHeader(name, value)
		}
	}
	response.WriteHeader(proxyResponse.StatusCode)
	_, err = io.Copy(responseWriter{response}, proxyResponse.Body)
	return err
}

func (s *subServer) handleFederatedBeginAttachmentUpload(
	ctx context.Context,
	request *chat.BeginAttachmentUploadRequest,
) (*chat.BeginAttachmentUploadResponse, error) {
	if request == nil {
		return nil, server.BadRequest("attachment upload request is required")
	}
	endpoint, err := httpinterface.AuthenticateAttachmentTransfer(
		ctx,
		s.composition.DeviceDirectory,
		messagingLocalStationID(),
		request.ConversationId,
		"begin",
		request.MessageId,
	)
	if err != nil {
		return nil, mapAttachmentError(err)
	}
	response, err := s.composition.AttachmentService.Begin(ctx, endpoint, request)
	return response, mapAttachmentError(err)
}

func (s *subServer) handleFederatedAttachmentUploadStatus(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	uploadID, _, err := attachmentUploadPath(request.Path())
	if err != nil {
		return err
	}
	conversationID := requestHeader(request, "X-Peers-Conversation-ID")
	endpoint, err := s.federatedAttachmentEndpoint(
		ctx,
		conversationID,
		"status",
		uploadID,
	)
	if err != nil {
		return err
	}
	generation, err := positiveUintHeader(request, "X-Peers-Attachment-Generation", 64)
	if err != nil {
		return err
	}
	result, err := s.composition.AttachmentService.Status(
		ctx,
		endpoint,
		&chat.GetAttachmentUploadRequest{
			UploadId:           uploadID,
			Generation:         generation,
			AuthorityStationId: messagingLocalStationID(),
			ConversationId:     conversationID,
		},
	)
	if err != nil {
		return mapAttachmentError(err)
	}
	return writeProtoResponse(response, result)
}

func (s *subServer) handleFederatedAttachmentChunk(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	uploadID, chunkIndex, err := attachmentUploadPath(request.Path())
	if err != nil {
		return err
	}
	metadata, err := attachmentPartMetadata(request)
	if err != nil {
		return err
	}
	if metadata.UploadId != uploadID || metadata.ChunkIndex != chunkIndex {
		return server.BadRequest("attachment part path does not match metadata")
	}
	endpoint, err := s.federatedAttachmentEndpoint(
		ctx,
		metadata.ConversationId,
		"part",
		fmt.Sprintf("%s/%d", uploadID, chunkIndex),
	)
	if err != nil {
		return err
	}
	result, err := s.composition.AttachmentService.PutChunk(
		ctx,
		endpoint,
		metadata,
		request.Body(),
	)
	if err != nil {
		return mapAttachmentError(err)
	}
	return writeProtoResponse(response, result)
}

func (s *subServer) handleFederatedCompleteAttachmentUpload(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	uploadID, _, err := attachmentUploadPath(request.Path())
	if err != nil {
		return err
	}
	input := &chat.CompleteAttachmentUploadRequest{}
	if err := proto.Unmarshal(request.Body(), input); err != nil || input.UploadId != uploadID {
		return server.BadRequest("attachment completion metadata is invalid")
	}
	endpoint, err := s.federatedAttachmentEndpoint(
		ctx,
		input.ConversationId,
		"complete",
		uploadID,
	)
	if err != nil {
		return err
	}
	result, err := s.composition.AttachmentService.Complete(ctx, endpoint, input)
	if err != nil {
		return mapAttachmentError(err)
	}
	return writeProtoResponse(response, result)
}

func (s *subServer) handleFederatedCancelAttachmentUpload(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	uploadID, _, err := attachmentUploadPath(request.Path())
	if err != nil {
		return err
	}
	input := &chat.CancelAttachmentUploadRequest{}
	if err := proto.Unmarshal(request.Body(), input); err != nil || input.UploadId != uploadID {
		return server.BadRequest("attachment cancellation metadata is invalid")
	}
	endpoint, err := s.federatedAttachmentEndpoint(
		ctx,
		input.ConversationId,
		"cancel",
		uploadID,
	)
	if err != nil {
		return err
	}
	result, err := s.composition.AttachmentService.Cancel(ctx, endpoint, input)
	if err != nil {
		return mapAttachmentError(err)
	}
	return writeProtoResponse(response, result)
}

func (s *subServer) handleFederatedAttachmentObject(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	objectID, conversationID, err := attachmentObjectPath(request.Path())
	if err != nil {
		return err
	}
	endpoint, err := s.federatedAttachmentEndpoint(
		ctx,
		conversationID,
		"download",
		objectID,
	)
	if err != nil {
		return err
	}
	expectedETag, err := attachmentETag(requestHeader(request, "If-Match"))
	if err != nil {
		return err
	}
	start, end, partial, err := attachmentRange(requestHeader(request, "Range"))
	if err != nil {
		return err
	}
	object, reader, totalSize, err := s.composition.AttachmentService.OpenGrantedObject(
		ctx,
		endpoint,
		&chat.GetAttachmentObjectRequest{
			ConversationId:     conversationID,
			ObjectId:           objectID,
			ExpectedEtagSha256: expectedETag,
			AuthorityStationId: messagingLocalStationID(),
		},
		start,
		end,
	)
	if errors.Is(err, domain.ErrAttachmentETag) {
		return attachmentHandlerError(
			http.StatusPreconditionFailed,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_DESCRIPTOR_MISMATCH,
			0,
		)
	}
	if errors.Is(err, domain.ErrAttachmentRange) {
		return attachmentHandlerError(
			http.StatusRequestedRangeNotSatisfiable,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RANGE_INVALID,
			0,
		)
	}
	if err != nil {
		return mapAttachmentError(err)
	}
	defer reader.Close()
	if end == -1 {
		end = totalSize - 1
	}
	response.SetHeader("Accept-Ranges", "bytes")
	response.SetHeader("Content-Type", "application/octet-stream")
	response.SetHeader("ETag", `"`+hex.EncodeToString(object.Descriptor.CiphertextSha256)+`"`)
	response.SetHeader("Content-Length", strconv.FormatInt(end-start+1, 10))
	if partial {
		response.SetHeader(
			"Content-Range",
			fmt.Sprintf("bytes %d-%d/%d", start, end, totalSize),
		)
		response.WriteHeader(http.StatusPartialContent)
	} else {
		response.WriteHeader(http.StatusOK)
	}
	_, err = io.Copy(responseWriter{response}, reader)
	return err
}

func (s *subServer) federatedAttachmentEndpoint(
	ctx context.Context,
	conversationID string,
	action string,
	resourceID string,
) (*chat.CryptoEndpoint, error) {
	endpoint, err := httpinterface.AuthenticateAttachmentTransfer(
		ctx,
		s.composition.DeviceDirectory,
		messagingLocalStationID(),
		conversationID,
		action,
		resourceID,
	)
	if err != nil {
		return nil, mapMessagingError(err)
	}
	return endpoint, nil
}

func authenticatedMessagingEndpoint(ctx context.Context) (*chat.CryptoEndpoint, error) {
	ptid, deviceID, err := messagingEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	return &chat.CryptoEndpoint{Ptid: ptid, DeviceId: deviceID}, nil
}

func attachmentUploadPath(path string) (string, uint32, error) {
	path = strings.SplitN(path, "?", 2)[0]
	path = strings.Replace(
		path,
		"/messaging/federation/attachments/",
		"/messaging/attachments/",
		1,
	)
	const prefix = "/messaging/attachments/uploads/"
	if !strings.HasPrefix(path, prefix) {
		return "", 0, server.BadRequest("attachment upload path is invalid")
	}
	segments := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(segments) == 0 || strings.TrimSpace(segments[0]) == "" {
		return "", 0, server.BadRequest("attachment upload id is required")
	}
	if len(segments) >= 3 && segments[1] == "chunks" {
		index, err := strconv.ParseUint(segments[2], 10, 32)
		if err != nil {
			return "", 0, server.BadRequest("attachment chunk index is invalid")
		}
		return segments[0], uint32(index), nil
	}
	return segments[0], 0, nil
}

func attachmentObjectPath(path string) (string, string, error) {
	path = strings.Replace(
		path,
		"/messaging/federation/attachments/",
		"/messaging/attachments/",
		1,
	)
	const prefix = "/messaging/attachments/objects/"
	pathAndQuery := strings.SplitN(path, "?", 2)
	if !strings.HasPrefix(pathAndQuery[0], prefix) {
		return "", "", server.BadRequest("attachment object path is invalid")
	}
	objectID := strings.TrimSpace(strings.TrimPrefix(pathAndQuery[0], prefix))
	if objectID == "" || strings.Contains(objectID, "/") {
		return "", "", server.BadRequest("attachment object id is invalid")
	}
	if len(pathAndQuery) != 2 {
		return "", "", server.BadRequest("conversation_id is required")
	}
	for _, pair := range strings.Split(pathAndQuery[1], "&") {
		keyValue := strings.SplitN(pair, "=", 2)
		if len(keyValue) == 2 && keyValue[0] == "conversation_id" &&
			strings.TrimSpace(keyValue[1]) != "" {
			return objectID, keyValue[1], nil
		}
	}
	return "", "", server.BadRequest("conversation_id is required")
}

func attachmentETag(value string) ([]byte, error) {
	value = strings.Trim(strings.TrimSpace(value), `"`)
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != 32 {
		return nil, server.NewHandlerError(
			http.StatusPreconditionFailed,
			"valid attachment If-Match is required",
		)
	}
	return decoded, nil
}

func attachmentRange(value string) (int64, int64, bool, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, -1, false, nil
	}
	if !strings.HasPrefix(value, "bytes=") || strings.Contains(value, ",") {
		return 0, 0, false, server.NewHandlerError(
			http.StatusRequestedRangeNotSatisfiable,
			"attachment range is invalid",
		)
	}
	bounds := strings.SplitN(strings.TrimPrefix(value, "bytes="), "-", 2)
	if len(bounds) != 2 || bounds[0] == "" {
		return 0, 0, false, server.NewHandlerError(
			http.StatusRequestedRangeNotSatisfiable,
			"attachment range is invalid",
		)
	}
	start, err := strconv.ParseInt(bounds[0], 10, 64)
	if err != nil || start < 0 {
		return 0, 0, false, server.NewHandlerError(
			http.StatusRequestedRangeNotSatisfiable,
			"attachment range is invalid",
		)
	}
	end := int64(-1)
	if bounds[1] != "" {
		end, err = strconv.ParseInt(bounds[1], 10, 64)
		if err != nil || end < start {
			return 0, 0, false, server.NewHandlerError(
				http.StatusRequestedRangeNotSatisfiable,
				"attachment range is invalid",
			)
		}
	}
	return start, end, true, nil
}

func positiveUintHeader(request server.Request, name string, bits int) (uint64, error) {
	value, err := strconv.ParseUint(strings.TrimSpace(requestHeader(request, name)), 10, bits)
	if err != nil || value == 0 {
		return 0, server.BadRequest(name + " must be a positive integer")
	}
	return value, nil
}

func attachmentPartMetadata(
	request server.Request,
) (*chat.PutAttachmentChunkRequest, error) {
	metadataBytes, err := base64.StdEncoding.DecodeString(
		strings.TrimSpace(requestHeader(request, "X-Peers-Attachment-Metadata-Bin")),
	)
	if err != nil || len(metadataBytes) == 0 {
		return nil, server.BadRequest("attachment part metadata is required")
	}
	metadata := &chat.PutAttachmentChunkRequest{}
	if err := proto.Unmarshal(metadataBytes, metadata); err != nil {
		return nil, server.BadRequest("attachment part metadata is invalid")
	}
	return metadata, nil
}

func requestHeader(request server.Request, name string) string {
	for headerName, value := range request.Header() {
		if strings.EqualFold(headerName, name) {
			return value
		}
	}
	return ""
}

func writeProtoResponse(response server.Response, message proto.Message) error {
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return err
	}
	response.SetHeader("Content-Type", "application/x-protobuf")
	response.WriteHeader(http.StatusOK)
	_, err = response.Write(body)
	return err
}

type responseWriter struct {
	response server.Response
}

func (writer responseWriter) Write(body []byte) (int, error) {
	return writer.response.Write(body)
}

func messagingEndpoint(ctx context.Context) (string, string, error) {
	ptid, err := messagingSubjectPTID(ctx)
	if err != nil {
		return "", "", err
	}
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if deviceID == "" {
		return "", "", server.Unauthorized("authenticated messaging endpoint required")
	}
	return ptid, deviceID, nil
}

func messagingSubjectPTID(ctx context.Context) (string, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return "", server.Unauthorized("authenticated messaging actor required")
	}
	return subject.ID, nil
}

func attachmentHandlerError(
	status int,
	code chat.AttachmentTransferErrorCode,
	retryAfter time.Duration,
) error {
	response := &chat.AttachmentTransferError{Code: code}
	headers := map[string]string{}
	if retryAfter > 0 {
		response.RetryAfter = durationpb.New(retryAfter)
		seconds := int64((retryAfter + time.Second - 1) / time.Second)
		headers["Retry-After"] = strconv.FormatInt(seconds, 10)
	}
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
	if err != nil {
		return server.InternalErrorWithCause(
			"encode attachment transfer error",
			err,
		)
	}
	return server.NewHandlerErrorWithResponse(
		status,
		code.String(),
		"application/x-protobuf",
		body,
		headers,
	)
}

func mapAttachmentError(err error) error {
	if err == nil {
		return nil
	}
	mapped := mapMessagingError(err)
	var handlerError *server.HandlerError
	if errors.As(mapped, &handlerError) && len(handlerError.Body) > 0 {
		return mapped
	}
	if errors.Is(err, httpinterface.ErrEndpointBinding) ||
		errors.Is(err, application.ErrDeviceUnauthorized) ||
		errors.Is(err, domain.ErrSenderUnauthorized) {
		return attachmentHandlerError(
			http.StatusForbidden,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_NOT_GRANTED,
			0,
		)
	}
	return attachmentHandlerError(
		http.StatusServiceUnavailable,
		chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER,
		defaultAttachmentRetryAfter,
	)
}

func mapMessagingError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, httpinterface.ErrEndpointBinding):
		return server.Forbidden(err.Error())
	case errors.Is(err, httpinterface.ErrAttachmentTransferBinding):
		return attachmentHandlerError(
			http.StatusForbidden,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_NOT_GRANTED,
			0,
		)
	case errors.Is(err, application.ErrDeviceUnauthorized),
		errors.Is(err, domain.ErrSenderUnauthorized),
		errors.Is(err, domain.ErrMembershipNotActive):
		return server.Forbidden(err.Error())
	case errors.Is(err, domain.ErrMemberSettingsInvalid):
		return server.BadRequest(err.Error())
	case errors.Is(err, domain.ErrNotFound):
		return server.NotFound(err.Error())
	case errors.Is(err, domain.ErrCommandConflict),
		errors.Is(err, domain.ErrConversationState),
		errors.Is(err, domain.ErrAuthorityPlanStale),
		errors.Is(err, domain.ErrAuthorityPlanExpired),
		errors.Is(err, domain.ErrMembershipSourceConflict),
		errors.Is(err, domain.ErrQueueItemOrder),
		errors.Is(err, domain.ErrQueueItemState),
		errors.Is(err, domain.ErrConsumerFenced),
		errors.Is(err, domain.ErrPayloadHash):
		return server.Conflict(err.Error())
	case errors.Is(err, domain.ErrFollowerFork),
		errors.Is(err, domain.ErrFollowerProjectionConflict),
		errors.Is(err, domain.ErrFollowerHeadConflict),
		errors.Is(err, domain.ErrFollowerReplayInvalid):
		return server.Conflict(err.Error())
	case errors.Is(err, domain.ErrFollowerReplayNotGranted):
		return server.Forbidden(err.Error())
	case errors.Is(err, domain.ErrFollowerReplayUnavailable):
		return server.NewHandlerError(http.StatusGone, err.Error())
	case errors.Is(err, domain.ErrFollowerBufferOverloaded):
		return server.NewHandlerError(http.StatusTooManyRequests, err.Error())
	case errors.Is(err, domain.ErrFollowerGap):
		return server.NewHandlerError(http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, domain.ErrAttachmentExpired):
		return attachmentHandlerError(
			http.StatusConflict,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_UPLOAD_EXPIRED,
			0,
		)
	case errors.Is(err, domain.ErrAttachmentConflict),
		errors.Is(err, domain.ErrAttachmentState):
		return attachmentHandlerError(
			http.StatusConflict,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_PART_CONFLICT,
			0,
		)
	case errors.Is(err, domain.ErrAttachmentNotGranted):
		return attachmentHandlerError(
			http.StatusForbidden,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_NOT_GRANTED,
			0,
		)
	case errors.Is(err, domain.ErrAttachmentQuota):
		return attachmentHandlerError(
			http.StatusTooManyRequests,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_QUOTA_EXCEEDED,
			0,
		)
	case errors.Is(err, domain.ErrAttachmentETag):
		return attachmentHandlerError(
			http.StatusPreconditionFailed,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_DESCRIPTOR_MISMATCH,
			0,
		)
	case errors.Is(err, domain.ErrAttachmentRange):
		return attachmentHandlerError(
			http.StatusRequestedRangeNotSatisfiable,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RANGE_INVALID,
			0,
		)
	case errors.Is(err, domain.ErrAttachmentDescriptor),
		errors.Is(err, domain.ErrAttachmentTooLarge):
		return attachmentHandlerError(
			http.StatusBadRequest,
			chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_DESCRIPTOR_MISMATCH,
			0,
		)
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
