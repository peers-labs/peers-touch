package groupcall

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/livekit/protocol/webhook"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/twitchtv/twirp"
	"google.golang.org/protobuf/encoding/protowire"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

// roomPrefix is a deterministic, collision-safe prefix so that the
// same group always maps to exactly one LiveKit room name.
const roomPrefix = "gc-"

// tokenTTL is the validity window for participant JWTs.
const tokenTTL = time.Minute

var ErrConditionalAdmissionUnavailable = errors.New("groupcall: SFU conditional endpoint admission is unavailable")

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
	admit   func(context.Context, string, string, string) error
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
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := a.validateConfig(); err != nil {
		return "", err
	}
	if err := a.requireConditionalAdmission(ctx); err != nil {
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
	grant.SetCanPublish(false)
	grant.SetCanSubscribe(false)
	grant.SetCanPublishData(false)
	grant.SetCanUpdateOwnMetadata(false)
	at.SetVideoGrant(grant).
		SetIdentity(actorPTID).
		SetValidFor(tokenTTL)

	token, err := at.ToJWT()
	if err != nil {
		return "", "", fmt.Errorf("groupcall: token generation failed room=%s actor=%s: %w", room, actorPTID, err)
	}
	return a.cfg.PublicURL, token, nil
}

func (a *LiveKitAdapter) requireConditionalAdmission(ctx context.Context) error {
	if err := a.validateConfig(); err != nil {
		return err
	}
	token, err := auth.NewAccessToken(a.cfg.APIKey, a.cfg.APISecret).
		SetVideoGrant(&auth.VideoGrant{RoomList: true}).SetValidFor(time.Minute).ToJWT()
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet,
		strings.TrimRight(a.cfg.APIURL, "/")+"/.well-known/peers-touch/group-admission", nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	// Do not forward management credentials to a redirect destination.
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("%w: capability request failed", ErrConditionalAdmissionUnavailable)
	}
	defer response.Body.Close()
	var capability struct{ Contract, Source string }
	if response.StatusCode != http.StatusOK ||
		json.NewDecoder(http.MaxBytesReader(nil, response.Body, 4096)).Decode(&capability) != nil ||
		capability.Contract != "sid-fence-replay-deny-v1" ||
		capability.Source != "b93c1e160770d93179dc5b1c9027567befec5e62" {
		return ErrConditionalAdmissionUnavailable
	}
	return nil
}

func (a *LiveKitAdapter) AdmitParticipant(ctx context.Context, room, identity, sid, actorPTID string) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if sid == "" || actorPTID == "" || extractGroupULID(room) == "" {
		return fmt.Errorf("groupcall: incomplete conditional admission")
	}
	if err := a.requireConditionalAdmission(ctx); err != nil {
		return err
	}
	metadata, err := json.Marshal(struct {
		ActorPTID string `json:"actorPtid"`
	}{actorPTID})
	if err != nil {
		return err
	}
	input := &livekit.UpdateParticipantRequest{
		Room: room, Identity: identity, Metadata: string(metadata),
		Permission: &livekit.ParticipantPermission{
			CanPublish: true, CanSubscribe: true, CanPublishData: false,
			CanUpdateMetadata: false,
		},
	}
	// This private protobuf field is verified at the RTC owner under the
	// StartSession/Update/Remove fence. It is never participant metadata.
	wire := protowire.AppendTag(nil, 1001, protowire.BytesType)
	input.ProtoReflect().SetUnknown(protowire.AppendString(wire, sid))
	participant, err := a.roomSvc.UpdateParticipant(ctx, input)
	if err != nil {
		return fmt.Errorf("groupcall: conditional admission failed: %w", err)
	}
	if participant.GetSid() != sid || participant.GetIdentity() != identity ||
		!participant.GetPermission().GetCanPublish() || !participant.GetPermission().GetCanSubscribe() {
		return fmt.Errorf("groupcall: SFU did not confirm conditional admission")
	}
	return nil
}

func (a *LiveKitAdapter) ReadRoom(ctx context.Context, groupULID string) (*RoomStatus, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := a.validateConfig(); err != nil {
		return nil, err
	}
	rooms, err := a.roomSvc.ListRooms(ctx, &livekit.ListRoomsRequest{Names: []string{roomName(groupULID)}})
	if err != nil {
		return nil, err
	}
	result := &RoomStatus{}
	for _, room := range rooms.GetRooms() {
		if room.GetName() == roomName(groupULID) {
			result.RoomName = room.GetName()
			result.RoomSID = room.GetSid()
			participants, err := a.roomSvc.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: room.GetName()})
			if err != nil {
				return nil, err
			}
			for _, participant := range participants.GetParticipants() {
				if participant.GetPermission().GetCanPublish() && participant.GetPermission().GetCanSubscribe() {
					result.Active = true
					break
				}
			}
			break
		}
	}
	return result, nil
}

// RemoveParticipant forcibly ejects a participant from the room.
func (a *LiveKitAdapter) RemoveParticipant(ctx context.Context, room, actorPTID string) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	_, err := a.roomSvc.RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{
		Room:     room,
		Identity: actorPTID,
	})
	if err != nil {
		var rpcErr twirp.Error
		if !errors.As(err, &rpcErr) || rpcErr.Code() != twirp.NotFound {
			return fmt.Errorf("groupcall: RemoveParticipant failed room=%s endpoint=%s: %w", room, actorPTID, err)
		}
	}
	// A successful request is not the absence proof. Read the current roster.
	participants, err := a.roomSvc.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: room})
	if err != nil {
		var rpcErr twirp.Error
		if errors.As(err, &rpcErr) && rpcErr.Code() == twirp.NotFound {
			return nil
		}
		return fmt.Errorf("groupcall: verify participant ejection: %w", err)
	}
	for _, participant := range participants.GetParticipants() {
		if participant.GetIdentity() == actorPTID {
			return fmt.Errorf("groupcall: endpoint remains in SFU roster")
		}
	}
	return nil
}

// CloseRoom terminates an active room, disconnecting all participants.
func (a *LiveKitAdapter) CloseRoom(ctx context.Context, room string) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
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
		participant := event.GetParticipant()
		if participant == nil || a.admit == nil {
			return fmt.Errorf("groupcall: endpoint admission owner is unavailable")
		}
		if err := a.admit(ctx, room, participant.GetIdentity(), participant.GetSid()); err != nil {
			ejectErr := a.RemoveParticipant(ctx, room, participant.GetIdentity())
			return errors.Join(err, ejectErr)
		}
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
