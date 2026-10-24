package integration

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	xconfig "github.com/peers-labs/peers-touch/station/frame/touch/model/xconfig"
	"github.com/peers-labs/peers-touch/station/frame/touch/xcontrol"

	"github.com/peers-labs/peers-touch/x-config/internal/application/admin"
	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
	"github.com/peers-labs/peers-touch/x-config/internal/domain/operator"
	"github.com/peers-labs/peers-touch/x-config/internal/infrastructure/catalogrepo"
	httpinterface "github.com/peers-labs/peers-touch/x-config/internal/interfaces/http"
	"github.com/peers-labs/peers-touch/x-config/internal/publication"

	peer "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

// stubAdminAuth bypasses the GitHub OAuth broker for the API acceptance test
// while keeping the real AdminHandler authorization boundary.
type stubAdminAuth struct{}

func (stubAdminAuth) Authenticate(
	_ context.Context,
	_ string,
	_ string,
	_ bool,
) (*operator.Session, error) {
	return &operator.Session{
		Provider:        "github",
		ProviderSubject: "acceptance",
	}, nil
}

func directiveCatalog(t *testing.T, now time.Time) catalog.Catalog {
	t.Helper()
	material := &peer.PublicEndpointConnectionMaterial{
		SchemaVersion:            1,
		CanonicalDiscoveryOrigin: "https://relay-corp.example:443",
		ExpectedEndpointRole:     peer.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY,
		ExpectedEndpointIdentity: "12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW",
		IssuedAtUnixMs:           now.Add(-time.Minute).UnixMilli(),
		ExpiresAtUnixMs:          now.Add(24 * time.Hour).UnixMilli(),
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(material)
	if err != nil {
		t.Fatal(err)
	}
	availableUntil := now.Add(time.Hour).Format(time.RFC3339)
	return catalog.Catalog{
		SchemaVersion: 1,
		Channel:       "corpstable",
		Endpoints: []catalog.CatalogEndpoint{
			{
				SeedID:                   "relay-corp-1",
				Kind:                     "relay",
				DisplayName:              "Corp Relay 1",
				ConnectionMaterialBase64: base64.StdEncoding.EncodeToString(raw),
				Regions:                  []string{"cn"},
				AvailableUntil:           availableUntil,
			},
		},
		Directives: []catalog.CatalogDirective{
			{
				Key: "network.default_relay",
				Rules: []catalog.CatalogDirectiveRule{
					{
						ID: "cn-xx",
						Match: catalog.CatalogTargetClause{
							Products: []string{"desktop", "mobile"},
							Flavors:  []string{"xx"},
							Regions:  []string{"cn"},
						},
						Value: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-corp-1"},
					},
				},
				Fallback: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-corp-1"},
			},
		},
		Distribution: &catalog.CatalogDistribution{
			Origins: []string{
				"http://10.37.221.38:18082",
				"https://xconfig-backup.example.test",
			},
		},
	}
}

// TestDirectivePublicationAPIAcceptance is the API-level acceptance for
// XCFG-D04: an operator publishes a directive catalog, an anonymous client
// reads the signed snapshot, and local evaluation selects the same rule the
// Rust and Go conformance vectors lock.
func TestDirectivePublicationAPIAcceptance(t *testing.T) {
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	channel := "corpstable"

	private := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x44}, ed25519.SeedSize))
	signer, err := publication.NewEd25519Signer("publisher-2026-10-corpstable", private)
	if err != nil {
		t.Fatal(err)
	}
	repository := catalogrepo.NewMemoryRepository()
	service := admin.Service{
		Repository:       repository,
		Validator:        nil,
		Signer:           signer,
		Clock:            fixedClock{now: now},
		SnapshotLifetime: 7 * 24 * time.Hour,
	}
	mux := http.NewServeMux()
	adminHandler := &httpinterface.AdminHandler{
		Auth:    stubAdminAuth{},
		Service: service,
	}
	publicHandler := &httpinterface.PublicHandler{Repository: repository}
	mux.HandleFunc("/api/admin/catalog", adminHandler.Catalog)
	mux.HandleFunc("/api/admin/catalog/validate", adminHandler.ValidateCatalog)
	mux.HandleFunc("/api/admin/publications", adminHandler.Publications)
	mux.HandleFunc("/channels/", publicHandler.Snapshot)
	server := httptest.NewServer(mux)
	defer server.Close()

	value := directiveCatalog(t, now)

	// 1. Validate the directive catalog through the public admin API.
	validation := postJSON[admin.ValidationResult](
		t, server.URL+"/api/admin/catalog/validate", value, adminRequest,
	)
	if !validation.Valid {
		t.Fatalf("directive catalog rejected: %+v", validation.Findings)
	}

	// 2. Save the first draft over PUT, then publish through the publications
	//    endpoint using the returned revision and content digest.
	saveBody := map[string]any{"base_revision": "", "catalog": value}
	draft := putJSON[catalog.Draft](t, server.URL+"/api/admin/catalog", saveBody, adminRequest)
	published := postJSON[catalog.Publication](t,
		server.URL+"/api/admin/publications",
		map[string]any{
			"channel":             channel,
			"base_revision":       draft.Revision,
			"acknowledged_digest": draft.ContentSHA256,
		},
		adminRequest,
	)
	if published.Sequence == 0 {
		t.Fatalf("publication missing sequence: %+v", published)
	}

	// 3. Anonymous credential-free public readback over the exact serving
	//    path clients use. The memory repository does not retain envelope
	//    bytes on the Publication record, so the served bytes are the
	//    contract under test.
	response, err := http.Get(server.URL + "/channels/" + channel + "/latest.pb")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("public snapshot status = %d", response.StatusCode)
	}
	readback, err := io.ReadAll(io.LimitReader(response.Body, 300*1024))
	if err != nil {
		t.Fatal(err)
	}
	if len(readback) == 0 {
		t.Fatal("public snapshot body is empty")
	}

	// 4. Verify the signed envelope as a client would (domain-separated
	//    ed25519 signature) and decode the statement.
	envelope := &xconfig.SignedXConfigSnapshot{}
	if err := proto.Unmarshal(readback, envelope); err != nil {
		t.Fatal(err)
	}
	signed := append([]byte("peers-touch/x-config/v1\x00"), envelope.StatementBytes...)
	publicKey, ok := private.Public().(ed25519.PublicKey)
	if !ok {
		t.Fatal("test key is not ed25519")
	}
	if !ed25519.Verify(publicKey, signed, envelope.Ed25519Signature) {
		t.Fatal("snapshot signature failed client verification")
	}
	statement := &xconfig.XConfigSnapshotStatement{}
	if err := proto.Unmarshal(envelope.StatementBytes, statement); err != nil {
		t.Fatal(err)
	}
	if statement.SchemaVersion != 1 || statement.Channel != channel {
		t.Fatalf("statement identity mismatch: %+v", statement)
	}
	if len(statement.Directives) != 1 || statement.Directives[0].GetKey() != "network.default_relay" {
		t.Fatalf("directive missing from signed statement: %+v", statement.Directives)
	}
	origins := statement.GetDistribution().GetOrigins()
	if len(origins) != 2 ||
		origins[0].GetOrigin() != "http://10.37.221.38:18082" ||
		origins[1].GetOrigin() != "https://xconfig-backup.example.test" {
		t.Fatalf("distribution origins missing or reordered: %+v", origins)
	}

	// 5. Evaluate with the Station Go engine for the two targeting cases.
	cnContext := xcontrol.TargetingContext{
		Product:      "desktop",
		Platform:     xconfig.ClientPlatform_CLIENT_PLATFORM_MACOS,
		Architecture: xconfig.ClientArchitecture_CLIENT_ARCHITECTURE_ARM64,
		Flavor:       "xx",
		Channel:      channel,
		Environment:  "prod",
		Region:       "cn",
		Version:      mustVersion(t, "0.2.0"),
		DeviceID:     "acceptance-device",
	}
	sgContext := cnContext
	sgContext.Region = "sg"
	cnResolved := xcontrol.EvaluateDirectives(statement.Directives, cnContext)
	sgResolved := xcontrol.EvaluateDirectives(statement.Directives, sgContext)
	if len(cnResolved) != 1 || cnResolved[0].MatchedRuleID != "cn-xx" {
		t.Fatalf("cn/xx context did not match cn-xx: %+v", cnResolved)
	}
	if len(sgResolved) != 1 || sgResolved[0].MatchedRuleID != "" {
		t.Fatalf("sg context should use fallback: %+v", sgResolved)
	}
	if seed := cnResolved[0].Value.EndpointSeedID; seed == nil || *seed != "relay-corp-1" {
		t.Fatalf("resolved seed mismatch: %+v", cnResolved[0].Value)
	}
}

