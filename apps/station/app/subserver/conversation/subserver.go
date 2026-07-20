package conversation

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"

	envpkg "github.com/peers-labs/peers-touch/station/app/subserver/envelope"
	envinf "github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type subServer struct {
	status          server.Status
	jwtWrapper      server.Wrapper
	service         Service
	kpStore         *KeyPackageStore
	deviceStore     *DeviceStore
	envelopeService envpkg.Service
	localStationID  string
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
		&KeyPackage{},
		&DeviceRecord{},
	); err != nil {
		return err
	}

	s.localStationID = conversationLocalAudience()
	repo := newPostgresConversationRepo(rds)
	s.kpStore = NewKeyPackageStore(rds)
	s.deviceStore = NewDeviceStore(rds)

	envRepo := envinf.NewPostgresRepository(rds)
	envBus := &noopConvDeviceBus{}
	envelopeService := envpkg.NewService(envRepo, envBus, conversationLocalAudience)
	envelopeBridge := NewEnvelopeBridge(envelopeService)

	s.envelopeService = envelopeService
	s.service = NewConversationService(repo, envelopeBridge, s.localStationID)

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
	return []server.Handler{
		server.NewTypedHandler("conv-create-direct", "/conversation/direct", server.POST,
			s.handleCreateDirect, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-create-group", "/conversation/group", server.POST,
			s.handleCreateGroup, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-submit-cmd", "/conversation/command", server.POST,
			s.handleSubmitCommand, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-receipt", "/conversation/receipt", server.POST,
			s.handleSubmitReceipt, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-get", "/conversation/get", server.GET,
			s.handleGetConversation, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-list", "/conversation/list", server.GET,
			s.handleListConversations, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-members", "/conversation/members", server.GET,
			s.handleGetMembers, logID, s.jwtWrapper),
		server.NewTypedHandler("conv-events", "/conversation/events", server.GET,
			s.handleListEvents, logID, s.jwtWrapper),
		server.NewTypedHandler("kp-upload", "/keypackage/upload", server.POST,
			s.handleUploadKeyPackage, logID, s.jwtWrapper),
		server.NewTypedHandler("kp-fetch", "/keypackage/fetch", server.POST,
			s.handleFetchKeyPackage, logID, s.jwtWrapper),
		server.NewTypedHandler("kp-count", "/keypackage/count", server.GET,
			s.handleCountKeyPackages, logID, s.jwtWrapper),
		server.NewTypedHandler("device-register", "/device/register", server.POST,
			s.handleDeviceRegister, logID, s.jwtWrapper),
		server.NewTypedHandler("device-list", "/device/list", server.GET,
			s.handleDeviceList, logID, s.jwtWrapper),
		server.NewTypedHandler("device-revoke", "/device/revoke", server.POST,
			s.handleDeviceRevoke, logID, s.jwtWrapper),
		server.NewTypedHandler("mls-distribute", "/mls/distribute", server.POST,
			s.handleMlsDistribute, logID, s.jwtWrapper),
		server.NewTypedHandler("dkx-send", "/dkx/send", server.POST,
			s.handleDkxSend, logID, s.jwtWrapper),
	}
}

// --- Request/Response types ---

type createDirectRequest struct {
	PeerActorDid     string `json:"peer_actor_did"`
	PeerStationPeerID string `json:"peer_station_peer_id"`
}

type createDirectResponse struct {
	Conversation *chat.Conversation `json:"conversation"`
}

type submitCommandRequest struct {
	Command *chat.ConversationCommand `json:"command"`
}

type submitCommandResponse struct {
	Event *chat.CommittedConversationEvent `json:"event"`
}

type getConversationRequest struct {
	ConversationId string `json:"conversation_id"`
}

type getConversationResponse struct {
	Conversation *chat.Conversation `json:"conversation"`
}

type listConversationsRequest struct{}

type listConversationsResponse struct {
	Conversations []*chat.Conversation `json:"conversations"`
}

type getMembersRequest struct {
	ConversationId string `json:"conversation_id"`
}

type getMembersResponse struct {
	Members []*chat.ConversationMember `json:"members"`
}

// --- Handlers ---

