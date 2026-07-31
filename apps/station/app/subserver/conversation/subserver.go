package conversation

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
	"github.com/peers-labs/peers-touch/station/frame/core/store"

	envpkg "github.com/peers-labs/peers-touch/station/app/subserver/envelope"
	envinf "github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type subServer struct {
	status          server.Status
	jwtWrapper      server.Wrapper
	repo            Repository
	service         Service
	kpStore         *KeyPackageStore
	deviceStore     *DeviceStore
	envelopeService envpkg.Service
	localStationID  string
	fedKpFetcher    *FederatedKeyPackageFetcher
	gateEval        *ConversationGateEvaluator
}

func NewConversationSubServer(opts ...option.Option) server.Subserver {
	return &subServer{status: server.StatusStopped}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	if err := rds.AutoMigrate(
		&conversationModel{},
		&conversationMemberModel{},
		&conversationEventModel{},
		&readCursorModel{},
		&KeyPackage{},
		&DeviceRecord{},
	); err != nil {
		return err
	}

	s.localStationID = conversationLocalAudience()
	repo := newPostgresConversationRepo(rds)
	s.repo = repo
	s.kpStore = NewKeyPackageStore(rds)
	s.deviceStore = NewDeviceStore(rds)

	envRepo := envinf.NewPostgresRepository(rds)
	envBus := envpkg.NewSSEDeviceBus()
	envelopeService := envpkg.NewService(envRepo, envBus, conversationLocalAudience)
	envelopeBridge := NewEnvelopeBridge(envelopeService)

	s.envelopeService = envelopeService
	s.service = NewConversationService(repo, envelopeBridge, s.localStationID)
	s.fedKpFetcher = NewFederatedKeyPackageFetcher(authfed.Singleton())

	// Social gate: compose policy evaluator from repository-backed adapters.
	relAdapter := NewConversationRelationshipAdapter(repo, rds)
	roleAdapter := NewConversationGroupRoleAdapter(repo)
	s.gateEval = NewConversationGateEvaluator(relAdapter, roleAdapter, nil)

	return nil
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "conversation" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}
func (s *subServer) Status() server.Status { return s.status }