type requestOption func(*http.Request)

const testCSRFToken = "acceptance-csrf-token"

// adminRequest attaches the session/CSRF cookies a real browser console
// sends after operator login; stubAdminAuth accepts any non-empty session.
func adminRequest(request *http.Request) {
	request.AddCookie(&http.Cookie{Name: "peers_xcfg_session", Value: "acceptance-session"})
	request.AddCookie(&http.Cookie{Name: "peers_xcfg_csrf", Value: testCSRFToken})
	request.Header.Set("X-CSRF-Token", testCSRFToken)
}

func doJSON[T any](t *testing.T, method string, url string, body any, options ...requestOption) T {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(method, url, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	for _, option := range options {
		option(request)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		var envelope struct {
			Error    string            `json:"error"`
			Findings []catalog.Finding `json:"findings"`
		}
		_ = json.NewDecoder(response.Body).Decode(&envelope)
		t.Fatalf("%s %s returned %d: %s %v", method, url, response.StatusCode, envelope.Error, envelope.Findings)
	}
	var out T
	if err := json.NewDecoder(response.Body).Decode(&out); err != nil {
		t.Fatalf("decode %s: %v", url, err)
	}
	return out
}

func postJSON[T any](t *testing.T, url string, body any, options ...requestOption) T {
	t.Helper()
	return doJSON[T](t, http.MethodPost, url, body, options...)
}

func putJSON[T any](t *testing.T, url string, body any, options ...requestOption) T {
	t.Helper()
	return doJSON[T](t, http.MethodPut, url, body, options...)
}

type fixedClock struct{ now time.Time }

func (c fixedClock) Now() time.Time { return c.now }

func mustVersion(t *testing.T, raw string) xcontrol.SemanticVersion {
	t.Helper()
	version, ok := xcontrol.ParseSemanticVersion(raw)
	if !ok {
		t.Fatal(fmt.Sprintf("bad version %s", raw))
	}
	return version
}
