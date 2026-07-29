// Package compat_chat provides backward-compatible HTTP route handlers for the
// legacy /friend-chat/* and /group-chat/* API paths. These routes were removed
// when the friend_chat and group_chat subservers were replaced by the unified
// conversation + envelope subsystem (commit 82cdb299). The BFF (Desktop Rust)
// still targets the old paths; this adapter bridges them without BFF rewrites.
package compat_chat

import (
	"context"

	"github.com/google/uuid"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"

	convsub "github.com/peers-labs/peers-touch/station/app/subserver/conversation"
	envpkg "github.com/peers-labs/peers-touch/station/app/subserver/envelope"
	envinf "github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"

	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"strings"
)

type subServer struct {
	status         server.Status
	jwtWrapper     server.Wrapper
	convService    convsub.Service
	envService     envpkg.Service
	localStationID string
}

func NewCompatChatSubServer(opts ...option.Option) server.Subserver {
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

	s.localStationID = localAudience()

	convRepo := convsub.NewPostgresRepository(rds)
	envRepo := envinf.NewPostgresRepository(rds)
	envBus := envpkg.NewSSEDeviceBus()
	s.envService = envpkg.NewService(envRepo, envBus, localAudience)
	envelopeBridge := convsub.NewEnvelopeBridge(s.envService)
	s.convService = convsub.NewConversationService(convRepo, envelopeBridge, s.localStationID)

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

func (s *subServer) Name() string               { return "compat_chat" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}
func (s *subServer) Status() server.Status { return s.status }

func (s *subServer) Handlers() []server.Handler {
	logID := serverwrapper.LogID()
	deviceIDWrapper := serverwrapper.DeviceID()

	return []server.Handler{
		// --- Friend Chat compat routes ---
		server.NewTypedHandler("compat-fc-create-session", "/friend-chat/session/create", server.POST,
			s.handleFriendCreateSession, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-fc-list-sessions", "/friend-chat/sessions", server.GET,
			s.handleFriendListSessions, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-fc-send-message", "/friend-chat/message/send", server.POST,
			s.handleFriendSendMessage, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("compat-fc-list-messages", "/friend-chat/messages", server.GET,
			s.handleFriendListMessages, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-fc-ack-messages", "/friend-chat/message/ack", server.POST,
			s.handleFriendAckMessages, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-fc-get-settings", "/friend-chat/settings", server.GET,
			s.handleFriendGetSettings, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-fc-update-settings", "/friend-chat/settings", server.PUT,
			s.handleFriendUpdateSettings, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-fc-recall", "/friend-chat/message/recall", server.POST,
			s.handleFriendRecallMessage, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("compat-fc-edit", "/friend-chat/message/edit", server.POST,
			s.handleFriendEditMessage, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("compat-fc-delete", "/friend-chat/message/delete", server.POST,
			s.handleFriendDeleteMessage, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("compat-fc-pending", "/friend-chat/pending", server.GET,
			s.handleFriendGetPending, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-fc-stats", "/friend-chat/stats", server.GET,
			s.handleFriendGetStats, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-fc-sync", "/friend-chat/message/sync", server.POST,
			s.handleFriendSyncMessages, logID, s.jwtWrapper),

		// --- Group Chat compat routes ---
		server.NewTypedHandler("compat-gc-create", "/group-chat/create", server.POST,
			s.handleGroupCreate, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-list", "/group-chat/list", server.GET,
			s.handleGroupList, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-info", "/group-chat/info", server.GET,
			s.handleGroupInfo, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-update", "/group-chat/update", server.PUT,
			s.handleGroupUpdate, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-send-message", "/group-chat/message/send", server.POST,
			s.handleGroupSendMessage, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-list-messages", "/group-chat/messages", server.GET,
			s.handleGroupListMessages, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-members", "/group-chat/members", server.GET,
			s.handleGroupGetMembers, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-leave", "/group-chat/leave", server.POST,
			s.handleGroupLeave, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-invite", "/group-chat/invite", server.POST,
			s.handleGroupInvite, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-join", "/group-chat/join", server.POST,
			s.handleGroupJoin, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-remove-member", "/group-chat/member/remove", server.POST,
			s.handleGroupRemoveMember, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-update-member", "/group-chat/member/update", server.PUT,
			s.handleGroupUpdateMember, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-transfer-ownership", "/group-chat/ownership/transfer", server.POST,
			s.handleGroupTransferOwnership, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-dissolve", "/group-chat/dissolve", server.POST,
			s.handleGroupDissolve, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-recall", "/group-chat/message/recall", server.POST,
			s.handleGroupRecallMessage, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-edit", "/group-chat/message/edit", server.POST,
			s.handleGroupEditMessage, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-delete", "/group-chat/message/delete", server.POST,
			s.handleGroupDeleteMessage, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-unread-count", "/group-chat/unread-count", server.GET,
			s.handleGroupUnreadCount, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-mark-read", "/group-chat/mark-read", server.POST,
			s.handleGroupMarkRead, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-skdm-submit", "/group-chat/skdm/submit", server.POST,
			s.handleGroupSkdmSubmit, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-my-settings", "/group-chat/my-settings", server.GET,
			s.handleGroupGetSettings, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-my-settings-update", "/group-chat/my-settings", server.PUT,
			s.handleGroupUpdateSettings, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-nickname", "/group-chat/member/nickname", server.PUT,
			s.handleGroupUpdateNickname, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-search", "/group-chat/messages/search", server.GET,
			s.handleGroupSearchMessages, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-offline", "/group-chat/offline-messages", server.GET,
			s.handleGroupOfflineMessages, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-offline-ack", "/group-chat/offline-messages/ack", server.POST,
			s.handleGroupOfflineMessagesAck, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-stats", "/group-chat/stats", server.GET,
			s.handleGroupStats, logID, s.jwtWrapper),
		server.NewTypedHandler("compat-gc-federated-add", "/group-chat/member/federated-add", server.POST,
			s.handleGroupFederatedAdd, logID, s.jwtWrapper),
	}
}

func localAudience() string {
	identity := nativefed.LocalIdentitySnapshot()
	if strings.TrimSpace(identity.StationPeerID.String()) != "" {
		return identity.StationPeerID.String()
	}
	if strings.TrimSpace(identity.StationDomain) != "" {
		return strings.TrimSpace(identity.StationDomain)
	}
	return ""
}

func newIdempotencyKey(prefix string) string {
	return prefix + ":" + uuid.NewString()[:12]
}