func (s *subServer) handleCreateDirect(ctx context.Context, req *createDirectRequest) (*createDirectResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PeerActorDid == "" {
		return nil, server.BadRequest("peer_actor_did is required")
	}

	peerStation := req.PeerStationPeerID
	if peerStation == "" {
		peerStation = s.localStationID
	}

	conv, err := s.service.CreateDirect(ctx, subject.ID, req.PeerActorDid, s.localStationID, peerStation)
	if err != nil {
		return nil, server.InternalErrorWithCause("create direct conversation failed", err)
	}
	return &createDirectResponse{Conversation: conv}, nil
}

func (s *subServer) handleSubmitCommand(ctx context.Context, req *submitCommandRequest) (*submitCommandResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Command == nil {
		return nil, server.BadRequest("command is required")
	}

	req.Command.SenderActorDid = subject.ID

	event, err := s.service.SubmitCommand(ctx, req.Command)
	if err != nil {
		return nil, server.InternalErrorWithCause("submit command failed", err)
	}
	return &submitCommandResponse{Event: event}, nil
}

type submitReceiptRequest struct {
	ConversationId string `json:"conversation_id"`
	MessageId      string `json:"message_id"`
	DeviceId       string `json:"device_id"`
	ReceiptType    int32  `json:"receipt_type"`
}

type submitReceiptResponse struct{}

func (s *subServer) handleSubmitReceipt(ctx context.Context, req *submitReceiptRequest) (*submitReceiptResponse, error) {
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
		ActorDid:       subject.ID,
		DeviceId:       req.DeviceId,
		ReceiptType:    chat.ReceiptType(req.ReceiptType),
	}

	if err := s.service.SubmitReceipt(ctx, receipt); err != nil {
		return nil, server.InternalErrorWithCause("submit receipt failed", err)
	}
	return &submitReceiptResponse{}, nil
}

func (s *subServer) handleGetConversation(ctx context.Context, req *getConversationRequest) (*getConversationResponse, error) {
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
	return &getConversationResponse{Conversation: conv}, nil
}

func (s *subServer) handleListConversations(ctx context.Context, _ *listConversationsRequest) (*listConversationsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	convs, err := s.service.ListConversations(ctx, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("list conversations failed", err)
	}
	return &listConversationsResponse{Conversations: convs}, nil
}

func (s *subServer) handleGetMembers(ctx context.Context, req *getMembersRequest) (*getMembersResponse, error) {
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
	return &getMembersResponse{Members: members}, nil
}

type listEventsRequest struct {
	ConversationId string `json:"conversation_id"`
	AfterSeq       int64  `json:"after_seq"`
	Limit          int    `json:"limit"`
}

type listEventsResponse struct {
	Events []*chat.CommittedConversationEvent `json:"events"`
}

func (s *subServer) handleListEvents(ctx context.Context, req *listEventsRequest) (*listEventsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationId == "" {
		return nil, server.BadRequest("conversation_id is required")
	}

	events, err := s.service.ListEvents(ctx, req.ConversationId, req.AfterSeq, req.Limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("list events failed", err)
	}
	return &listEventsResponse{Events: events}, nil
}

// --- CreateGroup handler ---

type createGroupRequest struct {
	Name    string        `json:"name"`
	Members []memberEntry `json:"members"`
}

type memberEntry struct {
	ActorDid  string `json:"actor_did"`
	StationID string `json:"station_id"`
}

type createGroupResponse struct {
	Conversation *chat.Conversation `json:"conversation"`
}

func (s *subServer) handleCreateGroup(ctx context.Context, req *createGroupRequest) (*createGroupResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Name == "" {
		return nil, server.BadRequest("name is required")
	}

	entries := make([]MemberEntry, 0, len(req.Members)+1)
	entries = append(entries, MemberEntry{
		ActorDID:  subject.ID,
		StationID: s.localStationID,
		Role:      chat.MemberRole_MEMBER_ROLE_OWNER,
	})
	for _, m := range req.Members {
		if m.ActorDid == subject.ID {
			continue
		}
		station := m.StationID
		if station == "" {
			station = s.localStationID
		}
		entries = append(entries, MemberEntry{
			ActorDID:  m.ActorDid,
			StationID: station,
			Role:      chat.MemberRole_MEMBER_ROLE_MEMBER,
		})
	}

	conv, err := s.service.CreateGroup(ctx, req.Name, subject.ID, s.localStationID, entries)
	if err != nil {
		return nil, server.InternalErrorWithCause("create group failed", err)
	}
	return &createGroupResponse{Conversation: conv}, nil
}

