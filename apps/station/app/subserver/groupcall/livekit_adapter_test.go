package groupcall

import (
	"context"
	"testing"
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
