package conversation

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/appdir"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const (
	productionAttachmentCleanupInterval = time.Hour
	productionAttachmentWorkerID        = "conversation-attachment-cleanup"
)

type subServer struct {
	mu sync.RWMutex

	status        server.Status
	jwtWrapper    server.Wrapper
	composition   *ProductionComposition
	localStation  valueobject.StationID
	gate          *ConversationGateEvaluator
	relationships *ConversationRelationshipAdapter

	cancel context.CancelFunc
	wait   sync.WaitGroup
}

// NewConversationSubServer constructs the canonical Conversation production owner.
func NewConversationSubServer(_ ...option.Option) server.Subserver {
	return &subServer{status: server.StatusStopped}
}

// Init builds the one production Conversation DDD object graph.
func (s *subServer) Init(ctx context.Context, _ ...option.Option) error {
	s.mu.Lock()
	if s.status != server.StatusStopped {
		current := s.status
		s.mu.Unlock()

		return fmt.Errorf(
			"initialize Conversation subserver: expected stopped status, got %s",
			current,
		)
	}
	s.status = server.StatusStarting
	s.mu.Unlock()

	database, err := store.GetRDS(ctx)
	if err != nil {
		return s.failInitialization(
			fmt.Errorf("initialize Conversation database: %w", err),
		)
	}
	localStation, err := productionLocalStationID()
	if err != nil {
		return s.failInitialization(err)
	}
	dataDirectory, err := appdir.Resolve("station", "data")
	if err != nil {
		return s.failInitialization(
			fmt.Errorf("resolve Conversation data directory: %w", err),
		)
	}
	realtime := NewProductionRealtimeAdapter()
	composition, err := NewProductionComposition(
		ctx,
		DefaultProductionCompositionConfig(
			database,
			localStation,
			storage.NewLocalBackend(filepath.Join(dataDirectory, "conversation-attachments")),
			realtime,
		),
	)
	if err != nil {
		return s.failInitialization(err)
	}

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := withCanonicalConversationSubject(
		server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider)),
		resolveConversationSubjectPTID,
	)
	relationships := NewConversationRelationshipAdapter(
		database,
		composition.QueryService,
	)

	s.mu.Lock()
	s.composition = composition
	s.localStation = localStation
	s.jwtWrapper = jwtWrapper
	s.relationships = relationships
	s.gate = NewConversationGateEvaluator(relationships, nil, nil)
	s.mu.Unlock()

	logger.Info(ctx, "Conversation subserver initialized")

	return nil
}

func (s *subServer) failInitialization(err error) error {
	s.mu.Lock()
	s.status = server.StatusError
	s.mu.Unlock()

	return err
}

// Start registers typed Conversation Federation receivers before the
// Federation subserver starts and seals its process-scoped registry.
func (s *subServer) Start(ctx context.Context, _ ...option.Option) error {
	s.mu.Lock()
	if s.status != server.StatusStarting || s.composition == nil {
		current := s.status
		s.status = server.StatusError
		s.mu.Unlock()

		return fmt.Errorf(
			"start Conversation subserver: canonical composition is unavailable in status %s",
			current,
		)
	}
	composition := s.composition
	s.mu.Unlock()

	if err := composition.RegisterFederationReceivers(ctx); err != nil {
		s.mu.Lock()
		s.status = server.StatusError
		s.mu.Unlock()

		return fmt.Errorf("start Conversation Federation integration: %w", err)
	}

	runContext, cancel := context.WithCancel(ctx)
	s.mu.Lock()
	s.cancel = cancel
	s.status = server.StatusRunning
	s.mu.Unlock()

	registerSignalAuthorizer(s.relationships)
	s.wait.Add(1)
	go func() {
		defer s.wait.Done()
		s.runAttachmentCleanup(runContext)
	}()
	s.wait.Add(1)
	go func() {
		defer s.wait.Done()
		s.runFollowerResync(runContext)
	}()

	logger.Info(ctx, "Conversation subserver started")

	return nil
}

