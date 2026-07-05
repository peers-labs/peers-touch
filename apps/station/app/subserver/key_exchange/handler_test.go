package key_exchange

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestFetchFederatedKeyBundleUsesRelayAndPeerJWT(t *testing.T) {
	registerKeyExchangeFederationScope()
	nativefed.ClearRelayClient()
	defer nativefed.ClearRelayClient()

	var sawRelayAuth string
	var sawPeerAuth string
	var sawPath string
	var sawRequest kemodel.FetchKeyBundleRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawRelayAuth = r.Header.Get("Authorization")
		sawPeerAuth = r.Header.Get(nativefed.ForwardAuthorizationHeader)
		sawPath = r.URL.Path
		if err := protojson.Unmarshal(readKeyExchangeTestBody(t, r), &sawRequest); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		resp, err := protojson.Marshal(&kemodel.FetchKeyBundleResponse{
			Bundles: []*kemodel.KeyBundle{{
				Did:               "bob",
				DeviceId:          "bob-device-1",
				IkPub:             "aWstcHVi",
				SpkPub:            "c3BrLXB1Yg==",
				SpkSig:            "c3BrLXNpZw==",
				Opks:              []string{"b3Br"},
				PublishedAtUnixMs: 123,
				SupportedVersions: []uint32{0, 1},
			}},
		})
		if err != nil {
			t.Fatalf("encode response: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(resp)
	}))
	defer server.Close()
	nativefed.RegisterRelayClient(keyExchangeTestRelayClient{baseURL: server.URL, token: "relay-token"})

	sub := &subServer{
		localStationID: "station-a",
		keyCache:       authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0)),
	}
	resp, err := sub.fetchFederatedKeyBundle(context.Background(), "station-b", &kemodel.FetchKeyBundleRequest{
		Did:               "bob",
		DeviceId:          "bob-device-1",
		HomeStationPeerId: "station-b",
	})
	if err != nil {
		t.Fatalf("fetchFederatedKeyBundle: %v", err)
	}
	if len(resp.GetBundles()) != 1 || resp.GetBundles()[0].GetDid() != "bob" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if sawPath != "/relay/forward/station-b/key-exchange/keys/bundle/federated-fetch" {
		t.Fatalf("unexpected relay path: %s", sawPath)
	}
	if sawRelayAuth != "Bearer relay-token" {
		t.Fatalf("expected relay Authorization header, got %q", sawRelayAuth)
	}
	if !strings.HasPrefix(sawPeerAuth, "Bearer ") {
		t.Fatalf("expected forwarded peer auth header, got %q", sawPeerAuth)
	}
	if sawRequest.GetDid() != "bob" || sawRequest.GetDeviceId() != "bob-device-1" || sawRequest.GetHomeStationPeerId() != "" {
		t.Fatalf("unexpected forwarded request: %+v", &sawRequest)
	}
}

type keyExchangeTestRelayClient struct {
	baseURL string
	token   string
}

func (h keyExchangeTestRelayClient) BaseURL() string { return h.baseURL }
func (h keyExchangeTestRelayClient) Token() string   { return h.token }
func (h keyExchangeTestRelayClient) Publish(context.Context, string, []byte) error {
	return nil
}

func readKeyExchangeTestBody(t *testing.T, r *http.Request) []byte {
	t.Helper()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("read request body: %v", err)
	}
	return body
}
