package handler

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/persistence/memory"
)

func TestAdminRejectsUnauthorizedBeforeStorage(t *testing.T) {
	auth := testAdminAuthenticator(t, true)
	store := &countingAdminStore{Store: memory.NewStore()}
	admin := &AdminHandler{Store: store, Auth: auth}

	for name, request := range map[string]*http.Request{
		"missing credentials": httptest.NewRequest(http.MethodGet, "https://broker.example/api/admin", nil),
		"wrong credentials":   httptest.NewRequest(http.MethodGet, "https://broker.example/api/admin", nil),
		"insecure transport":  httptest.NewRequest(http.MethodGet, "http://broker.example/api/admin", nil),
	} {
		t.Run(name, func(t *testing.T) {
			if name == "wrong credentials" {
				request.SetBasicAuth("operator", "wrong-password")
			}
			if name == "insecure transport" {
				request.SetBasicAuth("operator", "correct-password")
			}
			recorder := httptest.NewRecorder()
			admin.Page(recorder, request)
			if name == "insecure transport" {
				if recorder.Code != http.StatusBadRequest {
					t.Fatalf("expected HTTPS rejection, got %d", recorder.Code)
				}
			} else if recorder.Code != http.StatusUnauthorized ||
				recorder.Header().Get("WWW-Authenticate") == "" {
				t.Fatalf("expected Basic challenge, got %d", recorder.Code)
			}
			assertAdminSecurityHeaders(t, recorder.Header())
		})
	}
	if store.reads.Load() != 0 {
		t.Fatalf("unauthorized requests reached storage %d times", store.reads.Load())
	}
}

func TestAdminJSONAndHTMLAreSanitized(t *testing.T) {
	store := &countingAdminStore{Store: memory.NewStore()}
	seedAdminStore(t, store.Store)
	admin := &AdminHandler{Store: store, Auth: testAdminAuthenticator(t, true)}

	for _, endpoint := range []struct {
		name        string
		path        string
		handler     func(http.ResponseWriter, *http.Request)
		contentType string
		required    []string
	}{
		{
			name:        "json",
			path:        "/api/admin/data",
			handler:     admin.Data,
			contentType: "application/json",
			required:    []string{`"has_refresh_token":true`, `"login_count":1`},
		},
		{
			name:        "html",
			path:        "/api/admin",
			handler:     admin.Page,
			contentType: "text/html; charset=utf-8",
			required:    []string{"OAuth Login Broker", "Alice", "Present"},
		},
	} {
		t.Run(endpoint.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "http://broker.example"+endpoint.path, nil)
			request.Header.Set("X-Forwarded-Proto", "https")
			request.SetBasicAuth("operator", "correct-password")
			recorder := httptest.NewRecorder()
			endpoint.handler(recorder, request)
			response := recorder.Result()
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != http.StatusOK ||
				response.Header.Get("Content-Type") != endpoint.contentType {
				t.Fatalf("unexpected response: status=%d headers=%v", response.StatusCode, response.Header)
			}
			for _, value := range endpoint.required {
				if !strings.Contains(string(body), value) {
					t.Fatalf("response omitted %q: %s", value, body)
				}
			}
			for _, secret := range []string{
				"access-secret",
				"refresh-secret",
				"state-secret",
				"verifier-secret",
				"correct-password",
			} {
				if strings.Contains(string(body), secret) {
					t.Fatalf("response leaked secret %q", secret)
				}
			}
			assertAdminSecurityHeaders(t, response.Header)
		})
	}
	if store.reads.Load() != 2 {
		t.Fatalf("expected two authorized storage reads, got %d", store.reads.Load())
	}
}

func testAdminAuthenticator(t *testing.T, requireHTTPS bool) *BasicAuthenticator {
	t.Helper()
	salt := []byte("0123456789abcdef")
	hash := pbkdf2SHA256(
		[]byte("correct-password"),
		salt,
		minimumPBKDF2Iterations,
		32,
	)
	auth, err := NewBasicAuthenticator(
		"operator",
		"pbkdf2-sha256$100000$"+
			base64.StdEncoding.EncodeToString(salt)+"$"+
			base64.StdEncoding.EncodeToString(hash),
		requireHTTPS,
	)
	if err != nil {
		t.Fatal(err)
	}
	return auth
}

func assertAdminSecurityHeaders(t *testing.T, header http.Header) {
	t.Helper()
	for name, expected := range map[string]string{
		"Cache-Control":           "no-store",
		"Content-Security-Policy": "frame-ancestors 'none'",
		"Referrer-Policy":         "no-referrer",
		"X-Content-Type-Options":  "nosniff",
		"X-Frame-Options":         "DENY",
		"X-Robots-Tag":            "noindex, nofollow",
	} {
		actual := header.Get(name)
		if name == "Content-Security-Policy" {
			if !strings.Contains(actual, expected) {
				t.Fatalf("%s missing %q: %q", name, expected, actual)
			}
		} else if actual != expected {
			t.Fatalf("%s = %q, want %q", name, actual, expected)
		}
	}
}

func seedAdminStore(t *testing.T, store *memory.Store) {
	t.Helper()
	now := time.Date(2026, 9, 30, 6, 0, 0, 0, time.UTC)
	session := entity.AuthSession{
		State:     "state-secret",
		SiteID:    "main",
		Provider:  valueobject.ProviderGitHub,
		Verifier:  "verifier-secret",
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := store.CreateAuthorization(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompleteAuthorization(context.Background(), entity.AuthorizationCompletion{
		State:        session.State,
		CompletionID: "completion",
		Identity: entity.ProviderIdentity{
			ProviderUserID: "42",
			DisplayName:    "Alice",
			Email:          "alice@example.com",
		},
		Tokens: entity.TokenSet{
			AccessToken:  "access-secret",
			RefreshToken: "refresh-secret",
			ObtainedAt:   now,
		},
		CompletedAt: now.Add(time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
}

type countingAdminStore struct {
	*memory.Store
	reads atomic.Int32
}

func (s *countingAdminStore) AdminSnapshot(ctx context.Context, limit int) (entity.AdminSnapshot, error) {
	s.reads.Add(1)
	return s.Store.AdminSnapshot(ctx, limit)
}
