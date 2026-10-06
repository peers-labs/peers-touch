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
	fedcache "github.com/peers-labs/peers-touch/station/frame/touch/federation/cache"
	fedprofile "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	modeldb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

type resolverRelayClient struct {
	baseURL string
	token   string
}

type membershipReaderStub struct {
	active bool
	err    error
	calls  [][2]string
}

func (s *membershipReaderStub) IsActiveMember(
	_ context.Context,
	federationID string,
	stationPeerID string,
) (bool, error) {
	s.calls = append(s.calls, [2]string{federationID, stationPeerID})
	return s.active, s.err
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

func TestRequireActiveMembershipFailsClosed(t *testing.T) {
	reader := &membershipReaderStub{active: false}

	err := requireActiveMembership(
		context.Background(),
		reader,
		"federation-1",
		"station-remote",
	)
	if !errors.Is(err, ErrStationOutsideFederation) {
		t.Fatalf("error = %v, want ErrStationOutsideFederation", err)
	}
	if len(reader.calls) != 1 ||
		reader.calls[0] != [2]string{"federation-1", "station-remote"} {
		t.Fatalf("membership calls = %#v", reader.calls)
	}
}

func TestRequireActiveMembershipPropagatesRepositoryFailure(t *testing.T) {
	repositoryErr := errors.New("membership store unavailable")
	reader := &membershipReaderStub{err: repositoryErr}

	err := requireActiveMembership(
		context.Background(),
		reader,
		"federation-1",
		"station-remote",
	)
	if !errors.Is(err, repositoryErr) {
		t.Fatalf("error = %v, want repository failure", err)
	}
}

func TestResolveByHandleInFederationRequiresContextAndReader(t *testing.T) {
	resolver := New(Config{})
	if _, err := resolver.ResolveByHandleInFederation(
		context.Background(),
		"",
		"@bob@remote.invalid",
		&membershipReaderStub{active: true},
		nil,
		nil,
	); !errors.Is(err, ErrFederationContextRequired) {
		t.Fatalf("empty context error = %v", err)
	}
	if _, err := resolver.ResolveByHandleInFederation(
		context.Background(),
		"federation-1",
		"@bob@remote.invalid",
		nil,
		nil,
		nil,
	); !errors.Is(err, ErrMembershipReaderMissing) {
		t.Fatalf("missing reader error = %v", err)
	}
}

func TestCachedToProtosPreservesCanonicalActorIdentity(t *testing.T) {
	envelope, locator := cachedToProtos(
		&fedcache.Cached{
			Actor: &modeldb.Actor{
				PTID:              "ptid:bob",
				Kind:              "p",
				Name:              "Bob",
				FederatedHandle:   "bob@remote.invalid",
				HomeStationPeerID: "station-remote",
				HomeStationDomain: "remote.invalid",
				Visibility:        int16(modelpb.ActorVisibility_ACTOR_VISIBILITY_BY_HANDLE),
				LocatorSeq:        7,
			},
			CachedUntilUTC: time.Unix(1_700_000_000, 0).UTC(),
		},
		"bob@remote.invalid",
	)

	if envelope == nil || locator == nil || envelope.GetProfile() == nil {
		t.Fatal("cached projection is incomplete")
	}
	profile := envelope.GetProfile()
	if profile.GetRef().GetPtid() != "ptid:bob" ||
		profile.GetRef().GetAcct() != "bob@remote.invalid" ||
		profile.GetRef().GetKind() != modelpb.ActorKind_ACTOR_KIND_PERSON {
		t.Fatalf("cached Actor ref = %+v", profile.GetRef())
	}
	if profile.GetFederatedHandle() != "bob@remote.invalid" ||
		profile.GetHomeStationPeerId() != "station-remote" ||
		profile.GetHomeStationDomain() != "remote.invalid" ||
		profile.GetDiscoverability() != modelpb.ActorVisibility_ACTOR_VISIBILITY_BY_HANDLE {
		t.Fatalf("cached federation identity = %+v", profile)
	}
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
