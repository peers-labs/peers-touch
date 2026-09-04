package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type endpointManifestTokenMinterStub struct{}

func (endpointManifestTokenMinterStub) MintEndpointManifestRead(
	context.Context,
	string,
	string,
) (string, error) {
	return "target-peer-jwt", nil
}

type endpointManifestRepositorySpy struct {
	saved *chat.FederatedEndpointManifest
}

func (*endpointManifestRepositorySpy) BuildLocalManifestSnapshot(
	context.Context,
	string,
	string,
	time.Time,
) (*chat.FederatedEndpointManifest, error) {
	return nil, messaging.ErrNotFound
}

func (r *endpointManifestRepositorySpy) SaveVerifiedManifest(
	_ context.Context,
	manifest *chat.FederatedEndpointManifest,
	_ []byte,
	_ []byte,
) error {
	r.saved = manifest
	return nil
}

func (*endpointManifestRepositorySpy) ListVerifiedManifests(
	context.Context,
	[]string,
	time.Time,
) ([]*chat.FederatedEndpointManifest, error) {
	return nil, messaging.ErrNotFound
}

func (*endpointManifestRepositorySpy) HomeStationForEndpoint(
	context.Context,
	*chat.CryptoEndpoint,
	time.Time,
) (string, error) {
	return "", messaging.ErrNotFound
}

func TestEndpointManifestFetcherBootstrapsTrustAndUsesProtobufRelay(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	key, err := authfed.MintLocalKey(now)
	if err != nil {
		t.Fatal(err)
	}
	manifest := &chat.FederatedEndpointManifest{
		ManifestId:       "manifest-1",
		ActorPtid:        "ptid:bob",
		HomeStationId:    "station:remote",
		DirectoryVersion: 1,
		ActiveEndpoints: []*chat.FederatedEndpointManifestEntry{{
			Endpoint: &chat.CryptoEndpoint{
				Ptid:     "ptid:bob",
				DeviceId: "bob-device",
			},
			SigningKeyId:         "bob-device-key",
			PublicMaterialSha256: [][]byte{bytes.Repeat([]byte{1}, sha256.Size)},
		}},
		IssuedAt:               timestamppb.New(now),
		ExpiresAt:              timestamppb.New(now.Add(5 * time.Minute)),
		ActorIdentityPublicKey: bytes.Repeat([]byte{2}, 32),
		ActorProfileVersion:    1,
	}
	if err := application.SignEndpointManifest(manifest, key.Kid, key.Priv); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		if request.URL.Path !=
			"/relay/forward/station:remote/messaging/federation/endpoint-manifest" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if request.Header.Get("Content-Type") != "application/protobuf" ||
			request.Header.Get("Accept") != "application/protobuf" {
			t.Fatalf("protobuf headers = %v", request.Header)
		}
		if request.Header.Get("Authorization") != "Bearer relay-token" ||
			request.Header.Get(nativefed.ForwardAuthorizationHeader) !=
				"Bearer target-peer-jwt" {
			t.Fatalf("federation headers = %v", request.Header)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		var decoded chat.GetFederatedEndpointManifestRequest
		if err := proto.Unmarshal(body, &decoded); err != nil {
			t.Fatal(err)
		}
		if decoded.ActorPtid != "ptid:bob" {
			t.Fatalf("actor PTID = %q", decoded.ActorPtid)
		}
		response, err := proto.Marshal(
			&chat.GetFederatedEndpointManifestResponse{Manifest: manifest},
		)
		if err != nil {
			t.Fatal(err)
		}
		writer.Header().Set("Content-Type", "application/protobuf")
		_, _ = writer.Write(response)
	}))
	defer server.Close()

	peerKeys := authfed.NewInMemoryPeerKeyStore()
	trustCalls := 0
	peerTrust := messaging.FederationPeerTrustResolveFunc(func(
		_ context.Context,
		homeStationID string,
		actorPTID string,
	) error {
		trustCalls++
		if homeStationID != "station:remote" || actorPTID != "ptid:bob" {
			t.Fatalf(
				"trust binding = (%q, %q)",
				homeStationID,
				actorPTID,
			)
		}
		return peerKeys.UpsertTOFU(context.Background(), authfed.PeerKey{
			StationID: homeStationID,
			Kid:       key.Kid,
			PubPEM:    key.PubPEM,
		})
	})
	repository := &endpointManifestRepositorySpy{}
	fetcher, err := NewHTTPFederatedEndpointManifestFetcher(
		server.Client(),
		endpointManifestTokenMinterStub{},
		nil,
		relayStub{url: server.URL, token: "relay-token"},
		peerKeys,
		peerTrust,
		repository,
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}

	resolved, err := fetcher.FetchEndpointManifest(
		context.Background(),
		"station:remote",
		"ptid:bob",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(resolved, manifest) ||
		!proto.Equal(repository.saved, manifest) ||
		trustCalls != 1 {
		t.Fatalf(
			"resolved=%p saved=%p trustCalls=%d",
			resolved,
			repository.saved,
			trustCalls,
		)
	}
}
