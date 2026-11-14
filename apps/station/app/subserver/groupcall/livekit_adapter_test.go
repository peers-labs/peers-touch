package groupcall

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

type staticMemberLister struct{}

func (staticMemberLister) ListGroupMemberPTIDs(context.Context, string) ([]string, error) {
	return nil, nil
}

func TestRoomNameRoundTrip(t *testing.T) {
	const groupULID = "01K5QJYP1Q4VQMB3QWR3D4E5F6"
	room := roomName(groupULID)
	if room != "gc-"+groupULID {
		t.Fatalf("roomName() = %q", room)
	}
	if got := extractGroupULID(room); got != groupULID {
		t.Fatalf("extractGroupULID() = %q, want %q", got, groupULID)
	}
}

func TestGenerateTokenReturnsPublicURL(t *testing.T) {
	adapter := NewLiveKitAdapter(
		LiveKitConfig{
			APIURL:    "http://livekit.internal:7880",
			PublicURL: "wss://livekit.example.com",
			APIKey:    "test-key",
			APISecret: "test-secret-with-enough-entropy",
		},
		staticMemberLister{},
	)

	url, token, err := adapter.GenerateToken(
		context.Background(),
		"gc-group",
		"ptid:alice",
	)
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}
	if url != "wss://livekit.example.com" {
		t.Fatalf("GenerateToken() URL = %q", url)
	}
	if token == "" {
		t.Fatal("GenerateToken() returned an empty token")
	}
	parsed, err := auth.ParseAPIToken(token)
	if err != nil {
		t.Fatal(err)
	}
	_, grants, err := parsed.Verify("test-secret-with-enough-entropy")
	if err != nil {
		t.Fatal(err)
	}
	if grants.Video.CanPublish == nil || *grants.Video.CanPublish ||
		grants.Video.CanSubscribe == nil || *grants.Video.CanSubscribe ||
		grants.Video.CanPublishData == nil || *grants.Video.CanPublishData ||
		grants.Video.CanUpdateOwnMetadata == nil || *grants.Video.CanUpdateOwnMetadata {
		t.Fatal("initial token permits media or self-authored identity metadata")
	}
}

func TestRequireConditionalAdmission(t *testing.T) {
	for _, response := range []string{
		`{"contract":"sid-fence-replay-deny-v1","source":"b93c1e160770d93179dc5b1c9027567befec5e62"}`,
		`{"contract":"stock","source":"b93c1e160770d93179dc5b1c9027567befec5e62"}`,
		`{"contract":"sid-fence-replay-deny-v1","source":"other"}`,
		`not-json`,
	} {
		t.Run(response, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
					t.Error("capability missing management authentication")
				}
				_, _ = io.WriteString(w, response)
			}))
			defer server.Close()
			adapter := NewLiveKitAdapter(LiveKitConfig{
				APIURL: server.URL, PublicURL: "ws://sfu", APIKey: "key", APISecret: "secret",
			}, staticMemberLister{})
			err := adapter.requireConditionalAdmission(context.Background())
			if strings.Contains(response, `"source":"b93c1`) && strings.Contains(response, `"contract":"sid-fence`) {
				if err != nil {
					t.Fatal(err)
				}
			} else if !errors.Is(err, ErrConditionalAdmissionUnavailable) {
				t.Fatalf("unknown SFU accepted: %v", err)
			}
		})
	}
	t.Run("management credential is not redirected", func(t *testing.T) {
		var reached atomic.Bool
		target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached.Store(true) }))
		defer target.Close()
		redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, target.URL, http.StatusFound)
		}))
		defer redirect.Close()
		adapter := NewLiveKitAdapter(LiveKitConfig{APIURL: redirect.URL, PublicURL: "ws://sfu", APIKey: "key", APISecret: "secret"}, staticMemberLister{})
		if err := adapter.requireConditionalAdmission(context.Background()); err == nil || reached.Load() {
			t.Fatal("capability redirect forwarded management credentials")
		}
	})
}

