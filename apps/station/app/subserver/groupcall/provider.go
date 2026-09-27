package groupcall

import (
	"context"
	"net/http"

	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
)

// RoomProvider abstracts the SFU backend for group calls.
// Current implementation: LiveKit. Future alternatives implement
// the same interface with zero handler/proto/config changes.
type RoomProvider interface {
	// CreateRoom creates or re-uses a LiveKit room for the given group.
	// Returns the deterministic room name.
	CreateRoom(ctx context.Context, groupULID string) (roomName string, err error)

	// GenerateToken mints a short-lived participant token for actorPTID
	// to join roomName. Returns the SFU WebSocket URL and the JWT token.
	GenerateToken(ctx context.Context, roomName, actorPTID string) (url, token string, err error)

	// RemoveParticipant forcibly removes a participant from the room.
	RemoveParticipant(ctx context.Context, roomName, actorPTID string) error

	// CloseRoom terminates an active room and disconnects all participants.
	CloseRoom(ctx context.Context, roomName string) error

	// HandleWebhook verifies and dispatches an SFU webhook callback.
	HandleWebhook(ctx context.Context, r *http.Request) error
}

// GroupMemberLister resolves the PTID set of a group so that call
// lifecycle notifications can be fan-out published via EventBus.
type GroupMemberLister interface {
	ListGroupMemberPTIDs(ctx context.Context, groupULID string) ([]string, error)
}

// ConversationAuthorityResolver exposes Conversation-owned membership and
// authority routing without exposing its persistence model to groupcall.
type ConversationAuthorityResolver interface {
	ResolveGroupCallAuthority(
		ctx context.Context,
		groupULID string,
		actorPTID string,
	) (
		authorityStationPeerID string,
		federationID string,
		authorityEpoch uint64,
		memberHomeStationPeerID string,
		activeMember bool,
		err error,
	)
}

// FederationPeerCaller is the canonical authenticated Station-to-Station
// transport used to reach a remote Conversation Authority.
type FederationPeerCaller interface {
	CallPeer(ctx context.Context, call federationruntime.PeerCall) error
	LocalStationPeerID() string
}

// JoinRequest is the HTTP request body for POST /group-call/join.
type JoinRequest struct {
	GroupULID string `json:"group_ulid"`
}

// JoinResponse is the HTTP response body for POST /group-call/join.
type JoinResponse struct {
	URL      string `json:"url"`
	Token    string `json:"token"`
	RoomName string `json:"room_name"`
}