// --- KeyPackage handlers ---

type uploadKeyPackageRequest struct {
	DeviceId string `json:"device_id"`
	Data     []byte `json:"data"`
}

type uploadKeyPackageResponse struct{}

type fetchKeyPackageRequest struct {
	ActorDid string `json:"actor_did"`
}

type fetchKeyPackageResponse struct {
	Data      []byte `json:"data"`
	Available bool   `json:"available"`
}

type countKeyPackagesRequest struct{}

type countKeyPackagesResponse struct {
	Count int64 `json:"count"`
}

func (s *subServer) handleUploadKeyPackage(ctx context.Context, req *uploadKeyPackageRequest) (*uploadKeyPackageResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.DeviceId == "" {
		return nil, server.BadRequest("device_id is required")
	}
	if len(req.Data) == 0 {
		return nil, server.BadRequest("data is required")
	}

	if err := s.kpStore.Upload(ctx, subject.ID, req.DeviceId, s.localStationID, req.Data); err != nil {
		return nil, server.InternalErrorWithCause("upload keypackage failed", err)
	}
	return &uploadKeyPackageResponse{}, nil
}

func (s *subServer) handleFetchKeyPackage(ctx context.Context, req *fetchKeyPackageRequest) (*fetchKeyPackageResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ActorDid == "" {
		return nil, server.BadRequest("actor_did is required")
	}

	data, err := s.kpStore.FetchAndConsume(ctx, req.ActorDid)
	if err != nil {
		return nil, server.InternalErrorWithCause("fetch keypackage failed", err)
	}
	return &fetchKeyPackageResponse{Data: data, Available: data != nil}, nil
}

func (s *subServer) handleCountKeyPackages(ctx context.Context, _ *countKeyPackagesRequest) (*countKeyPackagesResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	count, err := s.kpStore.CountAvailable(ctx, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("count keypackages failed", err)
	}
	return &countKeyPackagesResponse{Count: count}, nil
}

// --- Device handlers ---

type deviceRegisterRequest struct {
	DeviceId  string `json:"device_id"`
	Label     string `json:"label"`
	PublicKey []byte `json:"public_key"`
}

type deviceRegisterResponse struct{}

func (s *subServer) handleDeviceRegister(ctx context.Context, req *deviceRegisterRequest) (*deviceRegisterResponse, error) {
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
	return &deviceRegisterResponse{}, nil
}

type deviceListRequest struct{}

type deviceListResponse struct {
	Devices []deviceInfo `json:"devices"`
}

type deviceInfo struct {
	DeviceID  string  `json:"device_id"`
	Label     string  `json:"label"`
	CreatedAt string  `json:"created_at"`
	Revoked   bool    `json:"revoked"`
}

func (s *subServer) handleDeviceList(ctx context.Context, _ *deviceListRequest) (*deviceListResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	records, err := s.deviceStore.ListActive(ctx, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("device list failed", err)
	}

	devices := make([]deviceInfo, 0, len(records))
	for _, r := range records {
		devices = append(devices, deviceInfo{
			DeviceID:  r.DeviceID,
			Label:     r.Label,
			CreatedAt: r.CreatedAt.Format("2006-01-02T15:04:05Z"),
			Revoked:   r.Revoked,
		})
	}
	return &deviceListResponse{Devices: devices}, nil
}

type deviceRevokeRequest struct {
	DeviceId string `json:"device_id"`
}

type deviceRevokeResponse struct{}

func (s *subServer) handleDeviceRevoke(ctx context.Context, req *deviceRevokeRequest) (*deviceRevokeResponse, error) {
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
	return &deviceRevokeResponse{}, nil
}

// --- MLS distribute handler (P3: C-8 envelope carrying MLS) ---

