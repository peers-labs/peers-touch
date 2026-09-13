package resolver

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	locatorpb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	fedprofile "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type resolverRelayClient struct {
	baseURL string
	token   string
}

func (c resolverRelayClient) BaseURL() string {
	return c.baseURL
}

func (c resolverRelayClient) Token() string {
	return c.token
}

func (resolverRelayClient) Publish(context.Context, string, []byte) error {
	return nil
}

func TestRememberRemoteStationKeyPersistsVerifiedLocatorKey(t *testing.T) {
	key, err := authfed.MintLocalKey(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	peerKeys := authfed.NewInMemoryPeerKeyStore()
	resolver := New(Config{PeerKeys: peerKeys})

	if err := resolver.rememberRemoteStationKey(
		context.Background(),
		&locatorpb.ActorLocatorRecord{
			HomeStationPeerId: "station:remote",
			SigningKeyKid:     key.Kid,
			SigningKeyPem:     key.PubPEM,
		},
	); err != nil {
		t.Fatal(err)
	}

	stored, err := peerKeys.Get(context.Background(), "station:remote")
	if err != nil {
		t.Fatal(err)
	}
	if stored == nil || stored.Kid != key.Kid || stored.PubPEM != key.PubPEM {
		t.Fatalf("stored peer key = %+v", stored)
	}
}

func TestRememberRemoteStationKeyPreservesTOFUMismatch(t *testing.T) {
	first, err := authfed.MintLocalKey(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	second, err := authfed.MintLocalKey(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	peerKeys := authfed.NewInMemoryPeerKeyStore()
	if err := peerKeys.UpsertTOFU(context.Background(), authfed.PeerKey{
		StationID: "station:remote",
		Kid:       first.Kid,
		PubPEM:    first.PubPEM,
	}); err != nil {
		t.Fatal(err)
	}
	resolver := New(Config{PeerKeys: peerKeys})

	err = resolver.rememberRemoteStationKey(
		context.Background(),
		&locatorpb.ActorLocatorRecord{
			HomeStationPeerId: "station:remote",
			SigningKeyKid:     second.Kid,
			SigningKeyPem:     second.PubPEM,
		},
	)
	if !errors.Is(err, authfed.ErrPeerKeyMismatch) {
		t.Fatalf("error = %v, want ErrPeerKeyMismatch", err)
	}
}

func TestResolveRemoteUsesProtobufAndBindsProfileToLocator(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	key, err := authfed.MintLocalKey(now)
	if err != nil {
		t.Fatal(err)
	}
	envelope, body, err := fedprofile.Sign(fedprofile.SignInput{
		Handle:            "@bob@remote.invalid",
		HomeStationPeerID: "station-remote",
		HomeStationDomain: "remote.invalid",
		Profile: &modelpb.ActorProfile{
			PeersTouch: &modelpb.PeersTouchInfo{NetworkId: "ptid:bob"},
		},
		DeviceSigningKeys: []*modelpb.VerifiedActorDeviceSigningKey{{
			ActorPtid:          "ptid:bob",
			ActorDeviceId:      "bob-device",
			HomeStationPeerId:  "station-remote",
			SigningKeyId:       "bob-key",
			Ed25519PublicKey:   make([]byte, ed25519.PublicKeySize),
			ProfileVersion:     1,
			VerificationSource: modelpb.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
		}},
		Now:      now,
		LocalKey: key,
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		if request.Header.Get("Accept") != "application/protobuf" {
			t.Fatalf("Accept = %q", request.Header.Get("Accept"))
		}
		if request.Header.Get("Authorization") != "Bearer relay-token" {
			t.Fatalf("Authorization = %q", request.Header.Get("Authorization"))
		}
		writer.Header().Set("Content-Type", "application/protobuf")
		_, _ = writer.Write(body)
	}))
	defer server.Close()
	nativefed.ClearRelayClient()
	nativefed.RegisterRelayClient(resolverRelayClient{
		baseURL: server.URL,
		token:   "relay-token",
	})
	t.Cleanup(nativefed.ClearRelayClient)

	resolver := New(Config{
		HTTPClient: server.Client(),
		Now:        func() time.Time { return now },
	})
	resolved, err := resolver.resolveRemote(
		context.Background(),
		"@bob@remote.invalid",
		&locatorpb.ActorLocatorRecord{
			FederatedHandle:   "@bob@remote.invalid",
			HomeStationPeerId: "station-remote",
			HomeStationDomain: "remote.invalid",
			SigningKeyKid:     key.Kid,
			SigningKeyPem:     key.PubPEM,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Envelope.GetProfile().GetPeersTouch().GetNetworkId() !=
		envelope.GetProfile().GetPeersTouch().GetNetworkId() {
		t.Fatalf("resolved envelope = %+v", resolved.Envelope)
	}
}
