package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/livekit/livekit-server/pkg/config"
	"github.com/livekit/livekit-server/pkg/rtc"
	"github.com/livekit/livekit-server/pkg/rtc/types"
	"github.com/livekit/livekit-server/pkg/sfu"
	"github.com/livekit/livekit-server/pkg/telemetry/prometheus"
	"github.com/livekit/livekit-server/pkg/telemetry/telemetryfakes"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/livekit/protocol/rpc"
	"github.com/livekit/psrpc"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

// Exercise the actual protobuf HTTP client -> RoomService -> serialized psrpc
// bus -> RoomManager path. A marshal helper alone cannot establish that the
// expected SID survives both RPC hops or is checked by the RTC permission owner.
func TestPeersAdmissionTwoHopRPC(t *testing.T) {
	prometheus.Init("peers-admission-test", livekit.NodeType_CONTROLLER)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	roomName, identity := "gc-group", "gce-"+strings.Repeat("b", 64)
	room := rtc.NewRoom(&livekit.Room{Name: roomName, Sid: "RM-group"}, nil,
		rtc.WebRTCConfig{}, config.RoomConfig{EmptyTimeout: 300},
		&sfu.AudioConfig{}, &livekit.ServerInfo{}, &telemetryfakes.FakeTelemetryService{},
		nil, nil, nil)
	defer room.Close(types.ParticipantCloseReasonNone)
	participant := rtc.NewMockParticipant(livekit.ParticipantIdentity(identity),
		types.CurrentProtocol, false, false, room.LocalParticipantListener())
	participant.IDReturns("PA-current")
	participant.ToProtoReturns(&livekit.ParticipantInfo{Sid: "PA-current", Identity: identity})
	require.NoError(t, room.Join(participant, nil, &rtc.ParticipantOptions{}, nil))
	manager := &RoomManager{rooms: map[livekit.RoomName]*rtc.Room{livekit.RoomName(roomName): room}}
	bus := psrpc.NewLocalMessageBus() // This bus serializes protobufs to bytes.
	receiver, err := rpc.NewTypedParticipantServer(manager, bus)
	require.NoError(t, err)
	defer receiver.Shutdown()
	require.NoError(t, receiver.RegisterUpdateParticipantTopic(
		rpc.FormatParticipantTopic(livekit.RoomName(roomName), livekit.ParticipantIdentity(identity))))
	sender, err := rpc.NewParticipantClient[rpc.ParticipantTopic](bus)
	require.NoError(t, err)
	defer sender.Close()
	api := &RoomService{participantClient: sender, topicFormatter: rpc.NewTopicFormatter()}
	server := livekit.NewRoomServiceServer(api)
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		server.ServeHTTP(w, request.WithContext(WithGrants(request.Context(),
			&auth.ClaimGrants{Video: &auth.VideoGrant{RoomAdmin: true, Room: roomName}}, "")))
	}))
	defer httpServer.Close()
	client := livekit.NewRoomServiceProtobufClient(httpServer.URL, httpServer.Client())
	request := &livekit.UpdateParticipantRequest{Room: roomName, Identity: identity,
		Metadata:   `{"actorPtid":"ptid:alice"}`,
		Permission: &livekit.ParticipantPermission{CanPublish: true, CanSubscribe: true}}
	request.ProtoReflect().SetUnknown(protowire.AppendString(
		protowire.AppendTag(nil, 1001, protowire.BytesType), "PA-current"))
	result, err := client.UpdateParticipant(ctx, request)
	require.NoError(t, err)
	require.Equal(t, "PA-current", result.Sid)
	require.Equal(t, 1, participant.SetPermissionCallCount())
	require.Equal(t, 1, participant.UpdateMetadataCallCount())
	require.True(t, participant.SetPermissionArgsForCall(0).CanPublish)

	// Model a new RTC SID at the same endpoint. Neither old-SID admission nor
	// an absent conditional field may mutate that replacement's permissions.
	participant.IDReturns("PA-replacement")
	_, err = client.UpdateParticipant(ctx, request)
	require.Error(t, err)
	request.ProtoReflect().SetUnknown(nil)
	_, err = client.UpdateParticipant(ctx, request)
	require.Error(t, err)
	require.Equal(t, 1, participant.SetPermissionCallCount())
	require.Equal(t, 1, participant.UpdateMetadataCallCount())
}