type mlsDistributeRequest struct {
	ConversationId string `json:"conversation_id"`
	Kind           int32  `json:"kind"`
	MlsEpoch       int64  `json:"mls_epoch"`
	OpaqueBytes    []byte `json:"opaque_bytes"`
	Recipients     []string `json:"recipients"`
}

type mlsDistributeResponse struct {
	Delivered int `json:"delivered"`
}

func (s *subServer) handleMlsDistribute(ctx context.Context, req *mlsDistributeRequest) (*mlsDistributeResponse, error) {
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

	senderIsMember := false
	for _, m := range member {
		if m.ActorDid == subject.ID && m.MemberStatus == chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			senderIsMember = true
			break
		}
	}
	if !senderIsMember {
		return nil, server.Unauthorized("sender is not an active member")
	}

	mlsPayload := &chat.MlsKeyDeliveryPayload{
		ConversationId: req.ConversationId,
		Kind:           chat.MlsDeliveryKind(req.Kind),
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

	delivered := 0
	for _, m := range member {
		if m.ActorDid == subject.ID {
			continue
		}
		if m.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			continue
		}
		if len(recipientSet) > 0 && !recipientSet[m.ActorDid] {
			continue
		}

		env := &chat.StationEnvelope{
			EnvelopeId:                 uuid.NewString(),
			IdempotencyKey:             req.ConversationId + ":" + subject.ID + ":mls:" + uuid.NewString()[:8],
			ConversationId:             req.ConversationId,
			SenderActorDid:             subject.ID,
			RecipientActorDid:          m.ActorDid,
			RecipientHomeStationPeerId: m.ActorHomeStationPeerId,
			MembershipEpoch:            conv.MembershipEpoch,
			PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_KEY_DELIVERY,
			PayloadBytes:               payloadBytes,
		}

		if _, submitErr := s.envelopeService.Submit(ctx, env); submitErr == nil {
			delivered++
		}
	}

	return &mlsDistributeResponse{Delivered: delivered}, nil
}

// --- Direct Key Exchange handler (P2: X3DH initial handshake routing) ---

type dkxSendRequest struct {
	RecipientActorDid     string `json:"recipient_actor_did"`
	RecipientStationPeerId string `json:"recipient_station_peer_id"`
	SessionId             string `json:"session_id"`
	Kind                  int32  `json:"kind"`
	OpaqueKeyMaterial     []byte `json:"opaque_key_material"`
}

type dkxSendResponse struct {
	EnvelopeId string `json:"envelope_id"`
}

func (s *subServer) handleDkxSend(ctx context.Context, req *dkxSendRequest) (*dkxSendResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.RecipientActorDid == "" || req.SessionId == "" || len(req.OpaqueKeyMaterial) == 0 {
		return nil, server.BadRequest("recipient_actor_did, session_id, and opaque_key_material are required")
	}

	dkxPayload := &chat.DirectKeyExchangePayload{
		SessionId:          req.SessionId,
		Kind:               chat.DirectKeyExchangeKind(req.Kind),
		OpaqueKeyMaterial:  req.OpaqueKeyMaterial,
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
		IdempotencyKey:             req.SessionId + ":" + subject.ID + ":" + chat.DirectKeyExchangeKind(req.Kind).String(),
		SenderActorDid:             subject.ID,
		RecipientActorDid:          req.RecipientActorDid,
		RecipientHomeStationPeerId: recipientStation,
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_DIRECT_KEY_EXCHANGE,
		PayloadBytes:               payloadBytes,
	}

	envelopeId, err := s.envelopeService.Submit(ctx, env)
	if err != nil {
		return nil, server.InternalErrorWithCause("submit dkx envelope failed", err)
	}

	return &dkxSendResponse{EnvelopeId: envelopeId}, nil
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

// noopConvDeviceBus is a placeholder until P4 wires the real SSE bus.
type noopConvDeviceBus struct{}

func (*noopConvDeviceBus) PublishToDevice(_ context.Context, _, _ string, _ *chat.StationEnvelope) bool {
	return false
}

func (*noopConvDeviceBus) PublishToActor(_ context.Context, _ string, _ *chat.StationEnvelope) int {
	return 0
}