func (s *subServer) Handlers() []server.Handler {
	logID := serverwrapper.LogID()
	deviceIDWrapper := serverwrapper.DeviceID()

	// Social gate wrappers — applied AFTER jwtWrapper (auth must come first).
	createDirectGate := social_gate.NewGateWrapper(s.gateEval, "create_direct", extractCreateDirectOp)
	submitCmdGate := social_gate.NewGateWrapper(s.gateEval, "send_message", extractSubmitCommandOp)
	fetchKpGate := social_gate.NewGateWrapper(s.gateEval, "fetch_key_package", extractFetchKeyPackageOp)
	mlsDistributeGate := social_gate.NewGateWrapper(s.gateEval, "mls_distribute", extractMlsDistributeOp)
	dkxSendGate := social_gate.NewGateWrapper(s.gateEval, "dkx_send", extractDkxSendOp)

	return []server.Handler{
		server.NewTypedHandler("conv-create-direct", "/conversation/direct", server.POST,
			s.handleCreateDirect, logID, createDirectGate, s.jwtWrapper),
		server.NewTypedHandler("conv-create-group", "/conversation/group", server.POST,
			s.handleCreateGroup, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-submit-cmd", "/conversation/command", server.POST,
			s.handleSubmitCommand, logID, deviceIDWrapper, submitCmdGate, s.jwtWrapper),
		server.NewTypedHandler("conv-receipt", "/conversation/receipt", server.POST,
			s.handleSubmitReceipt, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("conv-get", "/conversation/get", server.GET,
			s.handleGetConversation, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-list", "/conversation/list", server.GET,
			s.handleListConversations, logID, s.jwtWrapper),
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
		server.NewTypedHandler("conv-read-cursor", "/conversation/read-cursor", server.POST,
			s.handleSetReadCursor, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-unread", "/conversation/unread", server.GET,
			s.handleGetUnread, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-member-settings-get", "/conversation/member/settings", server.GET,
			s.handleGetMemberSettings, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-member-settings-put", "/conversation/member/settings", server.PUT,
			s.handleUpdateMemberSettings, logID, s.jwtWrapper),
		server.NewTypedHandler("kp-upload", "/keypackage/upload", server.POST,
			s.handleUploadKeyPackage, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("kp-fetch", "/keypackage/fetch", server.POST,
			s.handleFetchKeyPackage, logID, fetchKpGate, s.jwtWrapper),
		server.NewTypedHandler("kp-count", "/keypackage/count", server.GET,
			s.handleCountKeyPackages, logID, s.jwtWrapper),
		server.NewTypedHandler("device-register", "/device/register", server.POST,
			s.handleDeviceRegister, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("device-list", "/device/list", server.GET,
			s.handleDeviceList, logID, s.jwtWrapper),
		server.NewTypedHandler("device-revoke", "/device/revoke", server.POST,
			s.handleDeviceRevoke, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("mls-distribute", "/mls/distribute", server.POST,
			s.handleMlsDistribute, logID, deviceIDWrapper, mlsDistributeGate, s.jwtWrapper),
		server.NewTypedHandler("dkx-send", "/dkx/send", server.POST,
			s.handleDkxSend, logID, deviceIDWrapper, dkxSendGate, s.jwtWrapper),
	}
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

	entries := make([]MemberEntry, 0, len(req.Members)+1)
	entries = append(entries, MemberEntry{
		Ptid:      subject.ID,
		StationID: s.localStationID,
		Role:      chat.MemberRole_MEMBER_ROLE_OWNER,
	})
	for _, m := range req.Members {
		if m.Ptid == subject.ID {
			continue
		}
		station := m.StationId
		if station == "" {
			station = s.localStationID
		}
		entries = append(entries, MemberEntry{
			Ptid:      m.Ptid,
			StationID: station,
			Role:      chat.MemberRole_MEMBER_ROLE_MEMBER,
		})
	}

	conv, err := s.service.CreateGroup(ctx, req.Name, subject.ID, s.localStationID, entries)
	if err != nil {
		return nil, server.InternalErrorWithCause("create group failed", err)
	}
	return &chat.CreateGroupConversationResponse{Conversation: conv}, nil
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
		return nil, server.InternalErrorWithCause("submit command failed", err)
	}
	return &chat.SubmitConversationCommandResponse{Event: event}, nil
}

func (s *subServer) handleSubmitReceipt(ctx context.Context, req *chat.SubmitConversationReceiptRequest) (*chat.SubmitConversationReceiptResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationId == "" || req.MessageId == "" {
		return nil, server.BadRequest("conversation_id and message_id are required")
	}

	receipt := &chat.MessageReceipt{
		ConversationId: req.ConversationId,
		MessageId:      req.MessageId,
		Ptid:           subject.ID,
		DeviceId:       req.DeviceId,
		ReceiptType:    req.ReceiptType,
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

	conv, err := s.service.GetConversation(ctx, req.ConversationId)
	if err != nil {
		return nil, server.InternalErrorWithCause("get conversation failed", err)
	}
	return &chat.GetConversationResponse{Conversation: conv}, nil
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

	members, err := s.service.GetMembers(ctx, req.ConversationId)
	if err != nil {
		return nil, server.InternalErrorWithCause("get members failed", err)
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

	// Header takes precedence; fall back to body field for backwards compatibility.
	deviceID := req.DeviceId
	if headerDeviceID := serverwrapper.GetDeviceID(ctx); headerDeviceID != "" {
		deviceID = headerDeviceID
	}

	if deviceID == "" {
		return nil, server.BadRequest("device_id is required")
	}
	if len(req.Data) == 0 {
		return nil, server.BadRequest("data is required")
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

	data, err := s.kpStore.FetchAndConsume(ctx, req.Ptid)
	if err != nil {
		return nil, server.InternalErrorWithCause("fetch keypackage failed", err)
	}

	if data == nil && req.HomeStationPeerId != "" && req.HomeStationPeerId != s.localStationID {
		remoteData, fetchErr := s.fedKpFetcher.FetchRemote(ctx, req.HomeStationPeerId, req.Ptid)
		if fetchErr != nil {
			return nil, server.InternalErrorWithCause("federated keypackage fetch failed", fetchErr)
		}
		data = remoteData
	}

	return &chat.FetchKeyPackageResponse{Data: data, Available: data != nil}, nil
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
	if req.DeviceId == "" {
		return nil, server.BadRequest("device_id is required")
	}

	if err := s.deviceStore.Register(ctx, subject.ID, req.DeviceId, req.Label, req.PublicKey); err != nil {
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
		return nil, server.InternalErrorWithCause("device revoke failed", err)
	}
	return &chat.RevokeDeviceResponse{}, nil
}

// --- MLS distribute handler (P3: C-8 envelope carrying MLS) ---

func (s *subServer) handleMlsDistribute(ctx context.Context, req *chat.DistributeMlsRequest) (*chat.DistributeMlsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationId == "" || len(req.OpaqueBytes) == 0 {
		return nil, server.BadRequest("conversation_id and opaque_bytes are required")
	}

	conv, err := s.service.GetConversation(ctx, req.ConversationId)
	if err != nil || conv == nil {
		return nil, server.BadRequest("conversation not found")
	}

	member, err := s.service.GetMembers(ctx, req.ConversationId)
	if err != nil {
		return nil, server.InternalErrorWithCause("get members failed", err)
	}

	mlsPayload := &chat.MlsKeyDeliveryPayload{
		ConversationId: req.ConversationId,
		Kind:           req.Kind,
		MlsEpoch:      req.MlsEpoch,
		OpaqueMlsBytes: req.OpaqueBytes,
	}
	payloadBytes, err := proto.Marshal(mlsPayload)
	if err != nil {
		return nil, server.InternalErrorWithCause("marshal mls payload failed", err)
	}

	recipientSet := make(map[string]bool, len(req.Recipients))
	for _, r := range req.Recipients {
		recipientSet[r] = true
	}

	delivered := int32(0)
	for _, m := range member {
		if m.Ptid == subject.ID {
			continue
		}
		if m.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			continue
		}
		if len(recipientSet) > 0 && !recipientSet[m.Ptid] {
			continue
		}

		env := &chat.StationEnvelope{
			EnvelopeId:                 uuid.NewString(),
			IdempotencyKey:             req.ConversationId + ":" + subject.ID + ":mls:" + uuid.NewString()[:8],
			ConversationId:             req.ConversationId,
			SenderPtid:                 subject.ID,
			RecipientPtid:              m.Ptid,
			RecipientHomeStationPeerId: m.ActorHomeStationPeerId,
			MembershipEpoch:            conv.MembershipEpoch,
			PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_KEY_DELIVERY,
			PayloadBytes:               payloadBytes,
		}

		if _, submitErr := s.envelopeService.Submit(ctx, env); submitErr == nil {
			delivered++
		}
	}

	return &chat.DistributeMlsResponse{Delivered: delivered}, nil
}

// --- Direct Key Exchange handler (P2: X3DH initial handshake routing) ---

func (s *subServer) handleDkxSend(ctx context.Context, req *chat.SendDkxRequest) (*chat.SendDkxResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.RecipientPtid == "" || req.SessionId == "" || len(req.OpaqueKeyMaterial) == 0 {
		return nil, server.BadRequest("recipient_ptid, session_id, and opaque_key_material are required")
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

	recipientStation := req.RecipientStationPeerId
	if recipientStation == "" {
		recipientStation = s.localStationID
	}

	env := &chat.StationEnvelope{
		EnvelopeId:                 uuid.NewString(),
		IdempotencyKey:             req.SessionId + ":" + subject.ID + ":" + req.Kind.String(),
		SenderPtid:                 subject.ID,
		RecipientPtid:              req.RecipientPtid,
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