func TestPeersInitialGrants(t *testing.T) {
	grants := &auth.ClaimGrants{
		Video:    &auth.VideoGrant{RoomJoin: true, Room: "gc-group"},
		Metadata: `{"actorPtid":"untrusted"}`, Attributes: map[string]string{"role": "admin"},
	}
	grants.Video.SetCanPublish(true)
	grants.Video.SetCanSubscribe(true)
	grants.Video.SetCanPublishData(true)
	grants.Video.SetCanUpdateOwnMetadata(true)
	masked, err := peersInitialGrants(grants)
	if err != nil {
		t.Fatal(err)
	}
	if *masked.Video.CanPublish || *masked.Video.CanSubscribe || *masked.Video.CanPublishData ||
		*masked.Video.CanUpdateOwnMetadata || masked.Metadata != "" || len(masked.Attributes) != 0 {
		t.Fatal("refreshed JWT can authorize new SID or supply actor metadata")
	}
	if !*grants.Video.CanPublish || grants.Metadata == "" {
		t.Fatal("new-SID masking mutated the original resume grants")
	}
	if _, err := peersInitialGrants(nil); err == nil {
		t.Fatal("missing grants accepted")
	}
}

func TestPeersExpectedSID(t *testing.T) {
	wire := protowire.AppendString(protowire.AppendTag(nil, 1001, protowire.BytesType), "PA-current")
	for _, item := range []struct {
		name  string
		wire  []byte
		valid bool
	}{
		{"SID", wire, true},
		{"absent", nil, false},
		{"duplicate", append(append([]byte{}, wire...), wire...), false},
		{"wrong type", protowire.AppendVarint(protowire.AppendTag(nil, 1001, protowire.VarintType), 1), false},
		{"empty", protowire.AppendString(protowire.AppendTag(nil, 1001, protowire.BytesType), ""), false},
		{"truncated", []byte{0xff}, false},
	} {
		t.Run(item.name, func(t *testing.T) {
			input := &livekit.UpdateParticipantRequest{Room: "gc-group", Identity: "gce-" + strings.Repeat("a", 64)}
			input.ProtoReflect().SetUnknown(item.wire)
			encoded, err := proto.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			decoded := &livekit.UpdateParticipantRequest{}
			if err := proto.Unmarshal(encoded, decoded); err != nil {
				if item.valid {
					t.Fatal(err)
				}
				return
			}
			sid, err := peersExpectedSID(decoded)
			if (err == nil) != item.valid || (item.valid && sid != "PA-current") {
				t.Fatalf("SID control = %q, %v", sid, err)
			}
		})
	}
}

func TestPeersEndpointFence(t *testing.T) {
	manager := &RoomManager{}
	var workers sync.WaitGroup
	value := 0
	for range 24 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for range 100 {
				unlock := manager.lockPeersEndpoint("gc-group", "gce-"+strings.Repeat("a", 64))
				value++
				unlock()
			}
		}()
	}
	workers.Wait()
	if value != 2400 {
		t.Fatalf("endpoint operations were not serialized: %d", value)
	}
	for _, identity := range []string{"ptid:alice", "gce-" + strings.Repeat("A", 64), "gce-short"} {
		if peersEndpointIdentity(identity) {
			t.Fatalf("legacy/malformed endpoint %q accepted", identity)
		}
	}
	if !peersEndpointIdentity("gce-" + strings.Repeat("a", 64)) {
		t.Fatal("canonical endpoint rejected")
	}
}