// Stop terminates Conversation-owned workers without closing shared Station resources.
func (s *subServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	if s.status == server.StatusStopped {
		s.mu.Unlock()

		return nil
	}
	s.status = server.StatusStopping
	cancel := s.cancel
	s.cancel = nil
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	s.wait.Wait()
	registerSignalAuthorizer(nil)

	s.mu.Lock()
	s.status = server.StatusStopped
	s.mu.Unlock()
	logger.Info(ctx, "Conversation subserver stopped")

	return nil
}

func (s *subServer) runAttachmentCleanup(ctx context.Context) {
	ticker := time.NewTicker(productionAttachmentCleanupInterval)
	defer ticker.Stop()

	for {
		if _, err := s.composition.AttachmentService.SweepExpired(
			ctx,
			productionAttachmentWorkerID,
		); err != nil && ctx.Err() == nil {
			logger.Errorf(ctx, "Conversation attachment cleanup failed: %v", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Name returns the stable Conversation subserver identity.
func (s *subServer) Name() string {
	return "conversation"
}

// Type identifies Conversation as an HTTP subserver.
func (s *subServer) Type() server.SubserverType {
	return server.SubserverTypeHTTP
}

// Address reports that Conversation uses the parent Station listener.
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}

// Status returns the current Conversation lifecycle state.
func (s *subServer) Status() server.Status {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.status
}

// Handlers returns only canonical client and resource-owner routes. Peer-only
// routes are registered by the Federation subserver.
func (s *subServer) Handlers() []server.Handler {
	s.mu.RLock()
	composition := s.composition
	jwtWrapper := s.jwtWrapper
	s.mu.RUnlock()
	if composition == nil || jwtWrapper == nil {
		return nil
	}

	logID := serverwrapper.LogID()
	deviceID := serverwrapper.DeviceID()
	authenticatedDevice := []server.Wrapper{logID, deviceID, jwtWrapper}
	authenticatedActor := []server.Wrapper{logID, jwtWrapper}

	return []server.Handler{
		server.NewTypedHandler(
			"conversation-create-direct",
			"/conversation/direct",
			server.POST,
			s.handleCreateDirectConversation,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"conversation-group-prepare",
			"/conversation/group/prepare",
			server.POST,
			s.handlePrepareGroup,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"conversation-create-group",
			"/conversation/group",
			server.POST,
			s.handleCreateGroupConversation,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"conversation-command-prepare",
			"/conversation/command/prepare",
			server.POST,
			s.handlePrepareCommand,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"conversation-membership-prepare",
			"/conversation/membership/prepare",
			server.POST,
			s.handlePrepareMembership,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"conversation-command-submit",
			"/conversation/command",
			server.POST,
			s.handleSubmitAuthorityCommand,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"conversation-command-results-resolve",
			"/conversation/command/results",
			server.POST,
			s.handleResolveCommandResults,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"conversation-list",
			"/conversation/list",
			server.GET,
			s.handleListConversations,
			authenticatedActor...,
		),
		server.NewTypedHandler(
			"conversation-get",
			"/conversation/get",
			server.GET,
			s.handleGetConversation,
			authenticatedActor...,
		),
		server.NewTypedHandler(
			"conversation-public-head",
			"/conversation/public-head",
			server.GET,
			s.handleGetConversationPublicHead,
			authenticatedActor...,
		),
		server.NewTypedHandler(
			"conversation-members",
			"/conversation/members",
			server.GET,
			s.handleGetConversationMembers,
			authenticatedActor...,
		),
		server.NewTypedHandler(
			"conversation-events",
			"/conversation/events",
			server.GET,
			s.handleListConversationEvents,
			authenticatedActor...,
		),
		server.NewTypedHandler(
			"conversation-messages",
			"/conversation/messages",
			server.GET,
			s.handleListConversationMessages,
			authenticatedActor...,
		),
		server.NewTypedHandler(
			"conversation-thread-messages",
			"/conversation/thread/messages",
			server.GET,
			s.handleListThreadMessages,
			authenticatedActor...,
		),
		server.NewTypedHandler(
			"conversation-thread-counts",
			"/conversation/thread/counts",
			server.POST,
			s.handleGetThreadCounts,
			authenticatedActor...,
		),
		server.NewTypedHandler(
			"conversation-member-settings-get",
			"/conversation/member/settings",
			server.GET,
			s.handleGetMemberSettings,
			authenticatedActor...,
		),
		server.NewTypedHandler(
			"conversation-member-settings-update",
			"/conversation/member/settings",
			server.PUT,
			s.handleUpdateMemberSettings,
			authenticatedActor...,
		),
		server.NewTypedHandler(
			"conversation-typing-submit",
			"/conversation/typing",
			server.POST,
			s.handleSubmitTyping,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"conversation-read-cursor-submit",
			"/conversation/read-cursor",
			server.POST,
			s.handleSubmitReadCursor,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"conversation-delivery-receipt-submit",
			"/conversation/delivery/receipt",
			server.POST,
			s.handleSubmitDeliveryReceipt,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"device-inbox-claim",
			"/device/inbox/claim",
			server.POST,
			s.handleClaimDeviceInbox,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"device-inbox-ack",
			"/device/inbox/ack",
			server.POST,
			s.handleAcknowledgeDeviceInbox,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"device-inbox-reject",
			"/device/inbox/reject",
			server.POST,
			s.handleRejectDeviceInbox,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"conversation-leave-intent-submit",
			"/conversation/mls/leave-intent",
			server.POST,
			s.handleSubmitLeaveIntent,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"conversation-leave-intent-list",
			"/conversation/mls/leave-intents",
			server.GET,
			s.handleListLeaveIntents,
			authenticatedDevice...,
		),
		server.NewTypedHandler(
			"conversation-attachment-upload-begin",
			"/conversation/attachments/uploads:begin",
			server.POST,
			s.handleBeginAttachmentUpload,
			authenticatedDevice...,
		),
		server.NewSimpleHandler(
			"conversation-attachment-upload-status",
			"/conversation/attachments/uploads/:upload_id",
			server.GET,
			s.handleAttachmentUploadStatus,
			authenticatedDevice...,
		),
		server.NewSimpleHandler(
			"conversation-attachment-upload-part",
			"/conversation/attachments/uploads/:upload_id/chunks/:chunk_index",
			server.PUT,
			s.handleAttachmentChunk,
			authenticatedDevice...,
		),
		server.NewSimpleHandler(
			"conversation-attachment-upload-complete",
			"/conversation/attachments/uploads/:upload_id/complete",
			server.POST,
			s.handleCompleteAttachmentUpload,
			authenticatedDevice...,
		),
		server.NewSimpleHandler(
			"conversation-attachment-upload-cancel",
			"/conversation/attachments/uploads/:upload_id/cancel",
			server.POST,
			s.handleCancelAttachmentUpload,
			authenticatedDevice...,
		),
		server.NewSimpleHandler(
			"conversation-attachment-object-download",
			"/conversation/attachments/objects/:object_id",
			server.GET,
			s.handleAttachmentObject,
			authenticatedDevice...,
		),
	}
}

func productionLocalStationID() (valueobject.StationID, error) {
	stationPeerID := nativefed.LocalIdentitySnapshot().StationPeerID.String()
	localStation, err := valueobject.NewStationID(stationPeerID)
	if err != nil {
		return "", fmt.Errorf(
			"initialize Conversation: local Station peer identity is unavailable: %w",
			err,
		)
	}

	return localStation, nil
}

func (s *subServer) queryService() *query.Service {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.composition.QueryService
}

func (s *subServer) evaluateCreateDirect(
	ctx context.Context,
	peerPTID string,
) error {
	if s.gate == nil {
		return fmt.Errorf("Conversation social policy is unavailable")
	}

	return s.gate.Evaluate(ctx, social_gate.Operation{
		Action:     "create_direct",
		TargetPtid: peerPTID,
	})
}
