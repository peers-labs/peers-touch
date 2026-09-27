package groupcall

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/livekit/protocol/webhook"
	lksdk "github.com/livekit/server-sdk-go/v2"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

// roomPrefix is a deterministic, collision-safe prefix so that the
// same group always maps to exactly one LiveKit room name.
const roomPrefix = "gc-"

// tokenTTL is the validity window for participant JWTs.
const tokenTTL = 6 * time.Hour

// LiveKitConfig holds connection parameters for the external SFU.
// Every field MUST come from environment variables — never hardcoded.
type LiveKitConfig struct {
	APIURL    string // Station-facing HTTP(S) endpoint.
	PublicURL string // Desktop-facing WS(S) endpoint.
	APIKey    string
	APISecret string
}

// LiveKitAdapter implements RoomProvider against a LiveKit SFU.
type LiveKitAdapter struct {
	cfg     LiveKitConfig
	roomSvc *lksdk.RoomServiceClient
	members GroupMemberLister
}

// NewLiveKitAdapter creates a LiveKitAdapter. The caller is responsible
// for reading env vars and passing a validated LiveKitConfig.
func NewLiveKitAdapter(cfg LiveKitConfig, members GroupMemberLister) *LiveKitAdapter {
	roomSvc := lksdk.NewRoomServiceClient(cfg.APIURL, cfg.APIKey, cfg.APISecret)
	return &LiveKitAdapter{
		cfg:     cfg,
		roomSvc: roomSvc,
		members: members,
	}
}

// roomName returns the deterministic LiveKit room name for a group.
func roomName(groupULID string) string {
	return roomPrefix + groupULID
}

func (a *LiveKitAdapter) validateConfig() error {
	if a.cfg.APIURL == "" || a.cfg.PublicURL == "" || a.cfg.APIKey == "" || a.cfg.APISecret == "" {
		return fmt.Errorf("groupcall: LiveKit is not configured")
	}
	return nil
}

// CreateRoom creates or re-uses a LiveKit room for the group.
// LiveKit's CreateRoom is idempotent — calling it when the room
// already exists returns the existing room unchanged.
func (a *LiveKitAdapter) CreateRoom(ctx context.Context, groupULID string) (string, error) {
	if err := a.validateConfig(); err != nil {
		return "", err
	}
	name := roomName(groupULID)
	_, err := a.roomSvc.CreateRoom(ctx, &livekit.CreateRoomRequest{
		Name:            name,
		EmptyTimeout:    300, // seconds; auto-close when empty for 5 min
		MaxParticipants: 50,
	})
	if err != nil {
		return "", fmt.Errorf("groupcall: livekit CreateRoom failed room=%s: %w", name, err)
	}
	return name, nil
}

// GenerateToken mints a participant JWT for actorPTID granting join
// permission to the specified room. Returns the SFU WebSocket URL
// and the signed token string.
func (a *LiveKitAdapter) GenerateToken(_ context.Context, room, actorPTID string) (string, string, error) {
	if err := a.validateConfig(); err != nil {
		return "", "", err
	}
	at := auth.NewAccessToken(a.cfg.APIKey, a.cfg.APISecret)
	grant := &auth.VideoGrant{
		RoomJoin: true,
		Room:     room,
	}
	at.SetVideoGrant(grant).
		SetIdentity(actorPTID).
		SetValidFor(tokenTTL)

	token, err := at.ToJWT()
	if err != nil {
		return "", "", fmt.Errorf("groupcall: token generation failed room=%s actor=%s: %w", room, actorPTID, err)
	}
	return a.cfg.PublicURL, token, nil
}

// RemoveParticipant forcibly ejects a participant from the room.
func (a *LiveKitAdapter) RemoveParticipant(ctx context.Context, room, actorPTID string) error {
	_, err := a.roomSvc.RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{
		Room:     room,
		Identity: actorPTID,
	})
	if err != nil {
		return fmt.Errorf("groupcall: RemoveParticipant failed room=%s actor=%s: %w", room, actorPTID, err)
	}
	return nil
}

// CloseRoom terminates an active room, disconnecting all participants.
func (a *LiveKitAdapter) CloseRoom(ctx context.Context, room string) error {
	_, err := a.roomSvc.DeleteRoom(ctx, &livekit.DeleteRoomRequest{
		Room: room,
	})
	if err != nil {
		return fmt.Errorf("groupcall: DeleteRoom failed room=%s: %w", room, err)
	}
	return nil
}

// HandleWebhook verifies the LiveKit webhook signature, parses the
// event, and publishes SSE notifications to affected group members.
func (a *LiveKitAdapter) HandleWebhook(ctx context.Context, r *http.Request) error {
	provider := auth.NewSimpleKeyProvider(a.cfg.APIKey, a.cfg.APISecret)
	event, err := webhook.ReceiveWebhookEvent(r, provider)
	if err != nil {
		return fmt.Errorf("groupcall: webhook verification failed: %w", err)
	}

	if event.GetRoom() == nil {
		return nil
	}

	room := event.GetRoom().GetName()
	groupULID := extractGroupULID(room)
	if groupULID == "" {
		return nil
	}

	switch event.GetEvent() {
	case "room_finished":
		a.publishCallSignal(ctx, groupULID, room, realtime.CallSignal_ROOM_ENDED)
	case "participant_joined":
		// Emit ROOM_ACTIVE when the first participant joins so that
		// group members see the incoming-call indicator.
		if event.GetRoom().GetNumParticipants() == 1 {
			a.publishCallSignal(ctx, groupULID, room, realtime.CallSignal_ROOM_ACTIVE)
		}
	}

	return nil
}

// extractGroupULID strips the room prefix to recover the original
// group ULID. Returns empty string if the name is not prefixed.
func extractGroupULID(room string) string {
	if len(room) <= len(roomPrefix) {
		return ""
	}
	if room[:len(roomPrefix)] != roomPrefix {
		return ""
	}
	return room[len(roomPrefix):]
}

// publishCallSignal fans out a CallSignal event to every member of
// the group via the EventBus SSE stream.
func (a *LiveKitAdapter) publishCallSignal(ctx context.Context, groupULID, room string, kind realtime.CallSignal_Kind) {
	bus := events.GetBus()
	if bus == nil {
		logger.DefaultHelper.Warnf("groupcall: event bus unavailable group_ulid=%s room=%s kind=%v", groupULID, room, kind)
		return
	}

	recipients, err := a.members.ListGroupMemberPTIDs(ctx, groupULID)
	if err != nil {
		logger.DefaultHelper.Warnf("groupcall: failed to list members group_ulid=%s: %v", groupULID, err)
		return
	}

	ev := &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Signaling{
			Signaling: &realtime.CallSignal{
				GroupUlid: groupULID,
				RoomName:  room,
				Kind:      kind,
			},
		},
	}

	for _, ptid := range recipients {
		if _, pubErr := bus.Publish(ptid, ev); pubErr != nil {
			logger.DefaultHelper.Warnf("groupcall: publish failed recipient=%s group_ulid=%s kind=%v: %v", ptid, groupULID, kind, pubErr)
		}
	}
}