func TestAdmitParticipant(t *testing.T) {
	for _, responseSID := range []string{"PA-current", "PA-replaced"} {
		t.Run(responseSID, func(t *testing.T) {
			identity := "gce-" + strings.Repeat("a", 64)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.Contains(r.URL.Path, "/.well-known/") {
					_, _ = io.WriteString(w, `{"contract":"sid-fence-replay-deny-v1","source":"b93c1e160770d93179dc5b1c9027567befec5e62"}`)
					return
				}
				if !strings.HasSuffix(r.URL.Path, "/UpdateParticipant") {
					t.Errorf("unexpected RPC %s", r.URL.Path)
					w.WriteHeader(404)
					return
				}
				body, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
					return
				}
				var input livekit.UpdateParticipantRequest
				if err := proto.Unmarshal(body, &input); err != nil {
					t.Error(err)
					return
				}
				field, wireType, n := protowire.ConsumeTag(input.ProtoReflect().GetUnknown())
				if n < 0 {
					t.Error("SID control missing from original SDK protobuf")
					return
				}
				sid, _ := protowire.ConsumeString(input.ProtoReflect().GetUnknown()[n:])
				if field != 1001 || wireType != protowire.BytesType || sid != "PA-current" ||
					input.Identity != identity || input.Metadata != `{"actorPtid":"ptid:alice"}` ||
					input.Permission.GetCanPublishData() || input.Permission.GetCanUpdateMetadata() {
					t.Errorf("invalid conditional RPC: %v / %q", &input, sid)
				}
				result, _ := proto.Marshal(&livekit.ParticipantInfo{
					Sid: responseSID, Identity: identity,
					Permission: &livekit.ParticipantPermission{CanPublish: true, CanSubscribe: true},
				})
				w.Header().Set("Content-Type", "application/protobuf")
				_, _ = w.Write(result)
			}))
			defer server.Close()
			adapter := NewLiveKitAdapter(LiveKitConfig{APIURL: server.URL, PublicURL: "ws://sfu", APIKey: "key", APISecret: "secret"}, staticMemberLister{})
			err := adapter.AdmitParticipant(context.Background(), "gc-group", identity, "PA-current", "ptid:alice")
			if (err == nil) != (responseSID == "PA-current") {
				t.Fatalf("admission confirmation = %v", err)
			}
		})
	}
}

func TestReadRoom(t *testing.T) {
	for _, allowed := range []bool{false, true} {
		t.Run(fmt.Sprint(allowed), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var response proto.Message
				switch {
				case strings.HasSuffix(r.URL.Path, "/ListRooms"):
					response = &livekit.ListRoomsResponse{Rooms: []*livekit.Room{{Name: "gc-group", Sid: "RM-current"}}}
				case strings.HasSuffix(r.URL.Path, "/ListParticipants"):
					response = &livekit.ListParticipantsResponse{Participants: []*livekit.ParticipantInfo{{
						Identity: "gce-" + strings.Repeat("a", 64), Sid: "PA-current",
						Permission: &livekit.ParticipantPermission{CanPublish: allowed, CanSubscribe: allowed},
					}}}
				default:
					t.Errorf("unexpected RPC %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
					return
				}
				body, _ := proto.Marshal(response)
				w.Header().Set("Content-Type", "application/protobuf")
				_, _ = w.Write(body)
			}))
			defer server.Close()
			adapter := NewLiveKitAdapter(LiveKitConfig{APIURL: server.URL, PublicURL: "ws://sfu", APIKey: "key", APISecret: "secret"}, staticMemberLister{})
			result, err := adapter.ReadRoom(context.Background(), "group")
			if err != nil || result.Active != allowed || result.RoomSID != "RM-current" {
				t.Fatalf("room status treated connected-but-unadmitted participant as active: %+v, %v", result, err)
			}
		})
	}
}

func TestRemoveParticipant(t *testing.T) {
	for _, remaining := range []bool{false, true} {
		t.Run(fmt.Sprint(remaining), func(t *testing.T) {
			identity := "gce-" + strings.Repeat("a", 64)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var response proto.Message
				if strings.HasSuffix(r.URL.Path, "/RemoveParticipant") {
					response = &livekit.RemoveParticipantResponse{}
				} else if strings.HasSuffix(r.URL.Path, "/ListParticipants") {
					participants := &livekit.ListParticipantsResponse{}
					if remaining {
						participants.Participants = []*livekit.ParticipantInfo{{Identity: identity, Sid: "PA-replacement"}}
					}
					response = participants
				} else {
					t.Errorf("unexpected RPC %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
					return
				}
				body, _ := proto.Marshal(response)
				w.Header().Set("Content-Type", "application/protobuf")
				_, _ = w.Write(body)
			}))
			defer server.Close()
			adapter := NewLiveKitAdapter(LiveKitConfig{APIURL: server.URL, PublicURL: "ws://sfu", APIKey: "key", APISecret: "secret"}, staticMemberLister{})
			err := adapter.RemoveParticipant(context.Background(), "gc-group", identity)
			if (err == nil) == remaining {
				t.Fatalf("unconfirmed roster ejection = %v", err)
			}
		})
	}
}

func TestGenerateTokenRejectsIncompleteConfig(t *testing.T) {
	adapter := NewLiveKitAdapter(
		LiveKitConfig{APIURL: "http://livekit.internal:7880"},
		staticMemberLister{},
	)

	if _, _, err := adapter.GenerateToken(
		context.Background(),
		"gc-group",
		"ptid:alice",
	); err == nil {
		t.Fatal("GenerateToken() accepted incomplete LiveKit config")
	}
}
